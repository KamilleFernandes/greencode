import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../generated/prisma/client.js";
import { StatusRastreamento } from "../generated/prisma/client.js";
import { relatorioFinanceiro, relatorioOrganizacao, relatorioStatus } from "../services/relatorio.service.js";

export function registrarRotasRelatorios(app: FastifyInstance, db: PrismaClient): void {
  const auditor = app.authorize("AUDITOR");
  const data = { type: "string", format: "date" } as const;

  app.get("/relatorios/organizacao", { preHandler: auditor, schema: { tags: ["Relatórios"], summary: "Recebimento por organização (período inclusivo)", querystring: { type: "object", required: ["organizacaoId", "inicio", "fim"], properties: { organizacaoId: { type: "string" }, inicio: data, fim: data } } } },
    async (request) => relatorioOrganizacao(db, request.query as any));
  app.get("/relatorios/status", { preHandler: auditor, schema: { tags: ["Relatórios"], summary: "Equipamentos por status de rastreamento", querystring: { type: "object", required: ["status"], properties: { status: { type: "string", enum: Object.values(StatusRastreamento) } } } } },
    async (request) => relatorioStatus(db, (request.query as { status: StatusRastreamento }).status));
  app.get("/relatorios/financeiro", { preHandler: auditor, schema: { tags: ["Relatórios"], summary: "Depreciação e alíquota das movimentações do período", querystring: { type: "object", required: ["inicio", "fim"], properties: { inicio: data, fim: data } } } },
    async (request) => relatorioFinanceiro(db, request.query as any));
}
