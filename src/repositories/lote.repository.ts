import type { Prisma, StatusLote } from "../generated/prisma/client.js";
import { exigirAtualizacao, ehUuid, type Db, type Tx } from "./db.js";

const filtro = (valor: string) => (ehUuid(valor) ? { id: valor } : { codigo: valor.toUpperCase() });

export const lotePorIdentificador = (db: Db, valor: string) => db.lote.findFirst({ where: filtro(valor) });
export const lotePorId = (db: Db, id: string) => db.lote.findUniqueOrThrow({ where: { id } });
export const loteDetalhado = (db: Db, valor: string) =>
  db.lote.findFirst({
    where: filtro(valor),
    include: {
      organizacao: { include: { contrato: true } },
      equipamentos: { include: { movimentacoes: { orderBy: { dataHora: "asc" } } }, orderBy: { posicaoNoLote: "asc" } }
    }
  });
export const loteComEquipamentos = (db: Db, id: string) =>
  db.lote.findUniqueOrThrow({ where: { id }, include: { equipamentos: { orderBy: { posicaoNoLote: "asc" } } } });
export const listarLotes = (db: Db, where: Prisma.LoteWhereInput) =>
  db.lote.findMany({
    where,
    include: { organizacao: { select: { id: true, codigo: true, razaoSocial: true } }, _count: { select: { equipamentos: true } } },
    orderBy: [{ dataEntrada: "desc" }, { codigo: "asc" }]
  });
export const criarLote = (db: Db, data: Prisma.LoteUncheckedCreateInput) => db.lote.create({ data });
export async function atualizarLoteVersionado(db: Db, id: string, versao: number, data: { statusProcessamento: StatusLote }) {
  exigirAtualizacao(await db.lote.updateMany({ where: { id, versao }, data: { ...data, versao: { increment: 1 } } }), "o lote");
}
/** Serializa operações concorrentes sobre o mesmo lote (ex.: várias inclusões de equipamento simultâneas). */
export async function bloquearLote(tx: Tx, id: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "lotes" WHERE "id" = ${id}::uuid FOR UPDATE`;
}
export const lotesDaOrganizacaoNoPeriodo = (db: Db, organizacaoId: string, inicio: Date, fim: Date) =>
  db.lote.findMany({ where: { organizacaoId, dataEntrada: { gte: inicio, lte: fim } }, include: { equipamentos: true }, orderBy: { dataEntrada: "asc" } });
