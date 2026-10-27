import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../generated/prisma/client.js";
import { StatusRastreamento } from "../generated/prisma/client.js";
import { relatorioFinanceiro, relatorioOrganizacao, relatorioStatus } from "../services/relatorio.service.js";

export function registrarRotasRelatorios(app: FastifyInstance, db: PrismaClient): void {
  app.get("/relatorios/organizacao", { preHandler: [app.authenticate, app.authorize("AUDITOR", "ADMINISTRADOR")], schema: { tags: ["Relatórios"], summary: "Relatório de recebimento por organização (período inclusivo)", security: [{ bearerAuth: [] }], querystring: { type: "object", required: ["organizacaoId", "inicio", "fim"], properties: { organizacaoId: { type: "string" }, inicio: { type: "string", format: "date" }, fim: { type: "string", format: "date" } } } } }, async (request) => relatorioOrganizacao(db, request.query as { organizacaoId: string; inicio: string; fim: string }));

  app.get("/relatorios/status", { preHandler: [app.authenticate, app.authorize("AUDITOR", "ADMINISTRADOR")], schema: { tags: ["Relatórios"], summary: "Relatório de equipamentos por status de rastreamento", security: [{ bearerAuth: [] }], querystring: { type: "object", required: ["status"], properties: { status: { type: "string", enum: Object.values(StatusRastreamento) } } } } }, async (request) => relatorioStatus(db, (request.query as { status: StatusRastreamento }).status));

  app.get("/relatorios/financeiro", { preHandler: [app.authenticate, app.authorize("AUDITOR", "ADMINISTRADOR")], schema: { tags: ["Relatórios"], summary: "Relatório financeiro de movimentações e depreciação", security: [{ bearerAuth: [] }], querystring: { type: "object", required: ["inicio", "fim"], properties: { inicio: { type: "string", format: "date" }, fim: { type: "string", format: "date" } } } } }, async (request) => relatorioFinanceiro(db, request.query as { inicio: string; fim: string }));
}
