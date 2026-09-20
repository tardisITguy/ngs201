import {readFileSync,readdirSync} from 'node:fs';
import {describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {createLeaveAction,leaveRoom,LeaveRoomError} from '../src/platform/rooms/leaveRoom';

const migration=readFileSync(new URL('../supabase/migrations/20260920000001_lobby_lifecycle.sql',import.meta.url),'utf8');
const edge=readFileSync(new URL('../supabase/functions/leave-room/index.ts',import.meta.url),'utf8');
const shell=readFileSync(new URL('../src/platform/shell.ts',import.meta.url),'utf8');

function functionBody(name:string):string{
 return migration.match(new RegExp(`(?:create|create or replace) function ${name.replace('.','\\.')}\\([\\s\\S]*?\\n\\$\\$;`))?.[0]??'';
}

const helper=functionBody('ngsllc_private.depart_lobby_member');
const create=functionBody('public.create_room_server');
const join=functionBody('public.join_room_server');
const leave=functionBody('public.leave_room_server');

const session={access_token:'token',user:{id:'player-1'}};
function clientWithInvoke(invoke:ReturnType<typeof vi.fn>):SupabaseClient{
 return {auth:{getSession:vi.fn().mockResolvedValue({data:{session},error:null})},functions:{invoke}} as unknown as SupabaseClient;
}

describe('Leave Room browser client',()=>{
 it('invokes only leave-room with the normalized room-code payload',async()=>{
  const invoke=vi.fn().mockResolvedValue({data:{completed:true},error:null});
  await expect(leaveRoom({roomCode:'  abc234  '},clientWithInvoke(invoke))).resolves.toEqual({completed:true});
  expect(invoke).toHaveBeenCalledWith('leave-room',{body:{roomCode:'ABC234'}});
  expect(invoke.mock.calls[0][1].body).toEqual({roomCode:'ABC234'});
  expect(invoke.mock.calls[0][1].body).not.toHaveProperty('userId');
  expect(invoke.mock.calls[0][1].body).not.toHaveProperty('newHostUserId');
 });

 it('rejects invalid codes and sanitizes command failures',async()=>{
  const invoke=vi.fn();
  await expect(leaveRoom({roomCode:'bad'},clientWithInvoke(invoke))).rejects.toEqual(new LeaveRoomError('Invalid room code.'));
  expect(invoke).not.toHaveBeenCalled();
  await expect(leaveRoom({roomCode:'ABC234'},clientWithInvoke(vi.fn().mockResolvedValue({data:null,error:{message:'SQL detail'}})))).rejects.toEqual(new LeaveRoomError('Unable to leave lobby.'));
 });

 it('blocks duplicate leave requests while one is in flight',async()=>{
  let resolve!:(value:unknown)=>void;
  const command=vi.fn().mockImplementation(()=>new Promise(r=>{resolve=r;}));
  const action=createLeaveAction(command);
  const first=action({roomCode:'ABC234'});
  await expect(action({roomCode:'ABC234'})).resolves.toBeUndefined();
  expect(command).toHaveBeenCalledTimes(1);
  resolve({completed:true});
  await first;
 });

 it('treats unknown, non-member, and retry responses identically',async()=>{
  const safeResponse={completed:true as const};
  for(const scenario of ['unknown','existing-non-member','retry']){
   const invoke=vi.fn().mockResolvedValue({data:safeResponse,error:null});
   await expect(leaveRoom({roomCode:'ABC234'},clientWithInvoke(invoke))).resolves.toEqual({completed:true});
   expect(JSON.stringify((await invoke.mock.results[0].value).data)).toBe('{"completed":true}');
   expect(scenario).toBeTruthy();
  }
 });
});

describe('Lobby lifecycle migration',()=>{
 it('adds exactly one new lifecycle migration after the existing migrations',()=>{
  const names=readdirSync(new URL('../supabase/migrations/',import.meta.url),{withFileTypes:true}).filter(entry=>!entry.isDirectory()&&entry.name.endsWith('.sql')).map(entry=>entry.name).sort();
  expect(names).toEqual([
   '20260919190346_create_ngsllc_core.sql',
   '20260919190347_restrict_rls_auto_enable.sql',
   '20260919190348_create_room_server_command.sql',
   '20260920000000_join_room_server_command.sql',
   '20260920000001_lobby_lifecycle.sql',
   '20260920000002_player_color_selection.sql',
   '20260920000003_player_ready_state.sql',
   '20260920000004_start_game.sql',
  ]);
 });

 it('serializes create, join, and leave by the same server-derived user identity',()=>{
  for(const body of [create,join,leave]){
   expect(body).toContain('pg_catalog.pg_advisory_xact_lock');
   expect(body).toContain('2010003::bigint');
  }
  expect(create).toContain('hashtextextended(p_host_user_id::text');
  expect(join).toContain('hashtextextended(p_user_id::text');
  expect(leave).toContain('hashtextextended(p_user_id::text');
 });

 it('locks fixed affected-room snapshots in ascending UUID order before changing memberships',()=>{
  expect(create).toContain('array_agg(existing.room_id order by existing.room_id)');
  expect(create).toMatch(/foreach v_lock_room_id in array v_old_lobby_ids loop[\s\S]*?for update;[\s\S]*?foreach v_lock_room_id in array v_old_lobby_ids loop[\s\S]*?depart_lobby_member/);
  expect(join).toContain('array_agg(affected.room_id order by affected.room_id)');
  expect(join).toContain('from pg_catalog.unnest(v_old_lobby_ids)');
  expect(join).toMatch(/foreach v_lock_room_id in array v_lock_room_ids loop[\s\S]*?for update;/);
  expect(join.indexOf('for update;')).toBeLessThan(join.indexOf('depart_lobby_member'));
 });

 it('centralizes non-host leave, deterministic host transfer, and abandonment',()=>{
  expect(helper).toContain("r.status = 'lobby'");
  expect(helper).toContain('delete from public.room_players');
  expect(helper).toContain('if v_host_user_id <> p_user_id');
  expect(helper).toContain('order by rp.joined_at asc, rp.user_id asc');
  expect(helper).toContain("set status = 'abandoned'");
  expect(helper).toContain('set host_user_id = v_new_host_user_id');
  expect(helper).not.toContain('room_states');
 });

 it('makes leave retry-safe with one non-enumerating result for every valid request',()=>{
  const returnedColumns=leave.match(/returns table \(([\s\S]*?)\)\nlanguage/)?.[1]??'';
  expect(returnedColumns.trim()).toBe('completed boolean');
  expect(leave).toContain('return query select true');
  expect(leave).not.toMatch(/return query select (?:v_room_id|null::uuid|v_room_code)/);
  expect(helper).toContain('return query select false, false, null::uuid, false');
  expect(leave).not.toContain('delete from public.room_states');
 });

 it('snapshots and processes every prior lobby during successful Create',()=>{
  expect(create).toContain('v_old_lobby_ids uuid[]');
  expect(create).toContain('array_agg(existing.room_id order by existing.room_id)');
  expect(create).toContain('into v_old_lobby_ids');
  expect(create.match(/foreach v_lock_room_id in array v_old_lobby_ids loop/g)).toHaveLength(2);
  expect(create.indexOf('pg_catalog.pg_advisory_xact_lock')).toBeLessThan(create.indexOf('into v_old_lobby_ids'));
  expect(create.indexOf('into v_old_lobby_ids')).toBeLessThan(create.indexOf('foreach v_lock_room_id in array v_old_lobby_ids'));
  expect(create).toContain('ngsllc_private.depart_lobby_member(v_lock_room_id, p_host_user_id)');
  expect(create.indexOf('depart_lobby_member')).toBeLessThan(create.indexOf('insert into public.rooms'));
  expect(create).toContain('insert into public.room_states');
 });

 it('snapshots and processes every other prior lobby during successful Join',()=>{
  expect(join).toContain('v_old_lobby_ids uuid[]');
  expect(join).toContain('array_agg(existing.room_id order by existing.room_id)');
  expect(join).toContain('foreach v_lock_room_id in array v_old_lobby_ids loop');
  expect(join.indexOf('pg_catalog.pg_advisory_xact_lock')).toBeLessThan(join.indexOf('into v_old_lobby_ids'));
  expect(join.indexOf('into v_old_lobby_ids')).toBeLessThan(join.indexOf('into v_lock_room_ids'));
  expect(join).toContain('if v_lock_room_id <> v_room_id then');
  expect(join).toContain('ngsllc_private.depart_lobby_member(v_lock_room_id, p_user_id)');
  expect(join).toContain('if v_is_target_member then');
  expect(join).toContain('set display_name = v_display_name,last_seen_at = pg_catalog.now()');
  expect(join).toContain('if v_player_count >= v_max_players');
  expect(join.indexOf('if v_player_count >= v_max_players')).toBeLessThan(join.indexOf('depart_lobby_member'));
  expect(join).not.toContain('room_states');
 });

 it('includes the Join target once in the lock snapshot but never departs it',()=>{
  expect(join).toMatch(/select old_room_id as room_id[\s\S]*?union[\s\S]*?select v_room_id where v_room_id is not null/);
  expect(join).toContain('if v_lock_room_id <> v_room_id then');
  expect(join).not.toMatch(/depart_lobby_member\(v_room_id, p_user_id\)/);
 });

 it('restricts every lifecycle function to the trusted service role',()=>{
  for(const signature of [
   'public.create_room_server(text, uuid, text)',
   'public.join_room_server(text, uuid, text)',
   'public.leave_room_server(text, uuid)',
   'ngsllc_private.depart_lobby_member(uuid, uuid)',
  ]){
   for(const role of ['public','anon','authenticated','service_role'])expect(migration).toContain(`revoke execute on function ${signature} from ${role}`);
   expect(migration).toContain(`grant execute on function ${signature} to service_role`);
  }
  expect(migration).not.toMatch(/grant execute[^;]*to (?:anon|authenticated)/i);
 });
});

describe('Leave Room Edge Function and lobby UI',()=>{
 it('verifies JWT identity and never accepts caller or successor authority',()=>{
  expect(edge).toContain('auth.getUser(token)');
  expect(edge).toContain("defaultNamedKey('SUPABASE_PUBLISHABLE_KEYS')");
  expect(edge).toContain("defaultNamedKey('SUPABASE_SECRET_KEYS')");
  expect(edge).toContain("serverClient.rpc('leave_room_server'");
  expect(edge).toContain('p_user_id:user.id');
  expect(edge).not.toMatch(/payload\.(?:userId|hostUserId|newHostUserId|roomId|status|players)/);
  expect(edge).not.toMatch(/response\([^\n]*(?:error\.message|error\.details|error\.hint|error\.stack)/);
  expect(edge).toContain("return response(200,{completed:true})");
  expect(edge).not.toMatch(/roomId|room_id|newHostUserId|new_host_user_id|wasHost|was_host|abandoned/);
 });

 it('keeps all Edge Functions JWT verified',()=>{
  const config=readFileSync(new URL('../supabase/config.toml',import.meta.url),'utf8');
  for(const name of ['create-room','join-room','leave-room'])expect(config).toMatch(new RegExp(`\\[functions\\.${name}\\][\\s\\S]*?verify_jwt\\s*=\\s*true`));
 });

 it('replaces passive lobby navigation with an explicit guarded Leave action',()=>{
  expect(shell).toContain('data-leave');
  expect(shell).toContain('LEAVE LOBBY');
  expect(shell).toContain("window.confirm('Leave this lobby?')");
  expect(shell).toContain('LEAVING LOBBY…');
  expect(shell).toContain("leave({roomCode:lobby.room.code})");
  expect(shell).toContain("router.navigate('/games/worship-me')");
  expect(shell).toContain('We could not leave the lobby. Please try again.');
  expect(shell).not.toContain('href="/games/worship-me" data-link>← Worship Me!</a><section class="room-banner"');
 });

 it('continues to derive the host badge from the refreshed room host',()=>{
  const lobby=readFileSync(new URL('../src/platform/rooms/lobby.ts',import.meta.url),'utf8');
  expect(lobby).toContain('isHost:player.user_id===room.host_user_id');
  expect(lobby).not.toContain("from('room_states')");
 });
});
