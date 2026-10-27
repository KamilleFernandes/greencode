const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { CriptografiaArquivo } = require("../out/persistencia/CriptografiaArquivo");
const { RepositorioArquivo } = require("../out/persistencia/RepositorioArquivo");
const { JournalTransacao } = require("../out/auditoria/JournalTransacao");
const {
  ServicoAutenticacao,
  salvarCredenciais,
  carregarCredenciais,
} = require("../out/seguranca/ServicoAutenticacao");
const { PapelUsuario } = require("../out/seguranca/PapelUsuario");
const { Sessao } = require("../out/seguranca/Sessao");
const { ServicoOrganizacao } = require("../out/organizacao/ServicoOrganizacao");
const { ConfiguracaoGlobal } = require("../out/organizacao/ConfiguracaoGlobal");
const { ValidadorCNPJ } = require("../out/validacao/ValidadorCNPJ");
const { ServicoLote } = require("../out/lote/ServicoLote");
const { carregarLotes } = require("../out/lote/Lote");
const {
  Equipamento,
  carregarEquipamentos,
} = require("../out/equipamento/Equipamento");
const { ServicoEquipamento } = require("../out/equipamento/ServicoEquipamento");
const { ServicoRelatorio } = require("../out/relatorio/ServicoRelatorio");
const { TipoEquipamento } = require("../out/equipamento/TipoEquipamento");
const { EstadoFisico } = require("../out/equipamento/EstadoFisico");
const { StatusRastreamento } = require("../out/equipamento/StatusRastreamento");
const { StatusLote } = require("../out/lote/StatusLote");
const { CLIInterface } = require("../out/cli/CLIInterface");

function criarAmbiente(prefixo = "greencode-jornada-") {
  const diretorio = fs.mkdtempSync(path.join(os.tmpdir(), prefixo));
  const criptografia = new CriptografiaArquivo();
  const chave = criptografia.gerarChave();
  const repositorio = new RepositorioArquivo(diretorio, criptografia, chave);

  JournalTransacao.configurar({
    diretorio,
    criptografia,
    chave,
    repositorio,
  });
  JournalTransacao.definirUsuarioAtual("TESTE");

  return {
    diretorio,
    criptografia,
    chave,
    repositorio,
    autenticacao: new ServicoAutenticacao(),
    organizacao: new ServicoOrganizacao(repositorio, new ValidadorCNPJ()),
    lote: new ServicoLote(repositorio),
    equipamento: new ServicoEquipamento(repositorio),
    relatorio: new ServicoRelatorio(repositorio),
  };
}

function vencimentoFuturo(anos = 1) {
  const data = new Date();
  data.setFullYear(data.getFullYear() + anos);
  return data;
}

function criarOrganizacaoValida(ambiente, cnpj = "11222333000181") {
  return ambiente.organizacao.cadastrarOrganizacao({
    razaoSocial: "Empresa Teste LTDA",
    cnpj,
    inscricaoEstadual: "123456",
    enderecoCompleto: "Rua Teste, 100",
    telefone: "11999999999",
    email: "contato@empresa.com",
    contrato: {
      dataVencimento: vencimentoFuturo(),
      valorMensal: 5000,
    },
  });
}

function criarLoteEquipamento(ambiente) {
  const org = criarOrganizacaoValida(ambiente);
  const lote = ambiente.lote.criarLote({
    organizacaoId: org.id,
    notaFiscal: "123456",
    transportadora: "TransRapida",
    dataEntrada: new Date(),
  });

  const eq = new Equipamento(
    "",
    TipoEquipamento.NOTEBOOK,
    "Dell",
    "Latitude",
    2021,
    EstadoFisico.BOM_ESTADO,
    2.3
  );

  ambiente.lote.adicionarEquipamentoLote(lote.id, eq);
  return { org, lote, eq };
}

function capturarConsole(fn) {
  const mensagens = [];
  const originalLog = console.log;
  const originalWrite = process.stdout.write;

  console.log = (...args) => mensagens.push(args.join(" "));
  process.stdout.write = (texto) => {
    mensagens.push(String(texto));
    return true;
  };

  try {
    const retorno = fn();
    return { mensagens, retorno };
  } finally {
    console.log = originalLog;
    process.stdout.write = originalWrite;
  }
}

function criarProjetoCLIIsolado() {
  const diretorio = fs.mkdtempSync(
    path.join(os.tmpdir(), "greencode-cli-integracao-")
  );

  const origemOut = path.join(__dirname, "..", "out");
  const destinoOut = path.join(diretorio, "out");
  fs.cpSync(origemOut, destinoOut, { recursive: true });

  return diretorio;
}

