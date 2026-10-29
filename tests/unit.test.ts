import test from "node:test";
import assert from "node:assert/strict";
import { validarCnpj } from "../src/utils/cnpj.ts";
import { validarAnoPeso } from "../src/utils/estados.ts";
import { HttpError } from "../src/utils/http-error.ts";

test("valida CNPJ e rejeita dígitos incorretos", () => {
  assert.equal(validarCnpj("11.222.333/0001-81"), true);
  assert.equal(validarCnpj("11222333000180"), false);
  assert.equal(validarCnpj("11111111111111"), false);
});

test("valida peso positivo e ano razoável", () => {
  assert.deepEqual(validarAnoPeso(2020, 3.5), { anoFabricacao: 2020, pesoQuilogramas: 3.5 });
  assert.throws(() => validarAnoPeso(1960, 3.5), HttpError);
  assert.throws(() => validarAnoPeso(2020, 0), HttpError);
});

import { periodoLocal, periodoPorData, validarMudancaEstadoFisico, validarTransicao } from '../src/utils/estados.js';
import { EstadoFisico, StatusRastreamento } from '../src/generated/prisma/client.js';

test('máquina de estados: desmonte só depois da triagem e descarte direto exige justificativa', () => {
  assert.doesNotThrow(() => validarTransicao(StatusRastreamento.EM_TRIAGEM, StatusRastreamento.AGUARDANDO_DESMONTE));
  assert.throws(() => validarTransicao(StatusRastreamento.AGUARDANDO_TRIAGEM, StatusRastreamento.AGUARDANDO_DESMONTE), /triagem completa/);
  assert.throws(() => validarTransicao(StatusRastreamento.EM_TRIAGEM, StatusRastreamento.DESCARTE_SEGURO), /justificativa/);
  assert.doesNotThrow(() => validarTransicao(StatusRastreamento.EM_TRIAGEM, StatusRastreamento.DESCARTE_SEGURO, 'sem reaproveitamento'));
  assert.throws(() => validarTransicao(StatusRastreamento.BAIXA_DEFINITIVA, StatusRastreamento.EM_TRIAGEM));
});

test('estado físico: queda de 2+ categorias exige justificativa; melhora e queda de 1 não', () => {
  assert.throws(() => validarMudancaEstadoFisico(EstadoFisico.NOVO, EstadoFisico.USADO_LEVE), /Justificativa obrigatória/);
  assert.doesNotThrow(() => validarMudancaEstadoFisico(EstadoFisico.NOVO, EstadoFisico.USADO_LEVE, 'uso'));
  assert.doesNotThrow(() => validarMudancaEstadoFisico(EstadoFisico.NOVO, EstadoFisico.BOM_ESTADO));
  assert.doesNotThrow(() => validarMudancaEstadoFisico(EstadoFisico.DANIFICADO_GRAVE, EstadoFisico.NOVO));
  assert.throws(() => validarMudancaEstadoFisico(EstadoFisico.NOVO, EstadoFisico.NOVO), /já está/);
});

test('períodos são inclusivos e rejeitam datas inválidas ou invertidas', () => {
  const p = periodoPorData('2026-01-01', '2026-01-01');
  assert.equal(p.fim.getTime() - p.inicio.getTime(), 86_400_000 - 1);
  const l = periodoLocal('2026-03-10', '2026-03-10');
  assert.equal(l.inicio.getHours(), 0); assert.equal(l.fim.getHours(), 23); assert.equal(l.fim.getMinutes(), 59);
  assert.throws(() => periodoPorData('2026-02-01', '2026-01-01'));
  assert.throws(() => periodoLocal('2026-02-30', '2026-03-01'));
  assert.throws(() => periodoLocal('abc', '2026-03-01'));
});
