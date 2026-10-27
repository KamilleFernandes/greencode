# Documentação arquitetural — GreenCode AV2

## Visão geral

O GreenCode AV2 é um monólito modular que recebe requisições HTTP, valida contratos JSON, autentica usuários por JWT, aplica as regras de negócio em serviços e persiste registros relacionais via Prisma/PostgreSQL. O código da AV1 permanece em `legacy-cli/` apenas como referência e prova de continuidade.

## Camadas

- **Controllers**: definem método e caminho HTTP, JSON Schema, códigos de resposta e papéis autorizados. Não devem conter regras complexas de domínio.
- **Services**: aplicam regras de CNPJ, vigência contratual, período de entrada do lote, triagem em duas etapas, máquina de estados, justificativa de queda de estado físico e controle de versão.
- **Repositories**: concentram helpers de leitura, geração de códigos por sequências PostgreSQL e registro de auditoria. Operações que abrangem vários registros são coordenadas pelo serviço dentro de `$transaction` para manter atomicidade.
- **Persistência**: Prisma Client com adaptador PostgreSQL (`@prisma/adapter-pg`); migrações em `prisma/migrations`.
- **Infraestrutura HTTP**: Fastify, logging, padronização de erros, Swagger/OpenAPI, JWT e encerramento gracioso.

## Modelo relacional

1. Organização 1 → 0..1 Contrato (a relação é opcional no banco para representar dados incompletos; a API de cadastro exige contrato vigente).
2. Organização 1 → 0..* Lotes.
3. Lote 1 → 0..* Equipamentos no banco. A operação de triagem recusa lote sem equipamentos; não é adequado exigir cardinalidade mínima com uma FK comum.
4. Equipamento 1 → 0..* Movimentações.
5. Usuario guarda login único, papel, estado, versão e hash da senha.
6. ConfiguracaoGlobal guarda alíquota e parâmetros de depreciação.
7. Auditoria guarda o ator, ação, entidade, identificador, detalhes e instante da operação.

Todos os oito modelos possuem `versao`. Entidades imutáveis como movimentações e auditorias recebem versão inicial 1; operações de alteração das entidades de negócio verificam a versão e a incrementam.

## Decisões e trade-offs

### Monólito vs. microsserviços

Escolhido monólito modular porque a atividade pede uma transição da CLI para servidor e há poucas razões para distribuir o domínio em serviços independentes no momento. Transações de negócio ficam simples e há menos custo operacional. A desvantagem é que componentes escalam juntos; módulos e contratos ajudam uma futura extração se houver necessidade real.

### Fastify vs. Express

Escolhido Fastify pela integração com JSON Schema, hooks, plugins e Swagger. Express continua válido e tem ecossistema grande, mas exigiria escolher e integrar mais componentes de validação e documentação.

### Prisma vs. SQL puro

Escolhido Prisma ORM para schema declarativo, client tipado e migrações. SQL puro poderia oferecer controle granular e menos abstração, mas aumenta código repetitivo e risco de erro de mapeamento. SQL explícito é usado na migração para constraints `CHECK` e sequences, recursos complementares ao schema.

### JWT vs. sessão

JWT reduz a necessidade de armazenar uma sessão a cada login, e o token contém o subject do usuário; a aplicação consulta o usuário no banco para refletir desativação e mudança de papel. O token expira em 30 minutos. Como consequência de ser stateless, logout no cliente não invalida criptograficamente o token já emitido; revogação imediata exigiria blacklist, `tokenVersion` verificada em cada requisição, ou sessões persistidas.

### bcrypt vs. SHA-256

Novas senhas usam bcrypt via `bcryptjs`, com custo configurável (`BCRYPT_ROUNDS`). Hashes SHA-256 + salt da AV1 podem ser verificados e migrados para bcrypt no primeiro login. SHA-256 é um hash rápido, inadequado como único mecanismo de armazenamento de senha porque facilita ataques de tentativa; bcrypt foi desenhado para tornar esses ataques mais custosos.

### UUID vs. código sequencial

IDs internos usam UUID para evitar colisões entre sistemas e reduzir dependência de uma sequência de negócio. Códigos legíveis de organização, contrato, lote e equipamento e os códigos de barras usam sequences PostgreSQL, sem `MAX(id)+1`, para não gerar colisões em acessos concorrentes.

### Concorrência otimista vs. pessimista

Escolhida concorrência otimista com `versao`. O `UPDATE ... WHERE id = ? AND versao = ?` só altera um registro se a versão lida ainda for atual; uma segunda atualização concorrente recebe 409. Lock pessimista pode ser útil para contenção alta, mas bloqueia transações e aumenta a chance de espera/deadlock. Operações multi-registro usam `$transaction`; auditoria e movimentação fazem parte da mesma transação.

### Constraints no banco vs. somente no serviço

Validações de formato e regras dependentes de contexto ficam nos serviços; unicidade, chaves estrangeiras, peso positivo, valores monetários não negativos, versão positiva e datas de contrato também são protegidos por constraints no banco. A duplicação intencional garante integridade mesmo se outro consumidor gravar no banco diretamente.

### Remoção do CLI

A interface oficial da AV2 é a API HTTP; Swagger UI permite demonstrar o sistema sem um novo front-end. A CLI da AV1 foi preservada em `legacy-cli/` para leitura e recuperação de regras, mas não é a interface de execução da AV2.

## Segurança

- Nunca registrar senha, hash ou salt em auditoria.
- Senha exige oito ou mais caracteres e letras e números; contas são armazenadas com bcrypt.
- CNPJ é validado pelo cálculo de dígitos e é único no banco.
- Hash JWT secreto vem de variável de ambiente; `.env` não é versionado.
- O hook consulta o estado atual do usuário antes de autorizar e retorna 401 para token inválido/expirado ou usuário inativo.
- Papéis incorretos recebem 403.
- Mensagens genéricas de 500 não expõem stack trace ao cliente; o detalhe fica no logger.
- O teste de integração recusa executar se `TEST_DATABASE_URL` não identificar um banco com `test` no nome.

## Ciclo de triagem e movimentação

1. Lote começa em `RECEBIDO`; itens só podem ser adicionados nesse status.
2. Primeira chamada de triagem gera código de barras e muda os equipamentos para `EM_TRIAGEM`; lote passa para `EM_TRIAGEM`.
3. Segunda chamada de triagem conclui o lote (`TRIAGEM_CONCLUIDA`); lote vazio é recusado.
4. Só depois da triagem concluída o equipamento pode ir a `AGUARDANDO_DESMONTE` ou descarte direto justificado.
5. Depois de `AGUARDANDO_DESMONTE`, segue para `EM_DESMONTE` e termina em reaproveitamento, material reciclável ou descarte seguro, seguido de `BAIXA_DEFINITIVA`.
6. Cada mudança de status persiste a movimentação e auditoria atomicamente. Lote passa a `ENCAMINHADO` quando começa a saída da triagem e a `FINALIZADO` quando todos os equipamentos estão em baixa definitiva.
7. Queda de duas ou mais categorias no estado físico exige justificativa.

## Testes e limitação conhecida

A AV1 original e seus testes estão preservados. A suíte nova cobre autenticação, autorização, CNPJ inválido, a jornada principal, conflito de versão e transição inválida. Ainda é necessário executar a suíte em um ambiente com acesso ao npm e PostgreSQL, e completar a conversão individual dos 74 testes da CLI para contratos HTTP para reivindicar paridade total.
