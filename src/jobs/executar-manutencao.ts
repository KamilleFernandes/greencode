import "dotenv/config";
import { prisma, fecharBanco } from "../plugins/prisma.js";
import { manterJournal } from "../services/auditoria.service.js";

// Uso: npm run auditoria:manutencao
const r = await manterJournal(prisma, { id: null, login: "SISTEMA" });
console.log("Manutenção do journal:", r);
await fecharBanco();
