import test from 'node:test';
import assert from 'node:assert/strict';
import { resumir, regressaoLinear, prever, xParaY } from '../src/analytics/estatistica.ts';
import { paraCsv, escaparCelula } from '../src/analytics/csv.ts';
import { calcularAtrasoRetry } from '../src/utils/backoff.ts';
import { preverVidaUtilPorTipo, vidaUtilRemanescente } from '../src/analytics/vida-util.ts';
import { analisarRentabilidade } from '../src/analytics/rentabilidade.ts';

test('estatística descritiva calcula média, mediana e quartis',()=>{const r=resumir([1,2,3,4,5]);assert.equal(r.n,5);assert.equal(r.media,3);assert.equal(r.mediana,3);assert.equal(r.p25,2);assert.equal(r.p75,4);});
test('estatística descritiva ignora valores não finitos e retorna null para vazio',()=>{assert.equal(resumir([NaN,Infinity]),null);assert.equal(resumir([1,2,Infinity]).n,2);});
test('OLS recupera reta conhecida, R² e inversa',()=>{const m=regressaoLinear([[0,1],[1,3],[2,5],[3,7]]);assert.ok(m);assert.equal(m.inclinacao,2);assert.equal(m.intercepto,1);assert.equal(m.r2,1);assert.equal(prever(m,4),9);assert.equal(xParaY(m,9),4);});
test('OLS retorna null quando x não varia',()=>assert.equal(regressaoLinear([[2,1],[2,3]]),null));
test('CSV protege células de fórmula e escapa separadores/aspas',()=>{assert.equal(escaparCelula('=1+1',','),"'=1+1");assert.equal(escaparCelula('a,b',','),'"a,b"');assert.match(paraCsv([{nome:'João',valor:'=2+2'}],['nome','valor'],'virgula'),/^\uFEFF/);});
test('backoff exponencial aplica teto e jitter determinístico',()=>{assert.equal(calcularAtrasoRetry(3,{baseMs:100,tetoMs:500,jitter:0},()=>.5),400);assert.equal(calcularAtrasoRetry(8,{baseMs:100,tetoMs:500,jitter:0},()=>.5),500);});

test('previsão de vida útil classifica amostra e projeta idade do estado inservível',()=>{
 const estados=['NOVO','BOM_ESTADO','USADO_LEVE','USADO_MODERADO','DANIFICADO_LEVE','DANIFICADO_GRAVE','INSERVIVEL'];
 const itens=Array.from({length:12},(_,i)=>({tipo:'NOTEBOOK',anoFabricacao:new Date().getFullYear()-i,estadoFisico:estados[Math.min(6,Math.floor(i*.6))]}));
 const p=preverVidaUtilPorTipo(itens).find(x=>x.tipo==='NOTEBOOK');assert.ok(p);assert.equal(p.amostra,12);assert.ok(p.inclinacao>0);assert.ok(p.idadeInservivelProjetada>0);assert.ok(['ALTA','MEDIA','BAIXA'].includes(p.confianca));
 assert.ok(vidaUtilRemanescente({anoFabricacao:new Date().getFullYear()-2,estadoFisico:'USADO_LEVE'},p)>=0);
});
test('rentabilidade agrupa valores por tipo, estado, marca e modelo com aviso de estimativa',()=>{
 const equipamento={tipo:'NOTEBOOK',marca:'Marca A',modelo:'Modelo 1',estadoFisico:'BOM_ESTADO',pesoQuilogramas:2,anoFabricacao:new Date().getFullYear()-1,statusRastreamento:'PECAS_REAPROVEITADAS'};
 const r=analisarRentabilidade([equipamento],{fatoresEstadoFisico:{BOM_ESTADO:.85},valoresReferencia:{NOTEBOOK:{valorReferencia:1200,valorSucataPorKg:6}},suavizacaoBayesiana:5});
 assert.equal(r.quantidade,1);assert.ok(r.valorTotalEstimado>0);assert.equal(r.porTipo[0].grupo,'NOTEBOOK');assert.match(r.aviso,/estimados/);
});
