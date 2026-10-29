# GreenCode AV2 — Documentação de arquitetura, regras e decisões

## 1. Visão geral

A AV1 entregou um CLI com persistência em arquivos criptografados. A AV2 transforma o GreenCode em um **monólito
HTTP**: uma API REST (Fastify) com camadas Controller → Service → Repository, banco relacional PostgreSQL acessado
pelo Prisma ORM, autenticação JWT e documentação OpenAPI. As **regras de negócio da AV1 foram mantidas**; o que
mudou foi a infraestrutura que as sustenta.

| Aspecto | AV1 (CLI) | AV2 (API) |
|---|---|---|
| Interface | Linha de comando | HTTP/JSON (REST) + Swagger UI |
| Persistência | Arquivos AES-256 + journal em arquivo | PostgreSQL via Prisma, migrações versionadas |
| Autenticação | Sessão em memória, SHA-256 + salt | JWT (30 min) + bcrypt |
| Atomicidade | Arquivo temporário + rename | Transações (`$transaction`) |
| Concorrência | Um usuário por vez | Vários usuários: versionamento otimista, bloqueio de linha, sequences |
| Auditoria | `journal.log` (rotação 10 MB, retenção 180 dias) | Tabela `auditorias` no mesmo formato, com a mesma rotação e retenção |

## 2. Arquitetura em camadas

```
Cliente (Swagger, Postman, SPA)
   │ HTTP/JSON
   ▼
Hooks globais (app.ts): JWT → usuário ativo no banco → papel (authorize)
   ▼
Controllers   JSON Schema (400), interpretam parâmetros, delegam. Sem regra de negócio.
   ▼
Services      regras, validações, máquina de estados, transações, escrita no journal.
   ▼
Repositories  único ponto de acesso ao Prisma: consultas, versionamento otimista, sequences, journal.
   ▼
PostgreSQL    CHECK, UNIQUE, FK RESTRICT, triggers, sequences, função de manutenção do journal.
```

Os serviços não conhecem HTTP (recebem um `Ator`: quem executa e de qual requisição veio). Por isso a mesma lógica
poderia ser exposta por CLI ou mensageria no futuro.

Fluxo de uma requisição de escrita: validação do JSON Schema → hook de autenticação → checagem de papel →
controller → serviço abre uma transação → repositórios leem/gravam → **a entrada do journal é gravada na mesma
transação** → *commit*. Se qualquer passo falhar, nada é gravado (nem a operação, nem o journal dela); a rejeição
é então registrada à parte (ver §6).

## 3. Modelo de dados e cardinalidades

| Relação | Cardinalidade | Como é garantida |
|---|---|---|
| Organização → Contrato | 1 → 0..1 | `organizacaoId` único; o cadastro pela API exige contrato (regra da AV1) |
| Organização → Lote | 1 → 0..* | FK `lotes.organizacaoId`; trigger impede trocar a organização de um lote |
| Lote → Equipamento | 1 → 1..* | FK `equipamentos.loteId`; trigger impede um lote sem equipamentos de sair de `RECEBIDO` (o mínimo de 1 não pode ser imposto no `INSERT` sem impedir a criação do próprio lote) |
| Equipamento → Movimentação | 1 → 0..* | FK com `ON DELETE RESTRICT`; movimentação é somente de inclusão (trigger) |
| Lote / Equipamento / Organização / Contrato / Usuário / Configuração / Movimentação / Auditoria | — | cada tabela tem `versao` (versionamento otimista) |

Entidades: `Organizacao`, `Contrato`, `Lote`, `Equipamento`, `Movimentacao` (pedidas no enunciado) e
`Usuario`, `ConfiguracaoGlobal` (alíquota e depreciação, parâmetros do administrador da AV1), `Auditoria` e
`AuditoriaArquivada` (journal e seu arquivo de rotação). `Auditoria.usuarioId` não tem chave estrangeira de propósito:
o journal precisa sobreviver à remoção ou desativação do usuário (guarda também o login em `usuarioResponsavel`).

