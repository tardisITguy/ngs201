import type {WorshipMePublicPendingDecision} from '../../games/worship-me/publicGameView';

type BlessEdgeOption=Extract<WorshipMePublicPendingDecision,{type:'blessEdgeMove'}>['options'][number];

const label=(value:string)=>value.charAt(0).toUpperCase()+value.slice(1);

export function describeBlessEdgeOption(option:BlessEdgeOption){
 const route=`${option.from} → ${option.to}`;
 const resource=option.resource?` + 1 ${label(option.resource)}`:'';
 if(option.resourceOnly)return `Move 1 ${option.resource?label(option.resource):'resource'} only · ${route}`;
 if(option.neutral)return `Move Neutral${resource} · ${route}`;
 const color=option.moverColor?label(option.moverColor):'Unknown';
 if(option.opponent)return `Move ${color} opponent${resource} · ${route}`;
 return `Move ${color} ${option.moverRole==='priest'?'Priest':'Villager'}${resource} · ${route}`;
}
