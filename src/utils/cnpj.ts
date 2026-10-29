export function normalizarCnpj(valor: unknown): string {
  return String(valor ?? "").replace(/\D/g, "");
}

export function validarCnpj(valor: unknown): boolean {
  const cnpj = normalizarCnpj(valor);
  if (cnpj.length !== 14 || /^([0-9])\1{13}$/.test(cnpj)) return false;
  const digito = (base: string, pesos: number[]): number => {
    const soma = [...base].reduce((total, n, i) => total + Number(n) * pesos[i], 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const d1 = digito(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = digito(cnpj.slice(0, 12) + String(d1), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return cnpj.endsWith(`${d1}${d2}`);
}