function executarCLI(diretorio, entrada) {
  const resultado = spawnSync(
    process.execPath,
    [path.join(diretorio, "out", "cli", "index.js")],
    {
      cwd: diretorio,
      input: entrada,
      encoding: "utf8",
      timeout: 15000,
    }
  );

  if (resultado.error) throw resultado.error;

  return {
    status: resultado.status,
    stdout: resultado.stdout ?? "",
    stderr: resultado.stderr ?? "",
    texto: `${resultado.stdout ?? ""}\n${resultado.stderr ?? ""}`,
  };
}

test("jornada completa: usuários -> organização -> lote -> triagem -> múltiplas movimentações -> rastreabilidade", () => {
  const ambiente = criarAmbiente();

  try {
    const admin = ambiente.autenticacao.criarUsuario(
      "admin",
      "Admin1234",
      PapelUsuario.ADMINISTRADOR
    );
    assert.equal(admin.papel, PapelUsuario.ADMINISTRADOR);

    ambiente.autenticacao.criarUsuario(
      "operador",
      "Operador123",
      PapelUsuario.OPERADOR_CADASTRO
    );
    ambiente.autenticacao.criarUsuario(
      "gestor",
      "Gestor123",
      PapelUsuario.GESTOR_ALMOXARIFADO
    );
    ambiente.autenticacao.criarUsuario(
      "auditor",
      "Auditor123",
      PapelUsuario.AUDITOR
    );

    salvarCredenciais(
      ambiente.repositorio,
      ambiente.autenticacao.credenciais
    );

    const sessaoOperador = ambiente.autenticacao.login(
      "operador",
      "Operador123"
    );
    assert.equal(
      sessaoOperador.papel,
      PapelUsuario.OPERADOR_CADASTRO
    );

    JournalTransacao.definirUsuarioAtual(sessaoOperador.usuario);

    const org = criarOrganizacaoValida(ambiente);
    assert.match(org.id, /^BR\d{3}$/);

    JournalTransacao.definirUsuarioAtual("gestor");

    const lote = ambiente.lote.criarLote({
      organizacaoId: org.id,
      notaFiscal: "123456",
      transportadora: "TransRapida",
      dataEntrada: new Date(),
    });
    assert.match(lote.id, /^LT\d{5}$/);

    const eq = new Equipamento(
      "",
      TipoEquipamento.NOTEBOOK,
      "Dell",
      "Latitude",
      2021,
      EstadoFisico.BOM_ESTADO,
      2.3
    );

    ambiente.lote.adicionarEquipamentoLote(lote.id, eq);
    assert.match(eq.id, /^EQ\d{6}$/);

    ambiente.lote.processarTriagem(lote.id);
    ambiente.lote.processarTriagem(lote.id);

    const loteTriado = carregarLotes(
      ambiente.repositorio,
      carregarEquipamentos(ambiente.repositorio)
    ).find((l) => l.id === lote.id);

    assert.equal(
      loteTriado.statusProcessamento,
      StatusLote.TRIAGEM_CONCLUIDA
    );

    ambiente.equipamento.movimentarEquipamento(
      eq.id,
      StatusRastreamento.AGUARDANDO_DESMONTE
    );
    ambiente.equipamento.movimentarEquipamento(
      eq.id,
      StatusRastreamento.EM_DESMONTE
    );
    ambiente.equipamento.movimentarEquipamento(
      eq.id,
      StatusRastreamento.MATERIAL_RECICLAVEL
    );
    ambiente.equipamento.movimentarEquipamento(
      eq.id,
      StatusRastreamento.BAIXA_DEFINITIVA
    );

    const rastreio =
      ambiente.equipamento.rastrearEquipamento(eq.id);

    assert.ok(rastreio.equipamento.codigoBarrasInterno);
    assert.equal(
      rastreio.equipamento.statusRastreamento,
      StatusRastreamento.BAIXA_DEFINITIVA
    );
    assert.ok(rastreio.movimentacoes.length >= 6);

    console.log("[PASS] Jornada completa executada.");
    console.log(`[PASS] Organização: ${org.id}`);
    console.log(`[PASS] Lote: ${lote.id}`);
    console.log(`[PASS] Equipamento: ${eq.id}`);
    console.log(
      `[PASS] Rastreabilidade: ${rastreio.movimentacoes.length} movimentações.`
    );
  } finally {
    JournalTransacao.definirUsuarioAtual(null);
    fs.rmSync(ambiente.diretorio, {
      recursive: true,
      force: true,
    });
  }
});

