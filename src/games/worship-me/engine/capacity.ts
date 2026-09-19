import type {Cell,GameState} from './types';
export function tileCapacity(s:GameState,c:Cell){return c.visibleKind==='square'?s.players.length+2:c.visibleKind==='hidden'?0:4}
export function remainingCapacity(s:GameState,c:Cell){return Math.max(0,tileCapacity(s,c)-c.villagers.length-c.priests.length)}
export function isAtCapacity(s:GameState,c:Cell){return remainingCapacity(s,c)===0}
export function requireVillagerCapacity(s:GameState,c:Cell,count=1){if(remainingCapacity(s,c)<count)throw Error(`${c.visibleKind} ${c.id} is at villager capacity`)}
