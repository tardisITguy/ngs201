import {describe,expect,it,vi} from 'vitest';
import {simulateGame} from '../src/games/worship-me/ai/simulate';
import {applyBlessEdgeChoice} from '../src/games/worship-me/engine/resolution';
import {templeState,marginalProduction} from '../src/games/worship-me/ai/scoring';
import {createGame} from '../src/games/worship-me/engine/setup';
import {homeBirthWeights,homePriority,resolveHomeBirths,roundPlayerOrder} from '../src/games/worship-me/engine/homeBirth';
import {createPriests,occupancy} from '../src/games/worship-me/engine/priests';
import {applyAction,resolveFallbackNeutral,startNextRound} from '../src/games/worship-me/engine/reducer';
import {checkVictory,followerTotal,ordinaryVillagersInOwnTemple} from '../src/games/worship-me/engine/victory';
import {countNeutralsInPlay} from '../src/games/worship-me/engine/neutrals';
import {tileCapacity} from '../src/games/worship-me/engine/capacity';
import {serializeGame,deserializeGame} from '../src/games/worship-me/engine/serialization';
import {advanceOneAIDecision} from '../src/games/worship-me/ai/advance';
import type {GameState,PlayerColor,VillagerColor} from '../src/games/worship-me/engine/types';
import * as rng from '../src/games/worship-me/engine/rng';

