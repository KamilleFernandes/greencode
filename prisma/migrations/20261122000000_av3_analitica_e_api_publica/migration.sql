-- =====================================================================
-- AV3: camada analítica, API pública (chaves de API) e fila assíncrona
-- =====================================================================

CREATE TYPE "PermissaoApi" AS ENUM ('RASTREABILIDADE_LEITURA', 'LOTES_LEITURA', 'LOTES_ESCRITA', 'ANALISES_LEITURA');
CREATE TYPE "CategoriaAnalise" AS ENUM ('EFICIENCIA_OPERACIONAL', 'RENTABILIDADE', 'VIDA_UTIL');
CREATE TYPE "OrigemAnalise" AS ENUM ('API', 'AGENDADA', 'TAREFA');
CREATE TYPE "NivelConfianca" AS ENUM ('ALTA', 'MEDIA', 'BAIXA', 'INSUFICIENTE');
CREATE TYPE "TipoTarefa" AS ENUM ('RELATORIO_PREDITIVO', 'ANALISE_AGENDADA');
CREATE TYPE "StatusTarefa" AS ENUM ('PENDENTE', 'EM_EXECUCAO', 'CONCLUIDA', 'FALHA');

-- ---------------------------------------------------------------------
-- 1) Lote: marcos e operadores da triagem (base da análise de eficiência).
--    O journal é expurgado após 180 dias, por isso os tempos ficam no próprio lote.
-- ---------------------------------------------------------------------
ALTER TABLE "lotes" ADD COLUMN "triagemIniciadaEm" TIMESTAMP(3);
ALTER TABLE "lotes" ADD COLUMN "triagemConcluidaEm" TIMESTAMP(3);
ALTER TABLE "lotes" ADD COLUMN "triagemIniciadaPor" VARCHAR(32);
ALTER TABLE "lotes" ADD COLUMN "triagemConcluidaPor" VARCHAR(32);
CREATE INDEX "lotes_triagemConcluidaEm_idx" ON "lotes"("triagemConcluidaEm");

-- Backfill: reconstrói os marcos dos lotes já processados a partir do journal (vivo + arquivado).
-- Usa o primeiro evento de cada tipo por lote. Lotes sem evento (ex.: dados de seed) permanecem NULL.
UPDATE "lotes" l
SET "triagemIniciadaEm" = e."timestamp", "triagemIniciadaPor" = e."usuarioResponsavel"
FROM (
  SELECT DISTINCT ON ("entidadeId") "entidadeId", "timestamp", "usuarioResponsavel"
  FROM (
    SELECT "entidadeId", "timestamp", "usuarioResponsavel", "operacao", "entidade" FROM "auditorias"
    UNION ALL
    SELECT "entidadeId", "timestamp", "usuarioResponsavel", "operacao", "entidade" FROM "auditorias_arquivadas"
  ) a
  WHERE a."operacao" = 'INICIAR_TRIAGEM' AND a."entidade" = 'Lote' AND a."entidadeId" IS NOT NULL
  ORDER BY "entidadeId", "timestamp" ASC
) e
WHERE l."id"::text = e."entidadeId";

UPDATE "lotes" l
SET "triagemConcluidaEm" = e."timestamp", "triagemConcluidaPor" = e."usuarioResponsavel"
FROM (
  SELECT DISTINCT ON ("entidadeId") "entidadeId", "timestamp", "usuarioResponsavel"
  FROM (
    SELECT "entidadeId", "timestamp", "usuarioResponsavel", "operacao", "entidade" FROM "auditorias"
    UNION ALL
    SELECT "entidadeId", "timestamp", "usuarioResponsavel", "operacao", "entidade" FROM "auditorias_arquivadas"
  ) a
  WHERE a."operacao" = 'CONCLUIR_TRIAGEM' AND a."entidade" = 'Lote' AND a."entidadeId" IS NOT NULL
  ORDER BY "entidadeId", "timestamp" ASC
) e
WHERE l."id"::text = e."entidadeId";

-- Registros legados que possuem conclusão sem início (por exemplo, eventos incompletos no journal)
-- recebem início igual à conclusão: não inventa duração e preserva a consistência temporal.
UPDATE "lotes" SET "triagemIniciadaEm" = "triagemConcluidaEm", "triagemIniciadaPor" = COALESCE("triagemIniciadaPor", "triagemConcluidaPor")
WHERE "triagemConcluidaEm" IS NOT NULL AND "triagemIniciadaEm" IS NULL;
UPDATE "lotes" SET "triagemIniciadaEm" = "triagemConcluidaEm", "triagemIniciadaPor" = COALESCE("triagemConcluidaPor", "triagemIniciadaPor")
WHERE "triagemConcluidaEm" IS NOT NULL AND "triagemIniciadaEm" > "triagemConcluidaEm";

-- Coerência dos marcos: a conclusão nunca precede o início; concluir exige ter iniciado.
ALTER TABLE "lotes" ADD CONSTRAINT "lotes_triagem_marcos_check" CHECK (
  ("triagemConcluidaEm" IS NULL OR "triagemIniciadaEm" IS NOT NULL)
  AND ("triagemConcluidaEm" IS NULL OR "triagemIniciadaEm" IS NULL OR "triagemConcluidaEm" >= "triagemIniciadaEm")
);

