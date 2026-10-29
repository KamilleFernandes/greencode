import { exigirAtualizacao, ehUuid, type Db } from "./db.js";

const filtro = (valor: string) => (ehUuid(valor) ? { id: valor } : { codigo: valor.toUpperCase() });

export const organizacaoPorIdentificador = (db: Db, valor: string) => db.organizacao.findFirst({ where: filtro(valor), include: { contrato: true } });
export const organizacaoPorCnpj = (db: Db, cnpj: string) => db.organizacao.findUnique({ where: { cnpj } });
export const listarOrganizacoes = (db: Db, incluirInativas: boolean) =>
  db.organizacao.findMany({ where: incluirInativas ? {} : { ativo: true }, include: { contrato: true }, orderBy: { codigo: "asc" } });

export async function criarOrganizacaoComContrato(db: Db, org: any, contrato: any) {
  const criada = await db.organizacao.create({ data: org });
  const ctr = await db.contrato.create({ data: { ...contrato, organizacaoId: criada.id } });
  return { ...criada, contrato: ctr };
}
export async function atualizarOrganizacaoVersionada(db: Db, id: string, versao: number, data: { ativo?: boolean }) {
  exigirAtualizacao(await db.organizacao.updateMany({ where: { id, versao }, data: { ...data, versao: { increment: 1 } } }), "a organização");
}
export async function atualizarContratoVersionado(db: Db, id: string, versao: number, data: { dataVencimento?: Date }) {
  exigirAtualizacao(await db.contrato.updateMany({ where: { id, versao }, data: { ...data, versao: { increment: 1 } } }), "o contrato");
}
export const contratoPorId = (db: Db, id: string) => db.contrato.findUniqueOrThrow({ where: { id } });
export const organizacaoPorId = (db: Db, id: string) => db.organizacao.findUniqueOrThrow({ where: { id }, include: { contrato: true } });
