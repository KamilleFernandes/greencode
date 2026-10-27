# GreenCode AV2 — API REST

Evolução do GreenCode CLI (AV1) para uma API HTTP em Node.js + TypeScript, Fastify, Prisma ORM 7 e PostgreSQL. A pasta `legacy-cli/` mantém a AV1 original para referência; o código novo está em `src/`.

> **Estado de validação deste pacote:** os arquivos foram montados e tiveram validação sintática TypeScript, JSON e estrutura SQL. Não foi possível executar `npm install`, gerar o Prisma Client nem testar consultas reais nesta sessão porque o acesso ao registry do npm falhou com `EAI_AGAIN`. Portanto, não trate o build ou a conexão com o banco como já validados. Execute a verificação local abaixo antes de entregar.

## 1. Requisitos

- Node.js 22 LTS recomendado (mínimo 20) e npm.
- PostgreSQL 15 ou superior recomendado.
- Windows 10+ ou Ubuntu 24.04+ / derivados.
- Conexão com `https://registry.npmjs.org` durante a instalação das dependências.

## 2. Instalação — Windows PowerShell

Abra o PowerShell na pasta `greencode-av2` extraída:

```powershell
node -v
npm -v
Copy-Item .env.example .env
notepad .env
npm install --no-audit --no-fund
```

Edite `.env` e coloque a senha real do usuário `greencode` do PostgreSQL. Gere o JWT secret depois de instalar dependências ou use o Node nativo:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Copie a saída para `JWT_SECRET` em `.env`. Não versione o arquivo `.env`.

Se o PostgreSQL ainda não estiver criado, abra **SQL Shell (psql)** no menu Iniciar, aperte Enter para `Server`, `Database`, `Port` e `Username` aceitarem os padrões; informe a senha do usuário `postgres` somente quando o programa pedir senha. No prompt `postgres=#`, execute um por vez:

```sql
CREATE USER greencode WITH PASSWORD 'troque-esta-senha';
ALTER USER greencode CREATEDB;
CREATE DATABASE greencode OWNER greencode;
CREATE DATABASE greencode_test OWNER greencode;
\l
\q
```

Substitua a senha pelo mesmo valor no `.env`. Se o usuário/bancos já existem, não rode `CREATE` novamente; entre no `psql` e confira com `\l`.

## 3. Instalação — Ubuntu 24.04+

```bash
sudo apt update
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable --now postgresql
sudo -u postgres psql
```

No `psql`, use os mesmos comandos SQL da seção anterior. Depois, na pasta do projeto:

```bash
cp .env.example .env
nano .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
npm install --no-audit --no-fund
```

## 4. Banco, migração e seed

1. Verifique se `DATABASE_URL` aponta para o banco de desenvolvimento `greencode`.
2. Aplique as migrações versionadas e gere o Prisma Client:

```bash
npm run migrate:deploy
npm run generate
```

3. Carregue a massa de dados de demonstração:

```bash
npm run seed
```

O seed é idempotente: cria apenas os registros que não existem, mantendo os já existentes. `npm run predev` também executa o seed antes do modo de desenvolvimento.

## 5. Executar e usar

```bash
npm run dev
```

Abra:

- `http://localhost:3000/health` — saúde da API e do banco.
- `http://localhost:3000/docs` — Swagger UI / OpenAPI.

Faça `POST /auth/login` com JSON como:

```json
{"login":"admin","senha":"Admin@12345"}
```

Copie o campo `token`; clique em **Authorize** no Swagger e informe o token Bearer (sem aspas). Depois execute as rotas permitidas para o papel do usuário.

### Usuários de demonstração

| Login | Senha inicial | Papel |
|---|---|---|
| `admin` | `Admin@12345` | `ADMINISTRADOR` |
| `operador` | `Operador123` | `OPERADOR_CADASTRO` |
| `gestor` | `Gestor123` | `GESTOR_ALMOXARIFADO` |
| `auditor` | `Auditor123` | `AUDITOR` |

**Troque as senhas de demonstração antes de qualquer uso real.** Essas credenciais são apenas para o ambiente local de avaliação.

## 6. Testes

Testes unitários de validadores (requer dependências e Prisma Client gerado):

```bash
npm run test:unit
```

Testes de integração da API:

```bash
npm test
```

O script exige `TEST_DATABASE_URL` explícita e bloqueia nomes de banco que não contenham `test`. Ele executa `prisma migrate reset --force --skip-seed` **somente no banco apontado por `TEST_DATABASE_URL`**, aplica o seed, gera/builda o cliente e executa os testes de API. Confirme que a URL termina em banco separado, por exemplo `greencode_test`, antes de executar. Nunca aponte `TEST_DATABASE_URL` para o banco de desenvolvimento.

## 7. Se `npm install` ficar parado

O pacote precisa ser baixado do registry npm. Se não houver progresso por alguns minutos, abra outro PowerShell e rode:

```powershell
npm ping
npm config get registry
npm cache verify
```

O registry esperado é `https://registry.npmjs.org/`. Se aparecer `EAI_AGAIN`, é falha temporária de resolução DNS/rede, não prova de erro no projeto nem do PostgreSQL. Verifique a conexão/proxy/DNS e tente novamente; não crie binários falsos nem use `--ignore-scripts` para fingir que o Prisma ficou pronto. Como este pacote não inclui um lockfile gerado por instalação, o primeiro `npm install` deverá criá-lo após resolver as versões no registry. Quando a rede responder, execute `npm install --no-audit --no-fund` novamente.

## 8. O que está organizado

- `src/controllers/`: rotas HTTP, JSON Schema e permissões.
- `src/services/`: regras de negócio e coordenação de operações.
- `src/repositories/`: auditoria e acesso auxiliar aos dados.
- `src/plugins/prisma.ts`: Prisma Client com `PrismaPg`.
- `prisma/schema.prisma`: oito modelos, enums e relações.
- `prisma/migrations/`: migração SQL inicial e constraints.
- `prisma/seed.ts`: usuários, organizações, contratos, lotes, equipamentos e histórico de exemplo.
- `tests/`: testes unitários e uma jornada HTTP integrada.
- `legacy-cli/`: cópia do projeto AV1 e dos testes originais preservada como referência.

## 9. Limites que devem ser confirmados na validação local

- O ambiente desta sessão não conseguiu instalar dependências; portanto, o build TypeScript e a migração contra PostgreSQL ainda precisam ser confirmados localmente.
- Os testes em `legacy-cli/testes/` são os testes da AV1 e foram preservados, não são testes da API. A suíte nova de integração cobre a jornada principal e alguns casos críticos, mas **não é uma conversão individual de todos os 74 testes da AV1**.
- O relatório financeiro reflete o escopo da AV1: calcula depreciação média e alíquota, porque o domínio anterior não registra custo monetário por equipamento.
- O endpoint de logout registra auditoria e orienta descartar o token no cliente; JWT stateless continua válido até expirar. A revogação imediata exigiria blacklist ou versão de sessão consultada a cada requisição.
