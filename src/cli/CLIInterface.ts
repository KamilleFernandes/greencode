import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { CriptografiaArquivo } from "../persistencia/CriptografiaArquivo";
import { RepositorioArquivo } from "../persistencia/RepositorioArquivo";
import { JournalTransacao } from "../auditoria/JournalTransacao";
import { ServicoAutenticacao, carregarCredenciais, salvarCredenciais } from "../seguranca/ServicoAutenticacao";
import { Sessao } from "../seguranca/Sessao";
import { PapelUsuario } from "../seguranca/PapelUsuario";
import { ServicoOrganizacao } from "../organizacao/ServicoOrganizacao";
import { ConfiguracaoGlobal } from "../organizacao/ConfiguracaoGlobal";
import { ServicoLote } from "../lote/ServicoLote";
import { Equipamento } from "../equipamento/Equipamento";
import { ServicoEquipamento } from "../equipamento/ServicoEquipamento";
import { TipoEquipamento } from "../equipamento/TipoEquipamento";
import { EstadoFisico } from "../equipamento/EstadoFisico";
import { StatusRastreamento } from "../equipamento/StatusRastreamento";
import { ServicoRelatorio } from "../relatorio/ServicoRelatorio";
import { ValidadorCNPJ } from "../validacao/ValidadorCNPJ";

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const ARQUIVO_CONFIG = path.join(DATA_DIR, "config.master");
const ARQUIVO_HISTORICO = path.join(DATA_DIR, ".cli_history");

const PERMISSOES: Record<string, PapelUsuario[]> = {
  "usuario criar": [PapelUsuario.ADMINISTRADOR],
  "usuario remover": [PapelUsuario.ADMINISTRADOR],
  "usuario listar": [PapelUsuario.ADMINISTRADOR],
  "usuario papel": [PapelUsuario.ADMINISTRADOR],
  "config aliquota": [PapelUsuario.ADMINISTRADOR],
  "config depreciacao": [PapelUsuario.ADMINISTRADOR],
  "senha alterar": [PapelUsuario.ADMINISTRADOR, PapelUsuario.OPERADOR_CADASTRO, PapelUsuario.GESTOR_ALMOXARIFADO, PapelUsuario.AUDITOR],
  "organizacao cadastrar": [PapelUsuario.OPERADOR_CADASTRO],
  "organizacao buscar": [PapelUsuario.OPERADOR_CADASTRO],
  "organizacao listar": [PapelUsuario.OPERADOR_CADASTRO],
  "organizacao renovar": [PapelUsuario.OPERADOR_CADASTRO],
  "lote criar": [PapelUsuario.GESTOR_ALMOXARIFADO],
  "lote equipamento": [PapelUsuario.GESTOR_ALMOXARIFADO],
  "lote triagem": [PapelUsuario.GESTOR_ALMOXARIFADO],
  "lote consultar": [PapelUsuario.GESTOR_ALMOXARIFADO],
  "lote relatorio": [PapelUsuario.GESTOR_ALMOXARIFADO],
  "equipamento estado": [PapelUsuario.GESTOR_ALMOXARIFADO],
  "equipamento movimentar": [PapelUsuario.GESTOR_ALMOXARIFADO],
  "equipamento rastrear": [PapelUsuario.GESTOR_ALMOXARIFADO, PapelUsuario.AUDITOR],
  "relatorio organizacao": [PapelUsuario.AUDITOR],
  "relatorio status": [PapelUsuario.AUDITOR],
  "relatorio financeiro": [PapelUsuario.AUDITOR],
};

const COMANDOS_CONHECIDOS = [...Object.keys(PERMISSOES), "ajuda", "sair"];

export class CLIInterface {
  autenticacao: ServicoAutenticacao;
  organizacao: ServicoOrganizacao;
  lote: ServicoLote;
  equipamento: ServicoEquipamento;
  relatorio: ServicoRelatorio;
  sessaoAtual: Sessao | null = null;

  private repositorio!: RepositorioArquivo;
  private rl!: readline.Interface;


  private filaLinhas: string[] = [];
  private resolvers: ((v: string) => void)[] = [];
  private entradaEncerrada = false;

  private iniciarLeituraDeLinhas(): void {
    (async () => {
      for await (const linha of this.rl) {
        if (this.resolvers.length > 0) this.resolvers.shift()!(linha);
        else this.filaLinhas.push(linha);
      }
      this.entradaEncerrada = true;
      while (this.resolvers.length > 0) this.resolvers.shift()!("sair");
    })();
  }

