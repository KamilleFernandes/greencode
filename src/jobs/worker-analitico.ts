import { randomUUID } from "node:crypto";
import { OrigemAnalise, type PrismaClient } from "../generated/prisma/client.js";
import { executarVidaUtil, executarEficiencia, executarRentabilidade } from "../services/analytics.service.js";
import { calcularAtrasoRetry } from "../utils/backoff.js";

/** Worker PostgreSQL: reivindicação atômica com SKIP LOCKED permite múltiplas instâncias. */
export function iniciarWorkerAnalitico(db:PrismaClient,log:{info:(o:object,m?:string)=>void;error:(o:object,m?:string)=>void}){
 const trabalhador=`worker-${randomUUID().slice(0,8)}`;let ocupado=false;
 const processar=async()=>{if(ocupado)return;ocupado=true;try{
  const tarefas=await db.$queryRaw<Array<{id:string;tipo:string;organizacaoId:string|null;solicitadaPor:string;tentativas:number;maxTentativas:number}>>`
   WITH candidata AS (SELECT "id" FROM "tarefas_assincronas" WHERE (("status"='PENDENTE' AND "proximaTentativaEm"<=NOW()) OR ("status"='EM_EXECUCAO' AND "bloqueadaAte"<NOW())) ORDER BY "criadaEm" LIMIT 1 FOR UPDATE SKIP LOCKED)
   UPDATE "tarefas_assincronas" t SET "status"='EM_EXECUCAO',"iniciadaEm"=NOW(),"bloqueadaAte"=NOW()+INTERVAL '30 minutes',"trabalhador"=${trabalhador},"tentativas"=t."tentativas"+1,"versao"=t."versao"+1 FROM candidata c WHERE t."id"=c."id" RETURNING t."id",t."tipo"::text AS "tipo",t."organizacaoId",t."solicitadaPor",t."tentativas",t."maxTentativas"`;
  const task=tarefas[0];if(!task)return;
  try{const organizacao=task.organizacaoId??undefined;const origem=task.tipo==="ANALISE_AGENDADA"?OrigemAnalise.AGENDADA:OrigemAnalise.TAREFA;const resultado=task.tipo==="ANALISE_AGENDADA"?{eficiencia:await executarEficiencia(db,task.solicitadaPor,organizacao,origem),rentabilidade:await executarRentabilidade(db,task.solicitadaPor,organizacao,origem),vidaUtil:await executarVidaUtil(db,task.solicitadaPor,organizacao,origem)}:await executarVidaUtil(db,task.solicitadaPor,organizacao,origem);await db.tarefaAssincrona.update({where:{id:task.id},data:{status:"CONCLUIDA",resultado:JSON.parse(JSON.stringify(resultado)),concluidaEm:new Date(),bloqueadaAte:null,trabalhador:null,ultimoErro:null}});log.info({taskId:task.id},"Relatório preditivo concluído");}
  catch(err){const mensagem=String(err instanceof Error?err.message:err).slice(0,1000);const falhou=task.tentativas>=task.maxTentativas;const atraso=calcularAtrasoRetry(task.tentativas,{baseMs:2000,tetoMs:300000,jitter:.2});await db.tarefaAssincrona.update({where:{id:task.id},data:{status:falhou?"FALHA":"PENDENTE",ultimoErro:mensagem,proximaTentativaEm:new Date(Date.now()+atraso),bloqueadaAte:null,trabalhador:null}});log.error({taskId:task.id,tentativa:task.tentativas,proximaTentativaMs:falhou?null:atraso,err},"Falha ao processar relatório analítico");}
 }catch(err){log.error({err},"Falha no ciclo do worker analítico");}finally{ocupado=false;}};
 const timer=setInterval(()=>void processar(),1000);timer.unref();void processar();return()=>clearInterval(timer);
}
