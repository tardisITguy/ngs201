import {readFileSync,readdirSync} from 'node:fs';
import {describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {createSetPlayerReadyAction,setPlayerReady,SetPlayerReadyError} from '../src/platform/rooms/setPlayerReady';
import {renderLobbyPlayerRows} from '../src/platform/rooms/lobbyPlayerRows';

const migration=readFileSync(new URL('../supabase/migrations/20260920000003_player_ready_state.sql',import.meta.url),'utf8');
const colorMigration=readFileSync(new URL('../supabase/migrations/20260920000002_player_color_selection.sql',import.meta.url),'utf8');
const lifecycle=readFileSync(new URL('../supabase/migrations/20260920000001_lobby_lifecycle.sql',import.meta.url),'utf8');
const edge=readFileSync(new URL('../supabase/functions/set-player-ready/index.ts',import.meta.url),'utf8');
const supabaseConfig=readFileSync(new URL('../supabase/config.toml',import.meta.url),'utf8');
const shell=readFileSync(new URL('../src/platform/shell.ts',import.meta.url),'utf8');
const config=readFileSync(new URL('../src/games/worship-me/engine/config.ts',import.meta.url),'utf8');
const session={access_token:'token',user:{id:'player-1'}};
function clientWithInvoke(invoke:ReturnType<typeof vi.fn>):SupabaseClient{return{auth:{getSession:vi.fn().mockResolvedValue({data:{session},error:null})},functions:{invoke}} as unknown as SupabaseClient;}

describe('Set Player Ready browser client',()=>{
 it('sends only normalized roomCode and isReady through the Edge Function',async()=>{
  const invoke=vi.fn().mockResolvedValue({data:{roomCode:'ABC234',isReady:true,changed:true},error:null});
  await expect(setPlayerReady({roomCode:' abc234 ',isReady:true},clientWithInvoke(invoke))).resolves.toEqual({roomCode:'ABC234',isReady:true,changed:true});
  expect(invoke).toHaveBeenCalledWith('set-player-ready',{body:{roomCode:'ABC234',isReady:true}});
  expect(invoke.mock.calls[0][1].body).toEqual({roomCode:'ABC234',isReady:true});
  expect(invoke.mock.calls[0][1].body).not.toHaveProperty('userId');
 });

 it('maps color prerequisite failures safely',async()=>{
  const invoke=vi.fn().mockResolvedValue({data:null,error:{context:{status:400},message:'postgres details'}});
  await expect(setPlayerReady({roomCode:'ABC234',isReady:true},clientWithInvoke(invoke))).rejects.toEqual(new SetPlayerReadyError('Choose a color before marking Ready.'));
 });

 it('blocks duplicate in-flight Ready commands',async()=>{
  let resolve!:(value:unknown)=>void;const command=vi.fn().mockImplementation(()=>new Promise(r=>{resolve=r;}));const action=createSetPlayerReadyAction(command);
  const first=action({roomCode:'ABC234',isReady:true});await expect(action({roomCode:'ABC234',isReady:false})).resolves.toBeUndefined();expect(command).toHaveBeenCalledTimes(1);resolve({roomCode:'ABC234',isReady:true,changed:true});await first;
 });
});

describe('Ready migration and RPC contract',()=>{
 it('adds exactly one migration after player color without changing the old files',()=>{
  const names=readdirSync(new URL('../supabase/migrations/',import.meta.url),{withFileTypes:true}).filter(entry=>!entry.isDirectory()&&entry.name.endsWith('.sql')).map(entry=>entry.name).sort();
  expect(names).toContain('20260920000003_player_ready_state.sql');expect(names).toHaveLength(9);
 });

 it('uses invoker security, empty search path, and service-role-only execution',()=>{
  expect(migration).toContain('create function public.set_player_ready_server');expect(migration).toContain('security invoker');expect(migration).toContain("set search_path = ''");
  for(const role of ['public','anon','authenticated','service_role'])expect(migration).toContain(`revoke execute on function public.set_player_ready_server(text, uuid, boolean) from ${role}`);
  expect(migration).toContain('grant execute on function public.set_player_ready_server(text, uuid, boolean) to service_role');
 });

 it('locks and revalidates the active lobby before membership and Ready checks',()=>{
  expect(migration).toContain("g.status = 'active'");expect(migration).toContain('for update of r');expect(migration).toContain("v_room_status <> 'lobby'");expect(migration).toContain('if not v_member_found');
  expect(migration.indexOf('for update of r')).toBeLessThan(migration.indexOf('select rp.is_ready, rp.player_color'));
 });

 it('rejects already-Ready rows with null or stale colors before idempotency',()=>{
  const prerequisite=migration.indexOf('if p_is_ready and ('),idempotency=migration.indexOf('if v_current_ready = p_is_ready then');
  expect(prerequisite).toBeGreaterThan(0);expect(prerequisite).toBeLessThan(idempotency);
  expect(migration.slice(prerequisite,idempotency)).toContain('v_player_color is null');
  expect(migration.slice(prerequisite,idempotency)).toContain('not exists');
  expect(migration.slice(prerequisite,idempotency)).toContain('from public.game_player_colors as supported');
  expect(migration.slice(prerequisite,idempotency)).toContain("errcode = 'P0004'");
  expect(migration.slice(prerequisite,idempotency)).toContain("message = 'Valid player color required'");
  expect(edge).toContain("response(400,{error:'Choose a color before marking Ready.'})");
 });

 it('keeps valid same-state Ready idempotent and Not Ready color-independent',()=>{
  expect(migration).toMatch(/if v_current_ready = p_is_ready then[\s\S]*?return query select v_room_id, v_room_code, v_current_ready, false/);
  expect(migration).toMatch(/if p_is_ready and \([\s\S]*?end if;[\s\S]*?if v_current_ready = p_is_ready/);
  expect(migration).toContain('set is_ready = p_is_ready');
 });

 it('changes only the caller Ready field and never canonical, color, order, host, or room state',()=>{
  expect(migration).toContain('rp.user_id = p_user_id');expect(migration).not.toMatch(/room_states|set player_color|set turn_order|set host_user_id|set status/);
 });

 it('shares room-row locking with color mutation to serialize Ready/color races',()=>{
  expect(migration).toContain('for update of r');expect(colorMigration).toContain('for update of r');expect(colorMigration).toMatch(/set player_color = null,[\s\S]*?is_ready = false/);expect(colorMigration).toMatch(/set player_color = v_requested_color,[\s\S]*?is_ready = false/);
  expect(colorMigration).toMatch(/if v_current_color = v_requested_color then[\s\S]*?false/);
 });

 it('preserves lifecycle Ready semantics',()=>{
  const departure=lifecycle.slice(0,lifecycle.indexOf('create or replace function public.create_room_server'));
  expect(departure).not.toContain('is_ready');expect(lifecycle).toContain('values (v_room_id,p_host_user_id,v_display_name,null,null,false)');expect(lifecycle).toContain('values (v_room_id,p_user_id,v_display_name,null,null,false)');
 });
});

describe('Ready Edge Function and lobby UI',()=>{
 it('derives caller identity from JWT and rejects extra authority fields',()=>{
  expect(edge).toContain('auth.getUser(token)');expect(edge).toContain('p_user_id:user.id');expect(edge).toContain("serverClient.rpc('set_player_ready_server'");expect(edge).toContain("key!=='roomCode'&&key!=='isReady'");expect(edge).not.toMatch(/payload\.(?:userId|playerId|roomId|playerColor|hostUserId|turnOrder|allReady)/);
  expect(supabaseConfig).toMatch(/\[functions\.set-player-ready\]\s*verify_jwt = true/);
 });

 it('maps safe Ready errors without exposing SQL internals',()=>{
  expect(edge).toContain("error.code==='P0004'");expect(edge).toContain("response(400,{error:'Choose a color before marking Ready.'})");expect(edge).toContain("response(404,{error:'Room not found or unavailable'})");expect(edge).toContain("response(500,{error:'Unable to update Ready state'})");expect(edge).not.toMatch(/response\([^\n]*(?:error\.message|error\.details|error\.hint|error\.stack)/);
 });

 it('renders readable Ready status for every player',()=>{
  const rows=renderLobbyPlayerRows([{userId:'a',displayName:'Alice',playerColor:'red',turnOrder:null,isReady:true,isHost:true,isCurrentUser:true},{userId:'b',displayName:'Bob',playerColor:'blue',turnOrder:null,isReady:false,isHost:false,isCurrentUser:false}]);
  expect(rows).toContain('>READY</span>');expect(rows).toContain('>NOT READY</span>');expect(rows.match(/data-player-color-select/g)).toHaveLength(1);
 });

 it('uses a current-player-only Ready control, disables it without color, and refreshes on either outcome',()=>{
  expect(shell).toContain('data-ready');expect(shell).toContain('Choose a color first');expect(shell).toContain("isReady:!currentPlayer.isReady");expect(shell).toContain('await setReady');expect(shell).toContain('await renderLobby(code)');expect(shell).toContain('await renderLobby(code,message)');
 });

 it('previews Start eligibility from the authoritative engine minimum of two',()=>{
  expect(config).toContain('playerMin:2');expect(shell).toContain('defaultConfig.playerMin');expect(shell).toContain("data-start ${allReadyPreview?'':'disabled'}");
 });
});
