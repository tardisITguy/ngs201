create function public.commit_game_action_server(
  p_room_code text,
  p_user_id uuid,
  p_expected_state_version bigint,
  p_next_game_state jsonb
)
returns table (
  room_code text,
  room_status text,
  state_version bigint,
  viewer_turn_order smallint
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_room_code text;
  v_room_status text;
  v_member_user_id uuid;
  v_viewer_turn_order smallint;
  v_viewer_player_id text;
  v_state_version bigint;
  v_game_state jsonb;
  v_current_player_index integer;
  v_player_count integer;
  v_existing_round integer;
  v_candidate_round integer;
  v_index integer;
  v_updated integer;
begin
  if p_user_id is null or p_expected_state_version is null or p_expected_state_version < 1 then
    raise exception using errcode = '22023', message = 'Invalid game action request';
  end if;

  v_room_code := pg_catalog.upper(pg_catalog.btrim(p_room_code));
  if v_room_code is null
    or pg_catalog.char_length(v_room_code) not between 6 and 10
    or v_room_code !~ '^[A-Z0-9]+$'
    or pg_catalog.jsonb_typeof(p_next_game_state) is distinct from 'object'
  then
    raise exception using errcode = '22023', message = 'Invalid game action request';
  end if;

  select r.id, r.status, rp.user_id, rp.turn_order
  into v_room_id, v_room_status, v_member_user_id, v_viewer_turn_order
  from public.rooms as r
  left join public.room_players as rp
    on rp.room_id = r.id and rp.user_id = p_user_id
  where r.code = v_room_code
  for update of r;

  if not found or v_member_user_id is null then
    raise exception using errcode = 'P0002', message = 'Room not found or unavailable';
  end if;
  if v_room_status is distinct from 'active' then
    raise exception using errcode = 'P0004', message = 'Game is not active';
  end if;
  if v_viewer_turn_order is null or v_viewer_turn_order < 0 then
    raise exception using errcode = 'P0005', message = 'Game state is unavailable';
  end if;
  v_viewer_player_id := 'p' || (v_viewer_turn_order + 1)::text;

  select rs.state_version, rs.game_state
  into v_state_version, v_game_state
  from public.room_states as rs
  where rs.room_id = v_room_id
  for update;

  if not found
    or v_state_version is null
    or v_state_version < 1
    or pg_catalog.jsonb_typeof(v_game_state) is distinct from 'object'
  then
    raise exception using errcode = 'P0005', message = 'Game state is unavailable';
  end if;
  if v_state_version is distinct from p_expected_state_version then
    raise exception using errcode = 'P0006', message = 'Game state changed';
  end if;

  if v_game_state->'schemaVersion' is distinct from '9'::jsonb
    or pg_catalog.jsonb_typeof(v_game_state->'players') is distinct from 'array'
    or pg_catalog.jsonb_typeof(v_game_state->'turnOrder') is distinct from 'array'
    or pg_catalog.jsonb_typeof(v_game_state->'board') is distinct from 'array'
    or pg_catalog.jsonb_typeof(v_game_state->'currentPlayerIndex') is distinct from 'number'
    or (v_game_state->>'currentPlayerIndex') !~ '^\d+$'
  then
    raise exception using errcode = 'P0005', message = 'Game state is unavailable';
  end if;
  v_player_count := pg_catalog.jsonb_array_length(v_game_state->'players');
  v_current_player_index := (v_game_state->>'currentPlayerIndex')::integer;
  if v_player_count not between 2 and 8
    or pg_catalog.jsonb_array_length(v_game_state->'turnOrder') <> v_player_count
    or v_viewer_turn_order >= v_player_count
    or pg_catalog.jsonb_typeof(v_game_state->'players'->(v_viewer_turn_order::integer)) is distinct from 'object'
    or v_game_state->'players'->(v_viewer_turn_order::integer)->>'id' is distinct from v_viewer_player_id
    or v_current_player_index not between 0 and v_player_count - 1
  then
    raise exception using errcode = 'P0005', message = 'Game state is unavailable';
  end if;
  if v_game_state->'turnOrder'->>v_current_player_index is distinct from v_viewer_player_id
    or (
      v_game_state ? 'pendingResolution'
      and v_game_state->'pendingResolution' is not null
      and v_game_state->'pendingResolution' <> 'null'::jsonb
      and v_game_state->'pendingResolution'->>'playerId' is distinct from v_viewer_player_id
    )
  then
    raise exception using errcode = 'P0003', message = 'Not the active player';
  end if;

  if p_next_game_state->'schemaVersion' is distinct from '9'::jsonb
    or p_next_game_state->'seed' is distinct from v_game_state->'seed'
    or p_next_game_state->'config' is distinct from v_game_state->'config'
    or p_next_game_state->'turnOrder' is distinct from v_game_state->'turnOrder'
    or p_next_game_state->'removedVillageTiles' is distinct from v_game_state->'removedVillageTiles'
    or pg_catalog.jsonb_typeof(p_next_game_state->'players') is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_next_game_state->'players') <> v_player_count
    or pg_catalog.jsonb_typeof(p_next_game_state->'board') is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_next_game_state->'board') <> 25
    or pg_catalog.jsonb_array_length(v_game_state->'board') <> 25
    or pg_catalog.jsonb_typeof(p_next_game_state->'round') is distinct from 'number'
    or (p_next_game_state->>'round') !~ '^\d+$'
    or pg_catalog.jsonb_typeof(v_game_state->'round') is distinct from 'number'
    or (v_game_state->>'round') !~ '^\d+$'
  then
    raise exception using errcode = '22023', message = 'Invalid candidate game state';
  end if;
  v_existing_round := (v_game_state->>'round')::integer;
  v_candidate_round := (p_next_game_state->>'round')::integer;
  if v_candidate_round < v_existing_round or v_candidate_round > v_existing_round + 1 then
    raise exception using errcode = '22023', message = 'Invalid candidate game state';
  end if;

  for v_index in 0..v_player_count - 1 loop
    if pg_catalog.jsonb_typeof(p_next_game_state->'players'->v_index) is distinct from 'object'
      or p_next_game_state->'players'->v_index->'id' is distinct from v_game_state->'players'->v_index->'id'
      or p_next_game_state->'players'->v_index->'name' is distinct from v_game_state->'players'->v_index->'name'
      or p_next_game_state->'players'->v_index->'color' is distinct from v_game_state->'players'->v_index->'color'
      or p_next_game_state->'players'->v_index->'templeCellId' is distinct from v_game_state->'players'->v_index->'templeCellId'
      or p_next_game_state->'players'->v_index->'control' is distinct from v_game_state->'players'->v_index->'control'
    then
      raise exception using errcode = '22023', message = 'Invalid candidate game state';
    end if;
  end loop;

  for v_index in 0..24 loop
    if pg_catalog.jsonb_typeof(p_next_game_state->'board'->v_index) is distinct from 'object'
      or p_next_game_state->'board'->v_index->'id' is distinct from v_game_state->'board'->v_index->'id'
      or p_next_game_state->'board'->v_index->'row' is distinct from v_game_state->'board'->v_index->'row'
      or p_next_game_state->'board'->v_index->'col' is distinct from v_game_state->'board'->v_index->'col'
      or p_next_game_state->'board'->v_index->'hiddenKind' is distinct from v_game_state->'board'->v_index->'hiddenKind'
      or p_next_game_state->'board'->v_index->'templeOwnerId' is distinct from v_game_state->'board'->v_index->'templeOwnerId'
    then
      raise exception using errcode = '22023', message = 'Invalid candidate game state';
    end if;
  end loop;

  update public.room_states as rs
  set game_state = p_next_game_state,
      state_version = rs.state_version + 1,
      updated_at = pg_catalog.now()
  where rs.room_id = v_room_id
    and rs.state_version = p_expected_state_version;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception using errcode = 'P0006', message = 'Game state changed';
  end if;

  return query select v_room_code, v_room_status, v_state_version + 1, v_viewer_turn_order;
end;
$$;

revoke execute on function public.commit_game_action_server(text, uuid, bigint, jsonb) from public;
revoke execute on function public.commit_game_action_server(text, uuid, bigint, jsonb) from anon;
revoke execute on function public.commit_game_action_server(text, uuid, bigint, jsonb) from authenticated;
revoke execute on function public.commit_game_action_server(text, uuid, bigint, jsonb) from service_role;
grant execute on function public.commit_game_action_server(text, uuid, bigint, jsonb) to service_role;
