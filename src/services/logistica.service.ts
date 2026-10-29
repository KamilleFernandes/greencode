import type { Prisma, PrismaClient, StatusLote as StatusLoteT } from "../generated/prisma/client.js";
import { EstadoFisico, StatusLote, StatusRastreamento, TipoEquipamento } from "../generated/prisma/client.js";
import { registrarJournal, type Ator } from "../repositories/auditoria.repository.js";
import type { Tx } from "../repositories/db.js";
import { atualizarEquipamentoVersionado, criarEquipamento, equipamentoPorId, equipamentoPorIdentificador, equipamentoRastreio, equipamentosDoLote, proximaPosicaoNoLote, statusDosEquipamentosDoLote } from "../repositories/equipamento.repository.js";
import { atualizarLoteVersionado, bloquearLote, criarLote as criarLoteRepo, listarLotes as listarLotesRepo, loteComEquipamentos, loteDetalhado, lotePorId, lotePorIdentificador } from "../repositories/lote.repository.js";
import { criarMovimentacao } from "../repositories/movimentacao.repository.js";
import { organizacaoPorIdentificador } from "../repositories/organizacao.repository.js";
import { proximoCodigoBarras, proximoCodigoEquipamento, proximoCodigoLote } from "../repositories/sequencia.repository.js";
import { periodoPorData, validarAnoPeso, validarDataEntrada, validarMudancaEstadoFisico, validarTransicao } from "../utils/estados.js";
import { HttpError } from "../utils/http-error.js";

export type { Ator };
type EntradaEquipamento = { tipo: TipoEquipamento; marca: string; modelo: string; anoFabricacao: number; estadoFisico?: EstadoFisico; pesoQuilogramas: number };

/** Valida e normaliza os dados de um equipamento (usado ao criar o lote e ao adicionar itens). */
function normalizarEquipamento(input: any): Required<EntradaEquipamento> {
  const { anoFabricacao, pesoQuilogramas } = validarAnoPeso(input?.anoFabricacao, input?.pesoQuilogramas);
  if (!Object.values(TipoEquipamento).includes(input?.tipo)) throw new HttpError(400, "Tipo de equipamento inválido.");
  const estadoFisico = input?.estadoFisico ?? EstadoFisico.NOVO;
  if (!Object.values(EstadoFisico).includes(estadoFisico)) throw new HttpError(400, "Estado físico inválido.");
  const marca = String(input?.marca ?? "").trim();
  const modelo = String(input?.modelo ?? "").trim();
  if (!marca || !modelo) throw new HttpError(400, "Marca e modelo são obrigatórios.");
  return { tipo: input.tipo, marca, modelo, anoFabricacao, estadoFisico, pesoQuilogramas };
}

/** Cria o equipamento, a movimentação de entrada e o registro no journal (sempre dentro de uma transação). */
async function inserirEquipamento(tx: Tx, ator: Ator, loteId: string, dados: Required<EntradaEquipamento>, posicaoNoLote: number) {
  const codigo = await proximoCodigoEquipamento(tx);
  const equipamento = await criarEquipamento(tx, { codigo, loteId, posicaoNoLote, ...dados });
  await criarMovimentacao(tx, { equipamentoId: equipamento.id, origem: "ENTRADA_LOTE", destino: StatusRastreamento.AGUARDANDO_TRIAGEM, responsavel: ator.login, observacao: "Equipamento incluído no lote." });
  await registrarJournal(tx, ator, { operacao: "ADICIONAR_EQUIPAMENTO", entidade: "Equipamento", entidadeId: equipamento.id, dadosDepois: { codigo, loteId, posicaoNoLote, ...dados } });
  return equipamento;
}

/** Cria o lote e, opcionalmente, todos os seus equipamentos em UMA transação: tudo é gravado ou nada. */
export async function criarLote(db: PrismaClient, ator: Ator, input: any) {
  const notaFiscal = String(input.notaFiscal ?? "").trim();
  const transportadora = String(input.transportadora ?? "").trim();
  if (!notaFiscal || !transportadora) throw new HttpError(400, "Nota fiscal e transportadora são obrigatórias.");
  const dataEntrada = validarDataEntrada(input.dataEntrada);
  const itens = (Array.isArray(input.equipamentos) ? input.equipamentos : []).map(normalizarEquipamento);
  return db.$transaction(async (tx) => {
    const org = await organizacaoPorIdentificador(tx, String(input.organizacaoId ?? ""));
    if (!org) throw new HttpError(404, "Organização não encontrada.");
    if (!org.ativo) throw new HttpError(400, "Não é possível criar lote para organização inativa.");
    if (!org.contrato || org.contrato.dataVencimento <= new Date()) throw new HttpError(400, "A organização precisa ter contrato vigente.");
    const codigo = await proximoCodigoLote(tx);
    const lote = await criarLoteRepo(tx, { codigo, organizacaoId: org.id, dataEntrada, notaFiscal, transportadora, observacoes: String(input.observacoes ?? "").trim() });
    await registrarJournal(tx, ator, { operacao: "CRIAR_LOTE", entidade: "Lote", entidadeId: lote.id, dadosDepois: { codigo, organizacaoId: org.id, notaFiscal, transportadora, dataEntrada, quantidadeEquipamentos: itens.length } });
    for (const [i, item] of itens.entries()) await inserirEquipamento(tx, ator, lote.id, item, i + 1);
    return loteComEquipamentos(tx, lote.id);
  });
}

