import {readFileSync,readdirSync} from 'node:fs';
import {describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {createGame} from '../src/games/worship-me/engine/setup';
import {buildWorshipMePublicGameView} from '../src/games/worship-me/publicGameView';
import {renderBoard} from '../src/games/worship-me/ui/renderBoard';
import {createGetActiveGameStateAction,getActiveGameState} from '../src/platform/rooms/getActiveGameState';

const migration=readFileSync(new URL('../supabase/migrations/20260921000000_active_game_state_read.sql',import.meta.url),'utf8');
const core=readFileSync(new URL('../supabase/migrations/20260919190346_create_ngsllc_core.sql',import.meta.url),'utf8');
const edge=readFileSync(new URL('../supabase/functions/get-game-state/index.ts',import.meta.url),'utf8');
const projection=readFileSync(new URL('../src/games/worship-me/publicGameView.ts',import.meta.url),'utf8');
const clientSource=readFileSync(new URL('../src/platform/rooms/getActiveGameState.ts',import.meta.url),'utf8');
const shell=readFileSync(new URL('../src/platform/shell.ts',import.meta.url),'utf8');
const config=readFileSync(new URL('../supabase/config.toml',import.meta.url),'utf8');
const session={access_token:'token',user:{id:'user-1'}};
const client=(invoke:ReturnType<typeof vi.fn>)=>({auth:{getSession:vi.fn().mockResolvedValue({data:{session},error:null})},functions:{invoke}} as unknown as SupabaseClient);

describe('Worship Me! public game projection',()=>{
 it('constructs an allowlisted view and omits every canonical secret at runtime',()=>{const state=createGame([{name:'Alice',color:'red'},{name:'Bob',color:'blue'}],'do-not-leak');const hidden=state.board.find(cell=>cell.visibleKind==='hidden')!;expect(hidden.hiddenKind).toBeDefined();const square=state.board.find(cell=>cell.visibleKind==='square')!;square.wheat=2;square.bread=1;square.priests.push('red');const view=buildWorshipMePublicGameView(state),json=JSON.stringify(view);expect(view.board).toHaveLength(25);expect(view.board.find(cell=>cell.id===hidden.id)).toEqual(expect.objectContaining({visibleKind:'hidden'}));expect(view.board.find(cell=>cell.id===hidden.id)).not.toHaveProperty('hiddenKind');for(const secret of ['seed','rngState','removedVillageTiles','newVillagerBag','history','eventLog','game_state'])expect(json).not.toContain(`"${secret}"`);expect(view.board.find(cell=>cell.id===square.id)).toMatchObject({visibleKind:'square',wheat:2,bread:1,priests:['red']});expect(view.board.some(cell=>cell.visibleKind==='temple')).toBe(true);expect(view.currentPlayerId).toBe(state.turnOrder[state.currentPlayerIndex]);});
 it('orders public players canonically and never shallow-copies canonical state',()=>{const view=buildWorshipMePublicGameView(createGame([{name:'Alice',color:'red'},{name:'Bob',color:'blue'}],'private'));expect(view.players.map(player=>player.id)).toEqual(['p1','p2']);expect(projection).not.toMatch(/\.\.\.\s*(?:value|state|gameState)/);});
 it('treats a face-down cell as an opaque sanitized public object',()=>{const state=createGame(2,'opaque'),canonical=state.board.find(cell=>cell.visibleKind==='hidden')!,hidden=buildWorshipMePublicGameView(state).board.find(cell=>cell.id===canonical.id)!;expect(hidden).toEqual({id:canonical.id,row:canonical.row,col:canonical.col,visibleKind:'hidden',villagers:[],priests:[],wheat:0,bread:0});for(const field of ['hiddenKind','templeOwnerId','tileModifier'])expect(hidden).not.toHaveProperty(field);});
 it.each([
  ['a villager',(cell:ReturnType<typeof createGame>['board'][number])=>cell.villagers.push('red')],
  ['a priest',(cell:ReturnType<typeof createGame>['board'][number])=>cell.priests.push('red')],
  ['wheat',(cell:ReturnType<typeof createGame>['board'][number])=>{cell.wheat=1;}],
  ['bread',(cell:ReturnType<typeof createGame>['board'][number])=>{cell.bread=1;}],
  ['a temple owner',(cell:ReturnType<typeof createGame>['board'][number])=>{cell.templeOwnerId='p1';}],
  ['a tile modifier',(cell:ReturnType<typeof createGame>['board'][number])=>{cell.tileModifier={playerId:'p1',kind:'bless'};}],
 ])('rejects a face-down canonical cell containing %s',(_label,mutate)=>{const state=createGame(2,'malformed-hidden'),hidden=state.board.find(cell=>cell.visibleKind==='hidden')!;mutate(hidden);expect(()=>buildWorshipMePublicGameView(state)).toThrow(new Error('Invalid canonical game state'));});
 it('renders the same board read-only while preserving default interactive rendering',()=>{const state=createGame(2,'render');const view=buildWorshipMePublicGameView(state),readOnly=renderBoard(view,{}, {interactive:false}),interactive=renderBoard(state);expect(readOnly).not.toContain('<button');expect(readOnly).not.toContain('data-cell=');expect(readOnly).toContain('role="img"');expect((readOnly.match(/class="cell /g)??[])).toHaveLength(25);expect(interactive).toContain('<button');expect(interactive).toContain('data-cell=');});
});

describe('service-only active-state read contract',()=>{
 it('retains the Milestone 7 migration before Milestones 8, 9, 10, 11, and its repairs',()=>{const names=readdirSync(new URL('../supabase/migrations/',import.meta.url),{withFileTypes:true}).filter(file=>!file.isDirectory()&&file.name.endsWith('.sql')).map(file=>file.name).sort();expect(names.at(-8)).toBe('20260921000000_active_game_state_read.sql');expect(names.at(-7)).toBe('20260921000001_gameplay_mutation.sql');expect(names.at(-6)).toBe('20260922000000_realtime_game_sync.sql');expect(names.at(-5)).toBe('20260922000001_realtime_lobby_sync.sql');expect(names.at(-4)).toBe('20260922000002_multiplayer_ai_players.sql');expect(names.at(-3)).toBe('20260923000000_fix_multiplayer_ai_sql_ambiguity.sql');expect(names.at(-2)).toBe('20260923000001_fix_start_game_coalesce.sql');expect(names.at(-1)).toBe('20260923000002_active_player_ai_takeover.sql');expect(names).toHaveLength(16);});
 it('uses membership-gated active-state reads without writes or locks',()=>{expect(migration).toContain('create function public.get_active_game_state_server');expect(migration).toContain('join public.room_players as rp');expect(migration).toContain('rp.user_id = p_user_id');expect(migration).toContain("errcode = 'P0002'");expect(migration).toContain("v_room_status is distinct from 'active'");expect(migration).toContain('v_viewer_turn_order is null');expect(migration).toContain('v_game_state is null');expect(migration).toContain('v_state_version < 1');expect(migration).not.toMatch(/for update|update public\.|insert into|delete from/i);});
 it('is invoker, empty-search-path, and service-role-only',()=>{expect(migration).toContain('security invoker');expect(migration).toContain("set search_path = ''");for(const role of ['public','anon','authenticated','service_role'])expect(migration).toContain(`revoke execute on function public.get_active_game_state_server(text, uuid) from ${role}`);expect(migration).toContain('grant execute on function public.get_active_game_state_server(text, uuid) to service_role');});
 it('preserves room_states browser denial',()=>{expect(core).toContain('alter table public.room_states enable row level security');expect(core).toContain('revoke all on table public.room_states from public, anon, authenticated');expect(migration).not.toMatch(/grant .*room_states.*(?:anon|authenticated)/i);});
});

describe('trusted get-game-state Edge and browser client',()=>{
 it('uses verified identity, roomCode-only input, and a Deno-compatible projection import',()=>{expect(edge).toContain('auth.getUser(token)');expect(edge).toContain('p_user_id:user.id');expect(edge).toContain("keys.length!==1||keys[0]!=='roomCode'");expect(edge).toContain("publicGameView.ts'");expect(config).toMatch(/\[functions\.get-game-state\]\s*verify_jwt = true/);});
 it('projects server-side and never returns the RPC row or raw canonical field',()=>{expect(edge).toContain('buildWorshipMePublicGameView(value.game_state)');expect(edge).toContain('gameView});');expect(edge).not.toMatch(/response\(200,\s*(?:row|value|data)\)/);expect(edge).not.toMatch(/game_state\s*:/);});
 it('maps viewer order to pN and sanitizes unavailable/non-active errors',()=>{expect(edge).toContain('`p${value.viewer_turn_order+1}`');expect(edge).toContain("error.code==='P0002'");expect(edge).toContain("error.code==='P0004'");expect(edge).not.toMatch(/error\.(?:message|details|hint|stack)/);});
 it('sends only normalized roomCode and returns the typed public result',async()=>{const gameView=buildWorshipMePublicGameView(createGame(2,'safe')),invoke=vi.fn().mockResolvedValue({data:{roomCode:'ABC234',status:'active',stateVersion:1,viewerPlayerId:'p2',gameView},error:null});await expect(getActiveGameState({roomCode:' abc234 '},client(invoke))).resolves.toMatchObject({roomCode:'ABC234',stateVersion:1,viewerPlayerId:'p2'});expect(invoke).toHaveBeenCalledWith('get-game-state',{body:{roomCode:'ABC234'}});expect(clientSource).not.toMatch(/\.from\(|\.rpc\(/);});
 it('prevents duplicate manual refresh requests',async()=>{let resolve!:(value:unknown)=>void;const command=vi.fn().mockImplementation(()=>new Promise(r=>resolve=r)),action=createGetActiveGameStateAction(command);const first=action({roomCode:'ABC234'});await expect(action({roomCode:'ABC234'})).resolves.toBeUndefined();expect(command).toHaveBeenCalledOnce();resolve({});await first;});
});

describe('active read-only room page',()=>{
 it('fetches trusted state only after active lobby status and renders status, board, version, viewer and turn',()=>{expect(shell).toContain("if(lobby.room.status==='active')");expect(shell).toContain('void renderActiveGame(lobby.room.code)');expect(shell).toContain('STATE VERSION ${result.stateVersion}');expect(shell).toContain('Current Turn:');expect(shell).toContain('You:');expect(shell).toContain('renderBoard(view,{start:startCell,end:endCell},{interactive:canPlace})');});
 it('keeps manual refresh without polling or lobby mutation controls',()=>{const active=shell.slice(shell.indexOf('async function renderActiveGame'));expect(active).toContain('data-refresh-game');expect(active).toContain("refresh.textContent='REFRESHING…'");expect(active).not.toContain('setInterval');expect(active).toContain('data-leave-game');for(const control of ['data-leave>','data-ready','data-start','data-player-color-select'])expect(active).not.toContain(control);});
 it('keeps terminal rooms out of mutable lobby controls',()=>{expect(shell).toContain("if(lobby.room.status!=='lobby')");});
});
