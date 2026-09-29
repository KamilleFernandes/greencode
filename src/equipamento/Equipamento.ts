import { RepositorioArquivo } from "../persistencia/RepositorioArquivo";
import { ConfiguracaoGlobal } from "../organizacao/ConfiguracaoGlobal";
import { TipoEquipamento } from "./TipoEquipamento";
import { EstadoFisico } from "./EstadoFisico";
import { StatusRastreamento } from "./StatusRastreamento";
import { Movimentacao } from "./Movimentacao";

export const ARQUIVO_EQUIPAMENTOS = "equipamentos.dat";

const S = StatusRastreamento;
// máquina de estados: garante que o desmonte só é alcançável depois da triagem
const TRANSICOES_PERMITIDAS: Record<StatusRastreamento, StatusRastreamento[]> = {
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
  statusRastreamento: StatusRastreamento;
  historicoMovimentacao: Movimentacao[];

  constructor(
    id: string = "",
    tipo: TipoEquipamento = TipoEquipamento.COMPUTADOR_MESA,
    marca: string = "",
    modelo: string = "",
    anoFabricacao: number = new Date().getFullYear(),
    estadoFisico: EstadoFisico = EstadoFisico.NOVO,
    pesoQuilogramas: number = 0
  ) {
    this.id = id;
    this.codigoBarrasInterno = "";
    this.tipo = tipo;
    this.marca = marca;
    this.modelo = modelo;
    this.anoFabricacao = anoFabricacao;
    this.estadoFisico = estadoFisico;
    this.pesoQuilogramas = pesoQuilogramas;
    this.loteId = "";
    this.posicaoNoLote = 0;
    this.statusRastreamento = StatusRastreamento.AGUARDANDO_TRIAGEM;
    this.historicoMovimentacao = [];
  }

  // Regra de negócio: só avança para status previstos na máquina de estados;
  // desmonte (AGUARDANDO_DESMONTE/EM_DESMONTE) só é alcançável a partir de EM_TRIAGEM,
  // ou seja, após a triagem estar completa.
  atualizarStatus(novoStatus: StatusRastreamento, justificativa: string = ""): void {
    const permitidas = TRANSICOES_PERMITIDAS[this.statusRastreamento] ?? [];
    if (!permitidas.includes(novoStatus)) {
      const indoParaDesmonte = novoStatus === S.AGUARDANDO_DESMONTE || novoStatus === S.EM_DESMONTE;
      throw new Error(
        indoParaDesmonte
          ? "Equipamento só pode ir para desmonte após a triagem completa."
          : `Transição de status inválida: ${this.statusRastreamento} → ${novoStatus}.`
      );
    }

    const texto = (justificativa ?? "").trim();
    if (novoStatus === S.DESCARTE_SEGURO && this.statusRastreamento === S.EM_TRIAGEM && !texto) {
      throw new Error("Descarte direto logo após a triagem exige justificativa.");
    }

    this.statusRastreamento = novoStatus;

    // grava a justificativa na movimentação correspondente (chame registrarMovimentacao antes)
    if (texto) {
      const ultima = this.historicoMovimentacao[this.historicoMovimentacao.length - 1];
      if (ultima && ultima.destino === String(novoStatus)) ultima.observacao = texto;
    }
  }

  registrarMovimentacao(destino: string, responsavel: string): void {
    const ultima = this.historicoMovimentacao[this.historicoMovimentacao.length - 1];
    const mov = new Movimentacao(
      `${this.id || "EQ"}-M${this.historicoMovimentacao.length + 1}`,
      this.id,
      new Date(),
      ultima ? ultima.destino : "ENTRADA_LOTE",
      destino,
      responsavel,
      ""
    );
    this.historicoMovimentacao.push(mov);
  }

  // fração depreciada (0 a 1), pela idade e pelo coeficiente do tipo (ConfiguracaoGlobal)
  calcularDepreciacao(): number {
    const idadeAnos = Math.max(0, new Date().getFullYear() - this.anoFabricacao);
    const coeficienteAnual = ConfiguracaoGlobal.obterCoeficienteDepreciacao(this.tipo);
    return Math.min(1, Math.max(0, coeficienteAnual * idadeAnos));
  }

  // reconstrói a instância (com métodos) a partir do objeto plano lido do disco
  static fromJSON(o: any): Equipamento {
    const e = new Equipamento(o.id, o.tipo, o.marca, o.modelo, o.anoFabricacao, o.estadoFisico, o.pesoQuilogramas);
    e.codigoBarrasInterno = o.codigoBarrasInterno ?? "";
    e.loteId = o.loteId ?? "";
    e.posicaoNoLote = o.posicaoNoLote ?? 0;
    e.statusRastreamento = o.statusRastreamento ?? StatusRastreamento.AGUARDANDO_TRIAGEM;
    e.historicoMovimentacao = (o.historicoMovimentacao ?? []).map((m: any) => Movimentacao.fromJSON(m));
    return e;
  }
}

export function carregarEquipamentos(repositorio: RepositorioArquivo): Equipamento[] {
  return repositorio.listarEntidades(ARQUIVO_EQUIPAMENTOS).map((o: any) => Equipamento.fromJSON(o));
}

export function salvarEquipamentos(repositorio: RepositorioArquivo, equipamentos: Equipamento[]): void {
  repositorio.salvarEntidade(ARQUIVO_EQUIPAMENTOS, equipamentos);
}
