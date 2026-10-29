import type { Prisma } from "../generated/prisma/client.js";
import { paraJson, type Db } from "./db.js";

/** Quem executou e de qual requisição HTTP veio a operação. */
export type Ator = {
  id: string | null;
  login: string;
  requisicao?: { id?: string; metodo?: string; rota?: string; ip?: string };
};

export interface EntradaJournal {
  operacao: string;
  entidade: string;
  entidadeId?: string | null;
  dadosAntes?: unknown;
  dadosDepois?: unknown;
  statusHttp?: number;
}

/**
 * Grava uma entrada do journal (formato da AV1: id, timestamp, operacao, entidade, dadosAntes,
 * dadosDepois, usuarioResponsavel). Quando chamada com o cliente transacional da própria operação,
 * o registro e a alteração de estado são confirmados juntos — nunca existe um sem o outro.
 */
export async function registrarJournal(db: Db, ator: Ator, e: EntradaJournal): Promise<void> {
  await db.auditoria.create({
    data: {
      operacao: e.operacao,
      entidade: e.entidade,
      entidadeId: e.entidadeId ?? null,
      dadosAntes: e.dadosAntes === undefined ? undefined : paraJson(e.dadosAntes),
      dadosDepois: e.dadosDepois === undefined ? undefined : paraJson(e.dadosDepois),
      usuarioResponsavel: ator.login.slice(0, 32),
      usuarioId: ator.id,
      requisicaoId: ator.requisicao?.id?.slice(0, 64),
      metodo: ator.requisicao?.metodo?.slice(0, 10),
      rota: ator.requisicao?.rota?.slice(0, 200),
      ip: ator.requisicao?.ip?.slice(0, 64),
      statusHttp: e.statusHttp
    }
  });
}

export interface FiltroJournal {
  entidade?: string; entidadeId?: string; operacao?: string; usuario?: string;
  inicio?: Date; fim?: Date; limite: number; incluirArquivadas: boolean;
}

export async function consultarJournal(db: Db, f: FiltroJournal) {
  const where: any = {};
  if (f.entidade) where.entidade = f.entidade;
  if (f.entidadeId) where.entidadeId = f.entidadeId;
  if (f.operacao) where.operacao = f.operacao;
  if (f.usuario) where.usuarioResponsavel = f.usuario;
  if (f.inicio || f.fim) where.timestamp = { ...(f.inicio ? { gte: f.inicio } : {}), ...(f.fim ? { lte: f.fim } : {}) };
  const orderBy = { timestamp: "desc" } as const;
  const vivos = await db.auditoria.findMany({ where, orderBy, take: f.limite });
  const arquivados = f.incluirArquivadas ? await db.auditoriaArquivada.findMany({ where, orderBy, take: f.limite }) : [];
  return [...vivos.map((x) => ({ ...x, arquivado: false })), ...arquivados.map(({ arquivadoEm: _a, ...x }) => ({ ...x, arquivado: true }))]
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .slice(0, f.limite);
}

/** Rotação (acima do limite de bytes) e retenção (mínimo de N dias): ver fn_auditoria_manutencao na migração. */
export async function executarManutencaoJournal(db: Db, retencaoDias: number, limiteBytes: number) {
  const rows = await db.$queryRaw<Array<{ rotacionados: number; expurgados: number; tamanho_antes: bigint }>>`
    SELECT * FROM fn_auditoria_manutencao(${retencaoDias}::int, ${limiteBytes}::bigint)`;
  const r = rows[0]!;
  return { rotacionados: Number(r.rotacionados), expurgados: Number(r.expurgados), tamanhoAntesBytes: Number(r.tamanho_antes) };
}
export type { Prisma };
