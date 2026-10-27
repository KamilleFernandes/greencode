import type { Prisma } from "../generated/prisma/client.js";

export type Tx = Prisma.TransactionClient;

async function proximo(tx: Tx, seq: string, prefixo: string, tamanho = 5): Promise<string> {
  // O nome da sequência é sempre uma constante interna, nunca entrada do usuário.
  const rows = await tx.$queryRaw<Array<{ seq: bigint }>>`SELECT nextval(${seq}::regclass) AS seq`;
  return `${prefixo}${String(rows[0].seq).padStart(tamanho, "0")}`;
}

export const proximoCodigoOrganizacao = (tx: Tx) => proximo(tx, "organizacao_codigo_seq", "ORG");
export const proximoCodigoContrato = (tx: Tx) => proximo(tx, "contrato_codigo_seq", "CTR");
export const proximoCodigoLote = (tx: Tx) => proximo(tx, "lote_codigo_seq", "LT");
export const proximoCodigoEquipamento = (tx: Tx) => proximo(tx, "equipamento_codigo_seq", "EQ", 6);

export async function proximoCodigoBarras(tx: Tx, tipo: string): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ seq: bigint }>>`SELECT nextval('codigo_barras_seq') AS seq`;
  return `${tipo.slice(0, 3).toUpperCase()}-${String(rows[0].seq).padStart(6, "0")}`;
}
