import {blessEdgeOptions} from '../engine/resolution';
import {occupancy} from '../engine/priests';
import {remainingCapacity} from '../engine/capacity';
import type {BotStrategy,Cell,GameAction,GameState,MoveResolutionOption,Player,ScoreComponents} from '../engine/types';

export interface StrategyWeights{populationGrowth:number;resourceEconomy:number;templeProgress:number;templePreservation:number;priestProgress:number;productionEnhancement:number;opponentDisruption:number;mobility:number;exploration:number}
export const weights:Record<Exclude<BotStrategy,'random'>,StrategyWeights>={
 growth:{populationGrowth:9,resourceEconomy:9,templeProgress:4,templePreservation:6,priestProgress:4,productionEnhancement:8,opponentDisruption:3,mobility:3,exploration:5},
 templeRush:{populationGrowth:4,resourceEconomy:4,templeProgress:12,templePreservation:13,priestProgress:9,productionEnhancement:4,opponentDisruption:7,mobility:4,exploration:3},
 balanced:{populationGrowth:7,resourceEconomy:7,templeProgress:8,templePreservation:9,priestProgress:6,productionEnhancement:7,opponentDisruption:6,mobility:5,exploration:5}
};
export interface Scored{score:number;components:ScoreComponents}
const blank=():ScoreComponents=>({base:0,templeProgress:0,templePreservation:0,endTriggerValue:0,resourceValue:0,productionValue:0,populationGrowth:0,priestValue:0,disruption:0,exploration:0,mobility:0,resourceRemovalValue:0,productionPreventedValue:0,strategicDisruptionValue:0,populationReleaseValue:0,squareCongestionValue:0,terminalPressure:0,resourceSaturationPenalty:0,stagnationPenalty:0,reversalPenalty:0,riskPenalty:0});
const total=(c:ScoreComponents)=>Object.values(c).reduce((a,b)=>a+b,0);
const playerFor=(s:GameState,id:string)=>s.players.find(p=>p.id===id)!;
const templeCell=(s:GameState,p:Player)=>s.board.find(c=>c.id===p.templeCellId)!;
export const ownFollowers=(c:Cell,p:Player)=>c.villagers.filter(v=>v===p.color).length+c.priests.filter(v=>v===p.color).length;
export const totalFollowers=(s:GameState,p:Player)=>s.board.reduce((n,c)=>n+ownFollowers(c,p),0);
export function templeState(s:GameState,p:Player){const temple=templeCell(s,p),ordinary=temple.villagers.filter(v=>v===p.color).length,priests=temple.priests.filter(v=>v===p.color).length,followers=ordinary+priests;return{followers,ordinary,priests,triggerReady:followers>=s.config.templeTriggerFollowers,totalFollowers:totalFollowers(s,p),allLandRevealed:s.board.filter(c=>c.hiddenKind).every(c=>c.visibleKind!=='hidden')}}
function distance(a:Cell,b:Cell){return Math.abs(a.row-b.row)+Math.abs(a.col-b.col)}
function productiveHome(c:Cell){return c.visibleKind==='home'&&occupancy(c)===2&&c.bread>0&&c.tileModifier?.kind!=='smite'}
function recentReversal(s:GameState,p:Player,o:MoveResolutionOption){return s.history.events.slice(-40).reverse().some(e=>e.type==='resolutionDecision'&&e.playerId===p.id&&(()=>{const d=e.data.decision as MoveResolutionOption|undefined;return !!d&&d.from===o.to&&d.to===o.from&&d.resource===o.resource})())}
function revealRound(s:GameState){return s.history.events.find(e=>e.type==='victoryCheck'&&e.data.allVillageTilesRevealed===true)?.round}
function stagnantRounds(s:GameState,p:Player){const checks=s.history.events.filter(e=>e.type==='victoryCheck').slice(-30).reverse();if(!checks.length)return 0;const latest=(checks[0].data.players as Array<{playerId:string;followers:number;templeFollowers:number}>).find(x=>x.playerId===p.id);let count=0;for(const e of checks){const x=(e.data.players as Array<{playerId:string;followers:number;templeFollowers:number}>).find(v=>v.playerId===p.id);if(!x||!latest||x.followers!==latest.followers||x.templeFollowers!==latest.templeFollowers)break;count++}return count}
function congestion(s:GameState,p:Player){const square=s.board.find(c=>c.visibleKind==='square')!,ownInBag=s.newVillagerBag.filter(v=>v===p.color).length;return{square,ownInBag,totalBag:s.newVillagerBag.length,openSlots:remainingCapacity(s,square),stagnant:stagnantRounds(s,p)}}

