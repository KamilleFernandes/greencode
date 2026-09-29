import { CLIInterface } from "./CLIInterface";

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
cli.iniciarLoop().catch((erro) => {
  console.error("Erro fatal:", erro);
  process.exit(1);
});