import type {Cell,GameState,PlacementAction} from '../engine/types';
import {tileEquation} from './tileEquations';
import {isAtCapacity,tileCapacity} from '../engine/capacity';
import {occupancy} from '../engine/priests';
import {ACTION_TOKEN_ASSETS} from './actionTokenAssets';

type MarkerStatus='pending'|'resolving'|'resolved';
function esc(value:string){return value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;')}
function cap(value:string){return value.charAt(0).toUpperCase()+value.slice(1)}
function markerStatus(s:GameState,index:number):MarkerStatus{return index<s.resolutionIndex?'resolved':index===s.resolutionIndex&&s.phase==='resolution'?'resolving':'pending'}
function playerLabel(s:GameState,playerId:string){const p=s.players.find(x=>x.id===playerId);return p?`${cap(p.color)} (${p.name})`:playerId}
function tokenImage(kind:'bless'|'smite'){return `<img src="${ACTION_TOKEN_ASSETS[kind]}" alt="" aria-hidden="true">`}

function tileTokens(c:Cell,s:GameState){return s.actionQueue.map((queued,index)=>({queued,index})).filter(({queued})=>queued.placement.type==='placeTile'&&queued.placement.cellId===c.id).map(({queued,index})=>{
 const action=queued.placement as Extract<PlacementAction,{type:'placeTile'}>,status=markerStatus(s,index),owner=s.players.find(p=>p.id===action.playerId),label=`${playerLabel(s,action.playerId)} ${cap(action.kind)} on ${c.visibleKind} ${c.id}; ${status}`;
 return `<span class="action-token tile-action-token ${action.kind} ${status}" style="--action-owner:${owner?.color??'#555'}" role="img" aria-label="${esc(label)}" data-action-sequence="${queued.sequence}" data-action-kind="${action.kind}" data-coordinate="${c.id}">${tokenImage(action.kind)}</span>`;
}).join('')}

type EdgeAction=Extract<PlacementAction,{type:'placeEdge'}>;
function edgeEndpoints(action:EdgeAction){return action.kind==='bless'?[action.from,action.to] as const:[action.a,action.b] as const}
function edgeAnchor(s:GameState,action:EdgeAction){const [aId,bId]=edgeEndpoints(action),a=s.board.find(c=>c.id===aId)!,b=s.board.find(c=>c.id===bId)!;return a.row===b.row?(a.col<b.col?{cell:a,side:'right' as const}:{cell:b,side:'right' as const}):(a.row<b.row?{cell:a,side:'down' as const}:{cell:b,side:'down' as const})}
function blessDirection(s:GameState,action:Extract<EdgeAction,{kind:'bless'}>){const from=s.board.find(c=>c.id===action.from)!,to=s.board.find(c=>c.id===action.to)!;if(to.col>from.col)return'right';if(to.col<from.col)return'left';if(to.row>from.row)return'down';return'up'}
function edgeTokens(c:Cell,s:GameState){return s.actionQueue.map((queued,index)=>({queued,index})).filter(({queued})=>queued.placement.type==='placeEdge'&&edgeAnchor(s,queued.placement).cell.id===c.id).map(({queued,index})=>{
 const action=queued.placement as EdgeAction,[a,b]=edgeEndpoints(action),status=markerStatus(s,index),owner=s.players.find(p=>p.id===action.playerId),anchor=edgeAnchor(s,action),direction=action.kind==='bless'?blessDirection(s,action):undefined;
 const target=action.kind==='bless'?`from ${action.from} to ${action.to}`:`on edge ${a}–${b}`,label=`${playerLabel(s,action.playerId)} ${cap(action.kind)} Edge ${target}; ${status}`;
 return `<span class="action-token edge-action-token edge-token-${anchor.side} ${action.kind} ${status}${direction?` direction-${direction}`:''}" style="--action-owner:${owner?.color??'#555'}" role="img" aria-label="${esc(label)}" data-action-sequence="${queued.sequence}" data-action-kind="${action.kind}" data-origin="${action.kind==='bless'?action.from:a}" data-destination="${action.kind==='bless'?action.to:b}">${tokenImage(action.kind)}${direction?`<span class="direction-arrow" aria-hidden="true">${direction==='right'?'→':direction==='left'?'←':direction==='down'?'↓':'↑'}</span>`:''}</span>`;
}).join('')}

function smiteBar(c:Cell,s:GameState){return s.edgeMarkers.filter(e=>e.kind==='smite'&&(e.a===c.id||e.b===c.id)).map(e=>{const other=s.board.find(x=>x.id===(e.a===c.id?e.b:e.a))!;if(other.row===c.row&&other.col===c.col+1)return'<span class="edge-smite edge-smite-right" aria-label="Smited edge: impassable"></span>';if(other.col===c.col&&other.row===c.row+1)return'<span class="edge-smite edge-smite-down" aria-label="Smited edge: impassable"></span>';return''}).join('')}

export function renderBoard(s:GameState,selection:{start?:string;end?:string}={}){
 return `<section class="board">${s.board.map(c=>{
  const claim=s.tileClaims[c.id],owner=s.players.find(p=>p.id===c.templeOwnerId),marker=s.players.find(p=>p.id===(c.tileModifier?.playerId??claim?.playerId)),selected=selection.start===c.id||selection.end===c.id,label=selection.start===c.id?'Origin':selection.end===c.id?'Destination':'' ,full=c.visibleKind!=='hidden'&&isAtCapacity(s,c),edges=edgeTokens(c,s);
  const occupancyLabel=c.visibleKind==='hidden'?'':`<span class="occupancy${full?' at-capacity':''}">${occupancy(c)}/${tileCapacity(s,c)}${full?' FULL':''}</span>`;
  return `<button class="cell ${c.visibleKind}${selected?' selected':''}${c.tileModifier||claim?' round-marked':''}${full?' full':''}${edges?' has-edge-token':''}" data-cell="${c.id}" style="${owner?`--temple-color:${owner.color};`:''}${marker?`--marker-color:${marker.color}`:''}"><span class="tile-coordinate" aria-label="Tile coordinate ${c.id}">${c.id}</span>${smiteBar(c,s)}${edges}${tileTokens(c,s)}${label?`<strong class="selection-label">${label}</strong>`:''}${occupancyLabel}<b>${c.visibleKind==='hidden'?'?':c.visibleKind}</b>${owner?`<small>${owner.name} · ${owner.color}</small>`:''}<span>${c.villagers.map(v=>`<i class="pawn" style="--c:${v}"></i>`).join('')}${c.priests.map(v=>`<i class="pawn priest" style="--c:${v}">P</i>`).join('')}</span><small>🌾${c.wheat} 🍞${c.bread}</small>${tileEquation(c,s)?`<small class="equation">${tileEquation(c,s)}</small>`:''}</button>`;
 }).join('')}</section>`;
}
