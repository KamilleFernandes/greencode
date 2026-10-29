import bcrypt from "bcryptjs";
import type { PrismaClient, PapelUsuario } from "../generated/prisma/client.js";
import { HttpError } from "../utils/http-error.js";
import { registrarJournal, type Ator } from "../repositories/auditoria.repository.js";
import {
  atualizarUsuarioVersionado, contarAdministradoresAtivos, criarUsuario as criarUsuarioRepo, registrarUltimoAcesso,
  usuarioPorId, usuarioPorLogin, usuarioPublico
} from "../repositories/usuario.repository.js";

export type UsuarioPublico = { id: string; login: string; nome: string; papel: PapelUsuario; ativo: boolean; versao: number };
const rounds = () => Number(process.env.BCRYPT_ROUNDS ?? 12);
let hashFalso: string | undefined;

export function validarSenha(senha: unknown): void {
  if (typeof senha !== "string" || senha.length < 8 || !/[A-Za-z]/.test(senha) || !/\d/.test(senha)) {
    throw new HttpError(400, "A senha deve ter no mínimo 8 caracteres, com letras e números.");
  }
}
const resumo = (u: { id: string; login: string; nome: string; papel: PapelUsuario; ativo: boolean; versao: number }) =>
  ({ id: u.id, login: u.login, nome: u.nome, papel: u.papel, ativo: u.ativo, versao: u.versao });

export async function autenticarUsuario(db: PrismaClient, ator: Ator, loginInformado: string, senha: string): Promise<UsuarioPublico> {
  const login = String(loginInformado ?? "").trim().toLowerCase();
  const usuario = await usuarioPorLogin(db, login);
  // Compara sempre com algum hash para não revelar, pelo tempo de resposta, se o login existe.
  hashFalso ??= await bcrypt.hash("senha-inexistente", rounds());
  const valida = await bcrypt.compare(senha, usuario?.hashSenha ?? hashFalso).catch(() => false);
  if (!usuario || !usuario.ativo || !valida) {
    await registrarJournal(db, { ...ator, id: usuario?.id ?? null, login: login || "DESCONHECIDO" }, {
      operacao: "LOGIN_FALHA", entidade: "Usuario", entidadeId: usuario?.id, dadosDepois: { loginInformado: login, motivo: !usuario ? "login inexistente" : !usuario.ativo ? "usuário inativo" : "senha incorreta" }, statusHttp: 401
    });
    throw new HttpError(401, "Usuário ou senha inválidos.");
  }
  await registrarUltimoAcesso(db, usuario.id);
  await registrarJournal(db, { ...ator, id: usuario.id, login: usuario.login }, { operacao: "LOGIN", entidade: "Usuario", entidadeId: usuario.id, dadosDepois: { papel: usuario.papel } });
  return resumo(usuario);
}

export async function registrarEventoSessao(db: PrismaClient, ator: Ator, operacao: "LOGOUT" | "RENOVAR_TOKEN"): Promise<void> {
  await registrarJournal(db, ator, { operacao, entidade: "Usuario", entidadeId: ator.id });
}

export async function criarUsuario(db: PrismaClient, ator: Ator, input: { login: string; nome: string; senha: string; papel: PapelUsuario }): Promise<UsuarioPublico> {
  const login = String(input.login ?? "").trim().toLowerCase();
  const nome = String(input.nome ?? "").trim();
  if (!/^[a-z0-9._-]{3,32}$/.test(login)) throw new HttpError(400, "Login inválido: use 3 a 32 letras minúsculas, números, ponto, hífen ou sublinhado.");
  if (!nome) throw new HttpError(400, "Nome obrigatório.");
  validarSenha(input.senha);
  const hashSenha = await bcrypt.hash(input.senha, rounds());
  try {
    return await db.$transaction(async (tx) => {
      const criado = await criarUsuarioRepo(tx, { login, nome, hashSenha, papel: input.papel });
      await registrarJournal(tx, ator, { operacao: "CRIAR_USUARIO", entidade: "Usuario", entidadeId: criado.id, dadosDepois: { login, nome, papel: criado.papel } });
      return resumo(criado);
    });
  } catch (e: any) {
    if (e?.code === "P2002") throw new HttpError(409, "Login já cadastrado.");
    throw e;
  }
}

export async function alterarPapelUsuario(db: PrismaClient, ator: Ator, id: string, papel: PapelUsuario, versao: number): Promise<UsuarioPublico> {
  return db.$transaction(async (tx) => {
    const alvo = await usuarioPorId(tx, id);
    if (!alvo) throw new HttpError(404, "Usuário não encontrado.");
    if (alvo.versao !== versao) throw new HttpError(409, "Conflito de versão. Recarregue o usuário e tente novamente.");
    if (alvo.papel === "ADMINISTRADOR" && papel !== "ADMINISTRADOR" && (await contarAdministradoresAtivos(tx)) <= 1) {
      throw new HttpError(409, "Não é possível rebaixar o único administrador ativo.");
    }
    await atualizarUsuarioVersionado(tx, id, versao, { papel });
    await registrarJournal(tx, ator, { operacao: "ALTERAR_PAPEL", entidade: "Usuario", entidadeId: id, dadosAntes: { papel: alvo.papel }, dadosDepois: { papel } });
    return usuarioPublico(tx, id);
  });
}

export async function definirUsuarioAtivo(db: PrismaClient, ator: Ator, id: string, ativo: boolean, versao: number): Promise<UsuarioPublico> {
  return db.$transaction(async (tx) => {
    const alvo = await usuarioPorId(tx, id);
    if (!alvo) throw new HttpError(404, "Usuário não encontrado.");
    if (alvo.versao !== versao) throw new HttpError(409, "Conflito de versão do usuário.");
    if (!ativo && alvo.papel === "ADMINISTRADOR" && (await contarAdministradoresAtivos(tx)) <= 1) {
      throw new HttpError(409, "Não é possível desativar o único administrador ativo.");
    }
    await atualizarUsuarioVersionado(tx, id, versao, { ativo });
    await registrarJournal(tx, ator, { operacao: ativo ? "ATIVAR_USUARIO" : "DESATIVAR_USUARIO", entidade: "Usuario", entidadeId: id, dadosAntes: { ativo: alvo.ativo }, dadosDepois: { ativo } });
    return usuarioPublico(tx, id);
  });
}

export async function alterarSenha(db: PrismaClient, ator: Ator, senhaAtual: string, senhaNova: string): Promise<void> {
  validarSenha(senhaNova);
  const usuario = ator.id ? await usuarioPorId(db, ator.id) : null;
  if (!usuario || !(await bcrypt.compare(senhaAtual, usuario.hashSenha).catch(() => false))) throw new HttpError(400, "Senha atual incorreta.");
  if (senhaAtual === senhaNova) throw new HttpError(400, "A nova senha deve ser diferente da atual.");
  const hashSenha = await bcrypt.hash(senhaNova, rounds());
  await db.$transaction(async (tx) => {
    await atualizarUsuarioVersionado(tx, usuario.id, usuario.versao, { hashSenha });
    await registrarJournal(tx, ator, { operacao: "ALTERAR_SENHA", entidade: "Usuario", entidadeId: usuario.id }); // nunca registra senha nem hash
  });
}
