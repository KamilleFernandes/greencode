# GreenCode — Documentação da Arquitetura de Segurança

## 1. Visão geral

O GreenCode protege o acesso e os dados em cinco camadas: **autenticação** por credenciais, **autorização por papel**, **criptografia AES-256 dos arquivos**, **expiração de sessão (30 minutos de inatividade)** e **auditoria** por journal cifrado. Cada camada tem uma justificativa e uma limitação conhecida, descritas abaixo.

Papéis e permissões:

| Papel | Pode |
|---|---|
| ADMINISTRADOR | Gerir usuários e papéis; definir alíquota de imposto e coeficientes de depreciação; alterar a própria senha |
| OPERADOR_CADASTRO | Cadastrar, buscar, listar organizações e renovar contratos |
| GESTOR_ALMOXARIFADO | Criar lotes, incluir equipamentos, processar triagem, alterar estado físico, movimentar e rastrear equipamentos |
| AUDITOR | Somente leitura: rastrear equipamentos e gerar relatórios; qualquer comando de escrita é recusado |

Cada papel só vê no menu os comandos que pode executar, e a permissão é conferida de novo na execução do comando (o menu não é a barreira de segurança).

## 2. Provisionamento inicial

1. Na inicialização, o sistema procura `data/config.master`. Se não existir, entra em modo de provisionamento e pede a senha do administrador (mínimo de 8 caracteres, com letras e números).
2. A chave mestra de 256 bits é gerada com `crypto.randomBytes(32)`.
3. O administrador é criado e `credenciais.dat` é gravado.
4. **`config.master` é gravado por último e de forma atômica.** Se o processo cair em qualquer ponto anterior, nada fica pela metade: na próxima execução o provisionamento recomeça. Sobras de uma tentativa interrompida são renomeadas (`*.orfao-<data>`), nunca apagadas.
5. Se existir `config.master` mas não existir `credenciais.dat` (caso de versões anteriores que gravavam o arquivo mestre primeiro), a chave existente é reaproveitada e só a senha do administrador é pedida de novo, evitando um sistema sem nenhum usuário.

`config.master` guarda a chave (`chaveHex`) e a referência ao primeiro administrador (`administradorInicial`), conforme o enunciado, com permissão `0600` em sistemas POSIX.

## 3. Criptografia dos arquivos — AES-256-GCM

- **Algoritmo:** AES com chave de 256 bits no modo **GCM**, IV aleatório de 12 bytes por gravação e tag de autenticação de 16 bytes.
- **Por que AES-256:** é o padrão simétrico consolidado, disponível no módulo `crypto` nativo do Node.js (sem dependência externa, o que simplifica a distribuição em Windows e Linux) e atende ao requisito do enunciado.
- **Por que GCM e não CBC:** GCM é criptografia autenticada. Além de esconder o conteúdo, ele detecta qualquer alteração: um arquivo adulterado falha na verificação do tag e a leitura é rejeitada com a mensagem "corrompido ou adulterado". Com CBC seria preciso um HMAC separado.
- **Arquivos cifrados:** `credenciais.dat`, `organizacoes.dat`, `lotes.dat`, `equipamentos.dat` (que contém o histórico de movimentações de cada equipamento), `configuracao.dat` e cada linha do journal.
- **Escrita atômica:** o conteúdo é gravado em um arquivo temporário (`.tmp`, permissão `0600`), sincronizado em disco (`fsync`) e renomeado sobre o destino. Se a gravação ou a renomeação falhar, o temporário é removido e o arquivo anterior permanece íntegro.

**Limitações conhecidas**
- A chave fica em `config.master` em texto claro (exigência do enunciado para esta etapa). Quem tiver acesso ao diretório `data/` por inteiro consegue ler tudo. **Nunca versionar nem distribuir a pasta `data/`** (ela está no `.gitignore`). Para a etapa de banco de dados, recomenda-se derivar a chave de uma senha mestra ou usar o cofre do sistema operacional.
- As movimentações não têm arquivo próprio: ficam dentro de `equipamentos.dat`, cifradas.
- `.cli_history` não é cifrado, mas senhas informadas na linha de comando são substituídas por `[OCULTO]` e o arquivo é criado com permissão `0600`.

## 4. Hash de senhas — SHA-256 com salt

- Cada credencial tem um **salt aleatório de 16 bytes**; o que se grava é `SHA-256(senha + salt)` em hexadecimal, em arquivo separado (`credenciais.dat`, também cifrado).
- A verificação recalcula o hash e compara em tempo constante (`timingSafeEqual`), evitando vazamento por tempo de resposta.
- O salt individual impede ataque por tabelas pré-computadas e faz senhas iguais gerarem hashes diferentes.
- A senha nunca é gravada, impressa, registrada no journal ou mantida no histórico do CLI.

**Limitação conhecida:** SHA-256 de uma única rodada é rápido, o que facilita ataque de força bruta se `credenciais.dat` e a chave vazarem juntos. O enunciado fixa SHA-256, então ele foi mantido. A mitigação recomendada para a próxima etapa é PBKDF2-HMAC-SHA256 com muitas iterações (continua sendo SHA-256, mas com custo ajustável) ou scrypt/Argon2. Nesta etapa, a defesa adicional é a política de senha (mínimo de 8 caracteres, letras e números).

