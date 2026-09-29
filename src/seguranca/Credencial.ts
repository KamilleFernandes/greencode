import * as crypto from "crypto";
import { Autenticavel } from "./Autenticavel";
import { PapelUsuario } from "./PapelUsuario";

export class Credencial implements Autenticavel {
  usuario: string;
  hashSenha: string;
  salt: string;
  ultimoAcesso: Date;
  papel: PapelUsuario;

  constructor(
    usuario: string = "",
    hashSenha: string = "",
    salt: string = "",
    papel: PapelUsuario = PapelUsuario.AUDITOR
  ) {
    this.usuario = usuario;
    this.hashSenha = hashSenha;
    this.salt = salt;
    this.papel = papel;
    this.ultimoAcesso = new Date();
  }

  verificarSenha(senhaPlana: string): boolean {
    const calculado = crypto.createHash("sha256").update(senhaPlana + this.salt).digest();
    const armazenado = Buffer.from(this.hashSenha, "hex");
    return armazenado.length === calculado.length && crypto.timingSafeEqual(armazenado, calculado);
  }

  atualizarUltimoAcesso(): void {
    this.ultimoAcesso = new Date();
  }

  autenticar(usuario: string, senha: string): boolean {
    return usuario === this.usuario && this.verificarSenha(senha);
  }

  renovarToken(): string {
    return crypto.randomBytes(32).toString("hex");
  }

  static fromJSON(o: any): Credencial {
    const c = new Credencial(o.usuario, o.hashSenha, o.salt, o.papel);
    c.ultimoAcesso = new Date(o.ultimoAcesso);
    return c;
  }
}
