-- Public lobby discovery and host moderation. Applied migrations remain immutable;
-- this migration extends the trusted command boundary forward-only.

alter table public.rooms
add column join_mode text not null default 'public';

alter table public.rooms
add constraint rooms_join_mode check (join_mode in ('public', 'code'));

create table public.room_kicks (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kicked_at timestamptz not null default pg_catalog.now(),
  primary key (room_id, user_id)
);

alter table public.room_kicks enable row level security;

revoke all on table public.room_kicks from public, anon, authenticated, service_role;
grant select on table public.room_kicks to authenticated;
grant select, insert, delete on table public.room_kicks to service_role;

create policy room_kicks_authenticated_read_own
on public.room_kicks
for select
to authenticated
using (user_id = (select auth.uid()));

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
      or new.join_mode is distinct from old.join_mode;
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

revoke all on function ngsllc_private.bump_room_lobby_update() from public, anon, authenticated, service_role;

drop trigger rooms_bump_lobby_update on public.rooms;
create trigger rooms_bump_lobby_update
after update of host_user_id, status, join_mode on public.rooms
for each row execute function ngsllc_private.bump_room_lobby_update();

create function ngsllc_private.join_lobby_member(
  p_room_code text,
  p_user_id uuid,
  p_display_name text,
  p_require_public boolean
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
  v_join_mode text;
  v_display_name text;
  v_max_players smallint;
  v_player_count bigint;
  v_ai_count bigint;
  v_lock_room_id uuid;
  v_is_target_member boolean;
  v_old_lobby_ids uuid[] := array[]::uuid[];
  v_lock_room_ids uuid[] := array[]::uuid[];
begin
  if p_user_id is null or p_require_public is null then
    raise exception using errcode = '22023', message = 'Invalid room request';
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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 2010003::bigint)
  );

  select coalesce(
    pg_catalog.array_agg(existing.existing_room_id order by existing.existing_room_id),
    array[]::uuid[]
  )
  into v_old_lobby_ids
  from (
    select distinct r.id as existing_room_id
    from public.rooms as r
    join public.room_players as rp on rp.room_id = r.id
    where rp.user_id = p_user_id
      and r.status = 'lobby'
  ) as existing;

  select r.id
  into v_room_id
  from public.rooms as r
  where r.code = v_room_code;

  select coalesce(
    pg_catalog.array_agg(affected.affected_room_id order by affected.affected_room_id),
    array[]::uuid[]
  )
  into v_lock_room_ids
  from (
    select old_rooms.old_room_id as affected_room_id
    from pg_catalog.unnest(v_old_lobby_ids) as old_rooms(old_room_id)
    union
    select v_room_id
    where v_room_id is not null
  ) as affected;

  foreach v_lock_room_id in array v_lock_room_ids loop
    perform 1
    from public.rooms as r
    where r.id = v_lock_room_id
    for update;
  end loop;

  select r.id, r.code, r.game_id, r.status, r.join_mode, g.max_players
  into v_room_id, v_room_code, v_game_id, v_status, v_join_mode, v_max_players
  from public.rooms as r
  join public.games as g on g.id = r.game_id and g.status = 'active'
  where r.id = v_room_id;

  if v_room_id is null or v_status is distinct from 'lobby' then
    raise exception using errcode = 'P0002', message = 'Room not found or unavailable';
  end if;

  if p_require_public and v_join_mode is distinct from 'public' then
    raise exception using errcode = 'P0004', message = 'Public room is unavailable';
  end if;

  if exists (
    select 1
    from public.room_kicks as rk
    where rk.room_id = v_room_id
      and rk.user_id = p_user_id
  ) then
    raise exception using errcode = 'P0007', message = 'User was removed from room';
  end if;

  select exists (
    select 1
    from public.room_players as rp
    where rp.room_id = v_room_id
      and rp.user_id = p_user_id
  )
  into v_is_target_member;

  if not v_is_target_member then
    select pg_catalog.count(*)
    into v_player_count
    from public.room_players as rp
    where rp.room_id = v_room_id;

    select pg_catalog.count(*)
    into v_ai_count
    from public.room_ai_players as ai
    where ai.room_id = v_room_id;

    if v_player_count + v_ai_count >= v_max_players then
      raise exception using errcode = 'P0003', message = 'Room is full';
    end if;
  end if;

  foreach v_lock_room_id in array v_old_lobby_ids loop
    if v_lock_room_id <> v_room_id then
      perform * from ngsllc_private.depart_lobby_member(v_lock_room_id, p_user_id);
    end if;
  end loop;

  if v_is_target_member then
    update public.room_players as rp
    set display_name = v_display_name,
        last_seen_at = pg_catalog.now()
    where rp.room_id = v_room_id
      and rp.user_id = p_user_id;
  else
    insert into public.room_players (
      room_id, user_id, display_name, player_color, turn_order, is_ready
    ) values (
      v_room_id, p_user_id, v_display_name, null, null, false
    );
  end if;

  return query
  select v_room_id, v_room_code, v_game_id, v_status, not v_is_target_member;
end;
$$;

revoke all on function ngsllc_private.join_lobby_member(text,uuid,text,boolean) from public, anon, authenticated, service_role;
grant execute on function ngsllc_private.join_lobby_member(text,uuid,text,boolean) to service_role;

create or replace function public.join_room_server(
  p_room_code text,
  p_user_id uuid,
  p_display_name text
)
returns table (room_id uuid, room_code text, game_id uuid, status text, joined_new boolean)
language sql
security invoker
set search_path = ''
as $$
  select result.room_id, result.room_code, result.game_id, result.status, result.joined_new
  from ngsllc_private.join_lobby_member(
    p_room_code,
    p_user_id,
    p_display_name,
    false
  ) as result;
