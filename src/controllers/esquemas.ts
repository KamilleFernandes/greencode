import { EstadoFisico, TipoEquipamento } from "../generated/prisma/client.js";

export const idParam = { type: "object", required: ["id"], properties: { id: { type: "string", description: "UUID ou código legível (ex.: BR001, LT00001, EQ000001)" } } } as const;
export const PAPEIS = ["ADMINISTRADOR", "OPERADOR_CADASTRO", "GESTOR_ALMOXARIFADO", "AUDITOR"] as const;

export const equipamentoProps = {
  tipo: { type: "string", enum: Object.values(TipoEquipamento) },
  marca: { type: "string", minLength: 1, maxLength: 100 },
  modelo: { type: "string", minLength: 1, maxLength: 120 },
  anoFabricacao: { type: "integer", minimum: 1970 },
  estadoFisico: { type: "string", enum: Object.values(EstadoFisico) },
  pesoQuilogramas: { type: "number", exclusiveMinimum: 0, maximum: 99999 }
} as const;
export const equipamentoObrigatorios = ["tipo", "marca", "modelo", "anoFabricacao", "pesoQuilogramas"] as const;
