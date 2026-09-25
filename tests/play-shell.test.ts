import {readFileSync} from 'node:fs';
import {describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {getDisplayName,PLAYER_DISPLAY_NAME_KEY,saveIdentity,validateDisplayName} from '../src/platform/identity';
import {createRouter,resolveRoute} from '../src/platform/router';
import {listActiveGames} from '../src/platform/games/catalog';
import {createHostAction} from '../src/platform/rooms/host';
import {getLobby,LobbyReadError} from '../src/platform/rooms/lobby';

const session={access_token:'token',user:{id:'host-1'}};
const auth={getSession:vi.fn().mockResolvedValue({data:{session},error:null})};
const shellSource=readFileSync(new URL('../src/platform/shell.ts',import.meta.url),'utf8');
const shellCss=readFileSync(new URL('../src/platform/colorSelection.css',import.meta.url),'utf8');

describe('NGS identity',()=>{
 it('trims, validates, authenticates, and persists only the display name',async()=>{const values=new Map<string,string>(),storage={setItem:(key:string,value:string)=>values.set(key,value),getItem:(key:string)=>values.get(key)??null},ensure=vi.fn().mockResolvedValue({});expect(validateDisplayName('   ')).toMatch(/required/);expect(validateDisplayName('x'.repeat(51))).toMatch(/50/);await expect(saveIdentity('  Test Host  ',storage,ensure)).resolves.toBe('Test Host');expect(ensure).toHaveBeenCalledOnce();expect(values.get(PLAYER_DISPLAY_NAME_KEY)).toBe('Test Host');expect([...values.keys()]).toEqual([PLAYER_DISPLAY_NAME_KEY]);expect(getDisplayName(storage)).toBe('Test Host');});
});

describe('History routes',()=>{
 it.each([['/','identity'],['/games','games'],['/games/worship-me','worship-me'],['/games/worship-me/join','worship-me-join'],['/room/ABC234','room']])('resolves %s', (path,name)=>expect(resolveRoute(path).name).toBe(name));
 it('renders pushes and popstate navigation',()=>{let path='/',pop=()=>{},pushes=0;const seen:string[]=[];const win={location:{get pathname(){return path}},history:{pushState:(_d:unknown,_t:string,url?:string|URL|null)=>{path=String(url);pushes++;}},addEventListener:(_type:'popstate',listener:()=>void)=>{pop=listener;}};const router=createRouter(win,route=>seen.push(route.name));router.start();router.navigate('/games');path='/';pop();expect(pushes).toBe(1);expect(seen).toEqual(['identity','games','identity']);});
});

describe('catalog read model',()=>{
 it('queries active games with select only and excludes non-active records',async()=>{const calls:string[]=[];const chain={select:(fields:string)=>{calls.push(`select:${fields}`);return chain;},eq:(field:string,value:string)=>{calls.push(`eq:${field}:${value}`);return chain;},order:async()=>({data:[{id:'1',slug:'worship-me',name:'Worship Me!',status:'active'},{id:'2',slug:'off',name:'Off',status:'disabled'}],error:null})};const client={auth,from:(table:string)=>{calls.push(`from:${table}`);return chain;}} as unknown as SupabaseClient;await expect(listActiveGames(client)).resolves.toEqual([{id:'1',slug:'worship-me',name:'Worship Me!',status:'active'}]);expect(calls).toEqual(['from:games','select:id,slug,name,status','eq:status:active']);expect(calls.join(' ')).not.toMatch(/insert|update|delete|upsert/);});
 it('returns a safe error',async()=>{const chain={select:()=>chain,eq:()=>chain,order:async()=>({data:null,error:Error('database detail')})};const client={auth,from:()=>chain} as unknown as SupabaseClient;await expect(listActiveGames(client)).rejects.toThrow('We could not load the games catalog.');});
});

describe('host flow',()=>{
 it('sends only slug and name, blocks duplicate in-flight calls, and permits a later call',async()=>{let resolve!:Function;const command=vi.fn().mockImplementation(()=>new Promise(r=>resolve=r));const host=createHostAction(command);const first=host('Host');await expect(host('Host')).resolves.toBeUndefined();expect(command).toHaveBeenCalledWith({gameSlug:'worship-me',displayName:'Host'});expect(command.mock.calls[0][0]).not.toHaveProperty('host_user_id');resolve({room:{id:'r',code:'ABC234',gameId:'g',status:'lobby'}});await first;command.mockResolvedValueOnce({room:{id:'r2',code:'XYZ789',gameId:'g',status:'lobby'}});await host('Host');expect(command).toHaveBeenCalledTimes(2);});
});

describe('lobby read model',()=>{
 it('reads ordered humans plus separate AI participants and marks the human host',async()=>{const tables:string[]=[];const room={select:()=>room,eq:()=>room,maybeSingle:async()=>({data:{id:'r',code:'ABC234',status:'lobby',game_id:'g',host_user_id:'host-1',join_mode:'public',room_name:'The Last Temple',games:{max_players:8}},error:null})};const humans={select:()=>humans,eq:()=>humans,order:()=>humans,then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:[{user_id:'host-1',display_name:'Test Host',player_color:null,turn_order:null,is_ready:false,joined_at:'now'}],error:null}).then(resolve)};const bots={select:()=>bots,eq:()=>bots,order:async()=>({data:[{id:'11111111-1111-4111-8111-111111111111',bot_number:1,player_color:'red',turn_order:null,bot_strategy:'balanced'}],error:null})};const client={auth,from:(table:string)=>{tables.push(table);return table==='rooms'?room:table==='room_players'?humans:bots;}} as unknown as SupabaseClient;const result=await getLobby('abc234',client);expect(tables).toEqual(['rooms','room_players','room_ai_players']);expect(tables).not.toContain('room_states');expect(result.room.code).toBe('ABC234');expect(result.room.joinMode).toBe('public');expect(result.room.roomName).toBe('The Last Temple');expect(result.players).toHaveLength(2);expect(result.players[0]).toMatchObject({control:'human',displayName:'Test Host',isHost:true});expect(result.players[1]).toMatchObject({control:'ai',displayName:'AI 1'});});
 it('sanitizes inaccessible rooms',async()=>{const room={select:()=>room,eq:()=>room,maybeSingle:async()=>({data:null,error:Error('postgres detail')})};const client={auth,from:()=>room} as unknown as SupabaseClient;await expect(getLobby('ABC234',client)).rejects.toEqual(new LobbyReadError());});
});

