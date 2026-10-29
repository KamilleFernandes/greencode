import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../generated/prisma/client.js";
import { alterarPapelUsuario, criarUsuario, definirUsuarioAtivo } from "../services/auth.service.js";
import { listarUsuarios } from "../repositories/usuario.repository.js";
import { atorDaRequisicao } from "../utils/contexto.js";
import { PAPEIS } from "./esquemas.js";

export function registrarRotasUsuarios(app: FastifyInstance, db: PrismaClient): void {
  const admin = app.authorize("ADMINISTRADOR");
  const idUuid = { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } as const;

  app.get("/usuarios", { preHandler: admin, schema: { tags: ["Usuários"], summary: "Listar usuários (sem dados de senha)" } }, async () => listarUsuarios(db));

  app.post("/usuarios", {
    preHandler: admin,
    schema: { tags: ["Usuários"], summary: "Criar usuário", body: { type: "object", required: ["login", "nome", "senha", "papel"], properties: { login: { type: "string", minLength: 3, maxLength: 32 }, nome: { type: "string", minLength: 1, maxLength: 120 }, senha: { type: "string", minLength: 8 }, papel: { type: "string", enum: PAPEIS } }, additionalProperties: false } }
  }, async (request, reply) => reply.code(201).send(await criarUsuario(db, atorDaRequisicao(request), request.body as any)));

  app.patch("/usuarios/:id/papel", {
    preHandler: admin,
    schema: { tags: ["Usuários"], summary: "Alterar papel (controle de versão; protege o único administrador)", params: idUuid, body: { type: "object", required: ["papel", "versao"], properties: { papel: { type: "string", enum: PAPEIS }, versao: { type: "integer", minimum: 1 } }, additionalProperties: false } }
  }, async (request) => {
    const b = request.body as { papel: any; versao: number };
    return alterarPapelUsuario(db, atorDaRequisicao(request), (request.params as { id: string }).id, b.papel, b.versao);
  });

  app.patch("/usuarios/:id/ativo", {
    preHandler: admin,
    schema: { tags: ["Usuários"], summary: "Ativar ou desativar usuário", params: idUuid, body: { type: "object", required: ["ativo", "versao"], properties: { ativo: { type: "boolean" }, versao: { type: "integer", minimum: 1 } }, additionalProperties: false } }
  }, async (request) => {
    const b = request.body as { ativo: boolean; versao: number };
    return definirUsuarioAtivo(db, atorDaRequisicao(request), (request.params as { id: string }).id, b.ativo, b.versao);
  });
}
