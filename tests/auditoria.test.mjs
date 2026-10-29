// Journal (formato da AV1), log das requisições, imutabilidade, rotação, retenção e integridade do banco.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, J, ate, novoCnpj, orgBody, eqBody } from './helpers.mjs';
import { prisma } from '../out/plugins/prisma.js';
import { manterJournal } from '../out/services/auditoria.service.js';

let ctx; let call; let tk;
before(async () => { ctx = await abrir(); ({ call, tk } = ctx); });
after(async () => { await ctx.app.close(); });
const consulta = async (q, token = tk.aud) => J(await call('GET', `/auditoria?${new URLSearchParams(q)}`, token));

test('journal no formato da AV1: id, timestamp, operação, entidade, dados antes/depois e usuário responsável', async () => {
  const org = J(await call('POST', '/organizacoes', tk.ope, orgBody(novoCnpj())));
  const lote = J(await call('POST', '/lotes', tk.ges, { organizacaoId: org.codigo, notaFiscal: 'N', transportadora: 'T', equipamentos: [eqBody()] }));
  const entradas = await consulta({ entidade: 'Lote', entidadeId: lote.id });
  const criar = entradas.find((e) => e.operacao === 'CRIAR_LOTE');
  assert.ok(criar, JSON.stringify(entradas));
  for (const campo of ['id', 'timestamp', 'operacao', 'entidade', 'usuarioResponsavel']) assert.ok(criar[campo], campo);
  assert.equal(criar.usuarioResponsavel, 'gestor');
  assert.equal(criar.metodo, 'POST'); assert.equal(criar.rota, '/lotes'); assert.ok(criar.requisicaoId);

  const l = J(await call('GET', `/lotes/${lote.codigo}`, tk.ges));
  await call('POST', `/lotes/${lote.codigo}/triagem`, tk.ges, { versao: l.versao });
  const depois = await consulta({ entidade: 'Lote', entidadeId: lote.id });
  const ini = depois.find((e) => e.operacao === 'INICIAR_TRIAGEM');
  assert.equal(ini.dadosAntes.statusProcessamento, 'RECEBIDO');
  assert.equal(ini.dadosDepois.statusProcessamento, 'EM_TRIAGEM');
});

test('o journal nunca contém senha, hash ou token', async () => {
  const login = `seg${Date.now() % 1000000}`;
  await call('POST', '/usuarios', tk.adm, { login, nome: 'Seg', senha: 'SenhaSecreta99', papel: 'AUDITOR' });
  const t = await ctx.login(login, 'SenhaSecreta99');
  await call('PUT', '/auth/senha', t, { senhaAtual: 'SenhaSecreta99', senhaNova: 'OutraSecreta88' });
  await call('POST', '/usuarios', tk.adm, { login: 'x', nome: 'N', senha: 'SenhaSecreta99', papel: 'AUDITOR' }); // rejeitada (400) com senha no corpo
  const todas = JSON.stringify(await consulta({ limite: '500' }));
  for (const segredo of ['SenhaSecreta99', 'OutraSecreta88', '$2a$', '$2b$', 'hashSenha']) assert.ok(!todas.includes(segredo), `vazou: ${segredo}`);
});

test('requisições rejeitadas são registradas (403, 400, 409) com usuário, rota e status', async () => {
  const r403 = await call('POST', '/lotes', tk.aud, { organizacaoId: 'BR001', notaFiscal: 'N', transportadora: 'T' });
  assert.equal(r403.statusCode, 403);
  const r400 = await call('POST', '/organizacoes', tk.ope, orgBody('11111111111111'));
  assert.equal(r400.statusCode, 400);
  const achou403 = await ate(async () => (await consulta({ operacao: 'REQUISICAO_REJEITADA', usuario: 'auditor' })).find((e) => e.rota === '/lotes' && e.statusHttp === 403));
  assert.ok(achou403, 'rejeição 403 não registrada');
  const achou400 = await ate(async () => (await consulta({ operacao: 'REQUISICAO_REJEITADA', usuario: 'operador' })).find((e) => e.rota === '/organizacoes' && e.statusHttp === 400));
  assert.ok(achou400, 'rejeição 400 não registrada');
  assert.equal(achou400.metodo, 'POST');
  assert.equal(achou400.dadosDepois.corpo.cnpj, '11111111111111');
  // sem token: registrado como ANONIMO
  assert.equal((await call('GET', '/lotes')).statusCode, 401);
  assert.ok(await ate(async () => (await consulta({ operacao: 'REQUISICAO_REJEITADA', usuario: 'ANONIMO' })).find((e) => e.statusHttp === 401)));
});

test('login e falha de login são registrados com o usuário correto', async () => {
  await call('POST', '/auth/login', null, { login: 'admin', senha: 'errada-errada1' });
  await call('POST', '/auth/login', null, { login: 'inexistente', senha: 'qualquer123' });
  const falhas = await consulta({ operacao: 'LOGIN_FALHA' }, tk.adm);
  assert.ok(falhas.some((e) => e.usuarioResponsavel === 'admin' && e.dadosDepois.motivo === 'senha incorreta'));
  assert.ok(falhas.some((e) => e.usuarioResponsavel === 'inexistente' && e.dadosDepois.motivo === 'login inexistente'));
  assert.ok((await consulta({ operacao: 'LOGIN' }, tk.adm)).some((e) => e.usuarioResponsavel === 'gestor'));
});

