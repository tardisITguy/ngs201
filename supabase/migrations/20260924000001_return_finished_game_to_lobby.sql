-- Return a completed active game to its existing lobby for a fresh rematch.
create function public.return_finished_game_to_lobby_server(
  p_room_code text,
  p_user_id uuid
)
returns table (
  room_code text,
  room_status text,
  lobby_version bigint
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
  v_game_state jsonb;
  v_state_version bigint;
begin
  v_room_code := pg_catalog.upper(pg_catalog.btrim(p_room_code));
  if p_user_id is null
    or v_room_code is null
    or pg_catalog.char_length(v_room_code) not between 6 and 10
    or v_room_code !~ '^[A-Z0-9]+$'
  then
    raise exception using errcode = '22023', message = 'Invalid return-to-lobby request';
  end if;

  select r.id, r.code, r.status, r.host_user_id
  into v_room_id, v_room_code, v_room_status, v_host_user_id
  from public.rooms as r
  where r.code = v_room_code
  for update of r;

  if v_room_id is null or not exists (
    select 1
    from public.room_players as member
    where member.room_id = v_room_id
      and member.user_id = p_user_id
  ) then
    raise exception using errcode = 'P0002', message = 'Room not found or unavailable';
  end if;

  if v_host_user_id is distinct from p_user_id then
    raise exception using errcode = 'P0003', message = 'Only the host can return the room to the lobby';
  end if;

  if v_room_status is distinct from 'active' then
    raise exception using errcode = 'P0004', message = 'Game is not finished';
  end if;

  select state.game_state, state.state_version
  into v_game_state, v_state_version
  from public.room_states as state
  where state.room_id = v_room_id
  for update of state;

  if not found
    or pg_catalog.jsonb_typeof(v_game_state) is distinct from 'object'
    or v_state_version < 1
    or v_game_state->'schemaVersion' is distinct from '9'::jsonb
    or v_game_state->>'phase' is distinct from 'gameOver'
    or pg_catalog.jsonb_typeof(v_game_state->'players') is distinct from 'array'
    or nullif(pg_catalog.btrim(v_game_state->>'winnerId'), '') is null
    or not exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_game_state->'players') as player(value)
      where player.value->>'id' = v_game_state->>'winnerId'
    )
  then
    raise exception using errcode = 'P0004', message = 'Game is not finished';
  end if;

  update public.room_players as member
  set turn_order = null,
      is_ready = false
  where member.room_id = v_room_id;

  update public.room_ai_players as ai
  set turn_order = null
  where ai.room_id = v_room_id;

  update public.room_states as state
  set game_state = null,
      state_version = 0,
      updated_at = pg_catalog.now()
  where state.room_id = v_room_id
    and state.state_version = v_state_version;

  if not found then
    raise exception using errcode = 'P0004', message = 'Game is not finished';
  end if;

  update public.rooms as room
  set status = 'lobby'
  where room.id = v_room_id
    and room.status = 'active';

  if not found then
    raise exception using errcode = 'P0004', message = 'Game is not finished';
  end if;

  return query
  select v_room_code, 'lobby'::text, signal.lobby_version
  from public.room_lobby_updates as signal
  where signal.room_id = v_room_id;
end;
$$;

revoke execute on function public.return_finished_game_to_lobby_server(text,uuid)
from public, anon, authenticated, service_role;

grant execute on function public.return_finished_game_to_lobby_server(text,uuid)
to service_role;
