import type { PrismaClient, Prisma } from "../generated/prisma/client.js";
import { EstadoFisico, StatusLote, StatusRastreamento, TipoEquipamento } from "../generated/prisma/client.js";
import { registrarAuditoria } from "../repositories/auditoria.repository.js";
import { buscarLotePorIdentificador, identificadorLote } from "../repositories/lote.repository.js";
import { buscarEquipamentoPorIdentificador, identificadorEquipamento } from "../repositories/equipamento.repository.js";
import { proximoCodigoBarras, proximoCodigoEquipamento, proximoCodigoLote } from "../utils/codigos.js";
import { validarAnoPeso, validarDataEntrada, validarTransicao, ORDEM_ESTADOS_FISICOS } from "../utils/estados.js";
import { HttpError } from "../utils/http-error.js";
import type { Ator } from "./organizacao.service.js";

export async function criarLote(db: PrismaClient, ator: Ator, input: any) {
  const organizacaoId = String(input.organizacaoId ?? "");
  const notaFiscal = String(input.notaFiscal ?? "").trim();
  const transportadora = String(input.transportadora ?? "").trim();
  if (!notaFiscal || !transportadora) throw new HttpError(400, "Nota fiscal e transportadora são obrigatórias.");
  const dataEntrada = validarDataEntrada(input.dataEntrada);
  return db.$transaction(async (tx) => {
    const org = await tx.organizacao.findFirst({ where: { OR: [{ id: organizacaoId.match(/^[0-9a-f-]{36}$/i) ? organizacaoId : "00000000-0000-0000-0000-000000000000" }, { codigo: organizacaoId }] }, include: { contrato: true } });
    if (!org) throw new HttpError(404, "Organização não encontrada.");
    if (!org.ativo) throw new HttpError(400, "Não é possível criar lote para organização inativa.");
    if (!org.contrato || org.contrato.dataVencimento <= new Date()) throw new HttpError(400, "A organização precisa ter contrato vigente.");
    const codigo = await proximoCodigoLote(tx);
    const lote = await tx.lote.create({ data: { codigo, organizacaoId: org.id, dataEntrada, notaFiscal, transportadora, observacoes: String(input.observacoes ?? "").trim() } });
    await registrarAuditoria(tx, ator, "CRIAR_LOTE", "Lote", lote.id, { codigo, organizacaoId: org.id, notaFiscal });
    return lote;
  });
}

export async function listarLotes(db: PrismaClient, query: { inicio?: string; fim?: string; status?: StatusLote }) {
  const where: Prisma.LoteWhereInput = {};
  if (query.status) where.statusProcessamento = query.status;
  if (query.inicio || query.fim) {
    const inicio = query.inicio ? new Date(`${query.inicio}T00:00:00.000Z`) : new Date("1970-01-01T00:00:00.000Z");
    const fim = query.fim ? new Date(`${query.fim}T23:59:59.999Z`) : new Date("2999-12-31T23:59:59.999Z");
    if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime()) || inicio > fim) throw new HttpError(400, "Período inválido.");
    where.dataEntrada = { gte: inicio, lte: fim };
  }
  return db.lote.findMany({ where, include: { organizacao: { select: { id: true, codigo: true, razaoSocial: true } }, _count: { select: { equipamentos: true } } }, orderBy: [{ dataEntrada: "desc" }, { codigo: "asc" }] });
}

export async function buscarLote(db: PrismaClient, id: string) {
  const lote = await db.lote.findFirst({ where: identificadorLote(id), include: { organizacao: { include: { contrato: true } }, equipamentos: { include: { movimentacoes: { orderBy: { dataHora: "asc" } } }, orderBy: { posicaoNoLote: "asc" } } } });
  if (!lote) throw new HttpError(404, "Lote não encontrado.");
  return lote;
}

