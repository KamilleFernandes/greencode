import type { PrismaClient } from "../generated/prisma/client.js";
/** Enfileira uma análise completa diária; chave de deduplicação impede duplicidade no mesmo dia. */
export function iniciarAgendamentoAnalitico(db:PrismaClient,log:{info:(o:object,m?:string)=>void;error:(o:object,m?:string)=>void}){
 const agendar=async()=>{const dia=new Date().toISOString().slice(0,10);try{await db.tarefaAssincrona.createMany({data:[{tipo:"ANALISE_AGENDADA",status:"PENDENTE",parametros:{origem:"agendamento_diario"},solicitadaPor:"SISTEMA",chaveDedupe:`analise-diaria-${dia}`}],skipDuplicates:true});}catch(err){log.error({err},"Não foi possível agendar análise diária");}};
 const agora=new Date();const proxima=new Date(agora);proxima.setUTCHours(2,0,0,0);if(proxima<=agora)proxima.setUTCDate(proxima.getUTCDate()+1);const primeiro=setTimeout(()=>{void agendar();},proxima.getTime()-agora.getTime());primeiro.unref();const timer=setInterval(()=>void agendar(),24*60*60*1000);timer.unref();return()=>{clearTimeout(primeiro);clearInterval(timer);};
}
