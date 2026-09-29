import { CLIInterface } from "./CLIInterface";

const ASSINATURA = "KamilleF - 2026" 

if (process.argv.includes("--autor")) {
  console.log(`
  GreenCode
  Desenvolvido por: Kamille
  Assinatura: ${ASSINATURA}
  `);
}

const cli = new CLIInterface();

cli.iniciarLoop().catch((erro) => {
  console.error("[ERRO]", erro.message);
});