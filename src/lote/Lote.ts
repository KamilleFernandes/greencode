import { RepositorioArquivo } from "../persistencia/RepositorioArquivo";
import { Equipamento } from "../equipamento/Equipamento";
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
  equipamentos: Equipamento[] = [],
  statusProcessamento: StatusLote = StatusLote.RECEBIDO,
  observacoes: string = ""
) {
  this.id = id;
  this.dataEntrada = dataEntrada;
  this.organizacaoId = organizacaoId;
  this.notaFiscal = notaFiscal;
  this.transportadora = transportadora;
  this.equipamentos = equipamentos;
  this.statusProcessamento = statusProcessamento;
  this.observacoes = observacoes;
}

  adicionarEquipamento(equip: Equipamento): void {
    this.equipamentos.push(equip);
  }

  removerEquipamento(equipId: string): boolean {
    const tamanhoAntes = this.equipamentos.length;
    this.equipamentos = this.equipamentos.filter((e) => e.id !== equipId);
    return this.equipamentos.length < tamanhoAntes;
  }

  calcularPesoTotal(): number {
    return this.equipamentos.reduce((soma, e) => soma + e.pesoQuilogramas, 0);
  }

  gerarRelatorioTriagem(): string {
    const linhas = this.equipamentos.map(
      (e) => `${e.codigoBarrasInterno} — ${e.tipo} — ${e.statusRastreamento}`
    );
    return [`Lote ${this.id} (NF ${this.notaFiscal})`, ...linhas].join("\n");
  }
}

export function carregarLotes(repositorio: RepositorioArquivo): Lote[] {
  return repositorio.listarEntidades(ARQUIVO_LOTES);
}

export function salvarLotes(repositorio: RepositorioArquivo, lotes: Lote[]): void {
  repositorio.salvarEntidade(ARQUIVO_LOTES, lotes);
}