export class Contrato {
  id: string
  organizacaoId: string
  dataAssinatura: Date
  dataVencimento: Date
  clausulas: string[]
  valorMensal: number
  renovacaoAutomatica: boolean

  estaVigente(): boolean {
    return new Date() < this.dataVencimento
  }

  renovar(novoVencimento: Date): void {
    if (isNaN(novoVencimento.getTime()) || novoVencimento <= this.dataVencimento) {
        throw new Error("O novo vencimento deve ser posterior ao vencimento atual.");
    }
    this.dataVencimento = novoVencimento;
  }
}