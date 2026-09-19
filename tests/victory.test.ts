import {describe,expect,it} from 'vitest';
import {checkVictory} from '../src/games/worship-me/engine/victory';
import {createGame} from '../src/games/worship-me/engine/setup';
import type {GameState} from '../src/games/worship-me/engine/types';

function scenario(totals:number[],temples:number[],faceUp=true){
 const s=createGame(totals.length,'victory-correction',{randomizeFirstPlayer:false,randomizeDirection:false});
 for(const c of s.board){c.villagers=[];c.priests=[];if(c.visibleKind==='hidden'&&faceUp)c.visibleKind=c.hiddenKind!}
 for(let i=0;i<s.players.length;i++){const p=s.players[i],temple=s.board.find(c=>c.id===p.templeCellId)!;temple.villagers.push(...Array(temples[i]).fill(p.color));let remaining=totals[i]-temples[i];for(const c of s.board.filter(c=>c.id!==p.templeCellId&&c.visibleKind!=='temple'))while(remaining>0&&c.villagers.length+c.priests.length<4){c.villagers.push(p.color);remaining--}}
 return s;
}
function expectWinner(s:GameState,id:string,triggers:string[]){const result=checkVictory(s);expect(result.gameEnds).toBe(true);expect(result.winnerId).toBe(id);expect(result.triggeringPlayerIds).toEqual(triggers);return result}

describe('Temple trigger and all-player victory scoring',()=>{
 it('seed-2 regression: Red triggers with 4 total but Purple wins with 10',()=>{const r=expectWinner(scenario([4,10],[3,1]),'p2',['p1']);expect(r.followerTotals).toEqual({p1:4,p2:10});expect(r.highestFollowerTotal).toBe(10)});
 it('triggering Red wins when Red also has the most followers',()=>expectWinner(scenario([8,6],[3,1]),'p1',['p1']));
 it('non-triggering Purple wins with the largest population',()=>expectWinner(scenario([5,9],[3,0]),'p2',['p1']));
 it('non-triggering Blue beats two Temple-trigger players',()=>expectWinner(scenario([7,10,12],[3,3,1]),'p3',['p1','p2']));
 it('does not end while any Village tile remains face down',()=>{const r=checkVictory(scenario([5,4],[3,0],false));expect(r.gameEnds).toBe(false);expect(r.reason).toBe('not-revealed')});
 it('does not end without a Temple trigger even after all land is revealed',()=>{const r=checkVictory(scenario([8,9],[2,1]));expect(r.gameEnds).toBe(false);expect(r.reason).toBe('no-temple-trigger')});
 it('preserves the documented unresolved tie across all players',()=>{const r=checkVictory(scenario([8,8],[3,1]));expect(r.gameEnds).toBe(true);expect(r.reason).toBe('tie');expect(r.winnerId).toBeUndefined()});
});