  private lerLinha(prompt: string): Promise<string> {
    process.stdout.write(prompt);
    if (this.filaLinhas.length > 0) return Promise.resolve(this.filaLinhas.shift()!);
    if (this.entradaEncerrada) return Promise.resolve("sair");
    return new Promise((res) => this.resolvers.push(res));
  }

 
  private esquecerUltimaLinhaDoHistorico(): void {
    (this.rl as any).history?.shift();
  }

  constructor() {
    this.autenticacao = new ServicoAutenticacao();
    this.organizacao = {} as ServicoOrganizacao;
    this.lote = {} as ServicoLote;
    this.equipamento = {} as ServicoEquipamento;
    this.relatorio = {} as ServicoRelatorio;
  }

  async iniciarLoop(): Promise<void> {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

    this.rl = this.criarReadlineComHistorico();
    this.iniciarLeituraDeLinhas();

    const precisaProvisionar = !fs.existsSync(ARQUIVO_CONFIG);
    const { chaveHex, senhaAdminInicial } = precisaProvisionar
      ? await this.perguntarSenhaAdminInicial()
      : { chaveHex: await this.carregarConfiguracao(), senhaAdminInicial: null };

    const criptografia = new CriptografiaArquivo();
    this.repositorio = new RepositorioArquivo(DATA_DIR, criptografia, chaveHex);

    JournalTransacao.configurar({
      diretorio: DATA_DIR,
      criptografia,
      chave: chaveHex,
      repositorio: this.repositorio,
    });

    this.organizacao = new ServicoOrganizacao(this.repositorio, new ValidadorCNPJ());
    this.lote = new ServicoLote(this.repositorio);
    this.equipamento = new ServicoEquipamento(this.repositorio);
    this.relatorio = new ServicoRelatorio(this.repositorio);

    const configSalva = this.repositorio.listarEntidades("configuracao.dat");
    ConfiguracaoGlobal.carregarDeJSON(configSalva.length ? configSalva[0] : null);

    if (precisaProvisionar) {
      this.autenticacao.criarUsuario("admin", senhaAdminInicial!, PapelUsuario.ADMINISTRADOR);
      salvarCredenciais(this.repositorio, this.autenticacao.credenciais);
      console.log("Administrador 'admin' criado com sucesso.\n");
    } else {
      this.autenticacao.credenciais = carregarCredenciais(this.repositorio);
    }

    await this.fazerLogin();
    await this.loopDeComandos();
  }

  private async perguntarSenhaAdminInicial(): Promise<{ chaveHex: string; senhaAdminInicial: string }> {
    console.log("\n=== Provisionamento inicial do greencode ===");
    let senha = "";
    while (senha.length < 8 || !/[A-Za-z]/.test(senha) || !/\d/.test(senha)) {
      senha = await this.lerLinha("Defina a senha do administrador (mín. 8 caracteres, letras e números): ");
      this.esquecerUltimaLinhaDoHistorico();
      if (senha.length < 8 || !/[A-Za-z]/.test(senha) || !/\d/.test(senha)) {
        console.log("Senha fraca. Tente novamente.");
      }
    }

    const criptografia = new CriptografiaArquivo();
    const chaveHex = criptografia.gerarChave();
    fs.writeFileSync(ARQUIVO_CONFIG, JSON.stringify({ chaveHex }), { encoding: "utf8", mode: 0o600 });

    return { chaveHex, senhaAdminInicial: senha };
  }

  private async carregarConfiguracao(): Promise<string> {
    const conteudo = fs.readFileSync(ARQUIVO_CONFIG, "utf8");
    return JSON.parse(conteudo).chaveHex;
  }

