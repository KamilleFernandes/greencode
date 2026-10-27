import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../out/app.js';

let app;
let operadorToken;
let gestorToken;
let auditorToken;
let adminToken;
let organizacao;
let lote;
let equipamento;

function calcularDigito(base, pesos) {
  const soma = [...base].reduce((acc, n, i) => acc + Number(n) * pesos[i], 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}
function cnpjValido(base12) {
  const d1 = calcularDigito(base12, [5,4,3,2,9,8,7,6,5,4,3,2]);
  const d2 = calcularDigito(base12 + d1, [6,5,4,3,2,9,8,7,6,5,4,3,2]);
  return base12 + d1 + d2;
}
async function login(login, senha) {
  const result = await app.inject({ method: 'POST', url: '/auth/login', payload: { login, senha } });
  assert.equal(result.statusCode, 200, result.body);
  return result.json().token;
}
function auth(token) { return { authorization: `Bearer ${token}` }; }

before(async () => {
  app = buildApp();
  await app.ready();
  adminToken = await login('admin', 'Admin@12345');
  operadorToken = await login('operador', 'Operador123');
  gestorToken = await login('gestor', 'Gestor123');
  auditorToken = await login('auditor', 'Auditor123');
});
after(async () => { if (app) await app.close(); });

test('health e OpenAPI ficam acessíveis sem autenticação', async () => {
  const health = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(health.statusCode, 200, health.body);
  assert.equal(health.json().status, 'ok');
  const docs = await app.inject({ method: 'GET', url: '/docs/json' });
  assert.equal(docs.statusCode, 200, docs.body.slice(0, 200));
});

test('JWT obrigatório e RBAC retorna 401/403', async () => {
  const semToken = await app.inject({ method: 'GET', url: '/usuarios' });
  assert.equal(semToken.statusCode, 401);
  const permitido = await app.inject({ method: 'GET', url: '/usuarios', headers: auth(adminToken) });
  assert.equal(permitido.statusCode, 200, permitido.body);
  const proibido = await app.inject({ method: 'GET', url: '/configuracao', headers: auth(gestorToken) });
  assert.equal(proibido.statusCode, 403);
});

test('CNPJ inválido é bloqueado antes de gravar', async () => {
  const response = await app.inject({ method: 'POST', url: '/organizacoes', headers: auth(adminToken), payload: {
    razaoSocial: 'Teste inválido', cnpj: '11111111111111', enderecoCompleto: 'Rua A, 1', telefone: '11999999999', email: 'invalid@example.com',
    contrato: { dataAssinatura: '2026-01-01', dataVencimento: '2027-01-01', valorMensal: 100 }
  } });
  assert.equal(response.statusCode, 400);
  assert.match(response.body, /CNPJ inválido/);
});

test('jornada: organização, lote, equipamento, triagem, movimentação, rastreamento e relatório', async () => {
  const cnpj = cnpjValido('335566770001');
  const orgResponse = await app.inject({ method: 'POST', url: '/organizacoes', headers: auth(operadorToken), payload: {
    razaoSocial: 'Organização Teste AV2', cnpj, inscricaoEstadual: 'ISENTO', enderecoCompleto: 'Rua da Reciclagem, 25', telefone: '1132227788', email: 'av2@example.com',
    contrato: { dataAssinatura: '2026-01-01', dataVencimento: '2027-12-31', clausulas: ['logística reversa'], valorMensal: 875.5, renovacaoAutomatica: true }
  } });
  assert.equal(orgResponse.statusCode, 201, orgResponse.body);
  organizacao = orgResponse.json();

  const loteResponse = await app.inject({ method: 'POST', url: '/lotes', headers: auth(gestorToken), payload: { organizacaoId: organizacao.codigo, notaFiscal: 'TESTE-AV2-01', transportadora: 'Transportadora Teste' } });
  assert.equal(loteResponse.statusCode, 201, loteResponse.body);
  lote = loteResponse.json();

  const eqResponse = await app.inject({ method: 'POST', url: `/lotes/${lote.codigo}/equipamentos`, headers: auth(gestorToken), payload: { versao: lote.versao, tipo: 'NOTEBOOK', marca: 'Lenovo', modelo: 'Teste T14', anoFabricacao: 2022, estadoFisico: 'USADO_LEVE', pesoQuilogramas: 2.3 } });
  assert.equal(eqResponse.statusCode, 201, eqResponse.body);
  equipamento = eqResponse.json();
  lote.versao = equipamento.loteVersao;

  const triagem1 = await app.inject({ method: 'POST', url: `/lotes/${lote.codigo}/triagem`, headers: auth(gestorToken), payload: { versao: lote.versao } });
  assert.equal(triagem1.statusCode, 200, triagem1.body);
  lote = triagem1.json();
  assert.equal(lote.statusProcessamento, 'EM_TRIAGEM');
  assert.ok(lote.equipamentos[0].codigoBarrasInterno);

  const triagem2 = await app.inject({ method: 'POST', url: `/lotes/${lote.codigo}/triagem`, headers: auth(gestorToken), payload: { versao: lote.versao } });
  assert.equal(triagem2.statusCode, 200, triagem2.body);
  lote = triagem2.json();
  assert.equal(lote.statusProcessamento, 'TRIAGEM_CONCLUIDA');
  equipamento = lote.equipamentos[0];

  const stale = await app.inject({ method: 'PATCH', url: `/equipamentos/${equipamento.codigo}/movimentacoes`, headers: auth(gestorToken), payload: { destino: 'AGUARDANDO_DESMONTE', versao: equipamento.versao - 1 } });
  assert.equal(stale.statusCode, 409);
  const invalidTransition = await app.inject({ method: 'PATCH', url: `/equipamentos/${equipamento.codigo}/movimentacoes`, headers: auth(gestorToken), payload: { destino: 'BAIXA_DEFINITIVA', versao: equipamento.versao } });
  assert.equal(invalidTransition.statusCode, 409);

  let response = await app.inject({ method: 'PATCH', url: `/equipamentos/${equipamento.codigo}/movimentacoes`, headers: auth(gestorToken), payload: { destino: 'AGUARDANDO_DESMONTE', versao: equipamento.versao } });
  assert.equal(response.statusCode, 200, response.body); equipamento = response.json().equipamento;
  response = await app.inject({ method: 'PATCH', url: `/equipamentos/${equipamento.codigo}/movimentacoes`, headers: auth(gestorToken), payload: { destino: 'EM_DESMONTE', versao: equipamento.versao } });
  assert.equal(response.statusCode, 200, response.body); equipamento = response.json().equipamento;
  response = await app.inject({ method: 'PATCH', url: `/equipamentos/${equipamento.codigo}/movimentacoes`, headers: auth(gestorToken), payload: { destino: 'MATERIAL_RECICLAVEL', versao: equipamento.versao } });
  assert.equal(response.statusCode, 200, response.body); equipamento = response.json().equipamento;
  response = await app.inject({ method: 'PATCH', url: `/equipamentos/${equipamento.codigo}/movimentacoes`, headers: auth(gestorToken), payload: { destino: 'BAIXA_DEFINITIVA', versao: equipamento.versao } });
  assert.equal(response.statusCode, 200, response.body); equipamento = response.json().equipamento;
  assert.equal(equipamento.statusRastreamento, 'BAIXA_DEFINITIVA');

  const rastreio = await app.inject({ method: 'GET', url: `/equipamentos/${equipamento.codigoBarrasInterno}/rastreamento`, headers: auth(auditorToken) });
  assert.equal(rastreio.statusCode, 200, rastreio.body);
  assert.ok(rastreio.json().movimentacoes.length >= 6);
  const hoje = new Date().toISOString().slice(0, 10);
  const relatorio = await app.inject({ method: 'GET', url: `/relatorios/organizacao?organizacaoId=${organizacao.codigo}&inicio=2026-01-01&fim=2027-12-31`, headers: auth(auditorToken) });
  assert.equal(relatorio.statusCode, 200, relatorio.body);
  assert.ok(relatorio.json().totalLotes >= 1);
});
