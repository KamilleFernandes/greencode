# GreenCode — Relatório técnico da AV3

## 1. Escopo implementado

A AV3 acrescenta ao serviço AV2 uma camada analítica, uma API de integração para parceiros e processamento assíncrono. A implementação mantém Node.js, TypeScript, Fastify, Prisma e PostgreSQL. As rotas internas da AV2 permanecem disponíveis; as novas rotas ficam sob `/api/v1/internal`, `/api/v1/admin` e `/api/v1/public`.

## 2. Camada analítica

### Eficiência operacional

Os marcos `triagemIniciadaEm`, `triagemConcluidaEm`, `triagemIniciadaPor` e `triagemConcluidaPor` são persistidos diretamente no lote. A migração faz backfill a partir dos journals atual e arquivado. Lotes históricos sem eventos permanecem sem duração mensurável; eventos de conclusão sem início recebem início igual à conclusão, sem atribuir duração fictícia. A análise calcula média, mediana e dispersão dos minutos de triagem, agrupamentos por operador e mês, lotes em triagem e maiores tempos observados.

### Rentabilidade estimada

O módulo estima valor de recuperação por equipamento usando parâmetros configuráveis de referência por tipo, fator do estado físico, depreciação simplificada por idade e valor de sucata por quilograma. O resultado é agrupado por tipo, estado físico, marca e modelo. Há um ajuste empírico limitado entre 0,5 e 1,5, com encolhimento bayesiano para a média global quando há poucas observações de desfecho.

**Limitação importante:** o banco AV2 não registra preços reais de venda, custo de processamento, frete ou margem. Portanto, o resultado é um valor estimado de recuperação, não lucro líquido nem preço de mercado. Os valores iniciais da migração são parâmetros ilustrativos e devem ser substituídos por dados reais antes de uso comercial.

### Vida útil remanescente

A previsão usa regressão linear simples por mínimos quadrados ordinários (OLS), relacionando idade do equipamento ao escore ordinal do estado físico (NOVO até INSERVIVEL). O relatório apresenta a projeção agregada por tipo e uma estimativa de anos remanescentes por equipamento, usando o modelo do respectivo tipo. São calculados inclinação, intercepto, R², erro residual e idade projetada ao limiar INSERVIVEL. A classificação de confiança exige amostra mínima, diversidade de idades, inclinação positiva e projeção dentro do intervalo configurado.

**Limitação estatística:** os dados disponíveis são observações transversais, não séries longitudinais de falhas do mesmo equipamento. Tratar a escala ordinal como intervalar e inferir envelhecimento a partir de equipamentos diferentes é uma aproximação. Resultados com amostra insuficiente são marcados como tal; não devem ser interpretados como previsão individual garantida.

## 3. Biblioteca e método estatístico

A implementação usa fórmulas explícitas em TypeScript para estatística descritiva e OLS, sem dependência estatística adicional. A escolha evita adicionar uma biblioteca para um conjunto pequeno e transparente de operações; a regressão calcula médias, soma de quadrados, inclinação, intercepto, R² e erro residual diretamente. Os cálculos são funções puras e possuem testes unitários determinísticos. Se o escopo evoluir para modelos multivariados, intervalos inferenciais ou séries temporais, uma biblioteca especializada poderá ser introduzida.

## 4. Persistência e histórico

`analise_execucoes` armazena categoria, origem, parâmetros, resultado JSON, tamanho da amostra, versão do modelo, duração, organização, autor e instante da execução. `previsoes_vida_util` guarda uma linha por tipo e execução, permitindo comparar previsões históricas com observações futuras. Gatilhos de somente inclusão preservam o histórico analítico.

`configuracoes_analiticas` guarda fatores por estado e valores de referência. A alteração administrativa usa controle otimista de versão.

## 5. API pública e segurança

As chaves são emitidas por administrador e associadas a uma organização e permissões. O segredo é aleatório, apresentado uma única vez e armazenado somente como SHA-256; o prefixo permite localizar a chave sem expor o segredo. A validação compara hashes em tempo constante, verifica expiração/revogação e atualiza o último uso.

Permissões: `RASTREABILIDADE_LEITURA`, `LOTES_LEITURA`, `LOTES_ESCRITA` e `ANALISES_LEITURA`. A API pública usa `X-API-Key`; rotas administrativas e internas continuam protegidas pelo JWT da AV2. A limitação de requisições é por chave e janela de um minuto.

A implementação atual do rate limit mantém contadores em memória por processo. Para implantação horizontal com várias instâncias, os contadores devem ser movidos para armazenamento compartilhado (por exemplo Redis ou tabela PostgreSQL com atualização atômica). A autenticação e os dados das chaves permanecem centralizados no PostgreSQL.

## 6. Processamento assíncrono e retry

A fila utiliza PostgreSQL. O worker reivindica uma tarefa com `FOR UPDATE SKIP LOCKED`, permitindo concorrência entre instâncias sem que duas reivindiquem o mesmo registro. A tarefa recebe lease (`bloqueadaAte`), trabalhador, contador e status. Leases expirados podem ser recuperados após queda do worker.

O retry usa backoff exponencial com teto e jitter: `min(teto, base × 2^(tentativa−1)) × (1 ± jitter)`. Após o limite de tentativas, a tarefa passa a `FALHA`; caso contrário, retorna a `PENDENTE` com `proximaTentativaEm`. A API devolve o identificador imediatamente e disponibiliza endpoints de polling e resultado JSON/CSV.

Uma análise completa é agendada diariamente às 02:00 UTC. O identificador de deduplicação por data impede a criação repetida da mesma execução diária.

## 7. Escalabilidade

Para centenas ou milhares de parceiros: executar múltiplas instâncias stateless da API atrás de balanceador; manter PostgreSQL gerenciado com índices, pool de conexões e réplicas de leitura quando necessário; manter workers independentes escaláveis horizontalmente; mover rate limiting para Redis/armazenamento compartilhado; aplicar cotas por organização e retenção/arquivamento dos resultados; limitar tamanho de página e exportações; monitorar fila, latência, falhas, tentativas e consumo de conexões. A fila PostgreSQL atual atende a uma implantação inicial sem infraestrutura Redis adicional; em alto volume, BullMQ/Redis ou broker dedicado pode ser avaliado.

## 8. Compatibilidade e execução

Requer Node.js 20 ou superior e PostgreSQL. O `package-lock.json` recebido na base AV2 estava incompleto (registrava apenas duas dependências de desenvolvimento e omitia as dependências listadas no `package.json`); foi removido para evitar que `npm ci` falhe com um lock inconsistente. Execute `npm install` para gerar um lockfile válido no ambiente de implantação. A API não depende de recursos exclusivos de Windows; a instalação deve ser feita com `npm install`, configuração do `.env`, `npx prisma migrate deploy`, `npm run seed` (quando aplicável) e `npm start`. A execução depende de acesso ao PostgreSQL e de `JWT_SECRET` seguro.

## 9. Testes

`tests/analytics-unit.test.mjs` cobre estatística descritiva, regressão OLS, inversão da reta, CSV injection e backoff. A suíte de integração original da AV2 permanece em `npm test` e usa exclusivamente `TEST_DATABASE_URL`. A migração AV3 deve ser aplicada em banco PostgreSQL de teste antes dos testes de integração.

