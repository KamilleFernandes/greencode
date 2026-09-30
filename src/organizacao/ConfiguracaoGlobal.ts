import { TipoEquipamento } from "../equipamento/TipoEquipamento";

export class ConfiguracaoGlobal {
  private static aliquotaImposto = 0.0;

  private static coeficientesDepreciacao:
    Map<TipoEquipamento, number> = new Map();

  private static coeficienteDepreciacaoPadrao = 0.1;

  static definirAliquotaImposto(
    aliquota: number
  ): void {
    if (
      !Number.isFinite(aliquota) ||
      aliquota < 0 ||
      aliquota > 1
    ) {
      throw new Error(
        "Alíquota deve estar entre 0 e 1 (ex: 0.17 para 17%)."
      );
    }

    ConfiguracaoGlobal.aliquotaImposto =
      aliquota;
  }

  static obterAliquotaImposto(): number {
    return ConfiguracaoGlobal.aliquotaImposto;
  }

  static definirCoeficienteDepreciacao(
    tipo: TipoEquipamento,
    coeficienteAnual: number
  ): void {
    if (
      !Object.values(
        TipoEquipamento
      ).includes(tipo)
    ) {
      throw new Error(
        "Tipo de equipamento inválido."
      );
    }

    if (
      !Number.isFinite(
        coeficienteAnual
      ) ||
      coeficienteAnual < 0 ||
      coeficienteAnual > 1
    ) {
      throw new Error(
        "Coeficiente de depreciação deve estar entre 0 e 1."
      );
    }

    ConfiguracaoGlobal
      .coeficientesDepreciacao
      .set(
        tipo,
        coeficienteAnual
      );
  }

  static obterCoeficienteDepreciacao(
    tipo: TipoEquipamento
  ): number {
    return (
      ConfiguracaoGlobal
        .coeficientesDepreciacao
        .get(tipo) ??
      ConfiguracaoGlobal
        .coeficienteDepreciacaoPadrao
    );
  }

  static toJSON(): {
    aliquotaImposto: number;
    coeficientes:
      [TipoEquipamento, number][];
  } {
    return {
      aliquotaImposto:
        ConfiguracaoGlobal
          .aliquotaImposto,

      coeficientes:
        Array.from(
          ConfiguracaoGlobal
            .coeficientesDepreciacao
            .entries()
        )
    };
  }

  static carregarDeJSON(
    o: {
      aliquotaImposto?: number;
      coeficientes?:
        [TipoEquipamento, number][];
    } | null
  ): void {
    if (!o) {
      return;
    }

    ConfiguracaoGlobal
      .aliquotaImposto =
      o.aliquotaImposto ?? 0;

    ConfiguracaoGlobal
      .coeficientesDepreciacao =
      new Map(
        o.coeficientes ?? []
      );
  }
}