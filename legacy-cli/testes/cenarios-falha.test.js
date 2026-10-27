{
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


test("credenciais usam SHA-256 com salt e persistência cifrada", () => {
  const ambiente = criarAmbiente();

  try {
    const senha = "SenhaSegura123";
    const credencial =
      ambiente.autenticacao.criarUsuario(
        "seguro",
        senha,
        PapelUsuario.AUDITOR
      );

    assert.match(credencial.hashSenha, /^[0-9a-f]{64}$/i);
    assert.ok(credencial.salt.length >= 16);
    assert.notEqual(credencial.hashSenha, senha);
    assert.equal(credencial.verificarSenha(senha), true);

    salvarCredenciais(
      ambiente.repositorio,
      ambiente.autenticacao.credenciais
    );

    const bruto = fs.readFileSync(
      path.join(ambiente.diretorio, "credenciais.dat"),
      "utf8"
    );

    assert.doesNotMatch(bruto, /SenhaSegura123/);
    assert.doesNotMatch(bruto, /"usuario"\s*:/);
    assert.doesNotMatch(bruto, /"hashSenha"\s*:/);

    const recarregadas = carregarCredenciais(
      ambiente.repositorio
    );
    assert.equal(recarregadas.length, 1);
    assert.equal(
      recarregadas[0].verificarSenha(senha),
      true
    );

    console.log(
      "[PASS] SHA-256, salt e credenciais cifradas verificados."
    );
  } finally {
    fs.rmSync(ambiente.diretorio, {
      recursive: true,
      force: true,
    });
  }
});

test("AES-256: chave possui 256 bits, dados são cifrados e decifrados corretamente", () => {
  const criptografia = new CriptografiaArquivo();
  const chave = criptografia.gerarChave();
  const texto = '{"segredo":"GreenCode"}';

  assert.match(chave, /^[0-9a-f]{64}$/i);

  const cifrado = criptografia.cifrar(texto, chave);

  assert.notEqual(cifrado, texto);
  assert.doesNotMatch(cifrado, /GreenCode/);
  assert.equal(
    criptografia.decifrar(cifrado, chave),
    texto
  );

  const fonte = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "src",
      "persistencia",
      "CriptografiaArquivo.ts"
    ),
    "utf8"
  );

  assert.match(fonte, /aes-256/i);

  console.log("[PASS] AES-256 verificado.");
});

test("configurações globais válidas persistem cifradas e são restauradas", () => {
  const ambiente = criarAmbiente();

  try {
    ConfiguracaoGlobal.definirAliquotaImposto(0.17);
    ConfiguracaoGlobal.definirCoeficienteDepreciacao(
      TipoEquipamento.NOTEBOOK,
      0.15
    );

    ambiente.repositorio.salvarEntidade(
      "configuracao.dat",
      [ConfiguracaoGlobal.toJSON()]
    );

    const bruto = fs.readFileSync(
      path.join(ambiente.diretorio, "configuracao.dat"),
      "utf8"
    );

    assert.doesNotMatch(bruto, /aliquotaImposto/);
    assert.doesNotMatch(bruto, /NOTEBOOK/);

    ConfiguracaoGlobal.definirAliquotaImposto(0);
    ConfiguracaoGlobal.definirCoeficienteDepreciacao(
      TipoEquipamento.NOTEBOOK,
      0.01
    );

    const salva =
      ambiente.repositorio.listarEntidades(
        "configuracao.dat"
      )[0];

    ConfiguracaoGlobal.carregarDeJSON(salva);

    assert.equal(
      ConfiguracaoGlobal.obterAliquotaImposto(),
      0.17
    );
    assert.equal(
      ConfiguracaoGlobal.obterCoeficienteDepreciacao(
        TipoEquipamento.NOTEBOOK
      ),
      0.15
    );

    console.log(
      "[PASS] Configurações globais persistidas e restauradas."
    );
  } finally {
    fs.rmSync(ambiente.diretorio, {
      recursive: true,
      force: true,
    });
  }
});

test("arquivos de organizações, lotes, equipamentos e movimentações persistidas não ficam em texto claro", () => {
  const ambiente = criarAmbiente();

  try {
    ambiente.autenticacao.criarUsuario(
      "operador",
      "Operador123",
      PapelUsuario.OPERADOR_CADASTRO
    );
    salvarCredenciais(
      ambiente.repositorio,
      ambiente.autenticacao.credenciais
    );

    const { org, lote, eq } =
      criarLoteEquipamento(ambiente);

    ambiente.lote.processarTriagem(lote.id);
    ambiente.lote.processarTriagem(lote.id);
    ambiente.equipamento.movimentarEquipamento(
      eq.id,
      StatusRastreamento.AGUARDANDO_DESMONTE
    );

    const verificacoes = [
      ["credenciais.dat", "operador"],
      ["organizacoes.dat", org.razaoSocial],
      ["lotes.dat", lote.notaFiscal],
      ["equipamentos.dat", "Latitude"],
      ["equipamentos.dat", "AGUARDANDO_DESMONTE"],
    ];

    for (const [arquivo, segredo] of verificacoes) {
      const caminho = path.join(
        ambiente.diretorio,
        arquivo
      );
      assert.equal(
        fs.existsSync(caminho),
        true,
        `${arquivo} deveria existir.`
      );

      const bruto = fs.readFileSync(
        caminho,
        "utf8"
      );

      assert.equal(
        bruto.includes(segredo),
        false,
        `${arquivo} não deve expor "${segredo}" em texto claro.`
      );
    }

    console.log(
      "[PASS] Arquivos de persistência do domínio e movimentações estão cifrados."
    );
  } finally {
    fs.rmSync(ambiente.diretorio, {
      recursive: true,
      force: true,
    });
  }
});

test("triagem gera códigos de barras internos únicos", () => {
  const ambiente = criarAmbiente();

  try {
    const org = criarOrganizacaoValida(ambiente);
    const lote = ambiente.lote.criarLote({
      organizacaoId: org.id,
      notaFiscal: "NF-BARRAS",
      transportadora: "TransRapida",
      dataEntrada: new Date(),
    });

    const eq1 = new Equipamento(
      "",
      TipoEquipamento.NOTEBOOK,
      "Dell",
      "A",
      2021,
      EstadoFisico.BOM_ESTADO,
      2
    );
    const eq2 = new Equipamento(
      "",
      TipoEquipamento.MONITOR,
      "LG",
      "B",
      2022,
      EstadoFisico.BOM_ESTADO,
      4
    );

    ambiente.lote.adicionarEquipamentoLote(
      lote.id,
      eq1
    );
    ambiente.lote.adicionarEquipamentoLote(
      lote.id,
      eq2
    );

    ambiente.lote.processarTriagem(lote.id);

    const equipamentos =
      carregarEquipamentos(ambiente.repositorio);

    const codigos = equipamentos.map(
      (e) => e.codigoBarrasInterno
    );

    assert.equal(new Set(codigos).size, 2);
    assert.ok(codigos.every(Boolean));
    assert.match(codigos[0], /^[A-Z]{3}-\d{6}$/);
    assert.match(codigos[1], /^[A-Z]{3}-\d{6}$/);

    console.log(
      "[PASS] Códigos de barras internos únicos gerados na triagem."
    );
  } finally {
    fs.rmSync(ambiente.diretorio, {
      recursive: true,
      force: true,
    });
  }
});

