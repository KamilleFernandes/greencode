import type { PrismaClient } from "../generated/prisma/client.js";
import { consultarJournal, executarManutencaoJournal, registrarJournal, type Ator } from "../repositories/auditoria.repository.js";
import { periodoLocal } from "../utils/estados.js";

export const RETENCAO_DIAS = () => Number(process.env.AUDITORIA_RETENCAO_DIAS ?? 180);
export const LIMITE_BYTES = () => Number(process.env.AUDITORIA_LIMITE_BYTES ?? 10 * 1024 * 1024);

export async function consultarAuditoria(db: PrismaClient, q: { entidade?: string; entidadeId?: string; operacao?: string; usuario?: string; inicio?: string; fim?: string; limite?: number; incluirArquivadas?: boolean }) {
  const periodo = q.inicio || q.fim ? periodoLocal(q.inicio ?? "1970-01-01", q.fim ?? "2999-12-31") : undefined;
  return consultarJournal(db, {
    entidade: q.entidade, entidadeId: q.entidadeId, operacao: q.operacao, usuario: q.usuario,
    inicio: periodo?.inicio, fim: periodo?.fim, limite: q.limite ?? 100, incluirArquivadas: q.incluirArquivadas ?? true
  });
}

/** Rotação (acima de 10 MB) e retenção (mínimo de 180 dias) do journal. Pode ser chamada pelo job, pelo script ou pela API. */
export async function manterJournal(db: PrismaClient, ator?: Ator, sobrescrever: { retencaoDias?: number; limiteBytes?: number } = {}) {
  const r = await executarManutencaoJournal(db, sobrescrever.retencaoDias ?? RETENCAO_DIAS(), sobrescrever.limiteBytes ?? LIMITE_BYTES());
  if (ator && (r.rotacionados > 0 || r.expurgados > 0)) {
    await registrarJournal(db, ator, { operacao: "MANUTENCAO_JOURNAL", entidade: "Auditoria", dadosDepois: r });
  }
  return r;
}
