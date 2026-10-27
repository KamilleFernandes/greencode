import type { Prisma } from "../generated/prisma/client.js";

type DbOrganizacao = Pick<Prisma.TransactionClient, "organizacao">;
const zeroUuid = "00000000-0000-0000-0000-000000000000";

export function identificadorOrganizacao(valor: string) {
  return { OR: [{ id: /^[0-9a-f-]{36}$/i.test(valor) ? valor : zeroUuid }, { codigo: valor }] };
}

export async function buscarOrganizacaoPorIdentificador(db: DbOrganizacao, valor: string) {
  return db.organizacao.findFirst({ where: identificadorOrganizacao(valor) });
}

export async function listarOrganizacoesAtivas(db: DbOrganizacao) {
  return db.organizacao.findMany({ where: { ativo: true }, orderBy: { codigo: "asc" } });
}
