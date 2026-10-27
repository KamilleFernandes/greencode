import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../generated/prisma/client.js";
import { autenticarUsuario } from "../services/auth.service.js";
import { HttpError } from "../utils/http-error.js";

export function registrarRotasAuth(app: FastifyInstance, db: PrismaClient): void {
  app.post("/auth/login", {
    schema: {
      tags: ["Autenticação"], summary: "Autenticar e receber JWT", security: [],
      body: { type: "object", required: ["login", "senha"], properties: { login: { type: "string", minLength: 3 }, senha: { type: "string", minLength: 1 } }, additionalProperties: false },
      response: { 200: { type: "object", properties: { token: { type: "string" }, tipo: { type: "string" }, expiraEm: { type: "string" }, usuario: { type: "object", properties: { id: { type: "string" }, login: { type: "string" }, nome: { type: "string" }, papel: { type: "string" } } } } } }
    }
  }, async (request, reply) => {
    const body = request.body as { login: string; senha: string };
    const usuario = await autenticarUsuario(db, body.login, body.senha);
    const token = app.jwt.sign({ sub: usuario.id, login: usuario.login, papel: usuario.papel }, { expiresIn: process.env.JWT_EXPIRES_IN ?? "30m" });
    return reply.send({ token, tipo: "Bearer", expiraEm: process.env.JWT_EXPIRES_IN ?? "30m", usuario: { id: usuario.id, login: usuario.login, nome: usuario.nome, papel: usuario.papel } });
  });

  app.post("/auth/logout", { preHandler: [app.authenticate], schema: { tags: ["Autenticação"], summary: "Registrar logout (JWT stateless)", security: [{ bearerAuth: [] }] } }, async (request, reply) => {
    await db.auditoria.create({ data: { usuarioId: request.authUser!.id, usuarioLogin: request.authUser!.login, acao: "LOGOUT", entidade: "Usuario", entidadeId: request.authUser!.id } });
    // JWT stateless: o cliente deve descartar o token; ele permanece válido até expirar.
    return reply.code(200).send({ mensagem: "Logout registrado. Descarte o token no cliente; ele expira automaticamente." });
  });
}
