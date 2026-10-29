import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import jwt from "@fastify/jwt";
import type { PrismaClient, PapelUsuario } from "./generated/prisma/client.js";
import { prisma } from "./plugins/prisma.js";
import { HttpError } from "./utils/http-error.js";
import { atorDaRequisicao } from "./utils/contexto.js";
import { registrarJournal } from "./repositories/auditoria.repository.js";
import { usuarioPorId } from "./repositories/usuario.repository.js";
import { registrarRotasAuth } from "./controllers/auth.controller.js";
import { registrarRotasUsuarios } from "./controllers/usuarios.controller.js";
import { registrarRotasConfiguracao } from "./controllers/configuracao.controller.js";
import { registrarRotasOrganizacao } from "./controllers/organizacao.controller.js";
import { registrarRotasLogistica } from "./controllers/logistica.controller.js";
import { registrarRotasRelatorios } from "./controllers/relatorios.controller.js";
import { registrarRotasAuditoria } from "./controllers/auditoria.controller.js";

/** Rotas que não exigem token. Todas as demais passam pelo hook global de autenticação. */
const ROTAS_PUBLICAS = new Set(["GET /health", "POST /auth/login"]);
const SENSIVEL = /senha|password|token|hash|secret|authorization/i;
const ERRO = { type: "object", properties: { erro: { type: "string" }, detalhes: {} } } as const;

function sanitizar(valor: unknown, nivel = 0): unknown {
  if (valor === null || typeof valor !== "object" || nivel > 4) return valor;
  if (Array.isArray(valor)) return valor.slice(0, 50).map((v) => sanitizar(v, nivel + 1));
  return Object.fromEntries(Object.entries(valor as Record<string, unknown>).map(([k, v]) => [k, SENSIVEL.test(k) ? "[OCULTO]" : sanitizar(v, nivel + 1)]));
}

