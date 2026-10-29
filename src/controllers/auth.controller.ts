import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../generated/prisma/client.js";
import { alterarSenha, autenticarUsuario, registrarEventoSessao } from "../services/auth.service.js";
import { atorDaRequisicao } from "../utils/contexto.js";

export function registrarRotasAuth(app: FastifyInstance, db: PrismaClient): void {
  const emitir = (u: { id: string; login: string; papel: string; nome?: string }) => {
    const token = app.jwt.sign({ sub: u.id, login: u.login, papel: u.papel as any }, { expiresIn: process.env.JWT_EXPIRES_IN ?? "30m" });
    const exp = (app.jwt.decode(token) as { exp: number }).exp;
    return { token, tipo: "Bearer", expiraEm: new Date(exp * 1000).toISOString(), usuario: { id: u.id, login: u.login, nome: u.nome, papel: u.papel } };
  };

  app.post("/auth/login", {
    schema: {
      tags: ["Autenticação"], summary: "Autenticar e receber JWT (30 min)", security: [],
      body: { type: "object", required: ["login", "senha"], properties: { login: { type: "string", minLength: 3 }, senha: { type: "string", minLength: 1 } }, additionalProperties: false },
      response: { 200: { type: "object", properties: { token: { type: "string" }, tipo: { type: "string" }, expiraEm: { type: "string" }, usuario: { type: "object", additionalProperties: true } } } }
    }
  }, async (request) => {
    const body = request.body as { login: string; senha: string };
    return emitir(await autenticarUsuario(db, atorDaRequisicao(request), body.login, body.senha));
  });

  app.post("/auth/renovar", { schema: { tags: ["Autenticação"], summary: "Renovar o token (nova janela de 30 min) enquanto o atual for válido" } }, async (request) => {
    const u = request.authUser!;
    await registrarEventoSessao(db, atorDaRequisicao(request), "RENOVAR_TOKEN");
    return emitir(u);
  });

  app.post("/auth/logout", { schema: { tags: ["Autenticação"], summary: "Registrar logout (o JWT é stateless: descarte o token no cliente)" } }, async (request) => {
    await registrarEventoSessao(db, atorDaRequisicao(request), "LOGOUT");
    return { mensagem: "Logout registrado. Descarte o token no cliente; ele expira automaticamente." };
  });

  app.put("/auth/senha", {
    schema: { tags: ["Autenticação"], summary: "Alterar a própria senha", body: { type: "object", required: ["senhaAtual", "senhaNova"], properties: { senhaAtual: { type: "string", minLength: 1 }, senhaNova: { type: "string", minLength: 8 } }, additionalProperties: false } }
  }, async (request) => {
    const b = request.body as { senhaAtual: string; senhaNova: string };
    await alterarSenha(db, atorDaRequisicao(request), b.senhaAtual, b.senhaNova);
    return { mensagem: "Senha alterada com sucesso." };
  });
}