test("consulta de lotes por período e relatório de triagem funcionam", () => {
  const ambiente = criarAmbiente();

  try {
    const { lote } = criarLoteEquipamento(ambiente);
    ambiente.lote.processarTriagem(lote.id);
    ambiente.lote.processarTriagem(lote.id);

    const inicio = new Date();
    inicio.setDate(inicio.getDate() - 1);
    const fim = new Date();
    fim.setDate(fim.getDate() + 1);

    const encontrados =
      ambiente.lote.consultarLotePorPeriodo(
        inicio,
        fim
      );

    assert.ok(
      encontrados.some((l) => l.id === lote.id)
    );

    const alvo = encontrados.find(
      (l) => l.id === lote.id
    );

    const relatorio = alvo.gerarRelatorioTriagem();
    assert.match(relatorio, new RegExp(lote.id));
    assert.match(relatorio, /TRIAGEM_CONCLUIDA/);
    assert.match(relatorio, /NOTEBOOK/);

    console.log(
      "[PASS] Consulta por período e relatório de triagem verificados."
    );
  } finally {
    fs.rmSync(ambiente.diretorio, {
      recursive: true,
      force: true,
    });
  }
});

test("ajuda do CLI acompanha o papel autenticado e não exibe ações indevidas", () => {
  const cli = new CLIInterface();

  function ajuda(papel) {
    cli.sessaoAtual = new Sessao(
      "token",
      "usuario",
      papel
    );

    const mensagens = [];
    const original = console.log;
    console.log = (...args) =>
      mensagens.push(args.join(" "));

    try {
      cli.exibirAjuda();
    } finally {
      console.log = original;
    }

    return mensagens.join("\n");
  }

  const admin = ajuda(
    PapelUsuario.ADMINISTRADOR
  );
  assert.match(admin, /usuario criar/);
  assert.match(admin, /config aliquota/);
  assert.doesNotMatch(admin, /lote criar/);

  const operador = ajuda(
    PapelUsuario.OPERADOR_CADASTRO
  );
  assert.match(
    operador,
    /organizacao cadastrar/
  );
  assert.doesNotMatch(
    operador,
    /usuario criar/
  );

  const gestor = ajuda(
    PapelUsuario.GESTOR_ALMOXARIFADO
  );
  assert.match(gestor, /lote criar/);
  assert.match(
    gestor,
    /equipamento movimentar/
  );
  assert.doesNotMatch(
    gestor,
    /config aliquota/
  );

  const auditor = ajuda(PapelUsuario.AUDITOR);
  assert.match(
    auditor,
    /relatorio organizacao/
  );
  assert.match(
    auditor,
    /equipamento rastrear/
  );
  assert.doesNotMatch(
    auditor,
    /lote criar/
  );

  console.log(
    "[PASS] Ajuda adaptada por papel verificada."
  );
});

test("CLI aceita valores entre aspas e parâmetros opcionais sem perder espaços", () => {
  const cli = new CLIInterface();
  cli.sessaoAtual = new Sessao(
    "token-operador",
    "operador",
    PapelUsuario.OPERADOR_CADASTRO
  );

  let recebido = null;

  cli.organizacao = {
    cadastrarOrganizacao(dados) {
      recebido = dados;
      return {
        id: "BR001",
        razaoSocial: dados.razaoSocial,
      };
    },
  };

  capturarConsole(() =>
    cli.processarComando(
      'organizacao cadastrar --razaoSocial "Empresa Com Espacos LTDA" --cnpj 11222333000181 --inscricao 123 --endereco "Rua das Flores, 100" --telefone 11999999999 --email teste@empresa.com --contratoVencimento 2028-01-01 --contratoValor 5000'
    )
  );

  assert.ok(recebido);
  assert.equal(
    recebido.razaoSocial,
    "Empresa Com Espacos LTDA"
  );
  assert.equal(
    recebido.enderecoCompleto,
    "Rua das Flores, 100"
  );
  assert.equal(
    recebido.contrato.dataVencimento,
    "2028-01-01"
  );

  console.log(
    "[PASS] Parser do CLI preserva argumentos entre aspas."
  );
});

test('CLI interpreta o exemplo "lote criar --org ... --nf ... --transp ..." do enunciado', () => {
  const cli = new CLIInterface();
  cli.sessaoAtual = new Sessao(
    "token-gestor",
    "gestor",
    PapelUsuario.GESTOR_ALMOXARIFADO
  );

  let recebido = null;

  cli.lote = {
    criarLote(dados) {
      recebido = dados;
      return { id: "LT00001" };
    },
  };

  const { mensagens } = capturarConsole(() =>
    cli.processarComando(
      "lote criar --org BR001 --nf 123456 --transp TransRapida"
    )
  );

  assert.ok(recebido);
  assert.equal(recebido.organizacaoId, "BR001");
  assert.equal(recebido.notaFiscal, "123456");
  assert.equal(recebido.transportadora, "TransRapida");
  assert.ok(recebido.dataEntrada instanceof Date);
  assert.match(
    mensagens.join("\\n"),
    /\[OK\].*LT00001/
  );

  console.log(
    "[PASS] Exemplo de criação de lote do enunciado executado pelo parser."
  );
});

test("histórico do CLI oculta senhas e persiste os comandos", () => {
  const diretorio = criarProjetoCLIIsolado();

  try {
    const execucao = executarCLI(
      diretorio,
      [
        "Admin1234",
        "admin",
        "Admin1234",
        "usuario criar --login historico --senha Segredo123 --papel AUDITOR",
        'senha alterar --antiga "Admin1234" --nova "NovaAdmin123"',
        "sair",
        "",
      ].join("\n")
    );

    assert.equal(execucao.status, 0);

    const historicoPath = path.join(
      diretorio,
      "data",
      ".cli_history"
    );

    assert.equal(fs.existsSync(historicoPath), true);

    const historico = fs.readFileSync(
      historicoPath,
      "utf8"
    );

    assert.match(historico, /usuario criar/);
    assert.match(historico, /senha alterar/);
    assert.match(historico, /\[OCULTO\]/);
    assert.doesNotMatch(historico, /Segredo123/);
    assert.doesNotMatch(historico, /Admin1234/);
    assert.doesNotMatch(historico, /NovaAdmin123/);

    console.log(
      "[PASS] Histórico persistente com credenciais ocultas verificado."
    );
  } finally {
    fs.rmSync(diretorio, {
      recursive: true,
      force: true,
    });
  }
});

