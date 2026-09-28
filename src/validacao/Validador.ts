export abstract class Validador {
  protected mensagemErro: string = "";

  abstract validar(objeto: any): boolean;

  obterMensagemErro(): string {
    return this.mensagemErro;
  }
}