Códigos legíveis: `BR001` (organização), `CTR00001`, `LT00001` (lote), `EQ000001` (equipamento) e
código de barras `NOT-000001`, todos gerados por **sequences do PostgreSQL** (`nextval`, atômico), nunca por `MAX(id)+1`.
As chaves internas são UUID.

## 4. Regras de negócio (mantidas da AV1)

| Regra | Onde é aplicada |
|---|---|
| CNPJ com dígitos verificadores, único; aceita máscara | `utils/cnpj`, serviço, `UNIQUE` e `CHECK` de 14 dígitos |
| Organização exige razão social, inscrição estadual, endereço, telefone, e-mail e contrato | JSON Schema e serviço |
| Contrato: vencimento futuro e posterior à assinatura, valor ≥ 0; renovação só para data posterior ao vencimento atual | serviço e `CHECK` |
| Lote: organização ativa com contrato vigente, nota fiscal e transportadora | serviço |
| Data de entrada: não futura e no máximo 90 dias no passado (limite exato aceito) | serviço (`validarDataEntrada`) |
| Equipamento: tipo, estado físico, marca, modelo, ano (1970 até o ano atual), peso > 0 | JSON Schema, serviço e `CHECK` |
| Só adiciona equipamento a lote `RECEBIDO` | serviço (com bloqueio da linha do lote) |
| Triagem em duas etapas; lote vazio não entra em triagem; código de barras único | serviço, `UNIQUE`, sequence |
| Máquina de estados; desmonte só após a triagem completa | `validarTransicao` e **trigger** no banco |
| Movimentação só com lote em `TRIAGEM_CONCLUIDA` ou `ENCAMINHADO` | serviço |
| Descarte direto logo após a triagem exige justificativa | serviço |
| Queda de 2 ou mais categorias de estado físico exige justificativa; mesmo estado é recusado | serviço |
| Lote vira `ENCAMINHADO` na 1ª saída da triagem e `FINALIZADO` com todas as baixas | serviço |
| Senha: mínimo 8 caracteres, letras e números; login 3–32 caracteres; único administrador não pode ser rebaixado ou desativado | serviço |
| Alíquota e coeficientes de depreciação entre 0 e 1 | JSON Schema, serviço e `CHECK` |
| Segregação de papéis | hook `authorize` por rota (§5) |
| Journal imutável, retenção de 180 dias, rotação em 10 MB | triggers e função `fn_auditoria_manutencao` (§6) |

## 5. Papéis e permissões

| Papel | Pode |
|---|---|
| ADMINISTRADOR | usuários, configuração global, consultar e manter o journal, alterar a própria senha |
| OPERADOR_CADASTRO | cadastrar, consultar, renovar contrato e desativar organizações |
| GESTOR_ALMOXARIFADO | criar lotes, incluir equipamentos, triagem, movimentar, estado físico, rastreamento; consultar organizações |
| AUDITOR | somente leitura: organizações, lotes, rastreamento, relatórios e journal |

Qualquer papel autenticado pode alterar a própria senha, renovar o token e registrar logout. O administrador **não**
executa os fluxos de negócio (mesma segregação da AV1). O hook global confere, a cada requisição, o JWT e se o
usuário continua ativo no banco: desativar um usuário revoga o acesso imediatamente.

## 6. Auditoria: o journal da AV1 no banco

**Formato (UML `JournalTransacao` / PDF da AV1):** `id`, `timestamp`, `operacao`, `entidade`, `dadosAntes`,
`dadosDepois`, `usuarioResponsavel`. Acrescentados: `entidadeId`, `usuarioId` e os dados da requisição HTTP
(`requisicaoId`, `metodo`, `rota`, `ip`, `statusHttp`).

- **Registrado antes de valer.** A entrada é gravada **dentro da mesma transação** da operação. Ou ambas são
  confirmadas, ou nenhuma: não existe alteração de estado sem journal, nem journal de operação que não aconteceu.
  Esse é o equivalente transacional do "registrar antes de aplicar" do arquivo da AV1.
- **Dados antes/depois.** Mudanças de status, estado físico, papel, contrato, configuração e lote guardam o estado
  anterior e o novo.
