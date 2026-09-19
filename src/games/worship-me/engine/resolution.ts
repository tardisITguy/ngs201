import {edgeKey,findCell} from './board';
import {remainingCapacity} from './capacity';
import {countNeutralsInPlay,MAX_NEUTRALS_IN_PLAY} from './neutrals';
import {occupancy} from './priests';
import type {BlessEdgePlacement,Cell,GameState,MoveResolutionOption,TilePlacement} from './types';

function hasOwn(c:Cell,color:string){return c.villagers.includes(color as never)||c.priests.includes(color as never)}
function pawnOptions(s:GameState,pairs:[Cell,Cell][],color:string,kind:'own'|'neutral'|'opponent'){
 const out:MoveResolutionOption[]=[];
 for(const [from,to] of pairs){
  if(remainingCapacity(s,to)<1)continue;
  if(kind==='own')for(const role of ['ordinary','priest'] as const){
   const has=role==='ordinary'?from.villagers.includes(color as never):from.priests.includes(color as never);
   if(!has)continue;
   const base={from:from.id,to:to.id,moverRole:role,moverColor:color as MoveResolutionOption['moverColor']};out.push(base);
   if(from.wheat)out.push({...base,resource:'wheat'});if(from.bread)out.push({...base,resource:'bread'});
  }
  if(kind==='neutral'&&from.villagers.includes('neutral'))out.push({from:from.id,to:to.id,moverRole:'ordinary',moverColor:'neutral',neutral:true});
  if(kind==='opponent')for(const other of [...new Set(from.villagers.filter(v=>v!=='neutral'&&v!==color))])out.push({from:from.id,to:to.id,moverRole:'ordinary',moverColor:other,opponent:true});
 }
 return out;
}

export function blessEdgeOptions(s:GameState,a:BlessEdgePlacement):MoveResolutionOption[]{
 const from=findCell(s.board,a.from),to=findCell(s.board,a.to),p=s.players.find(v=>v.id===a.playerId)!,pair:[Cell,Cell][]=[[from,to]],out:MoveResolutionOption[]=[];
 if(hasOwn(from,p.color)&&hasOwn(to,p.color)){if(from.wheat)out.push({from:from.id,to:to.id,resource:'wheat',resourceOnly:true});if(from.bread)out.push({from:from.id,to:to.id,resource:'bread',resourceOnly:true})}
 const own=pawnOptions(s,pair,p.color,'own');if(own.length)return [...out,...own];
 const neutral=pawnOptions(s,pair,p.color,'neutral');if(neutral.length)return [...out,...neutral];
 return [...out,...pawnOptions(s,pair,p.color,'opponent')];
}

export function applyBlessEdgeChoice(s:GameState,a:BlessEdgePlacement,o:MoveResolutionOption){
 const from=findCell(s.board,o.from),to=findCell(s.board,o.to),p=s.players.find(v=>v.id===a.playerId)!;
 if(o.resourceOnly){const r=o.resource!;from[r]--;to[r]++;return}
 if(o.neutral){from.villagers.splice(from.villagers.indexOf('neutral'),1);to.villagers.push(p.color);s.newVillagerBag.push('neutral');return}
 if(o.opponent){const color=o.moverColor!,index=from.villagers.indexOf(color);if(index<0)throw Error('Opponent pawn is no longer available');from.villagers.splice(index,1);if(countNeutralsInPlay(s)<MAX_NEUTRALS_IN_PLAY){to.villagers.push('neutral');s.newVillagerBag.push(color)}else to.villagers.push(color);return}
 const list=o.moverRole==='priest'?from.priests:from.villagers,index=list.indexOf(p.color);if(index<0)throw Error('Own pawn is no longer available');list.splice(index,1);(o.moverRole==='priest'?to.priests:to.villagers).push(p.color);if(o.resource){from[o.resource]--;to[o.resource]++}
}

export function resolveBlessTile(s:GameState,a:TilePlacement){const c=findCell(s.board,a.cellId);if(c.visibleKind==='hidden')c.visibleKind=c.hiddenKind!;c.tileModifier={playerId:a.playerId,kind:'bless'};if(c.visibleKind==='temple'){if(c.templeOwnerId===a.playerId)s.extraBlessNextRound[a.playerId]=(s.extraBlessNextRound[a.playerId]??0)+1;else s.persistentFirstPlayerId=c.templeOwnerId}}
export function finishSmiteTile(s:GameState,a:TilePlacement){const c=findCell(s.board,a.cellId);if(c.visibleKind==='temple'){if(c.templeOwnerId===a.playerId)s.pendingDirectionFlip=!s.pendingDirectionFlip;else if(c.templeOwnerId)s.nextRoundPlacementPenalty[c.templeOwnerId]=(s.nextRoundPlacementPenalty[c.templeOwnerId]??0)+1}if(['farm','bakery','home'].includes(c.visibleKind)&&occupancy(c)===0&&c.wheat===0&&c.bread===0)c.visibleKind='hidden';else c.tileModifier={playerId:a.playerId,kind:'smite'}}
export function isEdgeSmited(s:GameState,a:string,b:string){return s.edgeClaims[edgeKey(a,b)]?.kind==='smite'}
