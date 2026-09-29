import { RepositorioArquivo } from "../persistencia/RepositorioArquivo";
import { ValidadorDataEntrada } from "../validacao/ValidadorDataEntrada";
import { JournalTransacao } from "../auditoria/JournalTransacao";
import { Equipamento, carregarEquipamentos, salvarEquipamentos } from "../equipamento/Equipamento";
import { ServicoEquipamento } from "../equipamento/ServicoEquipamento";
import { StatusRastreamento } from "../equipamento/StatusRastreamento";
import { TipoEquipamento } from "../equipamento/TipoEquipamento";
import { EstadoFisico } from "../equipamento/EstadoFisico";
import { Lote, carregarLotes, salvarLotes } from "./Lote";
import { StatusLote } from "./StatusLote";

const ARQUIVO_ORGANIZACOES = "organizacoes.dat";

export class ServicoLote {
  repositorio: RepositorioArquivo;
  private servicoEquipamento: ServicoEquipamento; // apoio interno; não altera o UML

  constructor(repositorio: RepositorioArquivo) {
    this.repositorio = repositorio;
    this.servicoEquipamento = new ServicoEquipamento(repositorio);
  }

  // dados: { organizacaoId, notaFiscal, transportadora, dataEntrada?, observacoes? }
  criarLote(dados: any): Lote {
    const org = this.repositorio
      .listarEntidades(ARQUIVO_ORGANIZACOES)
      .find((o: any) => o.id === dados?.organizacaoId);
    if (!org) throw new Error(`Organização ${dados?.organizacaoId} não encontrada.`);
    if (!org.ativo) throw new Error(`Organização ${org.id} está inativa.`);

    for (const campo of ["notaFiscal", "transportadora"]) {
      if (!String(dados?.[campo] ?? "").trim()) throw new Error(`Campo obrigatório ausente: ${campo}.`);
    }

    const data = dados.dataEntrada ? new Date(dados.dataEntrada) : new Date();
    const validadorData = new ValidadorDataEntrada();
    if (!validadorData.validar(data)) {
      throw new Error(validadorData.obterMensagemErro());
    }

    const lotes = carregarLotes(this.repositorio);
    const lote = new Lote(
      this.proximoId("LT", lotes, 5),
      data,
      org.id,
      String(dados.notaFiscal).trim(),
      String(dados.transportadora).trim(),
      String(dados.observacoes ?? "")
    );

    new JournalTransacao("CRIAR_LOTE", "Lote", null, this.semEquipamentos(lote)).registrar();
    salvarLotes(this.repositorio, [...lotes, lote]);
    return lote;
  }

  adicionarEquipamentoLote(loteId: string, equipamento: Equipamento): void {
    const todos = carregarEquipamentos(this.repositorio);
    const lotes = carregarLotes(this.repositorio, todos);
    const lote = lotes.find((l) => l.id === loteId);
    if (!lote) throw new Error(`Lote ${loteId} não encontrado.`);
    this.validarEquipamento(equipamento);

    equipamento.id = this.proximoId("EQ", todos, 6);
    equipamento.codigoBarrasInterno = "";
    equipamento.statusRastreamento = StatusRastreamento.AGUARDANDO_TRIAGEM;
    equipamento.historicoMovimentacao = [];

    lote.adicionarEquipamento(equipamento); // define loteId e posicaoNoLote; só aceita lote RECEBIDO
    equipamento.registrarMovimentacao(String(StatusRastreamento.AGUARDANDO_TRIAGEM), JournalTransacao.obterUsuarioAtual());

    new JournalTransacao("ADICIONAR_EQUIPAMENTO", "Equipamento", null, JSON.parse(JSON.stringify(equipamento))).registrar();
    salvarEquipamentos(this.repositorio, [...todos, equipamento]);
  }