export async function adicionarEquipamento(db: PrismaClient, ator: Ator, loteIdInformado: string, input: any) {
  const { anoFabricacao, pesoQuilogramas } = validarAnoPeso(input.anoFabricacao, input.pesoQuilogramas);
  if (!Object.values(TipoEquipamento).includes(input.tipo)) throw new HttpError(400, "Tipo de equipamento inválido.");
  if (!Object.values(EstadoFisico).includes(input.estadoFisico ?? "NOVO")) throw new HttpError(400, "Estado físico inválido.");
  const marca = String(input.marca ?? "").trim(); const modelo = String(input.modelo ?? "").trim();
  if (!marca || !modelo) throw new HttpError(400, "Marca e modelo são obrigatórios.");
  return db.$transaction(async (tx) => {
    const lote = await buscarLotePorIdentificador(tx, loteIdInformado);
    if (!lote) throw new HttpError(404, "Lote não encontrado.");
    if (lote.statusProcessamento !== StatusLote.RECEBIDO) throw new HttpError(409, "Só é possível adicionar equipamentos a lotes com status RECEBIDO.");
    if (!Number.isInteger(Number(input.versao)) || lote.versao !== Number(input.versao)) throw new HttpError(409, "Conflito de versão do lote. Recarregue e tente novamente.");
    const posicaoNoLote = (await tx.equipamento.count({ where: { loteId: lote.id } })) + 1;
    const codigo = await proximoCodigoEquipamento(tx);
    const equipamento = await tx.equipamento.create({ data: { codigo, tipo: input.tipo, marca, modelo, anoFabricacao, estadoFisico: input.estadoFisico ?? EstadoFisico.NOVO, pesoQuilogramas, loteId: lote.id, posicaoNoLote } });
    await tx.movimentacao.create({ data: { equipamentoId: equipamento.id, origem: "ENTRADA_LOTE", destino: StatusRastreamento.AGUARDANDO_TRIAGEM, responsavel: ator.login, observacao: "Equipamento incluído no lote." } });
    const loteAtualizado = await tx.lote.updateMany({ where: { id: lote.id, versao: Number(input.versao) }, data: { versao: { increment: 1 } } });
    if (loteAtualizado.count !== 1) throw new HttpError(409, "Conflito de versão do lote.");
    await registrarAuditoria(tx, ator, "ADICIONAR_EQUIPAMENTO", "Equipamento", equipamento.id, { codigo, loteId: lote.id, versao: equipamento.versao });
    await registrarAuditoria(tx, ator, "ATUALIZAR_LOTE_EQUIPAMENTOS", "Lote", lote.id, { equipamentoId: equipamento.id, versaoAnterior: lote.versao });
    return { ...equipamento, loteVersao: lote.versao + 1 };
  });
}

