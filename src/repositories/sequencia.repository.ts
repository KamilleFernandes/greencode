import type { Tx } from "./db.js";

const SEQUENCIAS = {
  organizacao: "organizacao_codigo_seq",
  contrato: "contrato_codigo_seq",
  lote: "lote_codigo_seq",
  equipamento: "equipamento_codigo_seq",
  barras: "codigo_barras_seq"
} as const;

/** nextval() é atômico no PostgreSQL: não existe corrida de "maior + 1". O nome vem de uma constante interna. */
async function proximo(tx: Tx, chave: keyof typeof SEQUENCIAS): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ n: bigint }>>`SELECT nextval(${SEQUENCIAS[chave]}::regclass) AS n`;
  return Number(rows[0]!.n);
}
const pad = (n: number, t: number) => String(n).padStart(t, "0");

export const proximoCodigoOrganizacao = async (tx: Tx) => `BR${pad(await proximo(tx, "organizacao"), 3)}`;
export const proximoCodigoContrato = async (tx: Tx) => `CTR${pad(await proximo(tx, "contrato"), 5)}`;
export const proximoCodigoLote = async (tx: Tx) => `LT${pad(await proximo(tx, "lote"), 5)}`;
export const proximoCodigoEquipamento = async (tx: Tx) => `EQ${pad(await proximo(tx, "equipamento"), 6)}`;
export const proximoCodigoBarras = async (tx: Tx, tipo: string) => `${tipo.slice(0, 3).toUpperCase()}-${pad(await proximo(tx, "barras"), 6)}`;