-- ---------------------------------------------------------------------
-- 2) Chaves de API (parceiros externos)
-- ---------------------------------------------------------------------
CREATE TABLE "chaves_api" (
  "id" UUID NOT NULL,
  "prefixo" VARCHAR(8) NOT NULL,
  "hashSegredo" VARCHAR(64) NOT NULL,
  "nome" VARCHAR(120) NOT NULL,
  "organizacaoId" UUID NOT NULL,
  "permissoes" "PermissaoApi"[] NOT NULL DEFAULT ARRAY[]::"PermissaoApi"[],
  "limiteReqPorMinuto" INTEGER NOT NULL DEFAULT 60,
  "expiraEm" TIMESTAMP(3),
  "revogadaEm" TIMESTAMP(3),
  "motivoRevogacao" VARCHAR(300),
  "ultimoUsoEm" TIMESTAMP(3),
  "criadaPor" VARCHAR(32) NOT NULL,
  "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "versao" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "chaves_api_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "chaves_api_prefixo_check" CHECK ("prefixo" ~ '^[0-9a-f]{8}$'),
  CONSTRAINT "chaves_api_hash_check" CHECK ("hashSegredo" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "chaves_api_permissoes_check" CHECK (cardinality("permissoes") >= 1),
  CONSTRAINT "chaves_api_limite_check" CHECK ("limiteReqPorMinuto" BETWEEN 1 AND 6000),
  CONSTRAINT "chaves_api_versao_check" CHECK ("versao" >= 1),
  CONSTRAINT "chaves_api_organizacaoId_fkey" FOREIGN KEY ("organizacaoId") REFERENCES "organizacoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "chaves_api_prefixo_key" ON "chaves_api"("prefixo");
CREATE INDEX "chaves_api_organizacaoId_idx" ON "chaves_api"("organizacaoId");

-- ---------------------------------------------------------------------
-- 3) Parâmetros analíticos (linha única) - valores de demonstração, ajustáveis pelo ADMINISTRADOR
-- ---------------------------------------------------------------------
CREATE TABLE "configuracoes_analiticas" (
  "id" VARCHAR(20) NOT NULL DEFAULT 'global',
  "fatoresEstadoFisico" JSONB NOT NULL DEFAULT '{}'::JSONB,
  "valoresReferencia" JSONB NOT NULL DEFAULT '{}'::JSONB,
  "amostraMinimaRegressao" INTEGER NOT NULL DEFAULT 8,
  "suavizacaoBayesiana" INTEGER NOT NULL DEFAULT 5,
  "versao" INTEGER NOT NULL DEFAULT 1,
  "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "configuracoes_analiticas_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "configuracoes_analiticas_amostra_check" CHECK ("amostraMinimaRegressao" >= 3),
  CONSTRAINT "configuracoes_analiticas_suavizacao_check" CHECK ("suavizacaoBayesiana" >= 0),
  CONSTRAINT "configuracoes_analiticas_versao_check" CHECK ("versao" >= 1)
);

INSERT INTO "configuracoes_analiticas" ("id", "fatoresEstadoFisico", "valoresReferencia") VALUES (
  'global',
  '{"NOVO":1,"BOM_ESTADO":0.85,"USADO_LEVE":0.7,"USADO_MODERADO":0.5,"DANIFICADO_LEVE":0.3,"DANIFICADO_GRAVE":0.1,"INSERVIVEL":0}'::JSONB,
  '{"COMPUTADOR_MESA":{"valorReferencia":900,"valorSucataPorKg":4},"NOTEBOOK":{"valorReferencia":1200,"valorSucataPorKg":6},"MONITOR":{"valorReferencia":350,"valorSucataPorKg":2},"IMPRESSORA":{"valorReferencia":250,"valorSucataPorKg":2.5},"SERVIDOR":{"valorReferencia":2500,"valorSucataPorKg":5},"ROTEADOR":{"valorReferencia":150,"valorSucataPorKg":5.5},"CABO_ESTRUTURADO":{"valorReferencia":30,"valorSucataPorKg":9},"FONTE_ALIMENTACAO":{"valorReferencia":120,"valorSucataPorKg":4.5}}'::JSONB
);

-- ---------------------------------------------------------------------
-- 4) Histórico analítico (somente inclusão) e previsões de vida útil
-- ---------------------------------------------------------------------
CREATE TABLE "analise_execucoes" (
  "id" UUID NOT NULL,
  "categoria" "CategoriaAnalise" NOT NULL,
  "origem" "OrigemAnalise" NOT NULL,
  "parametros" JSONB NOT NULL DEFAULT '{}'::JSONB,
  "resultado" JSONB NOT NULL,
  "amostra" INTEGER NOT NULL,
  "versaoModelo" VARCHAR(20) NOT NULL,
  "duracaoMs" INTEGER NOT NULL,
  "organizacaoId" UUID,
  "geradoPor" VARCHAR(32) NOT NULL,
  "geradoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "analise_execucoes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "analise_execucoes_amostra_check" CHECK ("amostra" >= 0),
  CONSTRAINT "analise_execucoes_duracao_check" CHECK ("duracaoMs" >= 0)
);
CREATE INDEX "analise_execucoes_categoria_geradoEm_idx" ON "analise_execucoes"("categoria", "geradoEm");
CREATE INDEX "analise_execucoes_organizacaoId_idx" ON "analise_execucoes"("organizacaoId");