export async function processarTriagem(db: PrismaClient, ator: Ator, loteIdInformado: string, versao: number) {
  return db.$transaction(async (tx) => {
    const lote = await buscarLotePorIdentificador(tx, loteIdInformado);
    if (!lote) throw new HttpError(404, "Lote não encontrado.");
    if (lote.versao !== versao) throw new HttpError(409, "Conflito de versão do lote. Recarregue e tente novamente.");
    const equipamentos = await tx.equipamento.findMany({ where: { loteId: lote.id }, orderBy: { posicaoNoLote: "asc" } });
    if (lote.statusProcessamento === StatusLote.RECEBIDO) {
      if (equipamentos.length === 0) throw new HttpError(400, "Lote sem equipamentos não pode entrar em triagem.");
      for (const equipamento of equipamentos) {
        const codigoBarrasInterno = equipamento.codigoBarrasInterno ?? await proximoCodigoBarras(tx, equipamento.tipo);
        const changed = await tx.equipamento.updateMany({ where: { id: equipamento.id, versao: equipamento.versao }, data: { codigoBarrasInterno, statusRastreamento: StatusRastreamento.EM_TRIAGEM, versao: { increment: 1 } } });
        if (changed.count !== 1) throw new HttpError(409, `Conflito de versão do equipamento ${equipamento.codigo}.`);
        await tx.movimentacao.create({ data: { equipamentoId: equipamento.id, origem: equipamento.statusRastreamento, destino: StatusRastreamento.EM_TRIAGEM, responsavel: ator.login, observacao: "Primeira etapa da triagem; código de barras gerado." } });
        await registrarAuditoria(tx, ator, "INICIAR_TRIAGEM_EQUIPAMENTO", "Equipamento", equipamento.id, { codigoBarrasInterno, versaoAnterior: equipamento.versao });
      }
      const result = await tx.lote.updateMany({ where: { id: lote.id, versao }, data: { statusProcessamento: StatusLote.EM_TRIAGEM, versao: { increment: 1 } } });
      if (result.count !== 1) throw new HttpError(409, "Conflito de versão do lote.");
      await registrarAuditoria(tx, ator, "INICIAR_TRIAGEM", "Lote", lote.id, { quantidadeEquipamentos: equipamentos.length, versaoAnterior: versao });
    } else if (lote.statusProcessamento === StatusLote.EM_TRIAGEM) {
      if (equipamentos.length === 0 || equipamentos.some((e) => !e.codigoBarrasInterno)) throw new HttpError(400, "Triagem incompleta: todos os equipamentos precisam de código de barras.");
      const result = await tx.lote.updateMany({ where: { id: lote.id, versao }, data: { statusProcessamento: StatusLote.TRIAGEM_CONCLUIDA, versao: { increment: 1 } } });
      if (result.count !== 1) throw new HttpError(409, "Conflito de versão do lote.");
      await registrarAuditoria(tx, ator, "CONCLUIR_TRIAGEM", "Lote", lote.id, { quantidadeEquipamentos: equipamentos.length, versaoAnterior: versao });
    } else {
      throw new HttpError(409, `Lote ${lote.codigo} está em ${lote.statusProcessamento}; não há triagem a processar.`);
    }
    return tx.lote.findUniqueOrThrow({ where: { id: lote.id }, include: { equipamentos: { orderBy: { posicaoNoLote: "asc" } } } });
  });
}

export async function movimentarEquipamento(db: PrismaClient, ator: Ator, idOuCodigo: string, input: { destino: StatusRastreamento; justificativa?: string; versao: number }) {
  const justificativa = String(input.justificativa ?? "").trim();
  return db.$transaction(async (tx) => {
    const equipamento = await buscarEquipamentoPorIdentificador(tx, idOuCodigo);
    if (!equipamento) throw new HttpError(404, "Equipamento não encontrado.");
    if (equipamento.versao !== input.versao) throw new HttpError(409, "Conflito de versão do equipamento. Recarregue e tente novamente.");
    const lote = await tx.lote.findUnique({ where: { id: equipamento.loteId } });
    if (!lote) throw new HttpError(404, "Lote do equipamento não encontrado.");
    if (!([StatusLote.TRIAGEM_CONCLUIDA, StatusLote.ENCAMINHADO] as StatusLote[]).includes(lote.statusProcessamento)) throw new HttpError(409, "Movimentações só são permitidas após a conclusão da triagem do lote.");
    validarTransicao(equipamento.statusRastreamento, input.destino, justificativa);
    const changed = await tx.equipamento.updateMany({ where: { id: equipamento.id, versao: input.versao }, data: { statusRastreamento: input.destino, versao: { increment: 1 } } });
    if (changed.count !== 1) throw new HttpError(409, "Conflito de versão do equipamento.");
    const movimentacao = await tx.movimentacao.create({ data: { equipamentoId: equipamento.id, origem: equipamento.statusRastreamento, destino: input.destino, responsavel: ator.login, observacao: justificativa } });
    await registrarAuditoria(tx, ator, "MUDAR_STATUS_EQUIPAMENTO", "Equipamento", equipamento.id, { origem: equipamento.statusRastreamento, destino: input.destino, versaoAnterior: input.versao });

    const depois = await tx.equipamento.findMany({ where: { loteId: lote.id }, select: { statusRastreamento: true } });
    if (depois.length > 0 && depois.every((e) => e.statusRastreamento === StatusRastreamento.BAIXA_DEFINITIVA) && lote.statusProcessamento !== StatusLote.FINALIZADO) {
      const updatedLot = await tx.lote.updateMany({ where: { id: lote.id, versao: lote.versao }, data: { statusProcessamento: StatusLote.FINALIZADO, versao: { increment: 1 } } });
      if (updatedLot.count !== 1) throw new HttpError(409, "Conflito de versão do lote ao finalizar.");
      await registrarAuditoria(tx, ator, "FINALIZAR_LOTE", "Lote", lote.id, { statusAnterior: lote.statusProcessamento });
    } else if (lote.statusProcessamento === StatusLote.TRIAGEM_CONCLUIDA && input.destino !== StatusRastreamento.EM_TRIAGEM) {
      const updatedLot = await tx.lote.updateMany({ where: { id: lote.id, versao: lote.versao }, data: { statusProcessamento: StatusLote.ENCAMINHADO, versao: { increment: 1 } } });
      if (updatedLot.count !== 1) throw new HttpError(409, "Conflito de versão do lote.");
      await registrarAuditoria(tx, ator, "ENCAMINHAR_LOTE", "Lote", lote.id, { statusAnterior: lote.statusProcessamento });
    }
    return { equipamento: await tx.equipamento.findUniqueOrThrow({ where: { id: equipamento.id } }), movimentacao };
  });
}

