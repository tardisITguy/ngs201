create function public.get_active_game_state_server(
  p_room_code text,
  p_user_id uuid
)
returns table (
  room_code text,
  room_status text,
  state_version bigint,
  viewer_turn_order smallint,
  game_state jsonb
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room_code text;
  v_room_status text;
  v_state_version bigint;
  v_viewer_turn_order smallint;
  v_game_state jsonb;
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'User is required';
  end if;

  v_room_code := pg_catalog.upper(pg_catalog.btrim(p_room_code));
  if v_room_code is null
    or pg_catalog.char_length(v_room_code) not between 6 and 10
    or v_room_code !~ '^[A-Z0-9]+$'
  then
    raise exception using errcode = '22023', message = 'Invalid game-state request';
  end if;

  select r.status, rp.turn_order, rs.state_version, rs.game_state
  into v_room_status, v_viewer_turn_order, v_state_version, v_game_state
  from public.rooms as r
  join public.room_players as rp
    on rp.room_id = r.id and rp.user_id = p_user_id
  left join public.room_states as rs on rs.room_id = r.id
  where r.code = v_room_code;

  if not found then
    raise exception using errcode = 'P0002', message = 'Room not found or unavailable';
  end if;
  if v_room_status is distinct from 'active' then
    raise exception using errcode = 'P0004', message = 'Game is not active';
  end if;
  if v_viewer_turn_order is null
    or v_game_state is null
    or pg_catalog.jsonb_typeof(v_game_state) is distinct from 'object'
    or v_state_version is null
    or v_state_version < 1
  then
    raise exception using errcode = 'P0005', message = 'Game state is unavailable';
  end if;

  return query select v_room_code, v_room_status, v_state_version, v_viewer_turn_order, v_game_state;
end;
$$;

revoke execute on function public.get_active_game_state_server(text, uuid) from public;
revoke execute on function public.get_active_game_state_server(text, uuid) from anon;
revoke execute on function public.get_active_game_state_server(text, uuid) from authenticated;
revoke execute on function public.get_active_game_state_server(text, uuid) from service_role;
grant execute on function public.get_active_game_state_server(text, uuid) to service_role;
