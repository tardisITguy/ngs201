import {readFileSync,readdirSync} from 'node:fs';
import {describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {buildWorshipMeInitialState} from '../supabase/functions/start-game/candidate';
import {createStartGameAction,startGame,StartGameError} from '../src/platform/rooms/startGame';

const migration=readFileSync(new URL('../supabase/migrations/20260920000004_start_game.sql',import.meta.url),'utf8');
const core=readFileSync(new URL('../supabase/migrations/20260919190346_create_ngsllc_core.sql',import.meta.url),'utf8');
const edge=readFileSync(new URL('../supabase/functions/start-game/index.ts',import.meta.url),'utf8');
const candidate=readFileSync(new URL('../supabase/functions/start-game/candidate.ts',import.meta.url),'utf8');
const supabaseConfig=readFileSync(new URL('../supabase/config.toml',import.meta.url),'utf8');
const shell=readFileSync(new URL('../src/platform/shell.ts',import.meta.url),'utf8');
const lobby=readFileSync(new URL('../src/platform/rooms/lobby.ts',import.meta.url),'utf8');
const config=readFileSync(new URL('../src/games/worship-me/engine/config.ts',import.meta.url),'utf8');
const setup=readFileSync(new URL('../src/games/worship-me/engine/setup.ts',import.meta.url),'utf8');
const session={access_token:'token',user:{id:'host-1'}};
function clientWithInvoke(invoke:ReturnType<typeof vi.fn>):SupabaseClient{return{auth:{getSession:vi.fn().mockResolvedValue({data:{session},error:null})},functions:{invoke}} as unknown as SupabaseClient;}

describe('server-side Worship Me! candidate builder',()=>{
 it('directly reuses createGame and preserves ordered identity, seed, and initial invariants',()=>{
  expect(candidate).toContain("import {createGame");expect(candidate).not.toMatch(/function createGame|board:/);
  const state=buildWorshipMeInitialState([{control:'human',userId:'a',displayName:'Alice',playerColor:'red'},{control:'human',userId:'b',displayName:'Bob',playerColor:'blue'},{control:'human',userId:'c',displayName:'Carol',playerColor:'purple'}],'server-seed');
  expect(state).toMatchObject({schemaVersion:9,seed:'server-seed',round:1,phase:'placement',currentPlayerIndex:0,turnOrder:['p1','p2','p3']});
  expect(state.players.map(({id,name,color,control})=>({id,name,color,control}))).toEqual([{id:'p1',name:'Alice',color:'red',control:'human'},{id:'p2',name:'Bob',color:'blue',control:'human'},{id:'p3',name:'Carol',color:'purple',control:'human'}]);
  expect(state.board).toHaveLength(25);
 });
 it('uses Deno-resolvable TypeScript extensions throughout the shared setup import graph',()=>{
  const graph=['candidate.ts','../../../src/games/worship-me/engine/setup.ts','../../../src/games/worship-me/engine/config.ts','../../../src/games/worship-me/engine/board.ts','../../../src/games/worship-me/engine/neutrals.ts','../../../src/games/worship-me/engine/history.ts','../../../src/games/worship-me/engine/victory.ts'];
  expect(candidate).toContain("engine/setup.ts'");
  for(const source of [candidate,setup,...graph.slice(2).map(path=>readFileSync(new URL(path,new URL('../supabase/functions/start-game/',import.meta.url)),'utf8'))]){
   for(const match of source.matchAll(/from ['"](\.[^'"]+)['"]/g))expect(match[1]).toMatch(/\.ts$/);
  }
 });
 it('uses the authoritative engine limits and default non-random order',()=>{expect(config).toContain('playerMin:2,playerMax:8');expect(config).toContain('randomizeFirstPlayer:false');expect(config).toContain('randomizeDirection:false');});
});

describe('Start Game browser client',()=>{
 it('sends only normalized roomCode through the Edge Function',async()=>{const invoke=vi.fn().mockResolvedValue({data:{roomCode:'ABC234',status:'active',stateVersion:1},error:null});await expect(startGame({roomCode:' abc234 '},clientWithInvoke(invoke))).resolves.toEqual({roomCode:'ABC234',status:'active',stateVersion:1});expect(invoke).toHaveBeenCalledWith('start-game',{body:{roomCode:'ABC234'}});expect(invoke.mock.calls[0][1].body).toEqual({roomCode:'ABC234'});});
 it('sanitizes authorization/conflict failures',async()=>{for(const [status,message] of [[403,'Only the host can start the game.'],[409,'The lobby is not ready. Refresh and try again.']] as const){const invoke=vi.fn().mockResolvedValue({data:null,error:{context:{status},message:'SQL details'}});await expect(startGame({roomCode:'ABC234'},clientWithInvoke(invoke))).rejects.toEqual(new StartGameError(message));}});
 it('blocks duplicate in-flight starts',async()=>{let resolve!:(value:unknown)=>void;const command=vi.fn().mockImplementation(()=>new Promise(r=>{resolve=r;}));const action=createStartGameAction(command);const first=action({roomCode:'ABC234'});await expect(action({roomCode:'ABC234'})).resolves.toBeUndefined();expect(command).toHaveBeenCalledTimes(1);resolve({roomCode:'ABC234',status:'active',stateVersion:1});await first;});
});

describe('atomic Start migration',()=>{
 it('retains exactly one Start migration',()=>{const names=readdirSync(new URL('../supabase/migrations/',import.meta.url),{withFileTypes:true}).filter(e=>!e.isDirectory()&&e.name.endsWith('.sql')).map(e=>e.name).sort();expect(names.filter(name=>name.endsWith('_start_game.sql'))).toEqual(['20260920000004_start_game.sql']);expect(names).toContain('20260921000001_gameplay_mutation.sql');expect(names).toContain('20260922000000_realtime_game_sync.sql');expect(names).toContain('20260922000001_realtime_lobby_sync.sql');expect(names.at(-1)).toBe('20260922000002_multiplayer_ai_players.sql');expect(names).toHaveLength(13);});
 it('adds server min_players safely and preserves max semantics',()=>{expect(migration).toMatch(/add column min_players smallint;[\s\S]*?set min_players = 1[\s\S]*?set min_players = 2 where slug = 'worship-me'[\s\S]*?set not null/);expect(migration).toContain('min_players <= max_players');expect(migration).not.toMatch(/alter column max_players/);});
 it('locks the room before every authoritative final validation',()=>{const lock=migration.indexOf('for update of r;');expect(lock).toBeGreaterThan(0);for(const check of ["if v_room_status <> 'lobby'",'if v_host_user_id <> p_user_id','if v_player_count < v_min_players','not rp.is_ready','supported.game_id','if v_roster is distinct from p_expected_players'])expect(migration.indexOf(check,lock)).toBeGreaterThan(lock);});
 it('validates host/member, active lobby/game, limits, Ready, supported unique colors, and unassigned order',()=>{for(const text of ["v_room_status <> 'lobby'","v_game_status is distinct from 'active'",'v_host_user_id <> p_user_id','v_player_count < v_min_players','v_player_count > v_max_players','not rp.is_ready','rp.player_color is null','from public.game_player_colors','count(distinct rp.player_color)','rp.turn_order is not null'])expect(migration).toContain(text);});
 it('rejects missing/existing canonical state and unsafe versions',()=>{expect(migration).toContain('from public.room_states as rs');expect(migration).toContain('for update of rs');expect(migration).toContain('if not found');expect(migration).toContain('v_existing_state is not null or v_state_version <> 0');});
 it('defensively validates candidate schema and exact pN identity mapping',()=>{for(const text of ["'schemaVersion'","'players'","'turnOrder'","'phase' is distinct from 'placement'","'round'","'currentPlayerIndex'","'seed'","is distinct from 'p' || (index + 1)::text","'displayName'","'playerColor'","'control' is distinct from 'human'"])expect(migration).toContain(text);});
 it('uses null-safe required-field validation and requires player/roster objects',()=>{
  for(const text of ["p_game_state->>'phase' is distinct from 'placement'","jsonb_typeof(p_game_state->'players'->index) is distinct from 'object'","jsonb_typeof(p_expected_players->index) is distinct from 'object'","->>'id' is distinct from","->>'name' is distinct from","->>'color' is distinct from","->>'control' is distinct from 'human'","'turnOrder'->>index is distinct from"] )expect(migration).toContain(text);
  expect(migration).not.toMatch(/->>'(?:phase|id|name|color|control)'\s*<>/);
 });
 it('checks membership before revealing host, room status, or game eligibility',()=>{const member=migration.indexOf('if not exists (\n    select 1 from public.room_players as member');expect(member).toBeGreaterThan(0);for(const detail of ['if v_host_user_id <> p_user_id',"if v_room_status <> 'lobby'","if v_game_status is distinct from 'active'"])expect(migration.indexOf(detail)).toBeGreaterThan(member);expect(migration.slice(member,migration.indexOf('if v_host_user_id <> p_user_id'))).toContain("errcode = 'P0002'");});
 it('performs order, state/version, and active transition in one RPC transaction',()=>{expect(migration).toContain('row_number() over (order by rp.joined_at, rp.user_id) - 1');expect(migration).toContain('set turn_order = ordered.position');expect(migration).toContain('set game_state = p_game_state, state_version = 1');expect(migration).toContain("set status = 'active'");expect(migration.indexOf('set turn_order')).toBeLessThan(migration.indexOf('set game_state'));expect(migration.indexOf('set game_state')).toBeLessThan(migration.indexOf("set status = 'active'"));});
 it('does not change colors, Ready, or host and cannot overwrite state',()=>{expect(migration).not.toMatch(/set player_color|set is_ready|set host_user_id/);expect(migration).toContain('rs.game_state is null and rs.state_version = 0');expect(migration).toContain("errcode = 'P0005'");});
 it('is invoker, empty-search-path, and service-role-only',()=>{expect(migration).toContain('security invoker');expect(migration).toContain("set search_path = ''");for(const role of ['public','anon','authenticated','service_role'])expect(migration).toContain(`revoke execute on function public.start_game_server(text, uuid, jsonb, jsonb) from ${role}`);expect(migration).toContain('grant execute on function public.start_game_server(text, uuid, jsonb, jsonb) to service_role');});
 it('preserves room_states browser denial',()=>{expect(core).toContain('alter table public.room_states enable row level security');expect(core).toContain('revoke all on table public.room_states from public, anon, authenticated');expect(migration).not.toMatch(/grant select on table public.room_states to (?:anon|authenticated)/);});
});

describe('Start Edge and room UI',()=>{
 it('keeps JWT verification enabled for the Start Edge Function',()=>{expect(supabaseConfig).toMatch(/\[functions\.start-game\]\s*verify_jwt = true/);});
 it('accepts only roomCode and derives host identity from JWT',()=>{expect(edge).toContain('auth.getUser(token)');expect(edge).toContain('p_user_id:user.id');expect(edge).toContain("keys.length!==1||keys[0]!=='roomCode'");expect(edge).not.toMatch(/record\.(?:userId|hostUserId|roomId|players|colors|readiness|turnOrder|seed|gameState|config|stateVersion)/);});
 it('establishes membership before returning host or room-status details',()=>{const membership=edge.indexOf("from('room_players').select('user_id')"),missing=edge.indexOf("if(!membershipResult.data)return response(404,{error:'Room not found or unavailable'})"),host=edge.indexOf("if(roomResult.data.host_user_id!==user.id)return response(403"),status=edge.indexOf("if(roomResult.data.status!=='lobby')return response(409");expect(membership).toBeGreaterThan(0);expect(missing).toBeGreaterThan(membership);expect(host).toBeGreaterThan(missing);expect(status).toBeGreaterThan(missing);});
 it('uses stable privileged human-first and bot-number roster data, a server seed, createGame candidate, and final RPC',()=>{expect(edge).toContain(".order('joined_at').order('user_id')");expect(edge).toContain("from('room_ai_players')");expect(edge).toContain(".order('bot_number')");expect(edge).toContain('crypto.randomUUID()');expect(edge).toContain('buildWorshipMeInitialState(players,seed)');expect(edge).toContain("serverClient.rpc('start_game_server'");expect(edge).toContain('p_expected_players:players');expect(edge).toContain('p_game_state:gameState');});
 it('maps host, stale, readiness, duplicate, and unexpected errors safely',()=>{for(const code of ['P0002','P0003','P0004','P0005','P0006'])expect(edge).toContain(`error.code==='${code}'`);expect(edge).not.toMatch(/response\([^\n]*(?:error\.message|error\.details|error\.hint|error\.stack)/);});
 it('renders Start and Name Room only for host and enables Start only on advisory eligibility',()=>{expect(shell).toContain("const nameRoom=lobby.room.isCurrentUserHost?");expect(shell).toContain("const startGame=lobby.room.isCurrentUserHost?");expect(shell).toContain("data-start ${allReadyPreview?'':'disabled'}");expect(shell).toContain('defaultConfig.playerMin');expect(shell).toContain('await start({roomCode:lobby.room.code})');});
 it('routes active rooms to the trusted game view without canonical browser reads',()=>{expect(shell).toContain("if(lobby.room.status==='active')");expect(shell).toContain('void renderActiveGame(lobby.room.code)');expect(shell).toContain('renderBoard(view,{start:startCell,end:endCell},{interactive:canPlace})');expect(lobby).not.toContain("from('room_states')");});
});
