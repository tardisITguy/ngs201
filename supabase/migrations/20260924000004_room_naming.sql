-- Optional cosmetic room names remain subordinate to the authoritative room code.
-- Only the current human host may change a name, and only while the room is a lobby.

alter table public.rooms
add column room_name text default null,
add constraint rooms_room_name_valid check (
  room_name is null
  or (
    room_name = pg_catalog.btrim(room_name)
    and pg_catalog.char_length(room_name) between 1 and 50
    and room_name !~ '[[:cntrl:]]'
  )
);

create function public.set_room_name_server(
  p_room_code text,
  p_user_id uuid,
  p_room_name text
)
returns table (
  room_code text,
  room_name text,
  changed boolean
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
  v_current_room_name text;
  v_requested_room_name text;
begin
  v_room_code := pg_catalog.upper(pg_catalog.btrim(p_room_code));
  if p_user_id is null
    or v_room_code is null
    or pg_catalog.char_length(v_room_code) not between 6 and 10
    or v_room_code !~ '^[A-Z0-9]+$'
  then
    raise exception using errcode = '22023', message = 'Invalid lobby management request';
  end if;

  if p_room_name is null then
    v_requested_room_name := null;
  else
    v_requested_room_name := pg_catalog.btrim(p_room_name);
    if pg_catalog.char_length(v_requested_room_name) not between 1 and 50
      or p_room_name ~ '[[:cntrl:]]'
    then
      raise exception using errcode = '22023', message = 'Invalid room name';
    end if;
  end if;

  select r.id, r.code, r.status, r.host_user_id, r.room_name
  into v_room_id, v_room_code, v_room_status, v_host_user_id, v_current_room_name
  from public.rooms as r
  join public.games as g
    on g.id = r.game_id
   and g.status = 'active'
   and g.slug = 'worship-me'
  where r.code = v_room_code
  for update of r;

  if v_room_id is null or not exists (
    select 1
    from public.room_players as requester
    where requester.room_id = v_room_id
      and requester.user_id = p_user_id
  ) then
    raise exception using errcode = 'P0002', message = 'Room not found or unavailable';
  end if;
  if v_host_user_id <> p_user_id then
    raise exception using errcode = 'P0003', message = 'Only the host can manage the lobby';
  end if;
  if v_room_status is distinct from 'lobby' then
    raise exception using errcode = 'P0004', message = 'Lobby is unavailable';
  end if;

  if v_current_room_name is not distinct from v_requested_room_name then
    return query select v_room_code, v_current_room_name, false;
    return;
  end if;

  update public.rooms as r
  set room_name = v_requested_room_name
  where r.id = v_room_id;

  return query select v_room_code, v_requested_room_name, true;
end;
$$;

revoke execute on function public.set_room_name_server(text,uuid,text)
from public, anon, authenticated, service_role;

grant execute on function public.set_room_name_server(text,uuid,text)
to service_role;

create or replace function ngsllc_private.bump_room_lobby_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_meaningful boolean := true;
begin
  if tg_table_name = 'room_players' then
    if tg_op = 'DELETE' then
      v_room_id := old.room_id;
    else
      v_room_id := new.room_id;
      if tg_op = 'UPDATE' then
        v_meaningful := new.display_name is distinct from old.display_name
          or new.player_color is distinct from old.player_color
          or new.is_ready is distinct from old.is_ready;
      end if;
    end if;
  elsif tg_table_name = 'room_ai_players' then
    if tg_op = 'DELETE' then
      v_room_id := old.room_id;
    else
      v_room_id := new.room_id;
      if tg_op = 'UPDATE' then
        v_meaningful := new.player_color is distinct from old.player_color
          or new.bot_strategy is distinct from old.bot_strategy;
      end if;
    end if;
  elsif tg_table_name = 'rooms' then
    v_room_id := new.id;
    v_meaningful := new.host_user_id is distinct from old.host_user_id
      or new.status is distinct from old.status
      or new.join_mode is distinct from old.join_mode
      or new.room_name is distinct from old.room_name;
  end if;

  if v_meaningful then
    update public.room_lobby_updates as signal
    set lobby_version = signal.lobby_version + 1,
        updated_at = pg_catalog.now()
    where signal.room_id = v_room_id;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function ngsllc_private.bump_room_lobby_update()
from public, anon, authenticated, service_role;

drop trigger rooms_bump_lobby_update on public.rooms;

create trigger rooms_bump_lobby_update
after update of host_user_id, status, join_mode, room_name on public.rooms
for each row execute function ngsllc_private.bump_room_lobby_update();

-- The expanded table return type requires a drop/recreate. This migration is one
-- transaction, uses no CASCADE, and immediately restores the service-only API.
drop function public.list_joinable_rooms_server(text,uuid);

create function public.list_joinable_rooms_server(
  p_game_slug text,
  p_user_id uuid
)
returns table (
  room_code text,
  room_name text,
  host_display_name text,
  human_players bigint,
  ai_players bigint,
  total_players bigint,
  max_players smallint,
  created_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_game_slug text;
begin
  v_game_slug := pg_catalog.btrim(p_game_slug);
  if p_user_id is null
    or v_game_slug is null
    or v_game_slug <> 'worship-me'
    or pg_catalog.char_length(v_game_slug) not between 2 and 64
    or v_game_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  then
    raise exception using errcode = '22023', message = 'Invalid room directory request';
  end if;

  return query
  select r.code,
         r.room_name,
         host_player.display_name,
         counts.human_count,
         counts.ai_count,
         counts.human_count + counts.ai_count,
         g.max_players,
         r.created_at
  from public.rooms as r
  join public.games as g
    on g.id = r.game_id
   and g.slug = v_game_slug
   and g.status = 'active'
  join public.room_players as host_player
    on host_player.room_id = r.id
   and host_player.user_id = r.host_user_id
  cross join lateral (
    select
      (select pg_catalog.count(*) from public.room_players as rp where rp.room_id = r.id) as human_count,
      (select pg_catalog.count(*) from public.room_ai_players as ai where ai.room_id = r.id) as ai_count
  ) as counts
  where r.status = 'lobby'
    and r.join_mode = 'public'
    and host_player.last_seen_at >= pg_catalog.now() - interval '90 seconds'
    and counts.human_count + counts.ai_count < g.max_players
    and not exists (
      select 1
      from public.room_kicks as rk
      where rk.room_id = r.id
        and rk.user_id = p_user_id
    )
  order by r.created_at desc, r.code asc;
end;
$$;

revoke execute on function public.list_joinable_rooms_server(text,uuid)
from public, anon, authenticated, service_role;

grant execute on function public.list_joinable_rooms_server(text,uuid)
to service_role;