function scenario(villagers:VillagerColor[]=['red','red'],priests:PlayerColor[]=[]){
 const s=createGame([{name:'Red',color:'red'},{name:'Yellow',color:'yellow'},{name:'Blue',color:'blue'}],'v10-home');
 for(const c of s.board){c.villagers=[];c.priests=[]}
 const h=s.board.find(c=>c.id==='1,1')!;h.visibleKind='home';h.hiddenKind='home';h.villagers=[...villagers];h.priests=[...priests];h.bread=1;
 return{s,h,q:s.board.find(c=>c.visibleKind==='square')!};
}
function neutralCap(s:GameState,n=10){let remaining=n;for(const c of s.board.filter(c=>c.id!=='1,1'&&c.visibleKind==='hidden')){c.visibleKind=c.hiddenKind!;const count=Math.min(4,remaining);c.villagers=Array(count).fill('neutral');remaining-=count;if(!remaining)break}}
function finishRound(s:GameState){const round=s.round;while(s.phase==='placement'&&s.round===round)s=applyAction(s,{type:'endTurn',playerId:s.turnOrder[s.currentPlayerIndex]});return s}
describe('v10 Home probability contracts',()=>{
 it.each([
  [['red','yellow'],undefined,{red:1,yellow:1}],
  [['red','neutral'],undefined,{red:1,neutral:1}],
  [['red','yellow'],'blue',{red:3,yellow:3,blue:3,neutral:3}],
  [['red','yellow'],'red',{red:6,yellow:3,neutral:3}],
  [['red','neutral'],'red',{red:6,neutral:2}],
  [['red','neutral'],'blue',{red:3,blue:3,neutral:2}],
 ] as [VillagerColor[],PlayerColor|undefined,Record<string,number>][])('uses exact integer tickets for %j Blessed %s',(colors,bless,expected)=>{
  const {h}=scenario(colors);expect(Object.fromEntries(homeBirthWeights(h,bless).map(w=>[w.color,w.tickets]))).toEqual(expected);
 });
 it.each(['red','neutral'] as const)('same-color %s is guaranteed without consuming RNG',color=>{const {s,h,q}=scenario([color,color]),before=s.rngState;const [birth]=resolveHomeBirths(s);expect(q.villagers).toEqual([color]);expect(h.bread).toBe(0);expect(birth.baseBirthMode).toBe('guaranteed');expect(s.rngState).toBe(before)});
 it.each([
  [['red'],['red'],true],
  [[],['red','red'],true],
  [['yellow'],['red'],false],
  [['neutral'],['red'],false],
  [[],['red','yellow'],false],
 ] as [VillagerColor[],PlayerColor[],boolean][])('Priest compatibility %j / %j is %s',(villagers,priests,compatible)=>{
  const {s,h,q}=scenario(villagers,priests);h.tileModifier={kind:'bless',playerId:'p1'};const [birth]=resolveHomeBirths(s);expect(birth.priestCompatibility).toBe(compatible);expect(birth.eligible).toBe(compatible);expect(h.bread).toBe(compatible?0:1);expect(q.villagers).toEqual(compatible?['red']:[]);if(!compatible)expect(birth.blockedReason).toBe('incompatible');
 });
 it('maps each integer ticket to the exact approved mixed Blessed outcome in one RNG decision',()=>{
  for(const [colors,bless] of [[['red','yellow'],'blue'],[['red','yellow'],'red'],[['red','neutral'],'red'],[['red','neutral'],'blue']] as [VillagerColor[],PlayerColor][]){
   const {h}=scenario(colors),weights=homeBirthWeights(h,bless),total=weights.reduce((n,w)=>n+w.tickets,0),actual:Record<string,number>={};
   for(let ticket=0;ticket<total;ticket++){const {s,h}=scenario(colors);h.tileModifier={kind:'bless',playerId:s.players.find(p=>p.color===bless)!.id};const spy=vi.spyOn(rng,'next').mockReturnValue([(ticket+.5)/total,123]);try{const [birth]=resolveHomeBirths(s);actual[birth.selectedNewbornColor!]=(actual[birth.selectedNewbornColor!]??0)+1;expect(spy).toHaveBeenCalledTimes(1);expect(s.rngState).toBe(123);expect(birth.breadConsumed).toBe(1);}finally{spy.mockRestore()}}
   expect(actual).toEqual(Object.fromEntries(weights.map(w=>[w.color,w.tickets])));
  }
 });
 it('reaches every mixed outcome using real deterministic canonical RNG',()=>{const outcomes=new Set();for(let seed=0;seed<512;seed++){const {s,h}=scenario(['red','yellow']);s.rngState=rng.hashSeed('birth-'+seed);h.tileModifier={kind:'bless',playerId:'p3'};outcomes.add(resolveHomeBirths(s)[0].selectedNewbornColor)}expect([...outcomes].sort()).toEqual(['blue','neutral','red','yellow'])});
});
describe('direct newborns and Neutral cap',()=>{
 it.each(['p1','p3'])('Bless %s preserves a guaranteed Red newborn and adds Neutral on Home',blesser=>{const {s,h,q}=scenario();h.tileModifier={kind:'bless',playerId:blesser};const [birth]=resolveHomeBirths(s);expect(q.villagers).toEqual(['red']);expect(h.villagers).toEqual(['red','red','neutral']);expect(birth).toMatchObject({normalBirthEnteredSquare:true,bonusNeutralAddedToHome:true});expect(resolveFallbackNeutral(s,true).blockedReason).toBe('home-birth-added')});
 it('Neutral + Neutral Blessed produces two Neutrals in their separate destinations',()=>{const {s,h,q}=scenario(['neutral','neutral']);h.tileModifier={kind:'bless',playerId:'p1'};resolveHomeBirths(s);expect(q.villagers).toEqual(['neutral']);expect(h.villagers).toEqual(['neutral','neutral','neutral'])});
 it('full Square consumes Bread and loses the normal newborn without deferred state',()=>{const {s,h,q}=scenario();q.villagers=Array(tileCapacity(s,q)).fill('red');const before=s.board.reduce((n,c)=>n+occupancy(c),0);const [birth]=resolveHomeBirths(s);expect(birth).toMatchObject({normalBirthAttempted:true,normalBirthEnteredSquare:false,blockedReason:'square-full',breadConsumed:1});expect(h.bread).toBe(0);expect(s.board.reduce((n,c)=>n+occupancy(c),0)).toBe(before);expect(resolveFallbackNeutral(s,false).blockedReason).toBe('square-at-capacity')});
 it('a bonus on Home still succeeds when the normal birth cannot enter Square',()=>{const {s,h,q}=scenario();q.villagers=Array(tileCapacity(s,q)).fill('red');h.tileModifier={kind:'bless',playerId:'p1'};const [birth]=resolveHomeBirths(s);expect(birth).toMatchObject({normalBirthEnteredSquare:false,bonusNeutralAddedToHome:true});expect(resolveFallbackNeutral(s,true).blockedReason).toBe('home-birth-added')});
 it('a selected Neutral at the cap is blocked without reroll',()=>{const {s,h,q}=scenario(['red','yellow']);neutralCap(s);h.tileModifier={kind:'bless',playerId:'p3'};const spy=vi.spyOn(rng,'next').mockReturnValue([.99,123]);try{const [birth]=resolveHomeBirths(s);expect(birth).toMatchObject({selectedNewbornColor:'neutral',blockedReason:'neutral-cap',normalBirthEnteredSquare:false});expect(spy).toHaveBeenCalledTimes(1);expect(h.bread).toBe(0);expect(q.villagers).toEqual([]);expect(countNeutralsInPlay(s)).toBe(10)}finally{spy.mockRestore()}});
 it('blocks the bonus at the Neutral cap without replacing it',()=>{const {s,h,q}=scenario();neutralCap(s);h.tileModifier={kind:'bless',playerId:'p1'};expect(resolveHomeBirths(s)[0]).toMatchObject({normalBirthEnteredSquare:true,bonusNeutralAttempted:true,bonusNeutralAddedToHome:false,bonusNeutralBlockedReason:'neutral-cap'});expect(q.villagers).toEqual(['red']);expect(h.villagers).toEqual(['red','red'])});
 it.each(['smite','occupancy','bread'] as const)('rejects ineligible Home: %s',reason=>{const {s,h,q}=scenario();if(reason==='smite')h.tileModifier={kind:'smite',playerId:'p1'};if(reason==='occupancy')h.villagers.pop();if(reason==='bread')h.bread=0;const before=h.bread;expect(resolveHomeBirths(s)[0].eligible).toBe(false);expect(h.bread).toBe(before);expect(q.villagers).toEqual([])});
});
describe('current-round Home ordering',()=>{
 function homes(){const {s,h,q}=scenario(['red','yellow']);s.roundFirstPlayerId='p3';s.direction=1;q.villagers=Array(tileCapacity(s,q)-1).fill('red');const blue=s.board.find(c=>c.id==='1,2')!,neutral=s.board.find(c=>c.id==='1,3')!;for(const c of [blue,neutral]){c.visibleKind='home';c.hiddenKind='home';c.bread=1}blue.villagers=['blue','red'];neutral.villagers=['neutral','neutral'];return{s,h,q,blue,neutral}}
 it('resolves represented earlier player first; Neutral-only last',()=>{const {s,h,blue,neutral}=homes();expect(roundPlayerOrder(s)).toEqual(['p3','p1','p2']);expect(homePriority(s,h)).toBe('p1');expect(homePriority(s,blue)).toBe('p3');expect(homePriority(s,neutral)).toBeUndefined();const results=resolveHomeBirths(s);expect(results.map(r=>r.cellId)).toEqual([blue.id,h.id,neutral.id]);expect(results.map(r=>r.normalBirthEnteredSquare)).toEqual([true,false,false])});
 it('Bless owns priority and currentPlayerIndex changes do not corrupt it',()=>{const {s,h,blue}=homes();h.tileModifier={kind:'bless',playerId:'p2'};s.currentPlayerIndex=1;expect(homePriority(s,h)).toBe('p2');expect(resolveHomeBirths(s).map(r=>r.productionPriorityPlayerId)).toEqual(['p3','p2',undefined]);expect(blue.id).toBe('1,2')});
 it('reverse direction reverses applicable player priority',()=>{const {s,h}=homes();s.direction=-1;expect(roundPlayerOrder(s)).toEqual(['p3','p2','p1']);expect(homePriority(s,h)).toBe('p2')});
 it('ties resolve by board coordinate even if board array is reversed',()=>{const {s,h,blue}=homes();blue.villagers=['red','red'];s.board.reverse();expect(resolveHomeBirths(s).map(r=>r.cellId).slice(0,2)).toEqual([h.id,blue.id])});
 it('captures each new round first player after direction effects',()=>{const {s}=homes();s.persistentFirstPlayerId='p2';s.pendingDirectionFlip=true;startNextRound(s);expect(s.roundFirstPlayerId).toBe('p2');expect(roundPlayerOrder(s)).toEqual(['p2','p1','p3'])});
});
describe('Priest arrival and ordinary Temple trigger',()=>{
 it('converts once per round, at most twice per game, always arriving even beyond Square capacity',()=>{const {s,q}=scenario([]);const p=s.players[0],t=s.board.find(c=>c.id===p.templeCellId)!;t.villagers=Array(4).fill('red');q.villagers=Array(tileCapacity(s,q)).fill('yellow');createPriests(s);createPriests(s);expect(p.priestsCreated).toBe(1);expect(q.priests).toEqual(['red']);expect(occupancy(q)).toBe(tileCapacity(s,q)+1);expect(t.priests).toEqual([]);s.round++;createPriests(s);expect(p.priestsCreated).toBe(2);t.villagers.push('red');s.round++;createPriests(s);expect(p.priestsCreated).toBe(2);expect(deserializeGame(serializeGame(s))).toEqual(s)});
 it('two ordinary plus one Priest never satisfy the Temple trigger but all count in follower total',()=>{const {s}=scenario([]);const p=s.players[0],t=s.board.find(c=>c.id===p.templeCellId)!;for(const c of s.board)if(c.hiddenKind)c.visibleKind=c.hiddenKind;t.villagers=['red','red'];t.priests=['red'];expect(ordinaryVillagersInOwnTemple(s,p)).toBe(2);expect(followerTotal(s,p)).toBe(3);expect(checkVictory(s).templeTriggerSatisfied).toBe(false)});
 it.each([[3,0,2,false],[4,0,3,true],[3,2,3,true]])('%i ordinary with %i previous Priests leaves %i ordinary; trigger %s',(ordinary,created,remaining,trigger)=>{
  let {s}=scenario([]);for(const c of s.board)if(c.hiddenKind)c.visibleKind=c.hiddenKind;const p=s.players[0];p.priestsCreated=created;s.board.find(c=>c.id===p.templeCellId)!.villagers=Array(ordinary).fill('red');s=finishRound(s);expect(ordinaryVillagersInOwnTemple(s,s.players[0])).toBe(remaining);const check=s.history.events.find(e=>e.type==='victoryCheck')!;expect(check.data.templeTriggerSatisfied).toBe(trigger);expect(check.data.followerTotals).toMatchObject({p1:ordinary});
 });
 it('Priest arrival is not a Home birth but may consume the final fallback capacity',()=>{let {s,q}=scenario([]);q.villagers=Array(tileCapacity(s,q)-1).fill('yellow');s.board.find(c=>c.id===s.players[0].templeCellId)!.villagers=['red','red','red'];s=finishRound(s);const fallback=s.history.events.find(e=>e.data.type==='fallbackNeutral')!;expect(fallback.data).toMatchObject({anyHomeVillagerAdded:false,neutralAdded:0,blockedReason:'square-at-capacity'})});
});
describe('v10 canonical compatibility and public secrecy',()=>{
 it('creates only current fields and rejects v9 at engine and AI entries',()=>{const s=createGame(2,'compat');expect(s.schemaVersion).toBe(10);expect(s).not.toHaveProperty('newVillagerBag');expect(s.config).not.toHaveProperty('endRoundDrawsPerPlayer');const old={...s,schemaVersion:9};expect(()=>deserializeGame(JSON.stringify(old))).toThrow(/v10/);expect(()=>advanceOneAIDecision(old)).toThrow()});
});

