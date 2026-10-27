import type { PrismaClient, Prisma } from "../generated/prisma/client.js";
import { registrarAuditoria } from "../repositories/auditoria.repository.js";
import { identificadorOrganizacao } from "../repositories/organizacao.repository.js";
import { proximoCodigoContrato, proximoCodigoOrganizacao } from "../utils/codigos.js";
import { normalizarCnpj, validarCnpj } from "../utils/cnpj.js";
import { HttpError } from "../utils/http-error.js";

export type Ator = { id: string; login: string };

function dataValida(data: unknown, nome: string): Date {
  const resultado = new Date(String(data ?? ""));
  if (Number.isNaN(resultado.getTime())) throw new HttpError(400, `${nome} inválida.`);
  return resultado;
}

export async function criarOrganizacao(db: PrismaClient, ator: Ator, input: any) {
  const razaoSocial = String(input.razaoSocial ?? "").trim();
  const cnpj = normalizarCnpj(input.cnpj);
  const enderecoCompleto = String(input.enderecoCompleto ?? "").trim();
  const telefone = String(input.telefone ?? "").trim();
  const email = String(input.email ?? "").trim();
  if (!razaoSocial || !enderecoCompleto || !telefone || !email) throw new HttpError(400, "Razão social, endereço, telefone e e-mail são obrigatórios.");
  if (!validarCnpj(cnpj)) throw new HttpError(400, "CNPJ inválido.");
  if (!input.contrato) throw new HttpError(400, "Contrato obrigatório para cadastrar a organização.");
  const assinatura = dataValida(input.contrato.dataAssinatura, "Data de assinatura");
  const vencimento = dataValida(input.contrato.dataVencimento, "Data de vencimento");
  if (vencimento <= assinatura) throw new HttpError(400, "O vencimento deve ser posterior à assinatura.");
  if (vencimento <= new Date()) throw new HttpError(400, "O contrato deve ter vencimento futuro.");
  const valorMensal = Number(input.contrato.valorMensal);
  if (!Number.isFinite(valorMensal) || valorMensal < 0) throw new HttpError(400, "Valor mensal deve ser não negativo.");
  const clausulas: string[] = Array.isArray(input.contrato.clausulas) ? input.contrato.clausulas.map((x: unknown) => String(x).trim()).filter(Boolean) : [];

  try {
    return await db.$transaction(async (tx) => {
      const codigo = await proximoCodigoOrganizacao(tx);
      const codigoContrato = await proximoCodigoContrato(tx);
      const org = await tx.organizacao.create({ data: { codigo, razaoSocial, cnpj, inscricaoEstadual: input.inscricaoEstadual ? String(input.inscricaoEstadual).trim() : null, enderecoCompleto, telefone, email } });
      const contrato = await tx.contrato.create({ data: { codigo: codigoContrato, organizacaoId: org.id, dataAssinatura: assinatura, dataVencimento: vencimento, clausulas, valorMensal, renovacaoAutomatica: Boolean(input.contrato.renovacaoAutomatica) } });
      await registrarAuditoria(tx, ator, "CRIAR_ORGANIZACAO", "Organizacao", org.id, { codigo: org.codigo, cnpj: org.cnpj });
      await registrarAuditoria(tx, ator, "CRIAR_CONTRATO", "Contrato", contrato.id, { codigo: contrato.codigo, organizacaoId: org.id });
      return { ...org, contrato };
    });
  } catch (error: any) {
    if (error?.code === "P2002") throw new HttpError(409, "Já existe uma organização com esse CNPJ ou código.");
    throw error;
  }
}

export async function listarOrganizacoes(db: PrismaClient, incluirInativas = false) {
  return db.organizacao.findMany({ where: incluirInativas ? {} : { ativo: true }, include: { contrato: true }, orderBy: { codigo: "asc" } });
}

export async function buscarOrganizacao(db: PrismaClient, id: string) {
  const organizacao = await db.organizacao.findFirst({ where: identificadorOrganizacao(id), include: { contrato: true } });
  if (!organizacao) throw new HttpError(404, "Organização não encontrada.");
  return organizacao;
}

export async function renovarContrato(db: PrismaClient, ator: Ator, organizacaoId: string, input: { dataVencimento: string; versao: number }) {
  return db.$transaction(async (tx) => {
    const org = await tx.organizacao.findFirst({ where: identificadorOrganizacao(organizacaoId), include: { contrato: true } });
    if (!org) throw new HttpError(404, "Organização não encontrada.");
    if (!org.contrato) throw new HttpError(404, "Contrato não encontrado para a organização.");
    const contrato = org.contrato;
    if (contrato.versao !== input.versao) throw new HttpError(409, "Conflito de versão do contrato. Recarregue e tente novamente.");
    const vencimento = dataValida(input.dataVencimento, "Data de vencimento");
    if (vencimento <= contrato.dataVencimento || vencimento <= new Date()) throw new HttpError(400, "O novo vencimento deve ser posterior ao vencimento atual e futuro.");
    const changed = await tx.contrato.updateMany({ where: { id: contrato.id, versao: input.versao }, data: { dataVencimento: vencimento, versao: { increment: 1 } } });
    if (changed.count !== 1) throw new HttpError(409, "Conflito de versão do contrato.");
    const atualizado = await tx.contrato.findUniqueOrThrow({ where: { id: contrato.id } });
    await registrarAuditoria(tx, ator, "RENOVAR_CONTRATO", "Contrato", contrato.id, { vencimentoAnterior: contrato.dataVencimento.toISOString(), vencimentoNovo: vencimento.toISOString(), versaoAnterior: contrato.versao });
    return atualizado;
  });
}

export async function desativarOrganizacao(db: PrismaClient, ator: Ator, id: string, versao: number) {
  return db.$transaction(async (tx) => {
    const org = await tx.organizacao.findFirst({ where: identificadorOrganizacao(id) });
    if (!org) throw new HttpError(404, "Organização não encontrada.");
    if (org.versao !== versao) throw new HttpError(409, "Conflito de versão da organização.");
    const changed = await tx.organizacao.updateMany({ where: { id: org.id, versao }, data: { ativo: false, versao: { increment: 1 } } });
    if (changed.count !== 1) throw new HttpError(409, "Conflito de versão da organização.");
    await registrarAuditoria(tx, ator, "DESATIVAR_ORGANIZACAO", "Organizacao", org.id, { versaoAnterior: versao });
    return tx.organizacao.findUniqueOrThrow({ where: { id: org.id } });
  });
}
