import type {GameState} from './types';
import {countNeutralsInPlay,MAX_NEUTRALS_IN_PLAY} from './neutrals';
import {tileCapacity} from './capacity';

export const serializeGame=(state:GameState)=>JSON.stringify(state);

export function deserializeGame(json:string):GameState{
 const state=JSON.parse(json) as GameState;
 if(!state||state.schemaVersion!==9||!Array.isArray(state.board)||state.board.length!==25||!Array.isArray(state.players)||!Array.isArray(state.actionQueue)||!state.history||!Array.isArray(state.history.events))throw Error('Unsupported save: placement-penalty schema v9 is required');
 if(countNeutralsInPlay(state)>MAX_NEUTRALS_IN_PLAY)throw Error(`Save exceeds the ${MAX_NEUTRALS_IN_PLAY} Neutral pawn limit`);
 for(const cell of state.board)if(cell.visibleKind!=='hidden'&&cell.villagers.length+cell.priests.length>tileCapacity(state,cell))throw Error(`Save exceeds villager capacity at ${cell.id}`);
 if(state.pendingResolution&&state.phase!=='resolution')throw Error('A pending decision requires the Resolution Phase');
 return state;
}
