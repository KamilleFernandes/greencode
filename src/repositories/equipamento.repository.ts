import type { Prisma } from "../generated/prisma/client.js";

type DbEquipamento = Pick<Prisma.TransactionClient, "equipamento">;

export function identificadorEquipamento(valor: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(valor) ? { id: valor } : { OR: [{ codigo: valor }, { codigoBarrasInterno: valor }] };
}

export async function buscarEquipamentoPorIdentificador(db: DbEquipamento, valor: string) {
  return db.equipamento.findFirst({ where: identificadorEquipamento(valor) });
}
