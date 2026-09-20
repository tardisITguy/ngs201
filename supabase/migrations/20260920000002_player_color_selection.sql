create table public.game_player_colors (
  game_id uuid not null references public.games(id) on delete cascade,
  color text not null,
  sort_order smallint not null,
  primary key (game_id, color),
  constraint game_player_colors_order_unique unique (game_id, sort_order),
  constraint game_player_colors_color_format check (
    char_length(color) between 1 and 40
    and color = btrim(color)
    and color ~ '^[a-z][a-z0-9-]*$'
  ),
  constraint game_player_colors_sort_order_range check (sort_order between 0 and 63)
);

alter table public.game_player_colors enable row level security;
revoke all on table public.game_player_colors from public, anon, authenticated;
revoke all on table public.game_player_colors from service_role;
grant select on table public.game_player_colors to service_role;

insert into public.game_player_colors (game_id, color, sort_order)
select g.id, supported.color, supported.sort_order
from public.games as g
cross join (values
  ('red', 0::smallint),
  ('purple', 1::smallint),
  ('blue', 2::smallint),
  ('cyan', 3::smallint),
  ('green', 4::smallint),
  ('yellow', 5::smallint),
  ('orange', 6::smallint),
  ('black', 7::smallint)
) as supported(color, sort_order)
where g.slug = 'worship-me'
on conflict (game_id, color) do update
set sort_order = excluded.sort_order;

create function public.set_player_color_server(
  p_room_code text,
  p_user_id uuid,
  p_player_color text
)
returns table (
  room_id uuid,
  room_code text,
  player_color text,
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
  v_requested_color text;
  v_current_color text;
  v_member_found boolean;
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

  if p_player_color is not null then
    v_requested_color := pg_catalog.btrim(p_player_color);
    if v_requested_color <> p_player_color
      or pg_catalog.char_length(v_requested_color) not between 1 and 40
      or v_requested_color !~ '^[a-z][a-z0-9-]*$'
    then
      raise exception using errcode = '22023', message = 'Invalid player color';
    end if;
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

  select rp.player_color
  into v_current_color
  from public.room_players as rp
  where rp.room_id = v_room_id
    and rp.user_id = p_user_id;
  v_member_found := found;

  if not v_member_found then
    raise exception using errcode = 'P0002', message = 'Room not found or unavailable';
  end if;

  if v_requested_color is null then
    if v_current_color is null then
      return query select v_room_id, v_room_code, null::text, false;
      return;
    end if;
    update public.room_players as rp
    set player_color = null,
        is_ready = false
    where rp.room_id = v_room_id
      and rp.user_id = p_user_id;
    return query select v_room_id, v_room_code, null::text, true;
    return;
  end if;

  if not exists (
    select 1
    from public.game_player_colors as supported
    where supported.game_id = v_game_id
      and supported.color = v_requested_color
  ) then
    raise exception using errcode = '22023', message = 'Invalid player color';
  end if;

  if v_current_color = v_requested_color then
    return query select v_room_id, v_room_code, v_current_color, false;
    return;
  end if;

  if exists (
    select 1
    from public.room_players as other_player
    where other_player.room_id = v_room_id
      and other_player.user_id <> p_user_id
      and other_player.player_color = v_requested_color
  ) then
    raise exception using errcode = 'P0003', message = 'Player color unavailable';
  end if;

  begin
    update public.room_players as rp
    set player_color = v_requested_color,
        is_ready = false
    where rp.room_id = v_room_id
      and rp.user_id = p_user_id;
  exception
    when unique_violation then
      raise exception using errcode = 'P0003', message = 'Player color unavailable';
  end;

  return query select v_room_id, v_room_code, v_requested_color, true;
end;
$$;

revoke execute on function public.set_player_color_server(text, uuid, text) from public;
revoke execute on function public.set_player_color_server(text, uuid, text) from anon;
revoke execute on function public.set_player_color_server(text, uuid, text) from authenticated;
revoke execute on function public.set_player_color_server(text, uuid, text) from service_role;
grant execute on function public.set_player_color_server(text, uuid, text) to service_role;
