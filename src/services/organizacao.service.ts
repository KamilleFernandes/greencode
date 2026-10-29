import type { PrismaClient } from "../generated/prisma/client.js";
import { registrarJournal, type Ator } from "../repositories/auditoria.repository.js";
import {
  atualizarContratoVersionado, atualizarOrganizacaoVersionada, contratoPorId, criarOrganizacaoComContrato,
  listarOrganizacoes as listarRepo, organizacaoPorCnpj, organizacaoPorId, organizacaoPorIdentificador
} from "../repositories/organizacao.repository.js";
import { proximoCodigoContrato, proximoCodigoOrganizacao } from "../repositories/sequencia.repository.js";
import { normalizarCnpj, validarCnpj } from "../utils/cnpj.js";
import { HttpError } from "../utils/http-error.js";

export type { Ator };

function dataValida(data: unknown, nome: string): Date {
  const d = new Date(String(data ?? ""));
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `${nome} inválida.`);
  return d;
}

export async function criarOrganizacao(db: PrismaClient, ator: Ator, input: any) {
  const razaoSocial = String(input.razaoSocial ?? "").trim();
  const cnpj = normalizarCnpj(input.cnpj);
  const inscricaoEstadual = String(input.inscricaoEstadual ?? "").trim();
  const enderecoCompleto = String(input.enderecoCompleto ?? "").trim();
  const telefone = String(input.telefone ?? "").trim();
  const email = String(input.email ?? "").trim();
  if (!razaoSocial || !inscricaoEstadual || !enderecoCompleto || !telefone || !email) {
    throw new HttpError(400, "Razão social, inscrição estadual, endereço, telefone e e-mail são obrigatórios.");
  }
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
      if (await organizacaoPorCnpj(tx, cnpj)) throw new HttpError(409, "Já existe uma organização com esse CNPJ.");
      const codigo = await proximoCodigoOrganizacao(tx);
      const codigoContrato = await proximoCodigoContrato(tx);
      const org = await criarOrganizacaoComContrato(
        tx,
        { codigo, razaoSocial, cnpj, inscricaoEstadual, enderecoCompleto, telefone, email },
        { codigo: codigoContrato, dataAssinatura: assinatura, dataVencimento: vencimento, clausulas, valorMensal, renovacaoAutomatica: Boolean(input.contrato.renovacaoAutomatica) }
      );
      await registrarJournal(tx, ator, { operacao: "CRIAR_ORGANIZACAO", entidade: "Organizacao", entidadeId: org.id, dadosDepois: { codigo, razaoSocial, cnpj } });
      await registrarJournal(tx, ator, { operacao: "CRIAR_CONTRATO", entidade: "Contrato", entidadeId: org.contrato.id, dadosDepois: { codigo: codigoContrato, organizacaoId: org.id, dataVencimento: vencimento, valorMensal } });
      return org;
    });
  } catch (error: any) {
    if (error?.code === "P2002") throw new HttpError(409, "Já existe uma organização com esse CNPJ ou código.");
    throw error;
  }
}

export const listarOrganizacoes = (db: PrismaClient, incluirInativas = false) => listarRepo(db, incluirInativas);

export async function buscarOrganizacao(db: PrismaClient, ref: string) {
  const org = await organizacaoPorIdentificador(db, ref);
  if (!org) throw new HttpError(404, "Organização não encontrada.");
  return org;
}

export async function renovarContrato(db: PrismaClient, ator: Ator, ref: string, input: { dataVencimento: string; versao: number }) {
  return db.$transaction(async (tx) => {
    const org = await organizacaoPorIdentificador(tx, ref);
    if (!org) throw new HttpError(404, "Organização não encontrada.");
    if (!org.contrato) throw new HttpError(404, "Contrato não encontrado para a organização.");
    const contrato = org.contrato;
    if (contrato.versao !== input.versao) throw new HttpError(409, "Conflito de versão do contrato. Recarregue e tente novamente.");
    const vencimento = dataValida(input.dataVencimento, "Data de vencimento");
    if (vencimento <= contrato.dataVencimento || vencimento <= new Date()) throw new HttpError(400, "O novo vencimento deve ser posterior ao vencimento atual e futuro.");
    await atualizarContratoVersionado(tx, contrato.id, input.versao, { dataVencimento: vencimento });
    await registrarJournal(tx, ator, { operacao: "RENOVAR_CONTRATO", entidade: "Contrato", entidadeId: contrato.id, dadosAntes: { dataVencimento: contrato.dataVencimento }, dadosDepois: { dataVencimento: vencimento } });
    return contratoPorId(tx, contrato.id);
  });
}

export async function desativarOrganizacao(db: PrismaClient, ator: Ator, ref: string, versao: number) {
  return db.$transaction(async (tx) => {
    const org = await organizacaoPorIdentificador(tx, ref);
    if (!org) throw new HttpError(404, "Organização não encontrada.");
    if (org.versao !== versao) throw new HttpError(409, "Conflito de versão da organização.");
    await atualizarOrganizacaoVersionada(tx, org.id, versao, { ativo: false });
    await registrarJournal(tx, ator, { operacao: "DESATIVAR_ORGANIZACAO", entidade: "Organizacao", entidadeId: org.id, dadosAntes: { ativo: org.ativo }, dadosDepois: { ativo: false } });
    return organizacaoPorId(tx, org.id);
  });
}