  // Avança um passo por chamada: RECEBIDO -> EM_TRIAGEM (aloca códigos de barras)
  // e depois EM_TRIAGEM -> TRIAGEM_CONCLUIDA (exige código em todos). É essa segunda
  // transição que representa "triagem completa" e libera o desmonte.
  processarTriagem(loteId: string): void {
    const todos = carregarEquipamentos(this.repositorio);
    const lotes = carregarLotes(this.repositorio, todos);
    const lote = lotes.find((l) => l.id === loteId);
    if (!lote) throw new Error(`Lote ${loteId} não encontrado.`);

    const antesLote = this.semEquipamentos(lote);
    const alteracoes: { antes: any; depois: Equipamento }[] = [];

    if (lote.statusProcessamento === StatusLote.RECEBIDO) {
      if (lote.equipamentos.length === 0) throw new Error("Lote sem equipamentos não pode entrar em triagem.");
      const usuario = JournalTransacao.obterUsuarioAtual();
      let sequencia = this.proximaSequenciaCodigoBarras(todos);
      for (const eq of lote.equipamentos) {
        const antes = JSON.parse(JSON.stringify(eq));
        if (!eq.codigoBarrasInterno) {
          eq.codigoBarrasInterno = this.servicoEquipamento.gerarCodigoBarras(eq.tipo, sequencia++);
        }
        eq.registrarMovimentacao(String(StatusRastreamento.EM_TRIAGEM), usuario);
        eq.atualizarStatus(StatusRastreamento.EM_TRIAGEM);
        alteracoes.push({ antes, depois: eq });
      }
      lote.statusProcessamento = StatusLote.EM_TRIAGEM;
    } else if (lote.statusProcessamento === StatusLote.EM_TRIAGEM) {
      const pendentes = lote.equipamentos.filter((e) => !e.codigoBarrasInterno).map((e) => e.id);
      if (pendentes.length > 0) {
        throw new Error(`Triagem incompleta: equipamentos sem código de barras: ${pendentes.join(", ")}.`);
      }
      lote.statusProcessamento = StatusLote.TRIAGEM_CONCLUIDA;
    } else {
      throw new Error(`Lote ${loteId} está em ${lote.statusProcessamento}: não há triagem a processar.`);
    }

    // journal ANTES de gravar
    for (const a of alteracoes) {
      new JournalTransacao("MUDAR_STATUS", "Equipamento", a.antes, JSON.parse(JSON.stringify(a.depois))).registrar();
    }
    new JournalTransacao("PROCESSAR_TRIAGEM", "Lote", antesLote, this.semEquipamentos(lote)).registrar();

    if (alteracoes.length > 0) salvarEquipamentos(this.repositorio, todos);
    salvarLotes(this.repositorio, lotes);
  }

  consultarLotePorPeriodo(dataInicio: Date, dataFim: Date): Lote[] {
    const ini = new Date(dataInicio);
    const fim = new Date(dataFim);
    if (isNaN(ini.getTime()) || isNaN(fim.getTime())) throw new Error("Período inválido.");
    ini.setHours(0, 0, 0, 0);
    fim.setHours(23, 59, 59, 999);
    if (ini > fim) throw new Error("Período inválido: início posterior ao fim.");

    return carregarLotes(this.repositorio).filter((l) => l.dataEntrada >= ini && l.dataEntrada <= fim);
  }

  // ---- apoio interno ----
  private semEquipamentos(lote: Lote): any {
    return JSON.parse(JSON.stringify({ ...lote, equipamentos: [] }));
  }

  private proximaSequenciaCodigoBarras(equipamentos: Equipamento[]): number {
    const maior = equipamentos
      .map((e) => parseInt(String(e.codigoBarrasInterno ?? "").split("-")[1] ?? "", 10))
      .filter((n) => !isNaN(n))
      .reduce((a, b) => Math.max(a, b), 0);
    return maior + 1;
  }

  private proximoId(prefixo: string, existentes: { id: string }[], largura: number): string {
    const maior = existentes
      .map((e) => parseInt(String(e.id).replace(/\D/g, ""), 10))
      .filter((n) => !isNaN(n))
      .reduce((a, b) => Math.max(a, b), 0);
    return `${prefixo}${String(maior + 1).padStart(largura, "0")}`;
  }

  private validarEquipamento(eq: Equipamento): void {
    if (!eq) throw new Error("Equipamento não informado.");
    if (!Object.values(TipoEquipamento).includes(eq.tipo)) throw new Error("Tipo de equipamento inválido.");
    if (!Object.values(EstadoFisico).includes(eq.estadoFisico)) throw new Error("Estado físico inválido.");
    for (const campo of ["marca", "modelo"] as const) {
      if (!String(eq[campo] ?? "").trim()) throw new Error(`Campo obrigatório ausente: ${campo}.`);
    }
    const ano = Number(eq.anoFabricacao);
    if (!Number.isInteger(ano) || ano < 1970 || ano > new Date().getFullYear()) {
      throw new Error("Ano de fabricação inválido.");
    }
    const peso = Number(eq.pesoQuilogramas);
    if (!Number.isFinite(peso) || peso <= 0) throw new Error("Peso deve ser maior que zero.");
  }
}
