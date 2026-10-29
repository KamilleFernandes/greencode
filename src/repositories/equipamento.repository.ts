import type { Prisma, StatusRastreamento, EstadoFisico } from "../generated/prisma/client.js";
import { exigirAtualizacao, ehUuid, type Db } from "./db.js";

const filtro = (valor: string) => (ehUuid(valor) ? { id: valor } : { OR: [{ codigo: valor.toUpperCase() }, { codigoBarrasInterno: valor.toUpperCase() }] });

export const equipamentoPorIdentificador = (db: Db, valor: string) => db.equipamento.findFirst({ where: filtro(valor) });
export const equipamentoPorId = (db: Db, id: string) => db.equipamento.findUniqueOrThrow({ where: { id } });
export const equipamentoRastreio = (db: Db, valor: string) =>
  db.equipamento.findFirst({
    where: filtro(valor),
    include: {
      lote: { include: { organizacao: { select: { id: true, codigo: true, razaoSocial: true } } } },
      movimentacoes: { orderBy: { dataHora: "asc" } }
    }
  });
export const equipamentosDoLote = (db: Db, loteId: string) => db.equipamento.findMany({ where: { loteId }, orderBy: { posicaoNoLote: "asc" } });
export const statusDosEquipamentosDoLote = (db: Db, loteId: string) => db.equipamento.findMany({ where: { loteId }, select: { statusRastreamento: true } });
export const proximaPosicaoNoLote = async (db: Db, loteId: string) =>
  ((await db.equipamento.aggregate({ where: { loteId }, _max: { posicaoNoLote: true } }))._max.posicaoNoLote ?? 0) + 1;
export const criarEquipamento = (db: Db, data: Prisma.EquipamentoUncheckedCreateInput) => db.equipamento.create({ data });
export async function atualizarEquipamentoVersionado(
  db: Db, id: string, versao: number,
  data: { statusRastreamento?: StatusRastreamento; estadoFisico?: EstadoFisico; codigoBarrasInterno?: string }
) {
  exigirAtualizacao(await db.equipamento.updateMany({ where: { id, versao }, data: { ...data, versao: { increment: 1 } } }), "o equipamento");
}
export const equipamentosPorStatus = (db: Db, status: StatusRastreamento) =>
  db.equipamento.findMany({ where: { statusRastreamento: status }, include: { lote: { select: { codigo: true } } }, orderBy: { codigo: "asc" } });
export const equipamentosPorIds = (db: Db, ids: string[]) => (ids.length ? db.equipamento.findMany({ where: { id: { in: ids } } }) : Promise.resolve([]));
