import type {Cell} from './types';
export const cellId=(r:number,c:number)=>`${r},${c}`;
export const findCell=(board:Cell[],id:string)=>{const c=board.find(x=>x.id===id);if(!c)throw Error(`Unknown cell ${id}`);return c};
export const adjacent=(a:Cell,b:Cell)=>Math.abs(a.row-b.row)+Math.abs(a.col-b.col)===1;
export const traversable=(c:Cell)=>c.visibleKind!=='hidden';
export const edgeKey=(a:string,b:string)=>[a,b].sort().join('|');
export const neighbors=(board:Cell[],c:Cell)=>board.filter(x=>adjacent(c,x));
