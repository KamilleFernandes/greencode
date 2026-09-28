import { Validador } from "./Validador";

export class ValidadorCNPJ extends Validador {
  validar(cnpj: string): boolean {
    const limpo = cnpj.replace(/[^\d]/g, "");

    if (limpo.length !== 14) {
      this.mensagemErro = "CNPJ deve conter 14 dígitos.";
      return false;
    }

    if (new Set(limpo).size === 1) {
      this.mensagemErro = "CNPJ inválido.";
      return false;
    }

    const digitos = limpo.split("").map(Number);
    const pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const pesos2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

    const soma1 = digitos.slice(0, 12).reduce((acc, num, i) => acc + num * pesos1[i], 0);
    const resto1 = soma1 % 11;
    const digito1 = resto1 < 2 ? 0 : 11 - resto1;

    if (digito1 !== digitos[12]) {
      this.mensagemErro = "CNPJ inválido: primeiro dígito verificador não confere.";
      return false;
    }

    const soma2 = digitos.slice(0, 13).reduce((acc, num, i) => acc + num * pesos2[i], 0);
    const resto2 = soma2 % 11;
    const digito2 = resto2 < 2 ? 0 : 11 - resto2;

    if (digito2 !== digitos[13]) {
      this.mensagemErro = "CNPJ inválido: segundo dígito verificador não confere.";
      return false;
    }

    this.mensagemErro = "";
    return true;
  }
}