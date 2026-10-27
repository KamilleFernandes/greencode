# Matriz de conformidade — AV2

A atividade recomenda um monólito HTTP em camadas, Fastify, Prisma/PostgreSQL, JWT, transações, versionamento otimista, seed, migrações e compatibilidade Windows/Linux. Esta matriz separa o que está preparado no pacote do que ainda precisa ser verificado em execução.

| Requisito | Onde está implementado | Estado/verificação necessária |
|---|---|---|
| API HTTP configurável e graceful shutdown | `src/server.ts`, `src/app.ts`, `PORT` no `.env` | Verificar `npm run dev`, `/health`, mudança de porta e Ctrl+C no PC |
| Fastify, JSON Schema, Swagger | controllers e `/docs` | A validação sintática foi feita; confirmar geração do Swagger após instalar |
| PostgreSQL e Prisma Client/adapter | `prisma/schema.prisma`, `prisma.config.ts`, `src/plugins/prisma.ts` | Requer `npm install`, `prisma generate` e migração local |
| Oito modelos e relações | `prisma/schema.prisma` | Revisar schema/SQL com `npx prisma validate` e `migrate deploy` |
| CNPJ único e válido | `src/utils/cnpj.ts`, constraint unique | Há teste unitário preparado; executar localmente |
| Contrato obrigatório no cadastro, vencimento futuro/renovação | `src/services/organizacao.service.ts` | Exercitar criação e renovação pelo Swagger |
| Data de lote entre hoje e 90 dias atrás | `src/utils/estados.ts`, serviço de lotes | Exercitar datas nos limites |
| Lote com equipamentos e triagem em 2 etapas | `src/services/logistica.service.ts` | Jornada de API preparada em `tests/api.test.mjs` |
| Máquina de estados e baixa definitiva | `src/utils/estados.ts`, `logistica.service.ts` | Jornada de API preparada; testar todas as transições inválidas adicionais |
| Justificativa para queda de estado físico | `atualizarEstadoFisico` | Recomendado acrescentar um teste de integração específico antes da entrega |
| JWT 30 minutos e RBAC | `auth.controller.ts`, `app.ts`, `auth.service.ts` | Testes de 401/403 preparados; expiração real requer executar localmente |
| Migração SHA-256 → bcrypt no login | `src/services/auth.service.ts` | Código preparado; requer teste com credencial AV1 real/simulada |
| Auditoria e movimentação transacionais | serviços com `$transaction`, `auditoria.repository.ts` | A jornada pode ser testada; adicionar teste explícito de rollback |
| Concorrência otimista e 409 | campos `versao`, `updateMany` condicional | Há cenário de versão obsoleta na jornada; ideal testar duas requisições realmente simultâneas |
| IDs/códigos sem `MAX+1` | sequences criadas na migração, `src/utils/codigos.ts` | Confirmar em PostgreSQL com chamadas concorrentes |
| Seed idempotente, 4 papéis, estados variados | `prisma/seed.ts` | Executar duas vezes e verificar que não duplica |
| Relatórios com período inclusivo | `src/services/relatorio.service.ts` | Validar começo/fim do mesmo dia e período invertido |
| Testes automatizados da API | `tests/api.test.mjs`, `tests/unit.test.ts`, `scripts/test.cjs` | A sessão não conseguiu instalar as dependências; `npm test` ainda não foi executado |
| 74 testes CLI convertidos para HTTP | testes originais preservados em `legacy-cli/testes/` | **Pendente**: a suíte API atual não é conversão 1:1 dos 74 testes |
| Windows + Ubuntu | scripts Node/npm e documentação | Requer rodar a instalação completa nos dois sistemas; não há evidência de execução Linux nesta sessão |
| Decisões arquiteturais documentadas | `DOCUMENTACAO_FINAL.md` | Preparado para revisão final |