export function scoreResolutionOption(s:GameState,playerId:string,o:MoveResolutionOption,w:StrategyWeights):Scored{
 const c=blank(),p=playerFor(s,playerId),from=s.board.find(x=>x.id===o.from)!,to=s.board.find(x=>x.id===o.to)!,temple=templeCell(s,p),ts=templeState(s,p),movesOwn=!!o.moverRole,opponentLeader=Math.max(...s.players.filter(x=>x.id!==p.id).map(x=>totalFollowers(s,x))),cong=congestion(s,p);
 c.base=1;c.mobility=w.mobility;
 if(movesOwn){const before=distance(from,temple),after=distance(to,temple);c.templeProgress+=(before-after)*w.templeProgress*2;if(to.id===temple.id){c.templeProgress+=w.templeProgress*(ts.followers===2?5:ts.followers===1?4:2);if(ts.followers===2){if(ts.allLandRevealed)c.endTriggerValue+=(ts.totalFollowers>opponentLeader?w.templeProgress*14:ts.totalFollowers<opponentLeader?-w.templeProgress*18:-w.templeProgress*5);else c.endTriggerValue+=w.templeProgress*4}}if(from.id===temple.id){const favorableEnd=ts.allLandRevealed&&ts.triggerReady&&ts.totalFollowers>opponentLeader,severe=(ts.followers<=2)||(ts.followers===3&&favorableEnd);c.templePreservation-=w.templePreservation*(severe?8:ts.followers===3&&ts.totalFollowers<opponentLeader?-1:3)}
  if(productiveHome(from)){c.populationGrowth-=w.populationGrowth*9;c.productionValue-=w.productionEnhancement*5}if(to.visibleKind==='home'){const afterOccupancy=occupancy(to)+1;if(afterOccupancy===2&&to.bread)c.populationGrowth+=w.populationGrowth*7;else if(afterOccupancy===3)c.populationGrowth-=w.populationGrowth*12}
  if(o.moverRole==='priest'){if(to.visibleKind==='farm'||to.visibleKind==='bakery')c.priestValue+=w.priestProgress*4;if(from.visibleKind==='farm'||from.visibleKind==='bakery')c.priestValue-=w.priestProgress*3}
  if(['farm','bakery','home'].includes(to.visibleKind))c.productionValue+=w.productionEnhancement*1.5;
 }else if(o.neutral){c.populationGrowth+=w.populationGrowth*3;c.mobility+=w.mobility*2;const before=distance(from,temple),after=distance(to,temple);c.templeProgress+=(before-after)*w.templeProgress}
 else if(o.opponent){const owner=s.players.find(x=>x.color===o.moverColor);c.disruption+=w.opponentDisruption*((from.visibleKind==='temple'&&owner?.templeCellId===from.id)?8:(productiveHome(from)?7:2));if(to.visibleKind==='temple'&&owner?.templeCellId===to.id)c.disruption-=w.opponentDisruption*8}
 if(o.resource==='wheat'){if(to.visibleKind==='bakery'){c.resourceValue+=w.resourceEconomy*7;c.productionValue+=to.wheat<1?w.productionEnhancement*4:w.productionEnhancement*2}if(from.visibleKind==='bakery'){c.resourceValue-=w.resourceEconomy*5}if(['temple','home','farm'].includes(to.visibleKind))c.resourceValue-=w.resourceEconomy*2}
 if(o.resource==='bread'){if(to.visibleKind==='home'){c.resourceValue+=w.resourceEconomy*(occupancy(to)===2?9:5);if(occupancy(to)===2)c.populationGrowth+=w.populationGrowth*7}if(from.visibleKind==='home'){c.resourceValue-=w.resourceEconomy*(occupancy(from)===2?8:4)}if(['temple','farm','bakery'].includes(to.visibleKind))c.resourceValue-=w.resourceEconomy*2}
 if(from.visibleKind==='square'&&cong.openSlots===0&&cong.ownInBag>0&&!o.resourceOnly){const usefulDestination=['farm','bakery','home','temple'].includes(to.visibleKind),backlog=Math.min(6,cong.ownInBag);c.populationReleaseValue+=w.populationGrowth*(2+backlog);c.squareCongestionValue+=w.mobility*(usefulDestination?4:1);if(o.neutral)c.populationReleaseValue+=w.populationGrowth*2}
 if(cong.openSlots===0&&cong.ownInBag>0&&o.resource==='bread'&&to.visibleKind==='home'){c.resourceSaturationPenalty-=w.populationGrowth*Math.min(8,2+cong.ownInBag);c.stagnationPenalty-=w.resourceEconomy*Math.min(5,cong.stagnant/4)}
 if(o.resource==='wheat'&&to.visibleKind==='bakery'&&to.wheat>=Math.max(2,occupancy(to)*2))c.resourceSaturationPenalty-=w.resourceEconomy*Math.min(5,to.wheat/2);
 if(recentReversal(s,p,o))c.reversalPenalty-=Math.max(w.templeProgress,w.resourceEconomy,w.mobility)*5;
 if(ts.allLandRevealed&&!ts.triggerReady){const toward=movesOwn&&distance(to,temple)<distance(from,temple),sinceReveal=Math.max(0,s.round-(revealRound(s)??s.round)),leading=ts.totalFollowers>opponentLeader;if(toward){const maturity=Math.min(12,Math.floor(sinceReveal/5))+Math.min(8,Math.floor(cong.stagnant/3));c.terminalPressure+=w.templeProgress*(leading?19+maturity:2+Math.floor(maturity/2));if(to.id===temple.id)c.terminalPressure+=w.templeProgress*(leading?12:3)}c.templeProgress*=1.4;if(movesOwn&&to.id!==temple.id&&distance(to,temple)>=distance(from,temple)&&leading)c.riskPenalty-=w.templeProgress*5}
 return{components:c,score:total(c)};
}

