create function public.set_player_ready_server(
  p_room_code text,
  p_user_id uuid,
  p_is_ready boolean
)
returns table (
  room_id uuid,
  room_code text,
  is_ready boolean,
  changed boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_room_code text;
  v_game_id uuid;
  v_room_status text;
  v_current_ready boolean;
  v_player_color text;
  v_member_found boolean;
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'User is required';
  end if;

  if p_is_ready is null then
    raise exception using errcode = '22023', message = 'Ready value is required';
  end if;

  v_room_code := pg_catalog.upper(pg_catalog.btrim(p_room_code));
  if v_room_code is null
    or pg_catalog.char_length(v_room_code) not between 6 and 10
    or v_room_code !~ '^[A-Z0-9]+$'
  then
    raise exception using errcode = '22023', message = 'Invalid room code';
  end if;

  select r.id, r.code, r.game_id, r.status
  into v_room_id, v_room_code, v_game_id, v_room_status
  from public.rooms as r
  join public.games as g on g.id = r.game_id and g.status = 'active'
  where r.code = v_room_code
  for update of r;

  if v_room_id is null or v_room_status <> 'lobby' then
    raise exception using errcode = 'P0002', message = 'Room not found or unavailable';
  end if;

  select rp.is_ready, rp.player_color
  into v_current_ready, v_player_color
  from public.room_players as rp
  where rp.room_id = v_room_id
    and rp.user_id = p_user_id;
  v_member_found := found;

  if not v_member_found then
    raise exception using errcode = 'P0002', message = 'Room not found or unavailable';
  end if;

  if p_is_ready and (
    v_player_color is null
    or not exists (
      select 1
      from public.game_player_colors as supported
      where supported.game_id = v_game_id
        and supported.color = v_player_color
    )
  ) then
    raise exception using errcode = 'P0004', message = 'Valid player color required';
  end if;

  if v_current_ready = p_is_ready then
    return query select v_room_id, v_room_code, v_current_ready, false;
    return;
  end if;

  update public.room_players as rp
  set is_ready = p_is_ready
  where rp.room_id = v_room_id
    and rp.user_id = p_user_id;

  return query select v_room_id, v_room_code, p_is_ready, true;
end;
$$;

revoke execute on function public.set_player_ready_server(text, uuid, boolean) from public;
revoke execute on function public.set_player_ready_server(text, uuid, boolean) from anon;
revoke execute on function public.set_player_ready_server(text, uuid, boolean) from authenticated;
revoke execute on function public.set_player_ready_server(text, uuid, boolean) from service_role;
grant execute on function public.set_player_ready_server(text, uuid, boolean) to service_role;
