# GreenCode API (AV2)

API REST em **Node.js + TypeScript + Fastify + Prisma + PostgreSQL** para a logística reversa de equipamentos
eletrônicos. Evolução do CLI da AV1: as regras de negócio foram mantidas; mudaram a interface (HTTP), a
persistência (banco relacional), a autenticação (JWT) e a concorrência (transações e versionamento otimista).

| Documento | Conteúdo |
|---|---|
| [`docs/EXECUCAO_E_TESTES.md`](docs/EXECUCAO_E_TESTES.md) | Como executar, jornada completa passo a passo e como rodar os testes |
| [`DOCUMENTACAO_FINAL.md`](DOCUMENTACAO_FINAL.md) | Arquitetura, modelo de dados, regras, auditoria, decisões e limites do monólito |
| [`MATRIZ_AV2.md`](MATRIZ_AV2.md) | Requisito a requisito: onde está implementado e qual teste comprova |
| [`docs/requisicoes.http`](docs/requisicoes.http) | Jornada pronta para o VS Code (extensão REST Client) |

## Requisitos

- **Node.js 20 ou superior** (testado com 22) e npm
- **PostgreSQL 14 ou superior** (testado com 16)
- Windows 10+ ou Ubuntu 24.04+ (e derivados). Nenhum script depende de shell específico.

## Instalação e execução

```bash
# 1) dependências
npm install

# 2) banco: no psql (ou pgAdmin), como superusuário
#    CREATE USER greencode WITH PASSWORD 'sua-senha' CREATEDB;
#    CREATE DATABASE greencode OWNER greencode;
#    CREATE DATABASE greencode_test OWNER greencode;

# 3) configuração: copie .env.example para .env e ajuste senha do banco e JWT_SECRET
#    Windows (PowerShell): Copy-Item .env.example .env      Linux: cp .env.example .env
#    JWT_SECRET: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 4) tabelas, triggers e dados de demonstração
npm run generate
npm run migrate:deploy
npm run seed

# 5) subir a API (porta do .env; padrão 3000)
npm run dev          # desenvolvimento (recarrega ao salvar; roda o seed antes)
# ou
npm run build && npm start   # produção
```

Abra **http://localhost:3000/docs** (Swagger UI) ou teste **http://localhost:3000/health**.

### Usuários de demonstração (criados pelo seed)

| Login | Senha | Papel |
|---|---|---|
| `admin` | `Admin@12345` | ADMINISTRADOR |
| `operador` | `Operador123` | OPERADOR_CADASTRO |
| `gestor` | `Gestor123` | GESTOR_ALMOXARIFADO |
| `auditor` | `Auditor123` | AUDITOR |

> Senhas de demonstração: troque-as fora do ambiente de desenvolvimento.

### Primeira chamada

```bash
curl -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" \
     -d '{"login":"gestor","senha":"Gestor123"}'
# => { "token": "...", "expiraEm": "..." }   use: Authorization: Bearer <token>
```
No Swagger UI: `POST /auth/login` > copie o token > botão **Authorize**.

## Testes

```bash
npm run test:unit       # regras puras (CNPJ, estados, períodos)
npm test                # suíte completa de integração (zera e recria o banco de TESTE)
npm run test:jornada    # somente a jornada completa
```
Detalhes, saída esperada e solução de problemas em [`docs/EXECUCAO_E_TESTES.md`](docs/EXECUCAO_E_TESTES.md).

## Estrutura

```
src/
  server.ts            ponto de entrada: porta por ambiente, shutdown gracioso, job do journal
  app.ts               Fastify: JWT, Swagger, hook global de autenticação, erros, log de rejeições
  controllers/         camada HTTP: rotas, JSON Schema, delegação aos serviços
  services/            regras de negócio e transações ($transaction)
  repositories/        único lugar que fala com o Prisma (consultas, versionamento otimista, journal)
  utils/               CNPJ, máquina de estados, períodos, erros HTTP, contexto da requisição
  jobs/                rotação e retenção do journal
prisma/
  schema.prisma        modelos e relações
  migrations/          SQL versionado: tabelas, CHECKs, triggers, sequences, função do journal
  seed.ts              dados de demonstração idempotentes
tests/                 unitários e de integração (API + banco real)
docs/                  execução, testes e requisições de exemplo
```

## Scripts npm

| Script | O que faz |
|---|---|
| `dev` / `start` / `build` | executar em desenvolvimento / produção / compilar |
| `generate` / `migrate` / `migrate:deploy` / `seed` / `studio` / `validate` | utilitários do Prisma |
| `test` / `test:jornada` / `test:unit` | testes |
| `auditoria:manutencao` | executa agora a rotação (>10 MB) e a retenção (180 dias) do journal |

## Solução de problemas

- **`prisma generate` ou `npm install` demoram:** o Prisma baixa componentes na primeira vez; aguarde.
  Instale **sem** `@latest`: este projeto fixa versões estáveis (`prisma` 7.x). Um `npm install -D prisma` sem versão pode instalar uma versão candidata (8.x) incompatível.
- **`JWT_SECRET ausente ou insegura`:** gere uma chave de pelo menos 32 caracteres no `.env`.
- **`TEST_DATABASE_URL`:** o banco de testes precisa ter "test" no nome; o script nunca usa o banco de desenvolvimento.
- **Porta em uso:** altere `PORT` no `.env`.
