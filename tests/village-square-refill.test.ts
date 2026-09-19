import {describe,expect,it} from 'vitest';
import {createGame} from '../src/games/worship-me/engine/setup';
import {refillSquareWithResult,startNextRound} from '../src/games/worship-me/engine/reducer';
import {tileCapacity} from '../src/games/worship-me/engine/capacity';
import {countNeutralsInPlay} from '../src/games/worship-me/engine/neutrals';

function state(players=2){return createGame(players,'square-refill-test',{randomizeFirstPlayer:false,randomizeDirection:false})}
function square(s:ReturnType<typeof state>){return s.board.find(c=>c.visibleKind==='square')!}
function neutralCount(s:ReturnType<typeof state>){return square(s).villagers.filter(v=>v==='neutral').length}

describe('Village Square round-start refill',()=>{
 it('adds exactly one Neutral to an empty Square',()=>{const s=state();square(s).villagers=[];const result=refillSquareWithResult(s);expect(result).toMatchObject({villageSquareBefore:{neutralCount:0,coloredCount:0,priestCount:0},neutralAdded:1,refillBlockedReason:null,villageSquareAfter:{neutralCount:1}});expect(neutralCount(s)).toBe(1)});
 it('adds only one Neutral to partial occupancy, even above player count',()=>{const s=state(8);square(s).villagers=['neutral','neutral','neutral','neutral','neutral'];const result=refillSquareWithResult(s);expect(result.neutralAdded).toBe(1);expect(neutralCount(s)).toBe(6)});
 it('adds only one Neutral when multiple Village tiles remain unflipped',()=>{const s=state(8);square(s).villagers=[];expect(s.board.filter(c=>c.visibleKind==='hidden').length).toBeGreaterThan(1);const result=refillSquareWithResult(s);expect(result.neutralAdded).toBe(1);expect(neutralCount(s)).toBe(1)});
 it('grows gradually by one across successive round starts',()=>{const s=state(8);square(s).villagers=[];const counts:number[]=[];for(let i=0;i<4;i++){startNextRound(s);counts.push(neutralCount(s))}expect(counts).toEqual([1,2,3,4])});
 it('colored villager blocks refill',()=>{const s=state();square(s).villagers=['neutral','neutral',s.players[0].color];const result=refillSquareWithResult(s);expect(result.neutralAdded).toBe(0);expect(result.refillBlockedReason).toBe('colored-occupant-present');expect(square(s).villagers).toHaveLength(3)});
 it('Priest blocks refill',()=>{const s=state();square(s).villagers=['neutral','neutral'];square(s).priests=[s.players[0].color];const result=refillSquareWithResult(s);expect(result.neutralAdded).toBe(0);expect(result.refillBlockedReason).toBe('priest-present')});
 it('full Square blocks refill',()=>{const s=state();square(s).villagers=Array(tileCapacity(s,square(s))).fill('neutral');const result=refillSquareWithResult(s);expect(result.neutralAdded).toBe(0);expect(result.refillBlockedReason).toBe('square-at-capacity')});
 it('global Neutral cap blocks refill',()=>{const s=state();square(s).villagers=[];s.newVillagerBag=Array(10).fill('neutral');const result=refillSquareWithResult(s);expect(countNeutralsInPlay(s)).toBe(10);expect(result.neutralAdded).toBe(0);expect(result.refillBlockedReason).toBe('global-neutral-cap')});
 it('all Village tiles flipped blocks refill despite room and a sub-cap Neutral total',()=>{const s=state(8);square(s).villagers=['neutral','neutral'];for(const c of s.board)if(c.visibleKind==='hidden')c.visibleKind=c.hiddenKind!;expect(countNeutralsInPlay(s)).toBeLessThan(10);expect(tileCapacity(s,square(s))-square(s).villagers.length).toBeGreaterThan(0);const result=refillSquareWithResult(s);expect(result.neutralAdded).toBe(0);expect(result.refillBlockedReason).toBe('no-unflipped-tiles');expect(neutralCount(s)).toBe(2)});
 it('stops future refills after the final Village tile is flipped',()=>{const s=state(8);square(s).villagers=[];const hidden=s.board.filter(c=>c.visibleKind==='hidden');for(const c of hidden.slice(1))c.visibleKind=c.hiddenKind!;startNextRound(s);expect(neutralCount(s)).toBe(1);hidden[0].visibleKind=hidden[0].hiddenKind!;for(let i=0;i<3;i++)startNextRound(s);expect(neutralCount(s)).toBe(1);const starts=s.history.events.filter(e=>String(e.id).endsWith('-START'));expect(starts.slice(-3).every(e=>e.data.refillBlockedReason==='no-unflipped-tiles'&&e.data.neutralAdded===0)).toBe(true)});
 it('records structured refill details at round start',()=>{const s=state();square(s).villagers=['neutral','neutral'];startNextRound(s);const event=s.history.events.find(e=>e.id==='R2-START')!;expect(event.data).toMatchObject({villageSquareBefore:{neutralCount:2,coloredCount:0,priestCount:0},neutralAdded:1,refillBlockedReason:null,villageSquareAfter:{neutralCount:3,coloredCount:0,priestCount:0}})});
});
