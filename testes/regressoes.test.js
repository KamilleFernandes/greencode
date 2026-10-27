// Regressões das correções feitas após a verificação do projeto.
// Rodam o CLI real (processo filho) com TZ=America/Sao_Paulo, onde "YYYY-MM-DD" parseado
// como UTC deslocava o dia.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function projeto() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "greencode-reg-"));
  fs.cpSync(path.join(__dirname, "..", "out"), path.join(dir, "out"), { recursive: true });
  return dir;
}

function cli(dir, linhas, tz = "America/Sao_Paulo") {
  const r = spawnSync(process.execPath, [path.join(dir, "out", "cli", "index.js")], {
    cwd: dir,
    input: linhas.join("\n") + "\n",
    encoding: "utf8",
    timeout: 20000,
    env: { ...process.env, TZ: tz },
  });
  if (r.error) throw r.error;
  return `${r.stdout}\n${r.stderr}`;
}

function dataLocal(deslocamentoDias) {
  const d = new Date();
  d.setDate(d.getDate() + deslocamentoDias);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const ORG =
  'organizacao cadastrar --razaoSocial "ACME LTDA" --cnpj 11222333000181 --inscricao 123 --endereco "Rua X, 1" --telefone 1140000000 --email a@b.com --contratoVencimento 2035-01-01 --contratoValor 5000';

function prepararBase(dir) {
  return cli(dir, [
    "Admin12345", "admin", "Admin12345",
    "usuario criar --login oper --senha Operador1 --papel OPERADOR_CADASTRO",
    "usuario criar --login gest --senha Gestor123 --papel GESTOR_ALMOXARIFADO",
    "usuario criar --login aud --senha Auditor12 --papel AUDITOR",
    "sair",
    "oper", "Operador1", ORG, "sair",
  ]);
}

test("datas AAAA-MM-DD usam o dia local: amanhã é rejeitado, exatamente 90 dias é aceito", () => {
  const dir = projeto();
  prepararBase(dir);
  const saida = cli(dir, [
    "gest", "Gestor123",
    `lote criar --org BR001 --nf 1 --transp T --data ${dataLocal(1)}`,
    `lote criar --org BR001 --nf 2 --transp T --data ${dataLocal(-90)}`,
    `lote criar --org BR001 --nf 3 --transp T --data ${dataLocal(-91)}`,
    `lote criar --org BR001 --nf 4 --transp T --data ${dataLocal(0)}`,
    "sair",
  ]);
  assert.match(saida, /não pode ser futura/);
  assert.match(saida, /mais de 90 dias/);
  assert.equal((saida.match(/\[OK\] Lote criado/g) || []).length, 2, saida);
});

test("lote consultar e relatório incluem o dia inicial e o dia final informados", () => {
  const dir = projeto();
  prepararBase(dir);
  const hoje = dataLocal(0);
  const saida = cli(dir, [
    "gest", "Gestor123",
    "lote criar --org BR001 --nf 1 --transp T",
    `lote consultar --inicio ${hoje} --fim ${hoje}`,
    "sair",
    "aud", "Auditor12",
    `relatorio organizacao --org BR001 --inicio ${hoje} --fim ${hoje}`,
    "sair",
  ]);
  assert.match(saida, /Total: 1/);
  assert.match(saida, /Lotes recebidos: 1/);
});

test("período invertido ou inválido é rejeitado nos relatórios", () => {
  const dir = projeto();
  prepararBase(dir);
  const saida = cli(dir, [
    "aud", "Auditor12",
    "relatorio financeiro --inicio 2026-12-31 --fim 2026-01-01",
    "relatorio financeiro --inicio 2026-02-30 --fim 2026-03-01",
    "sair",
  ]);
  assert.equal((saida.match(/\[ERRO\] Período inválido/g) || []).length, 2, saida);
});

test("config.master é gravado por último e contém administradorInicial", () => {
  const dir = projeto();
  cli(dir, ["Admin12345", "admin", "Admin12345", "sair"]);
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, "data", "config.master"), "utf8"));
  assert.match(cfg.chaveHex, /^[0-9a-f]{64}$/);
  assert.equal(cfg.administradorInicial.usuario, "admin");
  assert.deepEqual(fs.readdirSync(path.join(dir, "data")).filter((f) => f.endsWith(".tmp")), []);
});