## 5. Política de expiração de sessão — 30 minutos

- O login cria uma sessão com token aleatório de 256 bits, vinculada ao usuário e ao papel.
- A sessão expira após **30 minutos de inatividade**; cada comando aceito renova o prazo.
- Se a sessão estiver expirada quando o usuário digitar o próximo comando, ele é descartado, o CLI exibe um `[AVISO]` e exige novo login.
- **Por que 30 minutos:** é o valor definido no enunciado e equilibra a conveniência de uma jornada de triagem (comandos espaçados) com a redução do risco de um terminal esquecido aberto.
- As sessões ficam apenas em memória do processo: ao fechar o programa, todas deixam de existir.

## 6. Auditoria — journal

- Cada operação que altera estado grava uma linha cifrada (AES-256-GCM) em `journal.log` **antes** de o estado persistido ser alterado, com id, data/hora, operação, entidade, dados antes/depois e usuário responsável.
- Os eventos de login e de falha de login registram o próprio usuário como responsável (falhas ficam com o nome tentado).
- **Rotação:** quando uma nova linha faria o arquivo passar de 10 MB, ele é renomeado para `journal-<data>.log` e um novo é iniciado.
- **Retenção:** arquivos rotacionados são mantidos por no mínimo 180 dias e só então removidos (a verificação ocorre na inicialização e a cada rotação).
- **Limitação:** não há encadeamento de hashes entre as linhas; a adulteração de uma linha é detectada pelo GCM, mas a remoção de linhas inteiras de um arquivo por quem tenha acesso ao disco não seria. O encadeamento fica como evolução.

## 7. Datas

Datas no formato `AAAA-MM-DD` digitadas no CLI são interpretadas no **fuso local** do computador. Datas finais de período valem até 23:59:59 do dia informado (dia inclusivo). Isso evita o deslocamento de um dia que ocorreria ao interpretá-las como UTC em fusos como o do Brasil.

## 8. Cenários de falha testados e respostas do sistema

Os testes automatizados ficam em `testes/` (`npm test`).

| Cenário de falha | Resposta do sistema |
|---|---|
| Usuário ou senha incorretos | Login recusado; a tentativa é registrada no journal |
| Sessão expirada por inatividade | Sessão invalidada; novo login exigido |
| Usuário duplicado / nome inválido / senha fraca | Cadastro recusado |
| Papel de usuário inválido | Operação recusada |
| Rebaixar o único administrador | Recusado |
| CNPJ inválido (dígitos verificadores) | Cadastro recusado e nada é gravado |
| CNPJ já cadastrado | Cadastro recusado (unicidade) |
| Organização sem contrato, com contrato vencido ou valor inválido | Cadastro recusado |
| Lote com data de entrada futura | Criação recusada |
| Lote com data de entrada anterior a mais de 90 dias | Criação recusada (exatamente 90 dias é aceito) |
| Período de consulta com início posterior ao fim, ou data inexistente (ex.: 2026-02-30) | Recusado com "Período inválido" |
| Equipamento com tipo, estado, ano ou peso inválido | Inclusão recusada |
| Inclusão de equipamento em lote que já iniciou a triagem | Recusada |
| Lote vazio enviado à triagem | Recusado |
| Equipamento para desmonte antes da triagem completa | Movimentação bloqueada |
| Transição de status fora da máquina de estados | Recusada |
| Estado físico cai 2 ou mais categorias sem justificativa | Alteração recusada até haver justificativa textual |
| Usuário sem permissão executa comando restrito | Recusado conforme o papel; o auditor nunca altera dados |
| Arquivo de dados adulterado | Leitura recusada ("corrompido ou adulterado") |
| Falha na gravação ou na renomeação do arquivo | Temporário removido; arquivo anterior preservado |
| Queda do processo durante o provisionamento inicial | Provisionamento refeito na próxima execução, sem sistema trancado |
| Journal ultrapassa 10 MB | Arquivo rotacionado |
| Journal rotacionado com mais de 180 dias | Arquivo removido; com menos de 180 dias, preservado |
| Comando desconhecido | Mensagem `[ERRO]` e orientação para usar `ajuda` |

## 9. Níveis de severidade das mensagens

`[OK]` (sucesso), `[AVISO]` (situação a observar, como sessão expirada) e `[ERRO]` (operação recusada).

## 10. Relação com o diagrama UML

O código implementa as classes, atributos, métodos, enumerações, heranças (`Validador`) e realizações (`Autenticavel`) do diagrama. Acréscimos fora do UML: `ConfiguracaoGlobal` (alíquota e depreciação, exigidas pelo papel de administrador), `ServicoEquipamento.movimentarEquipamento` (necessário para a rastreabilidade após a triagem) e o parâmetro opcional `justificativa` em `atualizarEstadoFisico`. Pontos em que a implementação difere do diagrama: `ServicoRelatorio` lê o repositório diretamente em vez de consultar `ServicoLote`/`ServicoEquipamento`; o `JournalTransacao` é acessado de forma estática pelos serviços; e `Organizacao` exige um contrato no cadastro (na prática 1, não 0..1).
