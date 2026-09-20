import {readFileSync} from 'node:fs';
import {describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {createJoinAction,joinRoom,JoinRoomError,normalizeRoomCode} from '../src/platform/rooms/joinRoom';
import {resolveRoute} from '../src/platform/router';

const session={access_token:'token',user:{id:'player-b'}};

function clientWithInvoke(invoke:ReturnType<typeof vi.fn>):SupabaseClient{
 return {auth:{getSession:vi.fn().mockResolvedValue({data:{session},error:null})},functions:{invoke}} as unknown as SupabaseClient;
}

describe('Join Room browser client',()=>{
 it('normalizes the code and invokes only the trusted Edge Function with the allowed payload',async()=>{
  const invoke=vi.fn().mockResolvedValue({data:{room:{id:'room-1',code:'ABC234',gameId:'game-1',status:'lobby'},joinedNew:true},error:null});
  await expect(joinRoom({roomCode:'  abc234  ',displayName:'  Bob  '},clientWithInvoke(invoke))).resolves.toMatchObject({room:{code:'ABC234'},joinedNew:true});
  expect(invoke).toHaveBeenCalledWith('join-room',{body:{roomCode:'ABC234',displayName:'Bob'}});
  expect(invoke.mock.calls[0][1].body).toEqual({roomCode:'ABC234',displayName:'Bob'});
  expect(invoke.mock.calls[0][1].body).not.toHaveProperty('userId');
 });

 it('rejects malformed codes before invoking the server',async()=>{
  const invoke=vi.fn();
  const client=clientWithInvoke(invoke);
  await expect(joinRoom({roomCode:' ',displayName:'Bob'},client)).rejects.toBeInstanceOf(JoinRoomError);
  await expect(joinRoom({roomCode:'ABC-234',displayName:'Bob'},client)).rejects.toBeInstanceOf(JoinRoomError);
  await expect(joinRoom({roomCode:'ABCDEFGHIJK',displayName:'Bob'},client)).rejects.toBeInstanceOf(JoinRoomError);
  expect(invoke).not.toHaveBeenCalled();
  expect(normalizeRoomCode(' abc234 ')).toBe('ABC234');
 });

 it('sanitizes invocation failures',async()=>{
  const databaseError={message:'relation public.rooms failed',details:'secret SQL detail'};
  await expect(joinRoom({roomCode:'ABC234',displayName:'Bob'},clientWithInvoke(vi.fn().mockResolvedValue({data:null,error:databaseError})))).rejects.toEqual(new JoinRoomError('Unable to join room.'));
 });

 it('blocks a duplicate submission while the first request is in flight',async()=>{
  let resolve!:(value:unknown)=>void;
  const command=vi.fn().mockImplementation(()=>new Promise(r=>{resolve=r;}));
  const action=createJoinAction(command);
  const first=action({roomCode:'ABC234',displayName:'Bob'});
  await expect(action({roomCode:'ABC234',displayName:'Bob'})).resolves.toBeUndefined();
  expect(command).toHaveBeenCalledTimes(1);
  resolve({room:{id:'r',code:'ABC234',gameId:'g',status:'lobby'},joinedNew:true});
  await first;
 });
});

describe('Join Room route and UI contract',()=>{
 it('resolves the join route',()=>expect(resolveRoute('/games/worship-me/join')).toEqual({name:'worship-me-join'}));

 it('enables Join Game, renders an accessible form, guards identity, and navigates to the normalized lobby',()=>{
  const shell=readFileSync(new URL('../src/platform/shell.ts',import.meta.url),'utf8');
  expect(shell).toContain('href="/games/worship-me/join"');
  expect(shell).toContain('data-join');
  expect(shell).toContain('label for="room-code"');
  expect(shell).toContain('spellcheck="false"');
  expect(shell).toContain("if(!getDisplayName()){identityReturnPath='/games/worship-me/join'");
  expect(shell).toContain('JOINING ROOM…');
  expect(shell).toContain('router.navigate(`/room/${encodeURIComponent(result.room.code)}`)');
  expect(shell).not.toMatch(/JOIN GAME <small>COMING NEXT/);
 });
});

describe('Join Room migration and Edge Function security contract',()=>{
 const migration=readFileSync(new URL('../supabase/migrations/20260920000000_join_room_server_command.sql',import.meta.url),'utf8');
 const edge=readFileSync(new URL('../supabase/functions/join-room/index.ts',import.meta.url),'utf8');

 it('adds server-authoritative capacity and a service-only atomic join command',()=>{
  expect(migration).toContain('add column max_players smallint');
  expect(migration).toMatch(/set max_players = 8\s+where slug = 'worship-me'/);
  expect(migration).toContain('create function public.join_room_server');
  expect(migration).toContain('security invoker');
  expect(migration).toContain("set search_path = ''");
  expect(migration).toContain('for update of r');
  expect(migration.indexOf('update public.room_players')).toBeLessThan(migration.indexOf('select pg_catalog.count(*)'));
  expect(migration).toContain('if v_player_count >= v_max_players');
  expect(migration).toContain('player_color,');
  expect(migration).toContain('turn_order,');
  expect(migration).not.toMatch(/(?:insert|update|delete)[^;]*public\.room_states/i);
  for(const role of ['public','anon','authenticated','service_role'])expect(migration).toContain(`revoke execute on function public.join_room_server(text, uuid, text) from ${role}`);
  expect(migration).toContain('grant execute on function public.join_room_server(text, uuid, text) to service_role');
  expect(migration).not.toMatch(/grant execute[^;]*to (?:anon|authenticated)/i);
 });

 it('derives identity from verified auth and accepts no browser authority fields',()=>{
  expect(edge).toContain('auth.getUser(token)');
  expect(edge).toContain("defaultNamedKey('SUPABASE_PUBLISHABLE_KEYS')");
  expect(edge).toContain("defaultNamedKey('SUPABASE_SECRET_KEYS')");
  expect(edge).toContain("serverClient.rpc('join_room_server'");
  expect(edge).toContain('p_user_id:user.id');
  expect(edge).not.toMatch(/payload\.(?:userId|hostUserId|roomId|gameId|maxPlayers|playerColor|turnOrder|isReady)/);
  expect(edge).not.toContain('game_state');
 });

 it('maps stable database codes to safe responses and never returns database details',()=>{
  expect(edge).toContain("error.code==='22023'");
  expect(edge).toContain("error.code==='P0002'");
  expect(edge).toContain("error.code==='P0003'");
  expect(edge).toContain("response(404,{error:'Room not found or unavailable'})");
  expect(edge).toContain("response(409,{error:'Room is full'})");
  expect(edge).toContain("response(500,{error:'Unable to join room'})");
  expect(edge).not.toMatch(/response\([^\n]*(?:error\.message|error\.details|error\.hint|error\.stack)/);
 });

 it('keeps both Edge Functions JWT-verified',()=>{
  const config=readFileSync(new URL('../supabase/config.toml',import.meta.url),'utf8');
  expect(config).toMatch(/\[functions\.create-room\][\s\S]*?verify_jwt\s*=\s*true/);
  expect(config).toMatch(/\[functions\.join-room\][\s\S]*?verify_jwt\s*=\s*true/);
 });
});
