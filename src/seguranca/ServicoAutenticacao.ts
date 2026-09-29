import * as crypto from "crypto";
import { Credencial } from "./Credencial";
import { Sessao } from "./Sessao";
import { PapelUsuario } from "./PapelUsuario";
import { RepositorioArquivo } from "../persistencia/RepositorioArquivo";

export class ServicoAutenticacao {
  credenciais: Credencial[] = [];
  sessoesAtivas: Sessao[] = [];

  login(usuario: string, senha: string): Sessao {
    const credencial = this.credenciais.find((c) => c.usuario === usuario);
    if (!credencial || !credencial.verificarSenha(senha)) {
      throw new Error("Usuário ou senha inválidos.");
    }

    credencial.atualizarUltimoAcesso();
    const sessao = new Sessao();
    Object.assign(sessao, {
      token: crypto.randomBytes(32).toString("hex"),
      usuario: credencial.usuario,
      papel: credencial.papel,
      criacao: new Date(),
      expiracao: new Date(Date.now() + 30 * 60 * 1000),
    });

    this.sessoesAtivas.push(sessao);
    return sessao;
  }

  logout(token: string): void {
    this.sessoesAtivas = this.sessoesAtivas.filter((s) => s.token !== token);
  }

  validarToken(token: string): boolean {
    const sessao = this.sessoesAtivas.find((s) => s.token === token);
    if (!sessao) return false;
    if (!sessao.isValida()) {
      this.logout(token);
      return false;
    }
    return true;
  }

  alterarSenha(usuario: string, senhaAntiga: string, senhaNova: string): boolean {
    const credencial = this.credenciais.find((c) => c.usuario === usuario);
    if (!credencial || !credencial.verificarSenha(senhaAntiga)) {
      return false;
    }

    const salt = crypto.randomBytes(16).toString("hex");
    credencial.hashSenha = crypto.createHash("sha256").update(senhaNova + salt).digest("hex");
    credencial.salt = salt;
    return true;
  }

  // ===== Métodos abaixo: gestão de contas, exigida pelo enunciado para o =====
  // ===== Administrador, mas ausente no diagrama de ServicoAutenticacao =====

  criarUsuario(usuario: string, senha: string, papel: PapelUsuario): Credencial {
    if (this.credenciais.some((c) => c.usuario === usuario)) {
      throw new Error("Usuário já cadastrado.");
    }

    const salt = crypto.randomBytes(16).toString("hex");
    const hashSenha = crypto.createHash("sha256").update(senha + salt).digest("hex");

    const credencial = new Credencial();
    Object.assign(credencial, { usuario, hashSenha, salt, papel, ultimoAcesso: new Date() });

    this.credenciais.push(credencial);
    return credencial;
  }

  removerUsuario(usuario: string): boolean {
    const tamanhoAntes = this.credenciais.length;
    this.credenciais = this.credenciais.filter((c) => c.usuario !== usuario);
    return this.credenciais.length < tamanhoAntes;
  }

  editarPapelUsuario(usuario: string, novoPapel: PapelUsuario): boolean {
    const credencial = this.credenciais.find((c) => c.usuario === usuario);
    if (!credencial) return false;
    credencial.papel = novoPapel;
    return true;
  }

  listarUsuarios(): Credencial[] {
    return this.credenciais;
  }

}

const ARQUIVO_CREDENCIAIS = "credenciais.dat";

export function carregarCredenciais(repositorio: RepositorioArquivo): Credencial[] {
  return repositorio.listarEntidades(ARQUIVO_CREDENCIAIS);
}

export function salvarCredenciais(repositorio: RepositorioArquivo, credenciais: Credencial[]): void {
  repositorio.salvarEntidade(ARQUIVO_CREDENCIAIS, credenciais);
}