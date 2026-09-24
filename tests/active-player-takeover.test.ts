import {readFileSync,readdirSync} from 'node:fs';
import {describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {ACTIVE_GAME_PRESENCE_INTERVAL_MS,createActiveGamePresenceCoordinator,type ActiveGamePresenceEnvironment} from '../src/platform/rooms/activeGamePresence';
import {touchActiveGamePresence} from '../src/platform/rooms/gamePresence';

const migration=readFileSync(new URL('../supabase/migrations/20260923000002_active_player_ai_takeover.sql',import.meta.url),'utf8');
const edge=readFileSync(new URL('../supabase/functions/game-presence/index.ts',import.meta.url),'utf8');
const shell=readFileSync(new URL('../src/platform/shell.ts',import.meta.url),'utf8');
const config=readFileSync(new URL('../supabase/config.toml',import.meta.url),'utf8');
const gameAction=readFileSync(new URL('../supabase/migrations/20260921000001_gameplay_mutation.sql',import.meta.url),'utf8');
const realtime=readFileSync(new URL('../supabase/migrations/20260922000000_realtime_game_sync.sql',import.meta.url),'utf8');

function body(name:string):string{return migration.match(new RegExp(`(?:create|create or replace) function ${name.replace('.','\\.')}\\([\\s\\S]*?\\n\\$\\$;`))?.[0]??'';}
const takeover=body('ngsllc_private.takeover_active_player_with_ai');
const leave=body('public.leave_room_server');
const presence=body('public.touch_active_game_presence_server');

function testEnvironment(){
 let interval:(()=>void)|undefined,visibility:(()=>void)|undefined,focus:(()=>void)|undefined,online:(()=>void)|undefined,visible=true,clearCount=0;
 const environment:ActiveGamePresenceEnvironment={
  setInterval:vi.fn(callback=>{interval=callback;return 1;}),clearInterval:vi.fn(()=>{clearCount++;interval=undefined;}),
  onVisibilityChange:callback=>{visibility=callback;return()=>{visibility=undefined;};},onFocus:callback=>{focus=callback;return()=>{focus=undefined;};},onOnline:callback=>{online=callback;return()=>{online=undefined;};},isVisible:()=>visible,
 };
 return{environment,fireInterval:()=>interval?.(),fireVisibility:()=>visibility?.(),fireFocus:()=>focus?.(),fireOnline:()=>online?.(),setVisible:(value:boolean)=>{visible=value;},clearCount:()=>clearCount};
}

describe('active human to AI migration contract',()=>{
 it('retains the sixteenth migration before later migrations',()=>{const names=readdirSync(new URL('../supabase/migrations/',import.meta.url),{withFileTypes:true}).filter(entry=>!entry.isDirectory()&&entry.name.endsWith('.sql')).map(entry=>entry.name).sort();expect(names).toHaveLength(18);expect(names.at(-3)).toBe('20260923000002_active_player_ai_takeover.sql');expect(names.at(-2)).toBe('20260924000000_lobby_discovery_and_host_moderation.sql');expect(names.at(-1)).toBe('20260924000001_return_finished_game_to_lobby.sql');expect(migration).not.toMatch(/alter publication|create publication/i);expect(realtime).toContain("alter publication supabase_realtime add table public.room_game_updates");});
 it('maps the existing turn_order to pN and changes only canonical control and strategy',()=>{expect(takeover).toContain("v_player_id := 'p'||(v_turn_order + 1)::text");expect(takeover).toContain("array['players',v_turn_order::text,'control']");expect(takeover).toContain("array['players',v_turn_order::text,'botStrategy']");expect(takeover).toContain("'\"ai\"'::jsonb");expect(takeover).toContain("'\"balanced\"'::jsonb");expect(takeover).not.toMatch(/jsonb_build_object|insert into public\.room_ai_players|turn_order\s*=/i);for(const field of ['name','color','templeCellId','priestsCreated','lastPriestCreationRound','turnOrder','currentPlayerIndex','round','board','rngState','seed','pendingResolution','actionQueue','history'])expect(takeover).not.toContain(`'${field}'`);});
 it('locks state, advances its version once, removes membership, and leaves M9 to signal',()=>{expect(takeover).toContain('for update of rs');expect(takeover).toContain('state_version = rs.state_version + 1');expect(takeover.match(/state_version\s*=\s*rs\.state_version\s*\+\s*1/g)).toHaveLength(1);expect(takeover).toContain('delete from public.room_players');expect(takeover).not.toContain('room_game_updates');});
 it('transfers active host to the earliest remaining human and abandons after the last human',()=>{expect(takeover).toContain('order by rp.joined_at asc,rp.user_id asc');expect(takeover).toContain('set host_user_id = v_new_host_user_id');expect(takeover).toContain("set status = 'abandoned'");expect(takeover).not.toContain('room_ai_players');});
 it('preserves lobby leave while routing active leave through takeover under the same user lock',()=>{expect(leave).toContain('2010003::bigint');expect(leave).toContain("if v_room_status = 'lobby'");expect(leave).toContain('ngsllc_private.depart_lobby_member');expect(leave).toContain("elsif v_room_status = 'active'");expect(leave).toContain('ngsllc_private.takeover_active_player_with_ai');expect(leave).toContain('return query select true');});
 it('keeps former users outside game-action authorization',()=>{expect(gameAction).toMatch(/left join public\.room_players as rp[\s\S]*?rp\.user_id = p_user_id/);expect(gameAction).toContain("message = 'Room not found or unavailable'");expect(gameAction).toContain("p_next_game_state->'players'->v_index->'control' is distinct from v_game_state->'players'->v_index->'control'");});
 it('restricts helper and public commands to the trusted server path',()=>{for(const signature of ['ngsllc_private.takeover_active_player_with_ai(uuid,uuid)','public.leave_room_server(text,uuid)','public.touch_active_game_presence_server(text,uuid)']){expect(migration).toMatch(new RegExp(`revoke execute on function ${signature.replace(/[().]/g,'\\$&')} from public(?:,anon,authenticated,service_role)?;`));expect(migration).toContain(`grant execute on function ${signature} to service_role;`);}expect(takeover).toContain("security invoker\nset search_path = ''");expect(presence).toContain("security invoker\nset search_path = ''");});
});

describe('trusted active presence',()=>{
 it('touches only the verified caller, uses database time, and applies a server-owned 90 second threshold',()=>{expect(presence).toContain('set last_seen_at = v_now');expect(presence).toContain('rp.user_id = p_user_id');expect(presence).toContain("rp.last_seen_at < v_now - interval '90 seconds'");expect(presence).toContain('for update of r');expect(presence).toContain('takeover_active_player_with_ai(v_room_id,v_stale_user_id)');expect(presence).not.toMatch(/p_(?:timestamp|timeout|stale_user)/);});
 it('updates a fresh reconnect before evaluating other stale members and serializes sweeps on the room',()=>{expect(presence.indexOf('for update of r')).toBeLessThan(presence.indexOf('set last_seen_at = v_now'));expect(presence.indexOf('set last_seen_at = v_now')).toBeLessThan(presence.indexOf('select coalesce('));expect(presence).toContain('rp.user_id <> p_user_id');});
 it('Edge verifies JWT identity and accepts roomCode only',()=>{expect(edge).toContain('auth.getUser(token)');expect(edge).toContain("keys.length!==1||keys[0]!=='roomCode'");expect(edge).toContain("rpc('touch_active_game_presence_server',{p_room_code:roomCode,p_user_id:user.id})");expect(edge).not.toMatch(/record\.(?:userId|timestamp|timeout|playerId)/);expect(config).toMatch(/\[functions\.game-presence\]\s*verify_jwt\s*=\s*true/);});
 it('browser client sends only normalized roomCode',async()=>{const invoke=vi.fn().mockResolvedValue({data:{completed:true},error:null}),client={auth:{getSession:vi.fn().mockResolvedValue({data:{session:{user:{id:'human'}}},error:null})},functions:{invoke}} as unknown as SupabaseClient;await expect(touchActiveGamePresence({roomCode:' abc234 '},client)).resolves.toEqual({completed:true});expect(invoke).toHaveBeenCalledWith('game-presence',{body:{roomCode:'ABC234'}});});
});

describe('active presence coordinator lifecycle',()=>{
 it('touches immediately and every 20 seconds without overlap',async()=>{const harness=testEnvironment();let release!:(value:{completed:true})=>void;const touch=vi.fn().mockImplementation(()=>new Promise(resolve=>{release=resolve;})),coordinator=createActiveGamePresenceCoordinator({}, {touch,environment:harness.environment});coordinator.enter('abc234');expect(ACTIVE_GAME_PRESENCE_INTERVAL_MS).toBe(20_000);expect(touch).toHaveBeenCalledTimes(1);harness.fireInterval();expect(touch).toHaveBeenCalledTimes(1);release({completed:true});await Promise.resolve();harness.fireInterval();expect(touch).toHaveBeenCalledTimes(2);});
 it('touches on visible, focus, and online without touching when visibility remains hidden',async()=>{const harness=testEnvironment(),touch=vi.fn().mockResolvedValue({completed:true}),coordinator=createActiveGamePresenceCoordinator({}, {touch,environment:harness.environment});coordinator.enter('ABC234');await Promise.resolve();harness.setVisible(false);harness.fireVisibility();expect(touch).toHaveBeenCalledTimes(1);harness.setVisible(true);harness.fireVisibility();await Promise.resolve();harness.fireFocus();await Promise.resolve();harness.fireOnline();await Promise.resolve();expect(touch).toHaveBeenCalledTimes(4);});
 it('cleans up on leave and room change and cannot continue an old room',async()=>{const harness=testEnvironment(),touch=vi.fn().mockResolvedValue({completed:true}),coordinator=createActiveGamePresenceCoordinator({}, {touch,environment:harness.environment});coordinator.enter('ABC234');await Promise.resolve();coordinator.leave();harness.fireInterval();harness.fireFocus();expect(touch).toHaveBeenCalledTimes(1);coordinator.enter('XYZ789');await Promise.resolve();expect(touch).toHaveBeenLastCalledWith({roomCode:'XYZ789'});expect(harness.clearCount()).toBeGreaterThanOrEqual(1);});
});

describe('active Leave Game UI',()=>{
 it('renders explicit takeover copy while preserving lobby Leave Lobby',()=>{expect(shell).toContain('LEAVE GAME');expect(shell).toContain('LEAVE LOBBY');expect(shell).toContain('Leave this game? AI will take over your player for the rest of the game.');expect(shell).toContain("leave({roomCode:code})");});
 it('starts presence only in active rendering and stops it on navigation and successful leave',()=>{expect(shell).toContain('gamePresence.enter(code)');expect(shell).toContain('gamePresence.leave();aiAdvanceToken++');expect(shell).toContain("await Promise.all([roomSync.leave(),roomLobbySync.leave()]);router.navigate('/games/worship-me')");});
 it('does not turn presence into state polling or AI scheduling',()=>{const coordinator=readFileSync(new URL('../src/platform/rooms/activeGamePresence.ts',import.meta.url),'utf8'),client=readFileSync(new URL('../src/platform/rooms/gamePresence.ts',import.meta.url),'utf8');expect(coordinator).toContain('setInterval');for(const forbidden of ['getActiveGameState','getLobby','advanceAI','room_states','game_state'])expect(coordinator+client).not.toContain(forbidden);});
});
