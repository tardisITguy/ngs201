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

describe('NGS identity',()=>{
 it('trims, validates, authenticates, and persists only the display name',async()=>{const values=new Map<string,string>(),storage={setItem:(key:string,value:string)=>values.set(key,value),getItem:(key:string)=>values.get(key)??null},ensure=vi.fn().mockResolvedValue({});expect(validateDisplayName('   ')).toMatch(/required/);expect(validateDisplayName('x'.repeat(51))).toMatch(/50/);await expect(saveIdentity('  Test Host  ',storage,ensure)).resolves.toBe('Test Host');expect(ensure).toHaveBeenCalledOnce();expect(values.get(PLAYER_DISPLAY_NAME_KEY)).toBe('Test Host');expect([...values.keys()]).toEqual([PLAYER_DISPLAY_NAME_KEY]);expect(getDisplayName(storage)).toBe('Test Host');});
});

describe('History routes',()=>{
 it.each([['/','identity'],['/games','games'],['/games/worship-me','worship-me'],['/room/ABC234','room']])('resolves %s', (path,name)=>expect(resolveRoute(path).name).toBe(name));
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
 it('reads only rooms and room_players and marks the host',async()=>{const tables:string[]=[];const room={select:()=>room,eq:()=>room,maybeSingle:async()=>({data:{id:'r',code:'ABC234',status:'lobby',game_id:'g',host_user_id:'host-1'},error:null})};const players={select:()=>players,eq:()=>players,order:async()=>({data:[{user_id:'host-1',display_name:'Test Host',player_color:null,turn_order:null,is_ready:false}],error:null})};const client={auth,from:(table:string)=>{tables.push(table);return table==='rooms'?room:players;}} as unknown as SupabaseClient;const result=await getLobby('abc234',client);expect(tables).toEqual(['rooms','room_players']);expect(tables).not.toContain('room_states');expect(result.room.code).toBe('ABC234');expect(result.players[0]).toMatchObject({displayName:'Test Host',isHost:true});});
 it('sanitizes inaccessible rooms',async()=>{const room={select:()=>room,eq:()=>room,maybeSingle:async()=>({data:null,error:Error('postgres detail')})};const client={auth,from:()=>room} as unknown as SupabaseClient;await expect(getLobby('ABC234',client)).rejects.toEqual(new LobbyReadError());});
});

describe('security and hosting source audit',()=>{
 it('keeps browser source read-only and canonical state out of lobby code',()=>{const shell=readFileSync(new URL('../src/platform/shell.ts',import.meta.url),'utf8'),lobby=readFileSync(new URL('../src/platform/rooms/lobby.ts',import.meta.url),'utf8');expect(shell+lobby).not.toMatch(/\.insert\(|\.update\(|\.delete\(|\.upsert\(/);expect(lobby).not.toContain("from('room_states')");expect(shell).not.toMatch(/host_user_id|service.role|secret.key/i);expect(shell).toContain('disabled');});
 it('has the Hostinger fallback source',()=>{const file=new URL('../public/.htaccess',import.meta.url);expect(readFileSync(file,'utf8')).toContain('RewriteRule . /index.html [L]');});
});