test("CLI contém autocomplete readline, histórico persistente e feedback por severidade", () => {
  const fonte = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "src",
      "cli",
      "CLIInterface.ts"
    ),
    "utf8"
  );

  assert.match(fonte, /readline/);
  assert.match(fonte, /completer/);
  assert.match(fonte, /\.cli_history/);
  assert.match(fonte, /\[OK\]/);
  assert.match(fonte, /\[ERRO\]/);
  assert.match(fonte, /\[AVISO\]/);

  console.log(
    "[PASS] Autocomplete, histórico e níveis de severidade presentes no CLI."
  );
});

test("scripts npm usados na entrega são portáveis entre Windows e Linux", () => {
  const pacote = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "..", "package.json"),
      "utf8"
    )
  );

  assert.match(pacote.scripts.build, /\btsc\b/);
  assert.match(
    pacote.scripts.start,
    /\bnode\b.*out[\/\\]cli[\/\\]index\.js/
  );
  assert.match(pacote.scripts.test, /\bnode\b.*--test/);

  const scripts = Object.values(
    pacote.scripts
  ).join("\n");

  assert.doesNotMatch(
    scripts,
    /\bpowershell\b|\bcmd\s+\/c\b/i
  );

  console.log(
    `[PASS] Scripts npm sem dependência exclusiva de shell (${process.platform}).`
  );
});

test("documentação de segurança descreve AES, SHA-256, sessão e cenários de falha", () => {
  const raiz = path.join(__dirname, "..");
  const candidatos = [
    "README.md",
    "DOCUMENTACAO_FINAL.md",
    "documentacao.md",
    path.join("docs", "SEGURANCA.md"),
    path.join("docs", "README.md"),
  ];

  const textos = candidatos
    .map((nome) => path.join(raiz, nome))
    .filter((arquivo) => fs.existsSync(arquivo))
    .map((arquivo) => fs.readFileSync(arquivo, "utf8"))
    .join("\n");

  assert.ok(
    textos.trim().length > 0,
    "Nenhum arquivo de documentação esperado foi encontrado."
  );
  assert.match(textos, /AES[- ]?256/i);
  assert.match(textos, /SHA[- ]?256/i);
  assert.match(textos, /30\s*min|trinta minutos/i);
  assert.match(
    textos,
    /cen[aá]rios? de falha|falhas? testadas?/i
  );

  console.log(
    "[PASS] Documentação de segurança contém os tópicos exigidos."
  );
});
}

{
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { CriptografiaArquivo } = require("../out/persistencia/CriptografiaArquivo");
const { RepositorioArquivo } = require("../out/persistencia/RepositorioArquivo");
const { JournalTransacao } = require("../out/auditoria/JournalTransacao");
const {
  ServicoAutenticacao,
} = require("../out/seguranca/ServicoAutenticacao");
const { PapelUsuario } = require("../out/seguranca/PapelUsuario");
const { Sessao } = require("../out/seguranca/Sessao");
const { ServicoOrganizacao } = require("../out/organizacao/ServicoOrganizacao");
const { ConfiguracaoGlobal } = require("../out/organizacao/ConfiguracaoGlobal");
const { ValidadorCNPJ } = require("../out/validacao/ValidadorCNPJ");
const { ServicoLote } = require("../out/lote/ServicoLote");
const {
  Equipamento,
  carregarEquipamentos,
} = require("../out/equipamento/Equipamento");
const { ServicoEquipamento } = require("../out/equipamento/ServicoEquipamento");
const { TipoEquipamento } = require("../out/equipamento/TipoEquipamento");
const { EstadoFisico } = require("../out/equipamento/EstadoFisico");
const { StatusRastreamento } = require("../out/equipamento/StatusRastreamento");
const { CLIInterface } = require("../out/cli/CLIInterface");

function criarAmbiente(prefixo = "greencode-falha-") {
  const diretorio = fs.mkdtempSync(
    path.join(os.tmpdir(), prefixo)
  );
  const criptografia = new CriptografiaArquivo();
  const chave = criptografia.gerarChave();
  const repositorio = new RepositorioArquivo(
    diretorio,
    criptografia,
    chave
  );

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
    organizacao: new ServicoOrganizacao(
      repositorio,
      new ValidadorCNPJ()
    ),
    lote: new ServicoLote(repositorio),
    equipamento: new ServicoEquipamento(repositorio),
  };
}

function limpar(ambiente) {
  JournalTransacao.definirUsuarioAtual(null);
  fs.rmSync(ambiente.diretorio, {
    recursive: true,
    force: true,
  });
}

function vencimentoFuturo(anos = 1) {
  const data = new Date();
  data.setFullYear(data.getFullYear() + anos);
  return data;
}

function criarOrganizacaoValida(
  ambiente,
  cnpj = "11222333000181"
) {
  return ambiente.organizacao.cadastrarOrganizacao({
    razaoSocial: "Empresa Válida LTDA",
    cnpj,
    inscricaoEstadual: "123456",
    enderecoCompleto: "Rua Teste, 100",
    telefone: "11999999999",
    email: "teste@empresa.com",
    contrato: {
      dataVencimento: vencimentoFuturo(),
      valorMensal: 5000,
    },
  });
}

