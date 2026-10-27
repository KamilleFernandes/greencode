CREATE TYPE "PapelUsuario" AS ENUM ('ADMINISTRADOR', 'OPERADOR_CADASTRO', 'GESTOR_ALMOXARIFADO', 'AUDITOR');
CREATE TYPE "StatusLote" AS ENUM ('RECEBIDO', 'EM_TRIAGEM', 'TRIAGEM_CONCLUIDA', 'ENCAMINHADO', 'FINALIZADO');
CREATE TYPE "TipoEquipamento" AS ENUM ('COMPUTADOR_MESA', 'NOTEBOOK', 'MONITOR', 'IMPRESSORA', 'SERVIDOR', 'ROTEADOR', 'CABO_ESTRUTURADO', 'FONTE_ALIMENTACAO');
CREATE TYPE "EstadoFisico" AS ENUM ('NOVO', 'BOM_ESTADO', 'USADO_LEVE', 'USADO_MODERADO', 'DANIFICADO_LEVE', 'DANIFICADO_GRAVE', 'INSERVIVEL');
CREATE TYPE "StatusRastreamento" AS ENUM ('AGUARDANDO_TRIAGEM', 'EM_TRIAGEM', 'AGUARDANDO_DESMONTE', 'EM_DESMONTE', 'PECAS_REAPROVEITADAS', 'MATERIAL_RECICLAVEL', 'DESCARTE_SEGURO', 'BAIXA_DEFINITIVA');

-- Sequências de códigos legíveis. Os IDs internos são UUIDs; nenhum código usa MAX(id)+1.
CREATE SEQUENCE organizacao_codigo_seq START 1;
CREATE SEQUENCE contrato_codigo_seq START 1;
CREATE SEQUENCE lote_codigo_seq START 1;
CREATE SEQUENCE equipamento_codigo_seq START 1;
CREATE SEQUENCE codigo_barras_seq START 1;

CREATE TABLE "organizacoes" (
  "id" UUID NOT NULL,
  "codigo" VARCHAR(12) NOT NULL,
  "razaoSocial" VARCHAR(180) NOT NULL,
  "cnpj" VARCHAR(14) NOT NULL,
  "inscricaoEstadual" VARCHAR(30),
  "enderecoCompleto" VARCHAR(300) NOT NULL,
  "telefone" VARCHAR(30) NOT NULL,
  "email" VARCHAR(160) NOT NULL,
  "dataCadastro" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ativo" BOOLEAN NOT NULL DEFAULT TRUE,
  "versao" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "organizacoes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "organizacoes_versao_check" CHECK ("versao" >= 1)
);
CREATE UNIQUE INDEX "organizacoes_codigo_key" ON "organizacoes"("codigo");
CREATE UNIQUE INDEX "organizacoes_cnpj_key" ON "organizacoes"("cnpj");
CREATE INDEX "organizacoes_ativo_idx" ON "organizacoes"("ativo");

