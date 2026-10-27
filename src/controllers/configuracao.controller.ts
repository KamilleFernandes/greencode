import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { Prisma } from "../generated/prisma/client.js";
import { registrarAuditoria } from "../repositories/auditoria.repository.js";
import { HttpError } from "../utils/http-error.js";

function validarFracao(n: unknown, nome: string): number {
  const valor = Number(n);
  if (!Number.isFinite(valor) || valor < 0 || valor > 1) throw new HttpError(400, `${nome} deve estar entre 0 e 1.`);
  return valor;
}

export function registrarRotasConfiguracao(app: FastifyInstance, db: PrismaClient): void {
  app.get("/configuracao", { preHandler: [app.authenticate, app.authorize("ADMINISTRADOR")], schema: { tags: ["Configuração"], summary: "Consultar configuração global", security: [{ bearerAuth: [] }] } }, async () => {
    const config = await db.configuracaoGlobal.findUnique({ where: { id: "global" } });
    if (!config) throw new HttpError(404, "Configuração global ainda não foi criada. Execute o seed.");
    return config;
  });

  app.put("/configuracao", {
    preHandler: [app.authenticate, app.authorize("ADMINISTRADOR")],
    schema: { tags: ["Configuração"], summary: "Atualizar configuração global com controle de versão", security: [{ bearerAuth: [] }], body: { type: "object", required: ["versao", "aliquotaImposto", "coeficienteDepreciacaoPadrao"], properties: { versao: { type: "integer", minimum: 1 }, aliquotaImposto: { type: "number", minimum: 0, maximum: 1 }, coeficienteDepreciacaoPadrao: { type: "number", minimum: 0, maximum: 1 }, coeficientesDepreciacao: { type: "object", additionalProperties: { type: "number", minimum: 0, maximum: 1 } } }, additionalProperties: false } }
  }, async (request) => {
    const body = request.body as { versao: number; aliquotaImposto: number; coeficienteDepreciacaoPadrao: number; coeficientesDepreciacao?: Record<string, number> };
    const aliquotaImposto = validarFracao(body.aliquotaImposto, "Alíquota");
    const coeficienteDepreciacaoPadrao = validarFracao(body.coeficienteDepreciacaoPadrao, "Coeficiente de depreciação");
    const coeficientes = body.coeficientesDepreciacao ?? {};
    for (const [tipo, valor] of Object.entries(coeficientes)) {
      if (!Number.isFinite(valor) || valor < 0 || valor > 1) throw new HttpError(400, `Coeficiente inválido para ${tipo}.`);
    }
    return db.$transaction(async (tx) => {
      const atual = await tx.configuracaoGlobal.findUnique({ where: { id: "global" } });
      if (!atual) throw new HttpError(404, "Configuração global não encontrada. Execute o seed.");
      if (atual.versao !== body.versao) throw new HttpError(409, "Conflito de versão da configuração.");
      const result = await tx.configuracaoGlobal.updateMany({ where: { id: "global", versao: body.versao }, data: { aliquotaImposto, coeficienteDepreciacaoPadrao, coeficientesDepreciacao: coeficientes as Prisma.InputJsonValue, versao: { increment: 1 }, atualizadoEm: new Date() } });
      if (result.count !== 1) throw new HttpError(409, "Conflito de versão da configuração.");
      const atualizado = await tx.configuracaoGlobal.findUniqueOrThrow({ where: { id: "global" } });
      await registrarAuditoria(tx, request.authUser!, "ATUALIZAR_CONFIGURACAO", "ConfiguracaoGlobal", "global", { versaoAnterior: body.versao, aliquotaImposto, coeficienteDepreciacaoPadrao });
      return atualizado;
    });
  });
}
