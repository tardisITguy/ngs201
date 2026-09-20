alter table public.games add column min_players smallint;

update public.games set min_players = 1 where min_players is null;
update public.games set min_players = 2 where slug = 'worship-me';

alter table public.games alter column min_players set not null;
alter table public.games add constraint games_min_players_range check (min_players between 1 and 64);
alter table public.games add constraint games_player_limits_order check (min_players <= max_players);

create function public.start_game_server(
  p_room_code text,
  p_user_id uuid,
  p_expected_players jsonb,
  p_game_state jsonb
)
returns table (
  room_id uuid,
  room_code text,
  room_status text,
  state_version bigint
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_room_code text;
  v_game_id uuid;
  v_host_user_id uuid;
  v_room_status text;
  v_game_status text;
  v_min_players smallint;
  v_max_players smallint;
  v_player_count integer;
  v_roster jsonb;
  v_existing_state jsonb;
  v_state_version bigint;
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'User is required';
  end if;

  v_room_code := pg_catalog.upper(pg_catalog.btrim(p_room_code));
  if v_room_code is null
    or pg_catalog.char_length(v_room_code) not between 6 and 10
    or v_room_code !~ '^[A-Z0-9]+$'
    or p_expected_players is null
    or pg_catalog.jsonb_typeof(p_expected_players) <> 'array'
    or p_game_state is null
    or pg_catalog.jsonb_typeof(p_game_state) <> 'object'
  then
    raise exception using errcode = '22023', message = 'Invalid Start request';
  end if;

  select r.id, r.code, r.game_id, r.host_user_id, r.status
  into v_room_id, v_room_code, v_game_id, v_host_user_id, v_room_status
  from public.rooms as r
  where r.code = v_room_code
  for update of r;

  if v_room_id is null then
    raise exception using errcode = 'P0002', message = 'Room not found or unavailable';
  end if;
  if not exists (
    select 1 from public.room_players as member
    where member.room_id = v_room_id and member.user_id = p_user_id
  ) then
    raise exception using errcode = 'P0002', message = 'Room not found or unavailable';
  end if;
  if v_host_user_id <> p_user_id then
    raise exception using errcode = 'P0003', message = 'Only the host can start the game';
  end if;
  if v_room_status <> 'lobby' then
    raise exception using errcode = 'P0005', message = 'Game has already started';
  end if;

  select g.status, g.min_players, g.max_players
  into v_game_status, v_min_players, v_max_players
  from public.games as g
  where g.id = v_game_id;
  if v_game_status is distinct from 'active' then
    raise exception using errcode = 'P0004', message = 'Lobby is not ready';
  end if;

  select pg_catalog.count(*)::integer,
         pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'userId', rp.user_id::text,
             'displayName', rp.display_name,
             'playerColor', rp.player_color
           ) order by rp.joined_at, rp.user_id
         )
  into v_player_count, v_roster
  from public.room_players as rp
  where rp.room_id = v_room_id;

  if v_player_count < v_min_players or v_player_count > v_max_players then
    raise exception using errcode = 'P0004', message = 'Lobby is not ready';
  end if;
  if exists (
    select 1 from public.room_players as rp
    where rp.room_id = v_room_id and (not rp.is_ready or rp.player_color is null)
  ) or exists (
    select 1
    from public.room_players as rp
    where rp.room_id = v_room_id
      and not exists (
        select 1 from public.game_player_colors as supported
        where supported.game_id = v_game_id and supported.color = rp.player_color
      )
  ) or (
    select pg_catalog.count(distinct rp.player_color)
    from public.room_players as rp where rp.room_id = v_room_id
  ) <> v_player_count then
    raise exception using errcode = 'P0004', message = 'Lobby is not ready';
  end if;
  if exists (
    select 1 from public.room_players as rp
    where rp.room_id = v_room_id and rp.turn_order is not null
  ) then
    raise exception using errcode = 'P0005', message = 'Game has already started';
  end if;
  if v_roster is distinct from p_expected_players then
    raise exception using errcode = 'P0006', message = 'Lobby roster changed';
  end if;

  select rs.game_state, rs.state_version
  into v_existing_state, v_state_version
  from public.room_states as rs
  where rs.room_id = v_room_id
  for update of rs;
  if not found then
    raise exception using errcode = 'P0004', message = 'Lobby is not ready';
  end if;
  if v_existing_state is not null or v_state_version <> 0 then
    raise exception using errcode = 'P0005', message = 'Game has already started';
  end if;

  if p_game_state->'schemaVersion' is distinct from '9'::jsonb
    or pg_catalog.jsonb_typeof(p_game_state->'players') is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_game_state->'players') <> v_player_count
    or pg_catalog.jsonb_typeof(p_game_state->'turnOrder') is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_game_state->'turnOrder') <> v_player_count
    or p_game_state->>'phase' is distinct from 'placement'
    or p_game_state->'round' is distinct from '1'::jsonb
    or (
      case
        when pg_catalog.jsonb_typeof(p_game_state->'currentPlayerIndex') = 'number'
        then (p_game_state->>'currentPlayerIndex')::integer not between 0 and v_player_count - 1
        else true
      end
    )
    or nullif(pg_catalog.btrim(p_game_state->>'seed'), '') is null
    or exists (
      select 1
      from pg_catalog.generate_series(0, v_player_count - 1) as ordinal(index)
      where pg_catalog.jsonb_typeof(p_game_state->'players'->index) is distinct from 'object'
        or pg_catalog.jsonb_typeof(p_expected_players->index) is distinct from 'object'
        or p_game_state->'players'->index->>'id' is distinct from 'p' || (index + 1)::text
        or p_game_state->'players'->index->>'name' is distinct from p_expected_players->index->>'displayName'
        or p_game_state->'players'->index->>'color' is distinct from p_expected_players->index->>'playerColor'
        or p_game_state->'players'->index->>'control' is distinct from 'human'
        or p_game_state->'turnOrder'->>index is distinct from 'p' || (index + 1)::text
    )
  then
    raise exception using errcode = '22023', message = 'Invalid candidate game state';
  end if;

  with ordered as (
    select rp.user_id,
           (pg_catalog.row_number() over (order by rp.joined_at, rp.user_id) - 1)::smallint as position
    from public.room_players as rp
    where rp.room_id = v_room_id
  )
  update public.room_players as rp
  set turn_order = ordered.position
  from ordered
  where rp.room_id = v_room_id and rp.user_id = ordered.user_id;

  update public.room_states as rs
  set game_state = p_game_state, state_version = 1
  where rs.room_id = v_room_id and rs.game_state is null and rs.state_version = 0;

  update public.rooms as r
  set status = 'active'
  where r.id = v_room_id and r.status = 'lobby';

  return query select v_room_id, v_room_code, 'active'::text, 1::bigint;
end;
$$;

revoke execute on function public.start_game_server(text, uuid, jsonb, jsonb) from public;
revoke execute on function public.start_game_server(text, uuid, jsonb, jsonb) from anon;
revoke execute on function public.start_game_server(text, uuid, jsonb, jsonb) from authenticated;
revoke execute on function public.start_game_server(text, uuid, jsonb, jsonb) from service_role;
grant execute on function public.start_game_server(text, uuid, jsonb, jsonb) to service_role;
