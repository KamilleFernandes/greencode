import { RepositorioArquivo } from "../persistencia/RepositorioArquivo";
import { Equipamento, carregarEquipamentos } from "../equipamento/Equipamento";
import { StatusLote } from "./StatusLote";

export const ARQUIVO_LOTES = "lotes.dat";

export class Lote {
  id: string;
  dataEntrada: Date;
  organizacaoId: string;
  notaFiscal: string;
  transportadora: string;
  equipamentos: Equipamento[];
  statusProcessamento: StatusLote;
  observacoes: string;

  constructor(
    id: string = "",
    dataEntrada: Date = new Date(),
    organizacaoId: string = "",
    notaFiscal: string = "",
    transportadora: string = "",
    observacoes: string = ""
  ) {
    this.id = id;
    this.dataEntrada = dataEntrada;
    this.organizacaoId = organizacaoId;
    this.notaFiscal = notaFiscal;
    this.transportadora = transportadora;
    this.equipamentos = [];
    this.statusProcessamento = StatusLote.RECEBIDO;
    this.observacoes = observacoes;
  }

  adicionarEquipamento(equip: Equipamento): void {
    if (this.statusProcessamento !== StatusLote.RECEBIDO) {
      throw new Error("Só é possível adicionar equipamentos a lotes com status RECEBIDO.");
    }
    if (this.equipamentos.some((e) => e.id === equip.id)) {
      throw new Error(`Equipamento ${equip.id} já está no lote.`);
    }
    equip.loteId = this.id;
    equip.posicaoNoLote = this.equipamentos.length + 1;
    this.equipamentos.push(equip);
  }

  removerEquipamento(equipId: string): boolean {
    if (this.statusProcessamento !== StatusLote.RECEBIDO) {
      throw new Error("Só é possível remover equipamentos de lotes com status RECEBIDO.");
    }
    const tamanhoAntes = this.equipamentos.length;
    this.equipamentos = this.equipamentos.filter((e) => e.id !== equipId);
    this.equipamentos.forEach((e, i) => (e.posicaoNoLote = i + 1));
    return this.equipamentos.length < tamanhoAntes;
  }

  calcularPesoTotal(): number {
    return this.equipamentos.reduce((soma, e) => soma + e.pesoQuilogramas, 0);
  }

  gerarRelatorioTriagem(): string {
    const linhas = this.equipamentos.map(
      (e) => `${e.codigoBarrasInterno || "(sem código)"} — ${e.tipo} — ${e.statusRastreamento}`
    );
    return [`Lote ${this.id} (NF ${this.notaFiscal}) — status: ${this.statusProcessamento}`, ...linhas].join("\n");
  }

  static fromJSON(o: any, equipamentos: Equipamento[]): Lote {
    const l = new Lote(o.id, new Date(o.dataEntrada), o.organizacaoId, o.notaFiscal, o.transportadora, o.observacoes);
    l.statusProcessamento = o.statusProcessamento ?? StatusLote.RECEBIDO;
    l.equipamentos = equipamentos.filter((e) => e.loteId === l.id).sort((a, b) => a.posicaoNoLote - b.posicaoNoLote);
    return l;
  }
}

// lotes.dat guarda o lote SEM a lista de equipamentos, para não duplicar dados:
// os equipamentos vivem só em equipamentos.dat e são religados aqui pelo loteId.
export function carregarLotes(
  repositorio: RepositorioArquivo,
  equipamentos: Equipamento[] = carregarEquipamentos(repositorio)
): Lote[] {
  return repositorio.listarEntidades(ARQUIVO_LOTES).map((o: any) => Lote.fromJSON(o, equipamentos));
}

export function salvarLotes(repositorio: RepositorioArquivo, lotes: Lote[]): void {
  repositorio.salvarEntidade(
    ARQUIVO_LOTES,
    lotes.map((l) => ({ ...l, equipamentos: undefined }))
  );
}
