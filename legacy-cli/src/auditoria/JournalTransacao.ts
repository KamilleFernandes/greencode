import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { CriptografiaArquivo } from "../persistencia/CriptografiaArquivo";
import { RepositorioArquivo } from "../persistencia/RepositorioArquivo";
import { carregarEquipamentos, salvarEquipamentos } from "../equipamento/Equipamento";
import { carregarLotes, salvarLotes } from "../lote/Lote";

const ARQUIVO_ATUAL = "journal.log";
const LIMITE_BYTES = 10 * 1024 * 1024;
const RETENCAO_MS = 180 * 24 * 60 * 60 * 1000;

interface ConfigJournal {
  diretorio: string; // pasta dos logs
  criptografia: CriptografiaArquivo;
  chave: string;
  repositorio: RepositorioArquivo;
}

export class JournalTransacao {
  id: string;
  timestamp: Date;
  operacao: string;
  entidade: string;
  dadosAntes: any;
  dadosDepois: any;
  usuarioResponsavel: string;

  private static config: ConfigJournal | null = null;
  private static usuarioAtual = "SISTEMA";

  static configurar(cfg: ConfigJournal): void {
    JournalTransacao.config = cfg;
    fs.mkdirSync(cfg.diretorio, { recursive: true });
    JournalTransacao.aplicarRetencao(cfg.diretorio);
  }

  static definirUsuarioAtual(usuario: string | null): void {
    JournalTransacao.usuarioAtual = usuario ?? "SISTEMA";
  }

  static obterUsuarioAtual(): string {
    return JournalTransacao.usuarioAtual;
  }

  constructor(operacao: string, entidade: string, dadosAntes: any, dadosDepois: any) {
    this.id = crypto.randomUUID();
    this.timestamp = new Date();
    this.operacao = operacao;
    this.entidade = entidade;
    this.dadosAntes = dadosAntes ?? null;
    this.dadosDepois = dadosDepois ?? null;
    this.usuarioResponsavel = JournalTransacao.usuarioAtual;
  }

  registrar(): void {
    const cfg = JournalTransacao.exigirConfig();
    const arquivo = path.join(cfg.diretorio, ARQUIVO_ATUAL);
    const linha = cfg.criptografia.cifrar(JSON.stringify(this), cfg.chave) + "\n";

    JournalTransacao.rotacionarSeNecessario(cfg.diretorio, arquivo, Buffer.byteLength(linha));

    const fd = fs.openSync(arquivo, "a", 0o600);
    try {
      fs.writeSync(fd, linha);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }

  reverter(): boolean {
    const cfg = JournalTransacao.exigirConfig();
    const id = (this.dadosDepois ?? this.dadosAntes)?.id;
    if (id === undefined) return false;
    const substituir = (lista: any[]): any[] => {
      if (this.dadosAntes === null) return lista.filter((i) => i.id !== id); // reverter criação
      if (lista.some((i) => i.id === id)) return lista.map((i) => (i.id === id ? this.dadosAntes : i));
      return [...lista, this.dadosAntes]; // reverter exclusão
    };

    let aplicar: () => void;
    switch (this.entidade) {
      case "Organizacao":
        aplicar = () =>
          cfg.repositorio.salvarEntidade("organizacoes.dat", substituir(cfg.repositorio.listarEntidades("organizacoes.dat")));
        break;
      case "Equipamento":
        aplicar = () => salvarEquipamentos(cfg.repositorio, substituir(carregarEquipamentos(cfg.repositorio)));
        break;
      case "Lote":
        aplicar = () => salvarLotes(cfg.repositorio, substituir(carregarLotes(cfg.repositorio)));
        break;
      default:
        return false;
    }

    new JournalTransacao("REVERTER", this.entidade, this.dadosDepois, this.dadosAntes).registrar();
    aplicar();
    return true;
  }

  static listarTodos(): JournalTransacao[] {
    const cfg = JournalTransacao.exigirConfig();
    const arquivos = fs
      .readdirSync(cfg.diretorio)
      .filter((f) => /^journal-.*\.log$/.test(f))
      .sort()
      .concat(fs.existsSync(path.join(cfg.diretorio, ARQUIVO_ATUAL)) ? [ARQUIVO_ATUAL] : []);

    const entradas: JournalTransacao[] = [];
    for (const nome of arquivos) {
      const linhas = fs.readFileSync(path.join(cfg.diretorio, nome), "utf8").split("\n").filter(Boolean);
      for (const linha of linhas) {
        let obj: any;
        try {
          obj = JSON.parse(cfg.criptografia.decifrar(linha, cfg.chave));
        } catch {
          throw new Error(`Journal ${nome} corrompido ou adulterado.`);
        }
        const e = Object.assign(Object.create(JournalTransacao.prototype), obj) as JournalTransacao;
        e.timestamp = new Date(obj.timestamp);
        entradas.push(e);
      }
    }
    return entradas;
  }

  private static exigirConfig(): ConfigJournal {
    if (!JournalTransacao.config) throw new Error("Journal não configurado.");
    return JournalTransacao.config;
  }

  private static rotacionarSeNecessario(dir: string, arquivo: string, bytesNovos: number): void {
    if (!fs.existsSync(arquivo)) return;
    if (fs.statSync(arquivo).size + bytesNovos <= LIMITE_BYTES) return;
    const carimbo = new Date().toISOString().replace(/[:.]/g, "-");
    fs.renameSync(arquivo, path.join(dir, `journal-${carimbo}.log`));
    JournalTransacao.aplicarRetencao(dir);
  }


  private static aplicarRetencao(dir: string): void {
    const limite = Date.now() - RETENCAO_MS;
    for (const f of fs.readdirSync(dir)) {
      if (!/^journal-.*\.log$/.test(f)) continue;
      const p = path.join(dir, f);
      if (fs.statSync(p).mtimeMs < limite) fs.unlinkSync(p);
    }
  }
}