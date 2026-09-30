# GreenCode

O GreenCode é um sistema de linha de comando desenvolvido em Node.js com TypeScript para controlar o processo de logística reversa de equipamentos eletrônicos, para reaproveitamento de peças e materiais que antes seriam descartados.

O sistema permite cadastrar organizações, contratos, lotes e equipamentos, além de realizar triagem, movimentações, rastreamento e geração de relatórios.

Também possui controle de acesso por tipo de usuário, autenticação, criptografia dos arquivos e registro das operações realizadas no sistema.

## Como executar

Primeiro, no terminal clone o repositório:

```bash
git clone https://github.com/KamilleFernandes/greencode.git
```
Depois, dentro da pasta do projeto, instale as dependências:

```bash
npm install
```
Depois execute o sistema: 
```bash
npm start
```

Inicie criando um usuário e senha de administrador.

## Documentação

A documentação da arquitetura de segurança e dos cenários de falha está disponível em [DOCUMENTACAO_FINAL.md](./DOCUMENTACAO_FINAL.md).