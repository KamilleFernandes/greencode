import { EstadoFisico, TipoEquipamento } from "../generated/prisma/client.js";
import { arred, resumir } from "./estatistica.js";
export interface ParametrosRentabilidade { fatoresEstadoFisico:Record<string,number>; valoresReferencia:Record<string,{valorReferencia:number;valorSucataPorKg:number}>; suavizacaoBayesiana:number }
export interface EquipamentoValoravel { tipo:TipoEquipamento; marca:string; modelo:string; estadoFisico:EstadoFisico; pesoQuilogramas:number|string|{toString():string}; anoFabricacao:number; statusRastreamento?:string }
const BENEFICIO:Record<string,number>={PECAS_REAPROVEITADAS:1,MATERIAL_RECICLAVEL:.5,DESCARTE_SEGURO:0,BAIXA_DEFINITIVA:0};
const limitar=(v:number,min=.5,max=1.5)=>Math.max(min,Math.min(max,v));
/** Ajuste empírico com encolhimento bayesiano: grupos pequenos aproximam-se da média global. */
function construirFatoresEmpiricos(itens:EquipamentoValoravel[],suavizacao:number){
 const observados=itens.filter(e=>e.statusRastreamento&&Object.hasOwn(BENEFICIO,e.statusRastreamento));
 const mediaGlobal=observados.length?observados.reduce((s,e)=>s+BENEFICIO[e.statusRastreamento!],0)/observados.length:.5;
 const fatorGlobal=mediaGlobal>0?mediaGlobal:1;
 const porGrupo=(chave:(e:EquipamentoValoravel)=>string)=>{const grupos=new Map<string,number[]>();for(const e of observados){const k=chave(e);grupos.set(k,[...(grupos.get(k)??[]),BENEFICIO[e.statusRastreamento!]]);}return new Map([...grupos].map(([k,v])=>{const media=(v.reduce((s,n)=>s+n,0)+Math.max(0,suavizacao)*mediaGlobal)/(v.length+Math.max(0,suavizacao));return [k,limitar(media/fatorGlobal)] as const;}));};
 return {global:1,marca:porGrupo(e=>e.marca.trim().toLocaleUpperCase()),modelo:porGrupo(e=>`${e.marca.trim().toLocaleUpperCase()}|${e.modelo.trim().toLocaleUpperCase()}`),amostra:observados.length};
}
export function analisarRentabilidade(equipamentos:EquipamentoValoravel[],p:ParametrosRentabilidade){
 const fatores=construirFatoresEmpiricos(equipamentos,p.suavizacaoBayesiana);
 const base=equipamentos.map(e=>{const cfg=p.valoresReferencia[e.tipo];const peso=Number(e.pesoQuilogramas);const fatorEstado=p.fatoresEstadoFisico[e.estadoFisico]??0;const idade=Math.max(0,new Date().getFullYear()-e.anoFabricacao);const depreciacao=Math.min(.95,idade*.1);const valorUsado=(cfg?.valorReferencia??0)*fatorEstado*(1-depreciacao);const sucata=peso*(cfg?.valorSucataPorKg??0);const valorBase=Math.max(valorUsado,sucata);const fatorMarca=fatores.marca.get(e.marca.trim().toLocaleUpperCase())??1;const fatorModelo=fatores.modelo.get(`${e.marca.trim().toLocaleUpperCase()}|${e.modelo.trim().toLocaleUpperCase()}`)??1;const valor=valorBase*limitar(fatorMarca*fatorModelo);return {...e,peso,valorEstimado:arred(valor),valorUsado:arred(valorUsado),sucata:arred(sucata),fatorEmpirico:arred(limitar(fatorMarca*fatorModelo),4),destinoEconomico:valorUsado>=sucata?"REUTILIZACAO":"RECICLAGEM",beneficio:BENEFICIO[e.statusRastreamento??""]??null};});
 const agrupar=(chave:(e:typeof base[number])=>string)=>{const m=new Map<string,typeof base>();for(const e of base){const k=chave(e);m.set(k,[...(m.get(k)??[]),e]);}return [...m].map(([grupo,itens])=>({grupo,quantidade:itens.length,valorMedio:arred(itens.reduce((s,e)=>s+e.valorEstimado,0)/itens.length),valorTotal:arred(itens.reduce((s,e)=>s+e.valorEstimado,0)),pesoMedioKg:arred(itens.reduce((s,e)=>s+e.peso,0)/itens.length)})).sort((a,b)=>b.valorMedio-a.valorMedio);};
 const valores=base.map(e=>e.valorEstimado);return {versaoModelo:"param-1.0",aviso:"Valores estimados para demonstração, não são cotações de mercado nem lucro líquido. Ajuste os parâmetros com dados reais.",quantidade:base.length,valorTotalEstimado:arred(valores.reduce((s,v)=>s+v,0)),resumo:resumir(valores),amostraHistorica:fatores.amostra,porTipo:agrupar(e=>e.tipo),porEstadoFisico:agrupar(e=>e.estadoFisico),porMarca:agrupar(e=>e.marca),porModelo:agrupar(e=>`${e.marca} / ${e.modelo}`),equipamentos:base};
}
