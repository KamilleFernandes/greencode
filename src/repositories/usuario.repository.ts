import type { PapelUsuario } from "../generated/prisma/client.js";
import { exigirAtualizacao, type Db } from "./db.js";

const PUBLICO = { id: true, login: true, nome: true, papel: true, ativo: true, ultimoAcesso: true, versao: true, criadoEm: true } as const;

export const usuarioPorLogin = (db: Db, login: string) => db.usuario.findUnique({ where: { login } });
export const usuarioPorId = (db: Db, id: string) => db.usuario.findUnique({ where: { id } });
export const listarUsuarios = (db: Db) => db.usuario.findMany({ select: PUBLICO, orderBy: { login: "asc" } });
export const usuarioPublico = (db: Db, id: string) => db.usuario.findUniqueOrThrow({ where: { id }, select: PUBLICO });
export const criarUsuario = (db: Db, data: { login: string; nome: string; hashSenha: string; papel: PapelUsuario }) => db.usuario.create({ data });
export const contarAdministradoresAtivos = (db: Db) => db.usuario.count({ where: { papel: "ADMINISTRADOR", ativo: true } });
/** O último acesso é metadado: não incrementa a versão (não invalida a edição de quem está com o registro aberto). */
export const registrarUltimoAcesso = (db: Db, id: string) => db.usuario.update({ where: { id }, data: { ultimoAcesso: new Date() } });
export async function atualizarUsuarioVersionado(db: Db, id: string, versao: number, data: { papel?: PapelUsuario; ativo?: boolean; hashSenha?: string }) {
  exigirAtualizacao(await db.usuario.updateMany({ where: { id, versao }, data: { ...data, versao: { increment: 1 } } }), "o usuário");
}
