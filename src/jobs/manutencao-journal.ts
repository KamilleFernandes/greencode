import type { PrismaClient } from "../generated/prisma/client.js";
import { manterJournal } from "../services/auditoria.service.js";

const SEIS_HORAS = 6 * 60 * 60 * 1000;

/** Rotação (> 10 MB) e retenção (>= 180 dias) do journal: uma vez na partida e a cada 6 horas. */
export function iniciarManutencaoJournal(db: PrismaClient, log: { info: (o: object, m?: string) => void; error: (o: object, m?: string) => void }): () => void {
  const executar = async () => {
    try {
      const r = await manterJournal(db, { id: null, login: "SISTEMA" });
      if (r.rotacionados || r.expurgados) log.info(r, "Manutenção do journal executada");
    } catch (err) { log.error({ err }, "Falha na manutenção do journal"); }
  };
  void executar();
  const timer = setInterval(() => void executar(), SEIS_HORAS);
  timer.unref();
  return () => clearInterval(timer);
}