CREATE TABLE "previsoes_vida_util" (
  "id" UUID NOT NULL,
  "execucaoId" UUID NOT NULL,
  "tipo" "TipoEquipamento" NOT NULL,
  "anoReferencia" INTEGER NOT NULL,
  "amostra" INTEGER NOT NULL,
  "intercepto" DECIMAL(14,6),
  "inclinacao" DECIMAL(14,6),
  "r2" DECIMAL(8,6),
  "erroResidual" DECIMAL(14,6),
  "idadeInservivelProjetada" DECIMAL(8,3),
  "vidaUtilContabilAnos" DECIMAL(8,3),
  "confianca" "NivelConfianca" NOT NULL,
  "motivo" VARCHAR(200),
  "geradoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "previsoes_vida_util_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "previsoes_vida_util_r2_check" CHECK ("r2" IS NULL OR ("r2" >= 0 AND "r2" <= 1)),
  CONSTRAINT "previsoes_vida_util_amostra_check" CHECK ("amostra" >= 0),
  CONSTRAINT "previsoes_vida_util_execucaoId_fkey" FOREIGN KEY ("execucaoId") REFERENCES "analise_execucoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "previsoes_vida_util_execucaoId_tipo_key" ON "previsoes_vida_util"("execucaoId", "tipo");
CREATE INDEX "previsoes_vida_util_tipo_geradoEm_idx" ON "previsoes_vida_util"("tipo", "geradoEm");

-- O histórico não pode ser reescrito: reaproveita o gatilho "somente inclusão" da AV2.
CREATE TRIGGER "tg_analise_execucoes_somente_inclusao" BEFORE UPDATE OR DELETE ON "analise_execucoes"
  FOR EACH ROW EXECUTE FUNCTION fn_somente_inclusao();
CREATE TRIGGER "tg_previsoes_vida_util_somente_inclusao" BEFORE UPDATE OR DELETE ON "previsoes_vida_util"
  FOR EACH ROW EXECUTE FUNCTION fn_somente_inclusao();

-- ---------------------------------------------------------------------
-- 5) Fila de tarefas assíncronas (PostgreSQL, FOR UPDATE SKIP LOCKED)
-- ---------------------------------------------------------------------
CREATE TABLE "tarefas_assincronas" (
  "id" UUID NOT NULL,
  "tipo" "TipoTarefa" NOT NULL,
  "status" "StatusTarefa" NOT NULL DEFAULT 'PENDENTE',
  "parametros" JSONB NOT NULL DEFAULT '{}'::JSONB,
  "resultado" JSONB,
  "chaveDedupe" VARCHAR(120),
  "organizacaoId" UUID,
  "chaveApiId" UUID,
  "solicitadaPor" VARCHAR(32) NOT NULL,
  "tentativas" INTEGER NOT NULL DEFAULT 0,
  "maxTentativas" INTEGER NOT NULL DEFAULT 3,
  "proximaTentativaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "bloqueadaAte" TIMESTAMP(3),
  "trabalhador" VARCHAR(64),
  "ultimoErro" VARCHAR(1000),
  "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "iniciadaEm" TIMESTAMP(3),
  "concluidaEm" TIMESTAMP(3),
  "versao" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "tarefas_assincronas_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tarefas_assincronas_tentativas_check" CHECK ("tentativas" >= 0),
  CONSTRAINT "tarefas_assincronas_max_check" CHECK ("maxTentativas" >= 1 AND "maxTentativas" <= 20),
  CONSTRAINT "tarefas_assincronas_versao_check" CHECK ("versao" >= 1),
  CONSTRAINT "tarefas_assincronas_conclusao_check" CHECK ("status" <> 'CONCLUIDA' OR ("resultado" IS NOT NULL AND "concluidaEm" IS NOT NULL)),
  CONSTRAINT "tarefas_assincronas_chaveApiId_fkey" FOREIGN KEY ("chaveApiId") REFERENCES "chaves_api"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "tarefas_assincronas_chaveDedupe_key" ON "tarefas_assincronas"("chaveDedupe");
CREATE INDEX "tarefas_assincronas_status_proximaTentativaEm_idx" ON "tarefas_assincronas"("status", "proximaTentativaEm");
CREATE INDEX "tarefas_assincronas_organizacaoId_criadaEm_idx" ON "tarefas_assincronas"("organizacaoId", "criadaEm");
CREATE INDEX "tarefas_assincronas_chaveApiId_idx" ON "tarefas_assincronas"("chaveApiId");