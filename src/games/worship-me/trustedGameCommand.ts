import {applyAction,resolvePendingDecision} from './engine/reducer.ts';
import type {GameAction,GameState,ResolutionDecision} from './engine/types.ts';

export type WorshipMeBrowserCommand=
 |{type:'placeTile';kind:'bless'|'smite';cellId:string}
 |{type:'placeEdge';kind:'bless';from:string;to:string}
 |{type:'placeEdge';kind:'smite';a:string;b:string}
 |{type:'endTurn'}
 |{type:'resolveBlessEdge';optionIndex:number}
 |{type:'resolveSmiteResource';resource:'wheat'|'bread'};

const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value:Record<string,unknown>,keys:string[])=>{const actual=Object.keys(value).sort(),expected=[...keys].sort();return actual.length===expected.length&&actual.every((key,index)=>key===expected[index]);};
const cell=(value:unknown)=>typeof value==='string'&&/^\d+,\d+$/.test(value);

export function parseWorshipMeBrowserCommand(value:unknown):WorshipMeBrowserCommand{
 if(!record(value)||typeof value.type!=='string')throw Error('Invalid game action request');
 if(value.type==='placeTile'&&exact(value,['type','kind','cellId'])&&(value.kind==='bless'||value.kind==='smite')&&cell(value.cellId))return{type:'placeTile',kind:value.kind,cellId:value.cellId as string};
 if(value.type==='placeEdge'&&value.kind==='bless'&&exact(value,['type','kind','from','to'])&&cell(value.from)&&cell(value.to))return{type:'placeEdge',kind:'bless',from:value.from as string,to:value.to as string};
 if(value.type==='placeEdge'&&value.kind==='smite'&&exact(value,['type','kind','a','b'])&&cell(value.a)&&cell(value.b))return{type:'placeEdge',kind:'smite',a:value.a as string,b:value.b as string};
 if(value.type==='endTurn'&&exact(value,['type']))return{type:'endTurn'};
 if(value.type==='resolveBlessEdge'&&exact(value,['type','optionIndex'])&&Number.isInteger(value.optionIndex)&&(value.optionIndex as number)>=0)return{type:'resolveBlessEdge',optionIndex:value.optionIndex as number};
 if(value.type==='resolveSmiteResource'&&exact(value,['type','resource'])&&(value.resource==='wheat'||value.resource==='bread'))return{type:'resolveSmiteResource',resource:value.resource};
 throw Error('Invalid game action request');
}

function canonicalState(value:unknown):GameState{
 if(!record(value)||value.schemaVersion!==9||!Array.isArray(value.players)||!Array.isArray(value.turnOrder)||!Array.isArray(value.board)||!Number.isInteger(value.currentPlayerIndex))throw Error('Game state is unavailable');
 return value as unknown as GameState;
}

export function applyTrustedWorshipMeCommand(value:unknown,command:WorshipMeBrowserCommand,viewerPlayerId:string):GameState{
 const state=canonicalState(value),current=state.turnOrder[state.currentPlayerIndex];
 if(current!==viewerPlayerId)throw Error('That action is not legal.');
 if(command.type==='resolveBlessEdge'||command.type==='resolveSmiteResource'){
  if(state.pendingResolution?.playerId!==viewerPlayerId)throw Error('That action is not legal.');
  const decision:ResolutionDecision=command.type==='resolveBlessEdge'?{...command,playerId:viewerPlayerId}:{...command,playerId:viewerPlayerId};
  return resolvePendingDecision(state,decision);
 }
 if(state.pendingResolution)throw Error('That action is not legal.');
 let action:GameAction;
 if(command.type==='placeTile')action={...command,playerId:viewerPlayerId};
 else if(command.type==='placeEdge'&&command.kind==='bless')action={...command,playerId:viewerPlayerId};
 else if(command.type==='placeEdge')action={...command,playerId:viewerPlayerId};
 else action={type:'endTurn',playerId:viewerPlayerId};
 return applyAction(state,action);
}