export async function listarLotes(db: PrismaClient, query: { inicio?: string; fim?: string; status?: StatusLoteT }) {
  const where: Prisma.LoteWhereInput = {};
  if (query.status) where.statusProcessamento = query.status;
  if (query.inicio || query.fim) {
    const p = periodoPorData(query.inicio ?? "1970-01-01", query.fim ?? "2999-12-31");
    where.dataEntrada = { gte: p.inicio, lte: p.fim };
  }
  return listarLotesRepo(db, where);
}

export async function buscarLote(db: PrismaClient, ref: string) {
  const lote = await loteDetalhado(db, ref);
  if (!lote) throw new HttpError(404, "Lote não encontrado.");
  return lote;
}

export async function adicionarEquipamento(db: PrismaClient, ator: Ator, ref: string, input: any) {
  const dados = normalizarEquipamento(input);
  return db.$transaction(async (tx) => {
    const achado = await lotePorIdentificador(tx, ref);
    if (!achado) throw new HttpError(404, "Lote não encontrado.");
    await bloquearLote(tx, achado.id); // inclusões simultâneas no mesmo lote são serializadas
    const lote = await lotePorId(tx, achado.id);
    if (lote.statusProcessamento !== StatusLote.RECEBIDO) throw new HttpError(409, "Só é possível adicionar equipamentos a lotes com status RECEBIDO.");
    if (input.versao !== undefined && input.versao !== lote.versao) throw new HttpError(409, "Conflito de versão do lote. Recarregue e tente novamente.");
    const equipamento = await inserirEquipamento(tx, ator, lote.id, dados, await proximaPosicaoNoLote(tx, lote.id));
    return { ...equipamento, loteVersao: lote.versao };
  });
}

/** Triagem em duas etapas: 1ª gera códigos de barras (EM_TRIAGEM); 2ª conclui (TRIAGEM_CONCLUIDA). */
export async function processarTriagem(db: PrismaClient, ator: Ator, ref: string, versao: number) {
  return db.$transaction(async (tx) => {
    const achado = await lotePorIdentificador(tx, ref);
    if (!achado) throw new HttpError(404, "Lote não encontrado.");
    await bloquearLote(tx, achado.id);
    const lote = await lotePorId(tx, achado.id);
    if (lote.versao !== versao) throw new HttpError(409, "Conflito de versão do lote. Recarregue e tente novamente.");
    const equipamentos = await equipamentosDoLote(tx, lote.id);

    if (lote.statusProcessamento === StatusLote.RECEBIDO) {
      if (equipamentos.length === 0) throw new HttpError(400, "Lote sem equipamentos não pode entrar em triagem.");
      for (const eq of equipamentos) {
        const codigoBarrasInterno = eq.codigoBarrasInterno ?? (await proximoCodigoBarras(tx, eq.tipo));
        await atualizarEquipamentoVersionado(tx, eq.id, eq.versao, { codigoBarrasInterno, statusRastreamento: StatusRastreamento.EM_TRIAGEM });
        await criarMovimentacao(tx, { equipamentoId: eq.id, origem: eq.statusRastreamento, destino: StatusRastreamento.EM_TRIAGEM, responsavel: ator.login, observacao: "Primeira etapa da triagem; código de barras gerado." });
        await registrarJournal(tx, ator, { operacao: "INICIAR_TRIAGEM_EQUIPAMENTO", entidade: "Equipamento", entidadeId: eq.id, dadosAntes: { statusRastreamento: eq.statusRastreamento, codigoBarrasInterno: eq.codigoBarrasInterno }, dadosDepois: { statusRastreamento: StatusRastreamento.EM_TRIAGEM, codigoBarrasInterno } });
      }
      await atualizarLoteVersionado(tx, lote.id, versao, { statusProcessamento: StatusLote.EM_TRIAGEM });
      await registrarJournal(tx, ator, { operacao: "INICIAR_TRIAGEM", entidade: "Lote", entidadeId: lote.id, dadosAntes: { statusProcessamento: lote.statusProcessamento }, dadosDepois: { statusProcessamento: StatusLote.EM_TRIAGEM, quantidadeEquipamentos: equipamentos.length } });
    } else if (lote.statusProcessamento === StatusLote.EM_TRIAGEM) {
      if (equipamentos.length === 0 || equipamentos.some((e) => !e.codigoBarrasInterno)) throw new HttpError(400, "Triagem incompleta: todos os equipamentos precisam de código de barras.");
      await atualizarLoteVersionado(tx, lote.id, versao, { statusProcessamento: StatusLote.TRIAGEM_CONCLUIDA });
      await registrarJournal(tx, ator, { operacao: "CONCLUIR_TRIAGEM", entidade: "Lote", entidadeId: lote.id, dadosAntes: { statusProcessamento: lote.statusProcessamento }, dadosDepois: { statusProcessamento: StatusLote.TRIAGEM_CONCLUIDA } });
    } else {
      throw new HttpError(409, `Lote ${lote.codigo} está em ${lote.statusProcessamento}; não há triagem a processar.`);
    }
    return loteComEquipamentos(tx, lote.id);
  });
}

