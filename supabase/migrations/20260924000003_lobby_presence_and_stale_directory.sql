-- Keep public lobby discovery fresh without exposing presence authority to browsers.
-- Lobby viewers touch only their own server timestamp; the locked sweep reuses the
-- established departure primitive for deterministic removal and host succession.

create function public.touch_lobby_presence_server(
  p_room_code text,
  p_user_id uuid
)
returns table (
  room_code text,
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
  v_now timestamptz;
  v_stale_user_ids uuid[] := array[]::uuid[];
  v_stale_user_id uuid;
begin
  v_room_code := pg_catalog.upper(pg_catalog.btrim(p_room_code));
  if p_user_id is null
    or v_room_code is null
    or pg_catalog.char_length(v_room_code) not between 6 and 10
    or v_room_code !~ '^[A-Z0-9]+$'
  then
    raise exception using errcode = '22023', message = 'Invalid lobby presence request';
  end if;

  select r.id, r.code, r.status
  into v_room_id, v_room_code, v_room_status
  from public.rooms as r
  where r.code = v_room_code
  for update of r;

  if v_room_id is null or not exists (
    select 1
    from public.room_players as caller
    where caller.room_id = v_room_id
      and caller.user_id = p_user_id
  ) then
    raise exception using errcode = 'P0002', message = 'Room not found or unavailable';
  end if;

  if v_room_status is distinct from 'lobby' then
    raise exception using errcode = 'P0004', message = 'Room is no longer a lobby';
  end if;

  v_now := pg_catalog.clock_timestamp();

  update public.room_players as caller
  set last_seen_at = greatest(caller.last_seen_at, v_now)
  where caller.room_id = v_room_id
    and caller.user_id = p_user_id;

  select coalesce(
    pg_catalog.array_agg(stale.user_id order by stale.joined_at asc, stale.user_id asc),
    array[]::uuid[]
  )
  into v_stale_user_ids
  from (
    select member.user_id, member.joined_at
    from public.room_players as member
    where member.room_id = v_room_id
      and member.user_id <> p_user_id
      and member.last_seen_at < v_now - interval '90 seconds'
  ) as stale;

  foreach v_stale_user_id in array v_stale_user_ids loop
    perform *
    from ngsllc_private.depart_lobby_member(v_room_id, v_stale_user_id);
  end loop;

  return query select v_room_code, true;
end;
$$;

revoke execute on function public.touch_lobby_presence_server(text,uuid)
from public, anon, authenticated, service_role;

grant execute on function public.touch_lobby_presence_server(text,uuid)
to service_role;

create or replace function public.list_joinable_rooms_server(
  p_game_slug text,
  p_user_id uuid
)
returns table (
  room_code text,
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
