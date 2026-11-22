import type { PrismaClient } from "../generated/prisma/client.js";
import { resumir, arred } from "./estatistica.js";
export interface FiltroEficiencia { organizacaoId?:string; inicio?:Date; fim?:Date }
export async function analisarEficiencia(db:PrismaClient,filtro:FiltroEficiencia={}) {
 const where:any={triagemIniciadaEm:{not:null},triagemConcluidaEm:{not:null}};
 if(filtro.organizacaoId)where.organizacaoId=filtro.organizacaoId;
 if(filtro.inicio||filtro.fim)where.triagemConcluidaEm={...(filtro.inicio?{gte:filtro.inicio}:{}),...(filtro.fim?{lte:filtro.fim}:{})};
 const lotes=await db.lote.findMany({where,select:{id:true,codigo:true,dataEntrada:true,triagemIniciadaEm:true,triagemConcluidaEm:true,triagemIniciadaPor:true,triagemConcluidaPor:true,statusProcessamento:true,organizacaoId:true}});
 const linhas=lotes.flatMap(l=>l.triagemIniciadaEm&&l.triagemConcluidaEm?[{codigo:l.codigo,organizacaoId:l.organizacaoId,inicio:l.triagemIniciadaEm,fim:l.triagemConcluidaEm,minutos:Math.max(0,(l.triagemConcluidaEm.getTime()-l.triagemIniciadaEm.getTime())/60000),operador:l.triagemConcluidaPor??l.triagemIniciadaPor??"Não identificado",mes:`${l.triagemConcluidaEm.getFullYear()}-${String(l.triagemConcluidaEm.getMonth()+1).padStart(2,"0")}`}]:[]);
 const agrupar=(key:(x:typeof linhas[number])=>string)=>{const m=new Map<string,number[]>();for(const x of linhas){const k=key(x);m.set(k,[...(m.get(k)??[]),x.minutos]);}return [...m].map(([grupo,vals])=>({grupo,quantidade:vals.length,tempoMedioMinutos:resumir(vals)?.media??0,tempoMedianoMinutos:resumir(vals)?.mediana??0})).sort((a,b)=>b.tempoMedioMinutos-a.tempoMedioMinutos);};
 const incompletos=await db.lote.count({where:{...(filtro.organizacaoId?{organizacaoId:filtro.organizacaoId}:{}),statusProcessamento:"EM_TRIAGEM"}});
 const valores=linhas.map(x=>x.minutos);const resumo=resumir(valores);
 return {versaoModelo:"oper-1.0",quantidadeLotesConcluidos:linhas.length,quantidadeEmTriagem:incompletos,tempoMedioMinutos:resumo?.media??null,tempoMedianoMinutos:resumo?.mediana??null,dispersaoMinutos:resumo?.desvioPadrao??null,porOperador:agrupar(x=>x.operador),porMes:agrupar(x=>x.mes),maioresTempos:linhas.sort((a,b)=>b.minutos-a.minutos).slice(0,10).map(x=>({...x,minutos:arred(x.minutos)})),amostraInsuficiente:linhas.length<5};
}
