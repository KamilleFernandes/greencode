import type { PrismaClient } from "../generated/prisma/client.js";
import { StatusRastreamento } from "../generated/prisma/client.js";
import { HttpError } from "../utils/http-error.js";

function periodo(inicioTexto: string, fimTexto: string): { inicio: Date; fim: Date } {
  const inicio = new Date(`${inicioTexto}T00:00:00.000Z`);
  const fim = new Date(`${fimTexto}T23:59:59.999Z`);
  if (!inicioTexto || !fimTexto || Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime()) || inicio > fim) throw new HttpError(400, "Período inválido: informe início e fim válidos, com início menor ou igual ao fim.");
  return { inicio, fim };
}

export async function relatorioOrganizacao(db: PrismaClient, query: { organizacaoId: string; inicio: string; fim: string }) {
  const p = periodo(query.inicio, query.fim);
  const org = await db.organizacao.findFirst({ where: /^[0-9a-f-]{36}$/i.test(query.organizacaoId) ? { id: query.organizacaoId } : { codigo: query.organizacaoId } });
  if (!org) throw new HttpError(404, "Organização não encontrada.");
  const lotes = await db.lote.findMany({ where: { organizacaoId: org.id, dataEntrada: { gte: p.inicio, lte: p.fim } }, include: { equipamentos: true }, orderBy: { dataEntrada: "asc" } });
  const equipamentos = lotes.flatMap((l) => l.equipamentos);
  return { organizacao: { id: org.id, codigo: org.codigo, razaoSocial: org.razaoSocial }, periodo: { inicio: p.inicio, fim: p.fim, inclusivo: true }, totalLotes: lotes.length, totalEquipamentos: equipamentos.length, pesoTotalKg: equipamentos.reduce((s, e) => s + Number(e.pesoQuilogramas), 0), lotes: lotes.map(({ equipamentos: eq, ...l }) => ({ ...l, quantidadeEquipamentos: eq.length })) };
}

export async function relatorioStatus(db: PrismaClient, status: StatusRastreamento) {
  const equipamentos = await db.equipamento.findMany({ where: { statusRastreamento: status }, include: { lote: { select: { codigo: true } } }, orderBy: { codigo: "asc" } });
  return { status, total: equipamentos.length, equipamentos };
}

export async function relatorioFinanceiro(db: PrismaClient, query: { inicio: string; fim: string }) {
  const p = periodo(query.inicio, query.fim);
  const movs = await db.movimentacao.findMany({ where: { dataHora: { gte: p.inicio, lte: p.fim } }, select: { equipamentoId: true }, distinct: ["equipamentoId"] });
  const ids = movs.map((m) => m.equipamentoId);
  const equipamentos = ids.length ? await db.equipamento.findMany({ where: { id: { in: ids } } }) : [];
  const config = await db.configuracaoGlobal.findUnique({ where: { id: "global" } });
  const padrao = Number(config?.coeficienteDepreciacaoPadrao ?? 0.1);
  const coeficientes = (config?.coeficientesDepreciacao ?? {}) as Record<string, number>;
  const depreciacoes = equipamentos.map((eq) => Math.min(1, Math.max(0, Number(coeficientes[eq.tipo] ?? padrao) * Math.max(0, new Date().getFullYear() - eq.anoFabricacao))));
  const media = depreciacoes.length ? depreciacoes.reduce((a, b) => a + b, 0) / depreciacoes.length : 0;
  return { periodo: { inicio: p.inicio, fim: p.fim, inclusivo: true }, equipamentosMovimentados: equipamentos.length, depreciacaoMedia: media, depreciacaoMediaPercentual: Number((media * 100).toFixed(2)), aliquotaImposto: Number(config?.aliquotaImposto ?? 0), aliquotaImpostoPercentual: Number((Number(config?.aliquotaImposto ?? 0) * 100).toFixed(2)), observacao: "A AV1 não registra custo monetário por equipamento; por isso este relatório apresenta depreciação e alíquota configuradas, sem inventar valor financeiro de ativos." };
}
