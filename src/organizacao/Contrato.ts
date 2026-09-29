export class Contrato {
  id: string;
  organizacaoId: string;
  dataAssinatura: Date;
  dataVencimento: Date;
  clausulas: string[];
  valorMensal: number;
  renovacaoAutomatica: boolean;

  constructor(
    id: string = "",
    organizacaoId: string = "",
    dataAssinatura: Date = new Date(),
    dataVencimento: Date = new Date(),
    clausulas: string[] = [],
    valorMensal: number = 0,
    renovacaoAutomatica: boolean = false
  ) {
    this.id = id;
    this.organizacaoId = organizacaoId;
    this.dataAssinatura = dataAssinatura;
    this.dataVencimento = dataVencimento;
    this.clausulas = clausulas;
    this.valorMensal = valorMensal;
    this.renovacaoAutomatica = renovacaoAutomatica;
  }

  estaVigente(): boolean {
    return new Date() < this.dataVencimento;
  }

  renovar(novoVencimento: Date): void {
    if (isNaN(novoVencimento.getTime()) || novoVencimento <= this.dataVencimento) {
      throw new Error("O novo vencimento deve ser posterior ao vencimento atual.");
    }
    this.dataVencimento = novoVencimento;
  }

  static fromJSON(o: any): Contrato {
    return new Contrato(
      o.id,
      o.organizacaoId,
      new Date(o.dataAssinatura),
      new Date(o.dataVencimento),
      o.clausulas ?? [],
      o.valorMensal ?? 0,
      !!o.renovacaoAutomatica
    );
  }
}
