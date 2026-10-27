import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import jwt from "@fastify/jwt";
import type { PrismaClient } from "./generated/prisma/client.js";
import { PapelUsuario } from "./generated/prisma/client.js";
import { prisma } from "./plugins/prisma.js";
import { HttpError } from "./utils/http-error.js";
import { registrarRotasAuth } from "./controllers/auth.controller.js";
import { registrarRotasUsuarios } from "./controllers/usuarios.controller.js";
import { registrarRotasConfiguracao } from "./controllers/configuracao.controller.js";
import { registrarRotasOrganizacao } from "./controllers/organizacao.controller.js";
import { registrarRotasLogistica } from "./controllers/logistica.controller.js";
import { registrarRotasRelatorios } from "./controllers/relatorios.controller.js";

export function buildApp(db: PrismaClient = prisma): FastifyInstance {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < 32 || jwtSecret.startsWith("troque-por")) {
    throw new Error("JWT_SECRET ausente ou insegura. Gere uma chave aleatória de pelo menos 32 caracteres no .env.");
  }

  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });
  app.register(swagger, {
    openapi: {
      info: { title: "GreenCode API", description: "API REST de logística reversa de equipamentos eletrônicos - AV2", version: "2.0.0" },
      tags: [
        { name: "Autenticação" }, { name: "Usuários" }, { name: "Configuração" }, { name: "Organizações" },
        { name: "Lotes" }, { name: "Equipamentos" }, { name: "Triagem" }, { name: "Movimentações" }, { name: "Rastreamento" }, { name: "Relatórios" }
      ],
      components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } } }
    }
  });
  app.register(swaggerUi, { routePrefix: "/docs", uiConfig: { persistAuthorization: true } });
  app.register(jwt, { secret: jwtSecret });
  app.decorateRequest("authUser", null);
  app.decorate("authenticate", async (request: FastifyRequest, _reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      throw new HttpError(401, "Token ausente, inválido ou expirado.");
    }
    const subject = request.user.sub;
    const user = await db.usuario.findUnique({ where: { id: subject } });
    if (!user || !user.ativo) throw new HttpError(401, "Usuário inativo ou não encontrado.");
    request.authUser = { id: user.id, login: user.login, papel: user.papel };
  });
  app.decorate("authorize", (...roles: `${PapelUsuario}`[]) => async (request: FastifyRequest, _reply: FastifyReply) => {
    if (!request.authUser) throw new HttpError(401, "Autenticação obrigatória.");
    if (!roles.includes(request.authUser.papel)) throw new HttpError(403, "Seu papel não permite executar esta operação.");
  });

  app.get("/health", { schema: { tags: ["Sistema"], summary: "Verificar saúde da API", security: [] } }, async () => {
    await db.$queryRaw`SELECT 1`;
    return { status: "ok", database: "ok", timestamp: new Date().toISOString() };
  });

  registrarRotasAuth(app, db);
  registrarRotasUsuarios(app, db);
  registrarRotasConfiguracao(app, db);
  registrarRotasOrganizacao(app, db);
  registrarRotasLogistica(app, db);
  registrarRotasRelatorios(app, db);

  app.setErrorHandler((error, request, reply) => {
    const err = error as any;
    if (error instanceof HttpError) return reply.code(error.statusCode).send({ erro: error.message, detalhes: error.details });
    if (err?.validation) return reply.code(400).send({ erro: "Dados da requisição inválidos.", detalhes: err.validation });
    if (["P2002", "P2003", "P2034"].includes(err?.code)) return reply.code(409).send({ erro: err.code === "P2002" ? "Registro duplicado." : "Conflito de integridade ou concorrência." });
    if (err?.code === "P2025") return reply.code(404).send({ erro: "Registro não encontrado." });
    request.log.error({ err: error }, "Falha não tratada na API");
    return reply.code(500).send({ erro: "Erro interno do servidor." });
  });
  app.addHook("onClose", async () => { await db.$disconnect(); });
  return app;
}
