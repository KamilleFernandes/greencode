import type { FastifyRequest } from "fastify";
import type { Ator } from "../repositories/auditoria.repository.js";

/** Monta o "ator" (quem + de qual requisição HTTP) que acompanha cada operação até o journal. */
export function atorDaRequisicao(request: FastifyRequest): Ator {
  const u = request.authUser;
  return {
    id: u?.id ?? null,
    login: u?.login ?? "ANONIMO",
    requisicao: { id: String(request.id), metodo: request.method, rota: request.routeOptions?.url ?? request.url.split("?")[0], ip: request.ip }
  };
}
