import { RepositorioArquivo } from "../persistencia/RepositorioArquivo";
import { Equipamento, ARQUIVO_EQUIPAMENTOS, carregarEquipamentos, salvarEquipamentos } from "./Equipamento";
import { EstadoFisico } from "./EstadoFisico";
import { TipoEquipamento } from "./TipoEquipamento";
import { JournalTransacao } from "../auditoria/JournalTransacao";

export interface HistoricoCompleto {
  equipamento: Equipamento;
  movimentacoes: Equipamento["historicoMovimentacao"];
}

const ORDEM_ESTADOS: EstadoFisico[] = [
  EstadoFisico.NOVO,
  EstadoFisico.BOM_ESTADO,
  EstadoFisico.USADO_LEVE,
  EstadoFisico.USADO_MODERADO,
  EstadoFisico.DANIFICADO_LEVE,
  EstadoFisico.DANIFICADO_GRAVE,
  EstadoFisico.INSERVIVEL,
];

const LIMITE_QUEDA_SEM_JUSTIFICATIVA = 2;

export class ServicoEquipamento {
  repositorio: RepositorioArquivo;

  constructor(repositorio: RepositorioArquivo) {
    this.repositorio = repositorio;
  }

  rastrearEquipamento(id: string): HistoricoCompleto {
    const equipamentos = carregarEquipamentos(this.repositorio);
    const equipamento = equipamentos.find((e) => e.id === id);
    if (!equipamento) {
      throw new Error(`Equipamento ${id} não encontrado.`);
    }

    return {
      equipamento,
      movimentacoes: equipamento.historicoMovimentacao,
    };
  }

  atualizarEstadoFisico(id: string, novoEstado: EstadoFisico, justificativa?: string): void {
    const equipamentos = carregarEquipamentos(this.repositorio);
    const equipamento = equipamentos.find((e) => e.id === id);
    if (!equipamento) {
      throw new Error(`Equipamento ${id} não encontrado.`);
    }

    const indiceAntigo = ORDEM_ESTADOS.indexOf(equipamento.estadoFisico);
    const indiceNovo = ORDEM_ESTADOS.indexOf(novoEstado);
    const quedaCategorias = indiceNovo - indiceAntigo;

    if (quedaCategorias >= LIMITE_QUEDA_SEM_JUSTIFICATIVA) {
      if (!justificativa || justificativa.trim() === "") {
        throw new Error(
          `Justificativa obrigatória: estado caiu ${quedaCategorias} categorias (de ${equipamento.estadoFisico} para ${novoEstado}).`
        );
      }
    }

    const estadoAntes = equipamento.estadoFisico;
    equipamento.estadoFisico = novoEstado;

    new JournalTransacao("ATUALIZAR_ESTADO_FISICO", "Equipamento", { id, estadoFisico: estadoAntes }, {
      id,
      estadoFisico: novoEstado,
      justificativa: justificativa ?? null,
    }).registrar();

    salvarEquipamentos(this.repositorio, equipamentos);
  }

  gerarCodigoBarras(tipo: TipoEquipamento, sequencia: number): string {
    const prefixo = tipo.substring(0, 3).toUpperCase();
    const sequenciaFormatada = String(sequencia).padStart(6, "0");
    return `${prefixo}-${sequenciaFormatada}`;
  }
}