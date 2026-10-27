import type { Prisma } from "../generated/prisma/client.js";

type DbLote = Pick<Prisma.TransactionClient, "lote">;
const zeroUuid = "00000000-0000-0000-0000-000000000000";

export function identificadorLote(valor: string) {
  return /^[0-9a-f-]{36}$/i.test(valor) ? { id: valor } : { codigo: valor };
}

export async function buscarLotePorIdentificador(db: DbLote, valor: string) {
  return db.lote.findFirst({ where: identificadorLote(valor) });
}
