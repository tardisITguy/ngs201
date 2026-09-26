-- Schema v10 rules require matching trusted database validation.
-- No conversion: complete/clear v9 games before deploying the v10 engine.

create or replace function public.start_game_server(p_room_code text,p_user_id uuid,p_expected_players jsonb,p_game_state jsonb)
returns table(room_id uuid,room_code text,room_status text,state_version bigint)
language plpgsql security invoker set search_path='' as $$
declare v_room_id uuid;v_room_code text;v_game_id uuid;v_host_user_id uuid;v_room_status text;v_game_status text;v_min_players smallint;v_max_players smallint;v_player_count integer;v_human_count integer;v_roster jsonb;v_existing_state jsonb;v_state_version bigint;
begin
 if p_user_id is null then raise exception using errcode='22023',message='User is required';end if;v_room_code:=pg_catalog.upper(pg_catalog.btrim(p_room_code));if v_room_code is null or pg_catalog.char_length(v_room_code)not between 6 and 10 or v_room_code!~'^[A-Z0-9]+$' or pg_catalog.jsonb_typeof(p_expected_players)is distinct from 'array' or pg_catalog.jsonb_typeof(p_game_state)is distinct from 'object' then raise exception using errcode='22023',message='Invalid Start request';end if;
 select r.id,r.code,r.game_id,r.host_user_id,r.status into v_room_id,v_room_code,v_game_id,v_host_user_id,v_room_status from public.rooms r where r.code=v_room_code for update of r;if v_room_id is null or not exists(select 1 from public.room_players m where m.room_id=v_room_id and m.user_id=p_user_id)then raise exception using errcode='P0002',message='Room not found or unavailable';end if;if v_host_user_id<>p_user_id then raise exception using errcode='P0003',message='Only the host can start the game';end if;if v_room_status<>'lobby' then raise exception using errcode='P0005',message='Game has already started';end if;select g.status,g.min_players,g.max_players into v_game_status,v_min_players,v_max_players from public.games g where g.id=v_game_id;if v_game_status is distinct from 'active' then raise exception using errcode='P0004',message='Lobby is not ready';end if;
 select pg_catalog.count(*)::integer into v_human_count from public.room_players rp where rp.room_id=v_room_id;
 select pg_catalog.jsonb_agg(participant order by participant_group,participant_order)into v_roster from(
  select 0 participant_group,pg_catalog.row_number()over(order by rp.joined_at,rp.user_id)participant_order,pg_catalog.jsonb_build_object('control','human','userId',rp.user_id::text,'displayName',rp.display_name,'playerColor',rp.player_color)participant from public.room_players rp where rp.room_id=v_room_id
  union all
  select 1,ai.bot_number,pg_catalog.jsonb_build_object('control','ai','aiPlayerId',ai.id::text,'displayName','AI '||ai.bot_number::text,'playerColor',ai.player_color,'botStrategy',ai.bot_strategy)from public.room_ai_players ai where ai.room_id=v_room_id
 )occupied;v_player_count:=coalesce(pg_catalog.jsonb_array_length(v_roster),0);
 if v_player_count<v_min_players or v_player_count>v_max_players or exists(select 1 from public.room_players rp where rp.room_id=v_room_id and(not rp.is_ready or rp.player_color is null or rp.turn_order is not null))or exists(select 1 from public.room_ai_players ai where ai.room_id=v_room_id and(ai.turn_order is not null or ai.bot_strategy not in('random','growth','templeRush','balanced')))or exists(select 1 from(select rp.player_color from public.room_players rp where rp.room_id=v_room_id union all select ai.player_color from public.room_ai_players ai where ai.room_id=v_room_id)c where c.player_color is null or not exists(select 1 from public.game_player_colors supported where supported.game_id=v_game_id and supported.color=c.player_color))or(select pg_catalog.count(distinct c.player_color)from(select rp.player_color from public.room_players rp where rp.room_id=v_room_id union all select ai.player_color from public.room_ai_players ai where ai.room_id=v_room_id)c)<>v_player_count then raise exception using errcode='P0004',message='Lobby is not ready';end if;if v_roster is distinct from p_expected_players then raise exception using errcode='P0006',message='Lobby roster changed';end if;
 select rs.game_state,rs.state_version into v_existing_state,v_state_version from public.room_states rs where rs.room_id=v_room_id for update of rs;if not found then raise exception using errcode='P0004',message='Lobby is not ready';end if;if v_existing_state is not null or v_state_version<>0 then raise exception using errcode='P0005',message='Game has already started';end if;
 if p_game_state->'schemaVersion' is distinct from '10'::jsonb or pg_catalog.jsonb_typeof(p_game_state->'players')is distinct from 'array' or pg_catalog.jsonb_array_length(p_game_state->'players')<>v_player_count or pg_catalog.jsonb_typeof(p_game_state->'turnOrder')is distinct from 'array' or pg_catalog.jsonb_array_length(p_game_state->'turnOrder')<>v_player_count or p_game_state->>'phase' is distinct from 'placement' or p_game_state->'round' is distinct from '1'::jsonb or pg_catalog.jsonb_typeof(p_game_state->'currentPlayerIndex')is distinct from 'number' or(p_game_state->>'currentPlayerIndex')!~'^\d+$' or(p_game_state->>'currentPlayerIndex')::integer not between 0 and v_player_count-1 or nullif(pg_catalog.btrim(p_game_state->>'seed'),'')is null or exists(select 1 from pg_catalog.generate_series(0,v_player_count-1)ordinal(index)where pg_catalog.jsonb_typeof(p_expected_players->index)is distinct from 'object' or pg_catalog.jsonb_typeof(p_game_state->'players'->index)is distinct from 'object' or p_game_state->'players'->index->>'id' is distinct from 'p'||(index+1)::text or p_game_state->'players'->index->>'name' is distinct from p_expected_players->index->>'displayName' or p_game_state->'players'->index->>'color' is distinct from p_expected_players->index->>'playerColor' or p_game_state->'players'->index->>'control' is distinct from p_expected_players->index->>'control' or p_game_state->'turnOrder'->>index is distinct from 'p'||(index+1)::text or(p_expected_players->index->>'control'='ai' and p_game_state->'players'->index->>'botStrategy' is distinct from p_expected_players->index->>'botStrategy')or(p_expected_players->index->>'control'='human' and p_game_state->'players'->index?'botStrategy' and p_game_state->'players'->index->'botStrategy'<>'null'::jsonb))then raise exception using errcode='22023',message='Invalid candidate game state';end if;
 with ordered as(select rp.user_id,(pg_catalog.row_number()over(order by rp.joined_at,rp.user_id)-1)::smallint position from public.room_players rp where rp.room_id=v_room_id)update public.room_players rp set turn_order=ordered.position from ordered where rp.room_id=v_room_id and rp.user_id=ordered.user_id;
 update public.room_ai_players ai set turn_order=(v_human_count+ordered.position-1)::smallint from(select source.id,pg_catalog.row_number()over(order by source.bot_number)position from public.room_ai_players source where source.room_id=v_room_id)ordered where ai.room_id=v_room_id and ai.id=ordered.id;
 update public.room_states rs set game_state=p_game_state,state_version=1 where rs.room_id=v_room_id and rs.game_state is null and rs.state_version=0;update public.rooms r set status='active' where r.id=v_room_id and r.status='lobby';return query select v_room_id,v_room_code,'active'::text,1::bigint;
