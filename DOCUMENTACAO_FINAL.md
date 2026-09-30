# GreenCode — Documentação da Arquitetura de Segurança

## 1. Arquitetura de segurança adotada

O Projeto Greencode utiliza uma arquitetura de segurança baseada em autenticação por credenciais, controle de acesso por papel, criptografia dos arquivos de persistência, expiração de sessão e auditoria das operações.

Na primeira execução, o sistema verifica a existência do arquivo de configuração mestre. Caso ele não exista, é iniciado o provisionamento inicial, no qual é definida a senha do primeiro administrador e é gerada automaticamente a chave criptográfica mestre.

O arquivo de configuração mestre mantém a chave de criptografia e a referência ao primeiro administrador. As credenciais são armazenadas separadamente no arquivo de credenciais.

Os arquivos de persistência de credenciais, organizações, lotes, equipamentos e movimentações são protegidos com criptografia simétrica AES-256.

O acesso às funcionalidades é controlado pelos seguintes papéis:

- ADMINISTRADOR: gerencia usuários e parâmetros globais.
- OPERADOR_CADASTRO: cadastra organizações e contratos de coleta.
- GESTOR_ALMOXARIFADO: registra lotes, equipamentos, triagem e movimentações.
- AUDITOR: consulta históricos e relatórios, sem permissão para alterar dados.

As operações também são registradas em journal antes da aplicação da alteração ao estado persistido, permitindo rastreabilidade das transações.

## 2. Criptografia dos arquivos — AES-256

Os arquivos persistentes do sistema utilizam criptografia simétrica AES-256.

A chave criptográfica mestre é gerada automaticamente durante o provisionamento inicial e utilizada para proteger os arquivos que contêm os dados do sistema.

A escolha do AES-256 foi adotada porque permite proteger os dados persistidos com uma chave simétrica de 256 bits, impedindo que o conteúdo dos arquivos seja armazenado em texto legível.

São protegidos por criptografia os arquivos de:

- credenciais;
- organizações;
- lotes;
- equipamentos;
- movimentações.

## 3. Hash de senhas — SHA-256

As senhas dos usuários não são armazenadas em texto claro.

Cada credencial utiliza um salt próprio e a senha é processada com o algoritmo SHA-256 antes de ser persistida.

No processo de autenticação, a senha informada pelo usuário é novamente processada com o salt correspondente e o resultado é comparado com o hash armazenado.

A escolha desse esquema evita o armazenamento direto da senha do usuário e permite que a autenticação seja realizada por comparação de hashes.

## 4. Política de expiração de sessões

Após uma autenticação válida, o sistema cria uma sessão associada ao usuário autenticado e ao seu papel.

A sessão expira após 30 minutos de inatividade.

Quando uma sessão expira, ela deixa de ser válida e o usuário deve realizar uma nova autenticação para continuar utilizando o sistema.

Essa política foi adotada para reduzir o período em que uma sessão abandonada ou esquecida permanece disponível para uso.

## 5. Auditoria das operações

As transações realizadas pelo sistema são registradas em journal antes de a alteração correspondente ser aplicada ao estado persistido.

Esse mecanismo permite manter a rastreabilidade das operações executadas.

O journal possui política de retenção mínima de 180 dias.

Quando o arquivo de journal ultrapassa 10 MB, é realizada a rotação automática do arquivo.

## 6. Cenários de falha testados e respostas do sistema

| Cenário de falha | Resposta do sistema |
|---|---|
| Usuário ou senha incorretos | A autenticação é rejeitada e o acesso não é concedido. |
| Sessão expirada por inatividade | A sessão é invalidada e o usuário deve realizar novo login. |
| Usuário duplicado | O cadastro do novo usuário é rejeitado. |
| Papel de usuário inválido | A operação é rejeitada. |
| CNPJ inválido | O cadastro da organização é rejeitado. |
| CNPJ já cadastrado | O novo cadastro é rejeitado para preservar a unicidade. |
| Lote com data de entrada futura | A criação do lote é rejeitada. |
| Lote com data de entrada anterior a mais de 90 dias | A criação do lote é rejeitada. |
| Tentativa de encaminhar equipamento para desmonte antes da triagem completa | A movimentação é bloqueada. |
| Alteração do estado físico para duas ou mais categorias abaixo sem justificativa | A alteração é rejeitada até que seja fornecida uma justificativa textual. |
| Usuário sem permissão tenta executar uma operação restrita | A operação é rejeitada de acordo com o papel do usuário autenticado. |
| Auditor tenta alterar dados | A operação é rejeitada, mantendo o perfil de auditor somente para consulta. |
| Arquivo persistido é adulterado | A leitura é rejeitada ao detectar inconsistência no conteúdo protegido. |
| Falha durante a gravação de um arquivo | O sistema evita deixar um arquivo parcial como estado persistido. |
| Journal ultrapassa 10 MB | O arquivo é rotacionado automaticamente. |
| Journal rotacionado ultrapassa o período de retenção de 180 dias | O arquivo antigo é removido conforme a política de retenção. |
