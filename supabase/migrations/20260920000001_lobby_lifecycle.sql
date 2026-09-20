-- Serialize all lobby lifecycle commands for one authenticated user. Room rows
-- are then locked by ascending UUID so cross-room moves use a stable order.

create function ngsllc_private.depart_lobby_member(
  p_room_id uuid,
  p_user_id uuid
)
returns table (
  departed boolean,
  was_host boolean,
  new_host_user_id uuid,
  abandoned boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_host_user_id uuid;
  v_new_host_user_id uuid;
begin
  select r.host_user_id
  into v_host_user_id
  from public.rooms as r
  where r.id = p_room_id
    and r.status = 'lobby';

  if v_host_user_id is null or not exists (
    select 1
    from public.room_players as rp
    where rp.room_id = p_room_id
      and rp.user_id = p_user_id
  ) then
    return query select false, false, null::uuid, false;
    return;
  end if;

  delete from public.room_players as rp
  where rp.room_id = p_room_id
    and rp.user_id = p_user_id;

  if v_host_user_id <> p_user_id then
    return query select true, false, null::uuid, false;
    return;
  end if;

  select rp.user_id
  into v_new_host_user_id
  from public.room_players as rp
  where rp.room_id = p_room_id
  order by rp.joined_at asc, rp.user_id asc
  limit 1;

  if v_new_host_user_id is null then
    update public.rooms as r
    set status = 'abandoned'
    where r.id = p_room_id
      and r.status = 'lobby';
    return query select true, true, null::uuid, true;
    return;
  end if;

  update public.rooms as r
  set host_user_id = v_new_host_user_id
  where r.id = p_room_id
    and r.status = 'lobby';

  return query select true, true, v_new_host_user_id, false;
end;
$$;

revoke execute on function ngsllc_private.depart_lobby_member(uuid, uuid) from public;
revoke execute on function ngsllc_private.depart_lobby_member(uuid, uuid) from anon;
revoke execute on function ngsllc_private.depart_lobby_member(uuid, uuid) from authenticated;
revoke execute on function ngsllc_private.depart_lobby_member(uuid, uuid) from service_role;
grant usage on schema ngsllc_private to service_role;
grant execute on function ngsllc_private.depart_lobby_member(uuid, uuid) to service_role;

create or replace function public.create_room_server(
  p_game_slug text,
  p_host_user_id uuid,
  p_display_name text
)
returns table (
  room_id uuid,
  room_code text,
  game_id uuid,
  status text,
  state_version bigint
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_game_id uuid;
  v_room_id uuid;
  v_room_code text;
  v_display_name text;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_random_bytes bytea;
  v_attempt smallint;
  v_lock_room_id uuid;
  v_old_lobby_ids uuid[] := array[]::uuid[];
begin
  if p_host_user_id is null then
    raise exception using errcode = '22023', message = 'Host user is required';
  end if;

  v_display_name := pg_catalog.btrim(p_display_name);
  if v_display_name is null or pg_catalog.char_length(v_display_name) not between 1 and 50 then
    raise exception using errcode = '22023', message = 'Display name must be between 1 and 50 characters';
  end if;

  if p_game_slug is null
    or p_game_slug <> pg_catalog.btrim(p_game_slug)
    or pg_catalog.char_length(p_game_slug) not between 2 and 64
    or p_game_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  then
    raise exception using errcode = '22023', message = 'Invalid game slug';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_host_user_id::text, 2010003::bigint)
  );

  select coalesce(
    pg_catalog.array_agg(existing.room_id order by existing.room_id),
    array[]::uuid[]
  )
  into v_old_lobby_ids
  from (
    select distinct r.id as room_id
    from public.rooms as r
    join public.room_players as rp on rp.room_id = r.id
    where rp.user_id = p_host_user_id
      and r.status = 'lobby'
  ) as existing;

  select g.id
  into v_game_id
  from public.games as g
  where g.slug = p_game_slug
    and g.status = 'active';

  if v_game_id is null then
    raise exception using errcode = '22023', message = 'Active game not found';
  end if;

  foreach v_lock_room_id in array v_old_lobby_ids loop
    perform 1 from public.rooms as r where r.id = v_lock_room_id for update;
  end loop;

  foreach v_lock_room_id in array v_old_lobby_ids loop
    perform * from ngsllc_private.depart_lobby_member(v_lock_room_id, p_host_user_id);
  end loop;

  for v_attempt in 1..10 loop
    v_random_bytes := pg_catalog.uuid_send(pg_catalog.gen_random_uuid());
    select pg_catalog.string_agg(
      pg_catalog.substr(v_alphabet,(pg_catalog.get_byte(v_random_bytes, byte_index) % 32) + 1,1),
      '' order by byte_index
    )
    into v_room_code
    from pg_catalog.generate_series(0, 5) as bytes(byte_index);

    begin
      insert into public.rooms (game_id, code, host_user_id, status)
      values (v_game_id, v_room_code, p_host_user_id, 'lobby')
      returning id into v_room_id;
      exit;
    exception
      when unique_violation then
        if v_attempt = 10 then
          raise exception using errcode = '55000', message = 'Unable to allocate a unique room code';
        end if;
    end;
  end loop;

  insert into public.room_players (room_id,user_id,display_name,player_color,turn_order,is_ready)
  values (v_room_id,p_host_user_id,v_display_name,null,null,false);

  insert into public.room_states (room_id,game_state,state_version)
  values (v_room_id,null,0);

  return query select v_room_id,v_room_code,v_game_id,'lobby'::text,0::bigint;
