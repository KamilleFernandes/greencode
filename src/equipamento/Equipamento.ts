import * as crypto from "crypto";
import { RepositorioArquivo } from "../persistencia/RepositorioArquivo";
import { ConfiguracaoGlobal } from "../organizacao/ConfiguracaoGlobal";
import { TipoEquipamento } from "./TipoEquipamento";
import { EstadoFisico } from "./EstadoFisico";
import { StatusRastreamento } from "./StatusRastreamento";
import { Movimentacao } from "./Movimentacao";

export const ARQUIVO_EQUIPAMENTOS = "equipamentos.dat";
export const ARQUIVO_MOVIMENTACOES = "movimentacoes.dat";

export class Equipamento {
  id: string;
  codigoBarrasInterno: string;
  tipo: TipoEquipamento;
  marca: string;
  modelo: string;
  anoFabricacao: number;
  estadoFisico: EstadoFisico;
  pesoQuilogramas: number;
  loteId: string;
  posicaoNoLote: number;
  statusRastreamento: StatusRastreamento;
  historicoMovimentacao: Movimentacao[];

  constructor(
  id: string,
  codigoBarrasInterno: string,
  tipo: TipoEquipamento,
  marca: string,
  modelo: string,
  anoFabricacao: number,
  estadoFisico: EstadoFisico,
  pesoQuilogramas: number,
  loteId: string,
  posicaoNoLote: number,
  statusRastreamento: StatusRastreamento = StatusRastreamento.AGUARDANDO_TRIAGEM,
  historicoMovimentacao: Movimentacao[] = []
) {
  this.id = id;
  this.codigoBarrasInterno = codigoBarrasInterno;
  this.tipo = tipo;
  this.marca = marca;
  this.modelo = modelo;
  this.anoFabricacao = anoFabricacao;
  this.estadoFisico = estadoFisico;
  this.pesoQuilogramas = pesoQuilogramas;
  this.loteId = loteId;
  this.posicaoNoLote = posicaoNoLote;
  this.statusRastreamento = statusRastreamento;
  this.historicoMovimentacao = historicoMovimentacao;
}


  atualizarStatus(novoStatus: StatusRastreamento, justificativa: string): void {
    const aindaNaoTriado = this.statusRastreamento === StatusRastreamento.AGUARDANDO_TRIAGEM;
    const indoParaDesmonte =
      novoStatus === StatusRastreamento.AGUARDANDO_DESMONTE || novoStatus === StatusRastreamento.EM_DESMONTE;

    if (aindaNaoTriado && indoParaDesmonte) {
      throw new Error("Equipamento só pode ir para desmonte após triagem completa.");
    }
    if (!justificativa || justificativa.trim() === "") {
      throw new Error("Justificativa é obrigatória para alteração de status.");
    }

    this.statusRastreamento = novoStatus;
  }

  registrarMovimentacao(destino: string, responsavel: string): void {
    const movimentacao = new Movimentacao();
    movimentacao.id = crypto.randomUUID();
    movimentacao.equipamentoId = this.id;
    movimentacao.dataHora = new Date();
    movimentacao.origem = this.loteId;
    movimentacao.destino = destino;
    movimentacao.responsavel = responsavel;
    movimentacao.observacao = "";

    this.historicoMovimentacao.push(movimentacao);
  }

  calcularDepreciacao(): number {
    const idadeAnos = new Date().getFullYear() - this.anoFabricacao;
    const coeficienteAnual = ConfiguracaoGlobal.obterCoeficienteDepreciacao(this.tipo);
    return Math.min(1, Math.max(0, coeficienteAnual * idadeAnos));
  }
}

export function carregarEquipamentos(repositorio: RepositorioArquivo): Equipamento[] {
  return repositorio.listarEntidades(ARQUIVO_EQUIPAMENTOS);
}

export function salvarEquipamentos(repositorio: RepositorioArquivo, equipamentos: Equipamento[]): void {
  repositorio.salvarEntidade(ARQUIVO_EQUIPAMENTOS, equipamentos);
}