test("provisionamento real do CLI cria configuração mestre, administrador e persiste entre execuções", () => {
  const diretorio = criarProjetoCLIIsolado();

  try {
    const primeira = executarCLI(
      diretorio,
      [
        "Admin1234",
        "admin",
        "Admin1234",
        "sair",
        "",
      ].join("\n")
    );

    assert.equal(primeira.status, 0);
    assert.match(primeira.texto, /Provisionamento inicial/i);
    assert.match(
      primeira.texto,
      /Administrador ['"]?admin['"]? criado com sucesso/i
    );
    assert.match(
      primeira.texto,
      /Bem-vindo\(a\), admin \[ADMINISTRADOR\]/
    );

    const dataDir = path.join(diretorio, "data");
    const configPath = path.join(dataDir, "config.master");
    const credenciaisPath = path.join(
      dataDir,
      "credenciais.dat"
    );

    assert.equal(fs.existsSync(configPath), true);
    assert.equal(fs.existsSync(credenciaisPath), true);

    const config = JSON.parse(
      fs.readFileSync(configPath, "utf8")
    );

    assert.match(config.chaveHex, /^[0-9a-f]{64}$/i);

    assert.ok(
      JSON.stringify(config).toLowerCase().includes("admin"),
      "config.master deve conter também o cadastro/referência do primeiro administrador, conforme o enunciado."
    );

    const segunda = executarCLI(
      diretorio,
      ["admin", "Admin1234", "sair", ""].join("\n")
    );

    assert.equal(segunda.status, 0);
    assert.doesNotMatch(
      segunda.texto,
      /Provisionamento inicial/i
    );
    assert.match(
      segunda.texto,
      /Bem-vindo\(a\), admin \[ADMINISTRADOR\]/
    );

    console.log(
      "[PASS] Provisionamento inicial e reinicialização sem reprovisionar."
    );
  } finally {
    fs.rmSync(diretorio, {
      recursive: true,
      force: true,
    });
  }
});

test("sessão é configurada para aproximadamente 30 minutos e pode ser renovada", () => {
  const sessao = new Sessao(
    "token",
    "usuario",
    PapelUsuario.AUDITOR
  );

  const duracaoInicial =
    sessao.expiracao.getTime() - sessao.criacao.getTime();

  assert.ok(
    duracaoInicial >= 29 * 60 * 1000 &&
      duracaoInicial <= 31 * 60 * 1000
  );

  const expiracaoAnterior = sessao.expiracao.getTime();
  sessao.expiracao = new Date(Date.now() + 1000);
  sessao.renovar();

  assert.ok(
    sessao.expiracao.getTime() > expiracaoAnterior - 1000
  );
  assert.ok(
    sessao.expiracao.getTime() - Date.now() >=
      29 * 60 * 1000
  );

  console.log(
    "[PASS] Expiração e renovação de sessão em 30 minutos verificadas."
  );
});

test("persistência reidrata lotes, equipamentos, datas e histórico de movimentação", () => {
  const ambiente = criarAmbiente();

  try {
    const { lote, eq } =
      criarLoteEquipamento(ambiente);

    ambiente.lote.processarTriagem(lote.id);
    ambiente.lote.processarTriagem(lote.id);

    ambiente.equipamento.movimentarEquipamento(
      eq.id,
      StatusRastreamento.AGUARDANDO_DESMONTE
    );

    const equipamentos =
      carregarEquipamentos(ambiente.repositorio);
    const lotes = carregarLotes(
      ambiente.repositorio,
      equipamentos
    );

    const eqRecarregado = equipamentos.find(
      (e) => e.id === eq.id
    );
    const loteRecarregado = lotes.find(
      (l) => l.id === lote.id
    );

    assert.ok(eqRecarregado);
    assert.ok(loteRecarregado);
    assert.equal(
      typeof eqRecarregado.calcularDepreciacao,
      "function"
    );
    assert.equal(
      typeof loteRecarregado.gerarRelatorioTriagem,
      "function"
    );
    assert.ok(eqRecarregado.historicoMovimentacao.length >= 3);
    assert.ok(
      eqRecarregado.historicoMovimentacao[0].dataHora instanceof Date
    );
    assert.ok(loteRecarregado.dataEntrada instanceof Date);

    const bruto = fs.readFileSync(
      path.join(ambiente.diretorio, "equipamentos.dat"),
      "utf8"
    );
    assert.doesNotMatch(bruto, /AGUARDANDO_DESMONTE/);
    assert.doesNotMatch(bruto, /Latitude/);

    console.log(
      "[PASS] Reidratação e histórico persistido cifrado verificados."
    );
  } finally {
    fs.rmSync(ambiente.diretorio, {
      recursive: true,
      force: true,
    });
  }
});

test("relatórios por organização, status e financeiro retornam informações do fluxo", () => {
  const ambiente = criarAmbiente();

  try {
    ConfiguracaoGlobal.definirAliquotaImposto(0.17);
    ConfiguracaoGlobal.definirCoeficienteDepreciacao(
      TipoEquipamento.NOTEBOOK,
      0.15
    );

    const { org, lote, eq } =
      criarLoteEquipamento(ambiente);

    ambiente.lote.processarTriagem(lote.id);
    ambiente.lote.processarTriagem(lote.id);

    ambiente.equipamento.movimentarEquipamento(
      eq.id,
      StatusRastreamento.AGUARDANDO_DESMONTE
    );

    const inicio = new Date();
    inicio.setHours(0, 0, 0, 0);
    const fim = new Date();
    fim.setHours(23, 59, 59, 999);

    const porOrg =
      ambiente.relatorio.gerarRelatorioPorOrganizacao(
        org.id,
        { inicio, fim }
      );
    const porStatus =
      ambiente.relatorio.gerarRelatorioPorStatus(
        StatusRastreamento.AGUARDANDO_DESMONTE
      );
    const financeiro =
      ambiente.relatorio.gerarRelatorioFinanceiro({
        inicio,
        fim,
      });

    assert.match(porOrg, new RegExp(org.id));
    assert.match(porOrg, /Lotes recebidos:\s*1/);
    assert.match(
      porOrg,
      /Equipamentos processados:\s*1/
    );
    assert.match(porStatus, /Total encontrado:\s*1/);
    assert.match(porStatus, /NOTEBOOK/);
    assert.match(
      financeiro,
      /Alíquota de imposto configurada:\s*17\.0%/
    );

    console.log(
      "[PASS] Relatórios de organização, status e financeiro verificados."
    );
  } finally {
    fs.rmSync(ambiente.diretorio, {
      recursive: true,
      force: true,
    });
  }
});

test("menus do CLI se adaptam ao papel e ocultam comandos sem permissão", () => {
  const cli = new CLIInterface();

  function menu(papel) {
    const mensagens = [];
    const original = console.log;
    console.log = (...args) =>
      mensagens.push(args.join(" "));
    try {
      cli.exibirMenuPorPapel(papel);
    } finally {
      console.log = original;
    }
    return mensagens.join("\n");
  }

  const admin = menu(PapelUsuario.ADMINISTRADOR);
  assert.match(admin, /usuario criar/);
  assert.match(admin, /config aliquota/);
  assert.doesNotMatch(admin, /lote criar/);

  const operador = menu(
    PapelUsuario.OPERADOR_CADASTRO
  );
  assert.match(operador, /organizacao cadastrar/);
  assert.match(operador, /organizacao renovar/);
  assert.doesNotMatch(operador, /usuario criar/);

  const gestor = menu(
    PapelUsuario.GESTOR_ALMOXARIFADO
  );
  assert.match(gestor, /lote criar/);
  assert.match(gestor, /equipamento movimentar/);
  assert.doesNotMatch(gestor, /config aliquota/);

  const auditor = menu(PapelUsuario.AUDITOR);
  assert.match(auditor, /equipamento rastrear/);
  assert.match(auditor, /relatorio financeiro/);
  assert.doesNotMatch(auditor, /lote criar/);
  assert.doesNotMatch(auditor, /usuario criar/);

  console.log("[PASS] Menus por papel verificados.");
});

test('comando "sair" encerra a sessão atual e volta ao login sem reiniciar', async () => {
  const cli = new CLIInterface();

  cli.rl = {
    close() {},
  };

  cli.sessaoAtual = new Sessao(
    "token-admin",
    "admin",
    PapelUsuario.ADMINISTRADOR
  );

  cli.entradaEncerrada = false;

  let logoutChamado = false;
  let loginChamado = 0;

  cli.autenticacao.logout = (token) => {
    assert.equal(token, "token-admin");
    logoutChamado = true;
  };

  cli.exibirMenuPorPapel = () => {};
  cli.salvarLinhaNoHistorico = () => {};
  cli.lerLinha = async () => "sair";

  cli.fazerLogin = async () => {
    loginChamado++;

    cli.sessaoAtual = new Sessao(
      "token-operador",
      "operador",
      PapelUsuario.OPERADOR_CADASTRO
    );

    cli.entradaEncerrada = true;
  };

  await cli.loopDeComandos();

  assert.equal(logoutChamado, true);
  assert.equal(loginChamado, 1);
  assert.ok(cli.sessaoAtual);
  assert.equal(cli.sessaoAtual.usuario, "operador");
  assert.equal(
    cli.sessaoAtual.papel,
    PapelUsuario.OPERADOR_CADASTRO
  );

  console.log(
    '[PASS] "sair" voltou ao login sem reiniciar o programa.'
  );
});
