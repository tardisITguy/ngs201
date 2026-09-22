import type {Cell,GameState,PlayerColor} from './types.ts';
import {remainingCapacity} from './capacity.ts';
export const occupancy=(c:Cell)=>c.villagers.length+c.priests.length;
export const colorsOn=(c:Cell)=>([...c.villagers,...c.priests] as Array<PlayerColor|'neutral'>);
export const hasPassiveBless=(c:Cell)=>(c.visibleKind==='farm'||c.visibleKind==='bakery')&&c.priests.length>0;
export const isEffectivelyBlessed=(c:Cell)=>c.tileModifier?.kind==='bless'||(!c.tileModifier&&hasPassiveBless(c));
export function createPriests(s:GameState){const square=s.board.find(c=>c.visibleKind==='square')!;for(const p of s.players){if(p.priestsCreated>=2||p.lastPriestCreationRound===s.round)continue;const temple=s.board.find(c=>c.id===p.templeCellId)!;const i=temple.villagers.indexOf(p.color);if(temple.villagers.filter(v=>v===p.color).length<3)continue;temple.villagers.splice(i,1);temple.priests.push(p.color);p.priestsCreated++;p.lastPriestCreationRound=s.round;if(remainingCapacity(s,square)>0){temple.priests.splice(temple.priests.lastIndexOf(p.color),1);square.priests.push(p.color);s.eventLog.push(`${p.name} created Priest ${p.priestsCreated}/2 and moved it to Village Square`)}else s.eventLog.push(`${p.name} created Priest ${p.priestsCreated}/2; Village Square full, Priest remained in Temple`)}return s}
export function priestProtectsTemple(s:GameState,c:Cell){const owner=s.players.find(p=>p.id===c.templeOwnerId);return !!owner&&c.priests.includes(owner.color)}
