import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../generated/prisma/client.js";
import { buscarOrganizacao, criarOrganizacao, desativarOrganizacao, listarOrganizacoes, renovarContrato } from "../services/organizacao.service.js";
import { atorDaRequisicao } from "../utils/contexto.js";
import { idParam } from "./esquemas.js";

export function registrarRotasOrganizacao(app: FastifyInstance, db: PrismaClient): void {
  const escrita = app.authorize("OPERADOR_CADASTRO");
  const leitura = app.authorize("OPERADOR_CADASTRO", "GESTOR_ALMOXARIFADO", "AUDITOR");

  app.post("/organizacoes", {
    preHandler: escrita,
    schema: {
      tags: ["Organizações"], summary: "Cadastrar organização e contrato (uma transação)",
      body: {
        type: "object", required: ["razaoSocial", "cnpj", "inscricaoEstadual", "enderecoCompleto", "telefone", "email", "contrato"], additionalProperties: false,
        properties: {
          razaoSocial: { type: "string", minLength: 2, maxLength: 180 }, cnpj: { type: "string", minLength: 14, maxLength: 18 },
          inscricaoEstadual: { type: "string", minLength: 1, maxLength: 30 }, enderecoCompleto: { type: "string", minLength: 3, maxLength: 300 },
          telefone: { type: "string", minLength: 8, maxLength: 30 }, email: { type: "string", format: "email", maxLength: 160 },
          contrato: { type: "object", required: ["dataAssinatura", "dataVencimento", "valorMensal"], additionalProperties: false, properties: { dataAssinatura: { type: "string", format: "date" }, dataVencimento: { type: "string", format: "date" }, clausulas: { type: "array", items: { type: "string" } }, valorMensal: { type: "number", minimum: 0, maximum: 9999999999.99 }, renovacaoAutomatica: { type: "boolean" } } }
        }
      }
    }
  }, async (request, reply) => reply.code(201).send(await criarOrganizacao(db, atorDaRequisicao(request), request.body)));

  app.get("/organizacoes", {
    preHandler: leitura,
    schema: { tags: ["Organizações"], summary: "Listar organizações (inativas apenas para operador e auditor)", querystring: { type: "object", properties: { incluirInativas: { type: "boolean", default: false } } } }
  }, async (request) => {
    const q = request.query as { incluirInativas?: boolean };
    return listarOrganizacoes(db, Boolean(q.incluirInativas && ["OPERADOR_CADASTRO", "AUDITOR"].includes(request.authUser!.papel)));
  });

  app.get("/organizacoes/:id", { preHandler: leitura, schema: { tags: ["Organizações"], summary: "Consultar organização e contrato", params: idParam } },
    async (request) => buscarOrganizacao(db, (request.params as { id: string }).id));

  app.patch("/organizacoes/:id/contrato", {
    preHandler: escrita,
    schema: { tags: ["Organizações"], summary: "Renovar contrato", params: idParam, body: { type: "object", required: ["dataVencimento", "versao"], properties: { dataVencimento: { type: "string", format: "date" }, versao: { type: "integer", minimum: 1 } }, additionalProperties: false } }
  }, async (request) => renovarContrato(db, atorDaRequisicao(request), (request.params as { id: string }).id, request.body as any));

  app.patch("/organizacoes/:id/desativar", {
    preHandler: escrita,
    schema: { tags: ["Organizações"], summary: "Desativar organização", params: idParam, body: { type: "object", required: ["versao"], properties: { versao: { type: "integer", minimum: 1 } }, additionalProperties: false } }
  }, async (request) => desativarOrganizacao(db, atorDaRequisicao(request), (request.params as { id: string }).id, (request.body as { versao: number }).versao));
}
