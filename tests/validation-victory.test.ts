import {describe,expect,it} from 'vitest';
import {createVictoryRegression} from '../src/games/worship-me/ai/validationVictory';
import {exportPlayByPlay} from '../src/games/worship-me/engine/history';
import {deserializeGame,serializeGame} from '../src/games/worship-me/engine/serialization';

describe('v10 exported victory regression',()=>{
 it('processes four Red Temple Villagers through Priest creation before Purple wins',()=>{
  const state=createVictoryRegression(),[red,purple]=state.players;
  expect(state.schemaVersion).toBe(10);
  expect(state.phase).toBe('gameOver');
  expect(state.winnerId).toBe(purple.id);
  expect(red.priestsCreated).toBe(1);
  expect(red.lastPriestCreationRound).toBe(state.round);
  expect(state.board.find(cell=>cell.id===red.templeCellId)!.villagers).toEqual([red.color,red.color,red.color]);
  expect(state.board.find(cell=>cell.visibleKind==='square')!.priests).toEqual([red.color]);
  expect(deserializeGame(serializeGame(state))).toEqual(state);

  const artifact=JSON.parse(JSON.stringify(exportPlayByPlay(state)));
  const priests=artifact.events.find((event:any)=>event.data.type==='priestCreation');
  const fallback=artifact.events.find((event:any)=>event.data.type==='fallbackNeutral');
  const victory=artifact.events.find((event:any)=>event.type==='victoryCheck');
  expect(priests.data.priestsCreatedBefore[red.id]).toBe(0);
  expect(priests.data.priestLocationsBefore[red.id].temple.occupants.villagers).toEqual(Array(4).fill(red.color));
  expect(priests.data.priestLocationsAfter[red.id].temple.occupants.villagers).toEqual(Array(3).fill(red.color));
  expect(priests.ordinal).toBeLessThan(fallback.ordinal);
  expect(fallback.ordinal).toBeLessThan(victory.ordinal);
  expect(victory.data).toMatchObject({gameEndTriggered:true,triggeringPlayerIds:[red.id],winnerId:purple.id,followerTotals:{[red.id]:4,[purple.id]:10}});
  expect(artifact.metadata).toMatchObject({winnerId:purple.id,finalFollowerTotals:{[red.id]:4,[purple.id]:10},finalTempleFollowerTotals:{[red.id]:3,[purple.id]:1}});
 });
});
