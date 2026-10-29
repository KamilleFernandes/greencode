import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, EstadoFisico, PapelUsuario, StatusLote, StatusRastreamento, TipoEquipamento } from "../src/generated/prisma/client.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL não definida.");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

function calcularDigito(base: string, pesos: number[]): number {
  const soma = [...base].reduce((s, n, i) => s + Number(n) * pesos[i], 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}
function cnpjDe(base12: string): string {
  const d1 = calcularDigito(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const parcial = base12 + d1;
  const d2 = calcularDigito(parcial, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return base12 + d1 + d2;
}
async function code(tx: any, sequence: string, prefix: string, width = 5): Promise<string> {
  const allowed: Record<string, string> = {
    organizacao_codigo_seq: "organizacao_codigo_seq", contrato_codigo_seq: "contrato_codigo_seq",
    lote_codigo_seq: "lote_codigo_seq", equipamento_codigo_seq: "equipamento_codigo_seq", codigo_barras_seq: "codigo_barras_seq"
  };
  const seq = allowed[sequence];
  const rows = await tx.$queryRawUnsafe(`SELECT nextval('${seq}') AS seq`);
  return `${prefix}${String(rows[0].seq).padStart(width, "0")}`;
}

async function main() {
  await prisma.$transaction(async (tx) => {
    const defaults = [
      { login: "admin", nome: "Administrador inicial", papel: PapelUsuario.ADMINISTRADOR, senha: "Admin@12345" },
      { login: "operador", nome: "Operador de cadastro", papel: PapelUsuario.OPERADOR_CADASTRO, senha: "Operador123" },
      { login: "gestor", nome: "Gestor de almoxarifado", papel: PapelUsuario.GESTOR_ALMOXARIFADO, senha: "Gestor123" },
      { login: "auditor", nome: "Auditor", papel: PapelUsuario.AUDITOR, senha: "Auditor123" }
    ];
    for (const item of defaults) {
      const existing = await tx.usuario.findUnique({ where: { login: item.login } });
      if (!existing) {
        await tx.usuario.create({ data: { login: item.login, nome: item.nome, papel: item.papel, hashSenha: await bcrypt.hash(item.senha, Number(process.env.BCRYPT_ROUNDS ?? 10)) } });
      }
    }

    await tx.configuracaoGlobal.upsert({
      where: { id: "global" },
      update: {},
      create: { id: "global", aliquotaImposto: 0.17, coeficienteDepreciacaoPadrao: 0.1, coeficientesDepreciacao: { COMPUTADOR_MESA: 0.1, NOTEBOOK: 0.15, MONITOR: 0.1, IMPRESSORA: 0.12, SERVIDOR: 0.1, ROTEADOR: 0.1, CABO_ESTRUTURADO: 0.05, FONTE_ALIMENTACAO: 0.1 }, versao: 1 }
    });

    const orgSpecs = [
      { id: "10000000-0000-4000-8000-000000000001", base: "112223330001", razaoSocial: "Recicla Tecnologia Ltda.", ativo: true, contrato: true, ie: "110.042.490.114" },
      { id: "10000000-0000-4000-8000-000000000002", base: "223344550001", razaoSocial: "Eletrônicos Sustentáveis S.A.", ativo: true, contrato: false, ie: "ISENTO" },
      { id: "10000000-0000-4000-8000-000000000003", base: "334455660001", razaoSocial: "Hospital Inativo Ltda.", ativo: false, contrato: true, ie: "ISENTO" },
      { id: "10000000-0000-4000-8000-000000000004", base: "445566770001", razaoSocial: "Varejo Contrato Vencido ME", ativo: true, contrato: "vencido", ie: "ISENTO" }
    ];
    const orgs: Record<string, any> = {};
    for (const spec of orgSpecs) {
      const cnpj = cnpjDe(spec.base);
      let org = await tx.organizacao.findUnique({ where: { cnpj } });
      if (!org) org = await tx.organizacao.create({ data: { id: spec.id, codigo: await code(tx, "organizacao_codigo_seq", "BR", 3), razaoSocial: spec.razaoSocial, cnpj, inscricaoEstadual: spec.ie, enderecoCompleto: "Av. Sustentabilidade, 100 - São Paulo/SP", telefone: "1133334444", email: spec.base === "112223330001" ? "contato@recicla.example" : "contato@eletronicos.example", ativo: spec.ativo } });
      orgs[spec.base] = org;
      if (spec.contrato) {
        const existingContract = await tx.contrato.findUnique({ where: { organizacaoId: org.id } });
        if (!existingContract) {
          await tx.contrato.create({ data: { codigo: await code(tx, "contrato_codigo_seq", "CTR"), organizacaoId: org.id, dataAssinatura: new Date(spec.contrato === "vencido" ? "2024-01-10T00:00:00.000Z" : "2026-01-10T00:00:00.000Z"), dataVencimento: new Date(spec.contrato === "vencido" ? "2025-01-10T00:00:00.000Z" : "2027-12-31T00:00:00.000Z"), clausulas: ["Logística reversa", "Destinação ambientalmente adequada"], valorMensal: 1250.00, renovacaoAutomatica: true } });
        }
      }
    }

    const lotSpecs = [
      { id: "20000000-0000-4000-8000-000000000001", org: orgs["112223330001"], status: StatusLote.RECEBIDO, date: "2026-10-25", nf: "SEED-001", obs: "Lote de exemplo pronto para triagem." },
      { id: "20000000-0000-4000-8000-000000000002", org: orgs["112223330001"], status: StatusLote.TRIAGEM_CONCLUIDA, date: "2026-10-24", nf: "SEED-002", obs: "Triagem concluída; movimentações autorizadas." },
      { id: "20000000-0000-4000-8000-000000000003", org: orgs["112223330001"], status: StatusLote.ENCAMINHADO, date: "2026-10-23", nf: "SEED-003", obs: "Equipamento em processamento." },
      { id: "20000000-0000-4000-8000-000000000004", org: orgs["112223330001"], status: StatusLote.FINALIZADO, date: "2026-10-22", nf: "SEED-004", obs: "Lote concluído." },
      { id: "20000000-0000-4000-8000-000000000005", org: orgs["112223330001"], status: StatusLote.EM_TRIAGEM, date: "2026-10-21", nf: "SEED-005", obs: "Lote na primeira etapa de triagem." }
    ];
    const lots: Record<string, any> = {};
    for (const spec of lotSpecs) {
      let lote = await tx.lote.findUnique({ where: { id: spec.id } });
      if (!lote) lote = await tx.lote.create({ data: { id: spec.id, codigo: await code(tx, "lote_codigo_seq", "LT"), dataEntrada: new Date(`${spec.date}T00:00:00.000Z`), organizacaoId: spec.org.id, notaFiscal: spec.nf, transportadora: "Transportadora Demonstração", observacoes: spec.obs, statusProcessamento: spec.status } });
      lots[spec.id] = lote;
    }

    const equipSpecs = [
      { id: "30000000-0000-4000-8000-000000000001", lot: lots["20000000-0000-4000-8000-000000000001"], tipo: TipoEquipamento.COMPUTADOR_MESA, estado: EstadoFisico.USADO_LEVE, status: StatusRastreamento.AGUARDANDO_TRIAGEM, barcode: null, ano: 2022, peso: 8.5, marca: "Dell", modelo: "OptiPlex Seed" },
      { id: "30000000-0000-4000-8000-000000000002", lot: lots["20000000-0000-4000-8000-000000000002"], tipo: TipoEquipamento.NOTEBOOK, estado: EstadoFisico.USADO_MODERADO, status: StatusRastreamento.EM_TRIAGEM, barcode: "NOT-000101", ano: 2021, peso: 2.2, marca: "Lenovo", modelo: "ThinkPad Seed" },
      { id: "30000000-0000-4000-8000-000000000003", lot: lots["20000000-0000-4000-8000-000000000003"], tipo: TipoEquipamento.SERVIDOR, estado: EstadoFisico.DANIFICADO_LEVE, status: StatusRastreamento.EM_DESMONTE, barcode: "SER-000102", ano: 2020, peso: 23.7, marca: "HPE", modelo: "ProLiant Seed" },
      { id: "30000000-0000-4000-8000-000000000004", lot: lots["20000000-0000-4000-8000-000000000004"], tipo: TipoEquipamento.MONITOR, estado: EstadoFisico.INSERVIVEL, status: StatusRastreamento.BAIXA_DEFINITIVA, barcode: "MON-000103", ano: 2018, peso: 5.1, marca: "LG", modelo: "Monitor Seed" },
      { id: "30000000-0000-4000-8000-000000000005", lot: lots["20000000-0000-4000-8000-000000000005"], tipo: TipoEquipamento.ROTEADOR, estado: EstadoFisico.BOM_ESTADO, status: StatusRastreamento.EM_TRIAGEM, barcode: "ROT-000104", ano: 2024, peso: 1.0, marca: "TP-Link", modelo: "Archer Seed" }
    ];
    for (const spec of equipSpecs) {
      const existente = await tx.equipamento.findUnique({ where: { id: spec.id } });
      if (!existente) await tx.equipamento.create({ data: { id: spec.id, codigo: await code(tx, "equipamento_codigo_seq", "EQ", 6), codigoBarrasInterno: spec.barcode, tipo: spec.tipo, marca: spec.marca, modelo: spec.modelo, anoFabricacao: spec.ano, estadoFisico: spec.estado, pesoQuilogramas: spec.peso, loteId: spec.lot.id, posicaoNoLote: 1, statusRastreamento: spec.status } });
    }

    const movements = [
      { id: "40000000-0000-4000-8000-000000000001", equipamentoId: "30000000-0000-4000-8000-000000000001", origem: "ENTRADA_LOTE", destino: "AGUARDANDO_TRIAGEM", observacao: "Entrada do equipamento no lote." },
      { id: "40000000-0000-4000-8000-000000000002", equipamentoId: "30000000-0000-4000-8000-000000000002", origem: "ENTRADA_LOTE", destino: "AGUARDANDO_TRIAGEM", observacao: "Entrada do equipamento no lote." },
      { id: "40000000-0000-4000-8000-000000000003", equipamentoId: "30000000-0000-4000-8000-000000000002", origem: "AGUARDANDO_TRIAGEM", destino: "EM_TRIAGEM", observacao: "Triagem iniciada; código atribuído." },
      { id: "40000000-0000-4000-8000-000000000004", equipamentoId: "30000000-0000-4000-8000-000000000003", origem: "ENTRADA_LOTE", destino: "AGUARDANDO_TRIAGEM", observacao: "Entrada do equipamento no lote." },
      { id: "40000000-0000-4000-8000-000000000005", equipamentoId: "30000000-0000-4000-8000-000000000003", origem: "AGUARDANDO_TRIAGEM", destino: "EM_TRIAGEM", observacao: "Triagem iniciada." },
      { id: "40000000-0000-4000-8000-000000000006", equipamentoId: "30000000-0000-4000-8000-000000000003", origem: "EM_TRIAGEM", destino: "AGUARDANDO_DESMONTE", observacao: "Triagem concluída." },
      { id: "40000000-0000-4000-8000-000000000007", equipamentoId: "30000000-0000-4000-8000-000000000003", origem: "AGUARDANDO_DESMONTE", destino: "EM_DESMONTE", observacao: "Desmonte iniciado." },
      { id: "40000000-0000-4000-8000-000000000008", equipamentoId: "30000000-0000-4000-8000-000000000004", origem: "ENTRADA_LOTE", destino: "AGUARDANDO_TRIAGEM", observacao: "Entrada do equipamento no lote." },
      { id: "40000000-0000-4000-8000-000000000009", equipamentoId: "30000000-0000-4000-8000-000000000004", origem: "AGUARDANDO_TRIAGEM", destino: "EM_TRIAGEM", observacao: "Triagem iniciada." },
      { id: "40000000-0000-4000-8000-000000000010", equipamentoId: "30000000-0000-4000-8000-000000000004", origem: "EM_TRIAGEM", destino: "AGUARDANDO_DESMONTE", observacao: "Triagem concluída." },
      { id: "40000000-0000-4000-8000-000000000011", equipamentoId: "30000000-0000-4000-8000-000000000004", origem: "AGUARDANDO_DESMONTE", destino: "EM_DESMONTE", observacao: "Desmonte iniciado." },
      { id: "40000000-0000-4000-8000-000000000012", equipamentoId: "30000000-0000-4000-8000-000000000004", origem: "EM_DESMONTE", destino: "DESCARTE_SEGURO", observacao: "Destinação final segura." },
      { id: "40000000-0000-4000-8000-000000000013", equipamentoId: "30000000-0000-4000-8000-000000000004", origem: "DESCARTE_SEGURO", destino: "BAIXA_DEFINITIVA", observacao: "Baixa definitiva registrada." },
      { id: "40000000-0000-4000-8000-000000000014", equipamentoId: "30000000-0000-4000-8000-000000000005", origem: "ENTRADA_LOTE", destino: "AGUARDANDO_TRIAGEM", observacao: "Entrada do equipamento no lote." },
      { id: "40000000-0000-4000-8000-000000000015", equipamentoId: "30000000-0000-4000-8000-000000000005", origem: "AGUARDANDO_TRIAGEM", destino: "EM_TRIAGEM", observacao: "Triagem iniciada." }
    ];
    await tx.movimentacao.createMany({ data: movements.map((m) => ({ ...m, responsavel: "seed" })), skipDuplicates: true });

    // Journal: registra a carga inicial uma única vez (formato JournalTransacao).
    if (!(await tx.auditoria.findFirst({ where: { operacao: "SEED_APLICADO" } }))) {
      await tx.auditoria.create({ data: { operacao: "SEED_APLICADO", entidade: "Sistema", usuarioResponsavel: "seed", dadosDepois: { usuarios: 4, organizacoes: 4, lotes: 5, equipamentos: 5 } } });
    }

    // Os códigos de barras de demonstração usam sufixos acima de 100; sincroniza a sequence
    // para que os próximos códigos da API não tentem reutilizar um número já presente.
    const codigosExistentes = await tx.equipamento.findMany({ where: { codigoBarrasInterno: { not: null } }, select: { codigoBarrasInterno: true } });
    const maiorSufixo = codigosExistentes.reduce((maior, item) => {
      const sufixo = Number(item.codigoBarrasInterno?.match(/-(\d+)$/)?.[1] ?? 0);
      return Number.isFinite(sufixo) ? Math.max(maior, sufixo) : maior;
    }, 0);
    if (maiorSufixo > 0) await tx.$queryRaw`SELECT setval('codigo_barras_seq', ${maiorSufixo}, true)`;
  });
  console.log("Seed concluído: 4 usuários, 4 organizações (sem contrato, inativa e com contrato vencido), 5 lotes cobrindo todos os status, equipamentos, movimentações e journal.");
}

main().catch((err) => { console.error("Falha no seed:", err); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
