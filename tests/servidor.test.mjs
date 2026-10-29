// Processo real: porta por variável de ambiente e encerramento gracioso (SIGTERM).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { esperar } from './helpers.mjs';

const porta = 41000 + Math.floor(Math.random() * 1000);
const env = { ...process.env, NODE_ENV: 'production', PORT: String(porta), LOG_LEVEL: 'error' };

async function aguardarSaude(tentativas = 60) {
  for (let i = 0; i < tentativas; i++) {
    try { const r = await fetch(`http://127.0.0.1:${porta}/health`); if (r.ok) return await r.json(); } catch { /* ainda subindo */ }
    await esperar(250);
  }
  throw new Error('servidor não respondeu em /health');
}

test('servidor sobe na porta do ambiente e encerra com SIGTERM sem perder a conexão com o banco', { skip: process.platform === 'win32' ? 'Windows não entrega SIGTERM a processos filhos' : false }, async () => {
  const filho = spawn(process.execPath, ['out/server.js'], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = ''; filho.stderr.on('data', (d) => { stderr += d; });
  const saida = new Promise((resolve) => filho.once('exit', (codigo, sinal) => resolve({ codigo, sinal })));
  try {
    const saude = await aguardarSaude();
    assert.equal(saude.status, 'ok'); assert.equal(saude.database, 'ok');
    const inicio = Date.now();
    filho.kill('SIGTERM');
    const r = await Promise.race([saida, esperar(8000).then(() => 'timeout')]);
    assert.notEqual(r, 'timeout', 'não encerrou em 8s');
    assert.equal(r.codigo, 0, stderr);
    assert.ok(Date.now() - inicio < 8000);
    await assert.rejects(fetch(`http://127.0.0.1:${porta}/health`));
  } finally { if (filho.exitCode === null) filho.kill('SIGKILL'); }
});

test('PORT inválida impede a inicialização com mensagem clara', async () => {
  const filho = spawn(process.execPath, ['out/server.js'], { env: { ...env, PORT: 'abc' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = ''; filho.stderr.on('data', (d) => { stderr += d; });
  const codigo = await new Promise((resolve) => filho.once('exit', resolve));
  assert.notEqual(codigo, 0);
  assert.match(stderr, /PORT/);
});
