-- =====================================================================
-- 1) Journal no formato da AV1 (JournalTransacao) + metadados da requisição
-- =====================================================================
ALTER TABLE "auditorias" RENAME COLUMN "criadoEm" TO "timestamp";
ALTER TABLE "auditorias" RENAME COLUMN "acao" TO "operacao";
ALTER TABLE "auditorias" RENAME COLUMN "detalhes" TO "dadosDepois";
ALTER TABLE "auditorias" RENAME COLUMN "usuarioLogin" TO "usuarioResponsavel";
ALTER TABLE "auditorias" ADD COLUMN "dadosAntes" JSONB;
ALTER TABLE "auditorias" ADD COLUMN "requisicaoId" VARCHAR(64);
ALTER TABLE "auditorias" ADD COLUMN "metodo" VARCHAR(10);
ALTER TABLE "auditorias" ADD COLUMN "rota" VARCHAR(200);
ALTER TABLE "auditorias" ADD COLUMN "ip" VARCHAR(64);
ALTER TABLE "auditorias" ADD COLUMN "statusHttp" INTEGER;
ALTER INDEX "auditorias_acao_idx" RENAME TO "auditorias_operacao_idx";
ALTER INDEX "auditorias_criadoEm_idx" RENAME TO "auditorias_timestamp_idx";

-- Destino da rotação (mesma estrutura + data de arquivamento)
CREATE TABLE "auditorias_arquivadas" (
  "id" UUID NOT NULL,
  "timestamp" TIMESTAMP(3) NOT NULL,
  "operacao" VARCHAR(80) NOT NULL,
  "entidade" VARCHAR(80) NOT NULL,
  "entidadeId" VARCHAR(80),
  "dadosAntes" JSONB,
  "dadosDepois" JSONB,
  "usuarioResponsavel" VARCHAR(32) NOT NULL,
  "usuarioId" UUID,
  "requisicaoId" VARCHAR(64),
  "metodo" VARCHAR(10),
  "rota" VARCHAR(200),
  "ip" VARCHAR(64),
  "statusHttp" INTEGER,
  "versao" INTEGER NOT NULL DEFAULT 1,
  "arquivadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "auditorias_arquivadas_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "auditorias_arquivadas_timestamp_idx" ON "auditorias_arquivadas"("timestamp");
CREATE INDEX "auditorias_arquivadas_entidade_entidadeId_idx" ON "auditorias_arquivadas"("entidade", "entidadeId");

-- =====================================================================
-- 2) Simplificações e integridade do modelo
-- =====================================================================
UPDATE "organizacoes" SET "inscricaoEstadual" = 'ISENTO' WHERE "inscricaoEstadual" IS NULL;
ALTER TABLE "organizacoes" ALTER COLUMN "inscricaoEstadual" SET NOT NULL;

ALTER TABLE "usuarios" DROP COLUMN "salt";
ALTER TABLE "usuarios" DROP COLUMN "algoritmoHash";

-- A rastreabilidade nunca pode ser apagada em cascata
ALTER TABLE "movimentacoes" DROP CONSTRAINT "movimentacoes_equipamentoId_fkey";
ALTER TABLE "movimentacoes" ADD CONSTRAINT "movimentacoes_equipamentoId_fkey"
  FOREIGN KEY ("equipamentoId") REFERENCES "equipamentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "organizacoes" ADD CONSTRAINT "organizacoes_cnpj_check" CHECK ("cnpj" ~ '^[0-9]{14}$');
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_login_check" CHECK ("login" ~ '^[a-z0-9._-]{3,32}$');

-- =====================================================================
-- 3) Triggers (regras que dependem de outras linhas ou de estado anterior)
-- =====================================================================

-- (a) Movimentação e journal são somente de inclusão. O expurgo/rotação do journal passa pela
--     função de manutenção, que liga a variável de sessão greencode.manutencao dentro da transação.
CREATE OR REPLACE FUNCTION fn_somente_inclusao() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND TG_TABLE_NAME IN ('auditorias', 'auditorias_arquivadas')
     AND COALESCE(current_setting('greencode.manutencao', true), '') = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'A tabela % é somente de inclusão (%).', TG_TABLE_NAME, TG_OP USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "tg_movimentacoes_somente_inclusao" BEFORE UPDATE OR DELETE ON "movimentacoes"
  FOR EACH ROW EXECUTE FUNCTION fn_somente_inclusao();
CREATE TRIGGER "tg_auditorias_somente_inclusao" BEFORE UPDATE OR DELETE ON "auditorias"
  FOR EACH ROW EXECUTE FUNCTION fn_somente_inclusao();
CREATE TRIGGER "tg_auditorias_arquivadas_somente_inclusao" BEFORE UPDATE OR DELETE ON "auditorias_arquivadas"
  FOR EACH ROW EXECUTE FUNCTION fn_somente_inclusao();

