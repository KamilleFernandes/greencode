import { RepositorioArquivo } from "../persistencia/RepositorioArquivo";
import { StatusRastreamento } from "../equipamento/StatusRastreamento";
import { carregarEquipamentos } from "../equipamento/Equipamento";
import { carregarLotes } from "../lote/Lote";
import { ConfiguracaoGlobal } from "../organizacao/ConfiguracaoGlobal";

interface Periodo {
  inicio: Date;
  fim: Date;
}

export class ServicoRelatorio {
  private repositorio: RepositorioArquivo;

  constructor(repositorio: RepositorioArquivo) {
    this.repositorio = repositorio;
  }

  // início às 00:00:00 e fim às 23:59:59.999 do dia informado (dia final inclusivo)
  private normalizar(periodo: Periodo): Periodo {
    const inicio = new Date(periodo.inicio);
    const fim = new Date(periodo.fim);
    if (isNaN(inicio.getTime()) || isNaN(fim.getTime())) throw new Error("Período inválido.");
    inicio.setHours(0, 0, 0, 0);
    fim.setHours(23, 59, 59, 999);
    if (inicio > fim) throw new Error("Período inválido: início posterior ao fim.");
    return { inicio, fim };
  }

  gerarRelatorioPorOrganizacao(organizacaoId: string, periodoInformado: Periodo): string {
    const periodo = this.normalizar(periodoInformado);
    const lotes = carregarLotes(this.repositorio).filter((l) => {
      const data = new Date(l.dataEntrada);
      return l.organizacaoId === organizacaoId && data >= periodo.inicio && data <= periodo.fim;
    });

    const totalEquipamentos = lotes.reduce((soma, l) => soma + l.equipamentos.length, 0);
    const pesoTotal = lotes.reduce((soma, l) => soma + l.calcularPesoTotal(), 0);

    const linhas = [
      `Relatório da organização ${organizacaoId}`,
      `Período: ${periodo.inicio.toLocaleDateString()} a ${periodo.fim.toLocaleDateString()}`,
      `Lotes recebidos: ${lotes.length}`,
      `Equipamentos processados: ${totalEquipamentos}`,
      `Peso total: ${pesoTotal.toFixed(2)} kg`,
    ];

    return linhas.join("\n");
  }

  gerarRelatorioPorStatus(status: StatusRastreamento): string {
    const equipamentos = carregarEquipamentos(this.repositorio).filter(
      (e) => e.statusRastreamento === status
    );

    const linhas = [
      `Relatório de equipamentos no status: ${status}`,
      `Total encontrado: ${equipamentos.length}`,
      "",
      ...equipamentos.map((e) => `${e.codigoBarrasInterno} — ${e.tipo} — ${e.marca} ${e.modelo}`),
    ];

    return linhas.join("\n");
  }

  gerarRelatorioFinanceiro(periodoInformado: Periodo): string {
    const periodo = this.normalizar(periodoInformado);
    const equipamentos = carregarEquipamentos(this.repositorio);

    const equipamentosNoPeriodo = equipamentos.filter((e) => {
      const dataUltimaMovimentacao = e.historicoMovimentacao.length
        ? new Date(e.historicoMovimentacao[e.historicoMovimentacao.length - 1].dataHora)
        : null;
      return dataUltimaMovimentacao && dataUltimaMovimentacao >= periodo.inicio && dataUltimaMovimentacao <= periodo.fim;
    });

    const depreciacaoMedia =
      equipamentosNoPeriodo.length === 0
        ? 0
        : equipamentosNoPeriodo.reduce((soma, e) => soma + e.calcularDepreciacao(), 0) / equipamentosNoPeriodo.length;

    const aliquota = ConfiguracaoGlobal.obterAliquotaImposto();

    const linhas = [
      `Relatório financeiro`,
      `Período: ${periodo.inicio.toLocaleDateString()} a ${periodo.fim.toLocaleDateString()}`,
      `Equipamentos movimentados no período: ${equipamentosNoPeriodo.length}`,
      `Depreciação média: ${(depreciacaoMedia * 100).toFixed(1)}%`,
      `Alíquota de imposto configurada: ${(aliquota * 100).toFixed(1)}%`,
    ];

    return linhas.join("\n");
  }
}