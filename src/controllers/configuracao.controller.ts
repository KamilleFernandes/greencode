import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../generated/prisma/client.js";
import { atualizarConfiguracao, consultarConfiguracao } from "../services/configuracao.service.js";
import { atorDaRequisicao } from "../utils/contexto.js";

export function registrarRotasConfiguracao(app: FastifyInstance, db: PrismaClient): void {
  const admin = app.authorize("ADMINISTRADOR");
  app.get("/configuracao", { preHandler: admin, schema: { tags: ["Configuração"], summary: "Consultar alíquota e coeficientes de depreciação" } }, async () => consultarConfiguracao(db));

  app.put("/configuracao", {
    preHandler: admin,
    schema: {
      tags: ["Configuração"], summary: "Atualizar parâmetros globais (controle de versão)",
      body: { type: "object", required: ["versao", "aliquotaImposto", "coeficienteDepreciacaoPadrao"], properties: { versao: { type: "integer", minimum: 1 }, aliquotaImposto: { type: "number", minimum: 0, maximum: 1 }, coeficienteDepreciacaoPadrao: { type: "number", minimum: 0, maximum: 1 }, coeficientesDepreciacao: { type: "object", additionalProperties: { type: "number", minimum: 0, maximum: 1 } } }, additionalProperties: false }
    }
  }, async (request) => atualizarConfiguracao(db, atorDaRequisicao(request), request.body as any));
}
