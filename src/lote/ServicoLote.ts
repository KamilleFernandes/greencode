import { RepositorioArquivo } from "../persistencia/RepositorioArquivo";
import { ValidadorDataEntrada } from "../validacao/ValidadorDataEntrada";
import { JournalTransacao } from "../auditoria/JournalTransacao";
import { Equipamento } from "../equipamento/Equipamento";
import { Lote, carregarLotes, salvarLotes } from "./Lote";
import { StatusLote } from "./StatusLote";

export class ServicoLote {
  repositorio: RepositorioArquivo;

  constructor(repositorio: RepositorioArquivo) {
    this.repositorio = repositorio;
  }

  criarLote(dados: any): Lote {
    const validadorData = new ValidadorDataEntrada();
    if (!validadorData.validar(dados.dataEntrada)) {
      throw new Error(validadorData.obterMensagemErro());
    }

    const lote = new Lote();
    Object.assign(lote, dados, {
      equipamentos: [],
      statusProcessamento: StatusLote.RECEBIDO,
    });

    new JournalTransacao("CRIAR_LOTE", "Lote", null, lote).registrar();

    const existentes = carregarLotes(this.repositorio);
    salvarLotes(this.repositorio, [...existentes, lote]);

    return lote;
  }

  adicionarEquipamentoLote(loteId: string, equipamento: Equipamento): void {
    const lotes = carregarLotes(this.repositorio);
    const lote = lotes.find((l) => l.id === loteId);
    if (!lote) throw new Error(`Lote ${loteId} não encontrado.`);

    const antes = { ...lote };
    lote.equipamentos.push(equipamento);

    new JournalTransacao("ADICIONAR_EQUIPAMENTO_LOTE", "Lote", antes, lote).registrar();

    salvarLotes(this.repositorio, lotes);
  }

  processarTriagem(loteId: string): void {
    const lotes = carregarLotes(this.repositorio);
    const lote = lotes.find((l) => l.id === loteId);
    if (!lote) throw new Error(`Lote ${loteId} não encontrado.`);

    const antes = { ...lote };
    lote.statusProcessamento = StatusLote.TRIAGEM_CONCLUIDA;

    new JournalTransacao("PROCESSAR_TRIAGEM", "Lote", antes, lote).registrar();

    salvarLotes(this.repositorio, lotes);
  }

  consultarLotePorPeriodo(dataInicio: Date, dataFim: Date): Lote[] {
    const lotes = carregarLotes(this.repositorio);
    return lotes.filter((l) => {
      const data = new Date(l.dataEntrada);
      return data >= dataInicio && data <= dataFim;
    });
  }
}