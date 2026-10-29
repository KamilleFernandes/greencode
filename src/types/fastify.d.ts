import type { FastifyReply, FastifyRequest } from "fastify";
import "@fastify/jwt";
import type { PapelUsuario } from "../generated/prisma/client.js";

declare module "fastify" {
  interface FastifyRequest {
    authUser: { id: string; login: string; papel: PapelUsuario } | null;
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest) => Promise<void>;
    authorize: (...roles: `${PapelUsuario}`[]) => (request: FastifyRequest) => Promise<void>;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; login: string; papel: PapelUsuario };
    user: { sub: string; login: string; papel: PapelUsuario; iat?: number; exp?: number };
  }
}
