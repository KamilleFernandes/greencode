import type { Prisma } from "../generated/prisma/client.js";
import { exigirAtualizacao, type Db } from "./db.js";

export const obterConfiguracao = (db: Db) => db.configuracaoGlobal.findUnique({ where: { id: "global" } });
export async function atualizarConfiguracaoVersionada(db: Db, versao: number, data: { aliquotaImposto: number; coeficienteDepreciacaoPadrao: number; coeficientesDepreciacao: Prisma.InputJsonValue }) {
  exigirAtualizacao(await db.configuracaoGlobal.updateMany({ where: { id: "global", versao }, data: { ...data, versao: { increment: 1 }, atualizadoEm: new Date() } }), "a configuração");
}
