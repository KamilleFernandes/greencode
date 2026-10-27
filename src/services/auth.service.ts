import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type { PrismaClient, PapelUsuario } from "../generated/prisma/client.js";
import { HttpError } from "../utils/http-error.js";
import { registrarAuditoria } from "../repositories/auditoria.repository.js";

export type UsuarioPublico = { id: string; login: string; nome: string; papel: PapelUsuario; ativo: boolean; versao: number };

function validarSenha(senha: string): void {
  if (typeof senha !== "string" || senha.length < 8 || !/[A-Za-z]/.test(senha) || !/\d/.test(senha)) {
    throw new HttpError(400, "A senha deve ter no mínimo 8 caracteres, com letras e números.");
  }
}

function verificarSha256(senha: string, salt: string | null, hash: string): boolean {
  if (!salt) return false;
  const calculado = crypto.createHash("sha256").update(senha + salt).digest();
  let armazenado: Buffer;
  try { armazenado = Buffer.from(hash, "hex"); } catch { return false; }
  return armazenado.length === calculado.length && crypto.timingSafeEqual(armazenado, calculado);
}

export async function autenticarUsuario(db: PrismaClient, loginInformado: string, senha: string): Promise<UsuarioPublico> {
  const login = String(loginInformado ?? "").trim().toLowerCase();
  const usuario = await db.usuario.findUnique({ where: { login } });
  let senhaValida = false;
  if (usuario?.ativo) {
    if (usuario.algoritmoHash === "SHA256") senhaValida = verificarSha256(senha, usuario.salt, usuario.hashSenha);
    else {
      try { senhaValida = await bcrypt.compare(senha, usuario.hashSenha); } catch { senhaValida = false; }
    }
  }
  if (!usuario || !usuario.ativo || !senhaValida) {
    await db.$transaction(async (tx) => registrarAuditoria(tx, { id: usuario?.id, login: login || "DESCONHECIDO" }, "LOGIN_FALHA", "Usuario", usuario?.id, { loginInformado: login }));
    throw new HttpError(401, "Usuário ou senha inválidos.");
  }

  const atualizacoes: { ultimoAcesso: Date; versao: { increment: number }; hashSenha?: string; salt?: null; algoritmoHash?: string } = {
    ultimoAcesso: new Date(), versao: { increment: 1 }
  };
  if (usuario.algoritmoHash === "SHA256") {
    atualizacoes.hashSenha = await bcrypt.hash(senha, Number(process.env.BCRYPT_ROUNDS ?? 12));
    atualizacoes.salt = null;
    atualizacoes.algoritmoHash = "BCRYPT";
  }
  const atualizado = await db.usuario.update({ where: { id: usuario.id }, data: atualizacoes });
  await db.$transaction(async (tx) => registrarAuditoria(tx, { id: atualizado.id, login: atualizado.login }, "LOGIN", "Usuario", atualizado.id, { papel: atualizado.papel, hashMigrado: usuario.algoritmoHash === "SHA256" }));
  return { id: atualizado.id, login: atualizado.login, nome: atualizado.nome, papel: atualizado.papel, ativo: atualizado.ativo, versao: atualizado.versao };
}

export async function criarUsuario(db: PrismaClient, operador: { id: string; login: string }, input: { login: string; nome: string; senha: string; papel: PapelUsuario }): Promise<UsuarioPublico> {
  const login = String(input.login ?? "").trim().toLowerCase();
  const nome = String(input.nome ?? "").trim();
  if (!/^[a-z0-9._-]{3,32}$/.test(login)) throw new HttpError(400, "Login inválido: use 3 a 32 letras minúsculas, números, ponto, hífen ou sublinhado.");
  if (!nome) throw new HttpError(400, "Nome obrigatório.");
  validarSenha(input.senha);
  const hashSenha = await bcrypt.hash(input.senha, Number(process.env.BCRYPT_ROUNDS ?? 12));
  try {
    return await db.$transaction(async (tx) => {
      const criado = await tx.usuario.create({ data: { login, nome, hashSenha, algoritmoHash: "BCRYPT", papel: input.papel } });
      await registrarAuditoria(tx, operador, "CRIAR_USUARIO", "Usuario", criado.id, { login: criado.login, papel: criado.papel });
      return { id: criado.id, login: criado.login, nome: criado.nome, papel: criado.papel, ativo: criado.ativo, versao: criado.versao };
    });
  } catch (e: any) {
    if (e?.code === "P2002") throw new HttpError(409, "Login já cadastrado.");
    throw e;
  }
}

export async function alterarPapelUsuario(db: PrismaClient, operador: { id: string; login: string }, id: string, papel: PapelUsuario, versao: number): Promise<UsuarioPublico> {
  return db.$transaction(async (tx) => {
    const alvo = await tx.usuario.findUnique({ where: { id } });
    if (!alvo) throw new HttpError(404, "Usuário não encontrado.");
    if (alvo.versao !== versao) throw new HttpError(409, "Conflito de versão. Recarregue o usuário e tente novamente.");
    if (alvo.papel === "ADMINISTRADOR" && papel !== "ADMINISTRADOR") {
      const totalAdmins = await tx.usuario.count({ where: { papel: "ADMINISTRADOR", ativo: true } });
      if (totalAdmins <= 1) throw new HttpError(409, "Não é possível rebaixar o único administrador ativo.");
    }
    const changed = await tx.usuario.updateMany({ where: { id, versao }, data: { papel, versao: { increment: 1 } } });
    if (changed.count !== 1) throw new HttpError(409, "Conflito de versão.");
    const atualizado = await tx.usuario.findUniqueOrThrow({ where: { id } });
    await registrarAuditoria(tx, operador, "ALTERAR_PAPEL", "Usuario", id, { papelAnterior: alvo.papel, papelNovo: papel, versaoAnterior: versao });
    return { id: atualizado.id, login: atualizado.login, nome: atualizado.nome, papel: atualizado.papel, ativo: atualizado.ativo, versao: atualizado.versao };
  });
}
