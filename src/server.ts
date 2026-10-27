import "dotenv/config";
import { buildApp } from "./app.js";

const app = buildApp();
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT deve ser um inteiro entre 1 e 65535.");

await app.listen({ port, host: process.env.HOST ?? "0.0.0.0" });
app.log.info(`GreenCode API ativa na porta ${port}. Swagger: http://localhost:${port}/docs`);

let encerrando = false;
async function shutdown(signal: string) {
  if (encerrando) return;
  encerrando = true;
  app.log.info({ signal }, "Encerramento gracioso iniciado.");
  try {
    await app.close();
    process.exitCode = 0;
  } catch (error) {
    app.log.error({ err: error }, "Erro durante encerramento.");
    process.exitCode = 1;
  }
}
process.once("SIGINT", () => { void shutdown("SIGINT"); });
process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
