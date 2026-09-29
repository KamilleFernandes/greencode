import { TipoEquipamento } from "../equipamento/TipoEquipamento";

export class ConfiguracaoGlobal {
  private static aliquotaImposto = 0.0;
  private static coeficientesDepreciacao: Map<TipoEquipamento, number> = new Map();
  private static coeficienteDepreciacaoPadrao = 0.1; 

  static definirAliquotaImposto(aliquota: number): void {
    if (aliquota < 0 || aliquota > 1) {
      throw new Error("Alíquota deve estar entre 0 e 1 (ex: 0.17 para 17%).");
    }
    ConfiguracaoGlobal.aliquotaImposto = aliquota;
  }

  static obterAliquotaImposto(): number {
    return ConfiguracaoGlobal.aliquotaImposto;
  }

  static definirCoeficienteDepreciacao(tipo: TipoEquipamento, coeficienteAnual: number): void {
    ConfiguracaoGlobal.coeficientesDepreciacao.set(tipo, coeficienteAnual);
  }

  static obterCoeficienteDepreciacao(tipo: TipoEquipamento): number {
    return ConfiguracaoGlobal.coeficientesDepreciacao.get(tipo) ?? ConfiguracaoGlobal.coeficienteDepreciacaoPadrao;
  }
}