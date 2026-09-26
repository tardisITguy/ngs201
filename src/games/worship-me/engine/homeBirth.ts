import type {Cell,GameState,VillagerColor} from './types.ts';
import {next} from './rng.ts';
import {colorsOn,occupancy} from './priests.ts';
import {canCreateNeutral} from './neutrals.ts';
import {remainingCapacity} from './capacity.ts';

export interface BirthWeight{color:VillagerColor;tickets:number}
export interface HomeBirthOutcome{
 cellId:string;eligible:boolean;occupants:{villagers:VillagerColor[];priests:Cell['priests']};
 priestCompatibility:boolean;blessedByPlayerId?:string;baseBirthMode:'guaranteed'|'mixed'|'incompatible';
 probabilityWeights:BirthWeight[];selectedNewbornColor?:VillagerColor;breadConsumed:number;
 normalBirthAttempted:boolean;normalBirthEnteredSquare:boolean;
 blockedReason?:'smited'|'occupancy'|'no-bread'|'incompatible'|'square-full'|'neutral-cap';
 bonusNeutralAttempted:boolean;bonusNeutralAddedToHome:boolean;bonusNeutralBlockedReason?:'neutral-cap'|'home-full';
 productionPriorityPlayerId?:string;productionOrderIndex:number;
}
export function priestHomeCompatible(c:Cell){const colors=colorsOn(c);return !c.priests.length||(colors.length===2&&colors[0]===colors[1]&&colors[0]!=='neutral')}
export function homeBirthWeights(c:Cell,blessingColor?:VillagerColor):BirthWeight[]{
 const colors=colorsOn(c);if(colors.length!==2||!priestHomeCompatible(c))return[];
 if(colors[0]===colors[1])return[{color:colors[0],tickets:1}];
 const weights=new Map<VillagerColor,number>();
 const add=(color:VillagerColor,n:number)=>weights.set(color,(weights.get(color)??0)+n);
 if(blessingColor){
  const slots=[...colors.filter(color=>color!=='neutral'),blessingColor];
  // Total 4*n tickets: n Neutral tickets and 3 tickets per influence slot.
  for(const color of slots)add(color,3);add('neutral',slots.length);
 }else for(const color of colors)add(color,1);
 return [...weights].map(([color,tickets])=>({color,tickets}));
}
export function roundPlayerOrder(s:GameState){
 const start=s.turnOrder.indexOf(s.roundFirstPlayerId),n=s.turnOrder.length;
 if(start<0)throw Error('Invalid round first player');
 return Array.from({length:n},(_,i)=>s.turnOrder[(start+i*s.direction+n*2)%n]);
}
export function homePriority(s:GameState,c:Cell):string|undefined{
 if(c.tileModifier?.kind==='bless')return c.tileModifier.playerId;
 const colors=colorsOn(c);
 return roundPlayerOrder(s).find(id=>colors.includes(s.players.find(p=>p.id===id)!.color));
}
export function resolveHomeBirths(s:GameState):HomeBirthOutcome[]{
 s.phase='homeBirths';
 const order=roundPlayerOrder(s),square=s.board.find(c=>c.visibleKind==='square')!;
 const priority=(c:Cell)=>{const id=homePriority(s,c);return id===undefined?order.length:order.indexOf(id)};
 const homes=s.board.filter(c=>c.visibleKind==='home').sort((a,b)=>priority(a)-priority(b)||a.row-b.row||a.col-b.col||a.id.localeCompare(b.id));
 return homes.map((c,productionOrderIndex)=>{
  const colors=colorsOn(c),compatible=priestHomeCompatible(c),blessedByPlayerId=c.tileModifier?.kind==='bless'?c.tileModifier.playerId:undefined;
  const blessingColor=s.players.find(p=>p.id===blessedByPlayerId)?.color;
  const weights=homeBirthWeights(c,blessingColor);
  const outcome:HomeBirthOutcome={cellId:c.id,eligible:false,occupants:{villagers:[...c.villagers],priests:[...c.priests]},priestCompatibility:compatible,blessedByPlayerId,baseBirthMode:!compatible?'incompatible':colors.length===2&&colors[0]===colors[1]?'guaranteed':'mixed',probabilityWeights:weights,breadConsumed:0,normalBirthAttempted:false,normalBirthEnteredSquare:false,bonusNeutralAttempted:false,bonusNeutralAddedToHome:false,productionPriorityPlayerId:homePriority(s,c),productionOrderIndex};
  if(c.tileModifier?.kind==='smite')outcome.blockedReason='smited';
  else if(occupancy(c)!==2)outcome.blockedReason='occupancy';
  else if(!compatible)outcome.blockedReason='incompatible';
  else if(c.bread<s.config.homeBreadCost)outcome.blockedReason='no-bread';
  if(outcome.blockedReason)return outcome;
  outcome.eligible=true;c.bread-=s.config.homeBreadCost;outcome.breadConsumed=s.config.homeBreadCost;
  let selected=weights[0].color;
  if(weights.length>1){
   let random;[random,s.rngState]=next(s.rngState);
   let ticket=Math.floor(random*weights.reduce((sum,w)=>sum+w.tickets,0));
   for(const weight of weights){ticket-=weight.tickets;if(ticket<0){selected=weight.color;break}}
  }
  outcome.selectedNewbornColor=selected;outcome.normalBirthAttempted=true;
  if(selected==='neutral'&&!canCreateNeutral(s))outcome.blockedReason='neutral-cap';
  else if(remainingCapacity(s,square)===0)outcome.blockedReason='square-full';
  else{square.villagers.push(selected);outcome.normalBirthEnteredSquare=true}
  if(outcome.baseBirthMode==='guaranteed'&&blessedByPlayerId){
   outcome.bonusNeutralAttempted=true;
   if(!canCreateNeutral(s))outcome.bonusNeutralBlockedReason='neutral-cap';
   else if(remainingCapacity(s,c)===0)outcome.bonusNeutralBlockedReason='home-full';
   else{c.villagers.push('neutral');outcome.bonusNeutralAddedToHome=true}
  }
  return outcome;
 });
}
