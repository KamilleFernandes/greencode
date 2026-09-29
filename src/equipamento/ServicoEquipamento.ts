import { RepositorioArquivo } from "../persistencia/RepositorioArquivo";
import { Equipamento, carregarEquipamentos, salvarEquipamentos } from "./Equipamento";
import { EstadoFisico } from "./EstadoFisico";
import { StatusRastreamento } from "./StatusRastreamento";
import { TipoEquipamento } from "./TipoEquipamento";
import { JournalTransacao } from "../auditoria/JournalTransacao";
import { carregarLotes, salvarLotes } from "../lote/Lote";
import { StatusLote } from "../lote/StatusLote";

export interface HistoricoCompleto {
  equipamento: Equipamento;
  movimentacoes: Equipamento["historicoMovimentacao"];
}

const ORDEM_ESTADOS: EstadoFisico[] = [
  EstadoFisico.NOVO,
  EstadoFisico.BOM_ESTADO,
  EstadoFisico.USADO_LEVE,
  EstadoFisico.USADO_MODERADO,
  EstadoFisico.DANIFICADO_LEVE,
  EstadoFisico.DANIFICADO_GRAVE,
  EstadoFisico.INSERVIVEL,
];

const LIMITE_QUEDA_SEM_JUSTIFICATIVA = 2;

export class ServicoEquipamento {
  repositorio: RepositorioArquivo;

  constructor(repositorio: RepositorioArquivo) {
    this.repositorio = repositorio;
  }

  // aceita o id (ex.: EQ000001) ou o código de barras
  rastrearEquipamento(id: string): HistoricoCompleto {
    const equipamentos = carregarEquipamentos(this.repositorio);
    const equipamento = equipamentos.find((e) => e.id === id || (e.codigoBarrasInterno && e.codigoBarrasInterno === id));
    if (!equipamento) {
      throw new Error(`Equipamento ${id} não encontrado.`);
    }
    return {
      equipamento,
      movimentacoes: equipamento.historicoMovimentacao,
    };
  }

  atualizarEstadoFisico(id: string, novoEstado: EstadoFisico, justificativa?: string): void {
    const equipamentos = carregarEquipamentos(this.repositorio);
    const equipamento = equipamentos.find((e) => e.id === id);
    if (!equipamento) {
      throw new Error(`Equipamento ${id} não encontrado.`);
    }
    if (!Object.values(EstadoFisico).includes(novoEstado)) {
      throw new Error(`Estado físico inválido: ${novoEstado}.`);
    }
    if (novoEstado === equipamento.estadoFisico) {
      throw new Error("O equipamento já está nesse estado físico.");
    }

    const indiceAntigo = ORDEM_ESTADOS.indexOf(equipamento.estadoFisico);
    const indiceNovo = ORDEM_ESTADOS.indexOf(novoEstado);
    const quedaCategorias = indiceNovo - indiceAntigo;

    if (quedaCategorias >= LIMITE_QUEDA_SEM_JUSTIFICATIVA && !(justificativa ?? "").trim()) {
      throw new Error(
        `Justificativa obrigatória: estado caiu ${quedaCategorias} categorias (de ${equipamento.estadoFisico} para ${novoEstado}).`
      );
    }

    const estadoAntes = equipamento.estadoFisico;
    equipamento.estadoFisico = novoEstado;

    const operacao = justificativa?.trim() ? `ATUALIZAR_ESTADO_FISICO | ${justificativa.trim()}` : "ATUALIZAR_ESTADO_FISICO";
    new JournalTransacao(operacao, "Equipamento", { id, estadoFisico: estadoAntes }, { id, estadoFisico: novoEstado }).registrar();

    salvarEquipamentos(this.repositorio, equipamentos);
  }

  // gera a string do código; quem grava no equipamento é ServicoLote.processarTriagem
  gerarCodigoBarras(tipo: TipoEquipamento, sequencia: number): string {
    if (!Number.isInteger(sequencia) || sequencia < 1) {
      throw new Error("Sequência do código de barras deve ser um inteiro positivo.");
    }
    const prefixo = tipo.substring(0, 3).toUpperCase();
    const sequenciaFormatada = String(sequencia).padStart(6, "0");
    return `${prefixo}-${sequenciaFormatada}`;
  }

  // ===== EXTRA (fora do UML): necessário para o enunciado — sem isso, nada    =====
  // ===== move um equipamento além de EM_TRIAGEM (desmonte, reaproveitamento, =====
  // ===== reciclagem, descarte, baixa definitiva) e a rastreabilidade fica incompleta =====
  movimentarEquipamento(id: string, novoStatus: StatusRastreamento, justificativa: string = ""): void {
    if (!Object.values(StatusRastreamento).includes(novoStatus)) {
      throw new Error(`Status inválido: ${novoStatus}.`);
    }
    const equipamentos = carregarEquipamentos(this.repositorio);
    const equipamento = equipamentos.find((e) => e.id === id);
    if (!equipamento) throw new Error(`Equipamento ${id} não encontrado.`);

    const lotes = carregarLotes(this.repositorio, equipamentos);
    const lote = lotes.find((l) => l.id === equipamento.loteId);
    if (!lote) throw new Error(`Lote ${equipamento.loteId} do equipamento não encontrado.`);
    if (![StatusLote.TRIAGEM_CONCLUIDA, StatusLote.ENCAMINHADO].includes(lote.statusProcessamento)) {
      throw new Error("Movimentações só são permitidas após a conclusão da triagem do lote.");
    }

    const antesEq = JSON.parse(JSON.stringify(equipamento));
    equipamento.registrarMovimentacao(String(novoStatus), JournalTransacao.obterUsuarioAtual());
    equipamento.atualizarStatus(novoStatus, justificativa); // lança erro se a transição for inválida

    const statusLoteAntes = lote.statusProcessamento;
    if (lote.equipamentos.every((e) => e.statusRastreamento === StatusRastreamento.BAIXA_DEFINITIVA)) {
      lote.statusProcessamento = StatusLote.FINALIZADO;
    } else if (
      lote.statusProcessamento === StatusLote.TRIAGEM_CONCLUIDA &&
      lote.equipamentos.some((e) => e.statusRastreamento !== StatusRastreamento.EM_TRIAGEM)
    ) {
      lote.statusProcessamento = StatusLote.ENCAMINHADO;
    }

    new JournalTransacao("MUDAR_STATUS", "Equipamento", antesEq, JSON.parse(JSON.stringify(equipamento))).registrar();
    salvarEquipamentos(this.repositorio, equipamentos);

    if (lote.statusProcessamento !== statusLoteAntes) {
      new JournalTransacao(
        "MUDAR_STATUS_LOTE",
        "Lote",
        { id: lote.id, statusProcessamento: statusLoteAntes },
        { id: lote.id, statusProcessamento: lote.statusProcessamento }
      ).registrar();
      salvarLotes(this.repositorio, lotes);
    }
  }
}
