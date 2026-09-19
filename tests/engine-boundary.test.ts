import {describe,expect,it} from 'vitest';
import {readFileSync,readdirSync} from 'node:fs';
import {createGame,getLegalActions,reducer,type GameState} from '../src/games/worship-me/engine';

function engineSources(directory:URL):URL[]{
 return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
  const child=new URL(entry.name+(entry.isDirectory()?'/':''),directory);
  return entry.isDirectory()?engineSources(child):entry.name.endsWith('.ts')?[child]:[];
 });
}

describe('Worship Me! engine boundary',()=>{
 it('runs through its public API without a browser environment',()=>{
  expect(typeof window).toBe('undefined');
  expect(typeof document).toBe('undefined');
  const initial:GameState=createGame(2,'engine-boundary',{randomizeFirstPlayer:false,randomizeDirection:false});
  const action=getLegalActions(initial).find(candidate=>candidate.type!=='endTurn')!;
  const next=reducer(initial,action);
  expect(next).not.toBe(initial);
  expect(next.actionQueue).toHaveLength(1);
  expect(initial.actionQueue).toHaveLength(0);
 });

 it('does not import UI, browser storage, networking, React, or Supabase',()=>{
  const root=new URL('../src/games/worship-me/engine/',import.meta.url);
  const forbidden=/\b(?:window|document|localStorage|sessionStorage|WebSocket|fetch)\b|from\s*['"](?:react|react-dom|@supabase\/|https?:)|import\s*['"](?:react|react-dom|@supabase\/|https?:)/;
  const violations=engineSources(root).flatMap(file=>{
   const source=readFileSync(file,'utf8');
   return forbidden.test(source)?[file.pathname]:[];
  });
  expect(violations).toEqual([]);
 });
});
