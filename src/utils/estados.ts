import { EstadoFisico, StatusRastreamento } from "../generated/prisma/client.js";
import { HttpError } from "./http-error.js";

export const ORDEM_ESTADOS_FISICOS: EstadoFisico[] = [
  EstadoFisico.NOVO,
  EstadoFisico.BOM_ESTADO,
  EstadoFisico.USADO_LEVE,
  EstadoFisico.USADO_MODERADO,
  EstadoFisico.DANIFICADO_LEVE,
  EstadoFisico.DANIFICADO_GRAVE,
  EstadoFisico.INSERVIVEL
];

const TRANSICOES: Record<StatusRastreamento, StatusRastreamento[]> = {
  AGUARDANDO_TRIAGEM: [StatusRastreamento.EM_TRIAGEM],
  EM_TRIAGEM: [StatusRastreamento.AGUARDANDO_DESMONTE, StatusRastreamento.DESCARTE_SEGURO],
  AGUARDANDO_DESMONTE: [StatusRastreamento.EM_DESMONTE],
  EM_DESMONTE: [StatusRastreamento.PECAS_REAPROVEITADAS, StatusRastreamento.MATERIAL_RECICLAVEL, StatusRastreamento.DESCARTE_SEGURO],
  PECAS_REAPROVEITADAS: [StatusRastreamento.BAIXA_DEFINITIVA],
  MATERIAL_RECICLAVEL: [StatusRastreamento.BAIXA_DEFINITIVA],
  DESCARTE_SEGURO: [StatusRastreamento.BAIXA_DEFINITIVA],
  BAIXA_DEFINITIVA: []
};

export function validarTransicao(origem: StatusRastreamento, destino: StatusRastreamento, justificativa = ""): void {
  if (!TRANSICOES[origem]?.includes(destino)) {
    const paraDesmonte = destino === StatusRastreamento.AGUARDANDO_DESMONTE || destino === StatusRastreamento.EM_DESMONTE;
    throw new HttpError(409, paraDesmonte
      ? "Equipamento só pode ir para desmonte após a triagem completa."
      : `Transição de status inválida: ${origem} -> ${destino}.`);
  }
  if (destino === StatusRastreamento.DESCARTE_SEGURO && origem === StatusRastreamento.EM_TRIAGEM && !justificativa.trim()) {
    throw new HttpError(400, "Descarte direto logo após a triagem exige justificativa.");
  }
}

export function validarDataEntrada(valor: unknown): Date {
  const hojeLocal = new Date();
  const texto = String(valor ?? `${hojeLocal.getFullYear()}-${String(hojeLocal.getMonth() + 1).padStart(2, "0")}-${String(hojeLocal.getDate()).padStart(2, "0")}`);
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (!partes) throw new HttpError(400, "Data de entrada inválida; use AAAA-MM-DD.");
  const ano = Number(partes[1]); const mes = Number(partes[2]); const dia = Number(partes[3]);
  const local = new Date(ano, mes - 1, dia);
  if (local.getFullYear() !== ano || local.getMonth() !== mes - 1 || local.getDate() !== dia) throw new HttpError(400, "Data de entrada inválida.");
  const hojeInicio = new Date(hojeLocal.getFullYear(), hojeLocal.getMonth(), hojeLocal.getDate());
  const limiteInicio = new Date(hojeInicio); limiteInicio.setDate(limiteInicio.getDate() - 90);
  if (local > hojeInicio || local < limiteInicio) throw new HttpError(400, "A data de entrada deve estar entre hoje e 90 dias atrás.");
  return new Date(Date.UTC(ano, mes - 1, dia));
}

export function validarAnoPeso(ano: unknown, peso: unknown): { anoFabricacao: number; pesoQuilogramas: number } {
  const anoFabricacao = Number(ano);
  const pesoQuilogramas = Number(peso);
  if (!Number.isInteger(anoFabricacao) || anoFabricacao < 1970 || anoFabricacao > new Date().getFullYear()) {
    throw new HttpError(400, "Ano de fabricação inválido.");
  }
  if (!Number.isFinite(pesoQuilogramas) || pesoQuilogramas <= 0) throw new HttpError(400, "Peso deve ser maior que zero.");
  return { anoFabricacao, pesoQuilogramas };
}
