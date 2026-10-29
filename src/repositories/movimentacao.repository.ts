import type { Db } from "./db.js";

export const criarMovimentacao = (db: Db, data: { equipamentoId: string; origem: string; destino: string; responsavel: string; observacao?: string }) =>
  db.movimentacao.create({ data: { ...data, observacao: data.observacao ?? "" } });
export const equipamentosMovimentadosNoPeriodo = async (db: Db, inicio: Date, fim: Date) =>
  (await db.movimentacao.findMany({ where: { dataHora: { gte: inicio, lte: fim } }, select: { equipamentoId: true }, distinct: ["equipamentoId"] })).map((m) => m.equipamentoId);
