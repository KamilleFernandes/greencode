# Matriz de conformidade — AV2

Cada linha liga um requisito do enunciado (AV2 e regras mantidas da AV1) ao local da implementação e ao teste que o comprova.
Resultado de referência: **43 testes passando** (38 de integração com banco real + 5 unitários).

## Requisitos da AV2

| Requisito | Implementação | Evidência |
|---|---|---|
| Camadas Controller → Service → Repository | `src/controllers`, `src/services`, `src/repositories` (só os repositórios usam o Prisma) | revisão de código; `tsc --strict` sem erros |
| Fastify, JSON Schema, hooks de autenticação e logging | `src/app.ts` (hook global `onRequest`, `onResponse`, `onRoute`) | `api.test` (401/403), `validacoes.test` (400 por schema) |
| Porta por variável de ambiente | `PORT` em `server.ts`; valida faixa | `servidor.test` (porta aleatória; `PORT=abc` falha) |
| Graceful shutdown | `SIGINT/SIGTERM` → para o job, `app.close()`, fecha o Prisma, sai com 0 | `servidor.test` (SIGTERM, código 0, porta liberada) |
| `schema.prisma` com Organizacao, Contrato, Lote, Equipamento, Movimentacao (+ Usuario, ConfiguracaoGlobal, Auditoria) | `prisma/schema.prisma` | `prisma validate`; migrações aplicadas em banco real |
| Relações: Org 1→0..1 Contrato, Org 1→0..* Lote, Lote 1→1..* Equipamento, Equip 1→0..* Movimentação | FKs, `UNIQUE`, triggers | `auditoria.test` (integridade no banco) |
| Migrações versionadas | `prisma/migrations/*` (tabelas; journal e integridade) | aplicadas do zero e por cima da anterior |
| PostgreSQL, JSON/UUID | `Json`/`JSONB`, `@db.Uuid`, `String[]` | `jornada-completa.test` |
| Autenticação JWT (`@fastify/jwt`), id + papel, cabeçalho `Authorization` | `controllers/auth.controller.ts`, hook global | `api.test`, `regras.test` (expiração, usuário desativado) |
| Hash de senha com a biblioteca de criptografia (bcrypt) | `bcryptjs` em `services/auth.service.ts` | `validacoes.test` (troca de senha), `auditoria.test` (sem hash no journal) |
| `$transaction` (lote + equipamentos; status + movimentação) | `logistica.service.ts`, `organizacao.service.ts` | `regras.test` (rollback), `validacoes.test` (lote com equipamentos) |
| Versionamento otimista (`versao`) | `repositories/db.ts` (`exigirAtualizacao`) + `versao` em todos os modelos | `regras.test` (2 movimentações simultâneas: 200 + 409) |
| Seed representativo e idempotente | `prisma/seed.ts` (4 papéis; orgs sem contrato, inativa e com contrato vencido; lotes em todos os status) | seed executado duas vezes sem duplicar |
| Unicidade de CNPJ e `codigoBarrasInterno`; constraints/triggers | `UNIQUE`, `CHECK`, 6 triggers | `validacoes.test` (409), `auditoria.test` |
| API documentada | OpenAPI/Swagger em `/docs` (29 endpoints, Bearer, erros padronizados) | `validacoes.test` (OpenAPI lista os endpoints) |
| Decisões, trade-offs, alternativas rejeitadas; limites do monólito | `DOCUMENTACAO_FINAL.md` §9 e §10 | revisão |
| Windows 10+ / Ubuntu 24.04+ | sem dependências nativas, scripts sem shell específico | executado em Linux; roteiro de verificação no Windows em `docs/EXECUCAO_E_TESTES.md` |

## Regras de negócio da AV1 mantidas

| Regra | Teste |
|---|---|
| CNPJ com dígitos verificadores, único; contrato obrigatório, vigente e com valor válido | `validacoes.test` (organização), `regras.test` |
| Lote: sem data futura, no máximo 90 dias (exatamente 90 aceito), organização ativa | `regras.test`, `validacoes.test` |
| Equipamento: tipo, ano, peso, marca/modelo válidos; só em lote `RECEBIDO` | `validacoes.test` (lote e equipamento) |
| Triagem em 2 etapas, lote vazio bloqueado, códigos de barras únicos | `jornada-completa.test`, `validacoes.test` |
| Desmonte só após a triagem completa; transições inválidas recusadas | `regras.test`, `unit.test`, trigger (`auditoria.test`) |
| Justificativa: descarte direto e queda de 2+ categorias de estado físico | `regras.test`, `jornada-completa.test`, `unit.test` |
| Lote `ENCAMINHADO` e `FINALIZADO` | `regras.test`, `jornada-completa.test` |
| Quatro papéis segregados; auditor só lê; administrador fora dos fluxos de negócio | `regras.test` (permissões), `jornada-completa.test` |
| Senha forte, único administrador protegido, alterar a própria senha | `validacoes.test`, `regras.test` |
| Alíquota e depreciação entre 0 e 1 | `validacoes.test` |
| Sessão de 30 minutos; expiração; renovação | `regras.test` (token expirado), `validacoes.test` (renovação) |
| **Journal** (id, timestamp, operação, entidade, antes/depois, usuário), imutável, retenção de 180 dias, rotação em 10 MB | `auditoria.test` (formato, imutabilidade, retenção, rotação) |
| Log das requisições (aceitas e rejeitadas), sem segredos | `auditoria.test`, `jornada-completa.test` |
| Jornada completa até a rastreabilidade | `jornada-completa.test` (13 etapas `[PASS]`) |

## Como reproduzir a verificação

```bash
npm run test:unit      # 5 testes
npm test               # 38 testes de integração (zera o banco de teste)
npm run test:jornada   # jornada completa
npx prisma migrate dev # deve informar que o schema está em sincronia com as migrações
```

## Decisões que divergem de uma leitura literal (e por quê)

- **Lote 1..\***: o mínimo de 1 equipamento é imposto na transição de status (trigger) e na triagem, não no `INSERT` do lote.
- **Journal na mesma transação**: substitui o "gravar antes" do arquivo; é atômico com a operação.
- **Administrador sem acesso aos fluxos de negócio**: preserva a segregação de papéis da AV1.
- **Credenciais da AV1 não migradas**: usuários são recriados; o hash passa de SHA-256 a bcrypt.