export function buildApp(db: PrismaClient = prisma): FastifyInstance {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < 32 || jwtSecret.startsWith("troque-por")) {
    throw new Error("JWT_SECRET ausente ou insegura. Gere uma chave aleatória de pelo menos 32 caracteres no .env.");
  }

  const app = Fastify({ logger: process.env.NODE_ENV !== "test", genReqId: () => randomUUID(), forceCloseConnections: "idle" });

  // Toda rota documentada ganha: segurança Bearer (exceto as públicas) e as respostas de erro padronizadas.
  app.addHook("onRoute", (rota) => {
    if (rota.url.startsWith("/docs") || !rota.schema) return;
    const s = rota.schema as any;
    if (!ROTAS_PUBLICAS.has(`GET ${rota.url}`) && !ROTAS_PUBLICAS.has(`POST ${rota.url}`) && s.security === undefined) s.security = [{ bearerAuth: [] }];
    s.response ??= {};
    for (const [codigo, descricao] of [[400, "Dados inválidos"], [401, "Não autenticado"], [403, "Papel sem permissão"], [404, "Não encontrado"], [409, "Conflito (versão, duplicidade ou estado)"], [422, "Regra de negócio / integridade"]] as const) {
      s.response[codigo] ??= { ...ERRO, description: descricao };
    }
  });

  app.register(swagger, {
    openapi: {
      info: { title: "GreenCode API", description: "API REST de logística reversa de equipamentos eletrônicos - AV2", version: "2.0.0" },
      tags: [{ name: "Autenticação" }, { name: "Usuários" }, { name: "Configuração" }, { name: "Organizações" }, { name: "Lotes" }, { name: "Equipamentos" }, { name: "Triagem" }, { name: "Movimentações" }, { name: "Rastreamento" }, { name: "Relatórios" }, { name: "Auditoria" }],
      components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } } }
    }
  });
  app.register(swaggerUi, { routePrefix: "/docs", uiConfig: { persistAuthorization: true } });
  app.register(jwt, { secret: jwtSecret });

  app.decorateRequest("authUser", null);
  /** Valida o JWT e confere o usuário no banco (papel e ativação refletem imediatamente). */
  const autenticar = async (request: FastifyRequest) => {
    try { await request.jwtVerify(); } catch { throw new HttpError(401, "Token ausente, inválido ou expirado."); }
    const usuario = await usuarioPorId(db, request.user.sub);
    if (!usuario || !usuario.ativo) throw new HttpError(401, "Usuário inativo ou não encontrado.");
    request.authUser = { id: usuario.id, login: usuario.login, papel: usuario.papel };
  };
  app.decorate("authenticate", async (request: FastifyRequest) => autenticar(request));
  app.decorate("authorize", (...papeis: `${PapelUsuario}`[]) => async (request: FastifyRequest) => {
    if (!request.authUser) throw new HttpError(401, "Autenticação obrigatória.");
    if (!papeis.includes(request.authUser.papel)) throw new HttpError(403, "Seu papel não permite executar esta operação.");
  });

  // Hook GLOBAL: toda requisição (exceto rotas públicas e a documentação) precisa de token válido.
  app.addHook("onRequest", async (request) => {
    const url = request.routeOptions?.url;
    if (!url || url.startsWith("/docs") || ROTAS_PUBLICAS.has(`${request.method} ${url}`)) return;
    await autenticar(request);
  });

  // As rotas são registradas DEPOIS dos plugins (swagger/jwt carregam primeiro); sem isso o OpenAPI sai sem endpoints.
  app.register(async (api) => {
    api.get("/health", { schema: { tags: ["Sistema"], summary: "Verificar saúde da API e do banco", security: [] } }, async () => {
      await db.$queryRaw`SELECT 1`;
      return { status: "ok", database: "ok", timestamp: new Date().toISOString() };
    });

    registrarRotasAuth(api, db);
    registrarRotasUsuarios(api, db);
    registrarRotasConfiguracao(api, db);
    registrarRotasOrganizacao(api, db);
    registrarRotasLogistica(api, db);
    registrarRotasRelatorios(api, db);
    registrarRotasAuditoria(api, db);

  });

  app.setErrorHandler((error, request, reply) => {
    const err = error as any;
    const responder = (status: number, erro: string, detalhes?: unknown) => { (request as any).falha = erro; return reply.code(status).send({ erro, detalhes }); };
    if (error instanceof HttpError) return responder(error.statusCode, error.message, error.details);
    if (err?.validation) return responder(400, "Dados da requisição inválidos.", err.validation);
    if (err?.statusCode === 401 || String(err?.code ?? "").startsWith("FST_JWT")) return responder(401, "Token ausente, inválido ou expirado.");
    if (err?.code === "P2002") return responder(409, "Registro duplicado.");
    if (err?.code === "P2003") return responder(409, "Conflito de integridade referencial.");
    if (err?.code === "P2034") return responder(409, "Conflito de concorrência; tente novamente.");
    if (err?.code === "P2025") return responder(404, "Registro não encontrado.");
    if (/23514|check_violation|somente de inclusão|Transição de status inválida|não pode avançar de RECEBIDO|não pode ser alterada/i.test(String(err?.message ?? "")) || String(err?.meta?.driverAdapterError?.cause?.originalCode ?? "") === "23514") {
      request.log.warn({ err: error }, "Operação recusada pela integridade do banco");
      return responder(422, "Operação recusada pelas regras de integridade do banco de dados.");
    }
    request.log.error({ err: error }, "Falha não tratada na API");
    return responder(500, "Erro interno do servidor.");
  });

  // Log das requisições rejeitadas (4xx/5xx em escrita; 401/403 em qualquer método), no formato do journal.
  // As requisições bem-sucedidas já são registradas, com antes/depois, dentro da transação da própria operação.
  app.addHook("onResponse", async (request, reply) => {
    const url = request.routeOptions?.url;
    const status = reply.statusCode;
    if (!url || url.startsWith("/docs") || url === "/auth/login" || status < 400) return;
    if (request.method === "GET" && status !== 401 && status !== 403) return;
    try {
      await registrarJournal(db, atorDaRequisicao(request), {
        operacao: "REQUISICAO_REJEITADA", entidade: "HTTP", statusHttp: status,
        dadosDepois: { mensagem: (request as any).falha ?? null, parametros: sanitizar(request.params), consulta: sanitizar(request.query), corpo: sanitizar(request.body) }
      });
    } catch (e) { request.log.error({ err: e }, "Falha ao registrar requisição rejeitada no journal"); }
  });

  app.addHook("onClose", async () => { await db.$disconnect(); });
  return app;
}