function criarLoteComEquipamento(ambiente) {
  const org = criarOrganizacaoValida(ambiente);

  const lote = ambiente.lote.criarLote({
    organizacaoId: org.id,
    notaFiscal: "NF-TESTE",
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

  ambiente.lote.adicionarEquipamentoLote(
    lote.id,
    eq
  );

  return { org, lote, eq };
}

function capturarConsole(fn) {
  const mensagens = [];
  const original = console.log;
  console.log = (...args) =>
    mensagens.push(args.join(" "));

  try {
    fn();
  } finally {
    console.log = original;
  }

  return mensagens.join("\n");
}


test("falha: senha incorreta é rejeitada", () => {
  const ambiente = criarAmbiente();

  try {
    ambiente.autenticacao.criarUsuario(
      "admin",
      "Admin1234",
      PapelUsuario.ADMINISTRADOR
    );

    assert.throws(
      () =>
        ambiente.autenticacao.login(
          "admin",
          "senha-errada"
        ),
      /Usuário ou senha inválidos/
    );

    console.log(
      "[PASS] Falha de autenticação rejeitada."
    );
  } finally {
    limpar(ambiente);
  }
});

test("falha: sessão expirada após inatividade é inválida", () => {
  const sessao = new Sessao(
    "token-teste",
    "usuario",
    PapelUsuario.AUDITOR
  );
  sessao.expiracao = new Date(Date.now() - 1);

  assert.equal(sessao.isValida(), false);

  console.log("[PASS] Sessão expirada rejeitada.");
});

test("falha: CLI informa expiração da sessão com nível AVISO", async () => {
  const cli = new CLIInterface();

  cli.rl = { close() {} };
  cli.entradaEncerrada = false;
  cli.sessaoAtual = new Sessao(
    "token",
    "auditor",
    PapelUsuario.AUDITOR
  );
  cli.sessaoAtual.expiracao = new Date(
    Date.now() - 1000
  );

  let loginChamado = false;

  cli.fazerLogin = async () => {
    loginChamado = true;
    cli.entradaEncerrada = true;
    cli.sessaoAtual = null;
  };

  const mensagens = [];
  const original = console.log;
  console.log = (...args) =>
    mensagens.push(args.join(" "));

  try {
    await cli.loopDeComandos();
  } finally {
    console.log = original;
  }

  assert.equal(loginChamado, true);
  assert.match(
    mensagens.join("\n"),
    /\[AVISO\].*Sessão expirada/i
  );

  console.log(
    "[PASS] Expiração exibida como AVISO."
  );
});

test("falha: usuário duplicado é rejeitado", () => {
  const ambiente = criarAmbiente();

  try {
    ambiente.autenticacao.criarUsuario(
      "teste",
      "Teste1234",
      PapelUsuario.AUDITOR
    );

    assert.throws(
      () =>
        ambiente.autenticacao.criarUsuario(
          "teste",
          "Outra1234",
          PapelUsuario.AUDITOR
        ),
      /Usuário já cadastrado/
    );

    console.log("[PASS] Usuário duplicado rejeitado.");
  } finally {
    limpar(ambiente);
  }
});

test("falha: papel de usuário inválido é rejeitado", () => {
  const ambiente = criarAmbiente();

  try {
    assert.throws(
      () =>
        ambiente.autenticacao.criarUsuario(
          "teste",
          "Teste1234",
          "INVALIDO"
        ),
      /Papel inválido/
    );

    console.log("[PASS] Papel inválido rejeitado.");
  } finally {
    limpar(ambiente);
  }
});

test("falha: senha fraca é rejeitada na criação do usuário", () => {
  const ambiente = criarAmbiente();

  try {
    assert.throws(
      () =>
        ambiente.autenticacao.criarUsuario(
          "teste",
          "123",
          PapelUsuario.AUDITOR
        ),
      /senha.*mínimo 8|senha.*8 caracteres/i
    );

    console.log("[PASS] Senha fraca rejeitada.");
  } finally {
    limpar(ambiente);
  }
});

test("gestão de usuário: alterar papel e remover usuário funcionam", () => {
  const ambiente = criarAmbiente();

  try {
    ambiente.autenticacao.criarUsuario(
      "teste",
      "Teste1234",
      PapelUsuario.OPERADOR_CADASTRO
    );

    assert.equal(
      ambiente.autenticacao.editarPapelUsuario(
        "teste",
        PapelUsuario.AUDITOR
      ),
      true
    );

    assert.equal(
      ambiente.autenticacao.listarUsuarios()[0].papel,
      PapelUsuario.AUDITOR
    );

    assert.equal(
      ambiente.autenticacao.removerUsuario("teste"),
      true
    );

    assert.equal(
      ambiente.autenticacao.listarUsuarios().length,
      0
    );

    console.log(
      "[PASS] Alteração de papel e remoção de usuário."
    );
  } finally {
    limpar(ambiente);
  }
});

test("falha: único administrador não pode ser rebaixado", () => {
  const ambiente = criarAmbiente();

  try {
    ambiente.autenticacao.criarUsuario(
      "admin",
      "Admin1234",
      PapelUsuario.ADMINISTRADOR
    );

    assert.throws(
      () =>
        ambiente.autenticacao.editarPapelUsuario(
          "admin",
          PapelUsuario.AUDITOR
        ),
      /único administrador/i
    );

    console.log(
      "[PASS] Proteção do único administrador verificada."
    );
  } finally {
    limpar(ambiente);
  }
});

test("alteração de senha valida senha antiga e troca a credencial", () => {
  const ambiente = criarAmbiente();

  try {
    ambiente.autenticacao.criarUsuario(
      "usuario",
      "SenhaAntiga123",
      PapelUsuario.AUDITOR
    );

    assert.equal(
      ambiente.autenticacao.alterarSenha(
        "usuario",
        "errada",
        "SenhaNova123"
      ),
      false
    );

    assert.equal(
      ambiente.autenticacao.alterarSenha(
        "usuario",
        "SenhaAntiga123",
        "SenhaNova123"
      ),
      true
    );

    assert.throws(
      () =>
        ambiente.autenticacao.login(
          "usuario",
          "SenhaAntiga123"
        ),
      /Usuário ou senha inválidos/
    );

    assert.equal(
      ambiente.autenticacao.login(
        "usuario",
        "SenhaNova123"
      ).usuario,
      "usuario"
    );

    console.log("[PASS] Alteração de senha verificada.");
  } finally {
    limpar(ambiente);
  }
});

test("falha: alíquota rejeita NaN, valor negativo e valor acima de 1", () => {
  for (const valor of [NaN, -0.1, 1.01]) {
    assert.throws(
      () =>
        ConfiguracaoGlobal.definirAliquotaImposto(
          valor
        ),
      /Alíquota.*entre 0 e 1/i
    );
  }

  ConfiguracaoGlobal.definirAliquotaImposto(0.17);
  assert.equal(
    ConfiguracaoGlobal.obterAliquotaImposto(),
    0.17
  );

  console.log(
    "[PASS] Validação de alíquota verificada."
  );
});

test("falha: depreciação rejeita NaN, valor negativo, valor acima de 1 e tipo inválido", () => {
  for (const valor of [NaN, -0.1, 1.01]) {
    assert.throws(
      () =>
        ConfiguracaoGlobal.definirCoeficienteDepreciacao(
          TipoEquipamento.NOTEBOOK,
          valor
        ),
      /depreciação.*entre 0 e 1|coeficiente.*entre 0 e 1/i
    );
  }

  assert.throws(
    () =>
      ConfiguracaoGlobal.definirCoeficienteDepreciacao(
        "INVALIDO",
        0.15
      ),
    /Tipo de equipamento inválido/i
  );

  console.log(
    "[PASS] Validação de depreciação verificada."
  );
});

test("falha: CNPJ inválido é rejeitado e não é persistido", () => {
  const ambiente = criarAmbiente();

  try {
    assert.throws(
      () =>
        ambiente.organizacao.cadastrarOrganizacao({
          razaoSocial: "Empresa Inválida LTDA",
          cnpj: "11111111111111",
          inscricaoEstadual: "123",
          enderecoCompleto: "Rua A, 1",
          telefone: "11999999999",
          email: "invalida@teste.com",
          contrato: {
            dataVencimento: vencimentoFuturo(),
            valorMensal: 1000,
          },
        }),
      /CNPJ inválido/
    );

    assert.equal(
      ambiente.organizacao.listarOrganizacoesAtivas()
        .length,
      0
    );

    console.log(
      "[PASS] CNPJ inválido rejeitado e não persistido."
    );
  } finally {
    limpar(ambiente);
  }
});

test("falha: CNPJ duplicado é rejeitado", () => {
  const ambiente = criarAmbiente();

  try {
    criarOrganizacaoValida(ambiente);

    assert.throws(
      () =>
        ambiente.organizacao.cadastrarOrganizacao({
          razaoSocial: "Empresa Duplicada LTDA",
          cnpj: "11222333000181",
          inscricaoEstadual: "999",
          enderecoCompleto: "Rua B, 2",
          telefone: "11999999999",
          email: "duplicada@teste.com",
          contrato: {
            dataVencimento: vencimentoFuturo(),
            valorMensal: 1000,
          },
        }),
      /CNPJ já cadastrado/
    );

    assert.equal(
      ambiente.organizacao.listarOrganizacoesAtivas()
        .length,
      1
    );

    console.log("[PASS] CNPJ duplicado rejeitado.");
  } finally {
    limpar(ambiente);
  }
});

test("falha: organização sem contrato inicial é rejeitada", () => {
  const ambiente = criarAmbiente();

  try {
    assert.throws(
      () =>
        ambiente.organizacao.cadastrarOrganizacao({
          razaoSocial: "Empresa Sem Contrato LTDA",
          cnpj: "45723174000110",
          inscricaoEstadual: "456",
          enderecoCompleto: "Rua Teste, 20",
          telefone: "11988887777",
          email: "semcontrato@teste.com",
        }),
      /Contrato inicial obrigatório/i
    );

    assert.equal(
      ambiente.organizacao.listarOrganizacoesAtivas()
        .length,
      0
    );

    console.log(
      "[PASS] Organização sem contrato rejeitada."
    );
  } finally {
    limpar(ambiente);
  }
});

test("falha: contrato vencido é rejeitado sem persistir a organização", () => {
  const ambiente = criarAmbiente();

  try {
    const vencido = new Date();
    vencido.setDate(vencido.getDate() - 1);

    assert.throws(
      () =>
        ambiente.organizacao.cadastrarOrganizacao({
          razaoSocial: "Contrato Vencido LTDA",
          cnpj: "11222333000262",
          inscricaoEstadual: "999",
          enderecoCompleto: "Rua Teste, 50",
          telefone: "11955554444",
          email: "vencido@teste.com",
          contrato: {
            dataVencimento: vencido,
            valorMensal: 1500,
          },
        }),
      /vencimento.*futura/i
    );

    assert.equal(
      ambiente.organizacao.listarOrganizacoesAtivas()
        .length,
      0
    );

    console.log(
      "[PASS] Contrato vencido rejeitado sem persistência."
    );
  } finally {
    limpar(ambiente);
  }
});

test("falha: valor de contrato não numérico ou negativo é rejeitado", () => {
  for (const [cnpj, valor] of [
    ["11222333000343", "abc"],
    ["11222333000424", -100],
  ]) {
    const ambiente = criarAmbiente();

    try {
      assert.throws(
        () =>
          ambiente.organizacao.cadastrarOrganizacao({
            razaoSocial: "Contrato Inválido LTDA",
            cnpj,
            inscricaoEstadual: "111",
            enderecoCompleto: "Rua Teste, 60",
            telefone: "11944443333",
            email: "valor@teste.com",
            contrato: {
              dataVencimento: vencimentoFuturo(),
              valorMensal: valor,
            },
          }),
        /Valor mensal.*inválido/i
      );

      assert.equal(
        ambiente.organizacao.listarOrganizacoesAtivas()
          .length,
        0
      );
    } finally {
      limpar(ambiente);
    }
  }

  console.log(
    "[PASS] Valores inválidos de contrato rejeitados."
  );
});

test("busca de organização existente funciona e inexistente é rejeitada", () => {
  const ambiente = criarAmbiente();

  try {
    const org = criarOrganizacaoValida(ambiente);

    const encontrada =
      ambiente.organizacao.buscarOrganizacao(org.id);

    assert.equal(encontrada.id, org.id);
    assert.equal(
      encontrada.razaoSocial,
      "Empresa Válida LTDA"
    );

    assert.throws(
      () =>
        ambiente.organizacao.buscarOrganizacao(
          "BR999"
        ),
      /não encontrada|não encontrado/i
    );

    console.log(
      "[PASS] Busca de organização existente/inexistente verificada."
    );
  } finally {
    limpar(ambiente);
  }
});

test("falha: CLI buscar organização sem --id exibe mensagem de uso", () => {
  const cli = new CLIInterface();
  cli.sessaoAtual = new Sessao(
    "token",
    "operador",
    PapelUsuario.OPERADOR_CADASTRO
  );

  cli.organizacao = {
    buscarOrganizacao() {
      throw new Error(
        "O serviço não deveria ser chamado sem --id."
      );
    },
  };

  const saida = capturarConsole(() =>
    cli.processarComando("organizacao buscar")
  );

  assert.match(
    saida,
    /\[ERRO\].*Uso:.*organizacao buscar.*--id/i
  );

  console.log(
    "[PASS] Busca sem ID recebe mensagem de uso."
  );
});

test("renovação de contrato aceita data posterior e rejeita data anterior/igual", () => {
  const ambiente = criarAmbiente();

  try {
    const org = criarOrganizacaoValida(ambiente);
    const anterior =
      org.contratoVigente.dataVencimento.getTime();

    const nova = new Date(
      anterior + 365 * 24 * 60 * 60 * 1000
    );

    ambiente.organizacao.renovarContrato(
      org.id,
      nova
    );

    const recarregada =
      ambiente.organizacao.buscarOrganizacao(org.id);

    assert.equal(
      recarregada.contratoVigente.dataVencimento.getTime(),
      nova.getTime()
    );

    assert.throws(
      () =>
        ambiente.organizacao.renovarContrato(
          org.id,
          new Date(nova)
        ),
      /posterior ao vencimento atual/i
    );

    console.log(
      "[PASS] Renovação válida e inválida verificadas."
    );
  } finally {
    limpar(ambiente);
  }
});

test("falha: lote com organização inexistente é rejeitado", () => {
  const ambiente = criarAmbiente();

  try {
    assert.throws(
      () =>
        ambiente.lote.criarLote({
          organizacaoId: "BR999",
          notaFiscal: "NF",
          transportadora: "TransRapida",
          dataEntrada: new Date(),
        }),
      /Organização BR999 não encontrada/
    );

    console.log(
      "[PASS] Lote com organização inexistente rejeitado."
    );
  } finally {
    limpar(ambiente);
  }
});

test("falha: lote com data futura é rejeitado", () => {
  const ambiente = criarAmbiente();

  try {
    const org = criarOrganizacaoValida(ambiente);
    const amanha = new Date();
    amanha.setDate(amanha.getDate() + 1);

    assert.throws(
      () =>
        ambiente.lote.criarLote({
          organizacaoId: org.id,
          notaFiscal: "NF-FUTURA",
          transportadora: "TransRapida",
          dataEntrada: amanha,
        }),
      /Data de entrada não pode ser futura/
    );

    console.log("[PASS] Lote futuro rejeitado.");
  } finally {
    limpar(ambiente);
  }
});

test("falha: lote com mais de 90 dias é rejeitado", () => {
  const ambiente = criarAmbiente();

  try {
    const org = criarOrganizacaoValida(ambiente);
    const antiga = new Date();
    antiga.setDate(antiga.getDate() - 91);

    assert.throws(
      () =>
        ambiente.lote.criarLote({
          organizacaoId: org.id,
          notaFiscal: "NF-ANTIGA",
          transportadora: "TransRapida",
          dataEntrada: antiga,
        }),
      /mais de 90 dias no passado/
    );

    console.log(
      "[PASS] Lote com mais de 90 dias rejeitado."
    );
  } finally {
    limpar(ambiente);
  }
});

test("falha: lote vazio não entra em triagem", () => {
  const ambiente = criarAmbiente();

  try {
    const org = criarOrganizacaoValida(ambiente);
    const lote = ambiente.lote.criarLote({
      organizacaoId: org.id,
      notaFiscal: "NF-VAZIO",
      transportadora: "TransRapida",
      dataEntrada: new Date(),
    });

    assert.throws(
      () =>
        ambiente.lote.processarTriagem(lote.id),
      /Lote sem equipamentos/i
    );

    console.log(
      "[PASS] Triagem de lote vazio bloqueada."
    );
  } finally {
    limpar(ambiente);
  }
});

test("falha: equipamento com tipo inválido é rejeitado", () => {
  const ambiente = criarAmbiente();

  try {
    const org = criarOrganizacaoValida(ambiente);
    const lote = ambiente.lote.criarLote({
      organizacaoId: org.id,
      notaFiscal: "NF-TIPO",
      transportadora: "T",
      dataEntrada: new Date(),
    });

    const eq = new Equipamento(
      "",
      "INVALIDO",
      "Marca",
      "Modelo",
      2021,
      EstadoFisico.BOM_ESTADO,
      1
    );

    assert.throws(
      () =>
        ambiente.lote.adicionarEquipamentoLote(
          lote.id,
          eq
        ),
      /Tipo de equipamento inválido/
    );

    console.log(
      "[PASS] Tipo inválido de equipamento rejeitado."
    );
  } finally {
    limpar(ambiente);
  }
});

test("falha: equipamento com ano futuro é rejeitado", () => {
  const ambiente = criarAmbiente();

  try {
    const org = criarOrganizacaoValida(ambiente);
    const lote = ambiente.lote.criarLote({
      organizacaoId: org.id,
      notaFiscal: "NF-ANO",
      transportadora: "T",
      dataEntrada: new Date(),
    });

    const eq = new Equipamento(
      "",
      TipoEquipamento.NOTEBOOK,
      "Marca",
      "Modelo",
      new Date().getFullYear() + 1,
      EstadoFisico.BOM_ESTADO,
      1
    );

    assert.throws(
      () =>
        ambiente.lote.adicionarEquipamentoLote(
          lote.id,
          eq
        ),
      /Ano de fabricação inválido/
    );

    console.log(
      "[PASS] Ano futuro de equipamento rejeitado."
    );
  } finally {
    limpar(ambiente);
  }
});

test("falha: equipamento com peso zero/negativo é rejeitado", () => {
  for (const peso of [0, -1]) {
    const ambiente = criarAmbiente();

    try {
      const org = criarOrganizacaoValida(ambiente);
      const lote = ambiente.lote.criarLote({
        organizacaoId: org.id,
        notaFiscal: "NF-PESO",
        transportadora: "T",
        dataEntrada: new Date(),
      });

      const eq = new Equipamento(
        "",
        TipoEquipamento.NOTEBOOK,
        "Marca",
        "Modelo",
        2021,
        EstadoFisico.BOM_ESTADO,
        peso
      );

      assert.throws(
        () =>
          ambiente.lote.adicionarEquipamentoLote(
            lote.id,
            eq
          ),
        /Peso deve ser maior que zero/
      );
    } finally {
      limpar(ambiente);
    }
  }

  console.log(
    "[PASS] Peso inválido de equipamento rejeitado."
  );
});

test("falha: equipamento não pode ser adicionado ao lote após início da triagem", () => {
  const ambiente = criarAmbiente();

  try {
    const { lote } = criarLoteComEquipamento(
      ambiente
    );

    ambiente.lote.processarTriagem(lote.id);

    const novo = new Equipamento(
      "",
      TipoEquipamento.MONITOR,
      "LG",
      "Monitor",
      2022,
      EstadoFisico.BOM_ESTADO,
      4
    );

    assert.throws(
      () =>
        ambiente.lote.adicionarEquipamentoLote(
          lote.id,
          novo
        ),
      /status RECEBIDO/i
    );

    console.log(
      "[PASS] Inclusão após início da triagem bloqueada."
    );
  } finally {
    limpar(ambiente);
  }
});

test("falha: equipamento não pode seguir para desmonte antes da triagem completa", () => {
  const ambiente = criarAmbiente();

  try {
    const { eq } =
      criarLoteComEquipamento(ambiente);

    assert.throws(
      () =>
        ambiente.equipamento.movimentarEquipamento(
          eq.id,
          StatusRastreamento.AGUARDANDO_DESMONTE
        ),
      /após a conclusão da triagem/
    );

    console.log(
      "[PASS] Desmonte antes da triagem bloqueado."
    );
  } finally {
    limpar(ambiente);
  }
});

test("falha: queda de duas ou mais categorias exige justificativa textual", () => {
  const ambiente = criarAmbiente();

  try {
    const { eq } =
      criarLoteComEquipamento(ambiente);

    assert.throws(
      () =>
        ambiente.equipamento.atualizarEstadoFisico(
          eq.id,
          EstadoFisico.DANIFICADO_LEVE
        ),
      /Justificativa obrigatória/
    );

    ambiente.equipamento.atualizarEstadoFisico(
      eq.id,
      EstadoFisico.DANIFICADO_LEVE,
      "Dano identificado na triagem"
    );

    const recarregado =
      ambiente.equipamento.rastrearEquipamento(
        eq.id
      ).equipamento;

    assert.equal(
      recarregado.estadoFisico,
      EstadoFisico.DANIFICADO_LEVE
    );

    console.log(
      "[PASS] Justificativa obrigatória para queda física verificada."
    );
  } finally {
    limpar(ambiente);
  }
});

test("falha: atualizar para o mesmo estado físico é rejeitado", () => {
  const ambiente = criarAmbiente();

  try {
    const { eq } =
      criarLoteComEquipamento(ambiente);

    assert.throws(
      () =>
        ambiente.equipamento.atualizarEstadoFisico(
          eq.id,
          EstadoFisico.BOM_ESTADO
        ),
      /já está nesse estado/i
    );

    console.log(
      "[PASS] Estado físico duplicado rejeitado."
    );
  } finally {
    limpar(ambiente);
  }
});

test("falha: transição de status fora da máquina de estados é rejeitada", () => {
  const ambiente = criarAmbiente();

  try {
    const { lote, eq } =
      criarLoteComEquipamento(ambiente);

    ambiente.lote.processarTriagem(lote.id);
    ambiente.lote.processarTriagem(lote.id);

    assert.throws(
      () =>
        ambiente.equipamento.movimentarEquipamento(
          eq.id,
          StatusRastreamento.BAIXA_DEFINITIVA
        ),
      /Transição de status inválida/i
    );

    console.log(
      "[PASS] Transição inválida de status rejeitada."
    );
  } finally {
    limpar(ambiente);
  }
});

test("falha: descarte direto após triagem exige justificativa", () => {
  const ambiente = criarAmbiente();

  try {
    const { lote, eq } =
      criarLoteComEquipamento(ambiente);

    ambiente.lote.processarTriagem(lote.id);
    ambiente.lote.processarTriagem(lote.id);

    assert.throws(
      () =>
        ambiente.equipamento.movimentarEquipamento(
          eq.id,
          StatusRastreamento.DESCARTE_SEGURO
        ),
      /exige justificativa/i
    );

    console.log(
      "[PASS] Descarte direto sem justificativa rejeitado."
    );
  } finally {
    limpar(ambiente);
  }
});

test("falha: período de consulta de lote com início após fim é rejeitado", () => {
  const ambiente = criarAmbiente();

  try {
    const inicio = new Date();
    const fim = new Date();
    inicio.setDate(inicio.getDate() + 1);

    assert.throws(
      () =>
        ambiente.lote.consultarLotePorPeriodo(
          inicio,
          fim
        ),
      /início posterior ao fim/i
    );

    console.log(
      "[PASS] Período inválido de lotes rejeitado."
    );
  } finally {
    limpar(ambiente);
  }
});

test("falha: auditor não pode executar comandos de alteração", () => {
  const cli = new CLIInterface();
  cli.sessaoAtual = new Sessao(
    "token-auditor",
    "auditor",
    PapelUsuario.AUDITOR
  );

  for (const comando of [
    "usuario listar",
    "organizacao listar",
    "lote criar --org BR001 --nf 1 --transp T",
    "equipamento estado --id EQ000001 --estado NOVO",
  ]) {
    const saida = capturarConsole(() =>
      cli.processarComando(comando)
    );

    assert.match(saida, /\[ERRO\].*Ação restrita/i);
  }

  console.log(
    "[PASS] Auditor permanece somente leitura."
  );
});

test("falha: operador, gestor e auditor não recebem comandos administrativos", () => {
  const cli = new CLIInterface();

  for (const papel of [
    PapelUsuario.OPERADOR_CADASTRO,
    PapelUsuario.GESTOR_ALMOXARIFADO,
    PapelUsuario.AUDITOR,
  ]) {
    cli.sessaoAtual = new Sessao(
      "token",
      "usuario",
      papel
    );

    const saida = capturarConsole(() =>
      cli.processarComando("config aliquota --valor 0.17")
    );

    assert.match(saida, /\[ERRO\].*Ação restrita/i);
  }

  console.log(
    "[PASS] Configuração administrativa protegida por papel."
  );
});

test("falha: comando desconhecido retorna feedback de erro categorizado", () => {
  const cli = new CLIInterface();
  cli.sessaoAtual = new Sessao(
    "token",
    "auditor",
    PapelUsuario.AUDITOR
  );

  const saida = capturarConsole(() =>
    cli.processarComando(
      "comando totalmente-inexistente"
    )
  );

  assert.match(
    saida,
    /\[ERRO\].*Comando não reconhecido/i
  );

  console.log(
    "[PASS] Comando desconhecido categorizado como ERRO."
  );
});

test("falha: arquivo persistido adulterado é detectado", () => {
  const ambiente = criarAmbiente();

  try {
    ambiente.repositorio.salvarEntidade(
      "teste.dat",
      [{ id: "1", nome: "teste" }]
    );

    const arquivo = path.join(
      ambiente.diretorio,
      "teste.dat"
    );

    const original = fs.readFileSync(
      arquivo,
      "utf8"
    );

    const adulterado =
      original.slice(0, -1) +
      (original.endsWith("0") ? "1" : "0");

    fs.writeFileSync(
      arquivo,
      adulterado,
      "utf8"
    );

    assert.throws(
      () =>
        ambiente.repositorio.listarEntidades(
          "teste.dat"
        ),
      /corrompido ou adulterado/
    );

    console.log(
      "[PASS] Arquivo adulterado detectado."
    );
  } finally {
    limpar(ambiente);
  }
});

test("persistência atômica usa arquivo temporário, fsync e rename", () => {
  const fonte = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "src",
      "persistencia",
      "RepositorioArquivo.ts"
    ),
    "utf8"
  );

  assert.match(fonte, /\.tmp/);
  assert.match(fonte, /fsyncSync/);
  assert.match(fonte, /renameSync/);

  console.log(
    "[PASS] Estratégia de escrita atômica presente."
  );
});

