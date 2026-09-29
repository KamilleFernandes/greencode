import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { CriptografiaArquivo } from "../persistencia/CriptografiaArquivo";
import { RepositorioArquivo } from "../persistencia/RepositorioArquivo";
import { JournalTransacao } from "../auditoria/JournalTransacao";
import {
  ServicoAutenticacao,
  carregarCredenciais,
  salvarCredenciais
} from "../seguranca/ServicoAutenticacao";
import { Sessao } from "../seguranca/Sessao";
import { PapelUsuario } from "../seguranca/PapelUsuario";
import { ServicoOrganizacao } from "../organizacao/ServicoOrganizacao";
import { ConfiguracaoGlobal } from "../organizacao/ConfiguracaoGlobal";
import { ServicoLote } from "../lote/ServicoLote";
import { ServicoEquipamento } from "../equipamento/ServicoEquipamento";
import { TipoEquipamento } from "../equipamento/TipoEquipamento";
import { StatusRastreamento } from "../equipamento/StatusRastreamento";
import { ServicoRelatorio } from "../relatorio/ServicoRelatorio";
import { ValidadorCNPJ } from "../validacao/ValidadorCNPJ";

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const ARQUIVO_CONFIG = path.join(DATA_DIR, "config.master");
const ARQUIVO_HISTORICO = path.join(DATA_DIR, ".cli_history");

const COMANDOS_CONHECIDOS = [
  "usuario criar",
  "usuario remover",
  "usuario listar",
  "config aliquota",
  "config depreciacao",
  "organizacao cadastrar",
  "organizacao listar",
  "lote criar",
  "lote triagem",
  "equipamento status",
  "equipamento rastrear",
  "relatorio organizacao",
  "relatorio status",
  "relatorio financeiro",
  "sair"
];

export class CLIInterface {
  autenticacao: ServicoAutenticacao;
  organizacao: ServicoOrganizacao;
  lote: ServicoLote;
  equipamento: ServicoEquipamento;
  relatorio: ServicoRelatorio;
  sessaoAtual: Sessao | null = null;

  private repositorio!: RepositorioArquivo;
  private rl!: readline.Interface;

  constructor() {
    this.autenticacao = new ServicoAutenticacao();
    this.organizacao = {} as ServicoOrganizacao;
    this.lote = {} as ServicoLote;
    this.equipamento = {} as ServicoEquipamento;
    this.relatorio = {} as ServicoRelatorio;
  }

  async iniciarLoop(): Promise<void> {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    const chaveHex = fs.existsSync(ARQUIVO_CONFIG)
      ? await this.carregarConfiguracao()
      : await this.provisionar();

    const criptografia = new CriptografiaArquivo();

    this.repositorio = new RepositorioArquivo(
      DATA_DIR,
      criptografia,
      chaveHex
    );

    JournalTransacao.configurar({
      diretorio: DATA_DIR,
      criptografia,
      chave: chaveHex,
      repositorio: this.repositorio
    });

    this.organizacao = new ServicoOrganizacao(
      this.repositorio,
      new ValidadorCNPJ()
    );

    this.lote = new ServicoLote(
      this.repositorio
    );

    this.equipamento = new ServicoEquipamento(
      this.repositorio
    );

    this.relatorio = new ServicoRelatorio(
      this.repositorio
    );

    this.autenticacao.credenciais =
      carregarCredenciais(this.repositorio);

    this.rl = this.criarReadlineComHistorico();

    await this.fazerLogin();
    await this.loopDeComandos();
  }

  private async provisionar(): Promise<string> {
    const rlProvisao = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const pergunta = (texto: string) =>
      new Promise<string>((resolve) =>
        rlProvisao.question(texto, resolve)
      );

    console.log(
      "\n=== Provisionamento inicial do greencode ==="
    );

    const senha = await pergunta(
      "Defina a senha do administrador: "
    );

    rlProvisao.close();

    const criptografia =
      new CriptografiaArquivo();

    const chaveHex =
      criptografia.gerarChave();

    fs.writeFileSync(
      ARQUIVO_CONFIG,
      JSON.stringify({ chaveHex }),
      "utf8"
    );

    const repositorioTemp =
      new RepositorioArquivo(
        DATA_DIR,
        criptografia,
        chaveHex
      );

    this.autenticacao.criarUsuario(
      "admin",
      senha,
      PapelUsuario.ADMINISTRADOR
    );

    salvarCredenciais(
      repositorioTemp,
      this.autenticacao.credenciais
    );

    console.log(
      "Administrador 'admin' criado com sucesso.\n"
    );

    return chaveHex;
  }

