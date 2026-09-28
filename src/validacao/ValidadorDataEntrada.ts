import { Validador } from "./Validador";

const LIMITE_DIAS_PASSADO = 90;

export class ValidadorDataEntrada extends Validador {
  validar(data: Date): boolean {
  const dataComparar = new Date(data);
  if (isNaN(dataComparar.getTime())) {
    this.mensagemErro = "Data de entrada inválida.";
    return false;
  }
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  dataComparar.setHours(0, 0, 0, 0);

  if (dataComparar > hoje) {
    this.mensagemErro = "Data de entrada não pode ser futura.";
    return false;
  }
  const diffDias = Math.round((hoje.getTime() - dataComparar.getTime()) / 86_400_000);
  if (diffDias > LIMITE_DIAS_PASSADO) {
    this.mensagemErro = `Data de entrada não pode ser mais de ${LIMITE_DIAS_PASSADO} dias no passado.`;
    return false;
  }
  this.mensagemErro = "";
  return true;
}
}