import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { HttpError } from "../utils/http-error.js";
import { registrarJournal, type Ator } from "../repositories/auditoria.repository.js";
import { atualizarConfiguracaoVersionada, obterConfiguracao } from "../repositories/configuracao.repository.js";

const fracao = (n: unknown, nome: string): number => {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0 || v > 1) throw new HttpError(400, `${nome} deve estar entre 0 e 1.`);
  return v;
};

export async function consultarConfiguracao(db: PrismaClient) {
  const c = await obterConfiguracao(db);
  if (!c) throw new HttpError(404, "Configuração global ainda não foi criada. Execute o seed.");
  return c;
}

export async function atualizarConfiguracao(db: PrismaClient, ator: Ator, body: { versao: number; aliquotaImposto: number; coeficienteDepreciacaoPadrao: number; coeficientesDepreciacao?: Record<string, number> }) {
  const aliquotaImposto = fracao(body.aliquotaImposto, "Alíquota");
  const coeficienteDepreciacaoPadrao = fracao(body.coeficienteDepreciacaoPadrao, "Coeficiente de depreciação");
  const coeficientes = body.coeficientesDepreciacao ?? {};
  for (const [tipo, v] of Object.entries(coeficientes)) fracao(v, `Coeficiente de ${tipo}`);
  return db.$transaction(async (tx) => {
    const atual = await obterConfiguracao(tx);
    if (!atual) throw new HttpError(404, "Configuração global não encontrada. Execute o seed.");
    if (atual.versao !== body.versao) throw new HttpError(409, "Conflito de versão da configuração.");
    await atualizarConfiguracaoVersionada(tx, body.versao, { aliquotaImposto, coeficienteDepreciacaoPadrao, coeficientesDepreciacao: coeficientes as Prisma.InputJsonValue });
    const nova = await obterConfiguracao(tx);
    await registrarJournal(tx, ator, {
      operacao: "ATUALIZAR_CONFIGURACAO", entidade: "ConfiguracaoGlobal", entidadeId: "global",
      dadosAntes: { aliquotaImposto: atual.aliquotaImposto, coeficienteDepreciacaoPadrao: atual.coeficienteDepreciacaoPadrao, coeficientesDepreciacao: atual.coeficientesDepreciacao },
      dadosDepois: { aliquotaImposto, coeficienteDepreciacaoPadrao, coeficientesDepreciacao: coeficientes }
    });
    return nova!;
  });
}
