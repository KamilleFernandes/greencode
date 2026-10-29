import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { HttpError } from "../utils/http-error.js";

/** Cliente Prisma ou cliente transacional: os repositórios funcionam com os dois. */
export type Db = PrismaClient | Prisma.TransactionClient;
export type Tx = Prisma.TransactionClient;

/** Versionamento otimista: UPDATE ... WHERE id = ? AND versao = ? precisa afetar exatamente 1 linha. */
export function exigirAtualizacao(resultado: { count: number }, recurso: string): void {
  if (resultado.count !== 1) {
    throw new HttpError(409, `Conflito de versão: ${recurso} foi alterado por outra operação. Recarregue e tente novamente.`);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ehUuid = (valor: string) => UUID.test(valor);

/** Copia "segura para JSON" (Decimal, Date e BigInt viram tipos serializáveis). */
export function paraJson<T>(valor: T): any {
  return valor === undefined ? undefined : JSON.parse(JSON.stringify(valor, (_k, v) => (typeof v === "bigint" ? Number(v) : v)));
}
