import { CLIInterface } from "./CLIInterface";

const ASSINATURA = "KamilleF - 2026";

if (process.argv.includes("--green")) {
  console.log(`
GreenCode
Desenvolvido por: Kamille
Assinatura: ${ASSINATURA}
`);
}

const cli = new CLIInterface();

cli.iniciarLoop().catch((erro: unknown) => {
  if (erro instanceof Error) {
    console.error("[ERRO] Erro fatal:", erro.message);
  } else {
    console.error("[ERRO] Erro fatal:", erro);
  }

  process.exit(1);
});