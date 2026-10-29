// Utilitários compartilhados pelos testes de integração (app em memória via app.inject, banco real).
import { buildApp } from '../out/app.js';

export const J = (r) => { try { return r.json(); } catch { return r.body; } };
export const dia = (n = 0) => { const x = new Date(); x.setDate(x.getDate() + n); const p = (v) => String(v).padStart(2, '0'); return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`; };
const digito = (b, p) => { const r = [...b].reduce((a, n, i) => a + Number(n) * p[i], 0) % 11; return r < 2 ? 0 : 11 - r; };
export const cnpjDe = (b12) => { const d1 = digito(b12, [5,4,3,2,9,8,7,6,5,4,3,2]); const d2 = digito(b12 + d1, [6,5,4,3,2,9,8,7,6,5,4,3,2]); return b12 + d1 + d2; };
let seq = (Date.now() * 7) % 100000000;
export const novoCnpj = () => cnpjDe(String(++seq).padStart(8, '0') + '0001');
export const unico = (prefixo) => `${prefixo}${(Date.now() + ++seq) % 10000000}`;
export const orgBody = (cnpj, extra = {}) => ({ razaoSocial: 'Org de Teste', cnpj, inscricaoEstadual: 'ISENTO', enderecoCompleto: 'Rua 1', telefone: '11999990000', email: 't@x.com', contrato: { dataAssinatura: '2026-01-01', dataVencimento: '2030-01-01', valorMensal: 10 }, ...extra });
export const eqBody = (extra = {}) => ({ tipo: 'NOTEBOOK', marca: 'Marca', modelo: 'Modelo', anoFabricacao: 2020, estadoFisico: 'NOVO', pesoQuilogramas: 2, ...extra });
export const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
/** Repete a verificação até passar (o log de requisições rejeitadas é gravado após a resposta). */
export async function ate(fn, { tentativas = 40, intervalo = 50 } = {}) {
  let ultimo;
  for (let i = 0; i < tentativas; i++) { ultimo = await fn(); if (ultimo) return ultimo; await esperar(intervalo); }
  return ultimo;
}

export async function abrir() {
  const app = buildApp();
  await app.ready();
  const call = (method, url, token, payload) => app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload });
  const login = async (l, s) => { const r = await call('POST', '/auth/login', null, { login: l, senha: s }); return J(r).token; };
  const tk = { adm: await login('admin', 'Admin@12345'), ope: await login('operador', 'Operador123'), ges: await login('gestor', 'Gestor123'), aud: await login('auditor', 'Auditor123') };
  return { app, call, login, tk };
}
