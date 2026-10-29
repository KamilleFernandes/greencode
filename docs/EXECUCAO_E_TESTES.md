# Execução, jornada completa e testes

## 1. Executar o sistema (passo a passo)

1. **Pré-requisitos:** Node.js 20+, PostgreSQL 14+ rodando, `git`.
2. **Dependências:** `npm install`.
3. **Banco** (como superusuário no `psql`):
   ```sql
   CREATE USER greencode WITH PASSWORD 'sua-senha' CREATEDB;
   CREATE DATABASE greencode OWNER greencode;
   CREATE DATABASE greencode_test OWNER greencode;
   ```
   No `psql`, os prompts *Server / Database / Port / Username* aceitam **Enter** (valores padrão); só a senha é digitada.
4. **Ambiente:** copie `.env.example` para `.env` e ajuste `DATABASE_URL`, `TEST_DATABASE_URL` e `JWT_SECRET`.
5. **Banco pronto:** `npm run generate`, depois `npm run migrate:deploy` (cria tabelas, triggers e sequences) e `npm run seed`.
6. **Conferir o schema (opcional):** `npx prisma migrate dev` deve responder que o banco está em sincronia.
7. **Subir:** `npm run dev` (ou `npm run build && npm start`). O log informa a porta e o endereço do Swagger.
8. **Verificar:** `http://localhost:3000/health` retorna `{"status":"ok","database":"ok"}`.
9. **Encerrar:** `Ctrl+C`. O servidor para de aceitar conexões, conclui as requisições em andamento, fecha o banco e sai com código 0.

## 2. A jornada completa via HTTP

Use o Swagger UI (`/docs`), o arquivo `docs/requisicoes.http` (VS Code + REST Client), Postman ou `curl`.
Cada passo indica quem executa e o resultado esperado.

| # | Quem | Requisição | Resultado esperado |
|---|---|---|---|
| 1 | todos | `POST /auth/login` `{login, senha}` | `200` com `token` (válido por 30 min). Senha errada: `401` |
| 2 | admin | `POST /usuarios` | `201`. Login repetido: `409`; senha fraca ou papel inválido: `400` |
| 3 | admin | `GET/PUT /configuracao` | alíquota e depreciação entre 0 e 1; versão errada: `409` |
| 4 | operador | `POST /organizacoes` (com `contrato`) | `201`, código `BR001`, `BR002`...; CNPJ inválido: `400`; CNPJ repetido: `409` |
| 5 | operador | `PATCH /organizacoes/{id}/contrato` | renova o vencimento (deve ser posterior ao atual) |
| 6 | gestor | `POST /lotes` (opcional: `equipamentos[]`) | `201`, código `LT00001`; tudo na mesma transação. Data futura ou > 90 dias: `400` |
| 7 | gestor | `POST /lotes/{id}/equipamentos` | `201` (só em lote `RECEBIDO`); fora disso `409` |
| 8 | gestor | `PATCH /equipamentos/{id}/movimentacoes` antes da triagem | `409` (desmonte só após a triagem completa) |
| 9 | gestor | `POST /lotes/{id}/triagem` (1ª chamada) | lote `EM_TRIAGEM`; códigos de barras gerados |
| 10 | gestor | `POST /lotes/{id}/triagem` (2ª chamada, com a `versao` nova) | lote `TRIAGEM_CONCLUIDA` |
| 11 | gestor | `PATCH /equipamentos/{id}/estado-fisico` | queda de 2+ categorias sem `justificativa`: `400` |
| 12 | gestor | `PATCH /equipamentos/{id}/movimentacoes` (`AGUARDANDO_DESMONTE` → `EM_DESMONTE` → `MATERIAL_RECICLAVEL` → `BAIXA_DEFINITIVA`) | `200`; o lote vira `ENCAMINHADO` na 1ª saída e `FINALIZADO` quando todos têm baixa |
| 13 | auditor/gestor | `GET /equipamentos/{id ou código de barras}/rastreamento` | todas as movimentações, em ordem |
| 14 | auditor | `GET /relatorios/organizacao`, `/status`, `/financeiro` | relatórios com período inclusivo |
| 15 | auditor/admin | `GET /auditoria?entidadeId=...` | journal: quem, quando, operação, dados antes e depois |

Todo `PATCH`/`PUT` exige a `versao` lida na consulta anterior. Se outra pessoa alterou o registro antes, a resposta é `409` (conflito de versão): recarregue e tente de novo.

## 3. Executar os testes

### Preparação
`.env` com `TEST_DATABASE_URL` apontando para o banco **greencode_test** (o nome deve conter "test").

### Comandos

