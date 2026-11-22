import { TipoEquipamento, EstadoFisico } from "../generated/prisma/client.js";
import { ORDEM_ESTADOS_FISICOS } from "../utils/estados.js";
import { arred, regressaoLinear, prever, xParaY } from "./estatistica.js";

export type Confianca = "ALTA"|"MEDIA"|"BAIXA"|"INSUFICIENTE";
export interface PrevisaoVidaUtil { tipo: TipoEquipamento; amostra:number; intercepto:number|null; inclinacao:number|null; r2:number|null; erroResidual:number|null; idadeInservivelProjetada:number|null; vidaUtilContabilAnos:number|null; confianca:Confianca; motivo:string|null; anoReferencia:number }
const ESCALA: readonly EstadoFisico[] = ORDEM_ESTADOS_FISICOS;
export const LIMIAR_INSERVIVEL=ESCALA.indexOf(EstadoFisico.INSERVIVEL);
export const escoreDeEstado=(estado:EstadoFisico)=>ESCALA.indexOf(estado);
export function preverVidaUtilPorTipo(equipamentos:Array<{tipo:TipoEquipamento;estadoFisico:EstadoFisico;anoFabricacao:number}>,anoReferencia=new Date().getFullYear(),amostraMinima=8):PrevisaoVidaUtil[] {
 return (Object.values(TipoEquipamento) as TipoEquipamento[]).map(tipo=>{
  const itens=equipamentos.filter(e=>e.tipo===tipo&&Number.isInteger(e.anoFabricacao)&&e.anoFabricacao<=anoReferencia&&escoreDeEstado(e.estadoFisico)>=0);
  const pontos=itens.map(e=>[anoReferencia-e.anoFabricacao,escoreDeEstado(e.estadoFisico)] as [number,number]);
  const modelo=regressaoLinear(pontos), idades=new Set(pontos.map(p=>p[0])).size;
  const projetada=modelo&&modelo.inclinacao>0?xParaY(modelo,LIMIAR_INSERVIVEL):null;
  let confianca:Confianca="INSUFICIENTE",motivo:string|null="Amostra ou variação temporal insuficiente para regressão confiável.";
  if(modelo&&itens.length>=amostraMinima&&idades>=3&&projetada!==null&&projetada>0&&projetada<=60){
   confianca=itens.length>=30&&modelo.r2>=.6?"ALTA":itens.length>=15&&modelo.r2>=.35?"MEDIA":"BAIXA"; motivo=null;
  }
  const coef= modelo?.inclinacao && modelo.inclinacao>0 ? modelo.inclinacao : null;
  const vidaContabil=coef?arred(LIMIAR_INSERVIVEL/coef,2):null;
  return {tipo,amostra:itens.length,intercepto:modelo?arred(modelo.intercepto,6):null,inclinacao:modelo?arred(modelo.inclinacao,6):null,r2:modelo?arred(modelo.r2,6):null,erroResidual:modelo?arred(modelo.erroResidual,6):null,idadeInservivelProjetada:projetada===null?null:arred(projetada,3),vidaUtilContabilAnos:vidaContabil,confianca,motivo,anoReferencia};
 });
}
export function vidaUtilRemanescente(e:{anoFabricacao:number;estadoFisico:EstadoFisico},p:PrevisaoVidaUtil,ano=new Date().getFullYear()):number|null {
 const idade=Math.max(0,ano-e.anoFabricacao), score=escoreDeEstado(e.estadoFisico);
 if(p.inclinacao!==null&&p.inclinacao>0&&p.intercepto!==null){const x=xParaY({intercepto:p.intercepto,inclinacao:p.inclinacao},LIMIAR_INSERVIVEL);return x===null?null:arred(Math.max(0,x-idade),2);}
 return p.vidaUtilContabilAnos===null?null:arred(Math.max(0,p.vidaUtilContabilAnos-idade),2);
}
