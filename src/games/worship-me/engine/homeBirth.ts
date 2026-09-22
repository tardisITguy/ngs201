import type {GameState,VillagerColor} from './types.ts';
import {draw} from './rng.ts';import {colorsOn,occupancy} from './priests.ts';import {addPawnToBag} from './neutrals.ts';
import {remainingCapacity} from './capacity.ts';
export interface HomeBirthOutcome{cellId:string;homeProductionTriggered:true;bagContribution:VillagerColor[];entryAttempted:boolean;drawn?:VillagerColor;enteredBoard:boolean;blockedReason?:'village-square-full'}
export function resolveHomeBirths(s:GameState){
 s.phase='homeBirths';const homes=s.board.filter(c=>c.visibleKind==='home'&&c.tileModifier?.kind!=='smite'&&occupancy(c)===2&&c.bread>=s.config.homeBreadCost),outcomes:HomeBirthOutcome[]=[];
 for(const c of homes){c.bread-=s.config.homeBreadCost;const [a,b]=colorsOn(c),bagContribution:VillagerColor[]=[a];addPawnToBag(s,a);if(b!==a){addPawnToBag(s,b);bagContribution.push(b)}if(c.tileModifier?.kind==='bless'){const chosen=s.players.find(p=>p.id===c.tileModifier?.playerId)?.color;if(chosen){addPawnToBag(s,chosen);bagContribution.push(chosen)}}outcomes.push({cellId:c.id,homeProductionTriggered:true,bagContribution,entryAttempted:false,enteredBoard:false})}
 const square=s.board.find(c=>c.visibleKind==='square')!;for(let i=0;i<homes.length;i++){let v;[v,s.newVillagerBag,s.rngState]=draw(s.newVillagerBag,s.rngState);const outcome=outcomes[i];if(v){outcome.entryAttempted=true;outcome.drawn=v;if(remainingCapacity(s,square)>0){square.villagers.push(v);outcome.enteredBoard=true}else{s.newVillagerBag.push(v);outcome.blockedReason='village-square-full';s.eventLog.push('Home birth remained in bag: Village Square is full')}}}return outcomes;
}
