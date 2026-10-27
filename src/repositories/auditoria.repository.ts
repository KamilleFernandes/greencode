import type { Prisma } from "../generated/prisma/client.js";

export async function registrarAuditoria(
  tx: Prisma.TransactionClient,
  usuario: { id?: string | null; login: string },
  acao: string,
  entidade: string,
  entidadeId?: string | null,
  detalhes?: unknown
): Promise<void> {
  await tx.auditoria.create({
    data: {
      usuarioId: usuario.id ?? null,
      usuarioLogin: usuario.login,
      acao,
      entidade,
      entidadeId: entidadeId ?? null,
      detalhes: detalhes === undefined ? undefined : JSON.parse(JSON.stringify(detalhes))
    }
  });
}