end;
$$;

create or replace function public.join_room_server(
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
  v_lock_room_id uuid;
  v_is_target_member boolean;
  v_old_lobby_ids uuid[] := array[]::uuid[];
  v_lock_room_ids uuid[] := array[]::uuid[];
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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 2010003::bigint)
  );

  select coalesce(
    pg_catalog.array_agg(existing.room_id order by existing.room_id),
    array[]::uuid[]
  )
  into v_old_lobby_ids
  from (
    select distinct r.id as room_id
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
    pg_catalog.array_agg(affected.room_id order by affected.room_id),
    array[]::uuid[]
  )
  into v_lock_room_ids
  from (
    select old_room_id as room_id
    from pg_catalog.unnest(v_old_lobby_ids) as old_rooms(old_room_id)
    union
    select v_room_id where v_room_id is not null
  ) as affected;

  foreach v_lock_room_id in array v_lock_room_ids loop
    perform 1 from public.rooms as r where r.id = v_lock_room_id for update;
  end loop;

  select r.id,r.code,r.game_id,r.status,g.max_players
  into v_room_id,v_room_code,v_game_id,v_status,v_max_players
  from public.rooms as r
  join public.games as g on g.id = r.game_id and g.status = 'active'
  where r.id = v_room_id;

  if v_room_id is null or v_status <> 'lobby' then
    raise exception using errcode = 'P0002', message = 'Room not found or unavailable';
  end if;

  select exists (
    select 1 from public.room_players as rp
    where rp.room_id = v_room_id and rp.user_id = p_user_id
  ) into v_is_target_member;

  if not v_is_target_member then
    select pg_catalog.count(*) into v_player_count
    from public.room_players as rp where rp.room_id = v_room_id;
    if v_player_count >= v_max_players then
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
    set display_name = v_display_name,last_seen_at = pg_catalog.now()
    where rp.room_id = v_room_id and rp.user_id = p_user_id;
  else
    insert into public.room_players (room_id,user_id,display_name,player_color,turn_order,is_ready)
    values (v_room_id,p_user_id,v_display_name,null,null,false);
  end if;

  return query select v_room_id,v_room_code,v_game_id,v_status,not v_is_target_member;
end;
$$;

create function public.leave_room_server(
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
    pg_catalog.hashtextextended(p_user_id::text, 2010003::bigint)
  );

  select r.id into v_room_id
  from public.rooms as r
  where r.code = v_room_code;

  if v_room_id is not null then
    perform 1 from public.rooms as r where r.id = v_room_id for update;
    perform * from ngsllc_private.depart_lobby_member(v_room_id,p_user_id);
  end if;

  return query select true;
end;
$$;

revoke execute on function public.create_room_server(text, uuid, text) from public;
revoke execute on function public.create_room_server(text, uuid, text) from anon;
revoke execute on function public.create_room_server(text, uuid, text) from authenticated;
revoke execute on function public.create_room_server(text, uuid, text) from service_role;
grant execute on function public.create_room_server(text, uuid, text) to service_role;

revoke execute on function public.join_room_server(text, uuid, text) from public;
revoke execute on function public.join_room_server(text, uuid, text) from anon;
revoke execute on function public.join_room_server(text, uuid, text) from authenticated;
revoke execute on function public.join_room_server(text, uuid, text) from service_role;
grant execute on function public.join_room_server(text, uuid, text) to service_role;

revoke execute on function public.leave_room_server(text, uuid) from public;
revoke execute on function public.leave_room_server(text, uuid) from anon;
revoke execute on function public.leave_room_server(text, uuid) from authenticated;
revoke execute on function public.leave_room_server(text, uuid) from service_role;
grant execute on function public.leave_room_server(text, uuid) to service_role;