- **Log das requisições.** Toda requisição de escrita bem-sucedida gera entrada(s) do journal com a rota e o usuário.
  Toda requisição **rejeitada** (400/401/403/404/409/422/500 em escrita; 401/403 em qualquer método) gera uma entrada
  `REQUISICAO_REJEITADA` com usuário (ou `ANONIMO`), rota, status e mensagem. Login e falha de login têm entradas
  próprias. Leituras bem-sucedidas não são registradas (decisão de volume).
- **Sem segredos.** Senhas, hashes, tokens e cabeçalhos de autorização nunca vão ao journal (campos sensíveis viram `[OCULTO]`).
- **Imutável.** Triggers recusam `UPDATE` e `DELETE` em `auditorias`, `auditorias_arquivadas` e `movimentacoes`; só a
  função de manutenção, que liga uma variável de sessão dentro da própria transação, pode remover linhas.
- **Rotação.** Quando a tabela passa de **10 MB** (`AUDITORIA_LIMITE_BYTES`), todas as entradas vão para `auditorias_arquivadas`
  e o journal ativo recomeça vazio (equivalente a renomear o arquivo na AV1). A consulta `GET /auditoria` continua
  enxergando as entradas arquivadas.
- **Retenção.** Entradas com menos de **180 dias** (`AUDITORIA_RETENCAO_DIAS`) nunca são removidas; as mais antigas são
  expurgadas na manutenção. A manutenção roda na partida, a cada 6 horas, por `npm run auditoria:manutencao` ou `POST /auditoria/manutencao`.
- **Limitações assumidas.** O `reverter()` do UML não foi exposto (o journal é de auditoria, não de desfazer). Quem tem
  acesso de superusuário ao banco pode desativar triggers; a proteção é contra o uso normal e contra falhas de aplicação.

## 7. Segurança

- **JWT** assinado com segredo de pelo menos 32 caracteres (`JWT_SECRET`), contendo `sub` (id), login e papel, validade
  de **30 minutos** (`JWT_EXPIRES_IN`). `POST /auth/renovar` emite uma nova janela enquanto o token atual é válido
  (equivalente à expiração por inatividade da AV1: quem fica 30 minutos sem renovar precisa autenticar de novo).
- **bcrypt** (`BCRYPT_ROUNDS`, padrão 12) com salt embutido; a verificação roda sempre, mesmo para login inexistente,
  para não revelar pelo tempo de resposta se o usuário existe. Troca de senha exige a senha atual.
- Respostas de erro padronizadas `{ "erro", "detalhes" }`, sem vazar detalhes internos. Segredos só no `.env` (fora do git).
- Swagger UI público apenas para leitura da documentação; todos os endpoints de dados exigem Bearer.

## 8. Transações e concorrência

| Situação | Mecanismo |
|---|---|
| Criar organização + contrato; lote + equipamentos; triagem; status + movimentação + status do lote | `$transaction`: tudo ou nada (testado com rollback) |
| Dois usuários alteram o mesmo registro | Versionamento otimista: `UPDATE ... WHERE id = ? AND versao = ?`; sem linha afetada = `409` |
| Várias inclusões simultâneas no mesmo lote / mudanças de status concorrentes no lote | `SELECT ... FOR UPDATE` na linha do lote serializa as operações |
| Geração de códigos | sequences do PostgreSQL |
| Movimentações simultâneas do mesmo equipamento com a mesma versão | uma tem sucesso (`200`), a outra recebe `409` (testado) |

O último acesso do usuário é metadado e **não** incrementa a versão do registro.

## 9. Decisões arquiteturais, alternativas e trade-offs