end;$$;

create or replace function public.commit_game_action_server(p_room_code text,p_user_id uuid,p_expected_state_version bigint,p_next_game_state jsonb)
returns table(room_code text,room_status text,state_version bigint,viewer_turn_order smallint)
language plpgsql security invoker set search_path='' as $$
declare v_room_id uuid;v_room_code text;v_room_status text;v_member_user_id uuid;v_viewer_turn_order smallint;v_viewer_player_id text;v_state_version bigint;v_game_state jsonb;v_current_player_index integer;v_player_count integer;v_existing_round integer;v_candidate_round integer;v_index integer;v_updated integer;
begin
 if p_user_id is null or p_expected_state_version is null or p_expected_state_version<1 then raise exception using errcode='22023',message='Invalid game action request';end if;v_room_code:=pg_catalog.upper(pg_catalog.btrim(p_room_code));if v_room_code is null or pg_catalog.char_length(v_room_code)not between 6 and 10 or v_room_code!~'^[A-Z0-9]+$' or pg_catalog.jsonb_typeof(p_next_game_state)is distinct from 'object' then raise exception using errcode='22023',message='Invalid game action request';end if;
 select r.id,r.status,rp.user_id,rp.turn_order into v_room_id,v_room_status,v_member_user_id,v_viewer_turn_order from public.rooms r left join public.room_players rp on rp.room_id=r.id and rp.user_id=p_user_id where r.code=v_room_code for update of r;if not found or v_member_user_id is null then raise exception using errcode='P0002',message='Room not found or unavailable';end if;if v_room_status is distinct from 'active' then raise exception using errcode='P0004',message='Game is not active';end if;if v_viewer_turn_order is null or v_viewer_turn_order<0 then raise exception using errcode='P0005',message='Game state is unavailable';end if;v_viewer_player_id:='p'||(v_viewer_turn_order+1)::text;
 select rs.state_version,rs.game_state into v_state_version,v_game_state from public.room_states rs where rs.room_id=v_room_id for update;if not found or v_state_version<1 or pg_catalog.jsonb_typeof(v_game_state)is distinct from 'object' then raise exception using errcode='P0005',message='Game state is unavailable';end if;if v_state_version is distinct from p_expected_state_version then raise exception using errcode='P0006',message='Game state changed';end if;
 if v_game_state->'schemaVersion' is distinct from '10'::jsonb or pg_catalog.jsonb_typeof(v_game_state->'players')is distinct from 'array' or pg_catalog.jsonb_typeof(v_game_state->'turnOrder')is distinct from 'array' or pg_catalog.jsonb_typeof(v_game_state->'board')is distinct from 'array' or pg_catalog.jsonb_typeof(v_game_state->'currentPlayerIndex')is distinct from 'number' or(v_game_state->>'currentPlayerIndex')!~'^\d+$' then raise exception using errcode='P0005',message='Game state is unavailable';end if;v_player_count:=pg_catalog.jsonb_array_length(v_game_state->'players');v_current_player_index:=(v_game_state->>'currentPlayerIndex')::integer;if v_player_count not between 2 and 8 or pg_catalog.jsonb_array_length(v_game_state->'turnOrder')<>v_player_count or v_current_player_index not between 0 and v_player_count-1 or v_viewer_turn_order>=v_player_count then raise exception using errcode='P0005',message='Game state is unavailable';end if;
 if v_game_state->'turnOrder'->>v_current_player_index is distinct from v_viewer_player_id or v_game_state->'players'->v_viewer_turn_order->>'control' is distinct from 'human' or(v_game_state?'pendingResolution' and v_game_state->'pendingResolution' is not null and v_game_state->'pendingResolution'<>'null'::jsonb and v_game_state->'pendingResolution'->>'playerId' is distinct from v_viewer_player_id)then raise exception using errcode='P0003',message='Not the active player';end if;
 if p_next_game_state->'schemaVersion' is distinct from '10'::jsonb or p_next_game_state->'seed' is distinct from v_game_state->'seed' or p_next_game_state->'config' is distinct from v_game_state->'config' or p_next_game_state->'turnOrder' is distinct from v_game_state->'turnOrder' or p_next_game_state->'removedVillageTiles' is distinct from v_game_state->'removedVillageTiles' or pg_catalog.jsonb_typeof(p_next_game_state->'players')is distinct from 'array' or pg_catalog.jsonb_array_length(p_next_game_state->'players')<>v_player_count or pg_catalog.jsonb_typeof(p_next_game_state->'board')is distinct from 'array' or pg_catalog.jsonb_array_length(p_next_game_state->'board')<>25 or pg_catalog.jsonb_array_length(v_game_state->'board')<>25 or pg_catalog.jsonb_typeof(p_next_game_state->'round')is distinct from 'number' or(p_next_game_state->>'round')!~'^\d+$' or pg_catalog.jsonb_typeof(v_game_state->'round')is distinct from 'number' or(v_game_state->>'round')!~'^\d+$' then raise exception using errcode='22023',message='Invalid candidate game state';end if;v_existing_round:=(v_game_state->>'round')::integer;v_candidate_round:=(p_next_game_state->>'round')::integer;if v_candidate_round<v_existing_round or v_candidate_round>v_existing_round+1 then raise exception using errcode='22023',message='Invalid candidate game state';end if;
 for v_index in 0..v_player_count-1 loop if pg_catalog.jsonb_typeof(p_next_game_state->'players'->v_index)is distinct from 'object' or p_next_game_state->'players'->v_index->'id' is distinct from v_game_state->'players'->v_index->'id' or p_next_game_state->'players'->v_index->'name' is distinct from v_game_state->'players'->v_index->'name' or p_next_game_state->'players'->v_index->'color' is distinct from v_game_state->'players'->v_index->'color' or p_next_game_state->'players'->v_index->'templeCellId' is distinct from v_game_state->'players'->v_index->'templeCellId' or p_next_game_state->'players'->v_index->'control' is distinct from v_game_state->'players'->v_index->'control' or p_next_game_state->'players'->v_index->'botStrategy' is distinct from v_game_state->'players'->v_index->'botStrategy' then raise exception using errcode='22023',message='Invalid candidate game state';end if;end loop;
 for v_index in 0..24 loop if pg_catalog.jsonb_typeof(p_next_game_state->'board'->v_index)is distinct from 'object' or p_next_game_state->'board'->v_index->'id' is distinct from v_game_state->'board'->v_index->'id' or p_next_game_state->'board'->v_index->'row' is distinct from v_game_state->'board'->v_index->'row' or p_next_game_state->'board'->v_index->'col' is distinct from v_game_state->'board'->v_index->'col' or p_next_game_state->'board'->v_index->'hiddenKind' is distinct from v_game_state->'board'->v_index->'hiddenKind' or p_next_game_state->'board'->v_index->'templeOwnerId' is distinct from v_game_state->'board'->v_index->'templeOwnerId' then raise exception using errcode='22023',message='Invalid candidate game state';end if;end loop;
 update public.room_states rs set game_state=p_next_game_state,state_version=rs.state_version+1,updated_at=pg_catalog.now()where rs.room_id=v_room_id and rs.state_version=p_expected_state_version;get diagnostics v_updated=row_count;if v_updated<>1 then raise exception using errcode='P0006',message='Game state changed';end if;return query select v_room_code,v_room_status,v_state_version+1,v_viewer_turn_order;
