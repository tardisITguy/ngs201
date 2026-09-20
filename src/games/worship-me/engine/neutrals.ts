import type {Cell,GameState,VillagerColor} from './types.ts';
export const MAX_NEUTRALS_IN_PLAY=10;
export function countNeutralsInPlay(s:GameState){return s.newVillagerBag.filter(v=>v==='neutral').length+s.board.reduce((n,c)=>n+c.villagers.filter(v=>v==='neutral').length,0)}
export function canCreateNeutral(s:GameState){return countNeutralsInPlay(s)<MAX_NEUTRALS_IN_PLAY}
export function addPawnToBag(s:GameState,color:VillagerColor){if(color==='neutral'&&!canCreateNeutral(s))return false;s.newVillagerBag.push(color);return true}
export function createNeutralOnBoard(s:GameState,cell:Cell){if(!canCreateNeutral(s))return false;cell.villagers.push('neutral');return true}
