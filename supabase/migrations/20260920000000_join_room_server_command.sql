alter table public.games
  add column max_players smallint;

alter table public.games
  add constraint games_max_players_range
  check (max_players between 2 and 64);

update public.games
set max_players = 8
where slug = 'worship-me';

alter table public.games
  alter column max_players set not null;

create function public.join_room_server(
  p_room_code text,
  p_user_id uuid,
  p_display_name text
)
returns table (
  room_id uuid,
  room_code text,
  game_id uuid,
  status text,
  joined_new boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_room_code text;
  v_game_id uuid;
  v_status text;
  v_display_name text;
  v_max_players smallint;
  v_player_count bigint;
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'User is required';
  end if;

  v_display_name := pg_catalog.btrim(p_display_name);
  if v_display_name is null or pg_catalog.char_length(v_display_name) not between 1 and 50 then
    raise exception using errcode = '22023', message = 'Invalid display name';
  end if;

  v_room_code := pg_catalog.upper(pg_catalog.btrim(p_room_code));
  if v_room_code is null
    or pg_catalog.char_length(v_room_code) not between 6 and 10
    or v_room_code !~ '^[A-Z0-9]+$'
  then
    raise exception using errcode = '22023', message = 'Invalid room code';
  end if;

  select r.id, r.code, r.game_id, r.status, g.max_players
  into v_room_id, v_room_code, v_game_id, v_status, v_max_players
  from public.rooms as r
  join public.games as g on g.id = r.game_id and g.status = 'active'
  where r.code = v_room_code
  for update of r;

  if v_room_id is null or v_status <> 'lobby' then
    raise exception using errcode = 'P0002', message = 'Room not found or unavailable';
  end if;

  update public.room_players
  set display_name = v_display_name,
      last_seen_at = pg_catalog.now()
  where room_players.room_id = v_room_id
    and room_players.user_id = p_user_id;

  if found then
    return query select v_room_id, v_room_code, v_game_id, v_status, false;
    return;
  end if;

  select pg_catalog.count(*)
  into v_player_count
  from public.room_players as rp
  where rp.room_id = v_room_id;

  if v_player_count >= v_max_players then
    raise exception using errcode = 'P0003', message = 'Room is full';
  end if;

  insert into public.room_players (
    room_id,
    user_id,
    display_name,
    player_color,
    turn_order,
    is_ready
  ) values (
    v_room_id,
    p_user_id,
    v_display_name,
    null,
    null,
    false
  );

  return query select v_room_id, v_room_code, v_game_id, v_status, true;
end;
$$;

revoke execute on function public.join_room_server(text, uuid, text) from public;
revoke execute on function public.join_room_server(text, uuid, text) from anon;
revoke execute on function public.join_room_server(text, uuid, text) from authenticated;
revoke execute on function public.join_room_server(text, uuid, text) from service_role;
grant execute on function public.join_room_server(text, uuid, text) to service_role;
