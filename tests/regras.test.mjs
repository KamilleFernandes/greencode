// Testes de regras de negócio, permissões, concorrência, rollback e expiração (complementam api.test.mjs).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../out/app.js';
import { prisma } from '../out/plugins/prisma.js';
import { criarLote } from '../out/services/logistica.service.js';

let app;
const tk = {};
const J = (r) => { try { return r.json(); } catch { return r.body; } };
const call = (method, url, token, payload) => app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload });
const login = async (l, s) => J(await call('POST', '/auth/login', null, { login: l, senha: s })).token;
const dia = (n) => { const x = new Date(); x.setDate(x.getDate() + n); const p = (v) => String(v).padStart(2, '0'); return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`; };
const digito = (b, p) => { const r = [...b].reduce((a, n, i) => a + Number(n) * p[i], 0) % 11; return r < 2 ? 0 : 11 - r; };
const cnpj = (b12) => { const d1 = digito(b12, [5,4,3,2,9,8,7,6,5,4,3,2]); const d2 = digito(b12 + d1, [6,5,4,3,2,9,8,7,6,5,4,3,2]); return b12 + d1 + d2; };
let seq = Date.now() % 100000000;
const novoCnpj = () => cnpj(String(++seq).padStart(8, '0') + '0001');
const orgBody = (c, extra = {}) => ({ razaoSocial: 'Org Regras', cnpj: c, inscricaoEstadual: 'ISENTO', enderecoCompleto: 'Rua 1', telefone: '11999990000', email: 'r@x.com', contrato: { dataAssinatura: '2026-01-01', dataVencimento: '2030-01-01', valorMensal: 10 }, ...extra });
const eq = (versao) => ({ versao, tipo: 'NOTEBOOK', marca: 'M', modelo: 'X', anoFabricacao: 2020, estadoFisico: 'NOVO', pesoQuilogramas: 2 });

async function novaOrg() { const r = await call('POST', '/organizacoes', tk.ope, orgBody(novoCnpj())); assert.equal(r.statusCode, 201, r.body); return J(r); }
async function novoLote(org, data) { return call('POST', '/lotes', tk.ges, { organizacaoId: org.codigo, notaFiscal: 'NF', transportadora: 'T', ...(data ? { dataEntrada: data } : {}) }); }
/** Lote com 2 equipamentos e triagem concluída. */
async function loteTriado() {
  const org = await novaOrg(); let lote = J(await novoLote(org));
  for (let i = 0; i < 2; i++) { const l = J(await call('GET', `/lotes/${lote.codigo}`, tk.ges)); const r = await call('POST', `/lotes/${lote.codigo}/equipamentos`, tk.ges, eq(l.versao)); assert.equal(r.statusCode, 201, r.body); }
  for (let i = 0; i < 2; i++) { const l = J(await call('GET', `/lotes/${lote.codigo}`, tk.ges)); const r = await call('POST', `/lotes/${lote.codigo}/triagem`, tk.ges, { versao: l.versao }); assert.equal(r.statusCode, 200, r.body); }
  return J(await call('GET', `/lotes/${lote.codigo}`, tk.ges));
}

before(async () => {
  app = buildApp(); await app.ready();
  tk.adm = await login('admin', 'Admin@12345'); tk.ope = await login('operador', 'Operador123');
  tk.ges = await login('gestor', 'Gestor123'); tk.aud = await login('auditor', 'Auditor123');
});
after(async () => { if (app) await app.close(); });

test('organização: CNPJ duplicado = 409, CNPJ com máscara é aceito, contrato vencido = 400', async () => {
  const c = novoCnpj();
  assert.equal((await call('POST', '/organizacoes', tk.ope, orgBody(c))).statusCode, 201);
  assert.equal((await call('POST', '/organizacoes', tk.ope, orgBody(c))).statusCode, 409);
  const mascara = novoCnpj().replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  assert.equal((await call('POST', '/organizacoes', tk.ope, orgBody(mascara))).statusCode, 201);
  const vencido = orgBody(novoCnpj(), { contrato: { dataAssinatura: '2020-01-01', dataVencimento: '2021-01-01', valorMensal: 10 } });
  assert.equal((await call('POST', '/organizacoes', tk.ope, vencido)).statusCode, 400);
});

test('rollback: se um equipamento falha no banco, o lote criado na mesma transação também é desfeito', async () => {
  const org = await novaOrg();
  const nf = `ROLLBACK-${Date.now()}`;
  const itens = [
    { tipo: 'NOTEBOOK', marca: 'Ok', modelo: 'X', anoFabricacao: 2020, estadoFisico: 'NOVO', pesoQuilogramas: 2 },
    { tipo: 'NOTEBOOK', marca: 'M'.repeat(101), modelo: 'X', anoFabricacao: 2020, estadoFisico: 'NOVO', pesoQuilogramas: 2 }
  ];
  await assert.rejects(criarLote(prisma, { id: null, login: 'teste' }, { organizacaoId: org.codigo, notaFiscal: nf, transportadora: 'T', equipamentos: itens }));
  assert.equal(await prisma.lote.count({ where: { notaFiscal: nf } }), 0);
  assert.equal(await prisma.auditoria.count({ where: { operacao: 'CRIAR_LOTE', dadosDepois: { path: ['notaFiscal'], equals: nf } } }), 0);
});

test('lote: data futura e acima de 90 dias são rejeitadas; hoje e exatamente 90 dias são aceitos', async () => {
  const org = await novaOrg();
  assert.equal((await novoLote(org, dia(1))).statusCode, 400);
  assert.equal((await novoLote(org, dia(-91))).statusCode, 400);
  assert.equal((await novoLote(org, dia(-90))).statusCode, 201);
  assert.equal((await novoLote(org)).statusCode, 201);
});

test('lote só é criado para organização ativa com contrato (BR002 do seed não tem contrato)', async () => {
  const r = await call('POST', '/lotes', tk.ges, { organizacaoId: 'BR002', notaFiscal: 'NF', transportadora: 'T' });
  assert.equal(r.statusCode, 400);
});

test('permissões: auditor não altera; operador não cria lote; gestor não lê configuração', async () => {
  assert.equal((await call('POST', '/lotes', tk.aud, { organizacaoId: 'X', notaFiscal: 'N', transportadora: 'T' })).statusCode, 403);
  assert.equal((await call('POST', '/lotes', tk.ope, { organizacaoId: 'X', notaFiscal: 'N', transportadora: 'T' })).statusCode, 403);
  assert.equal((await call('GET', '/configuracao', tk.ges)).statusCode, 403);
  assert.equal((await call('POST', '/organizacoes', tk.adm, orgBody(novoCnpj()))).statusCode, 403);
  assert.equal((await call('POST', '/lotes', tk.adm, { organizacaoId: 'X', notaFiscal: 'N', transportadora: 'T' })).statusCode, 403);
  assert.equal((await call('GET', '/relatorios/status?status=BAIXA_DEFINITIVA', tk.adm)).statusCode, 403);
  assert.equal((await call('GET', '/lotes')).statusCode, 401);
});

test('movimentação só após a triagem concluída; desmonte direto e descarte sem justificativa são bloqueados', async () => {
  const org = await novaOrg(); const lote = J(await novoLote(org));
  const add = J(await call('POST', `/lotes/${lote.codigo}/equipamentos`, tk.ges, eq(lote.versao)));
  const antes = await call('PATCH', `/equipamentos/${add.codigo}/movimentacoes`, tk.ges, { destino: 'AGUARDANDO_DESMONTE', versao: add.versao });
  assert.equal(antes.statusCode, 409);
  const l = await loteTriado(); const e = l.equipamentos[0];
  assert.equal((await call('PATCH', `/equipamentos/${e.codigo}/movimentacoes`, tk.ges, { destino: 'EM_DESMONTE', versao: e.versao })).statusCode, 409);
  assert.equal((await call('PATCH', `/equipamentos/${e.codigo}/movimentacoes`, tk.ges, { destino: 'DESCARTE_SEGURO', versao: e.versao })).statusCode, 400);
  const ok = await call('PATCH', `/equipamentos/${e.codigo}/movimentacoes`, tk.ges, { destino: 'DESCARTE_SEGURO', justificativa: 'sem reaproveitamento', versao: e.versao });
  assert.equal(ok.statusCode, 200, ok.body);
});

test('estado físico: queda de 2+ categorias exige justificativa; mesmo estado é rejeitado', async () => {
  const l = await loteTriado(); const e = l.equipamentos[0];
  const url = `/equipamentos/${e.codigo}/estado-fisico`;
  assert.equal((await call('PATCH', url, tk.ges, { estadoFisico: 'USADO_MODERADO', versao: e.versao })).statusCode, 400);
  assert.equal((await call('PATCH', url, tk.ges, { estadoFisico: 'NOVO', versao: e.versao })).statusCode, 400);
  const ok = await call('PATCH', url, tk.ges, { estadoFisico: 'USADO_MODERADO', justificativa: 'queda no transporte', versao: e.versao });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal((await call('GET', `/lotes/${l.codigo}`, tk.ges)).statusCode, 200);
});

test('lote vira ENCAMINHADO na primeira saída da triagem e FINALIZADO quando todos têm baixa', async () => {
  const l = await loteTriado(); assert.equal(l.statusProcessamento, 'TRIAGEM_CONCLUIDA');
  const caminho = ['AGUARDANDO_DESMONTE', 'EM_DESMONTE', 'MATERIAL_RECICLAVEL', 'BAIXA_DEFINITIVA'];
  for (const [i, e0] of l.equipamentos.entries()) {
    let v = e0.versao;
    for (const destino of caminho) {
      const r = await call('PATCH', `/equipamentos/${e0.codigo}/movimentacoes`, tk.ges, { destino, versao: v }); assert.equal(r.statusCode, 200, r.body); v = J(r).equipamento.versao;
      if (i === 0 && destino === 'AGUARDANDO_DESMONTE') assert.equal(J(await call('GET', `/lotes/${l.codigo}`, tk.ges)).statusProcessamento, 'ENCAMINHADO');
    }
  }
  assert.equal(J(await call('GET', `/lotes/${l.codigo}`, tk.ges)).statusProcessamento, 'FINALIZADO');
});

test('concorrência: duas movimentações simultâneas com a mesma versão => uma 200 e uma 409', async () => {
  const l = await loteTriado(); const e = l.equipamentos[0];
  const rs = await Promise.all([1, 2].map(() => call('PATCH', `/equipamentos/${e.codigo}/movimentacoes`, tk.ges, { destino: 'AGUARDANDO_DESMONTE', versao: e.versao })));
  assert.deepEqual(rs.map((r) => r.statusCode).sort(), [200, 409]);
  const rastreio = J(await call('GET', `/equipamentos/${e.codigo}/rastreamento`, tk.aud));
  assert.equal(rastreio.movimentacoes.filter((m) => m.destino === 'AGUARDANDO_DESMONTE').length, 1);
});

test('concorrência: 5 inclusões simultâneas de equipamento no mesmo lote são serializadas (posições 1..5)', async () => {
  const org = await novaOrg(); const lote = J(await novoLote(org));
  const rs = await Promise.all([1, 2, 3, 4, 5].map(() => call('POST', `/lotes/${lote.codigo}/equipamentos`, tk.ges, eq())));
  assert.ok(rs.every((r) => r.statusCode === 201), rs.map((r) => r.statusCode).join());
  const l = J(await call('GET', `/lotes/${lote.codigo}`, tk.ges));
  assert.deepEqual(l.equipamentos.map((e) => e.posicaoNoLote), [1, 2, 3, 4, 5]);
});

test('concorrência: 10 lotes simultâneos recebem códigos distintos (sequence, sem MAX+1)', async () => {
  const org = await novaOrg();
  const rs = await Promise.all(Array.from({ length: 10 }, () => novoLote(org)));
  assert.ok(rs.every((r) => r.statusCode === 201));
  assert.equal(new Set(rs.map((r) => J(r).codigo)).size, 10);
});

test('relatórios: período inclusivo no mesmo dia, invertido e data inexistente', async () => {
  const org = await novaOrg(); await novoLote(org);
  const hoje = dia(0);
  const rel = J(await call('GET', `/relatorios/organizacao?organizacaoId=${org.codigo}&inicio=${hoje}&fim=${hoje}`, tk.aud));
  assert.equal(rel.totalLotes, 1);
  assert.equal((await call('GET', `/relatorios/financeiro?inicio=${dia(1)}&fim=${dia(0)}`, tk.aud)).statusCode, 400);
  assert.equal((await call('GET', '/relatorios/financeiro?inicio=2026-02-30&fim=2026-03-01', tk.aud)).statusCode, 400);
});

test('JWT: token expirado = 401; usuário desativado perde o acesso; único administrador não é rebaixado', async () => {
  process.env.JWT_EXPIRES_IN = '1s';
  const curto = await login('auditor', 'Auditor123'); process.env.JWT_EXPIRES_IN = '30m';
  await new Promise((r) => setTimeout(r, 2200));
  assert.equal((await call('GET', '/lotes', curto)).statusCode, 401);

  const nome = `tmp${Date.now() % 1000000}`;
  const u = J(await call('POST', '/usuarios', tk.adm, { login: nome, nome: 'Temp', senha: 'Senha1234', papel: 'AUDITOR' }));
  const t = await login(nome, 'Senha1234');
  assert.equal((await call('GET', '/lotes', t)).statusCode, 200);
  const atual = J(await call('GET', '/usuarios', tk.adm)).find((x) => x.id === u.id);
  assert.equal((await call('PATCH', `/usuarios/${u.id}/ativo`, tk.adm, { ativo: false, versao: atual.versao })).statusCode, 200);
  assert.equal((await call('GET', '/lotes', t)).statusCode, 401);

  const admin = J(await call('GET', '/usuarios', tk.adm)).find((x) => x.login === 'admin');
  assert.equal((await call('PATCH', `/usuarios/${admin.id}/papel`, tk.adm, { papel: 'AUDITOR', versao: admin.versao })).statusCode, 409);
});
