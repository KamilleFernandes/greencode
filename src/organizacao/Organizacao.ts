import { Contrato } from "./Contrato";

export class Organizacao {
  id: string;
  razaoSocial: string;
  cnpj: string;
  inscricaoEstadual: string;
  enderecoCompleto: string;
  telefone: string;
  email: string;
  dataCadastro: Date;
  ativo: boolean;
  contratoVigente: Contrato | null;

  constructor(
    id: string = "",
    razaoSocial: string = "",
    cnpj: string = "",
    inscricaoEstadual: string = "",
    enderecoCompleto: string = "",
    telefone: string = "",
    email: string = ""
  ) {
    this.id = id;
    this.razaoSocial = razaoSocial;
    this.cnpj = cnpj;
    this.inscricaoEstadual = inscricaoEstadual;
    this.enderecoCompleto = enderecoCompleto;
    this.telefone = telefone;
    this.email = email;
    this.dataCadastro = new Date();
    this.ativo = true;
    this.contratoVigente = null;
  }

  alterarEndereco(novoEndereco: string): void {
    this.enderecoCompleto = novoEndereco;
  }

  desativar(): void {
    this.ativo = false;
  }

  static fromJSON(o: any): Organizacao {
    const org = new Organizacao(o.id, o.razaoSocial, o.cnpj, o.inscricaoEstadual, o.enderecoCompleto, o.telefone, o.email);
    org.dataCadastro = new Date(o.dataCadastro);
    org.ativo = !!o.ativo;
    org.contratoVigente = o.contratoVigente ? Contrato.fromJSON(o.contratoVigente) : null;
    return org;
  }
}
