export interface PoliticaRetry {baseMs:number;tetoMs:number;jitter:number}
export function calcularAtrasoRetry(tentativa:number,p:PoliticaRetry,aleatorio:()=>number=Math.random):number{const base=Math.min(p.tetoMs,p.baseMs*2**Math.max(0,tentativa-1));return Math.max(0,Math.round(base*(1+p.jitter*(aleatorio()*2-1))));}
