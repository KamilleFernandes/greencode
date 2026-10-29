import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../generated/prisma/client.js";
import { EstadoFisico, StatusLote, StatusRastreamento } from "../generated/prisma/client.js";
import { adicionarEquipamento, atualizarEstadoFisico, buscarLote, criarLote, listarLotes, movimentarEquipamento, processarTriagem, rastrearEquipamento } from "../services/logistica.service.js";
import { atorDaRequisicao } from "../utils/contexto.js";
import { equipamentoObrigatorios, equipamentoProps, idParam } from "./esquemas.js";

export function registrarRotasLogistica(app: FastifyInstance, db: PrismaClient): void {
  const gestor = app.authorize("GESTOR_ALMOXARIFADO");
  const leitura = app.authorize("GESTOR_ALMOXARIFADO", "AUDITOR");
  const id = (r: any) => (r.params as { id: string }).id;

  app.post("/lotes", {
    preHandler: gestor,
    schema: {
      tags: ["Lotes"], summary: "Criar lote (opcionalmente já com os equipamentos, em uma única transação)",
      body: {
        type: "object", required: ["organizacaoId", "notaFiscal", "transportadora"], additionalProperties: false,
        properties: {
          organizacaoId: { type: "string", description: "UUID ou código (ex.: BR001)" }, notaFiscal: { type: "string", minLength: 1, maxLength: 80 }, transportadora: { type: "string", minLength: 1, maxLength: 160 },
          dataEntrada: { type: "string", format: "date", description: "AAAA-MM-DD; padrão: hoje (máx. 90 dias no passado)" }, observacoes: { type: "string", maxLength: 1000 },
          equipamentos: { type: "array", maxItems: 500, items: { type: "object", required: [...equipamentoObrigatorios], properties: equipamentoProps, additionalProperties: false } }
        }
      }
    }
  }, async (request, reply) => reply.code(201).send(await criarLote(db, atorDaRequisicao(request), request.body)));

  app.get("/lotes", {
    preHandler: leitura,
    schema: { tags: ["Lotes"], summary: "Listar lotes por período e/ou status", querystring: { type: "object", properties: { inicio: { type: "string", format: "date" }, fim: { type: "string", format: "date" }, status: { type: "string", enum: Object.values(StatusLote) } } } }
  }, async (request) => listarLotes(db, request.query as any));

  app.get("/lotes/:id", { preHandler: leitura, schema: { tags: ["Lotes"], summary: "Consultar lote com equipamentos e movimentações", params: idParam } }, async (request) => buscarLote(db, id(request)));

  app.post("/lotes/:id/equipamentos", {
    preHandler: gestor,
    schema: { tags: ["Equipamentos"], summary: "Adicionar equipamento ao lote recebido", params: idParam, body: { type: "object", required: [...equipamentoObrigatorios], additionalProperties: false, properties: { ...equipamentoProps, versao: { type: "integer", minimum: 1, description: "Opcional: versão do lote lida pelo cliente" } } } }
  }, async (request, reply) => reply.code(201).send(await adicionarEquipamento(db, atorDaRequisicao(request), id(request), request.body)));

  app.post("/lotes/:id/triagem", {
    preHandler: gestor,
    schema: { tags: ["Triagem"], summary: "Avançar uma etapa da triagem do lote (duas chamadas)", params: idParam, body: { type: "object", required: ["versao"], properties: { versao: { type: "integer", minimum: 1 } }, additionalProperties: false } }
  }, async (request) => processarTriagem(db, atorDaRequisicao(request), id(request), (request.body as { versao: number }).versao));

  app.patch("/equipamentos/:id/movimentacoes", {
    preHandler: gestor,
    schema: { tags: ["Movimentações"], summary: "Atualizar status e registrar a movimentação atomicamente", params: idParam, body: { type: "object", required: ["destino", "versao"], properties: { destino: { type: "string", enum: Object.values(StatusRastreamento) }, justificativa: { type: "string", maxLength: 1000 }, versao: { type: "integer", minimum: 1 } }, additionalProperties: false } }
  }, async (request) => movimentarEquipamento(db, atorDaRequisicao(request), id(request), request.body as any));

  app.patch("/equipamentos/:id/estado-fisico", {
    preHandler: gestor,
    schema: { tags: ["Equipamentos"], summary: "Atualizar estado físico (queda de 2+ categorias exige justificativa)", params: idParam, body: { type: "object", required: ["estadoFisico", "versao"], properties: { estadoFisico: { type: "string", enum: Object.values(EstadoFisico) }, justificativa: { type: "string", maxLength: 1000 }, versao: { type: "integer", minimum: 1 } }, additionalProperties: false } }
  }, async (request) => atualizarEstadoFisico(db, atorDaRequisicao(request), id(request), request.body as any));

  app.get("/equipamentos/:id/rastreamento", { preHandler: leitura, schema: { tags: ["Rastreamento"], summary: "Histórico completo de movimentações (por id, código ou código de barras)", params: idParam } }, async (request) => rastrearEquipamento(db, id(request)));
}
