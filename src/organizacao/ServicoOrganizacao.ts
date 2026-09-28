import { RepositorioArquivo } from "../persistencia/RepositorioArquivo";
import { ValidadorCNPJ } from "../validacao/ValidadorCNPJ";
import { JournalTransacao } from "../auditoria/JournalTransacao";
import { Organizacao } from "./Organizacao";
import { Contrato } from "./Contrato";

const ARQUIVO_ORGANIZACOES = "organizacoes.dat";
const CAMPOS_OBRIGATORIOS = ["razaoSocial", "inscricaoEstadual", "enderecoCompleto", "telefone", "email"];

export class ServicoOrganizacao {
  repositorio: RepositorioArquivo;
  validadorCNPJ: ValidadorCNPJ;

  constructor(repositorio: RepositorioArquivo, validadorCNPJ: ValidadorCNPJ) {
    this.repositorio = repositorio;
    this.validadorCNPJ = validadorCNPJ;
  }

  cadastrarOrganizacao(dados: any): Organizacao {
    for (const campo of CAMPOS_OBRIGATORIOS) {
      if (!String(dados?.[campo] ?? "").trim()) throw new Error(`Campo obrigatório ausente: ${campo}.`);
    }
    const cnpj = String(dados.cnpj ?? "").replace(/\D/g, "");
    if (!this.validadorCNPJ.validar(cnpj)) {
      throw new Error(this.validadorCNPJ.obterMensagemErro());
    }

    const existentes = this.listarTodas();
    if (existentes.some((o) => o.cnpj === cnpj)) throw new Error("CNPJ já cadastrado.");

    const organizacao = this.reidratar({
      ...dados,
      id: this.gerarProximoId(existentes),
      cnpj,
      dataCadastro: new Date(),
      ativo: true,
    });

    new JournalTransacao("CADASTRAR", "Organizacao", null, organizacao).registrar(); // antes de gravar
    this.salvarTodas([...existentes, organizacao]);
    return organizacao;
  }

  buscarOrganizacao(id: string): Organizacao {
    return this.reidratar(this.repositorio.carregarEntidade(ARQUIVO_ORGANIZACOES, id));
  }

  listarOrganizacoesAtivas(): Organizacao[] {
    return this.listarTodas().filter((o) => o.ativo);
  }

  renovarContrato(organizacaoId: string, novoVencimento: Date): void {
    const todas = this.listarTodas();
    const org = todas.find((o) => o.id === organizacaoId);
    if (!org) throw new Error(`Organização ${organizacaoId} não encontrada.`);
    if (!org.contratoVigente) throw new Error("Organização sem contrato vigente.");

    const antes = JSON.parse(JSON.stringify(org));
    org.contratoVigente.renovar(novoVencimento);
    new JournalTransacao("RENOVAR_CONTRATO", "Organizacao", antes, org).registrar();
    this.salvarTodas(todas);
  }

  private listarTodas(): Organizacao[] {
    return this.repositorio.listarEntidades(ARQUIVO_ORGANIZACOES).map((o) => this.reidratar(o));
  }

  private salvarTodas(lista: Organizacao[]): void {
    this.repositorio.salvarEntidade(ARQUIVO_ORGANIZACOES, lista);
  }

  private reidratar(obj: any): Organizacao {
    const org = Object.assign(new Organizacao(), obj);
    org.dataCadastro = new Date(obj.dataCadastro);
    if (obj.contratoVigente) {
      const c = Object.assign(new Contrato(), obj.contratoVigente);
      c.dataAssinatura = new Date(c.dataAssinatura);
      c.dataVencimento = new Date(c.dataVencimento);
      org.contratoVigente = c;
    }
    return org;
  }

  private gerarProximoId(existentes: Organizacao[]): string {
    const maior = existentes
      .map((o) => parseInt(String(o.id).replace(/\D/g, ""), 10))
      .filter((n) => !isNaN(n))
      .reduce((a, b) => Math.max(a, b), 0);
    return `BR${String(maior + 1).padStart(3, "0")}`;
  }
}