describe('compact lobby presentation',()=>{
 it('groups real and future actions in one Lobby Controls strip',()=>{
  const controls=shellSource.match(/<section class="lobby-controls"[\s\S]*?<\/section>/)?.[0]??'';
  expect(controls).toContain('LOBBY CONTROLS');
  expect(controls).toContain('lobby-controls__room');
  expect(controls).toContain('lobby-controls__actions');
  expect(controls).toContain('data-copy');
  expect(controls).toContain('data-leave');
  expect(shellSource).toContain('ROOM NAME');
  expect(controls).toContain('data-ready');
  expect(controls).toContain('${startGame}');
  expect(shellSource).toContain('START GAME');
  expect(controls.match(/disabled/g)?.length).toBeGreaterThanOrEqual(1);
  expect(shellSource.indexOf('data-leave')).toBeGreaterThan(shellSource.indexOf('class="lobby-controls"'));
 });

 it('activates trusted room naming while keeping unrelated trusted commands unchanged',()=>{
  expect(shellSource).toContain('data-room-name');
  expect(shellSource).toContain('data-save-room-name');
  expect(shellSource).toContain("command:{type:'setRoomName',roomName:value}");
  expect(shellSource).toContain("leave({roomCode:lobby.room.code})");
  expect(shellSource).toContain('setColor({roomCode:lobby.room.code,playerColor})');
 });

 it('places Players and Chat together in a responsive equal-column container',()=>{
  expect(shellSource).toMatch(/<section class="lobby-content-grid"><div class="panel players-panel">[\s\S]*?\$\{chatPanel\(\)\}/);
  expect(shellCss).toContain('grid-template-columns:minmax(0,1fr) minmax(0,1fr)');
  expect(shellCss).toMatch(/@media\(max-width:700px\)[\s\S]*?\.lobby-content-grid\{grid-template-columns:1fr\}/);
 });
});

describe('security and hosting source audit',()=>{
 it('keeps browser source read-only and canonical state out of lobby code',()=>{const lobby=readFileSync(new URL('../src/platform/rooms/lobby.ts',import.meta.url),'utf8'),join=readFileSync(new URL('../src/platform/rooms/joinRoom.ts',import.meta.url),'utf8'),leave=readFileSync(new URL('../src/platform/rooms/leaveRoom.ts',import.meta.url),'utf8');expect(shellSource+lobby+join+leave).not.toMatch(/\.insert\(|\.update\(|\.delete\(|\.upsert\(/);expect(lobby).not.toContain("from('room_states')");expect(join+leave).not.toMatch(/\.from\(['"](?:rooms|room_players|room_states)/);expect(shellSource+join+leave).not.toMatch(/host_user_id|service.role|secret.key/i);});
 it('has the Hostinger fallback source',()=>{const file=new URL('../public/.htaccess',import.meta.url);expect(readFileSync(file,'utf8')).toContain('RewriteRule . /index.html [L]');});
});
