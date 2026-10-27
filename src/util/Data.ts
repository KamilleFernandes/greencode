// "YYYY-MM-DD" é interpretado no fuso LOCAL. new Date("2026-10-23") seria meia-noite UTC e,
// em fusos negativos (Brasil), cairia no dia anterior.
export function parseData(valor: string | Date | undefined, fimDoDia = false): Date {
  if (valor instanceof Date) return new Date(valor);
  const v = String(valor ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return new Date(v);
  const a = Number(m[1]);
  const me = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = fimDoDia ? new Date(a, me, d, 23, 59, 59, 999) : new Date(a, me, d);
  return dt.getFullYear() === a && dt.getMonth() === me && dt.getDate() === d ? dt : new Date(NaN);
}
