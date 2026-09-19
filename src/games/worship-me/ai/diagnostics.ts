import type {AIDecisionDiagnostics,BotStrategy,GameAction,GameState,PlacementAction,ScoreComponents} from '../engine/types';

export function describeCandidate(state:GameState,action:GameAction){
 if(action.type==='endTurn')return'End placements';
 if(action.type==='placeEdge')return action.kind==='bless'?`Bless Edge ${action.from} → ${action.to}`:`Smite Edge ${action.a}–${action.b}`;
 const cell=state.board.find(c=>c.id===action.cellId)!;
 const target=cell.visibleKind==='hidden'?'Tile':cell.visibleKind[0].toUpperCase()+cell.visibleKind.slice(1);
 return`${action.kind==='bless'?'Bless':'Smite'} ${target} ${action.cellId}`;
}

export function buildDiagnostics(state:GameState,strategy:BotStrategy,actions:GameAction[],scores:Map<GameAction,{score:number;components:ScoreComponents}>,selected:GameAction,limit=10):AIDecisionDiagnostics{
 const placements=actions.filter((a):a is PlacementAction=>a.type!=='endTurn'),empty:ScoreComponents={base:0,templeProgress:0,templePreservation:0,endTriggerValue:0,resourceValue:0,productionValue:0,populationGrowth:0,priestValue:0,disruption:0,exploration:0,mobility:0,resourceRemovalValue:0,productionPreventedValue:0,strategicDisruptionValue:0,populationReleaseValue:0,squareCongestionValue:0,terminalPressure:0,resourceSaturationPenalty:0,stagnationPenalty:0,reversalPenalty:0,riskPenalty:0};
 const ranked=placements.map(action=>({action,label:describeCandidate(state,action),...(scores.get(action)??{score:0,components:empty})})).sort((a,b)=>b.score-a.score||a.label.localeCompare(b.label));
 const selectedRank=selected.type==='endTurn'?null:ranked.findIndex(x=>x.action===selected)+1;
 return{strategy,legalCandidateCounts:{
  blessTile:placements.filter(a=>a.type==='placeTile'&&a.kind==='bless').length,
  blessEdge:placements.filter(a=>a.type==='placeEdge'&&a.kind==='bless').length,
  smiteTile:placements.filter(a=>a.type==='placeTile'&&a.kind==='smite').length,
  smiteEdge:placements.filter(a=>a.type==='placeEdge'&&a.kind==='smite').length,
  templeActions:placements.filter(a=>a.type==='placeTile'&&state.board.find(c=>c.id===a.cellId)?.visibleKind==='temple').length,
  totalPlacements:placements.length,endTurnAvailable:actions.some(a=>a.type==='endTurn')
 },topCandidates:ranked.slice(0,limit).map((x,index)=>({rank:index+1,label:x.label,score:x.score,components:x.components,action:x.action})),selected:{label:describeCandidate(state,selected),score:scores.get(selected)?.score??0,rank:selectedRank}};
}
