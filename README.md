# GreenCode

Sistema de linha de comando em Node.js + TypeScript para controlar a logística reversa de equipamentos eletrônicos: cadastro de organizações e contratos, lotes, triagem, movimentações, rastreabilidade e relatórios. Possui controle de acesso por papel, autenticação, criptografia AES-256 dos arquivos e journal de auditoria.

## Requisitos

- Node.js 20 ou superior (testado com Node 22) e npm.
- Windows 10 ou superior, Ubuntu 24.04 ou superior e derivados.

## Como executar

```bash
git clone https://github.com/KamilleFernandes/greencode.git
cd greencode
npm install
npm start
```

Na primeira execução o sistema pede a senha do administrador (usuário `admin`) e gera a chave de criptografia. Dentro do sistema, digite `ajuda` para ver os comandos do seu papel. Exemplo:

```
lote criar --org BR001 --nf 123456 --transp TransRapida
```

Datas no formato `AAAA-MM-DD`. `sair` encerra a sessão e volta ao login; para fechar o programa use Ctrl+D ou Ctrl+C.

## Testes

```bash
npm test                  # todos
npm run test:jornada      # jornada completa
npm run test:detalhes     # cenários de falha
npm run test:regressoes   # correções de datas, provisionamento, histórico e journal
```

## Importante

A pasta `data/` contém a chave de criptografia e os dados do sistema. Ela está no `.gitignore` e **não deve ser versionada nem enviada** junto com o código.

## Documentação

Arquitetura de segurança, justificativas, limitações e cenários de falha: [DOCUMENTACAO_FINAL.md](./DOCUMENTACAO_FINAL.md).
