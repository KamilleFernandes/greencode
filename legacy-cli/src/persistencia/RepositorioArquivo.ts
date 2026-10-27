// src/persistencia/RepositorioArquivo.ts
import * as fs from "fs";
import * as path from "path";
import { CriptografiaArquivo } from "./CriptografiaArquivo";

export class RepositorioArquivo {
  diretorioBase: string;
  criptografia: CriptografiaArquivo;

  constructor(diretorioBase: string, criptografia: CriptografiaArquivo, private readonly chave: string) {
    this.diretorioBase = diretorioBase;
    this.criptografia = criptografia;

    if (!fs.existsSync(this.diretorioBase)) {
      fs.mkdirSync(this.diretorioBase, { recursive: true });
    }
  }

  private caminho(nomeArquivo: string): string {
    return path.join(this.diretorioBase, nomeArquivo);
  }

  salvarEntidade(nomeArquivo: string, entidade: any): void {
  const destino = this.caminho(nomeArquivo);
  const temporario = `${destino}.${process.pid}.tmp`;
  const textoCifrado = this.criptografia.cifrar(JSON.stringify(entidade), this.chave);
  try {
    const fd = fs.openSync(temporario, "w", 0o600);
    try {
      fs.writeSync(fd, textoCifrado);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporario, destino);
  } catch (e) {
    if (fs.existsSync(temporario)) fs.unlinkSync(temporario);
    throw e;
  }
}


  carregarEntidade(nomeArquivo: string, id: string): any {
    const lista = this.listarEntidades(nomeArquivo);
    const encontrada = lista.find((item: any) => item.id === id);
    if (!encontrada) {
      throw new Error(`Entidade com id ${id} não encontrada em ${nomeArquivo}`);
    }
    return encontrada;
  }

 listarEntidades(nomeArquivo: string): any[] {
  const destino = this.caminho(nomeArquivo);
  if (!fs.existsSync(destino)) return [];
  try {
    const json = this.criptografia.decifrar(fs.readFileSync(destino, "utf8"), this.chave);
    return JSON.parse(json);
  } catch {
    throw new Error(`Arquivo ${nomeArquivo} corrompido ou adulterado.`);
  }
}

  excluirEntidade(nomeArquivo: string, id: string): void {
    const lista = this.listarEntidades(nomeArquivo);
    const filtrada = lista.filter((item: any) => item.id !== id);
    this.salvarEntidade(nomeArquivo, filtrada);
  }
}