export async function movimentarEquipamento(db: PrismaClient, ator: Ator, ref: string, input: { destino: StatusRastreamento; justificativa?: string; versao: number }) {
  const justificativa = String(input.justificativa ?? "").trim();
  return db.$transaction(async (tx) => {
    const achado = await equipamentoPorIdentificador(tx, ref);
    if (!achado) throw new HttpError(404, "Equipamento não encontrado.");
    await bloquearLote(tx, achado.loteId); // evita corrida na mudança de status do lote
    const equipamento = await equipamentoPorId(tx, achado.id);
    const lote = await lotePorId(tx, equipamento.loteId);
    if (equipamento.versao !== input.versao) throw new HttpError(409, "Conflito de versão do equipamento. Recarregue e tente novamente.");
    if (!([StatusLote.TRIAGEM_CONCLUIDA, StatusLote.ENCAMINHADO] as StatusLoteT[]).includes(lote.statusProcessamento)) {
      throw new HttpError(409, "Movimentações só são permitidas após a conclusão da triagem do lote.");
    }
    validarTransicao(equipamento.statusRastreamento, input.destino, justificativa);
    await atualizarEquipamentoVersionado(tx, equipamento.id, input.versao, { statusRastreamento: input.destino });
    const movimentacao = await criarMovimentacao(tx, { equipamentoId: equipamento.id, origem: equipamento.statusRastreamento, destino: input.destino, responsavel: ator.login, observacao: justificativa });
    await registrarJournal(tx, ator, { operacao: "MUDAR_STATUS_EQUIPAMENTO", entidade: "Equipamento", entidadeId: equipamento.id, dadosAntes: { statusRastreamento: equipamento.statusRastreamento }, dadosDepois: { statusRastreamento: input.destino, justificativa } });

    const todos = await statusDosEquipamentosDoLote(tx, lote.id);
    if (todos.every((e) => e.statusRastreamento === StatusRastreamento.BAIXA_DEFINITIVA) && lote.statusProcessamento !== StatusLote.FINALIZADO) {
      await atualizarLoteVersionado(tx, lote.id, lote.versao, { statusProcessamento: StatusLote.FINALIZADO });
      await registrarJournal(tx, ator, { operacao: "FINALIZAR_LOTE", entidade: "Lote", entidadeId: lote.id, dadosAntes: { statusProcessamento: lote.statusProcessamento }, dadosDepois: { statusProcessamento: StatusLote.FINALIZADO } });
    } else if (lote.statusProcessamento === StatusLote.TRIAGEM_CONCLUIDA) {
      await atualizarLoteVersionado(tx, lote.id, lote.versao, { statusProcessamento: StatusLote.ENCAMINHADO });
      await registrarJournal(tx, ator, { operacao: "ENCAMINHAR_LOTE", entidade: "Lote", entidadeId: lote.id, dadosAntes: { statusProcessamento: lote.statusProcessamento }, dadosDepois: { statusProcessamento: StatusLote.ENCAMINHADO } });
    }
    return { equipamento: await equipamentoPorId(tx, equipamento.id), movimentacao };
  });
}

export async function atualizarEstadoFisico(db: PrismaClient, ator: Ator, ref: string, input: { estadoFisico: EstadoFisico; justificativa?: string; versao: number }) {
  const justificativa = String(input.justificativa ?? "").trim();
  return db.$transaction(async (tx) => {
    const eq = await equipamentoPorIdentificador(tx, ref);
    if (!eq) throw new HttpError(404, "Equipamento não encontrado.");
    if (eq.versao !== input.versao) throw new HttpError(409, "Conflito de versão do equipamento.");
    validarMudancaEstadoFisico(eq.estadoFisico, input.estadoFisico, justificativa);
    await atualizarEquipamentoVersionado(tx, eq.id, input.versao, { estadoFisico: input.estadoFisico });
    await registrarJournal(tx, ator, { operacao: "ATUALIZAR_ESTADO_FISICO", entidade: "Equipamento", entidadeId: eq.id, dadosAntes: { estadoFisico: eq.estadoFisico }, dadosDepois: { estadoFisico: input.estadoFisico, justificativa } });
    return equipamentoPorId(tx, eq.id);
  });
}

export async function rastrearEquipamento(db: PrismaClient, ref: string) {
  const equipamento = await equipamentoRastreio(db, ref);
  if (!equipamento) throw new HttpError(404, "Equipamento não encontrado.");
  return { equipamento, movimentacoes: equipamento.movimentacoes };
}
