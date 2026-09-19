import {createGame} from '../src/games/worship-me/engine/setup';import type {GameState} from '../src/games/worship-me/engine/types';
export function game(){return createGame(2,'test',{randomizeFirstPlayer:false,randomizeDirection:false})}
export function reveal(s:GameState,id:string,kind:'farm'|'bakery'|'home'='farm'){const c=s.board.find(c=>c.id===id)!;c.visibleKind=kind;c.hiddenKind=kind;return c}
export const player=(s:GameState,n=0)=>s.players[n];
