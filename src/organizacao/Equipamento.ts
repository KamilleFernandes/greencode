import { RepositorioArquivo } from "../persistencia/RepositorioArquivo";
import { TipoEquipamento } from "./TipoEquipamento";
import { EstadoFisico } from "./EstadoFisico";
import { StatusRastreamento } from "./StatusRastreamento";
import { Movimentacao } from "./Movimentacao";

const COEFICIENTE_DEPRECIACAO = 0.2; // fração ao ano; futuramente configurável pelo administrador
export const ARQUIVO_EQUIPAMENTOS = "equipamentos.dat";
export const ARQUIVO_MOVIMENTACOES = "movimentacoes.dat";

const S = StatusRastreamento;
const TRANSICOES: Record<StatusRastreamento, StatusRastreamento[]> = {
  [S.AGUARDANDO_TRIAGEM]: [S.EM_TRIAGEM],
  [S.EM_TRIAGEM]: [S.AGUARDANDO_DESMONTE, S.DESCARTE_SEGURO],
  [S.AGUARDANDO_DESMONTE]: [S.EM_DESMONTE],
  [S.EM_DESMONTE]: [S.PECAS_REAPROVEITADAS, S.MATERIAL_RECICLAVEL, S.DESCARTE_SEGURO],
  [S.PECAS_REAPROVEITADAS]: [S.BAIXA_DEFINITIVA],
  [S.MATERIAL_RECICLAVEL]: [S.BAIXA_DEFINITIVA],
  [S.DESCARTE_SEGURO]: [S.BAIXA_DEFINITIVA],
  [S.BAIXA_DEFINITIVA]: [],
};

export class Equipamento {
  id: string;
  codigoBarrasInterno: string;
  tipo: TipoEquipamento;
  marca: string;
  modelo: string;
  anoFabricacao: number;
  estadoFisico: EstadoFisico;
  pesoQuilogramas: number;
  loteId: string;
  posicaoNoLote: number;
  statusRastreamento: StatusRastreamento = StatusRastreamento.AGUARDANDO_TRIAGEM;
  historicoMovimentacao: Movimentacao[] = [];

  // chame registrarMovimentacao() antes: a justificativa vai para a movimentação registrada
  atualizarStatus(novoStatus: StatusRastreamento, justificativa: string): void {
    if (!TRANSICOES[this.statusRastreamento].includes(novoStatus)) {
      const desmonte = novoStatus === S.AGUARDANDO_DESMONTE || novoStatus === S.EM_DESMONTE;
      throw new Error(
        desmonte
          ? "Desmonte só é permitido após a triagem completa do equipamento."
          : `Transição de status inválida: ${this.statusRastreamento} → ${novoStatus}.`
      );
    }
    const texto = (justificativa ?? "").trim();
    if (novoStatus === S.DESCARTE_SEGURO && this.statusRastreamento === S.EM_TRIAGEM && !texto) {
      throw new Error("Descarte direto após a triagem exige justificativa.");
    }
    this.statusRastreamento = novoStatus;

    if (texto) {
      const mov = [...this.historicoMovimentacao].reverse().find((m) => m.destino === String(novoStatus));
      if (mov) mov.observacao = texto;
    }
  }

  registrarMovimentacao(destino: string, responsavel: string): void {
    const ultimo = this.historicoMovimentacao[this.historicoMovimentacao.length - 1];
    const mov = new Movimentacao();
    mov.id = `${this.id}-M${this.historicoMovimentacao.length + 1}`;
    mov.equipamentoId = this.id;
    mov.dataHora = new Date();
    mov.origem = ultimo ? ultimo.destino : "ENTRADA_LOTE";
    mov.destino = destino;
    mov.responsavel = responsavel;
    mov.observacao = "";
    this.historicoMovimentacao.push(mov);
  }

  // fração depreciada (0 a 1) pela idade
  calcularDepreciacao(): number {
    const idade = Math.max(0, new Date().getFullYear() - this.anoFabricacao);
    return Math.min(1, idade * COEFICIENTE_DEPRECIACAO);
  }
}

// ---- persistência (funções de apoio, não são classes) ----
export function carregarEquipamentos(repo: RepositorioArquivo): Equipamento[] {
  const movs = repo.listarEntidades(ARQUIVO_MOVIMENTACOES).map((o: any) => {
    const m = Object.assign(new Movimentacao(), o);
    m.dataHora = new Date(o.dataHora);
    return m;
  });
  return repo.listarEntidades(ARQUIVO_EQUIPAMENTOS).map((o: any) => {
    const e = Object.assign(new Equipamento(), o);
    e.historicoMovimentacao = movs.filter((m) => m.equipamentoId === e.id);
    return e;
  });
}

// movimentações primeiro: se cair no meio, o journal já tem o registro
export function salvarEquipamentos(repo: RepositorioArquivo, lista: Equipamento[]): void {
  repo.salvarEntidade(ARQUIVO_MOVIMENTACOES, lista.flatMap((e) => e.historicoMovimentacao));
  repo.salvarEntidade(ARQUIVO_EQUIPAMENTOS, lista.map((e) => ({ ...e, historicoMovimentacao: [] })));
}