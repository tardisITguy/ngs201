import {readFileSync,readdirSync} from 'node:fs';
import {describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {createSetPlayerColorAction,setPlayerColor,SetPlayerColorError} from '../src/platform/rooms/setPlayerColor';
import {WORSHIP_ME_PLAYER_COLORS} from '../src/games/worship-me/ui/playerColors';

const migration=readFileSync(new URL('../supabase/migrations/20260920000002_player_color_selection.sql',import.meta.url),'utf8');
const core=readFileSync(new URL('../supabase/migrations/20260919190346_create_ngsllc_core.sql',import.meta.url),'utf8');
const lifecycle=readFileSync(new URL('../supabase/migrations/20260920000001_lobby_lifecycle.sql',import.meta.url),'utf8');
const edge=readFileSync(new URL('../supabase/functions/set-player-color/index.ts',import.meta.url),'utf8');
const shell=readFileSync(new URL('../src/platform/shell.ts',import.meta.url),'utf8');
const setup=readFileSync(new URL('../src/games/worship-me/engine/setup.ts',import.meta.url),'utf8');
const colorType=readFileSync(new URL('../src/games/worship-me/engine/types.ts',import.meta.url),'utf8');

const session={access_token:'token',user:{id:'player-1'}};
function clientWithInvoke(invoke:ReturnType<typeof vi.fn>):SupabaseClient{return{auth:{getSession:vi.fn().mockResolvedValue({data:{session},error:null})},functions:{invoke}} as unknown as SupabaseClient;}

describe('authoritative Worship Me! player colors',()=>{
 it('matches the existing engine type and setup order exactly',()=>{
  expect(WORSHIP_ME_PLAYER_COLORS).toEqual(['red','purple','blue','cyan','green','yellow','orange','black']);
  expect(setup).toContain("['red','purple','blue','cyan','green','yellow','orange','black']");
  for(const color of WORSHIP_ME_PLAYER_COLORS)expect(colorType).toContain(`'${color}'`);
 });
});

describe('Set Player Color browser client',()=>{
 it('sends only roomCode and playerColor through the Edge Function',async()=>{
  const invoke=vi.fn().mockResolvedValue({data:{roomCode:'ABC234',playerColor:'blue',changed:true},error:null});
  await expect(setPlayerColor({roomCode:' abc234 ',playerColor:'blue'},clientWithInvoke(invoke))).resolves.toEqual({roomCode:'ABC234',playerColor:'blue',changed:true});
  expect(invoke).toHaveBeenCalledWith('set-player-color',{body:{roomCode:'ABC234',playerColor:'blue'}});
  expect(invoke.mock.calls[0][1].body).toEqual({roomCode:'ABC234',playerColor:'blue'});
  expect(invoke.mock.calls[0][1].body).not.toHaveProperty('userId');
 });

 it('supports clearing and maps stale-client conflict safely',async()=>{
  const clear=vi.fn().mockResolvedValue({data:{roomCode:'ABC234',playerColor:null,changed:true},error:null});
  await expect(setPlayerColor({roomCode:'ABC234',playerColor:null},clientWithInvoke(clear))).resolves.toMatchObject({playerColor:null});
  const conflict=vi.fn().mockResolvedValue({data:null,error:{context:{status:409},message:'constraint room_players_room_color_uidx'}});
  await expect(setPlayerColor({roomCode:'ABC234',playerColor:'blue'},clientWithInvoke(conflict))).rejects.toEqual(new SetPlayerColorError('That color is no longer available.'));
 });

 it('blocks duplicate in-flight selection commands',async()=>{
  let resolve!:(value:unknown)=>void;const command=vi.fn().mockImplementation(()=>new Promise(r=>{resolve=r;}));const action=createSetPlayerColorAction(command);
  const first=action({roomCode:'ABC234',playerColor:'blue'});await expect(action({roomCode:'ABC234',playerColor:'red'})).resolves.toBeUndefined();expect(command).toHaveBeenCalledTimes(1);resolve({roomCode:'ABC234',playerColor:'blue',changed:true});await first;
 });
});

describe('player color migration and RPC',()=>{
 it('adds exactly one new migration',()=>{const names=readdirSync(new URL('../supabase/migrations/',import.meta.url),{withFileTypes:true}).filter(entry=>!entry.isDirectory()&&entry.name.endsWith('.sql')).map(entry=>entry.name).sort();expect(names.at(-1)).toBe('20260920000002_player_color_selection.sql');expect(names).toHaveLength(6);});

 it('creates server-only normalized game color metadata seeded with exact colors',()=>{
  expect(migration).toContain('create table public.game_player_colors');
  expect(migration).toContain('primary key (game_id, color)');
  expect(migration).toContain('unique (game_id, sort_order)');
  for(const [index,color] of WORSHIP_ME_PLAYER_COLORS.entries())expect(migration).toContain(`('${color}', ${index}::smallint)`);
  expect(migration).toContain('alter table public.game_player_colors enable row level security');
  expect(migration).toContain('revoke all on table public.game_player_colors from public, anon, authenticated');
  expect(migration).toContain('grant select on table public.game_player_colors to service_role');
 });

 it('preserves the partial unique room color index as final defense',()=>expect(core).toMatch(/create unique index room_players_room_color_uidx\s+on public\.room_players\(room_id, player_color\)\s+where player_color is not null;/));

 it('locks the lobby room before authoritative membership, metadata, and availability checks',()=>{
  expect(migration).toContain('create function public.set_player_color_server');
  expect(migration).toContain('for update of r');
  expect(migration.indexOf('for update of r')).toBeLessThan(migration.indexOf('select rp.player_color'));
  expect(migration).toContain("v_room_status <> 'lobby'");
  expect(migration).toContain('if not v_member_found');
  expect(migration).toContain('from public.game_player_colors as supported');
  expect(migration).toContain('other_player.user_id <> p_user_id');
  expect(migration).toContain('when unique_violation');
  expect(migration).toContain("errcode = 'P0003'");
 });

 it('implements claim, change, clear, and same-color readiness semantics',()=>{
  expect(migration).toMatch(/if v_requested_color is null then[\s\S]*?if v_current_color is null then[\s\S]*?false[\s\S]*?set player_color = null,[\s\S]*?is_ready = false/);
  expect(migration).toMatch(/if v_current_color = v_requested_color then[\s\S]*?false/);
  expect(migration).toMatch(/set player_color = v_requested_color,[\s\S]*?is_ready = false/);
  expect(migration).toContain('return query select v_room_id, v_room_code, v_requested_color, true');
 });

 it('changes only the caller membership and never touches canonical or lifecycle state',()=>{
  expect(migration).toContain('rp.user_id = p_user_id');
  expect(migration).not.toMatch(/room_states|turn_order|host_user_id|set status/);
  expect(lifecycle).toContain('delete from public.room_players');
  expect(lifecycle).not.toMatch(/set player_color/);
 });

 it('is service-role-only with invoker security and empty search path',()=>{
  expect(migration).toContain('security invoker');expect(migration).toContain("set search_path = ''");
  for(const role of ['public','anon','authenticated','service_role'])expect(migration).toContain(`revoke execute on function public.set_player_color_server(text, uuid, text) from ${role}`);
  expect(migration).toContain('grant execute on function public.set_player_color_server(text, uuid, text) to service_role');
 });
});

describe('Set Player Color Edge Function and lobby UI',()=>{
 it('derives identity from JWT and enforces the exact request shape',()=>{
  expect(edge).toContain('auth.getUser(token)');expect(edge).toContain('p_user_id:user.id');expect(edge).toContain("serverClient.rpc('set_player_color_server'");
  expect(edge).toContain("key!=='roomCode'&&key!=='playerColor'");
  expect(edge).not.toMatch(/payload\.(?:userId|roomId|gameId|hostUserId|availability|isReady|turnOrder)/);
  expect(edge).not.toMatch(/response\([^\n]*(?:error\.message|error\.details|error\.hint|error\.stack)/);
 });

 it('maps unavailable colors to a sanitized 409 and other safe outcomes',()=>{
  expect(edge).toContain("error.code==='22023'");expect(edge).toContain("error.code==='P0002'");expect(edge).toContain("error.code==='P0003'");
  expect(edge).toContain("response(409,{error:'That color is no longer available.'})");
  expect(edge).toContain("response(500,{error:'Unable to update player color'})");
 });

 it('renders all colors, current selection, occupied state, clear, refresh, and readable player color labels',()=>{
  expect(shell).toContain('WORSHIP_ME_PLAYER_COLORS.map');expect(shell).toContain('aria-pressed');expect(shell).toContain("occupied?'disabled':''");
  expect(shell).toContain('data-clear-color');expect(shell).toContain('No color');expect(shell).toContain('data-color-message');
  expect(shell).toContain('await setColor({roomCode:lobby.room.code,playerColor})');
  expect(shell).toContain('await renderLobby(code)');
  expect(shell).toContain('await renderLobby(code,message)');
 });

 it('keeps Ready and Start Game unimplemented',()=>{expect(shell).toContain('READY <small>COMING NEXT</small>');expect(shell).toContain('START GAME <small>COMING NEXT</small>');});
});