test("falha de rename remove arquivo temporário e não deixa estado parcial", () => {
  const ambiente = criarAmbiente(
    "greencode-atomico-"
  );

  const fsNativo = require("node:fs");
  const renameOriginal = fsNativo.renameSync;

  try {
    fsNativo.renameSync = () => {
      throw new Error("FALHA_RENAME_TESTE");
    };

    assert.throws(
      () =>
        ambiente.repositorio.salvarEntidade(
          "atomico.dat",
          [{ id: "1" }]
        ),
      /FALHA_RENAME_TESTE/
    );

    const arquivos = fs.readdirSync(
      ambiente.diretorio
    );

    assert.equal(
      arquivos.some((nome) =>
        nome.endsWith(".tmp")
      ),
      false
    );

    assert.equal(
      fs.existsSync(
        path.join(
          ambiente.diretorio,
          "atomico.dat"
        )
      ),
      false
    );

    console.log(
      "[PASS] Falha de escrita não deixou arquivo temporário/parcial."
    );
  } finally {
    fsNativo.renameSync = renameOriginal;
    limpar(ambiente);
  }
});

test("journal: alteração de configuração global também deve gerar transação auditável", () => {
  const ambiente = criarAmbiente(
    "greencode-journal-config-"
  );

  try {
    const cli = new CLIInterface();
    cli.sessaoAtual = new Sessao(
      "token-admin",
      "admin",
      PapelUsuario.ADMINISTRADOR
    );
    cli.repositorio = ambiente.repositorio;

    capturarConsole(() =>
      cli.processarComando(
        "config aliquota --valor 0.17"
      )
    );

    const entradas =
      JournalTransacao.listarTodos();

    assert.ok(
      entradas.some((entrada) => {
        const operacao = String(
          entrada.operacao ?? ""
        ).toUpperCase();
        const entidade = String(
          entrada.entidade ?? ""
        ).toUpperCase();

        return (
          operacao.includes("CONFIG") ||
          operacao.includes("ALIQUOTA") ||
          entidade.includes("CONFIG")
        );
      }),
      "Alterações de configuração global também são transações e devem aparecer no journal."
    );

    console.log(
      "[PASS] Alteração de configuração global registrada no journal."
    );
  } finally {
    limpar(ambiente);
  }
});