test("provisionamento interrompido (config.master sem credenciais.dat) é refeito sem trancar o sistema", () => {
  const dir = projeto();
  fs.mkdirSync(path.join(dir, "data"));
  const chave = "ab".repeat(32);
  fs.writeFileSync(path.join(dir, "data", "config.master"), JSON.stringify({ chaveHex: chave }));
  const saida = cli(dir, ["Admin12345", "admin", "Admin12345", "sair"]);
  assert.match(saida, /Provisionamento anterior incompleto/);
  assert.match(saida, /Bem-vindo\(a\), admin/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "data", "config.master"), "utf8")).chaveHex, chave);
});

test("sobras sem config.master são arquivadas (renomeadas), não apagadas", () => {
  const dir = projeto();
  fs.mkdirSync(path.join(dir, "data"));
  fs.writeFileSync(path.join(dir, "data", "credenciais.dat"), "lixo-cifrado-com-chave-perdida");
  const saida = cli(dir, ["Admin12345", "admin", "Admin12345", "sair"]);
  assert.match(saida, /Bem-vindo\(a\), admin/);
  const arquivos = fs.readdirSync(path.join(dir, "data"));
  assert.ok(arquivos.some((f) => f.startsWith("credenciais.dat.orfao-")), arquivos.join(","));
});

test("histórico do CLI é carregado com o comando mais recente primeiro", () => {
  const dir = projeto();
  fs.mkdirSync(path.join(dir, "data"));
  fs.writeFileSync(path.join(dir, "data", ".cli_history"), "primeiro\nsegundo\nterceiro\n");
  const script =
    "const {CLIInterface}=require('./out/cli/CLIInterface');" +
    "const rl=new CLIInterface().criarReadlineComHistorico();" +
    "console.log('H='+JSON.stringify(rl.history));process.exit(0)";
  const r = spawnSync(process.execPath, ["-e", script], { cwd: dir, encoding: "utf8", input: "" });
  assert.match(r.stdout, /H=\["terceiro","segundo","primeiro"\]/, r.stdout + r.stderr);
});

test("histórico é criado com permissão restrita (0600) em sistemas POSIX", { skip: process.platform === "win32" }, () => {
  const dir = projeto();
  cli(dir, ["Admin12345", "admin", "Admin12345", "ajuda", "sair"]);
  const modo = fs.statSync(path.join(dir, "data", ".cli_history")).mode & 0o777;
  assert.equal(modo, 0o600);
});

test("journal: LOGIN_FALHA e LOGIN são atribuídos ao usuário, e a alíquota usa a chave correta", () => {
  const dir = projeto();
  cli(dir, [
    "Admin12345", "admin", "Admin12345",
    "config aliquota --valor 0.17",
    "sair",
    "fulano", "errada123",
    "admin", "Admin12345", "sair",
  ]);
  const { CriptografiaArquivo } = require("../out/persistencia/CriptografiaArquivo");
  const { RepositorioArquivo } = require("../out/persistencia/RepositorioArquivo");
  const { JournalTransacao } = require("../out/auditoria/JournalTransacao");
  const dataDir = path.join(dir, "data");
  const chave = JSON.parse(fs.readFileSync(path.join(dataDir, "config.master"), "utf8")).chaveHex;
  const c = new CriptografiaArquivo();
  JournalTransacao.configurar({ diretorio: dataDir, criptografia: c, chave, repositorio: new RepositorioArquivo(dataDir, c, chave) });
  const j = JournalTransacao.listarTodos();
  assert.ok(j.some((e) => e.operacao === "LOGIN_FALHA" && e.usuarioResponsavel === "fulano"));
  assert.ok(j.filter((e) => e.operacao === "LOGIN").every((e) => e.usuarioResponsavel === "admin"));
  const cfg = j.find((e) => e.operacao === "ALTERAR_CONFIGURACAO");
  assert.equal(cfg.dadosDepois.aliquotaImposto, 0.17);
});