export function marginalProduction(c:Cell,s:GameState,kind:'bless'|'smite'){
 const villagers=occupancy(c);
 if(c.visibleKind==='farm'){const normal=villagers*s.config.normalFarmYieldPerVillager,blessed=villagers*s.config.blessedFarmYieldPerVillager;return kind==='bless'?Math.max(0,blessed-normal):normal}
 if(c.visibleKind==='bakery'){const normal=Math.min(villagers,Math.floor(c.wheat/s.config.normalBakeryWheatCost)),blessed=Math.min(villagers,Math.floor(c.wheat/s.config.blessedBakeryWheatCost));return kind==='bless'?Math.max(0,blessed-normal):normal}
 if(c.visibleKind==='home'){const produces=villagers===2&&c.bread>=s.config.homeBreadCost;return produces?1:0}
 return 0;
}
function productionThreat(c:Cell,s:GameState){const actual=marginalProduction(c,s,'smite');return c.visibleKind==='home'?actual*10:c.visibleKind==='bakery'?actual*4:actual}
function opponentThreat(s:GameState,p:Player){return Math.max(0,...s.players.filter(x=>x.id!==p.id).map(x=>{const t=templeState(s,x);return t.totalFollowers+(t.triggerReady&&t.totalFollowers>totalFollowers(s,p)?15:t.followers*2)+(s.extraBlessNextRound[x.id]??0)*3}))}

