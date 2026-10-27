import * as crypto from "crypto";
import { Credencial } from "./Credencial";
import { Sessao } from "./Sessao";
import { PapelUsuario } from "./PapelUsuario";
import { RepositorioArquivo } from "../persistencia/RepositorioArquivo";
import { JournalTransacao } from "../auditoria/JournalTransacao";

export class ServicoAutenticacao {
  credenciais: Credencial[] = [];
  sessoesAtivas: Sessao[] = [];

  login(usuario: string, senha: string): Sessao {
    this.sessoesAtivas = this.sessoesAtivas.filter((s) => s.isValida());

    const credencial = this.credenciais.find((c) => c.usuario === usuario);
    if (!credencial || !credencial.verificarSenha(senha)) {
      const anterior = JournalTransacao.obterUsuarioAtual();
      JournalTransacao.definirUsuarioAtual(String(usuario ?? "").trim() || "DESCONHECIDO");
      try {
        new JournalTransacao("LOGIN_FALHA", "Sessao", null, { usuario }).registrar();
      } finally {
        JournalTransacao.definirUsuarioAtual(anterior);
      }
      throw new Error("Usuário ou senha inválidos.");
    }

    credencial.atualizarUltimoAcesso();

    const sessao = new Sessao(crypto.randomBytes(32).toString("hex"), credencial.usuario, credencial.papel);
    this.sessoesAtivas.push(sessao);

    JournalTransacao.definirUsuarioAtual(credencial.usuario);
    new JournalTransacao("LOGIN", "Sessao", null, { usuario: credencial.usuario, papel: credencial.papel }).registrar();
    return sessao;
  }

  logout(token: string): void {
    const sessao = this.sessoesAtivas.find((s) => s.token === token);
    if (sessao) new JournalTransacao("LOGOUT", "Sessao", null, { usuario: sessao.usuario }).registrar();
    this.sessoesAtivas = this.sessoesAtivas.filter((s) => s.token !== token);
  }

  validarToken(token: string): boolean {
    const sessao = this.sessoesAtivas.find((s) => s.token === token);
    if (!sessao) return false;
    if (!sessao.isValida()) {
      this.logout(token);
      return false;
    }
    sessao.renovar();
    return true;
  }

  alterarSenha(
              usuario: string,
              senhaAntiga: string,
              senhaNova: string
            ): boolean {
              const credencial = this.credenciais.find(
                (c) => c.usuario === usuario
              );

              if (
                !credencial ||
                !credencial.verificarSenha(senhaAntiga)
              ) {
                return false;
              }

              if (
                typeof senhaNova !== "string" ||
                senhaNova.length < 8 ||
                !/[A-Za-z]/.test(senhaNova) ||
                !/\d/.test(senhaNova)
              ) {
                throw new Error(
                  "A nova senha deve ter no mínimo 8 caracteres, com letras e números."
                );
              }

              const salt = crypto
                .randomBytes(16)
                .toString("hex");

              credencial.hashSenha = crypto
                .createHash("sha256")
                .update(senhaNova + salt)
                .digest("hex");

              credencial.salt = salt;

              new JournalTransacao(
                "ALTERAR_SENHA",
                "Credencial",
                null,
                { usuario }
              ).registrar();

              return true;
      }

  criarUsuario(usuario: string, senha: string, papel: PapelUsuario): Credencial {
    const nome = String(usuario ?? "").trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,32}$/.test(nome)) {
      throw new Error("Usuário inválido: 3 a 32 caracteres (letras, números, ponto, hífen ou sublinhado).");
    }
    if (!Object.values(PapelUsuario).includes(papel)) throw new Error("Papel inválido.");
    if (typeof senha !== "string" || senha.length < 8 || !/[A-Za-z]/.test(senha) || !/\d/.test(senha)) {
      throw new Error("A senha deve ter no mínimo 8 caracteres, com letras e números.");
    }
    if (this.credenciais.some((c) => c.usuario === nome)) {
      throw new Error("Usuário já cadastrado.");
    }

    const salt = crypto.randomBytes(16).toString("hex");
    const hashSenha = crypto.createHash("sha256").update(senha + salt).digest("hex");
    const credencial = new Credencial(nome, hashSenha, salt, papel);

    new JournalTransacao("CRIAR_USUARIO", "Credencial", null, { usuario: nome, papel }).registrar(); // nunca hash/salt
    this.credenciais.push(credencial);
    return credencial;
  }

  removerUsuario(usuario: string): boolean {
    const tamanhoAntes = this.credenciais.length;
    this.credenciais = this.credenciais.filter((c) => c.usuario !== usuario);
    const removeu = this.credenciais.length < tamanhoAntes;
    if (removeu) new JournalTransacao("REMOVER_USUARIO", "Credencial", { usuario }, null).registrar();
    return removeu;
  }

  editarPapelUsuario(usuario: string, novoPapel: PapelUsuario): boolean {
    if (!Object.values(PapelUsuario).includes(novoPapel)) throw new Error("Papel inválido.");
    const credencial = this.credenciais.find((c) => c.usuario === usuario);
    if (!credencial) return false;

    const admins = this.credenciais.filter((c) => c.papel === PapelUsuario.ADMINISTRADOR);
    if (credencial.papel === PapelUsuario.ADMINISTRADOR && novoPapel !== PapelUsuario.ADMINISTRADOR && admins.length === 1) {
      throw new Error("Não é possível rebaixar o único administrador do sistema.");
    }

    const papelAntes = credencial.papel;
    credencial.papel = novoPapel;
    new JournalTransacao("ALTERAR_PAPEL", "Credencial", { usuario, papel: papelAntes }, { usuario, papel: novoPapel }).registrar();
    return true;
  }

  listarUsuarios(): Credencial[] {
    return this.credenciais;
  }
}

const ARQUIVO_CREDENCIAIS = "credenciais.dat";

export function carregarCredenciais(repositorio: RepositorioArquivo): Credencial[] {
  return repositorio.listarEntidades(ARQUIVO_CREDENCIAIS).map((o: any) => Credencial.fromJSON(o));
}

export function salvarCredenciais(repositorio: RepositorioArquivo, credenciais: Credencial[]): void {
  repositorio.salvarEntidade(ARQUIVO_CREDENCIAIS, credenciais);
}
