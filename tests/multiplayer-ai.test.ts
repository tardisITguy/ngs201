import {readFileSync,readdirSync} from 'node:fs';
import {describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {createGame} from '../src/games/worship-me/engine/setup';
import {blessEdgeOptions} from '../src/games/worship-me/engine/resolution';
import {advanceOneAIDecision} from '../src/games/worship-me/ai/advance';
import {buildWorshipMeInitialState,type TrustedStartPlayer} from '../supabase/functions/start-game/candidate';
import {manageAIPlayer} from '../src/platform/rooms/manageAIPlayer';
import {advanceAI} from '../src/platform/rooms/advanceAI';
import {renderLobbyPlayerRows} from '../src/platform/rooms/lobbyPlayerRows';
import type {LobbyPlayer} from '../src/platform/rooms/lobby';

const migration=readFileSync(new URL('../supabase/migrations/20260922000002_multiplayer_ai_players.sql',import.meta.url),'utf8');
const repairMigration=readFileSync(new URL('../supabase/migrations/20260923000000_fix_multiplayer_ai_sql_ambiguity.sql',import.meta.url),'utf8');
const startCoalesceMigration=readFileSync(new URL('../supabase/migrations/20260923000001_fix_start_game_coalesce.sql',import.meta.url),'utf8');
const manageEdge=readFileSync(new URL('../supabase/functions/manage-ai-player/index.ts',import.meta.url),'utf8');
const advanceEdge=readFileSync(new URL('../supabase/functions/advance-ai/index.ts',import.meta.url),'utf8');
const startEdge=readFileSync(new URL('../supabase/functions/start-game/index.ts',import.meta.url),'utf8');
const shell=readFileSync(new URL('../src/platform/shell.ts',import.meta.url),'utf8');
const lobby=readFileSync(new URL('../src/platform/rooms/lobby.ts',import.meta.url),'utf8');
const rows=readFileSync(new URL('../src/platform/rooms/lobbyPlayerRows.ts',import.meta.url),'utf8');
const config=readFileSync(new URL('../supabase/config.toml',import.meta.url),'utf8');
const migrations=()=>readdirSync(new URL('../supabase/migrations/',import.meta.url),{withFileTypes:true}).filter(entry=>!entry.isDirectory()&&entry.name.endsWith('.sql')).map(entry=>entry.name).sort();
const body=(name:string)=>{const start=migration.indexOf(`function public.${name}`),end=migration.indexOf('end;$$;',start);return migration.slice(start,end);};
const repairBody=(name:string)=>{const start=repairMigration.indexOf(`function public.${name}`),end=repairMigration.indexOf('end;$$;',start);return repairMigration.slice(start,end);};
const startCoalesceBody=()=>{const start=startCoalesceMigration.indexOf('function public.start_game_server'),end=startCoalesceMigration.indexOf('end;$$;',start);return startCoalesceMigration.slice(start,end);};
const contentFingerprint=(value:string)=>{let hash=2166136261;for(let index=0;index<value.length;index++)hash=Math.imul(hash^value.charCodeAt(index),16777619);return(hash>>>0).toString(16).padStart(8,'0');};

describe('M11 additive AI schema and authority',()=>{
 it('keeps the applied M11 migrations unchanged before later migrations',()=>{expect(migrations()).toHaveLength(17);expect(migrations().at(-5)).toBe('20260922000002_multiplayer_ai_players.sql');expect(migrations().at(-4)).toBe('20260923000000_fix_multiplayer_ai_sql_ambiguity.sql');expect(migrations().at(-3)).toBe('20260923000001_fix_start_game_coalesce.sql');expect(migrations().at(-2)).toBe('20260923000002_active_player_ai_takeover.sql');expect(migrations().at(-1)).toBe('20260924000000_lobby_discovery_and_host_moderation.sql');expect(contentFingerprint(migration.replace(/\r\n/g,'\n'))).toBe('0dc12235');expect(contentFingerprint(repairMigration.replace(/\r\n/g,'\n'))).toBe('4337a13b');});
 it('creates room_ai_players with no user or Auth identity',()=>{const table=migration.slice(migration.indexOf('create table public.room_ai_players'),migration.indexOf('create unique index room_ai_players_room_color_uidx'));for(const field of ['id uuid primary key default gen_random_uuid()','room_id uuid not null references public.rooms(id) on delete cascade','bot_number smallint not null','player_color text not null',"bot_strategy text not null default 'balanced'",'turn_order smallint','created_at timestamptz not null default now()','updated_at timestamptz not null default now()'])expect(table).toContain(field);expect(table).not.toMatch(/\buser_id\b|auth\.users|seat_number|slot_type/);});
 it('constrains bot number, strategy, color, and optional turn order',()=>{expect(migration).toContain('bot_number between 1 and 8');expect(migration).toContain("bot_strategy in ('random','growth','templeRush','balanced')");expect(migration).toContain('unique (room_id, bot_number)');expect(migration).toContain('room_ai_players_room_color_uidx on public.room_ai_players(room_id, player_color) where player_color is not null');expect(migration).toContain('room_ai_players_room_turn_order_uidx');expect(migration).toContain('where turn_order is not null');});
 it('allows authenticated member reads but service-role-only mutation',()=>{expect(migration).toContain('alter table public.room_ai_players enable row level security');expect(migration).toContain('grant select on table public.room_ai_players to authenticated');expect(migration).toContain('using (ngsllc_private.is_room_member(room_id))');expect(migration).toContain('grant select, insert, update, delete on table public.room_ai_players to service_role');expect(migration).not.toMatch(/grant\s+(?:insert|update|delete|all).*room_ai_players to authenticated/i);});
});

describe('host AI management, capacity, and colors',()=>{
 it('adds an AI with the smallest unused bot number and first available authoritative color',()=>{const fn=body('add_room_ai_player_server');expect(fn).toContain('pg_catalog.generate_series(1,8)as candidates(candidate)');expect(fn).toContain('order by candidates.candidate limit 1');expect(fn).toContain('public.game_player_colors');expect(fn).toContain('order by c.sort_order limit 1');expect(fn).toContain("'balanced'");});
 it('removes only the requested room AI participant',()=>{const fn=body('remove_room_ai_player_server');expect(fn).toContain('delete from public.room_ai_players');expect(fn).toContain('id=p_ai_player_id');});
 it('requires membership, host, lobby, active Worship Me metadata, and the room lock',()=>{for(const name of ['add_room_ai_player_server','remove_room_ai_player_server','set_room_ai_player_color_server','set_room_ai_player_strategy_server']){const fn=body(name);expect(fn).toContain("g.status='active'");expect(fn).toContain("g.slug='worship-me'");expect(fn).toContain('for update of r');expect(fn).toContain('public.room_players');expect(fn).toContain('v_host<>p_user_id');expect(fn).toContain("v_status<>'lobby'");}});
 it('uses total humans plus AI for Add and Join capacity',()=>{expect(body('add_room_ai_player_server')).toContain('(select pg_catalog.count(*)from public.room_ai_players');const join=body('join_room_server');expect(join).toContain('v_player_count+v_ai_count>=v_max_players');expect(join).toContain('if not v_is_target_member');expect(join).toContain('pg_advisory_xact_lock');});
 it('serializes human and AI color checks on the same room row',()=>{for(const name of ['set_player_color_server','set_room_ai_player_color_server'])expect(body(name)).toContain('for update of r');expect(body('set_player_color_server')).toContain('public.room_ai_players');expect(body('set_room_ai_player_color_server')).toContain('public.room_players');});
 it('keeps management RPC execution service-role-only',()=>{for(const signature of ['add_room_ai_player_server(text,uuid)','remove_room_ai_player_server(text,uuid,uuid)','set_room_ai_player_color_server(text,uuid,uuid,text)','set_room_ai_player_strategy_server(text,uuid,uuid,text)']){expect(migration).toContain(`revoke execute on function public.${signature}from public,anon,authenticated,service_role`);expect(migration).toContain(`grant execute on function public.${signature}to service_role`);}});
});

describe('M10 signal and SQL structure',()=>{
 it('uses a single valid outer IF/ELSIF chain in the replaced trigger function',()=>{const start=migration.indexOf('create or replace function ngsllc_private.bump_room_lobby_update()'),end=migration.indexOf('create trigger room_ai_players_bump_lobby_update',start),fn=migration.slice(start,end);expect(fn).toMatch(/if tg_table_name='room_players' then[\s\S]*?elsif tg_table_name='room_ai_players' then[\s\S]*?elsif tg_table_name='rooms' then[\s\S]*?end if;\s*if v_meaningful/);expect(fn).toMatch(/if v_meaningful then[\s\S]*?end if;if tg_op='DELETE' then return old;end if;return new;\s*end;\$\$;/);});
 it('signals inserts, deletes, real color/strategy changes but ignores turn-order-only updates',()=>{expect(migration).toContain('after insert or delete or update of player_color,bot_strategy,turn_order');const fn=migration.slice(migration.indexOf("elsif tg_table_name='room_ai_players'"),migration.indexOf("elsif tg_table_name='rooms'"));expect(fn).toContain('new.player_color is distinct from old.player_color');expect(fn).toContain('new.bot_strategy is distinct from old.bot_strategy');expect(fn).not.toContain('turn_order');});
 it('keeps publication exactly on the two safe signal tables plus own-row kick notices',()=>{const all=migrations().map(name=>readFileSync(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8')).join('\n');expect(all.match(/alter publication supabase_realtime add table/g)).toHaveLength(3);expect(all).toContain('add table public.room_game_updates');expect(all).toContain('add table public.room_lobby_updates');expect(all).toContain('add table public.room_kicks');expect(all).not.toMatch(/add table public\.(?:rooms|room_players|room_ai_players|room_states)/);});
});

describe('M11 forward-only PL/pgSQL ambiguity repair',()=>{
 it('replaces only the seven affected functions without schema or architecture changes',()=>{
  const functionNames=['add_room_ai_player_server','start_game_server','remove_room_ai_player_server','set_room_ai_player_color_server','set_room_ai_player_strategy_server','join_room_server','set_player_color_server'];
  for(const name of functionNames){const fn=repairBody(name);expect(repairMigration).toContain(`create or replace function public.${name}`);expect(fn).toContain("language plpgsql security invoker set search_path='' as $$");}
  expect(repairMigration.match(/create or replace function public\./g)).toHaveLength(7);
  expect(repairMigration).not.toMatch(/\b(?:create|alter|drop)\s+(?:table|index|policy|trigger|publication)\b/i);
 });
 it('qualifies table columns that collide with variables or RETURNS TABLE outputs',()=>{
  const functionNames=['add_room_ai_player_server','start_game_server','remove_room_ai_player_server','set_room_ai_player_color_server','set_room_ai_player_strategy_server','join_room_server','set_player_color_server'];
  const collidingNames='room_id|room_code|game_id|status|player_color|bot_strategy|turn_order|state_version|viewer_turn_order|ai_player_id|user_id|id|color';
  const barePredicate=new RegExp(`\\b(?:where|and|or)\\s+(?:${collidingNames})\\b`,'i');
  for(const name of functionNames)expect(repairBody(name),name).not.toMatch(barePredicate);

  const join=repairBody('join_room_server');
  expect(join).toContain('from public.room_players rp where rp.room_id=v_room_id');
  expect(join).toContain('from public.room_ai_players ai where ai.room_id=v_room_id');
  expect(join).toContain('where rp.room_id=v_room_id and rp.user_id=p_user_id');

  const color=repairBody('set_player_color_server');
  expect(color).toContain('where supported.game_id=v_game_id and supported.color=v_requested_color');
  expect(color).toContain('where other_player.room_id=v_room_id and other_player.user_id<>p_user_id');
  expect(color).toContain('where ai.room_id=v_room_id and ai.player_color=v_requested_color');

  const start=repairBody('start_game_server');
  expect(start).toContain('where rp.room_id=v_room_id');
  expect(start).toContain('where ai.room_id=v_room_id');
  expect(start).toContain('where rs.room_id=v_room_id and rs.game_state is null and rs.state_version=0');
  expect(start).toContain("where r.id=v_room_id and r.status='lobby'");
 });
 it('reasserts service-role-only execution for every replacement signature',()=>{for(const signature of ['add_room_ai_player_server(text,uuid)','start_game_server(text,uuid,jsonb,jsonb)','remove_room_ai_player_server(text,uuid,uuid)','set_room_ai_player_color_server(text,uuid,uuid,text)','set_room_ai_player_strategy_server(text,uuid,uuid,text)','join_room_server(text,uuid,text)','set_player_color_server(text,uuid,text)']){expect(repairMigration).toContain(`revoke execute on function public.${signature} from public, anon, authenticated, service_role;`);expect(repairMigration).toContain(`grant execute on function public.${signature} to service_role;`);}});
});

describe('M11 forward-only Start COALESCE repair',()=>{
 it('replaces Start only and preserves its signature and security boundary',()=>{expect(startCoalesceMigration.match(/create or replace function public\./g)).toHaveLength(1);expect(startCoalesceMigration).toContain('create or replace function public.start_game_server(p_room_code text,p_user_id uuid,p_expected_players jsonb,p_game_state jsonb)');expect(startCoalesceBody()).toContain("returns table(room_id uuid,room_code text,room_status text,state_version bigint)\nlanguage plpgsql security invoker set search_path='' as $$");expect(startCoalesceMigration).toContain('revoke execute on function public.start_game_server(text,uuid,jsonb,jsonb) from public, anon, authenticated, service_role;');expect(startCoalesceMigration).toContain('grant execute on function public.start_game_server(text,uuid,jsonb,jsonb) to service_role;');});
 it('uses SQL COALESCE while preserving qualified jsonb_array_length',()=>{const fn=startCoalesceBody();expect(fn).not.toContain('pg_catalog.coalesce(');expect(fn).toContain('coalesce(pg_catalog.jsonb_array_length(v_roster),0)');expect(fn.replace('coalesce(pg_catalog.jsonb_array_length(v_roster),0)','pg_catalog.coalesce(pg_catalog.jsonb_array_length(v_roster),0)')).toBe(repairBody('start_game_server'));});
 it('introduces no schema or architecture changes',()=>{expect(startCoalesceMigration).not.toMatch(/\b(?:create|alter|drop)\s+(?:table|index|policy|trigger|publication)\b/i);});
});

describe('human-first mixed Start ordering',()=>{
 it('orders humans by joined_at/user_id then AI by bot_number',()=>{const fn=startCoalesceBody();expect(fn).toContain('row_number()over(order by rp.joined_at,rp.user_id)');expect(fn).toContain('pg_catalog.jsonb_agg(participant order by participant_group,participant_order)');expect(fn).toContain('select 1,ai.bot_number');expect(fn).toContain('row_number()over(order by source.bot_number)');expect(fn).not.toContain('seat_number');});
 it('builds p1 Alice, p2 Bob, p3 AI 1, p4 AI 2',()=>{const roster:TrustedStartPlayer[]=[{control:'human',userId:'alice',displayName:'Alice',playerColor:'red'},{control:'human',userId:'bob',displayName:'Bob',playerColor:'blue'},{control:'ai',aiPlayerId:'ai-1',displayName:'AI 1',playerColor:'purple',botStrategy:'growth'},{control:'ai',aiPlayerId:'ai-2',displayName:'AI 2',playerColor:'yellow',botStrategy:'balanced'}];const state=buildWorshipMeInitialState(roster,'mixed');expect(state.players.map(({id,name,control,botStrategy})=>({id,name,control,botStrategy}))).toEqual([{id:'p1',name:'Alice',control:'human',botStrategy:undefined},{id:'p2',name:'Bob',control:'human',botStrategy:undefined},{id:'p3',name:'AI 1',control:'ai',botStrategy:'growth'},{id:'p4',name:'AI 2',control:'ai',botStrategy:'balanced'}]);});
 it('preserves the human-only createGame order',()=>{const state=buildWorshipMeInitialState([{control:'human',userId:'alice',displayName:'Alice',playerColor:'red'},{control:'human',userId:'bob',displayName:'Bob',playerColor:'blue'}],'humans');expect(state.players.map(player=>player.name)).toEqual(['Alice','Bob']);expect(state.turnOrder).toEqual(['p1','p2']);});
 it('persists compressed human then AI turn order in both tables',()=>{const fn=body('start_game_server');expect(fn).toContain('update public.room_players');expect(fn).toContain('update public.room_ai_players');expect(fn).toContain('v_human_count+ordered.position-1');});
 it('builds the trusted Edge roster from stable ordered human and AI reads',()=>{expect(startEdge).toContain(".order('joined_at').order('user_id')");expect(startEdge).toContain("from('room_ai_players')");expect(startEdge).toContain(".order('bot_number')");expect(startEdge).not.toContain('seat_number');});
});

describe('lobby UI and Edge contracts',()=>{
 const players:LobbyPlayer[]=[{control:'human',participantId:'alice',userId:'alice',displayName:'Alice',playerColor:'red',turnOrder:null,isReady:true,isHost:true,isCurrentUser:true},{control:'ai',participantId:'11111111-1111-4111-8111-111111111111',aiPlayerId:'11111111-1111-4111-8111-111111111111',botNumber:1,displayName:'AI 1',playerColor:'blue',turnOrder:null,botStrategy:'balanced',isHost:false,isCurrentUser:false}];
 it('reads humans then AI without fake bot user IDs',()=>{expect(lobby).toContain(".order('joined_at').order('user_id')");expect(lobby).toContain("from('room_ai_players')");expect(lobby).toContain(".order('bot_number')");expect(lobby).not.toContain('seat_number');});
 it('renders Add AI as a real host button wired to manage-ai-player, plus per-row host configuration',()=>{const host=renderLobbyPlayerRows(players,true),guest=renderLobbyPlayerRows(players,false);expect(shell).toContain('<button class="text-button" type="button" data-add-ai>ADD AI</button>');expect(shell).toContain("addAIButton.onclick=()=>{addAIButton.disabled=true;void manage({roomCode:lobby.room.code,command:{type:'addAI'}});");expect(host).toContain('data-ai-remove');expect(host).toContain('data-ai-color');expect(host).toContain('data-ai-strategy');expect(host).not.toContain('data-ai-ready');expect(guest).not.toContain('data-ai-remove');expect(guest).not.toContain('data-ai-color');expect(guest).not.toContain('data-ai-strategy');});
 it('strictly parses four commands and browser sends only roomCode plus command',async()=>{for(const type of ['addAI','removeAI','setAIColor','setAIStrategy'])expect(manageEdge).toContain(`command.type==='${type}'`);expect(manageEdge).toContain('exact(command');const invoke=vi.fn().mockResolvedValue({data:{roomCode:'ABC234'},error:null}),client={auth:{getSession:vi.fn().mockResolvedValue({data:{session:{user:{id:'u'}}},error:null})},functions:{invoke}} as unknown as SupabaseClient,command={type:'addAI' as const};await manageAIPlayer({roomCode:' abc234 ',command},client);expect(invoke).toHaveBeenCalledWith('manage-ai-player',{body:{roomCode:'ABC234',command}});expect(config).toContain('[functions.manage-ai-player]\nverify_jwt = true');});
});

describe('active AI remains server-authoritative and concurrent-safe',()=>{
 it('uses PostgreSQL-compatible schema-qualified substring calls for AI actor lookup',()=>{const fn=body('commit_ai_action_server');expect(fn.match(/pg_catalog\.substring\(p_expected_ai_player_id, 2\)/g)).toHaveLength(3);expect(fn).not.toMatch(/pg_catalog\.substring\([^)]*\sfrom\s/i);});
 it('uses canonical strategy, existing policy/reducer, canonical RNG, and does not mutate input',()=>{const state=createGame([{name:'AI 1',control:'ai',botStrategy:'balanced'},{name:'Alice',control:'human'}],'ai-step'),before=structuredClone(state),first=advanceOneAIDecision(state),second=advanceOneAIDecision(structuredClone(state));expect(first.advanced).toBe(true);expect(first).toEqual(second);expect(state).toEqual(before);const source=readFileSync(new URL('../src/games/worship-me/ai/advance.ts',import.meta.url),'utf8');for(const symbol of ['getPolicy','evaluateBotAction','commitBotAction','choosePendingResolution'])expect(source).toContain(symbol);expect(source).not.toContain('Math.random');});
 it('resolves AI pending decisions but stops for human-owned decisions',()=>{const state=createGame([{name:'AI',control:'ai',botStrategy:'growth'},{name:'Human'}],'pending'),from=state.board.find(cell=>cell.id==='1,1')!,to=state.board.find(cell=>cell.id==='1,2')!;from.visibleKind=from.hiddenKind!;to.visibleKind=to.hiddenKind!;from.villagers.push('red');const placement={type:'placeEdge',kind:'bless',playerId:'p1',from:from.id,to:to.id} as const;state.phase='resolution';state.actionQueue=[{sequence:1,placement}];state.pendingResolution={type:'blessEdgeMove',queueIndex:0,playerId:'p1',options:blessEdgeOptions(state,placement)};expect(advanceOneAIDecision(state).advanced).toBe(true);state.pendingResolution!.playerId='p2';expect(advanceOneAIDecision(state)).toEqual({advanced:false,reason:'human'});});
 it('re-reads after stale CAS, bounds retries/commits, and sends roomCode only',async()=>{expect(advanceEdge).toContain("rpc('get_active_game_state_server'");expect(advanceEdge).toContain("commitError.code==='P0006'&&staleRetries++<16)continue");expect(advanceEdge).toContain('while(commits<128)');expect(advanceEdge).toContain('Object.keys(payload).length!==1');const invoke=vi.fn().mockResolvedValue({data:{roomCode:'ABC234',status:'active'},error:null}),client={auth:{getSession:vi.fn().mockResolvedValue({data:{session:{user:{id:'u'}}},error:null})},functions:{invoke}} as unknown as SupabaseClient;await advanceAI({roomCode:'abc234'},client);expect(invoke).toHaveBeenCalledWith('advance-ai',{body:{roomCode:'ABC234'}});});
 it('guards one request per version and same-room re-entry generation before accepting',()=>{expect(shell).toContain('aiAttemptedVersion===result.stateVersion');expect(shell).toContain('token===aiAdvanceToken&&roomSync.isCurrent(code)');expect(shell).toContain('roomSync.acceptTrusted(next)');expect(shell).toContain('AI THINKING…');expect(shell).toContain('data-retry-ai');expect(shell).not.toContain('setInterval');});
});