test("journal é cifrado e append-only para operações sucessivas", () => {
  const ambiente = criarAmbiente(
    "greencode-journal-cifrado-"
  );

  try {
    new JournalTransacao(
      "OPERACAO_1",
      "Teste",
      null,
      { id: "1" }
    ).registrar();

    const arquivo = path.join(
      ambiente.diretorio,
      "journal.log"
    );

    const primeiro = fs.readFileSync(
      arquivo,
      "utf8"
    );

    assert.doesNotMatch(
      primeiro,
      /OPERACAO_1|"entidade"/
    );

    new JournalTransacao(
      "OPERACAO_2",
      "Teste",
      null,
      { id: "2" }
    ).registrar();

    const segundo = fs.readFileSync(
      arquivo,
      "utf8"
    );

    assert.ok(segundo.startsWith(primeiro));
    assert.ok(segundo.length > primeiro.length);

    const entradas =
      JournalTransacao.listarTodos();

    assert.equal(entradas.length, 2);
    assert.equal(
      entradas[0].operacao,
      "OPERACAO_1"
    );
    assert.equal(
      entradas[1].operacao,
      "OPERACAO_2"
    );

    console.log(
      "[PASS] Journal cifrado e append-only verificado."
    );
  } finally {
    limpar(ambiente);
  }
});