test('GET /auditoria: apenas auditor e administrador', async () => {
  assert.equal((await call('GET', '/auditoria', tk.aud)).statusCode, 200);
  assert.equal((await call('GET', '/auditoria', tk.adm)).statusCode, 200);
  assert.equal((await call('GET', '/auditoria', tk.ges)).statusCode, 403);
  assert.equal((await call('GET', '/auditoria', tk.ope)).statusCode, 403);
  assert.equal((await call('POST', '/auditoria/manutencao', tk.aud)).statusCode, 403);
});

test('journal e movimentações são somente de inclusão (trigger do banco)', async () => {
  const alguma = await prisma.auditoria.findFirstOrThrow();
  await assert.rejects(prisma.auditoria.update({ where: { id: alguma.id }, data: { operacao: 'ADULTERADO' } }), /somente de inclusão|23514/);
  await assert.rejects(prisma.auditoria.delete({ where: { id: alguma.id } }), /somente de inclusão|23514/);
  const mov = await prisma.movimentacao.findFirstOrThrow();
  await assert.rejects(prisma.movimentacao.update({ where: { id: mov.id }, data: { destino: 'X' } }), /somente de inclusão|23514/);
  await assert.rejects(prisma.movimentacao.delete({ where: { id: mov.id } }), /somente de inclusão|23514/);
});

test('integridade no banco: transição inválida, lote sem equipamento e equipamento com movimentação não podem ser apagados', async () => {
  const org = J(await call('POST', '/organizacoes', tk.ope, orgBody(novoCnpj())));
  const lote = J(await call('POST', '/lotes', tk.ges, { organizacaoId: org.codigo, notaFiscal: 'N', transportadora: 'T', equipamentos: [eqBody()] }));
  const eq = lote.equipamentos[0];
  await assert.rejects(prisma.equipamento.update({ where: { id: eq.id }, data: { statusRastreamento: 'EM_DESMONTE' } }), /Transição de status inválida|23514/);
  const vazio = J(await call('POST', '/lotes', tk.ges, { organizacaoId: org.codigo, notaFiscal: 'V', transportadora: 'T' }));
  await assert.rejects(prisma.lote.update({ where: { id: vazio.id }, data: { statusProcessamento: 'EM_TRIAGEM' } }), /sem equipamentos|23514/);
  await assert.rejects(prisma.equipamento.delete({ where: { id: eq.id } }), /foreign key|violat|P2003|Restrict|23503/i);
  const outra = J(await call('POST', '/organizacoes', tk.ope, orgBody(novoCnpj())));
  await assert.rejects(prisma.lote.update({ where: { id: lote.id }, data: { organizacaoId: outra.id } }), /não pode ser alterada|23514/);
});

test('retenção: registros com mais de 180 dias são removidos; os recentes são preservados', async () => {
  const velho = `RETENCAO-VELHO-${Date.now()}`, recente = `RETENCAO-RECENTE-${Date.now()}`;
  const antigo = new Date(Date.now() - 200 * 86400000), quase = new Date(Date.now() - 170 * 86400000);
  await prisma.auditoria.createMany({ data: [
    { operacao: velho, entidade: 'Teste', usuarioResponsavel: 'teste', timestamp: antigo },
    { operacao: recente, entidade: 'Teste', usuarioResponsavel: 'teste', timestamp: quase }
  ] });
  const r = await manterJournal(prisma, undefined, { retencaoDias: 180, limiteBytes: 10 * 1024 * 1024 * 1024 });
  assert.ok(r.expurgados >= 1, JSON.stringify(r));
  assert.equal(await prisma.auditoria.count({ where: { operacao: velho } }), 0);
  assert.equal(await prisma.auditoria.count({ where: { operacao: recente } }), 1);
});

test('rotação: acima do limite de tamanho o journal vai para o arquivo e continua consultável', async () => {
  const marca = `ROTACAO-${Date.now()}`;
  await prisma.auditoria.create({ data: { operacao: marca, entidade: 'Teste', usuarioResponsavel: 'teste' } });
  const antes = await prisma.auditoria.count();
  const r = await manterJournal(prisma, undefined, { retencaoDias: 180, limiteBytes: 1 });
  assert.ok(r.rotacionados >= antes && r.rotacionados > 0, JSON.stringify(r));
  assert.equal(await prisma.auditoria.count(), 0);
  assert.equal(await prisma.auditoriaArquivada.count({ where: { operacao: marca } }), 1);
  const lista = await consulta({ operacao: marca });
  assert.equal(lista.length, 1); assert.equal(lista[0].arquivado, true);
  assert.equal((await consulta({ operacao: marca, incluirArquivadas: 'false' })).length, 0);
  await call('POST', '/auth/renovar', tk.ges); // nova entrada vai para o journal ativo
  assert.ok((await prisma.auditoria.count()) >= 1);
  const via = await call('POST', '/auditoria/manutencao', tk.adm);
  assert.equal(via.statusCode, 200);
});
