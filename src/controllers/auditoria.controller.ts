import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../generated/prisma/client.js";
import { consultarAuditoria, manterJournal } from "../services/auditoria.service.js";
import { atorDaRequisicao } from "../utils/contexto.js";

export function registrarRotasAuditoria(app: FastifyInstance, db: PrismaClient): void {
  app.get("/auditoria", {
    preHandler: app.authorize("ADMINISTRADOR", "AUDITOR"),
    schema: {
      tags: ["Auditoria"], summary: "Consultar o journal (id, timestamp, operação, entidade, dados antes/depois, usuário responsável)",
      querystring: { type: "object", properties: { entidade: { type: "string" }, entidadeId: { type: "string" }, operacao: { type: "string" }, usuario: { type: "string" }, inicio: { type: "string", format: "date" }, fim: { type: "string", format: "date" }, limite: { type: "integer", minimum: 1, maximum: 500, default: 100 }, incluirArquivadas: { type: "boolean", default: true } } }
    }
  }, async (request) => consultarAuditoria(db, request.query as any));

  app.post("/auditoria/manutencao", {
    preHandler: app.authorize("ADMINISTRADOR"),
    schema: { tags: ["Auditoria"], summary: "Executar agora a rotação (> limite de tamanho) e a retenção (>= 180 dias) do journal" }
  }, async (request) => manterJournal(db, atorDaRequisicao(request)));
}
