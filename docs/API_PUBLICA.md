# API pública GreenCode — v1

Base URL: `http://localhost:3000/api/v1/public`

Autenticação: cabeçalho `X-API-Key: gc_<prefixo>_<segredo>`. O segredo completo é mostrado somente na criação. Respostas de erro seguem `{ "erro": "...", "detalhes": ... }`.

## Gerenciamento administrativo de chaves

As rotas abaixo exigem JWT de usuário `ADMINISTRADOR`:

- `POST /api/v1/admin/api-keys` — cria chave. Body: `nome`, `organizacaoId`, `permissoes` (uma ou mais de `RASTREABILIDADE_LEITURA`, `LOTES_LEITURA`, `LOTES_ESCRITA`, `ANALISES_LEITURA`), `limiteReqPorMinuto` opcional (1–6000), `expiraEm` opcional.
- `GET /api/v1/admin/api-keys` — lista metadados, nunca retorna segredo.
- `POST /api/v1/admin/api-keys/:id/revoke` — revoga chave.

## Rotas internas de análise (JWT)

Estas rotas são destinadas ao front-end e à equipe GreenCode e não aceitam chave de parceiro. Exigem JWT de usuário com papel `ADMINISTRADOR`, `GESTOR_ALMOXARIFADO` ou `AUDITOR`:

- `POST /api/v1/internal/analytics/efficiency` — executa e persiste a análise de eficiência.
- `POST /api/v1/internal/analytics/profitability` — executa e persiste a estimativa de recuperação.
- `POST /api/v1/internal/analytics/useful-life` — executa e persiste previsão por tipo e estimativa por equipamento.
- `GET /api/v1/internal/analytics/history?limite=20` — consulta histórico.
- `GET /api/v1/admin/analytics/config` e `PUT /api/v1/admin/analytics/config` — consulta/atualiza parâmetros, somente administrador e com controle de versão.

## Rotas para parceiros

- `GET /traceability/:identifier` — exige `RASTREABILIDADE_LEITURA`; consulta equipamento por código, código de barras ou UUID, restrito à organização da chave.
- `GET /lots` — exige `LOTES_LEITURA`; lista lotes da organização da chave.
- `POST /lots` — exige `LOTES_ESCRITA`; cadastra lote e equipamentos para a organização vinculada à chave. Body: `notaFiscal`, `transportadora`, e opcionalmente `dataEntrada`, `observacoes`, `equipamentos`.
- `GET /analytics/history` — exige `ANALISES_LEITURA`; lista histórico de execuções da organização.
- `POST /reports/predictive` — exige `ANALISES_LEITURA`; body opcional `{ "formato": "json" | "csv" }`. Retorna HTTP 202 com `id`, `status`, `consulta` e `resultado` para polling.
- `GET /tasks/:id` — consulta status da tarefa pertencente à organização da chave.
- `GET /tasks/:id/result` — obtém resultado concluído em JSON; use `?formato=csv` para CSV.

## Status e códigos comuns

- `200`: consulta ou resultado disponível.
- `201`: lote ou chave criada.
- `400`: corpo/parâmetro inválido.
- `401`: chave ausente, inválida, expirada ou revogada.
- `403`: permissão insuficiente.
- `404`: recurso inexistente ou fora da organização vinculada.
- `409`: conflito ou tarefa ainda em processamento.
- `429`: limite de requisições excedido.
- `500`: falha interna.

A documentação OpenAPI interativa da API completa permanece em `/docs`.

## Exemplos

Criar chave (como administrador autenticado):

```http
POST /api/v1/admin/api-keys
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "nome": "Parceiro Exemplo",
  "organizacaoId": "<uuid-da-organizacao>",
  "permissoes": ["RASTREABILIDADE_LEITURA", "ANALISES_LEITURA"],
  "limiteReqPorMinuto": 120
}
```

Resposta (o segredo é exibido uma única vez):

```json
{
  "id": "<uuid-da-chave>",
  "prefixo": "a1b2c3d4",
  "chave": "gc_a1b2c3d4_<segredo>"
}
```

Solicitar relatório preditivo:

```http
POST /api/v1/public/reports/predictive
X-API-Key: gc_<prefixo>_<segredo>
Content-Type: application/json

{ "formato": "json" }
```

Resposta HTTP `202 Accepted`:

```json
{
  "id": "<uuid-da-tarefa>",
  "status": "PENDENTE",
  "consulta": "/api/v1/public/tasks/<uuid-da-tarefa>",
  "resultado": "/api/v1/public/tasks/<uuid-da-tarefa>/result"
}
```