test("journal: retenção remove log rotacionado com mais de 180 dias", () => {
  const ambiente = criarAmbiente(
    "greencode-retencao-"
  );

  try {
    const antigo = path.join(
      ambiente.diretorio,
      "journal-2000-01-01T00-00-00-000Z.log"
    );

    fs.writeFileSync(antigo, "teste", "utf8");

    const dataAntiga = new Date(
      Date.now() - 181 * 24 * 60 * 60 * 1000
    );

    fs.utimesSync(
      antigo,
      dataAntiga,
      dataAntiga
    );

    JournalTransacao.configurar({
      diretorio: ambiente.diretorio,
      criptografia: ambiente.criptografia,
      chave: ambiente.chave,
      repositorio: ambiente.repositorio,
    });

    assert.equal(fs.existsSync(antigo), false);

    console.log(
      "[PASS] Journal >180 dias removido."
    );
  } finally {
    limpar(ambiente);
  }
});

test("journal: arquivo com menos de 180 dias é preservado", () => {
  const ambiente = criarAmbiente(
    "greencode-retencao-novo-"
  );

  try {
    const novo = path.join(
      ambiente.diretorio,
      "journal-2026-01-01T00-00-00-000Z.log"
    );

    fs.writeFileSync(novo, "teste", "utf8");

    const dataNova = new Date(
      Date.now() - 179 * 24 * 60 * 60 * 1000
    );

    fs.utimesSync(novo, dataNova, dataNova);

    JournalTransacao.configurar({
      diretorio: ambiente.diretorio,
      criptografia: ambiente.criptografia,
      chave: ambiente.chave,
      repositorio: ambiente.repositorio,
    });

    assert.equal(fs.existsSync(novo), true);

    console.log(
      "[PASS] Journal dentro da retenção preservado."
    );
  } finally {
    limpar(ambiente);
  }
});