| Comando | O que faz |
|---|---|
| `npm run test:unit` | Testes unitários das regras puras (CNPJ, máquina de estados, estado físico, períodos). Não usam banco |
| `npm test` | Suíte completa: (1) gera o Prisma Client e compila, (2) **zera** o banco de teste com `prisma migrate reset`, (3) roda o seed, (4) executa todos os testes de integração |
| `npm run test:jornada` | Mesmo preparo, executando apenas a **jornada completa** |

O script se recusa a rodar se o banco configurado não tiver "test" no nome, de modo que os dados de desenvolvimento nunca são tocados.

### Conteúdo da suíte

| Arquivo | Cobertura |
|---|---|
| `tests/unit.test.ts` | CNPJ, ano/peso, transições de status, estado físico, períodos |
| `tests/api.test.mjs` | Saúde e OpenAPI públicos, JWT obrigatório (401) e papéis (403), CNPJ inválido, jornada de ponta a ponta |
| `tests/validacoes.test.mjs` | Casos de falha da AV1 via HTTP: organização, contrato, lote, equipamento, usuários, configuração, senha, renovação de token, OpenAPI |
| `tests/regras.test.mjs` | Regras de negócio, permissões, rollback transacional, concorrência (movimentações simultâneas, 5 inclusões no mesmo lote, 10 lotes simultâneos), expiração do JWT, usuário desativado |
| `tests/auditoria.test.mjs` | Formato do journal, ausência de segredos, log das requisições rejeitadas, imutabilidade, retenção de 180 dias, rotação por tamanho, triggers de integridade |
| `tests/jornada-completa.test.mjs` | Jornada completa: usuários, organização, lote com equipamentos, triagem, movimentações, rastreabilidade, relatórios e auditoria |
| `tests/servidor.test.mjs` | Processo real: porta por ambiente, encerramento gracioso por SIGTERM (ignorado no Windows, que não entrega SIGTERM), `PORT` inválida |

### Saída esperada da jornada completa (`npm run test:jornada`)

```
[PASS] Usuários criados e autenticados por papel.
[PASS] Segregação de papéis verificada (administrador, gestor e auditor bloqueados onde devem).
[PASS] Organização: BR104
[PASS] Lote: LT00140 com 3 equipamentos.
[PASS] Desmonte antes da triagem completa bloqueado.
[PASS] Triagem concluída; códigos de barras únicos: NOT-000176, MON-000177, SER-000178
[PASS] Lote ENCAMINHADO após a primeira saída da triagem.
[PASS] Justificativas obrigatórias (queda de estado e descarte direto) verificadas.
[PASS] Lote FINALIZADO quando todos os equipamentos têm baixa definitiva.
[PASS] Rastreabilidade: 6 movimentações.
[PASS] Relatórios de organização, status e financeiro verificados.
[PASS] Journal: 5 entradas do lote; 4 mudanças de status do equipamento com antes/depois.
[PASS] Jornada completa executada.
✔ jornada completa: usuários -> organização -> lote -> triagem -> movimentações -> rastreabilidade -> relatórios -> auditoria
ℹ tests 1  ℹ pass 1  ℹ fail 0
```
Os códigos (`BR104`, `LT00140`...) variam conforme o estado do banco.

### Resultado de referência da suíte completa
`# tests 38  # pass 38  # fail 0` (integração) e `# tests 5  # pass 5` (unitários), executados em fusos `America/Sao_Paulo` e `UTC`.

## 4. Auditoria: consultar e manter o journal

- **Consultar:** `GET /auditoria?entidade=Lote&entidadeId=<uuid>&operacao=INICIAR_TRIAGEM&usuario=gestor&inicio=2026-10-01&fim=2026-10-31&limite=100`
  (papéis `AUDITOR` e `ADMINISTRADOR`). Entradas rotacionadas aparecem com `"arquivado": true`.
- **Manutenção manual:** `npm run auditoria:manutencao` ou `POST /auditoria/manutencao` (administrador).
  Roda sozinha na partida do servidor e a cada 6 horas.
- **Prova de imutabilidade:** no `psql`, `UPDATE auditorias SET operacao='x';` é recusado pelo trigger.

## 5. Problemas comuns

| Sintoma | Causa e solução |
|---|---|
| `npm install` ou `prisma generate` lento | Download inicial de componentes do Prisma; aguarde. Não use `npm install -D prisma` sem versão |
| `Bloqueado por segurança: o banco ... não parece ser de testes` | Ajuste `TEST_DATABASE_URL` para um banco com "test" no nome |
| `P1001 Can't reach database` | PostgreSQL parado, porta ou senha errada em `DATABASE_URL` |
| `401` em tudo | Token ausente ou expirado (30 min): faça login de novo ou use `POST /auth/renovar` |
| `409` ao editar | Conflito de versão: consulte o registro de novo e reenvie com a `versao` atual |