-- (b) Máquina de estados do rastreamento (o desmonte só é alcançável depois da triagem)
CREATE OR REPLACE FUNCTION fn_equipamento_transicao() RETURNS trigger AS $$
BEGIN
  IF NEW."statusRastreamento" IS DISTINCT FROM OLD."statusRastreamento" THEN
    IF NOT (
      (OLD."statusRastreamento" = 'AGUARDANDO_TRIAGEM'  AND NEW."statusRastreamento" = 'EM_TRIAGEM') OR
      (OLD."statusRastreamento" = 'EM_TRIAGEM'          AND NEW."statusRastreamento" IN ('AGUARDANDO_DESMONTE', 'DESCARTE_SEGURO')) OR
      (OLD."statusRastreamento" = 'AGUARDANDO_DESMONTE' AND NEW."statusRastreamento" = 'EM_DESMONTE') OR
      (OLD."statusRastreamento" = 'EM_DESMONTE'         AND NEW."statusRastreamento" IN ('PECAS_REAPROVEITADAS', 'MATERIAL_RECICLAVEL', 'DESCARTE_SEGURO')) OR
      (OLD."statusRastreamento" IN ('PECAS_REAPROVEITADAS', 'MATERIAL_RECICLAVEL', 'DESCARTE_SEGURO') AND NEW."statusRastreamento" = 'BAIXA_DEFINITIVA')
    ) THEN
      RAISE EXCEPTION 'Transição de status inválida: % -> %.', OLD."statusRastreamento", NEW."statusRastreamento" USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "tg_equipamentos_transicao" BEFORE UPDATE OF "statusRastreamento" ON "equipamentos"
  FOR EACH ROW EXECUTE FUNCTION fn_equipamento_transicao();

-- (c) Cardinalidade Lote 1..* Equipamento: um lote só sai de RECEBIDO se tiver equipamentos
CREATE OR REPLACE FUNCTION fn_lote_exige_equipamento() RETURNS trigger AS $$
BEGIN
  IF NEW."statusProcessamento" <> 'RECEBIDO'
     AND NOT EXISTS (SELECT 1 FROM "equipamentos" WHERE "loteId" = NEW."id") THEN
    RAISE EXCEPTION 'Lote sem equipamentos não pode avançar de RECEBIDO.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "tg_lotes_exige_equipamento" BEFORE UPDATE OF "statusProcessamento" ON "lotes"
  FOR EACH ROW WHEN (NEW."statusProcessamento" IS DISTINCT FROM OLD."statusProcessamento")
  EXECUTE FUNCTION fn_lote_exige_equipamento();

-- (d) A organização de um lote nunca muda
CREATE OR REPLACE FUNCTION fn_lote_organizacao_imutavel() RETURNS trigger AS $$
BEGIN
  IF NEW."organizacaoId" IS DISTINCT FROM OLD."organizacaoId" THEN
    RAISE EXCEPTION 'A organização de um lote não pode ser alterada.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "tg_lotes_organizacao_imutavel" BEFORE UPDATE OF "organizacaoId" ON "lotes"
  FOR EACH ROW EXECUTE FUNCTION fn_lote_organizacao_imutavel();

-- =====================================================================
-- 4) Manutenção do journal: rotação (> limite de bytes) e retenção (>= N dias)
-- =====================================================================
CREATE OR REPLACE FUNCTION fn_auditoria_manutencao(p_retencao_dias integer, p_limite_bytes bigint)
RETURNS TABLE (rotacionados integer, expurgados integer, tamanho_antes bigint) AS $$
DECLARE
  v_rot integer := 0;
  v_exp integer := 0;
  v_exp2 integer := 0;
  v_tam bigint;
BEGIN
  PERFORM set_config('greencode.manutencao', 'on', true);
  v_tam := pg_total_relation_size('auditorias');
  IF v_tam > p_limite_bytes THEN
    INSERT INTO "auditorias_arquivadas"
      ("id","timestamp","operacao","entidade","entidadeId","dadosAntes","dadosDepois","usuarioResponsavel","usuarioId","requisicaoId","metodo","rota","ip","statusHttp","versao")
    SELECT "id","timestamp","operacao","entidade","entidadeId","dadosAntes","dadosDepois","usuarioResponsavel","usuarioId","requisicaoId","metodo","rota","ip","statusHttp","versao"
    FROM "auditorias";
    GET DIAGNOSTICS v_rot = ROW_COUNT;
    DELETE FROM "auditorias";
  END IF;
  DELETE FROM "auditorias" WHERE "timestamp" < now() - make_interval(days => p_retencao_dias);
  GET DIAGNOSTICS v_exp = ROW_COUNT;
  DELETE FROM "auditorias_arquivadas" WHERE "timestamp" < now() - make_interval(days => p_retencao_dias);
  GET DIAGNOSTICS v_exp2 = ROW_COUNT;
  PERFORM set_config('greencode.manutencao', 'off', true);
  RETURN QUERY SELECT v_rot, v_exp + v_exp2, v_tam;
END;
$$ LANGUAGE plpgsql;
