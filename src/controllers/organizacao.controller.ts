import type { FastifyInstance } from "fastify";
import type { PrismaClient, PapelUsuario } from "../generated/prisma/client.js";
import { criarOrganizacao, listarOrganizacoes, buscarOrganizacao, renovarContrato, desativarOrganizacao } from "../services/organizacao.service.js";

const LEITURA = ["ADMINISTRADOR", "OPERADOR_CADASTRO", "GESTOR_ALMOXARIFADO", "AUDITOR"] as const;

export function registrarRotasOrganizacao(app: FastifyInstance, db: PrismaClient): void {
  app.post("/organizacoes", {
    preHandler: [app.authenticate, app.authorize("OPERADOR_CADASTRO", "ADMINISTRADOR")],
    schema: { tags: ["Organizações"], summary: "Cadastrar organização e contrato", security: [{ bearerAuth: [] }], body: { type: "object", required: ["razaoSocial", "cnpj", "enderecoCompleto", "telefone", "email", "contrato"], properties: {
      razaoSocial: { type: "string", minLength: 2, maxLength: 180 }, cnpj: { type: "string", minLength: 14, maxLength: 18 }, inscricaoEstadual: { type: "string", maxLength: 30 }, enderecoCompleto: { type: "string", minLength: 3 }, telefone: { type: "string", minLength: 8 }, email: { type: "string", format: "email" },
      contrato: { type: "object", required: ["dataAssinatura", "dataVencimento", "valorMensal"], properties: { dataAssinatura: { type: "string", format: "date" }, dataVencimento: { type: "string", format: "date" }, clausulas: { type: "array", items: { type: "string" } }, valorMensal: { type: "number", minimum: 0 }, renovacaoAutomatica: { type: "boolean" } }, additionalProperties: false }
    }, additionalProperties: false } }
  }, async (request, reply) => reply.code(201).send(await criarOrganizacao(db, request.authUser!, request.body)));

  app.get("/organizacoes", { preHandler: [app.authenticate, app.authorize(...LEITURA)], schema: { tags: ["Organizações"], summary: "Listar organizações", security: [{ bearerAuth: [] }], querystring: { type: "object", properties: { incluirInativas: { type: "boolean", default: false } } } } }, async (request) => {
    const query = request.query as { incluirInativas?: boolean };
    return listarOrganizacoes(db, Boolean(query.incluirInativas && ["ADMINISTRADOR", "AUDITOR"].includes(request.authUser!.papel)));
  });

  app.get("/organizacoes/:id", { preHandler: [app.authenticate, app.authorize(...LEITURA)], schema: { tags: ["Organizações"], summary: "Consultar organização e contrato", security: [{ bearerAuth: [] }], params: { type: "object", required: ["id"], properties: { id: { type: "string" } } } } }, async (request) => buscarOrganizacao(db, (request.params as { id: string }).id));

  app.patch("/organizacoes/:id/contrato", {
    preHandler: [app.authenticate, app.authorize("OPERADOR_CADASTRO", "ADMINISTRADOR")],
    schema: { tags: ["Organizações"], summary: "Renovar contrato", security: [{ bearerAuth: [] }], params: { type: "object", required: ["id"], properties: { id: { type: "string" } } }, body: { type: "object", required: ["dataVencimento", "versao"], properties: { dataVencimento: { type: "string", format: "date" }, versao: { type: "integer", minimum: 1 } }, additionalProperties: false } }
  }, async (request) => renovarContrato(db, request.authUser!, (request.params as { id: string }).id, request.body as { dataVencimento: string; versao: number }));

  app.patch("/organizacoes/:id/desativar", { preHandler: [app.authenticate, app.authorize("OPERADOR_CADASTRO", "ADMINISTRADOR")], schema: { tags: ["Organizações"], summary: "Desativar organização", security: [{ bearerAuth: [] }], params: { type: "object", required: ["id"], properties: { id: { type: "string" } } }, body: { type: "object", required: ["versao"], properties: { versao: { type: "integer", minimum: 1 } }, additionalProperties: false } } }, async (request) => desativarOrganizacao(db, request.authUser!, (request.params as { id: string }).id, (request.body as { versao: number }).versao));
}