end;$$;

create or replace function public.commit_ai_action_server(p_room_code text,p_user_id uuid,p_expected_state_version bigint,p_expected_ai_player_id text,p_next_game_state jsonb)
returns table(room_code text,room_status text,state_version bigint,viewer_turn_order smallint)
language plpgsql security invoker set search_path='' as $$
declare v_room_id uuid;v_room_code text;v_status text;v_viewer_turn_order smallint;v_version bigint;v_state jsonb;v_count integer;v_index integer;v_round integer;v_next_round integer;v_current text;v_updated integer;
begin
 if p_user_id is null or p_expected_state_version is null or p_expected_state_version<1 or p_expected_ai_player_id is null or p_expected_ai_player_id!~'^p[1-8]$' or pg_catalog.jsonb_typeof(p_next_game_state)is distinct from 'object' then raise exception using errcode='22023',message='Invalid AI action request';end if;v_room_code:=pg_catalog.upper(pg_catalog.btrim(p_room_code));if v_room_code is null or pg_catalog.char_length(v_room_code)not between 6 and 10 or v_room_code!~'^[A-Z0-9]+$' then raise exception using errcode='22023',message='Invalid AI action request';end if;
 select r.id,r.status,rp.turn_order into v_room_id,v_status,v_viewer_turn_order from public.rooms r join public.room_players rp on rp.room_id=r.id and rp.user_id=p_user_id where r.code=v_room_code for update of r;if not found then raise exception using errcode='P0002',message='Room not found or unavailable';end if;if v_status<>'active' then raise exception using errcode='P0004',message='Game is not active';end if;
 select rs.state_version,rs.game_state into v_version,v_state from public.room_states rs where rs.room_id=v_room_id for update;if not found or v_version<1 or pg_catalog.jsonb_typeof(v_state)is distinct from 'object' then raise exception using errcode='P0005',message='Game state is unavailable';end if;if v_version<>p_expected_state_version then raise exception using errcode='P0006',message='Game state changed';end if;
 if v_state->'schemaVersion' is distinct from '10'::jsonb or pg_catalog.jsonb_typeof(v_state->'players')is distinct from 'array' or pg_catalog.jsonb_typeof(v_state->'turnOrder')is distinct from 'array' or pg_catalog.jsonb_typeof(v_state->'board')is distinct from 'array' or pg_catalog.jsonb_typeof(v_state->'currentPlayerIndex')is distinct from 'number' or(v_state->>'currentPlayerIndex')!~'^\d+$' then raise exception using errcode='P0005',message='Game state is unavailable';end if;v_count:=pg_catalog.jsonb_array_length(v_state->'players');if v_count not between 2 and 8 or pg_catalog.jsonb_array_length(v_state->'turnOrder')<>v_count or(v_state->>'currentPlayerIndex')::integer not between 0 and v_count-1 then raise exception using errcode='P0005',message='Game state is unavailable';end if;v_current:=v_state->'turnOrder'->>((v_state->>'currentPlayerIndex')::integer);
 if v_current is distinct from p_expected_ai_player_id or v_state->'players'->((pg_catalog.substring(p_expected_ai_player_id, 2))::integer-1)->>'control' is distinct from 'ai' or v_state->'players'->((pg_catalog.substring(p_expected_ai_player_id, 2))::integer-1)->>'botStrategy' is null or v_state->'players'->((pg_catalog.substring(p_expected_ai_player_id, 2))::integer-1)->>'botStrategy' not in('random','growth','templeRush','balanced')or(v_state?'pendingResolution' and v_state->'pendingResolution' is not null and v_state->'pendingResolution'<>'null'::jsonb and v_state->'pendingResolution'->>'playerId' is distinct from p_expected_ai_player_id)then raise exception using errcode='P0003',message='AI is not active';end if;
 if p_next_game_state->'schemaVersion' is distinct from '10'::jsonb or p_next_game_state->'seed' is distinct from v_state->'seed' or p_next_game_state->'config' is distinct from v_state->'config' or p_next_game_state->'turnOrder' is distinct from v_state->'turnOrder' or p_next_game_state->'removedVillageTiles' is distinct from v_state->'removedVillageTiles' or pg_catalog.jsonb_typeof(p_next_game_state->'players')is distinct from 'array' or pg_catalog.jsonb_array_length(p_next_game_state->'players')<>v_count or pg_catalog.jsonb_typeof(p_next_game_state->'board')is distinct from 'array' or pg_catalog.jsonb_array_length(p_next_game_state->'board')<>25 or pg_catalog.jsonb_array_length(v_state->'board')<>25 or pg_catalog.jsonb_typeof(p_next_game_state->'round')is distinct from 'number' or(p_next_game_state->>'round')!~'^\d+$' or pg_catalog.jsonb_typeof(v_state->'round')is distinct from 'number' or(v_state->>'round')!~'^\d+$' then raise exception using errcode='22023',message='Invalid candidate game state';end if;v_round:=(v_state->>'round')::integer;v_next_round:=(p_next_game_state->>'round')::integer;if v_next_round<v_round or v_next_round>v_round+1 then raise exception using errcode='22023',message='Invalid candidate game state';end if;
 for v_index in 0..v_count-1 loop if pg_catalog.jsonb_typeof(p_next_game_state->'players'->v_index)is distinct from 'object' or p_next_game_state->'players'->v_index->'id' is distinct from v_state->'players'->v_index->'id' or p_next_game_state->'players'->v_index->'name' is distinct from v_state->'players'->v_index->'name' or p_next_game_state->'players'->v_index->'color' is distinct from v_state->'players'->v_index->'color' or p_next_game_state->'players'->v_index->'templeCellId' is distinct from v_state->'players'->v_index->'templeCellId' or p_next_game_state->'players'->v_index->'control' is distinct from v_state->'players'->v_index->'control' or p_next_game_state->'players'->v_index->'botStrategy' is distinct from v_state->'players'->v_index->'botStrategy' then raise exception using errcode='22023',message='Invalid candidate game state';end if;end loop;
 for v_index in 0..24 loop if pg_catalog.jsonb_typeof(p_next_game_state->'board'->v_index)is distinct from 'object' or p_next_game_state->'board'->v_index->'id' is distinct from v_state->'board'->v_index->'id' or p_next_game_state->'board'->v_index->'row' is distinct from v_state->'board'->v_index->'row' or p_next_game_state->'board'->v_index->'col' is distinct from v_state->'board'->v_index->'col' or p_next_game_state->'board'->v_index->'hiddenKind' is distinct from v_state->'board'->v_index->'hiddenKind' or p_next_game_state->'board'->v_index->'templeOwnerId' is distinct from v_state->'board'->v_index->'templeOwnerId' then raise exception using errcode='22023',message='Invalid candidate game state';end if;end loop;
 update public.room_states rs set game_state=p_next_game_state,state_version=rs.state_version+1,updated_at=pg_catalog.now()where rs.room_id=v_room_id and rs.state_version=p_expected_state_version;get diagnostics v_updated=row_count;if v_updated<>1 then raise exception using errcode='P0006',message='Game state changed';end if;return query select v_room_code,v_status,v_version+1,v_viewer_turn_order;
