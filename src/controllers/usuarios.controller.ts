import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../generated/prisma/client.js";
import { alterarPapelUsuario, criarUsuario } from "../services/auth.service.js";
import { registrarAuditoria } from "../repositories/auditoria.repository.js";
import { HttpError } from "../utils/http-error.js";

export function registrarRotasUsuarios(app: FastifyInstance, db: PrismaClient): void {
  app.get("/usuarios", { preHandler: [app.authenticate, app.authorize("ADMINISTRADOR")], schema: { tags: ["Usuários"], summary: "Listar usuários sem dados de senha", security: [{ bearerAuth: [] }] } }, async () => {
    return db.usuario.findMany({ select: { id: true, login: true, nome: true, papel: true, ativo: true, ultimoAcesso: true, versao: true, criadoEm: true }, orderBy: { login: "asc" } });
  });

  app.post("/usuarios", {
    preHandler: [app.authenticate, app.authorize("ADMINISTRADOR")],
    schema: { tags: ["Usuários"], summary: "Criar usuário", security: [{ bearerAuth: [] },], body: { type: "object", required: ["login", "nome", "senha", "papel"], properties: { login: { type: "string", minLength: 3, maxLength: 32 }, nome: { type: "string", minLength: 1, maxLength: 120 }, senha: { type: "string", minLength: 8 }, papel: { type: "string", enum: ["ADMINISTRADOR", "OPERADOR_CADASTRO", "GESTOR_ALMOXARIFADO", "AUDITOR"] } }, additionalProperties: false } }
  }, async (request, reply) => reply.code(201).send(await criarUsuario(db, request.authUser!, request.body as any)));

  app.patch("/usuarios/:id/papel", {
    preHandler: [app.authenticate, app.authorize("ADMINISTRADOR")],
    schema: { tags: ["Usuários"], summary: "Alterar papel com controle de versão", security: [{ bearerAuth: [] }], params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } }, body: { type: "object", required: ["papel", "versao"], properties: { papel: { type: "string", enum: ["ADMINISTRADOR", "OPERADOR_CADASTRO", "GESTOR_ALMOXARIFADO", "AUDITOR"] }, versao: { type: "integer", minimum: 1 } }, additionalProperties: false } }
  }, async (request) => {
    const input = request.body as { papel: any; versao: number };
    return alterarPapelUsuario(db, request.authUser!, (request.params as { id: string }).id, input.papel, input.versao);
  });

  app.patch("/usuarios/:id/ativo", {
    preHandler: [app.authenticate, app.authorize("ADMINISTRADOR")],
    schema: { tags: ["Usuários"], summary: "Ativar ou desativar usuário", security: [{ bearerAuth: [] }], params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } }, body: { type: "object", required: ["ativo", "versao"], properties: { ativo: { type: "boolean" }, versao: { type: "integer", minimum: 1 } }, additionalProperties: false } }
  }, async (request) => {
    const { id } = request.params as { id: string };
    const { ativo, versao } = request.body as { ativo: boolean; versao: number };
    return db.$transaction(async (tx) => {
      const alvo = await tx.usuario.findUnique({ where: { id } });
      if (!alvo) throw new HttpError(404, "Usuário não encontrado.");
      if (alvo.versao !== versao) throw new HttpError(409, "Conflito de versão do usuário.");
      if (!ativo && alvo.papel === "ADMINISTRADOR") {
        const admins = await tx.usuario.count({ where: { papel: "ADMINISTRADOR", ativo: true } });
        if (admins <= 1) throw new HttpError(409, "Não é possível desativar o único administrador ativo.");
      }
      const result = await tx.usuario.updateMany({ where: { id, versao }, data: { ativo, versao: { increment: 1 } } });
      if (result.count !== 1) throw new HttpError(409, "Conflito de versão do usuário.");
      const atualizado = await tx.usuario.findUniqueOrThrow({ where: { id }, select: { id: true, login: true, nome: true, papel: true, ativo: true, versao: true } });
      await registrarAuditoria(tx, request.authUser!, ativo ? "ATIVAR_USUARIO" : "DESATIVAR_USUARIO", "Usuario", id, { versaoAnterior: versao });
      return atualizado;
    });
  });
}