| Decisão | Alternativas rejeitadas | Por quê / custo |
|---|---|---|
| Monólito em camadas | Microsserviços | Estágio inicial: implantação simples, depuração fácil, transações locais. Custo: escala em bloco |
| Fastify | Express | JSON Schema nativo (validação e Swagger a partir do mesmo schema), melhor desempenho e erros estruturados. Custo: ecossistema menor |
| Prisma ORM | SQL puro, Knex | Tipos TypeScript e migrações. Custo: triggers, CHECK e a função do journal ficam em SQL manual (`migrations/`), fora do schema |
| PostgreSQL | MySQL | Transações ACID, `jsonb`, triggers e sequences maduros |
| JWT stateless + checagem do usuário no banco | Sessão em servidor | Escala sem estado de sessão. Custo: um `SELECT` por requisição e o token não pode ser revogado antes de expirar (a desativação do usuário bloqueia o acesso na hora) |
| bcrypt | SHA-256 da AV1, Argon2 | bcrypt é lento por projeto e tem salt; SHA-256 é rápido demais para senhas. As credenciais da AV1 não são migradas (os usuários são recriados) |
| Versionamento otimista | Bloqueio pessimista | Não bloqueia leitores; conflitos são raros. Custo: o cliente precisa reenviar a `versao` e tratar `409`. O bloqueio pessimista só é usado de forma pontual (linha do lote) |
| Regras em serviço **e** no banco (CHECK, triggers) | Só no serviço | Defesa em profundidade: nem um script ou outro cliente grava estado inconsistente. Custo: duplicação consciente de algumas regras |
| Journal em tabela, na mesma transação | Arquivo como na AV1 | Consistência com os dados e consulta pela API. Custo: rotação precisa de rotina própria (implementada) |
| Códigos legíveis + UUID | Só UUID ou só inteiro | UUID evita enumeração; o código serve ao operador (`BR001`, `LT00001`). Custo: duas identidades por registro |
| Remover o CLI | Manter os dois | O enunciado pede "não mais CLI". A AV1 permanece na tag `av1-final` do git |
| Lote 1..* imposto por trigger na transição de status | `CHECK` | O mínimo de 1 equipamento não pode valer na criação do lote (o lote precisa existir antes dos itens) |

## 10. Limites do monólito

O monólito é a escolha certa agora, mas tem limites que orientam a evolução:

- **Escala por bloco:** a triagem (escrita pesada) e os relatórios (leitura agregada) escalam juntos. Réplicas de leitura do PostgreSQL e cache de relatórios adiam o problema; separar o módulo de relatórios seria o primeiro corte.
- **Banco único como ponto de contenção:** transações longas ou relatórios pesados competem com a operação. Mitigações: índices, paginação, réplica de leitura.
- **Acoplamento de implantação:** qualquer mudança exige novo *deploy* de tudo; testes e migrações precisam ser disciplinados.
- **Integrações assíncronas** (certificados ambientais, mercado de matérias-primas) pedem filas e *workers*; hoje não existem. A fronteira entre serviços e controllers já permite expor a mesma lógica por mensageria.
- **Falha compartilhada:** um defeito derruba a API inteira; o encerramento gracioso e a rota `/health` ajudam em orquestração.
- **Evolução natural:** extrair módulos com fronteiras já claras (autenticação, relatórios, auditoria) só quando houver necessidade medida.

## 11. Compatibilidade

Node.js 20+, PostgreSQL 14+. Sem dependências nativas (bcryptjs em JavaScript puro, driver `pg`), scripts npm sem
comandos de shell específicos e caminhos independentes de sistema: previsto para **Windows 10+** e **Ubuntu 24.04+** e derivados.
Particularidade: no Windows o `SIGTERM` não é entregue a processos filhos; o encerramento gracioso por sinal vale para Linux e para `Ctrl+C` no terminal.

## 12. O que mudou em relação à primeira entrega da AV2

Correções de compilação e de JWT; rotas reorganizadas para o OpenAPI listar todos os endpoints; camada de repositórios
real; criação de lote com equipamentos em uma transação; `GET /auditoria`, alteração de senha e renovação de token;
administrador sem acesso aos fluxos de negócio; inscrição estadual obrigatória; códigos `BR001`; journal no formato da AV1,
com log de requisições, retenção e rotação; `ON DELETE RESTRICT` e triggers de integridade; remoção da migração SHA-256
e do `legacy-cli`; relatório financeiro com dias locais; testes de 6 para 43.
