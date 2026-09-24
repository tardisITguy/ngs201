-- Mid-game human departures retain the canonical engine player and transfer
-- only its control authority to the existing balanced AI policy.

create function ngsllc_private.takeover_active_player_with_ai(
  p_room_id uuid,
  p_user_id uuid
)
returns table (
  taken_over boolean,
  player_id text,
  state_version bigint,
  was_host boolean,
  new_host_user_id uuid,
  abandoned boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room_status text;
  v_host_user_id uuid;
  v_turn_order smallint;
  v_player_id text;
  v_game_state jsonb;
  v_next_game_state jsonb;
  v_state_version bigint;
  v_new_host_user_id uuid;
  v_was_host boolean;
  v_abandoned boolean := false;
begin
  select r.status,r.host_user_id
  into v_room_status,v_host_user_id
  from public.rooms as r
  where r.id = p_room_id;

  if v_room_status is distinct from 'active' then
    return query select false,null::text,null::bigint,false,null::uuid,false;
    return;
  end if;

  select rp.turn_order
  into v_turn_order
  from public.room_players as rp
  where rp.room_id = p_room_id
    and rp.user_id = p_user_id
  for update of rp;

  if not found then
    return query select false,null::text,null::bigint,false,null::uuid,false;
    return;
  end if;

  if v_turn_order is null or v_turn_order < 0 or v_turn_order > 63 then
    raise exception using errcode = 'P0005', message = 'Game state is unavailable';
  end if;

  v_player_id := 'p'||(v_turn_order + 1)::text;

  select rs.game_state,rs.state_version
  into v_game_state,v_state_version
  from public.room_states as rs
  where rs.room_id = p_room_id
  for update of rs;

  if not found
    or v_state_version < 1
    or pg_catalog.jsonb_typeof(v_game_state) is distinct from 'object'
    or pg_catalog.jsonb_typeof(v_game_state->'players') is distinct from 'array'
    or pg_catalog.jsonb_array_length(v_game_state->'players') <= v_turn_order
    or pg_catalog.jsonb_typeof(v_game_state->'players'->v_turn_order) is distinct from 'object'
    or v_game_state->'players'->v_turn_order->>'id' is distinct from v_player_id
    or v_game_state->'players'->v_turn_order->>'control' is distinct from 'human'
  then
    raise exception using errcode = 'P0005', message = 'Game state is unavailable';
  end if;

  v_next_game_state := pg_catalog.jsonb_set(
    pg_catalog.jsonb_set(
      v_game_state,
      array['players',v_turn_order::text,'control'],
      '"ai"'::jsonb,
      false
    ),
    array['players',v_turn_order::text,'botStrategy'],
    '"balanced"'::jsonb,
    true
  );

  update public.room_states as rs
  set game_state = v_next_game_state,
      state_version = rs.state_version + 1,
      updated_at = pg_catalog.now()
  where rs.room_id = p_room_id
    and rs.state_version = v_state_version;

  if not found then
    raise exception using errcode = 'P0006', message = 'Game state changed';
  end if;

  delete from public.room_players as rp
  where rp.room_id = p_room_id
    and rp.user_id = p_user_id;

  v_was_host := v_host_user_id = p_user_id;

  select rp.user_id
  into v_new_host_user_id
  from public.room_players as rp
  where rp.room_id = p_room_id
  order by rp.joined_at asc,rp.user_id asc
  limit 1;

  if v_new_host_user_id is null then
    update public.rooms as r
    set status = 'abandoned'
    where r.id = p_room_id
      and r.status = 'active';
    v_abandoned := true;
  elsif v_was_host then
    update public.rooms as r
    set host_user_id = v_new_host_user_id
    where r.id = p_room_id
      and r.status = 'active';
  else
    v_new_host_user_id := null;
  end if;

  return query
  select true,v_player_id,v_state_version + 1,v_was_host,v_new_host_user_id,v_abandoned;
end;
$$;

revoke execute on function ngsllc_private.takeover_active_player_with_ai(uuid,uuid) from public;
revoke execute on function ngsllc_private.takeover_active_player_with_ai(uuid,uuid) from anon;
revoke execute on function ngsllc_private.takeover_active_player_with_ai(uuid,uuid) from authenticated;
revoke execute on function ngsllc_private.takeover_active_player_with_ai(uuid,uuid) from service_role;
grant usage on schema ngsllc_private to service_role;
grant execute on function ngsllc_private.takeover_active_player_with_ai(uuid,uuid) to service_role;

create or replace function public.leave_room_server(
  p_room_code text,
  p_user_id uuid
)
returns table (
  completed boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_room_code text;
  v_room_status text;
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'User is required';
  end if;

  v_room_code := pg_catalog.upper(pg_catalog.btrim(p_room_code));
  if v_room_code is null
    or pg_catalog.char_length(v_room_code) not between 6 and 10
    or v_room_code !~ '^[A-Z0-9]+$'
  then
    raise exception using errcode = '22023', message = 'Invalid room code';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text,2010003::bigint)
  );

  select r.id
  into v_room_id
  from public.rooms as r
  where r.code = v_room_code;

  if v_room_id is not null then
    select r.status
    into v_room_status
    from public.rooms as r
    where r.id = v_room_id
    for update of r;

    if v_room_status = 'lobby' then
      perform * from ngsllc_private.depart_lobby_member(v_room_id,p_user_id);
    elsif v_room_status = 'active' then
      perform * from ngsllc_private.takeover_active_player_with_ai(v_room_id,p_user_id);
    end if;
  end if;

  return query select true;