  private criarReadlineComHistorico(): readline.Interface {
    const historico = fs.existsSync(ARQUIVO_HISTORICO)
      ? fs.readFileSync(ARQUIVO_HISTORICO, "utf8").split("\n").filter(Boolean)
      : [];

    const completer = (linha: string): [string[], string] => {
      const compativeis = COMANDOS_CONHECIDOS.filter((c) => c.startsWith(linha));
      return [compativeis.length ? compativeis : COMANDOS_CONHECIDOS, linha];
    };

    return readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      completer,
      history: historico,
    });
  }

  private salvarLinhaNoHistorico(linha: string): void {
    if (!linha.trim()) return;
    const redigida = linha.replace(/(--senha|--antiga|--nova)(\s+)(\S+)/gi, "$1$2[OCULTO]");
    fs.appendFileSync(ARQUIVO_HISTORICO, redigida + "\n", "utf8");
  }

  private async fazerLogin(): Promise<void> {
    while (!this.sessaoAtual) {
      if (this.entradaEncerrada) return;
      const usuario = await this.lerLinha("Login: ");
      const senha = await this.lerLinha("Senha: ");
      this.esquecerUltimaLinhaDoHistorico();

      try {
        this.sessaoAtual = this.autenticacao.login(usuario, senha);
        salvarCredenciais(this.repositorio, this.autenticacao.credenciais); 
        JournalTransacao.definirUsuarioAtual(this.sessaoAtual.usuario);
        console.log(`\n[OK] Bem-vindo(a), ${this.sessaoAtual.usuario} [${this.sessaoAtual.papel}]\n`);
      } catch (erro: any) {
        console.log(`[ERRO] ${erro.message}\n`);
      }
    }
  }

  exibirMenuPorPapel(papel: PapelUsuario): void {
    const opcoes = Object.entries(PERMISSOES)
      .filter(([, papeis]) => papeis.includes(papel))
      .map(([comando]) => comando);

    console.log("Opções disponíveis:");
    [...opcoes, "ajuda", "sair"].forEach((opcao) => console.log(`  - ${opcao}`));
  }

  private async loopDeComandos(): Promise<void> {
    while (this.sessaoAtual) {
      if (!this.sessaoAtual.isValida()) {
        console.log("\n[AVISO] Sessão expirada por inatividade (30 min). Faça login novamente.\n");
        JournalTransacao.definirUsuarioAtual(null);
        this.sessaoAtual = null;
        await this.fazerLogin();
        continue;
      }
      if (this.entradaEncerrada) break;

      this.exibirMenuPorPapel(this.sessaoAtual.papel);
      const entrada = await this.lerLinha("\n> ");
      if (/--senha|--antiga|--nova/i.test(entrada)) this.esquecerUltimaLinhaDoHistorico();
      this.salvarLinhaNoHistorico(entrada);

      if (entrada.trim() === "sair") {
        this.autenticacao.logout(this.sessaoAtual.token);
        JournalTransacao.definirUsuarioAtual(null);
        this.sessaoAtual = null;
        break;
      }

      if (entrada.trim() === "ajuda") {
        this.exibirAjuda();
        continue;
      }

      const valido = this.autenticacao.validarToken(this.sessaoAtual.token);
      if (!valido) continue; 

      this.processarComando(entrada);
    }

    this.rl.close();
    console.log("\nSessão encerrada. Até logo.");
  }

  private exibirAjuda(): void {
    console.log("\nExemplos de uso:");
    console.log('  organizacao cadastrar --razaoSocial "ACME LTDA" --cnpj 11222333000181 --inscricao 123 --endereco "Rua X, 1" --telefone 1140000000 --email contato@acme.com --contratoVencimento 2027-01-01 --contratoValor 5000');
    console.log("  lote criar --org BR001 --nf 12345 --transp TransRapida");
    console.log("  lote equipamento --lote LT00001 --tipo NOTEBOOK --marca Dell --modelo Latitude --ano 2021 --estado BOM_ESTADO --peso 2.3");
    console.log("  lote triagem --lote LT00001   (chame duas vezes: RECEBIDO->EM_TRIAGEM, depois EM_TRIAGEM->TRIAGEM_CONCLUIDA)");
    console.log("  equipamento movimentar --id EQ000001 --status AGUARDANDO_DESMONTE");
    console.log("  equipamento estado --id EQ000001 --estado DANIFICADO_GRAVE --justificativa \"queda no transporte\"");
    console.log("  relatorio organizacao --org BR001 --inicio 2026-01-01 --fim 2026-12-31\n");
  }

  processarComando(entrada: string): void {
    const papel = this.sessaoAtual?.papel;
    const partes = entrada.trim().split(/\s+/);
    const [acao, sub, ...resto] = partes;
    const comando = `${acao ?? ""} ${sub ?? ""}`.trim();
    const flags = this.parsearFlags(resto);

    try {
      this.exigirPapel(comando, papel);

      switch (comando) {
        case "usuario criar": {
          const cred = this.autenticacao.criarUsuario(flags.login, flags.senha, flags.papel as PapelUsuario);
          salvarCredenciais(this.repositorio, this.autenticacao.credenciais);
          console.log(`[OK] Usuário ${cred.usuario} criado com papel ${cred.papel}.`);
          break;
        }
        case "usuario remover": {
          const removeu = this.autenticacao.removerUsuario(flags.login);
          salvarCredenciais(this.repositorio, this.autenticacao.credenciais);
          console.log(removeu ? `[OK] Usuário ${flags.login} removido.` : `[ERRO] Usuário ${flags.login} não encontrado.`);
          break;
        }
        case "usuario listar": {
          const usuarios = this.autenticacao.listarUsuarios();
          console.log(`Total: ${usuarios.length}`);
          usuarios.forEach((u) => console.log(`  ${u.usuario} | ${u.papel} | último acesso: ${u.ultimoAcesso.toLocaleString()}`));
          break;
        }
        case "usuario papel": {
          const ok = this.autenticacao.editarPapelUsuario(flags.login, flags.papel as PapelUsuario);
          salvarCredenciais(this.repositorio, this.autenticacao.credenciais);
          console.log(ok ? `[OK] Papel de ${flags.login} alterado para ${flags.papel}.` : `[ERRO] Usuário ${flags.login} não encontrado.`);
          break;
        }

        case "config aliquota": {
          ConfiguracaoGlobal.definirAliquotaImposto(Number(flags.valor));
          this.repositorio.salvarEntidade("configuracao.dat", [ConfiguracaoGlobal.toJSON()]);
          console.log(`[OK] Alíquota de imposto definida para ${(Number(flags.valor) * 100).toFixed(2)}%.`);
          break;
        }
        case "config depreciacao": {
          const tipo = flags.tipo as TipoEquipamento;
          if (!Object.values(TipoEquipamento).includes(tipo)) throw new Error("Tipo de equipamento inválido.");
          ConfiguracaoGlobal.definirCoeficienteDepreciacao(tipo, Number(flags.valor));
          this.repositorio.salvarEntidade("configuracao.dat", [ConfiguracaoGlobal.toJSON()]);
          console.log(`[OK] Coeficiente de depreciação de ${tipo} definido para ${(Number(flags.valor) * 100).toFixed(2)}%/ano.`);
          break;
        }

        case "senha alterar": {
          const ok = this.autenticacao.alterarSenha(this.sessaoAtual!.usuario, flags.antiga, flags.nova);
          if (ok) salvarCredenciais(this.repositorio, this.autenticacao.credenciais);
          console.log(ok ? "[OK] Senha alterada." : "[ERRO] Senha antiga incorreta.");
          break;
        }

        case "organizacao cadastrar": {
          const dados: any = {
            razaoSocial: flags.razaoSocial,
            cnpj: flags.cnpj,
            inscricaoEstadual: flags.inscricao ?? flags.inscricaoEstadual,
            enderecoCompleto: flags.endereco ?? flags.enderecoCompleto,
            telefone: flags.telefone,
            email: flags.email,
          };
          if (flags.contratoVencimento && flags.contratoValor) {
            dados.contrato = { dataVencimento: flags.contratoVencimento, valorMensal: flags.contratoValor };
          }
          const org = this.organizacao.cadastrarOrganizacao(dados);
          console.log(`[OK] Organização ${org.razaoSocial} cadastrada (id: ${org.id}).`);
          break;
        }
        case "organizacao buscar": {
          const org = this.organizacao.buscarOrganizacao(flags.id);
          console.log(`${org.id} | ${org.razaoSocial} | CNPJ ${org.cnpj} | ativo: ${org.ativo}`);
          break;
        }
        case "organizacao listar": {
          const ativas = this.organizacao.listarOrganizacoesAtivas();
          console.log(`Total ativas: ${ativas.length}`);
          ativas.forEach((o) => console.log(`  ${o.id} | ${o.razaoSocial} | ${o.cnpj}`));
          break;
        }
        case "organizacao renovar": {
          this.organizacao.renovarContrato(flags.id, new Date(flags.vencimento));
          console.log(`[OK] Contrato da organização ${flags.id} renovado até ${flags.vencimento}.`);
          break;
        }

        case "lote criar": {
          const novoLote = this.lote.criarLote({
            organizacaoId: flags.org,
            notaFiscal: flags.nf,
            transportadora: flags.transp,
            dataEntrada: flags.data ? new Date(flags.data) : new Date(),
          });
          console.log(`[OK] Lote criado (id: ${novoLote.id}).`);
          break;
        }
        case "lote equipamento": {
          const equip = new Equipamento(
            "",
            flags.tipo as TipoEquipamento,
            flags.marca,
            flags.modelo,
            Number(flags.ano),
            flags.estado as EstadoFisico,
            Number(flags.peso)
          );
          this.lote.adicionarEquipamentoLote(flags.lote, equip);
          console.log(`[OK] Equipamento ${equip.id} adicionado ao lote ${flags.lote}.`);
          break;
        }
        case "lote triagem": {
          this.lote.processarTriagem(flags.lote);
          console.log(`[OK] Triagem do lote ${flags.lote} avançou um passo. Rode o comando de novo se necessário.`);
          break;
        }
        case "lote consultar": {
          const lotes = this.lote.consultarLotePorPeriodo(new Date(flags.inicio), new Date(flags.fim));
          console.log(`Total: ${lotes.length}`);
          lotes.forEach((l) => console.log(`  ${l.id} | ${l.dataEntrada.toLocaleDateString()} | ${l.statusProcessamento} | ${l.equipamentos.length} equip.`));
          break;
        }
        case "lote relatorio": {
          const todos = this.lote.consultarLotePorPeriodo(new Date(0), new Date(Date.now() + 315360000000));
          const alvo = todos.find((l) => l.id === flags.lote);
          if (!alvo) throw new Error(`Lote ${flags.lote} não encontrado.`);
          console.log(alvo.gerarRelatorioTriagem());
          break;
        }
        case "equipamento estado": {
          this.equipamento.atualizarEstadoFisico(flags.id, flags.estado as EstadoFisico, flags.justificativa);
          console.log(`[OK] Estado físico de ${flags.id} atualizado para ${flags.estado}.`);
          break;
        }
        case "equipamento movimentar": {
          this.equipamento.movimentarEquipamento(flags.id, flags.status as StatusRastreamento, flags.justificativa ?? "");
          console.log(`[OK] Equipamento ${flags.id} movimentado para ${flags.status}.`);
          break;
        }
        case "equipamento rastrear": {
          const historico = this.equipamento.rastrearEquipamento(flags.id);
          const e = historico.equipamento;
          console.log(`${e.id} | ${e.codigoBarrasInterno || "(sem código)"} | ${e.tipo} ${e.marca} ${e.modelo}`);
          console.log(`Estado: ${e.estadoFisico} | Status: ${e.statusRastreamento} | Lote: ${e.loteId}`);
          console.log("Movimentações:");
          historico.movimentacoes.forEach((m) =>
            console.log(`  ${new Date(m.dataHora).toLocaleString()} | ${m.origem} -> ${m.destino} | por ${m.responsavel}${m.observacao ? " | " + m.observacao : ""}`)
          );
          break;
        }

        case "relatorio organizacao": {
          console.log(
            this.relatorio.gerarRelatorioPorOrganizacao(flags.org, { inicio: new Date(flags.inicio), fim: new Date(flags.fim) })
          );
          break;
        }
        case "relatorio status": {
          console.log(this.relatorio.gerarRelatorioPorStatus(flags.status as StatusRastreamento));
          break;
        }
        case "relatorio financeiro": {
          console.log(this.relatorio.gerarRelatorioFinanceiro({ inicio: new Date(flags.inicio), fim: new Date(flags.fim) }));
          break;
        }

        case "":
          break;

        default:
          console.log(`Comando não reconhecido: "${entrada}". Digite "ajuda" para ver exemplos.`);
      }

      this.sessaoAtual!.renovar(); // 30 min de INATIVIDADE: só renova após comando aceito e executado
    } catch (erro: any) {
      console.log(`[ERRO] ${erro.message}`);
    }
  }

  private exigirPapel(comando: string, papelAtual: PapelUsuario | undefined): void {
    const permitidos = PERMISSOES[comando];
    if (!permitidos) return; // comando desconhecido: deixa o switch tratar/relatar
    if (!papelAtual || !permitidos.includes(papelAtual)) {
      throw new Error(`Ação restrita ao(s) papel(is): ${permitidos.join(", ")}.`);
    }
  }

  private parsearFlags(args: string[]): Record<string, string> {
    const flags: Record<string, string> = {};
    for (let i = 0; i < args.length; i++) {
      if (args[i].startsWith("--")) {
        const chave = args[i].slice(2);
        let valor = args[i + 1] ?? "";
        i++;
        if (valor.startsWith('"') && !valor.endsWith('"')) {
          while (i + 1 < args.length && !valor.endsWith('"')) {
            i++;
            valor += " " + args[i];
          }
        }
        flags[chave] = valor.replace(/^"|"$/g, "");
      }
    }
    return flags;
  }
}
