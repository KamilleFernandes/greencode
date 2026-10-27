import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL não definida. Copie .env.example para .env e configure o PostgreSQL.");
}

const adapter = new PrismaPg({ connectionString });
export const prisma = new PrismaClient({ adapter });

export async function fecharBanco(): Promise<void> {
  await prisma.$disconnect();
}
