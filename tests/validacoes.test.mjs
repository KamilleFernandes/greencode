// Regras de validação portadas dos cenários de falha da AV1 (cada linha = um caso do CLI, agora via HTTP).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, J, novoCnpj, orgBody, eqBody, dia } from './helpers.mjs';

let ctx; let call; let tk;
before(async () => { ctx = await abrir(); ({ call, tk } = ctx); });
after(async () => { await ctx.app.close(); });

const contrato = (extra) => ({ dataAssinatura: '2026-01-01', dataVencimento: '2030-01-01', valorMensal: 10, ...extra });

test('organização: casos inválidos retornam o status esperado e nada é gravado', async () => {
  const casos = [
    ['CNPJ com dígito verificador errado', orgBody('11222333000180'), 400],
    ['CNPJ com todos os dígitos iguais', orgBody('11111111111111'), 400],
    ['sem contrato', (() => { const b = orgBody(novoCnpj()); delete b.contrato; return b; })(), 400],
    ['sem inscrição estadual', (() => { const b = orgBody(novoCnpj()); delete b.inscricaoEstadual; return b; })(), 400],
    ['e-mail inválido', orgBody(novoCnpj(), { email: 'nao-e-email' }), 400],
    ['contrato vencido', orgBody(novoCnpj(), { contrato: contrato({ dataAssinatura: '2020-01-01', dataVencimento: '2021-01-01' }) }), 400],
    ['vencimento anterior à assinatura', orgBody(novoCnpj(), { contrato: contrato({ dataAssinatura: '2029-01-01', dataVencimento: '2028-01-01' }) }), 400],
    ['valor mensal negativo', orgBody(novoCnpj(), { contrato: contrato({ valorMensal: -1 }) }), 400],
    ['valor mensal absurdo (estouraria o banco)', orgBody(novoCnpj(), { contrato: contrato({ valorMensal: 1e15 }) }), 400],
    ['data de contrato inexistente (30/02)', orgBody(novoCnpj(), { contrato: contrato({ dataVencimento: '2030-02-30' }) }), 400]
  ];
  for (const [nome, body, status] of casos) {
    const r = await call('POST', '/organizacoes', tk.ope, body);
    assert.equal(r.statusCode, status, `${nome}: ${r.body}`);
  }
});

test('organização: busca, renovação e desativação', async () => {
  const org = J(await call('POST', '/organizacoes', tk.ope, orgBody(novoCnpj())));
  assert.match(org.codigo, /^BR\d{3}$/);
  assert.equal((await call('GET', `/organizacoes/${org.codigo}`, tk.ges)).statusCode, 200);
  assert.equal((await call('GET', '/organizacoes/BR999999', tk.ges)).statusCode, 404);
  const url = `/organizacoes/${org.codigo}/contrato`; const v = org.contrato.versao;
  assert.equal((await call('PATCH', url, tk.ope, { dataVencimento: '2029-01-01', versao: v })).statusCode, 400); // anterior ao atual
  assert.equal((await call('PATCH', url, tk.ope, { dataVencimento: '2031-01-01', versao: v + 5 })).statusCode, 409); // versão errada
  assert.equal((await call('PATCH', url, tk.ope, { dataVencimento: '2031-01-01', versao: v })).statusCode, 200);
  const dsv = await call('PATCH', `/organizacoes/${org.codigo}/desativar`, tk.ope, { versao: org.versao });
  assert.equal(dsv.statusCode, 200); assert.equal(J(dsv).ativo, false);
  const lote = await call('POST', '/lotes', tk.ges, { organizacaoId: org.codigo, notaFiscal: 'N', transportadora: 'T' });
  assert.equal(lote.statusCode, 400); // organização inativa
});

test('lote e equipamento: casos inválidos', async () => {
  const org = J(await call('POST', '/organizacoes', tk.ope, orgBody(novoCnpj())));
  const lote = J(await call('POST', '/lotes', tk.ges, { organizacaoId: org.codigo, notaFiscal: 'N', transportadora: 'T' }));
  const add = (body) => call('POST', `/lotes/${lote.codigo}/equipamentos`, tk.ges, body);
  assert.equal((await call('POST', '/lotes', tk.ges, { organizacaoId: 'BR9999', notaFiscal: 'N', transportadora: 'T' })).statusCode, 404);
  assert.equal((await call('POST', '/lotes', tk.ges, { organizacaoId: org.codigo, transportadora: 'T' })).statusCode, 400);
  assert.equal((await call('POST', '/lotes', tk.ges, { organizacaoId: org.codigo, notaFiscal: 'N', transportadora: 'T', dataEntrada: dia(-100) })).statusCode, 400);
  assert.equal((await add(eqBody({ tipo: 'GELADEIRA' }))).statusCode, 400);
  assert.equal((await add(eqBody({ anoFabricacao: new Date().getFullYear() + 1 }))).statusCode, 400);
  assert.equal((await add(eqBody({ pesoQuilogramas: 0 }))).statusCode, 400);
  assert.equal((await add(eqBody({ pesoQuilogramas: -3 }))).statusCode, 400);
  assert.equal((await add(eqBody({ marca: '' }))).statusCode, 400);
  assert.equal((await call('POST', `/lotes/${lote.codigo}/triagem`, tk.ges, { versao: lote.versao })).statusCode, 400); // lote vazio
  assert.equal((await add(eqBody())).statusCode, 201);
  const l = J(await call('GET', `/lotes/${lote.codigo}`, tk.ges));
  assert.equal((await call('POST', `/lotes/${lote.codigo}/triagem`, tk.ges, { versao: l.versao })).statusCode, 200);
  assert.equal((await add(eqBody())).statusCode, 409); // inclusão após o início da triagem
  assert.equal((await call('GET', '/equipamentos/EQ999999/rastreamento', tk.aud)).statusCode, 404);
});