  private async carregarConfiguracao(): Promise<string> {
    const conteudo = fs.readFileSync(
      ARQUIVO_CONFIG,
      "utf8"
    );

    return JSON.parse(conteudo).chaveHex;
  }

  private criarReadlineComHistorico(): readline.Interface {
    const historico =
      fs.existsSync(ARQUIVO_HISTORICO)
        ? fs
            .readFileSync(
              ARQUIVO_HISTORICO,
              "utf8"
            )
            .split("\n")
            .filter(Boolean)
        : [];

    const completer = (
      linha: string
    ): [string[], string] => {
      const compativeis =
        COMANDOS_CONHECIDOS.filter(
          (comando) =>
            comando.startsWith(linha)
        );

      return [
        compativeis.length
          ? compativeis
          : COMANDOS_CONHECIDOS,
        linha
      ];
    };

    return readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      completer,
      history: historico
    });
  }

  private salvarLinhaNoHistorico(
    linha: string
  ): void {
    fs.appendFileSync(
      ARQUIVO_HISTORICO,
      linha + "\n",
      "utf8"
    );
  }

  private async fazerLogin(): Promise<void> {
    const pergunta = (texto: string) =>
      new Promise<string>((resolve) =>
        this.rl.question(texto, resolve)
      );

    while (!this.sessaoAtual) {
      const usuario =
        await pergunta("Login: ");

      const senha =
        await pergunta("Senha: ");

      try {
        this.sessaoAtual =
          this.autenticacao.login(
            usuario,
            senha
          );

        JournalTransacao
          .definirUsuarioAtual(
            this.sessaoAtual.usuario
          );

        console.log(
          `\nBem-vindo(a), ${usuario} [${this.sessaoAtual.papel}]\n`
        );
      } catch (erro: any) {
        console.log(
          `Erro: ${erro.message}\n`
        );
      }
    }
  }

  exibirMenuPorPapel(
    papel: PapelUsuario
  ): void {
    const opcoesPorPapel:
      Record<PapelUsuario, string[]> = {
        [PapelUsuario.ADMINISTRADOR]: [
          "usuario criar",
          "usuario remover",
          "usuario listar",
          "config aliquota",
          "config depreciacao",
          "sair"
        ],

        [PapelUsuario.OPERADOR_CADASTRO]: [
          "organizacao cadastrar",
          "organizacao listar",
          "sair"
        ],

        [PapelUsuario.GESTOR_ALMOXARIFADO]: [
          "lote criar",
          "lote triagem",
          "equipamento status",
          "equipamento rastrear",
          "sair"
        ],

        [PapelUsuario.AUDITOR]: [
          "equipamento rastrear",
          "relatorio organizacao",
          "relatorio status",
          "relatorio financeiro",
          "sair"
        ]
      };

    console.log(
      "Opções disponíveis:"
    );

    opcoesPorPapel[papel]
      .forEach((opcao) => {
        console.log(
          `  - ${opcao}`
        );
      });
  }

  private async loopDeComandos(): Promise<void> {
    const pergunta = (texto: string) =>
      new Promise<string>((resolve) =>
        this.rl.question(texto, resolve)
      );

    while (this.sessaoAtual) {
      if (!this.sessaoAtual.isValida()) {
        console.log(
          "\nSessão expirada por inatividade. Faça login novamente.\n"
        );

        JournalTransacao
          .definirUsuarioAtual(null);

        this.sessaoAtual = null;

        await this.fazerLogin();

        continue;
      }

      this.exibirMenuPorPapel(
        this.sessaoAtual.papel
      );

      const entrada =
        await pergunta("\n> ");

      if (
        !this.sessaoAtual ||
        !this.sessaoAtual.isValida()
      ) {
        console.log(
          "\nSessão expirada por inatividade. Faça login novamente.\n"
        );

        JournalTransacao
          .definirUsuarioAtual(null);

        this.sessaoAtual = null;

        await this.fazerLogin();

        continue;
      }

      this.salvarLinhaNoHistorico(
        entrada
      );

      this.sessaoAtual.renovar();

      if (
        entrada.trim() === "sair"
      ) {
        this.autenticacao.logout(
          this.sessaoAtual.token
        );

        JournalTransacao
          .definirUsuarioAtual(null);

        this.sessaoAtual = null;

        break;
      }

      this.processarComando(
        entrada
      );
    }

    this.rl.close();

    console.log(
      "\nSessão encerrada. Até logo."
    );
  }

  processarComando(
    entrada: string
  ): void {
    const papel =
      this.sessaoAtual?.papel;

    const partes =
      this.tokenizarEntrada(entrada);

    const [
      acao,
      subacao,
      ...args
    ] = partes;

    const comandoCompleto =
      `${acao ?? ""} ${subacao ?? ""}`.trim();

    const flags =
      this.parsearFlags(args);

    try {
      switch (comandoCompleto) {
        case "usuario criar":
          this.exigirPapel(
            papel,
            PapelUsuario.ADMINISTRADOR
          );

          this.autenticacao
            .criarUsuario(
              flags.login,
              flags.senha,
              flags.papel as PapelUsuario
            );

          salvarCredenciais(
            this.repositorio,
            this.autenticacao.credenciais
          );

          console.log(
            `[OK] Usuário ${flags.login} criado.`
          );

          break;

        case "usuario remover":
          this.exigirPapel(
            papel,
            PapelUsuario.ADMINISTRADOR
          );

          if (
            !this.autenticacao
              .removerUsuario(
                flags.login
              )
          ) {
            throw new Error(
              `Usuário ${flags.login} não encontrado.`
            );
          }

          salvarCredenciais(
            this.repositorio,
            this.autenticacao.credenciais
          );

          console.log(
            `[OK] Usuário ${flags.login} removido.`
          );

          break;

        case "usuario listar":
          this.exigirPapel(
            papel,
            PapelUsuario.ADMINISTRADOR
          );

          this.autenticacao
            .listarUsuarios()
            .forEach((usuario) => {
              console.log(
                `${usuario.usuario} - ${usuario.papel}`
              );
            });

          break;

        case "config aliquota":
          this.exigirPapel(
            papel,
            PapelUsuario.ADMINISTRADOR
          );

          ConfiguracaoGlobal
            .definirAliquotaImposto(
              Number(flags.valor)
            );

          console.log(
            `[OK] Alíquota configurada para ${flags.valor}.`
          );

          break;

        case "config depreciacao":
          this.exigirPapel(
            papel,
            PapelUsuario.ADMINISTRADOR
          );

          ConfiguracaoGlobal
            .definirCoeficienteDepreciacao(
              flags.tipo as TipoEquipamento,
              Number(flags.valor)
            );

          console.log(
            `[OK] Depreciação de ${flags.tipo} configurada para ${flags.valor}.`
          );

          break;

        case "organizacao cadastrar": {
          this.exigirPapel(
            papel,
            PapelUsuario.OPERADOR_CADASTRO
          );

          const org =
            this.organizacao
              .cadastrarOrganizacao(
                flags
              );

          console.log(
            `[OK] Organização ${org.razaoSocial} cadastrada (id: ${org.id}).`
          );

          break;
        }

        case "organizacao listar":
          this.exigirPapel(
            papel,
            PapelUsuario.OPERADOR_CADASTRO
          );

          this.organizacao
            .listarOrganizacoesAtivas()
            .forEach((orgAtiva) => {
              console.log(
                `${orgAtiva.id} - ${orgAtiva.razaoSocial} - ${orgAtiva.cnpj}`
              );
            });

          break;

        case "lote criar": {
          this.exigirPapel(
            papel,
            PapelUsuario.GESTOR_ALMOXARIFADO
          );

          const loteCriado =
            this.lote.criarLote({
              organizacaoId: flags.org,
              notaFiscal: flags.nf,
              transportadora:
                flags.transp,
              dataEntrada:
                new Date(),
              observacoes: ""
            });

          console.log(
            `[OK] Lote criado (id: ${loteCriado.id}).`
          );

          break;
        }

        case "lote triagem":
          this.exigirPapel(
            papel,
            PapelUsuario.GESTOR_ALMOXARIFADO
          );

          this.lote.processarTriagem(
            flags.id
          );

          console.log(
            `[OK] Triagem do lote ${flags.id} concluída.`
          );

          break;

        case "equipamento rastrear": {
          if (
            papel !==
              PapelUsuario.GESTOR_ALMOXARIFADO &&
            papel !==
              PapelUsuario.AUDITOR
          ) {
            throw new Error(
              "Ação restrita ao gestor de almoxarifado ou auditor."
            );
          }

          const historico =
            this.equipamento
              .rastrearEquipamento(
                flags.id
              );

          console.log(
            `Equipamento: ${historico.equipamento.id}`
          );

          console.log(
            `Status: ${historico.equipamento.statusRastreamento}`
          );

          console.log(
            "Movimentações:"
          );

          historico.movimentacoes
            .forEach(
              (movimentacao) => {
                console.log(
                  `  ${new Date(
                    movimentacao.dataHora
                  ).toLocaleString()} - ${movimentacao.origem} -> ${movimentacao.destino}`
                );
              }
            );

          break;
        }

        case "relatorio organizacao":
          this.exigirPapel(
            papel,
            PapelUsuario.AUDITOR
          );

          console.log(
            this.relatorio
              .gerarRelatorioPorOrganizacao(
                flags.org,
                {
                  inicio:
                    new Date(
                      flags.inicio
                    ),
                  fim:
                    new Date(
                      flags.fim
                    )
                }
              )
          );

          break;

        case "relatorio status": {
          this.exigirPapel(
            papel,
            PapelUsuario.AUDITOR
          );

          const status = flags.status as StatusRastreamento;
          console.log(this.relatorio.gerarRelatorioPorStatus(status));

          break;
        }

        case "relatorio financeiro":
          this.exigirPapel(
            papel,
            PapelUsuario.AUDITOR
          );

          console.log(
            this.relatorio
              .gerarRelatorioFinanceiro({
                inicio:
                  new Date(
                    flags.inicio
                  ),
                fim:
                  new Date(
                    flags.fim
                  )
              })
          );

          break;

        case "sair":
          break;

        default:
          console.log(
            `Comando não reconhecido ou não implementado: "${entrada}"`
          );
      }
    } catch (erro: any) {
      console.log(
        `[ERRO] ${erro.message}`
      );
    }
  }

  private exigirPapel(
    papelAtual:
      PapelUsuario | undefined,
    papelNecessario:
      PapelUsuario
  ): void {
    if (
      papelAtual !==
      papelNecessario
    ) {
      throw new Error(
        `Ação restrita ao papel ${papelNecessario}.`
      );
    }
  }

  private tokenizarEntrada(
    entrada: string
  ): string[] {
    const partes =
      entrada.match(
        /(?:[^\s"]+|"[^"]*")+/g
      ) ?? [];

    return partes.map(
      (parte) => {
        if (
          parte.startsWith('"') &&
          parte.endsWith('"')
        ) {
          return parte.slice(
            1,
            -1
          );
        }

        return parte;
      }
    );
  }

  private parsearFlags(
    args: string[]
  ): Record<string, string> {
    const flags:
      Record<string, string> = {};

    for (
      let i = 0;
      i < args.length;
      i++
    ) {
      if (
        args[i].startsWith("--")
      ) {
        flags[
          args[i].slice(2)
        ] = args[i + 1];

        i++;
      }
    }

    return flags;
  }
}