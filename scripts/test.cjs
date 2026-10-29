const { spawnSync } = require('node:child_process');
const path = require('node:path');

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  console.error('TEST_DATABASE_URL não definida. Configure-a no .env; o script não usará DATABASE_URL como fallback.');
  process.exit(2);
}
let parsed;
try { parsed = new URL(testUrl); } catch {
  console.error('TEST_DATABASE_URL não é uma URL válida.');
  process.exit(2);
}
const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, '')).split('?')[0];
if (!/test/i.test(dbName)) {
  console.error(`Bloqueado por segurança: o banco '${dbName}' não parece ser um banco de testes (o nome deve conter 'test').`);
  process.exit(2);
}
const env = { ...process.env, DATABASE_URL: testUrl, NODE_ENV: 'test' };
const isWindows = process.platform === 'win32';
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', env, shell: isWindows, cwd: path.resolve(__dirname, '..') });
  if (result.error) { console.error(result.error); process.exit(result.status || 1); }
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Banco isolado para testes: ${dbName}`);
console.log('1/4 - Geração do Prisma Client e build TypeScript.');
run('npm', ['run', 'build']);
console.log('2/4 - Reset do banco TESTE (nenhum outro banco será usado pelo script).');
run('npx', ['prisma', 'migrate', 'reset', '--force', '--skip-seed']);
console.log('3/4 - Seed idempotente.');
run('npx', ['prisma', 'db', 'seed']);
console.log('4/4 - Testes de integração da API (' + (process.argv[2] === 'jornada' ? 'somente a jornada completa' : 'suíte completa') + ').');
const todos = ['tests/api.test.mjs', 'tests/validacoes.test.mjs', 'tests/regras.test.mjs', 'tests/auditoria.test.mjs', 'tests/jornada-completa.test.mjs', 'tests/servidor.test.mjs'];
const arquivos = process.argv[2] === 'jornada' ? ['tests/jornada-completa.test.mjs'] : todos;
// --test-concurrency=1: os arquivos compartilham o mesmo banco de teste e rodam um por vez.
run('node', ['--test', '--test-concurrency=1', ...arquivos]);