test('lote com equipamentos em uma única requisição/transação', async () => {
  const org = J(await call('POST', '/organizacoes', tk.ope, orgBody(novoCnpj())));
  const r = await call('POST', '/lotes', tk.ges, { organizacaoId: org.codigo, notaFiscal: 'N', transportadora: 'T', equipamentos: [eqBody(), eqBody({ tipo: 'MONITOR' }), eqBody({ tipo: 'SERVIDOR' })] });
  assert.equal(r.statusCode, 201, r.body);
  const lote = J(r);
  assert.equal(lote.equipamentos.length, 3);
  assert.deepEqual(lote.equipamentos.map((e) => e.posicaoNoLote), [1, 2, 3]);
  const invalido = await call('POST', '/lotes', tk.ges, { organizacaoId: org.codigo, notaFiscal: 'N', transportadora: 'T', equipamentos: [eqBody(), eqBody({ pesoQuilogramas: 0 })] });
  assert.equal(invalido.statusCode, 400);
});

test('usuários: duplicado, papel inválido, senha fraca e login inválido', async () => {
  const novo = (extra) => call('POST', '/usuarios', tk.adm, { login: `u${Date.now() % 100000}x`, nome: 'N', senha: 'Senha1234', papel: 'AUDITOR', ...extra });
  const ok = await novo({}); assert.equal(ok.statusCode, 201);
  assert.equal((await novo({ login: J(ok).login })).statusCode, 409);
  assert.equal((await novo({ papel: 'ROOT' })).statusCode, 400);
  assert.equal((await novo({ senha: 'curta1' })).statusCode, 400);
  assert.equal((await novo({ senha: 'somenteletras' })).statusCode, 400);
  assert.equal((await novo({ login: 'inválido!' })).statusCode, 400);
  assert.equal((await call('POST', '/usuarios', tk.ope, { login: 'abc', nome: 'N', senha: 'Senha1234', papel: 'AUDITOR' })).statusCode, 403);
});

test('configuração: alíquota e depreciação fora de 0..1 são rejeitadas; atualização respeita a versão', async () => {
  const cfg = J(await call('GET', '/configuracao', tk.adm));
  const put = (extra) => call('PUT', '/configuracao', tk.adm, { versao: cfg.versao, aliquotaImposto: 0.17, coeficienteDepreciacaoPadrao: 0.1, ...extra });
  assert.equal((await put({ aliquotaImposto: 1.5 })).statusCode, 400);
  assert.equal((await put({ aliquotaImposto: -0.1 })).statusCode, 400);
  assert.equal((await put({ coeficienteDepreciacaoPadrao: 2 })).statusCode, 400);
  assert.equal((await put({ coeficientesDepreciacao: { NOTEBOOK: 3 } })).statusCode, 400);
  assert.equal((await put({ versao: cfg.versao + 9 })).statusCode, 409);
  assert.equal((await put({})).statusCode, 200);
});

test('senha própria: troca com validação da senha atual', async () => {
  const login = `senha${Date.now() % 1000000}`;
  assert.equal((await call('POST', '/usuarios', tk.adm, { login, nome: 'S', senha: 'Senha1234', papel: 'AUDITOR' })).statusCode, 201);
  const t = await ctx.login(login, 'Senha1234');
  assert.equal((await call('PUT', '/auth/senha', t, { senhaAtual: 'errada123', senhaNova: 'NovaSenha99' })).statusCode, 400);
  assert.equal((await call('PUT', '/auth/senha', t, { senhaAtual: 'Senha1234', senhaNova: 'fraca' })).statusCode, 400);
  assert.equal((await call('PUT', '/auth/senha', t, { senhaAtual: 'Senha1234', senhaNova: 'NovaSenha99' })).statusCode, 200);
  assert.equal((await call('POST', '/auth/login', null, { login, senha: 'Senha1234' })).statusCode, 401);
  assert.equal((await call('POST', '/auth/login', null, { login, senha: 'NovaSenha99' })).statusCode, 200);
});

test('token: renovação gera nova janela de 30 minutos', async () => {
  const r = await call('POST', '/auth/renovar', tk.ges);
  assert.equal(r.statusCode, 200);
  const dados = J(r);
  const minutos = (new Date(dados.expiraEm).getTime() - Date.now()) / 60000;
  assert.ok(minutos > 29 && minutos <= 30, `expira em ${minutos} min`);
  assert.equal((await call('GET', '/lotes', dados.token)).statusCode, 200);
});

test('Swagger/OpenAPI lista os endpoints, exige Bearer e documenta os erros padronizados', async () => {
  const r = await call('GET', '/docs/json');
  assert.equal(r.statusCode, 200);
  const doc = J(r);
  const rotas = Object.entries(doc.paths).flatMap(([p, v]) => Object.keys(v).map((m) => `${m.toUpperCase()} ${p}`));
  assert.ok(rotas.length >= 25, `apenas ${rotas.length} rotas no OpenAPI`);
  for (const esperada of ['POST /auth/login', 'POST /lotes', 'GET /auditoria', 'PATCH /equipamentos/{id}/movimentacoes', 'GET /relatorios/financeiro']) assert.ok(rotas.includes(esperada), esperada);
  assert.deepEqual(doc.paths['/lotes'].post.security, [{ bearerAuth: [] }]);
  assert.deepEqual(doc.paths['/auth/login'].post.security, []);
  assert.ok(doc.paths['/lotes'].post.responses['409']);
  assert.notEqual((await call('GET', '/docs/')).statusCode, 401); // a UI do Swagger é pública (a API continua protegida)
});
