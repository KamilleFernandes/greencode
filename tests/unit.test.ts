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