CREATE TABLE "contratos" (
  "id" UUID NOT NULL,
  "codigo" VARCHAR(12) NOT NULL,
  "organizacaoId" UUID NOT NULL,
  "dataAssinatura" DATE NOT NULL,
  "dataVencimento" DATE NOT NULL,
  "clausulas" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "valorMensal" DECIMAL(12,2) NOT NULL,
  "renovacaoAutomatica" BOOLEAN NOT NULL DEFAULT FALSE,
  "versao" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "contratos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "contratos_datas_check" CHECK ("dataVencimento" > "dataAssinatura"),
  CONSTRAINT "contratos_valor_check" CHECK ("valorMensal" >= 0),
  CONSTRAINT "contratos_versao_check" CHECK ("versao" >= 1),
  CONSTRAINT "contratos_organizacaoId_fkey" FOREIGN KEY ("organizacaoId") REFERENCES "organizacoes"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "contratos_codigo_key" ON "contratos"("codigo");
CREATE UNIQUE INDEX "contratos_organizacaoId_key" ON "contratos"("organizacaoId");
CREATE INDEX "contratos_dataVencimento_idx" ON "contratos"("dataVencimento");

CREATE TABLE "lotes" (
  "id" UUID NOT NULL,
  "codigo" VARCHAR(12) NOT NULL,
  "dataEntrada" DATE NOT NULL,
  "organizacaoId" UUID NOT NULL,
  "notaFiscal" VARCHAR(80) NOT NULL,
  "transportadora" VARCHAR(160) NOT NULL,
  "observacoes" VARCHAR(1000) NOT NULL DEFAULT '',
  "statusProcessamento" "StatusLote" NOT NULL DEFAULT 'RECEBIDO',
  "versao" INTEGER NOT NULL DEFAULT 1,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lotes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lotes_versao_check" CHECK ("versao" >= 1),
  CONSTRAINT "lotes_organizacaoId_fkey" FOREIGN KEY ("organizacaoId") REFERENCES "organizacoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "lotes_codigo_key" ON "lotes"("codigo");
CREATE INDEX "lotes_organizacaoId_idx" ON "lotes"("organizacaoId");
CREATE INDEX "lotes_statusProcessamento_idx" ON "lotes"("statusProcessamento");
CREATE INDEX "lotes_dataEntrada_idx" ON "lotes"("dataEntrada");

CREATE TABLE "equipamentos" (
  "id" UUID NOT NULL,
  "codigo" VARCHAR(12) NOT NULL,
  "codigoBarrasInterno" VARCHAR(32),
  "tipo" "TipoEquipamento" NOT NULL,
  "marca" VARCHAR(100) NOT NULL,
  "modelo" VARCHAR(120) NOT NULL,
  "anoFabricacao" INTEGER NOT NULL,
  "estadoFisico" "EstadoFisico" NOT NULL DEFAULT 'NOVO',
  "pesoQuilogramas" DECIMAL(10,3) NOT NULL,
  "loteId" UUID NOT NULL,
  "posicaoNoLote" INTEGER NOT NULL,
  "statusRastreamento" "StatusRastreamento" NOT NULL DEFAULT 'AGUARDANDO_TRIAGEM',
  "versao" INTEGER NOT NULL DEFAULT 1,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "equipamentos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "equipamentos_peso_check" CHECK ("pesoQuilogramas" > 0),
  CONSTRAINT "equipamentos_ano_check" CHECK ("anoFabricacao" >= 1970),
  CONSTRAINT "equipamentos_posicao_check" CHECK ("posicaoNoLote" >= 1),
  CONSTRAINT "equipamentos_versao_check" CHECK ("versao" >= 1),
  CONSTRAINT "equipamentos_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "lotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "equipamentos_codigo_key" ON "equipamentos"("codigo");
CREATE UNIQUE INDEX "equipamentos_codigoBarrasInterno_key" ON "equipamentos"("codigoBarrasInterno");
CREATE UNIQUE INDEX "equipamentos_loteId_posicaoNoLote_key" ON "equipamentos"("loteId", "posicaoNoLote");
CREATE INDEX "equipamentos_loteId_idx" ON "equipamentos"("loteId");
CREATE INDEX "equipamentos_statusRastreamento_idx" ON "equipamentos"("statusRastreamento");
CREATE INDEX "equipamentos_estadoFisico_idx" ON "equipamentos"("estadoFisico");

CREATE TABLE "movimentacoes" (
  "id" UUID NOT NULL,
  "equipamentoId" UUID NOT NULL,
  "dataHora" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "origem" VARCHAR(40) NOT NULL,
  "destino" VARCHAR(40) NOT NULL,
  "responsavel" VARCHAR(80) NOT NULL,
  "observacao" VARCHAR(1000) NOT NULL DEFAULT '',
  "versao" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "movimentacoes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "movimentacoes_versao_check" CHECK ("versao" >= 1),
  CONSTRAINT "movimentacoes_equipamentoId_fkey" FOREIGN KEY ("equipamentoId") REFERENCES "equipamentos"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "movimentacoes_equipamentoId_dataHora_idx" ON "movimentacoes"("equipamentoId", "dataHora");
CREATE INDEX "movimentacoes_dataHora_idx" ON "movimentacoes"("dataHora");

CREATE TABLE "usuarios" (
  "id" UUID NOT NULL,
  "login" VARCHAR(32) NOT NULL,
  "nome" VARCHAR(120) NOT NULL,
  "hashSenha" VARCHAR(255) NOT NULL,
  "salt" VARCHAR(128),
  "algoritmoHash" VARCHAR(20) NOT NULL DEFAULT 'BCRYPT',
  "papel" "PapelUsuario" NOT NULL,
  "ativo" BOOLEAN NOT NULL DEFAULT TRUE,
  "ultimoAcesso" TIMESTAMP(3),
  "versao" INTEGER NOT NULL DEFAULT 1,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "usuarios_versao_check" CHECK ("versao" >= 1)
);
CREATE UNIQUE INDEX "usuarios_login_key" ON "usuarios"("login");
CREATE INDEX "usuarios_papel_idx" ON "usuarios"("papel");
CREATE INDEX "usuarios_ativo_idx" ON "usuarios"("ativo");

CREATE TABLE "configuracoes_globais" (
  "id" VARCHAR(20) NOT NULL DEFAULT 'global',
  "aliquotaImposto" DECIMAL(5,4) NOT NULL DEFAULT 0,
  "coeficienteDepreciacaoPadrao" DECIMAL(5,4) NOT NULL DEFAULT 0.1,
  "coeficientesDepreciacao" JSONB NOT NULL DEFAULT '{}'::JSONB,
  "versao" INTEGER NOT NULL DEFAULT 1,
  "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "configuracoes_globais_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "configuracoes_aliquota_check" CHECK ("aliquotaImposto" >= 0 AND "aliquotaImposto" <= 1),
  CONSTRAINT "configuracoes_depreciacao_check" CHECK ("coeficienteDepreciacaoPadrao" >= 0 AND "coeficienteDepreciacaoPadrao" <= 1),
  CONSTRAINT "configuracoes_versao_check" CHECK ("versao" >= 1)
);

CREATE TABLE "auditorias" (
  "id" UUID NOT NULL,
  "usuarioId" UUID,
  "usuarioLogin" VARCHAR(32) NOT NULL,
  "acao" VARCHAR(80) NOT NULL,
  "entidade" VARCHAR(80) NOT NULL,
  "entidadeId" VARCHAR(80),
  "detalhes" JSONB,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "versao" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "auditorias_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "auditorias_versao_check" CHECK ("versao" >= 1)
);
CREATE INDEX "auditorias_usuarioId_idx" ON "auditorias"("usuarioId");
CREATE INDEX "auditorias_entidade_entidadeId_idx" ON "auditorias"("entidade", "entidadeId");
CREATE INDEX "auditorias_acao_idx" ON "auditorias"("acao");
CREATE INDEX "auditorias_criadoEm_idx" ON "auditorias"("criadoEm");