export function scoreActionDetailed(s:GameState,a:GameAction,w:StrategyWeights):Scored{
 const c=blank();if(a.type==='endTurn'){c.base=-100;return{components:c,score:total(c)}}const p=playerFor(s,a.playerId),ts=templeState(s,p);
 if(a.type==='placeEdge'){
  const x=s.board.find(v=>v.id===(a.kind==='bless'?a.from:a.a))!,y=s.board.find(v=>v.id===(a.kind==='bless'?a.to:a.b))!;
  if(a.kind==='bless'){const options=blessEdgeOptions(s,a),scored=options.map(o=>scoreResolutionOption(s,a.playerId,o,w));if(!scored.length){c.riskPenalty=-40;c.base=-5}else{const best=scored.sort((u,v)=>v.score-u.score)[0];Object.assign(c,best.components);c.base+=1}return{components:c,score:total(c)}}
  const enemyPresence=[x,y].reduce((n,z)=>n+z.villagers.filter(v=>v!==p.color&&v!=='neutral').length+z.priests.filter(v=>v!==p.color).length,0),resourceRoute=(x.wheat&&y.visibleKind==='bakery')||(y.wheat&&x.visibleKind==='bakery')||(x.bread&&y.visibleKind==='home')||(y.bread&&x.visibleKind==='home');c.disruption+=w.opponentDisruption*(enemyPresence*3+(resourceRoute?6:0));if(!enemyPresence&&!resourceRoute)c.riskPenalty-=8;return{components:c,score:total(c)};
 }
 const cell=s.board.find(v=>v.id===a.cellId)!;
 if(a.kind==='bless'){
  if(cell.visibleKind==='hidden'){const remaining=s.board.filter(x=>x.visibleKind==='hidden').length;c.exploration+=ts.allLandRevealed?0:w.exploration*12+remaining*2+Math.min(s.round,40)*1.5;return{components:c,score:total(c)}}
  if(cell.visibleKind==='farm'||cell.visibleKind==='bakery'){const marginal=marginalProduction(cell,s,'bless');c.productionValue+=w.productionEnhancement*marginal*3;if(marginal===0)c.riskPenalty-=2}if(cell.visibleKind==='home'){const marginal=marginalProduction(cell,s,'bless');if(marginal){c.populationGrowth+=w.populationGrowth*4;c.productionValue+=w.productionEnhancement*3}else c.riskPenalty-=3}
  if(cell.visibleKind==='temple'){if(cell.templeOwnerId===p.id){c.mobility+=w.mobility*5;c.templeProgress+=w.templeProgress*2}else{c.disruption-=w.opponentDisruption*3;c.riskPenalty-=6}}
 }else{
  if(cell.visibleKind==='temple'){if(cell.templeOwnerId===p.id){c.base=1}else{const target=s.players.find(x=>x.id===cell.templeOwnerId)!,threat=templeState(s,target),us=totalFollowers(s,p),dangerousTrigger=threat.allLandRevealed&&threat.followers>=2&&threat.totalFollowers>us;c.disruption+=w.opponentDisruption*(4+(dangerousTrigger?18:-4)+(s.extraBlessNextRound[target.id]??0)*4);if(opponentThreat(s,p)>10)c.disruption+=w.opponentDisruption*3}}
  else{const threat=productionThreat(cell,s),bestSingleRemoval=cell.bread>0?2:cell.wheat>0?1:0;c.resourceRemovalValue+=w.opponentDisruption*bestSingleRemoval;c.productionPreventedValue+=w.opponentDisruption*threat;if(!threat&&!bestSingleRemoval&&occupancy(cell)===0)c.exploration+=w.opponentDisruption*1.5;else if(!threat&&!bestSingleRemoval)c.riskPenalty-=6}
 }
 if(ts.allLandRevealed&&!ts.triggerReady&&ts.totalFollowers>Math.max(...s.players.filter(x=>x.id!==p.id).map(x=>totalFollowers(s,x)))&&cell.visibleKind!=='temple')c.riskPenalty-=w.templeProgress*1.5;
 return{components:c,score:total(c)};
}
export function scoreAction(s:GameState,a:GameAction,w:StrategyWeights){return scoreActionDetailed(s,a,w).score}

export function scoreSmiteResourceChoice(s:GameState,cellId:string,resource:'wheat'|'bread',w:StrategyWeights):Scored{const c=blank(),cell=s.board.find(x=>x.id===cellId)!;c.disruption=w.opponentDisruption*(resource==='bread'?4:2);if(resource==='wheat'&&cell.visibleKind==='bakery')c.disruption+=w.opponentDisruption*5;if(resource==='bread'&&cell.visibleKind==='home')c.disruption+=w.opponentDisruption*7;return{components:c,score:total(c)}}