test("journal: arquivo é rotacionado ao ultrapassar 10 MB", () => {
  const ambiente = criarAmbiente(
    "greencode-rotacao-"
  );

  try {
    const journal = path.join(
      ambiente.diretorio,
      "journal.log"
    );

    fs.writeFileSync(
      journal,
      Buffer.alloc(10 * 1024 * 1024 - 8)
    );

    new JournalTransacao(
      "TESTE_ROTACAO",
      "Teste",
      null,
      { id: "1" }
    ).registrar();

    const rotacionados = fs
      .readdirSync(ambiente.diretorio)
      .filter((nome) =>
        /^journal-.*\.log$/.test(nome)
      );

    assert.ok(rotacionados.length >= 1);
    assert.equal(fs.existsSync(journal), true);

    console.log(
      "[PASS] Journal rotacionado acima de 10 MB."
    );
  } finally {
    limpar(ambiente);
  }
});

test("journal: transação é registrada antes da tentativa de aplicar o novo estado", () => {
  const ambiente = criarAmbiente(
    "greencode-journal-ordem-"
  );

  try {
    const salvarOriginal =
      ambiente.repositorio.salvarEntidade.bind(
        ambiente.repositorio
      );

    ambiente.repositorio.salvarEntidade = () => {
      throw new Error(
        "FALHA_FORCADA_NA_PERSISTENCIA"
      );
    };

    assert.throws(
      () =>
        ambiente.organizacao.cadastrarOrganizacao({
          razaoSocial: "Empresa Journal LTDA",
          cnpj: "11222333000181",
          inscricaoEstadual: "123",
          enderecoCompleto: "Rua Journal, 1",
          telefone: "11999999999",
          email: "journal@teste.com",
          contrato: {
            dataVencimento: vencimentoFuturo(),
            valorMensal: 1000,
          },
        }),
      /FALHA_FORCADA_NA_PERSISTENCIA/
    );

    ambiente.repositorio.salvarEntidade =
      salvarOriginal;

    const entradas =
      JournalTransacao.listarTodos();

    assert.ok(
      entradas.some(
        (entrada) =>
          entrada.operacao === "CADASTRAR" &&
          entrada.entidade === "Organizacao"
      )
    );

    assert.equal(
      ambiente.repositorio.listarEntidades(
        "organizacoes.dat"
      ).length,
      0
    );

    console.log(
      "[PASS] Journal gravado antes da aplicação do estado."
    );
  } finally {
    limpar(ambiente);
  }
});
}
