export function hashSeed(seed:string){let h=2166136261;for(const c of seed){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0||1}
export function next(state:number):[number,number]{let x=state;x^=x<<13;x^=x>>>17;x^=x<<5;return[(x>>>0)/4294967296,x>>>0]}
export function shuffle<T>(items:T[],state:number):[T[],number]{const a=[...items];for(let i=a.length-1;i>0;i--){let n;[n,state]=next(state);const j=Math.floor(n*(i+1));[a[i],a[j]]=[a[j],a[i]]}return[a,state]}
export function draw<T>(items:T[],state:number):[T|undefined,T[],number]{if(!items.length)return[undefined,items,state];let n;[n,state]=next(state);const i=Math.floor(n*items.length),a=[...items],v=a.splice(i,1)[0];return[v,a,state]}
