import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../generated/prisma/client.js";
import { EstadoFisico, StatusLote, StatusRastreamento, TipoEquipamento } from "../generated/prisma/client.js";
import { adicionarEquipamento, atualizarEstadoFisico, buscarLote, criarLote, listarLotes, movimentarEquipamento, processarTriagem, rastrearEquipamento } from "../services/logistica.service.js";

export function registrarRotasLogistica(app: FastifyInstance, db: PrismaClient): void {
  app.post("/lotes", {
    preHandler: [app.authenticate, app.authorize("GESTOR_ALMOXARIFADO", "ADMINISTRADOR")],
    schema: { tags: ["Lotes"], summary: "Criar lote", security: [{ bearerAuth: [] }], body: { type: "object", required: ["organizacaoId", "notaFiscal", "transportadora"], properties: { organizacaoId: { type: "string" }, notaFiscal: { type: "string", minLength: 1, maxLength: 80 }, transportadora: { type: "string", minLength: 1, maxLength: 160 }, dataEntrada: { type: "string", format: "date" }, observacoes: { type: "string", maxLength: 1000 } }, additionalProperties: false } }
  }, async (request, reply) => reply.code(201).send(await criarLote(db, request.authUser!, request.body)));

  app.get("/lotes", { preHandler: [app.authenticate, app.authorize("GESTOR_ALMOXARIFADO", "ADMINISTRADOR", "AUDITOR")], schema: { tags: ["Lotes"], summary: "Listar lotes por período e/ou status", security: [{ bearerAuth: [] }], querystring: { type: "object", properties: { inicio: { type: "string", format: "date" }, fim: { type: "string", format: "date" }, status: { type: "string", enum: Object.values(StatusLote) } } } } }, async (request) => listarLotes(db, request.query as { inicio?: string; fim?: string; status?: StatusLote }));

  app.get("/lotes/:id", {
    preHandler: [app.authenticate, app.authorize("GESTOR_ALMOXARIFADO", "ADMINISTRADOR", "AUDITOR")],
    schema: {
      tags: ["Lotes"],
      summary: "Consultar lote com equipamentos e movimentações",
      security: [{ bearerAuth: [] }],
      params: { type: "object", required: ["id"], properties: { id: { type: "string" } } }
    }
  }, async (request) => buscarLote(db, (request.params as { id: string }).id));

  app.post("/lotes/:id/equipamentos", {
    preHandler: [app.authenticate, app.authorize("GESTOR_ALMOXARIFADO", "ADMINISTRADOR")],
    schema: { tags: ["Equipamentos"], summary: "Adicionar equipamento ao lote recebido", security: [{ bearerAuth: [] }], params: { type: "object", required: ["id"], properties: { id: { type: "string" } } }, body: { type: "object", required: ["tipo", "marca", "modelo", "anoFabricacao", "pesoQuilogramas", "versao"], properties: { versao: { type: "integer", minimum: 1 }, tipo: { type: "string", enum: Object.values(TipoEquipamento) }, marca: { type: "string", minLength: 1, maxLength: 100 }, modelo: { type: "string", minLength: 1, maxLength: 120 }, anoFabricacao: { type: "integer", minimum: 1970 }, estadoFisico: { type: "string", enum: Object.values(EstadoFisico) }, pesoQuilogramas: { type: "number", exclusiveMinimum: 0 } }, additionalProperties: false } }
  }, async (request, reply) => reply.code(201).send(await adicionarEquipamento(db, request.authUser!, (request.params as { id: string }).id, request.body)));

  app.post("/lotes/:id/triagem", {
    preHandler: [app.authenticate, app.authorize("GESTOR_ALMOXARIFADO", "ADMINISTRADOR")],
    schema: { tags: ["Triagem"], summary: "Avançar uma etapa da triagem do lote (duas chamadas)", security: [{ bearerAuth: [] }], params: { type: "object", required: ["id"], properties: { id: { type: "string" } } }, body: { type: "object", required: ["versao"], properties: { versao: { type: "integer", minimum: 1 } }, additionalProperties: false } }
  }, async (request) => processarTriagem(db, request.authUser!, (request.params as { id: string }).id, (request.body as { versao: number }).versao));

  app.patch("/equipamentos/:id/movimentacoes", {
    preHandler: [app.authenticate, app.authorize("GESTOR_ALMOXARIFADO", "ADMINISTRADOR")],
    schema: { tags: ["Movimentações"], summary: "Atualizar status e registrar movimentação atomicamente", security: [{ bearerAuth: [] }], params: { type: "object", required: ["id"], properties: { id: { type: "string" } } }, body: { type: "object", required: ["destino", "versao"], properties: { destino: { type: "string", enum: Object.values(StatusRastreamento) }, justificativa: { type: "string", maxLength: 1000 }, versao: { type: "integer", minimum: 1 } }, additionalProperties: false } }
  }, async (request) => movimentarEquipamento(db, request.authUser!, (request.params as { id: string }).id, request.body as { destino: StatusRastreamento; justificativa?: string; versao: number }));

  app.patch("/equipamentos/:id/estado-fisico", {
    preHandler: [app.authenticate, app.authorize("GESTOR_ALMOXARIFADO", "ADMINISTRADOR")],
    schema: { tags: ["Equipamentos"], summary: "Atualizar estado físico; queda de duas categorias exige justificativa", security: [{ bearerAuth: [] }], params: { type: "object", required: ["id"], properties: { id: { type: "string" } } }, body: { type: "object", required: ["estadoFisico", "versao"], properties: { estadoFisico: { type: "string", enum: Object.values(EstadoFisico) }, justificativa: { type: "string", maxLength: 1000 }, versao: { type: "integer", minimum: 1 } }, additionalProperties: false } }
  }, async (request) => atualizarEstadoFisico(db, request.authUser!, (request.params as { id: string }).id, request.body as { estadoFisico: EstadoFisico; justificativa?: string; versao: number }));

  app.get("/equipamentos/:id/rastreamento", { preHandler: [app.authenticate, app.authorize("GESTOR_ALMOXARIFADO", "AUDITOR", "ADMINISTRADOR")], schema: { tags: ["Rastreamento"], summary: "Consultar histórico completo de movimentações", security: [{ bearerAuth: [] }], params: { type: "object", required: ["id"], properties: { id: { type: "string" } } } } }, async (request) => rastrearEquipamento(db, (request.params as { id: string }).id));
}
