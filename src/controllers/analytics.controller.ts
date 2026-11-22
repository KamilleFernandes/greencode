
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../generated/prisma/client.js";
import {
  executarEficiencia,
  executarRentabilidade,
  executarVidaUtil,
  historicoAnalises,
} from "../services/analytics.service.js";
import { atorDaRequisicao } from "../utils/contexto.js";
import { HttpError } from "../utils/http-error.js";

type FiltroOrganizacao = {
  organizacaoId?: string;
};

type FiltroHistorico = FiltroOrganizacao & {
  limite?: number;
};

const schemaOrganizacao = {
  type: "object",
  properties: {
    organizacaoId: {
      type: "string",
      format: "uuid",
    },
  },
  additionalProperties: false,
};

const schemaHistorico = {
  type: "object",
  properties: {
    organizacaoId: {
      type: "string",
      format: "uuid",
    },
    limite: {
      type: "integer",
      minimum: 1,
      maximum: 100,
    },
  },
  additionalProperties: false,
};

async function validarOrganizacao(
  db: PrismaClient,
  organizacaoId?: string,
): Promise<string | undefined> {
  if (!organizacaoId) return undefined;

  const organizacao = await db.organizacao.findUnique({
    where: { id: organizacaoId },
    select: { id: true },
  });

  if (!organizacao) {
    throw new HttpError(404, "Organização não encontrada.");
  }

  return organizacao.id;
}

export function registrarRotasAnaliticas(
  app: FastifyInstance,
  db: PrismaClient,
) {
  const leitura = app.authorize(
    "ADMINISTRADOR",
    "GESTOR_ALMOXARIFADO",
    "AUDITOR",
  );

  const admin = app.authorize("ADMINISTRADOR");

  app.post(
    "/api/v1/internal/analytics/efficiency",
    {
      preHandler: leitura,
      schema: {
        tags: ["Análises"],
        summary: "Executar análise de eficiência operacional",
        querystring: schemaOrganizacao,
      },
    },
    async (request) => {
      const { organizacaoId } =
        request.query as FiltroOrganizacao;

      const id = await validarOrganizacao(db, organizacaoId);

      return executarEficiencia(
        db,
        atorDaRequisicao(request).login,
        id,
      );
    },
  );

  app.post(
    "/api/v1/internal/analytics/profitability",
    {
      preHandler: leitura,
      schema: {
        tags: ["Análises"],
        summary: "Executar análise estimada de rentabilidade",
        querystring: schemaOrganizacao,
      },
    },
    async (request) => {
      const { organizacaoId } =
        request.query as FiltroOrganizacao;

      const id = await validarOrganizacao(db, organizacaoId);

      return executarRentabilidade(
        db,
        atorDaRequisicao(request).login,
        id,
      );
    },
  );

  app.post(
    "/api/v1/internal/analytics/useful-life",
    {
      preHandler: leitura,
      schema: {
        tags: ["Análises"],
        summary: "Executar previsão de vida útil remanescente",
        querystring: schemaOrganizacao,
      },
    },
    async (request) => {
      const { organizacaoId } =
        request.query as FiltroOrganizacao;

      const id = await validarOrganizacao(db, organizacaoId);

      return executarVidaUtil(
        db,
        atorDaRequisicao(request).login,
        id,
      );
    },
  );

  app.get(
    "/api/v1/internal/analytics/history",
    {
      preHandler: leitura,
      schema: {
        tags: ["Análises"],
        summary: "Consultar histórico de análises",
        querystring: schemaHistorico,
      },
    },
    async (request) => {
      const { limite = 20, organizacaoId } =
        request.query as FiltroHistorico;

      const id = await validarOrganizacao(db, organizacaoId);

      return historicoAnalises(db, limite, id);
    },
  );

  app.get(
    "/api/v1/admin/analytics/config",
    {
      preHandler: admin,
      schema: {
        tags: ["Análises"],
        summary: "Consultar parâmetros analíticos",
      },
    },
    async () =>
      db.configuracaoAnalitica.findUnique({
        where: { id: "global" },
      }),
  );

  app.put(
    "/api/v1/admin/analytics/config",
    {
      preHandler: admin,
      schema: {
        tags: ["Análises"],
        summary: "Atualizar parâmetros de valoração e regressão",
        body: {
          type: "object",
          properties: {
            fatoresEstadoFisico: {
              type: "object",
              additionalProperties: {
                type: "number",
                minimum: 0,
                maximum: 1,
              },
            },
            valoresReferencia: {
              type: "object",
            },
            amostraMinimaRegressao: {
              type: "integer",
              minimum: 3,
              maximum: 10000,
            },
            suavizacaoBayesiana: {
              type: "integer",
              minimum: 0,
              maximum: 10000,
            },
            versao: {
              type: "integer",
              minimum: 1,
            },
          },
          required: ["versao"],
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      const b = request.body as any;

      const atual = await db.configuracaoAnalitica.findUnique({
        where: { id: "global" },
      });

      if (atual && atual.versao !== b.versao) {
        throw new HttpError(
          409,
          "Versão dos parâmetros alterada; atualize e tente novamente.",
        );
      }

      return db.configuracaoAnalitica.upsert({
        where: { id: "global" },
        create: { id: "global", ...b },
        update: { ...b, versao: { increment: 1 } },
      });
    },
  );
}
