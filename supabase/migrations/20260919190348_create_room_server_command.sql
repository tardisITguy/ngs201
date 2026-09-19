create function public.create_room_server(
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

  select g.id
  into v_game_id
  from public.games as g
  where g.slug = p_game_slug
    and g.status = 'active';

  if v_game_id is null then
    raise exception using errcode = '22023', message = 'Active game not found';
  end if;

  for v_attempt in 1..10 loop
    v_random_bytes := pg_catalog.uuid_send(pg_catalog.gen_random_uuid());
    select pg_catalog.string_agg(
      pg_catalog.substr(
        v_alphabet,
        (pg_catalog.get_byte(v_random_bytes, byte_index) % 32) + 1,
        1
      ),
      ''
      order by byte_index
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

  insert into public.room_players (
    room_id,
    user_id,
    display_name,
    player_color,
    turn_order,
    is_ready
  ) values (
    v_room_id,
    p_host_user_id,
    v_display_name,
    null,
    null,
    false
  );

  insert into public.room_states (room_id, game_state, state_version)
  values (v_room_id, null, 0);

  return query
  select v_room_id, v_room_code, v_game_id, 'lobby'::text, 0::bigint;
end;
$$;

revoke execute on function public.create_room_server(text, uuid, text) from public;
revoke execute on function public.create_room_server(text, uuid, text) from anon;
revoke execute on function public.create_room_server(text, uuid, text) from authenticated;
revoke execute on function public.create_room_server(text, uuid, text) from service_role;
grant execute on function public.create_room_server(text, uuid, text) to service_role;
