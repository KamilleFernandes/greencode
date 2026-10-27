export default class Movimentacao {
  id: string;
  equipamentoId: string;
  dataHora: Date;
  origem: string;
  destino: string;
  responsavel: string;
  observacao: string;

  constructor(
    id: string = "",
    equipamentoId: string = "",
    dataHora: Date = new Date(),
    origem: string = "",
    destino: string = "",
    responsavel: string = "",
    observacao: string = ""
  ) {
    this.id = id;
    this.equipamentoId = equipamentoId;
    this.dataHora = dataHora;
    this.origem = origem;
    this.destino = destino;
    this.responsavel = responsavel;
    this.observacao = observacao;
  }

  // reconstrói a instância após o JSON.parse (o disco só guarda dados, não métodos)
  static fromJSON(o: any): Movimentacao {
    return new Movimentacao(
      o.id,
      o.equipamentoId,
      new Date(o.dataHora),
      o.origem,
      o.destino,
      o.responsavel,
      o.observacao
    );
  }
}