describe('v10 automatic integration, AI and metrics',()=>{
 it.each(['red','neutral','bonus'] as const)('successful %s Home addition suppresses fallback in the reducer',kind=>{
  let {s,h,q}=scenario(kind==='neutral'?['neutral','neutral']:['red','red']);
  if(kind==='bonus'){q.villagers=Array(tileCapacity(s,q)).fill('yellow');h.tileModifier={kind:'bless',playerId:'p1'}}
  s=finishRound(s);expect(s.history.events.find(e=>e.data.type==='fallbackNeutral')?.data).toMatchObject({anyHomeVillagerAdded:true,neutralAdded:0,blockedReason:'home-birth-added'});
 });
 it('Priest relocation with remaining capacity does not suppress fallback',()=>{let {s}=scenario([]);s.board.find(c=>c.id===s.players[0].templeCellId)!.villagers=['red','red','red'];s=finishRound(s);expect(s.history.events.find(e=>e.data.type==='fallbackNeutral')?.data).toMatchObject({anyHomeVillagerAdded:false,neutralAdded:1})});
 it.each(['neutral','yellow'] as const)('conversion of %s preserves board pawn count with no replacement',color=>{const {s,h}=scenario([color]),to=s.board.find(c=>c.id==='1,2')!;to.visibleKind='farm';const before=s.board.reduce((n,c)=>n+occupancy(c),0),neutrals=countNeutralsInPlay(s);applyBlessEdgeChoice(s,{type:'placeEdge',kind:'bless',from:h.id,to:to.id,playerId:'p1'},{from:h.id,to:to.id,moverColor:color,...(color==='neutral'?{neutral:true}:{opponent:true})});expect(s.board.reduce((n,c)=>n+occupancy(c),0)).toBe(before);expect(countNeutralsInPlay(s)).toBe(neutrals+(color==='neutral'?-1:1));expect(to.villagers).toEqual([color==='neutral'?'red':'neutral'])});
 it('AI uses ordinary Temple counts and anticipates conversion before victory',()=>{const {s}=scenario([]),p=s.players[0],temple=s.board.find(c=>c.id===p.templeCellId)!;temple.villagers=['red','red'];temple.priests=['red'];expect(templeState(s,p)).toMatchObject({followers:2,totalFollowers:3,triggerReady:false,triggerTarget:4});temple.villagers.push('red');expect(templeState(s,p).triggerReady).toBe(false);p.priestsCreated=2;expect(templeState(s,p)).toMatchObject({triggerReady:true,triggerTarget:3})});
 it('AI does not value incompatible Home production or a blocked normal Square entry',()=>{const {s,h,q}=scenario(['yellow'],['red']);expect(marginalProduction(h,s,'bless')).toBe(0);h.villagers=['red'];q.villagers=Array(tileCapacity(s,q)).fill('red');expect(marginalProduction(h,s,'smite')).toBe(0);expect(marginalProduction(h,s,'bless')).toBe(1)});
 it('simulation metrics replay deterministically and agree with structured Home/fallback history',()=>{const options={seed:'v10-metrics',players:['balanced','growth'] as const,maxRounds:15,maxActions:600,trace:true};const a=simulateGame({...options,players:[...options.players]}),b=simulateGame({...options,players:[...options.players]});expect(a.errors).toEqual([]);for(const key of ['homeBirths','bonusNeutrals','fallbackNeutrals','blockedBirthEntries','rounds','peakNeutralCount'] as const)expect(a[key]).toBe(b[key]);const homes=a.history!.events.filter(e=>e.type==='production'&&e.data.tileType==='home').map(e=>e.data.homeBirth as {normalBirthEnteredSquare:boolean;bonusNeutralAddedToHome:boolean});expect(a.homeBirths).toBe(homes.filter(h=>h.normalBirthEnteredSquare).length);expect(a.bonusNeutrals).toBe(homes.filter(h=>h.bonusNeutralAddedToHome).length);expect(a.fallbackNeutrals).toBe(a.history!.events.filter(e=>e.data.type==='fallbackNeutral').reduce((n,e)=>n+Number(e.data.neutralAdded),0));expect(a.peakNeutralCount).toBeLessThanOrEqual(10)});
});