end;
$$;

revoke execute on function public.leave_room_server(text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.leave_room_server(text,uuid) to service_role;

create function public.touch_active_game_presence_server(
  p_room_code text,
  p_user_id uuid
)
returns table (
  completed boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_room_code text;
  v_room_status text;
  v_room_updated_at timestamptz;
  v_now timestamptz;
  v_stale_user_id uuid;
  v_stale_user_ids uuid[] := array[]::uuid[];
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'User is required';
  end if;

  v_room_code := pg_catalog.upper(pg_catalog.btrim(p_room_code));
  if v_room_code is null
    or pg_catalog.char_length(v_room_code) not between 6 and 10
    or v_room_code !~ '^[A-Z0-9]+$'
  then
    raise exception using errcode = '22023', message = 'Invalid room code';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text,2010003::bigint)
  );

  select r.id,r.status,r.updated_at
  into v_room_id,v_room_status,v_room_updated_at
  from public.rooms as r
  where r.code = v_room_code
  for update of r;

  if not found or not exists (
    select 1
    from public.room_players as rp
    where rp.room_id = v_room_id
      and rp.user_id = p_user_id
  ) then
    raise exception using errcode = 'P0002', message = 'Room not found or unavailable';
  end if;

  if v_room_status is distinct from 'active' then
    raise exception using errcode = 'P0004', message = 'Game is not active';
  end if;

  v_now := pg_catalog.now();

  update public.room_players as rp
  set last_seen_at = v_now
  where rp.room_id = v_room_id
    and rp.user_id = p_user_id;

  select coalesce(
    pg_catalog.array_agg(stale.user_id order by stale.joined_at,stale.user_id),
    array[]::uuid[]
  )
  into v_stale_user_ids
  from (
    select rp.user_id,rp.joined_at
    from public.room_players as rp
    where rp.room_id = v_room_id
      and rp.user_id <> p_user_id
      and rp.last_seen_at < v_now - interval '90 seconds'
      and v_room_updated_at < v_now - interval '90 seconds'
  ) as stale;

  foreach v_stale_user_id in array v_stale_user_ids loop
    perform *
    from ngsllc_private.takeover_active_player_with_ai(v_room_id,v_stale_user_id);
  end loop;

  return query select true;
end;
$$;

revoke execute on function public.touch_active_game_presence_server(text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.touch_active_game_presence_server(text,uuid) to service_role;