$$;

create function public.join_public_room_server(
  p_room_code text,
  p_user_id uuid,
  p_display_name text
)
returns table (room_id uuid, room_code text, game_id uuid, status text, joined_new boolean)
language sql
security invoker
set search_path = ''
as $$
  select result.room_id, result.room_code, result.game_id, result.status, result.joined_new
  from ngsllc_private.join_lobby_member(
    p_room_code,
    p_user_id,
    p_display_name,
    true
  ) as result;
$$;

create function public.list_joinable_rooms_server(
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

create function public.set_room_join_mode_server(
  p_room_code text,
  p_user_id uuid,
  p_join_mode text
)
returns table (room_code text, join_mode text, changed boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_room_code text;
  v_room_status text;
  v_host_user_id uuid;
  v_join_mode text;
  v_requested_join_mode text;
begin
  v_room_code := pg_catalog.upper(pg_catalog.btrim(p_room_code));
  v_requested_join_mode := pg_catalog.btrim(p_join_mode);
  if p_user_id is null
    or v_room_code is null
    or pg_catalog.char_length(v_room_code) not between 6 and 10
    or v_room_code !~ '^[A-Z0-9]+$'
    or v_requested_join_mode is null
    or v_requested_join_mode <> p_join_mode
    or v_requested_join_mode not in ('public', 'code')
  then
    raise exception using errcode = '22023', message = 'Invalid lobby management request';
  end if;

  select r.id, r.code, r.status, r.host_user_id, r.join_mode
  into v_room_id, v_room_code, v_room_status, v_host_user_id, v_join_mode
  from public.rooms as r
  join public.games as g on g.id = r.game_id and g.status = 'active' and g.slug = 'worship-me'
  where r.code = v_room_code
  for update of r;

  if v_room_id is null or not exists (
    select 1 from public.room_players as rp
    where rp.room_id = v_room_id and rp.user_id = p_user_id
  ) then
    raise exception using errcode = 'P0002', message = 'Room not found or unavailable';
  end if;
  if v_host_user_id <> p_user_id then
    raise exception using errcode = 'P0003', message = 'Only the host can manage the lobby';
  end if;
  if v_room_status is distinct from 'lobby' then
    raise exception using errcode = 'P0004', message = 'Lobby is unavailable';
  end if;
  if v_join_mode = v_requested_join_mode then
    return query select v_room_code, v_join_mode, false;
    return;
  end if;

  update public.rooms as r
  set join_mode = v_requested_join_mode
  where r.id = v_room_id;

  return query select v_room_code, v_requested_join_mode, true;
end;
$$;

create function public.kick_room_player_server(
  p_room_code text,
  p_user_id uuid,
  p_target_user_id uuid
)
returns table (room_code text, kicked boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_room_code text;
  v_room_status text;
  v_host_user_id uuid;
begin
  v_room_code := pg_catalog.upper(pg_catalog.btrim(p_room_code));
  if p_user_id is null
    or p_target_user_id is null
    or v_room_code is null
    or pg_catalog.char_length(v_room_code) not between 6 and 10
    or v_room_code !~ '^[A-Z0-9]+$'
  then
    raise exception using errcode = '22023', message = 'Invalid lobby management request';
  end if;

  select r.id, r.code, r.status, r.host_user_id
  into v_room_id, v_room_code, v_room_status, v_host_user_id
  from public.rooms as r
  join public.games as g on g.id = r.game_id and g.status = 'active' and g.slug = 'worship-me'
  where r.code = v_room_code
  for update of r;

  if v_room_id is null or not exists (
    select 1 from public.room_players as requester
    where requester.room_id = v_room_id and requester.user_id = p_user_id
  ) then
    raise exception using errcode = 'P0002', message = 'Room not found or unavailable';
  end if;
  if v_host_user_id <> p_user_id then
    raise exception using errcode = 'P0003', message = 'Only the host can manage the lobby';
  end if;
  if p_target_user_id = p_user_id then
    raise exception using errcode = 'P0003', message = 'Host cannot kick themselves';
  end if;
  if v_room_status is distinct from 'lobby' then
    raise exception using errcode = 'P0004', message = 'Lobby is unavailable';
  end if;
  if not exists (
    select 1 from public.room_players as target
    where target.room_id = v_room_id and target.user_id = p_target_user_id
  ) then
    raise exception using errcode = 'P0002', message = 'Player not found or unavailable';
  end if;

  insert into public.room_kicks (room_id, user_id)
  values (v_room_id, p_target_user_id)
  on conflict (room_id, user_id) do nothing;

  delete from public.room_players as target
  where target.room_id = v_room_id
    and target.user_id = p_target_user_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'Player not found or unavailable';
  end if;

  return query select v_room_code, true;
end;
$$;

revoke execute on function public.join_room_server(text,uuid,text) from public, anon, authenticated, service_role;
grant execute on function public.join_room_server(text,uuid,text) to service_role;

revoke execute on function public.join_public_room_server(text,uuid,text) from public, anon, authenticated, service_role;
grant execute on function public.join_public_room_server(text,uuid,text) to service_role;

revoke execute on function public.list_joinable_rooms_server(text,uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_joinable_rooms_server(text,uuid) to service_role;

revoke execute on function public.set_room_join_mode_server(text,uuid,text) from public, anon, authenticated, service_role;
grant execute on function public.set_room_join_mode_server(text,uuid,text) to service_role;

revoke execute on function public.kick_room_player_server(text,uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.kick_room_player_server(text,uuid,uuid) to service_role;

alter publication supabase_realtime add table public.room_kicks;
