import {resolvePendingDecision} from '../engine/reducer.ts';
import type {BotStrategy,GameState} from '../engine/types.ts';
import {getPolicy} from './policies.ts';
import {commitBotAction,evaluateBotAction} from './runner.ts';

const strategies=new Set<BotStrategy>(['random','growth','templeRush','balanced']);

export interface AIAdvanceDecision{advanced:true;playerId:string;state:GameState}
export interface NoAIAdvanceDecision{advanced:false;reason:'human'|'gameOver'}
export type AIAdvanceResult=AIAdvanceDecision|NoAIAdvanceDecision;

function canonicalState(value:unknown):GameState{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Game state is unavailable');
 const state=value as GameState;
 if(state.schemaVersion!==9||!Array.isArray(state.players)||!Array.isArray(state.turnOrder)||!Number.isInteger(state.currentPlayerIndex))throw Error('Game state is unavailable');
 return state;
}

/** Applies exactly one deterministic decision owned by the canonical AI player. */
export function advanceOneAIDecision(value:unknown):AIAdvanceResult{
 const state=canonicalState(value);
 if(state.phase==='gameOver')return{advanced:false,reason:'gameOver'};
 const playerId=state.pendingResolution?.playerId??state.turnOrder[state.currentPlayerIndex];
 const player=state.players.find(candidate=>candidate.id===playerId);
 if(!player||player.control!=='ai')return{advanced:false,reason:'human'};
 if(!player.botStrategy||!strategies.has(player.botStrategy))throw Error('AI player has no valid strategy');
 if(state.pendingResolution){
  const choice=getPolicy(player.botStrategy).choosePendingResolution(state);
  const seeded={...state,rngState:choice.rngState};
  return{advanced:true,playerId,state:resolvePendingDecision(seeded,choice.decision,{aiResolution:choice.diagnostics})};
 }
 if(state.phase!=='placement')return{advanced:false,reason:'human'};
 const choice=evaluateBotAction(state,player.botStrategy);
 return{advanced:true,playerId,state:commitBotAction(state,choice)};
}
