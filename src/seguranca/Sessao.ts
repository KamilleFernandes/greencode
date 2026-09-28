import * as crypto from "crypto";
import { Autenticavel } from "./Autenticavel";
import { PapelUsuario } from "./PapelUsuario";

const DURACAO_SESSAO_MS = 30 * 60 * 1000;

export class Sessao implements Autenticavel {
  token: string;
  usuario: string;
  papel: PapelUsuario;
  criacao: Date;
  expiracao: Date;

  isValida(): boolean {
    return new Date() < this.expiracao;
  }

  renovar(): void {
    this.expiracao = new Date(Date.now() + DURACAO_SESSAO_MS);
  }

  autenticar(usuario: string, _senha: string): boolean {
    return this.usuario === usuario && this.isValida();
  }

  renovarToken(): string {
    this.renovar();
    this.token = crypto.randomBytes(32).toString("hex");
    return this.token;
  }
}