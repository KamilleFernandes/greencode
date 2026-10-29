// JORNADA COMPLETA (equivalente à jornada do CLI da AV1), agora pela API HTTP:
// usuários -> organização -> lote com equipamentos -> triagem -> múltiplas movimentações
// -> rastreabilidade -> relatórios -> auditoria. Imprime [PASS] por etapa.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, J, ate, novoCnpj, orgBody, eqBody, dia, unico } from './helpers.mjs';

let ctx; let call;
before(async () => { ctx = await abrir(); ({ call } = ctx); });
after(async () => { await ctx.app.close(); });
const passo = (m) => console.log(`[PASS] ${m}`);

test('jornada completa: usuários -> organização -> lote -> triagem -> movimentações -> rastreabilidade -> relatórios -> auditoria', async () => {
  // 1) Administrador cria os usuários da jornada e cada um autentica
  const adm = await ctx.login('admin', 'Admin@12345');
  const logins = { ope: unico('jop'), ges: unico('jge'), aud: unico('jau') };
  const papeis = { ope: 'OPERADOR_CADASTRO', ges: 'GESTOR_ALMOXARIFADO', aud: 'AUDITOR' };
  const t = {};
  for (const k of Object.keys(logins)) {
    assert.equal((await call('POST', '/usuarios', adm, { login: logins[k], nome: `Jornada ${k}`, senha: 'Jornada123', papel: papeis[k] })).statusCode, 201);
    t[k] = await ctx.login(logins[k], 'Jornada123'); assert.ok(t[k]);
  }
  passo('Usuários criados e autenticados por papel.');

  // 2) Segregação de papéis
  assert.equal((await call('POST', '/organizacoes', adm, orgBody(novoCnpj()))).statusCode, 403);
  assert.equal((await call('POST', '/organizacoes', t.ges, orgBody(novoCnpj()))).statusCode, 403);
  assert.equal((await call('POST', '/lotes', t.aud, { organizacaoId: 'BR001', notaFiscal: 'N', transportadora: 'T' })).statusCode, 403);
  passo('Segregação de papéis verificada (administrador, gestor e auditor bloqueados onde devem).');

  // 3) Operador cadastra a organização e o contrato
  const org = J(await call('POST', '/organizacoes', t.ope, orgBody(novoCnpj())));
  assert.match(org.codigo, /^BR\d{3}$/); assert.ok(org.contrato.codigo);
  passo(`Organização: ${org.codigo}`);

  // 4) Gestor cria o lote já com 3 equipamentos (uma transação)
  const criado = await call('POST', '/lotes', t.ges, { organizacaoId: org.codigo, notaFiscal: '123456', transportadora: 'TransRapida', equipamentos: [eqBody({ tipo: 'NOTEBOOK' }), eqBody({ tipo: 'MONITOR', pesoQuilogramas: 4 }), eqBody({ tipo: 'SERVIDOR', pesoQuilogramas: 12 })] });
  assert.equal(criado.statusCode, 201, criado.body);
  const lote = J(criado);
  assert.equal(lote.statusProcessamento, 'RECEBIDO'); assert.equal(lote.equipamentos.length, 3);
  passo(`Lote: ${lote.codigo} com ${lote.equipamentos.length} equipamentos.`);

  // 5) Desmonte antes da triagem é bloqueado
  const [e1, e2, e3] = lote.equipamentos;
  assert.equal((await call('PATCH', `/equipamentos/${e1.codigo}/movimentacoes`, t.ges, { destino: 'AGUARDANDO_DESMONTE', versao: e1.versao })).statusCode, 409);
  passo('Desmonte antes da triagem completa bloqueado.');

  // 6) Triagem em duas etapas; códigos de barras únicos
  let L = J(await call('GET', `/lotes/${lote.codigo}`, t.ges));
  let tri = await call('POST', `/lotes/${lote.codigo}/triagem`, t.ges, { versao: L.versao });
  assert.equal(J(tri).statusProcessamento, 'EM_TRIAGEM');
  L = J(await call('GET', `/lotes/${lote.codigo}`, t.ges));
  tri = await call('POST', `/lotes/${lote.codigo}/triagem`, t.ges, { versao: L.versao });
  assert.equal(J(tri).statusProcessamento, 'TRIAGEM_CONCLUIDA');
  L = J(await call('GET', `/lotes/${lote.codigo}`, t.ges));
  const barras = L.equipamentos.map((e) => e.codigoBarrasInterno);
  assert.ok(barras.every((b) => /^[A-Z]{3}-\d{6}$/.test(b)) && new Set(barras).size === 3, barras.join());
  passo(`Triagem concluída; códigos de barras únicos: ${barras.join(', ')}`);

  // 7) Movimentações
  const mover = async (eq, destino, extra = {}) => {
    const atual = J(await call('GET', `/equipamentos/${eq.codigo}/rastreamento`, t.ges)).equipamento;
    const r = await call('PATCH', `/equipamentos/${eq.codigo}/movimentacoes`, t.ges, { destino, versao: atual.versao, ...extra });
    assert.equal(r.statusCode, 200, `${eq.codigo} -> ${destino}: ${r.body}`); return J(r);
  };
  // 7a) Equipamento 1: caminho completo até a baixa
  for (const d of ['AGUARDANDO_DESMONTE', 'EM_DESMONTE', 'MATERIAL_RECICLAVEL', 'BAIXA_DEFINITIVA']) await mover(e1, d);
  assert.equal(J(await call('GET', `/lotes/${lote.codigo}`, t.ges)).statusProcessamento, 'ENCAMINHADO');
  passo('Lote ENCAMINHADO após a primeira saída da triagem.');
  // 7b) Equipamento 2: queda de estado exige justificativa; descarte direto exige justificativa
  const r2 = J(await call('GET', `/equipamentos/${e2.codigo}/rastreamento`, t.ges)).equipamento;
  assert.equal((await call('PATCH', `/equipamentos/${e2.codigo}/estado-fisico`, t.ges, { estadoFisico: 'DANIFICADO_LEVE', versao: r2.versao })).statusCode, 400);
  assert.equal((await call('PATCH', `/equipamentos/${e2.codigo}/estado-fisico`, t.ges, { estadoFisico: 'DANIFICADO_LEVE', justificativa: 'Queda no transporte', versao: r2.versao })).statusCode, 200);
  assert.equal((await call('PATCH', `/equipamentos/${e2.codigo}/movimentacoes`, t.ges, { destino: 'DESCARTE_SEGURO', versao: r2.versao + 1 })).statusCode, 400);
  await mover(e2, 'DESCARTE_SEGURO', { justificativa: 'Sem possibilidade de reaproveitamento' });
  await mover(e2, 'BAIXA_DEFINITIVA');
  passo('Justificativas obrigatórias (queda de estado e descarte direto) verificadas.');
  // 7c) Equipamento 3: fluxo completo -> lote FINALIZADO
  for (const d of ['AGUARDANDO_DESMONTE', 'EM_DESMONTE', 'PECAS_REAPROVEITADAS', 'BAIXA_DEFINITIVA']) await mover(e3, d);
  assert.equal(J(await call('GET', `/lotes/${lote.codigo}`, t.ges)).statusProcessamento, 'FINALIZADO');
  passo('Lote FINALIZADO quando todos os equipamentos têm baixa definitiva.');

  // 8) Rastreabilidade (também pelo código de barras)
  const r1 = J(await call('GET', `/equipamentos/${barras[0]}/rastreamento`, t.aud));
  assert.deepEqual(r1.movimentacoes.map((m) => m.destino), ['AGUARDANDO_TRIAGEM', 'EM_TRIAGEM', 'AGUARDANDO_DESMONTE', 'EM_DESMONTE', 'MATERIAL_RECICLAVEL', 'BAIXA_DEFINITIVA']);
  assert.equal(r1.movimentacoes[0].origem, 'ENTRADA_LOTE');
  assert.ok(r1.movimentacoes.every((m) => m.responsavel));
  passo(`Rastreabilidade: ${r1.movimentacoes.length} movimentações.`);

  // 9) Relatórios (auditor)
  const hoje = dia(0);
  const ro = J(await call('GET', `/relatorios/organizacao?organizacaoId=${org.codigo}&inicio=${hoje}&fim=${hoje}`, t.aud));
  assert.equal(ro.totalLotes, 1); assert.equal(ro.totalEquipamentos, 3); assert.equal(ro.pesoTotalKg, 18);
  const rs = J(await call('GET', '/relatorios/status?status=BAIXA_DEFINITIVA', t.aud)); assert.ok(rs.total >= 3);
  const rf = J(await call('GET', `/relatorios/financeiro?inicio=${hoje}&fim=${hoje}`, t.aud)); assert.ok(rf.equipamentosMovimentados >= 3);
  assert.equal((await call('GET', `/relatorios/organizacao?organizacaoId=${org.codigo}&inicio=${hoje}&fim=${hoje}`, t.ges)).statusCode, 403);
  passo('Relatórios de organização, status e financeiro verificados.');

  // 10) Auditoria: toda a jornada está no journal, com usuário responsável e dados antes/depois
  const j = J(await call('GET', `/auditoria?entidadeId=${lote.id}&limite=100`, t.aud));
  const ops = j.map((e) => e.operacao);
  for (const op of ['CRIAR_LOTE', 'INICIAR_TRIAGEM', 'CONCLUIR_TRIAGEM', 'ENCAMINHAR_LOTE', 'FINALIZAR_LOTE']) assert.ok(ops.includes(op), `faltou ${op}`);
  const mudou = J(await call('GET', `/auditoria?entidadeId=${e1.id}&operacao=MUDAR_STATUS_EQUIPAMENTO&limite=100`, t.aud));
  assert.equal(mudou.length, 4);
  assert.ok(mudou.every((e) => e.usuarioResponsavel === logins.ges && e.dadosAntes?.statusRastreamento && e.dadosDepois?.statusRastreamento));
  const rej = await ate(async () => J(await call('GET', `/auditoria?operacao=REQUISICAO_REJEITADA&usuario=${logins.ges}`, t.aud)).length > 0);
  assert.ok(rej, 'requisições rejeitadas do gestor deveriam estar no journal');
  passo(`Journal: ${j.length} entradas do lote; ${mudou.length} mudanças de status do equipamento com antes/depois.`);
  console.log('[PASS] Jornada completa executada.');
});
