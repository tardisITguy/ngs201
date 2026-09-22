import {readFileSync,readdirSync} from 'node:fs';
import {describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {createGame} from '../src/games/worship-me/engine/setup';
import {buildWorshipMePublicGameView} from '../src/games/worship-me/publicGameView';
import {applyTrustedWorshipMeCommand,parseWorshipMeBrowserCommand} from '../src/games/worship-me/trustedGameCommand';
import {createSubmitGameAction,submitGameAction} from '../src/platform/rooms/submitGameAction';
import {describeBlessEdgeOption} from '../src/platform/rooms/blessEdgeOptionLabel';

const migration=readFileSync(new URL('../supabase/migrations/20260921000001_gameplay_mutation.sql',import.meta.url),'utf8');
const readMigration=readFileSync(new URL('../supabase/migrations/20260921000000_active_game_state_read.sql',import.meta.url),'utf8');
const core=readFileSync(new URL('../supabase/migrations/20260919190346_create_ngsllc_core.sql',import.meta.url),'utf8');
const edge=readFileSync(new URL('../supabase/functions/game-action/index.ts',import.meta.url),'utf8');
const clientSource=readFileSync(new URL('../src/platform/rooms/submitGameAction.ts',import.meta.url),'utf8');
const shell=readFileSync(new URL('../src/platform/shell.ts',import.meta.url),'utf8');
const config=readFileSync(new URL('../supabase/config.toml',import.meta.url),'utf8');
const session={access_token:'token',user:{id:'user-1'}};
const client=(invoke:ReturnType<typeof vi.fn>)=>({auth:{getSession:vi.fn().mockResolvedValue({data:{session},error:null})},functions:{invoke}} as unknown as SupabaseClient);
const reveal=(state:ReturnType<typeof createGame>,id:string,kind:'farm'|'bakery'|'home'='farm')=>{const cell=state.board.find(item=>item.id===id)!;cell.visibleKind=kind;cell.hiddenKind=kind;return cell;};
const finishPlacement=(state:ReturnType<typeof createGame>)=>{const round=state.round;while(state.phase==='placement'&&state.round===round)state=applyTrustedWorshipMeCommand(state,{type:'endTurn'},state.turnOrder[state.currentPlayerIndex]);return state;};

describe('strict browser intent and actual reducer integration',()=>{
 it('accepts exactly the six public command shapes',()=>{for(const command of [
  {type:'placeTile',kind:'bless',cellId:'1,2'},
  {type:'placeTile',kind:'smite',cellId:'1,2'},
  {type:'placeEdge',kind:'bless',from:'1,2',to:'1,3'},
  {type:'placeEdge',kind:'smite',a:'1,2',b:'1,3'},
  {type:'endTurn'},
  {type:'resolveBlessEdge',optionIndex:0},
  {type:'resolveSmiteResource',resource:'wheat'},
 ] as const)expect(parseWorshipMeBrowserCommand(command)).toEqual(command);});
 it.each([
  {type:'endTurn',playerId:'p2'},
  {type:'placeTile',kind:'bless',cellId:'1,2',seed:'bad'},
  {type:'resolveBlessEdge',optionIndex:0,gameState:{}},
  {type:'unknown'},
  {type:'placeEdge',kind:'bless',from:'1,2'},
 ])('rejects unknown, missing, and authority-bearing fields: %o',command=>expect(()=>parseWorshipMeBrowserCommand(command)).toThrow('Invalid game action request'));
 it('runs legal Bless/Smite tile, Bless/Smite edge, and End Turn through the existing reducer',()=>{
  let state=createGame(2,'trusted-actions'),p=state.turnOrder[state.currentPlayerIndex];
  state=applyTrustedWorshipMeCommand(state,{type:'placeTile',kind:'bless',cellId:'1,1'},p);expect(state.actionQueue.at(-1)?.placement).toMatchObject({type:'placeTile',kind:'bless',playerId:p});
  state=applyTrustedWorshipMeCommand(state,{type:'endTurn'},p);p=state.turnOrder[state.currentPlayerIndex];reveal(state,'1,3');reveal(state,'1,4');
  state=applyTrustedWorshipMeCommand(state,{type:'placeTile',kind:'smite',cellId:'1,3'},p);expect(state.actionQueue.at(-1)?.placement).toMatchObject({kind:'smite',playerId:p});
  expect(()=>applyTrustedWorshipMeCommand(state,{type:'placeTile',kind:'smite',cellId:'1,4'},p)).toThrow();
  let bless=createGame(2,'bless-edge');reveal(bless,'1,1');reveal(bless,'1,2');bless=applyTrustedWorshipMeCommand(bless,{type:'placeEdge',kind:'bless',from:'1,1',to:'1,2'},'p1');expect(bless.actionQueue[0].placement).toMatchObject({kind:'bless',playerId:'p1'});
  let smite=createGame(2,'smite-edge');reveal(smite,'1,1');reveal(smite,'1,2');smite=applyTrustedWorshipMeCommand(smite,{type:'placeEdge',kind:'smite',a:'1,1',b:'1,2'},'p1');expect(smite.actionQueue[0].placement).toMatchObject({kind:'smite',playerId:'p1'});
 });
 it('rejects wrong players and illegal targets without changing the input',()=>{const state=createGame(2,'wrong-player'),before=structuredClone(state);expect(()=>applyTrustedWorshipMeCommand(state,{type:'endTurn'},'p2')).toThrow('That action is not legal.');expect(()=>applyTrustedWorshipMeCommand(state,{type:'placeTile',kind:'smite',cellId:'1,1'},'p1')).toThrow();expect(state).toEqual(before);});
 it('resolves Bless Edge and Smite resource decisions through resolvePendingDecision',()=>{
  let bless=createGame(2,'pending-bless'),origin=reveal(bless,'1,1'),destination=reveal(bless,'1,2');origin.villagers.push('red');bless=applyTrustedWorshipMeCommand(bless,{type:'placeEdge',kind:'bless',from:origin.id,to:destination.id},'p1');bless=finishPlacement(bless);expect(bless.pendingResolution?.type).toBe('blessEdgeMove');const beforeBless=bless.resolutionIndex;bless=applyTrustedWorshipMeCommand(bless,{type:'resolveBlessEdge',optionIndex:0},'p1');expect(bless.resolutionIndex).toBeGreaterThanOrEqual(beforeBless);
  let smite=createGame(2,'pending-smite'),target=reveal(smite,'1,1');target.wheat=1;target.bread=1;smite=applyTrustedWorshipMeCommand(smite,{type:'placeTile',kind:'smite',cellId:target.id},'p1');smite=finishPlacement(smite);expect(smite.pendingResolution?.type).toBe('smiteResource');smite=applyTrustedWorshipMeCommand(smite,{type:'resolveSmiteResource',resource:'wheat'},'p1');expect(smite.board.find(cell=>cell.id===target.id)?.wheat).toBe(0);
 });
 it('keeps automatic round resolution, production, births, bag draws, Priests, and victory inside reducer.ts',()=>{for(const symbol of ['resolveProduction','resolveHomeBirths','resolveBagDraws','createPriests','checkVictory','startNextRound'])expect(readFileSync(new URL('../src/games/worship-me/engine/reducer.ts',import.meta.url),'utf8')).toContain(symbol);expect(edge).toContain('applyTrustedWorshipMeCommand');expect(edge).not.toMatch(/resolveProduction|resolveHomeBirths|createPriests|checkVictory/);});
});

describe('public pending-decision projection',()=>{
 it('allowlists Bless options without canonical queueIndex or raw pendingResolution',()=>{let state=createGame(2,'public-pending'),a=reveal(state,'1,1'),b=reveal(state,'1,2');a.villagers.push('red');state=applyTrustedWorshipMeCommand(state,{type:'placeEdge',kind:'bless',from:a.id,to:b.id},'p1');state=finishPlacement(state);const view=buildWorshipMePublicGameView(state),json=JSON.stringify(view);expect(view.pendingDecision).toMatchObject({type:'blessEdgeMove',playerId:'p1'});expect(json).not.toContain('queueIndex');expect(json).not.toContain('pendingResolution');for(const secret of ['seed','rngState','newVillagerBag','removedVillageTiles','history','eventLog','hiddenKind'])expect(json).not.toContain(`"${secret}"`);});
 it('allowlists Smite resource choices and fails closed on malformed pending state',()=>{let state=createGame(2,'public-smite'),target=reveal(state,'1,1');target.wheat=1;target.bread=1;state=applyTrustedWorshipMeCommand(state,{type:'placeTile',kind:'smite',cellId:target.id},'p1');state=finishPlacement(state);expect(buildWorshipMePublicGameView(state).pendingDecision).toEqual({type:'smiteResource',playerId:'p1',cellId:'1,1',options:['wheat','bread']});(state.pendingResolution as unknown as {options:unknown}).options=[{secret:true}];expect(()=>buildWorshipMePublicGameView(state)).toThrow('Invalid canonical game state');});
});

describe('Bless Edge resolution descriptions',()=>{
 it.each([
  [{from:'1,1',to:'1,2',resource:'wheat',resourceOnly:true},'Move 1 Wheat only · 1,1 → 1,2'],
  [{from:'1,1',to:'1,2',moverRole:'ordinary',moverColor:'red'},'Move Red Villager · 1,1 → 1,2'],
  [{from:'1,1',to:'1,2',moverRole:'ordinary',moverColor:'red',resource:'wheat'},'Move Red Villager + 1 Wheat · 1,1 → 1,2'],
  [{from:'1,1',to:'1,2',moverRole:'priest',moverColor:'red'},'Move Red Priest · 1,1 → 1,2'],
  [{from:'1,1',to:'1,2',moverRole:'priest',moverColor:'red',resource:'bread'},'Move Red Priest + 1 Bread · 1,1 → 1,2'],
  [{from:'1,1',to:'1,2',neutral:true,moverColor:'neutral'},'Move Neutral · 1,1 → 1,2'],
  [{from:'1,1',to:'1,2',opponent:true,moverRole:'ordinary',moverColor:'purple'},'Move Purple opponent · 1,1 → 1,2'],
 ] as const)('describes the public move option without implying conversion', (option,expected)=>expect(describeBlessEdgeOption(option)).toBe(expected));
});

describe('atomic gameplay mutation database contract',()=>{
 it('retains Milestone 8 unchanged before the Realtime migrations',()=>{const names=readdirSync(new URL('../supabase/migrations/',import.meta.url),{withFileTypes:true}).filter(file=>!file.isDirectory()&&file.name.endsWith('.sql')).map(file=>file.name).sort();expect(names.at(-1)).toBe('20260922000001_realtime_lobby_sync.sql');expect(names.at(-2)).toBe('20260922000000_realtime_game_sync.sql');expect(names.at(-3)).toBe('20260921000001_gameplay_mutation.sql');expect(names.at(-4)).toBe('20260921000000_active_game_state_read.sql');expect(names).toHaveLength(12);expect(readMigration).toContain('create function public.get_active_game_state_server');});
 it('locks room then room_states and gates status behind membership privacy',()=>{const roomLock=migration.indexOf('for update of r'),member=migration.indexOf('v_member_user_id is null'),status=migration.indexOf("v_room_status is distinct from 'active'"),stateLock=migration.indexOf('from public.room_states as rs');expect(roomLock).toBeGreaterThan(0);expect(roomLock).toBeLessThan(member);expect(member).toBeLessThan(status);expect(status).toBeLessThan(stateLock);expect(migration).toContain("errcode = 'P0002'");});
 it('requires trusted pN current-player mapping and the locked expected version',()=>{expect(migration).toContain("v_viewer_player_id := 'p' || (v_viewer_turn_order + 1)::text");expect(migration).toContain('v_player_count not between 2 and 8');expect(migration).toContain("jsonb_array_length(v_game_state->'turnOrder') <> v_player_count");expect(migration).toContain('v_viewer_turn_order >= v_player_count');expect(migration).toContain("v_game_state->'players'->(v_viewer_turn_order::integer)->>'id' is distinct from v_viewer_player_id");expect(migration).toContain("v_game_state->'turnOrder'->>v_current_player_index is distinct from v_viewer_player_id");expect(migration).toContain("v_game_state->'pendingResolution'->>'playerId' is distinct from v_viewer_player_id");expect(migration).toContain('v_state_version is distinct from p_expected_state_version');expect(migration).toContain("errcode = 'P0006'");});
 it('rejects out-of-count viewers and player/order count mismatches as unavailable before current-turn authorization',()=>{const unavailable=migration.indexOf('v_player_count not between 2 and 8'),turn=migration.indexOf("v_game_state->'turnOrder'->>v_current_player_index is distinct from v_viewer_player_id");expect(unavailable).toBeGreaterThan(0);expect(unavailable).toBeLessThan(turn);expect(migration.slice(unavailable,turn)).toContain("errcode = 'P0005'");});
 it.each([
  [{players:[{id:'p1'},{id:'p2'}],turnOrder:['p1','p2'],viewerTurnOrder:0},true],
  [{players:[{id:'p1'},{id:'p2'}],turnOrder:['p1','p2'],viewerTurnOrder:1},true],
  [{players:[{id:'p1'},{id:'p2'}],turnOrder:['p1','p2'],viewerTurnOrder:2},false],
  [{players:[{id:'p1'},{id:'wrong'}],turnOrder:['p1','p2'],viewerTurnOrder:1},false],
  [{players:[{id:'p1'},{id:'p2'}],turnOrder:['p1'],viewerTurnOrder:0},false],
 ] as const)('models canonical viewer mapping validation for %o',({players,turnOrder,viewerTurnOrder},expected)=>{const roster=players as readonly {id:string}[],valid=roster.length>=2&&roster.length<=8&&turnOrder.length===roster.length&&viewerTurnOrder>=0&&viewerTurnOrder<roster.length&&roster[viewerTurnOrder]?.id===`p${viewerTurnOrder+1}`;expect(valid).toBe(expected);});
 it('defends immutable seed/config/order/player/board structure and one-round maximum advance',()=>{for(const field of ['seed','config','turnOrder','removedVillageTiles','templeCellId','hiddenKind','templeOwnerId'])expect(migration).toContain(`'${field}'`);expect(migration).toContain('v_candidate_round > v_existing_round + 1');});
 it('performs one compare-and-swap update and increments the version exactly once',()=>{expect((migration.match(/update public\.room_states/g)??[])).toHaveLength(1);expect(migration).toContain('state_version = rs.state_version + 1');expect(migration).toContain('and rs.state_version = p_expected_state_version');expect(migration).toContain('get diagnostics v_updated = row_count');});
 it('is SECURITY INVOKER, empty-search-path, and service-role-only while room_states remains browser denied',()=>{expect(migration).toContain('security invoker');expect(migration).toContain("set search_path = ''");for(const role of ['public','anon','authenticated','service_role'])expect(migration).toContain(`revoke execute on function public.commit_game_action_server(text, uuid, bigint, jsonb) from ${role}`);expect(migration).toContain('grant execute on function public.commit_game_action_server(text, uuid, bigint, jsonb) to service_role');expect(core).toContain('revoke all on table public.room_states from public, anon, authenticated');expect(migration).not.toMatch(/grant .*room_states.*(?:anon|authenticated)/i);});
});

describe('trusted game-action Edge and browser client',()=>{
 it('uses verified JWT identity, exact fields, existing read/reducer/decision/commit, and public projection',()=>{expect(config).toMatch(/\[functions\.game-action\]\s*verify_jwt = true/);for(const source of ['auth.getUser(token)','p_user_id:user.id','get_active_game_state_server','applyTrustedWorshipMeCommand','commit_game_action_server','buildWorshipMePublicGameView'])expect(edge).toContain(source);expect(edge).toContain("keys.length!==3");expect(edge).not.toMatch(/response\(200,\s*(?:candidate|current|commitRow|readRow)/);});
 it('never accepts browser player identity or canonical state',()=>{expect(edge).not.toMatch(/record\.(?:playerId|userId|gameState|seed)/);expect(edge).toContain('`p${current.viewer_turn_order+1}`');expect(clientSource).not.toMatch(/\.from\(|\.rpc\(|applyAction|resolvePendingDecision/);});
 it('separates illegal reducer commands from public-projection failures',()=>{const reducer=edge.indexOf('try{candidate=applyTrustedWorshipMeCommand'),projection=edge.indexOf('try{gameView=buildWorshipMePublicGameView');expect(reducer).toBeGreaterThan(0);expect(projection).toBeGreaterThan(reducer);expect(edge.slice(reducer,projection)).toContain("response(400,{error:'That action is not legal.'})");expect(edge.slice(projection)).toContain("response(500,{error:'Game state is unavailable'})");expect(edge).not.toMatch(/error\.(?:message|details|hint|stack)/);});
 it('maps canonical viewer-state failures to the safe state-unavailable response',()=>{expect(edge).toContain("if(commitError.code==='P0005')return response(500,{error:'Game state is unavailable'})");});
 it('sends only normalized roomCode, expectedStateVersion, and command',async()=>{const gameView=buildWorshipMePublicGameView(createGame(2,'client')),invoke=vi.fn().mockResolvedValue({data:{roomCode:'ABC234',status:'active',stateVersion:2,viewerPlayerId:'p1',gameView},error:null});const command={type:'endTurn'} as const;await expect(submitGameAction({roomCode:' abc234 ',expectedStateVersion:1,command},client(invoke))).resolves.toMatchObject({stateVersion:2});expect(invoke).toHaveBeenCalledWith('game-action',{body:{roomCode:'ABC234',expectedStateVersion:1,command}});});
 it('prevents duplicate submissions',async()=>{let resolve!:(value:unknown)=>void;const command=vi.fn().mockImplementation(()=>new Promise(r=>resolve=r)),action=createSubmitGameAction(command),request={roomCode:'ABC234',expectedStateVersion:1,command:{type:'endTurn'} as const};const first=action(request);await expect(action(request)).resolves.toBeUndefined();expect(command).toHaveBeenCalledOnce();resolve({});await first;});
});

describe('multiplayer action UI contract',()=>{
 it('shows placement controls only to the current placement viewer and makes only that board interactive',()=>{for(const label of ['BLESS TILE','BLESS EDGE','SMITE TILE','SMITE EDGE','END TURN'])expect(shell).toContain(label);expect(shell).toContain("view.currentPlayerId===result.viewerPlayerId");expect(shell).toContain('renderBoard(view,{start:startCell,end:endCell},{interactive:canPlace})');});
 it('renders both resolution controls, trusts the immediate response, and has no polling/debug controls',()=>{expect(shell).toContain('data-bless-option');expect(shell).toContain('data-smite-resource');expect(shell).toContain('roomSync.acceptTrusted(next)');expect(clientSource).toContain('Game state changed. Refresh and try again.');const active=shell.slice(shell.indexOf('async function renderActiveGame'));expect(active).not.toContain('setInterval');for(const forbidden of ['Save','Resume','Export','Import','New Game','AI delay','debug JSON'])expect(active).not.toContain(forbidden);});
 it('shows Cancel after the first edge endpoint and Confirm only after a second distinct endpoint',()=>{expect(shell).toContain("edgeStarted=!!(mode&&(mode==='blessEdge'||mode==='smiteEdge')&&startCell)");expect(shell).toContain('edgeConfirm=!!(edgeStarted&&endCell)');expect(shell).toContain("if(!endCell&&id!==startCell){endCell=id");expect(shell).toContain("if(!mode||!startCell||!endCell)return");expect(shell).toContain("mode=undefined;startCell=undefined;endCell=undefined;notice='';paint()");const controls=shell.slice(shell.indexOf('if(canPlace)'),shell.indexOf('else if(pending)'));expect(controls.indexOf('edgeStarted?')).toBeLessThan(controls.indexOf('edgeConfirm?'));});
});
