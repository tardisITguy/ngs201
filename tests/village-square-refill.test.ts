import {describe,expect,it} from 'vitest';
import {createGame} from '../src/games/worship-me/engine/setup';
import {resolveFallbackNeutral,startNextRound,applyAction} from '../src/games/worship-me/engine/reducer';
import {tileCapacity} from '../src/games/worship-me/engine/capacity';
import {countNeutralsInPlay} from '../src/games/worship-me/engine/neutrals';
const state=()=>createGame(2,'fallback');
const square=(s:ReturnType<typeof state>)=>s.board.find(c=>c.visibleKind==='square')!;
describe('end-round fallback Neutral',()=>{
 it('adds exactly one when no Home added a pawn and face-down land remains',()=>{const s=state();square(s).villagers=[];expect(resolveFallbackNeutral(s,false)).toMatchObject({neutralAdded:1,blockedReason:null,squareOccupancyBefore:0});expect(square(s).villagers).toEqual(['neutral'])});
 it.each(['red','neutral'] as const)('allows existing %s ordinary occupants',color=>{const s=state();square(s).villagers=[color];expect(resolveFallbackNeutral(s).neutralAdded).toBe(1)});
 it('allows existing Priests if Square has normal capacity',()=>{const s=state();square(s).villagers=[];square(s).priests=['red'];expect(resolveFallbackNeutral(s).neutralAdded).toBe(1)});
 it('blocks at or above normal capacity',()=>{for(const extra of [0,1]){const s=state();square(s).villagers=Array(tileCapacity(s,square(s))+extra).fill('red');expect(resolveFallbackNeutral(s)).toMatchObject({neutralAdded:0,blockedReason:'square-at-capacity'})}});
 it('counts actual board Neutrals toward the cap',()=>{const s=state();square(s).villagers=[];const tiles=s.board.filter(c=>c.visibleKind==='hidden').slice(0,3);for(const [i,c] of tiles.entries()){c.visibleKind=c.hiddenKind!;c.villagers=Array(i===2?2:4).fill('neutral')}expect(countNeutralsInPlay(s)).toBe(10);expect(resolveFallbackNeutral(s).blockedReason).toBe('global-neutral-cap')});
 it('blocks when all Village land is face up, and resumes if land becomes hidden again',()=>{const s=state();for(const c of s.board)if(c.hiddenKind)c.visibleKind=c.hiddenKind;expect(resolveFallbackNeutral(s).blockedReason).toBe('no-facedown-tiles');s.board.find(c=>c.hiddenKind)!.visibleKind='hidden';expect(resolveFallbackNeutral(s).neutralAdded).toBe(1)});
 it('any successful Home addition suppresses fallback',()=>{expect(resolveFallbackNeutral(state(),true)).toMatchObject({neutralAdded:0,blockedReason:'home-birth-added'})});
 it('never refills during startNextRound',()=>{const s=state();square(s).villagers=[];for(let i=0;i<4;i++)startNextRound(s);expect(square(s).villagers).toEqual([])});
 it('runs once at end of a complete round and records structured history',()=>{let s=state();square(s).villagers=[];for(let i=0;i<2;i++)s=applyAction(s,{type:'endTurn',playerId:s.turnOrder[s.currentPlayerIndex]});expect(square(s).villagers).toEqual(['neutral']);const events=s.history.events.filter(e=>e.data.type==='fallbackNeutral');expect(events).toHaveLength(1);expect(events[0].data).toMatchObject({anyHomeVillagerAdded:false,facedownVillageTileExists:true,squareNormalCapacity:4,neutralAdded:1,neutralCountBefore:0})});
});
