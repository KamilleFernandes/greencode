/** Núcleo estatístico puro: estatística descritiva e regressão linear OLS. */
export interface Resumo { n: number; media: number; mediana: number; desvioPadrao: number; minimo: number; maximo: number; p25: number; p75: number; p90: number }
export interface ModeloLinear { n: number; intercepto: number; inclinacao: number; r2: number; erroResidual: number; xMedio: number }
export const arred = (v: number, casas = 2): number => { const f = 10 ** casas; return Math.round((v + Number.EPSILON) * f) / f; };
const quantil = (a: number[], q: number) => { const s = [...a].sort((x,y)=>x-y); const pos=(s.length-1)*q; const lo=Math.floor(pos), hi=Math.ceil(pos); return s[lo] + (s[hi]-s[lo])*(pos-lo); };
export function resumir(valores: number[], casas = 2): Resumo | null {
 const a=valores.filter(Number.isFinite); if(!a.length)return null; const m=a.reduce((x,y)=>x+y,0)/a.length;
 const sd=a.length>1?Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1)):0;
 return {n:a.length,media:arred(m,casas),mediana:arred(quantil(a,.5),casas),desvioPadrao:arred(sd,casas),minimo:arred(Math.min(...a),casas),maximo:arred(Math.max(...a),casas),p25:arred(quantil(a,.25),casas),p75:arred(quantil(a,.75),casas),p90:arred(quantil(a,.9),casas)};
}
export function regressaoLinear(pontos:Array<[number,number]>):ModeloLinear|null {
 const p=pontos.filter(([x,y])=>Number.isFinite(x)&&Number.isFinite(y)); if(p.length<2)return null;
 const xm=p.reduce((s,[x])=>s+x,0)/p.length, ym=p.reduce((s,[,y])=>s+y,0)/p.length;
 const xx=p.reduce((s,[x])=>s+(x-xm)**2,0); if(xx===0)return null;
 const inclinacao=p.reduce((s,[x,y])=>s+(x-xm)*(y-ym),0)/xx, intercepto=ym-inclinacao*xm;
 const ssRes=p.reduce((s,[x,y])=>s+(y-(intercepto+inclinacao*x))**2,0), ssTot=p.reduce((s,[,y])=>s+(y-ym)**2,0);
 return {n:p.length,intercepto,inclinacao,r2:ssTot===0?0:Math.max(0,1-ssRes/ssTot),erroResidual:p.length>2?Math.sqrt(ssRes/(p.length-2)):0,xMedio:xm};
}
export const prever=(m:Pick<ModeloLinear,'intercepto'|'inclinacao'>,x:number)=>m.intercepto+m.inclinacao*x;
export const xParaY=(m:Pick<ModeloLinear,'intercepto'|'inclinacao'>,y:number):number|null=>m.inclinacao>0?(y-m.intercepto)/m.inclinacao:null;