end;$$;

create or replace function public.return_finished_game_to_lobby_server(
  p_room_code text,
  p_user_id uuid
)
returns table (
  room_code text,
  room_status text,
  lobby_version bigint
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_room_code text;
  v_room_status text;
  v_host_user_id uuid;
  v_game_state jsonb;
  v_state_version bigint;
begin
  v_room_code := pg_catalog.upper(pg_catalog.btrim(p_room_code));
  if p_user_id is null
    or v_room_code is null
    or pg_catalog.char_length(v_room_code) not between 6 and 10
    or v_room_code !~ '^[A-Z0-9]+$'
  then
    raise exception using errcode = '22023', message = 'Invalid return-to-lobby request';
  end if;

  select r.id, r.code, r.status, r.host_user_id
  into v_room_id, v_room_code, v_room_status, v_host_user_id
  from public.rooms as r
  where r.code = v_room_code
  for update of r;

  if v_room_id is null or not exists (
    select 1
    from public.room_players as member
    where member.room_id = v_room_id
      and member.user_id = p_user_id
  ) then
    raise exception using errcode = 'P0002', message = 'Room not found or unavailable';
  end if;

  if v_host_user_id is distinct from p_user_id then
    raise exception using errcode = 'P0003', message = 'Only the host can return the room to the lobby';
  end if;

  if v_room_status is distinct from 'active' then
    raise exception using errcode = 'P0004', message = 'Game is not finished';
  end if;

  select state.game_state, state.state_version
  into v_game_state, v_state_version
  from public.room_states as state
  where state.room_id = v_room_id
  for update of state;

  if not found
    or pg_catalog.jsonb_typeof(v_game_state) is distinct from 'object'
    or v_state_version < 1
    or v_game_state->'schemaVersion' is distinct from '10'::jsonb
    or v_game_state->>'phase' is distinct from 'gameOver'
    or pg_catalog.jsonb_typeof(v_game_state->'players') is distinct from 'array'
    or nullif(pg_catalog.btrim(v_game_state->>'winnerId'), '') is null
    or not exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_game_state->'players') as player(value)
      where player.value->>'id' = v_game_state->>'winnerId'
    )
  then
    raise exception using errcode = 'P0004', message = 'Game is not finished';
  end if;

  update public.room_players as member
  set turn_order = null,
      is_ready = false
  where member.room_id = v_room_id;

  update public.room_ai_players as ai
  set turn_order = null
  where ai.room_id = v_room_id;

  update public.room_states as state
  set game_state = null,
      state_version = 0,
      updated_at = pg_catalog.now()
  where state.room_id = v_room_id
    and state.state_version = v_state_version;

  if not found then
    raise exception using errcode = 'P0004', message = 'Game is not finished';
  end if;

  update public.rooms as room
  set status = 'lobby'
  where room.id = v_room_id
    and room.status = 'active';

  if not found then
    raise exception using errcode = 'P0004', message = 'Game is not finished';
  end if;

  return query
  select v_room_code, 'lobby'::text, signal.lobby_version
  from public.room_lobby_updates as signal
  where signal.room_id = v_room_id;
end;
$$;