export async function atualizarEstadoFisico(db: PrismaClient, ator: Ator, idOuCodigo: string, input: { estadoFisico: EstadoFisico; justificativa?: string; versao: number }) {
  const justificativa = String(input.justificativa ?? "").trim();
  return db.$transaction(async (tx) => {
    const equipamento = await buscarEquipamentoPorIdentificador(tx, idOuCodigo);
    if (!equipamento) throw new HttpError(404, "Equipamento não encontrado.");
    if (equipamento.versao !== input.versao) throw new HttpError(409, "Conflito de versão do equipamento.");
    if (!Object.values(EstadoFisico).includes(input.estadoFisico)) throw new HttpError(400, "Estado físico inválido.");
    if (input.estadoFisico === equipamento.estadoFisico) throw new HttpError(400, "O equipamento já está nesse estado físico.");
    const antigo = ORDEM_ESTADOS_FISICOS.indexOf(equipamento.estadoFisico);
    const novo = ORDEM_ESTADOS_FISICOS.indexOf(input.estadoFisico);
    const queda = novo - antigo;
    if (queda >= 2 && !justificativa) throw new HttpError(400, `Justificativa obrigatória: estado caiu ${queda} categorias.`);
    const changed = await tx.equipamento.updateMany({ where: { id: equipamento.id, versao: input.versao }, data: { estadoFisico: input.estadoFisico, versao: { increment: 1 } } });
    if (changed.count !== 1) throw new HttpError(409, "Conflito de versão do equipamento.");
    await registrarAuditoria(tx, ator, "ATUALIZAR_ESTADO_FISICO", "Equipamento", equipamento.id, { estadoAnterior: equipamento.estadoFisico, estadoNovo: input.estadoFisico, justificativa, versaoAnterior: input.versao });
    return tx.equipamento.findUniqueOrThrow({ where: { id: equipamento.id } });
  });
}

export async function rastrearEquipamento(db: PrismaClient, idOuCodigo: string) {
  const where = identificadorEquipamento(idOuCodigo);
  const equipamento = await db.equipamento.findFirst({ where, include: { lote: { include: { organizacao: { select: { id: true, codigo: true, razaoSocial: true } } } }, movimentacoes: { orderBy: { dataHora: "asc" } } } });
  if (!equipamento) throw new HttpError(404, "Equipamento não encontrado.");
  return { equipamento, movimentacoes: equipamento.movimentacoes };
}
