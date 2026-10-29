import type { PrismaClient, StatusRastreamento } from "../generated/prisma/client.js";
import { obterConfiguracao } from "../repositories/configuracao.repository.js";
import { equipamentosPorIds, equipamentosPorStatus } from "../repositories/equipamento.repository.js";
import { lotesDaOrganizacaoNoPeriodo } from "../repositories/lote.repository.js";
import { equipamentosMovimentadosNoPeriodo } from "../repositories/movimentacao.repository.js";
import { organizacaoPorIdentificador } from "../repositories/organizacao.repository.js";
import { periodoLocal, periodoPorData } from "../utils/estados.js";
import { HttpError } from "../utils/http-error.js";

export async function relatorioOrganizacao(db: PrismaClient, q: { organizacaoId: string; inicio: string; fim: string }) {
  const p = periodoPorData(q.inicio, q.fim); // dataEntrada é uma data (sem hora)
  const org = await organizacaoPorIdentificador(db, q.organizacaoId);
  if (!org) throw new HttpError(404, "Organização não encontrada.");
  const lotes = await lotesDaOrganizacaoNoPeriodo(db, org.id, p.inicio, p.fim);
  const equipamentos = lotes.flatMap((l) => l.equipamentos);
  return {
    organizacao: { id: org.id, codigo: org.codigo, razaoSocial: org.razaoSocial },
    periodo: { inicio: q.inicio, fim: q.fim, inclusivo: true },
    totalLotes: lotes.length,
    totalEquipamentos: equipamentos.length,
    pesoTotalKg: equipamentos.reduce((s, e) => s + Number(e.pesoQuilogramas), 0),
    lotes: lotes.map(({ equipamentos: eq, ...l }) => ({ ...l, quantidadeEquipamentos: eq.length }))
  };
}

export async function relatorioStatus(db: PrismaClient, status: StatusRastreamento) {
  const equipamentos = await equipamentosPorStatus(db, status);
  return { status, total: equipamentos.length, equipamentos };
}

export async function relatorioFinanceiro(db: PrismaClient, q: { inicio: string; fim: string }) {
  const p = periodoLocal(q.inicio, q.fim); // movimentações têm data e hora: dia local do servidor
  const equipamentos = await equipamentosPorIds(db, await equipamentosMovimentadosNoPeriodo(db, p.inicio, p.fim));
  const config = await obterConfiguracao(db);
  const padrao = Number(config?.coeficienteDepreciacaoPadrao ?? 0.1);
  const coef = (config?.coeficientesDepreciacao ?? {}) as Record<string, number>;
  const ano = new Date().getFullYear();
  const dep = equipamentos.map((e) => Math.min(1, Math.max(0, Number(coef[e.tipo] ?? padrao) * Math.max(0, ano - e.anoFabricacao))));
  const media = dep.length ? dep.reduce((a, b) => a + b, 0) / dep.length : 0;
  const aliquota = Number(config?.aliquotaImposto ?? 0);
  return {
    periodo: { inicio: q.inicio, fim: q.fim, inclusivo: true },
    equipamentosMovimentados: equipamentos.length,
    depreciacaoMedia: media,
    depreciacaoMediaPercentual: Number((media * 100).toFixed(2)),
    aliquotaImposto: aliquota,
    aliquotaImpostoPercentual: Number((aliquota * 100).toFixed(2)),
    observacao: "A AV1 não registra custo monetário por equipamento; o relatório apresenta depreciação e alíquota configuradas, sem inventar valor financeiro de ativos."
  };
}
