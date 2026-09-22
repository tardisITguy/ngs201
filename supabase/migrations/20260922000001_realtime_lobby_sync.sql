-- Safe Realtime lobby synchronization metadata. Room and membership rows are
-- intentionally not published; clients use this version only to refetch them.

create table public.room_lobby_updates (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  room_code text not null unique,
  lobby_version bigint not null,
  updated_at timestamptz not null,
  constraint room_lobby_updates_code_format check (room_code ~ '^[A-Z0-9]{6,10}$'),
  constraint room_lobby_updates_version_nonnegative check (lobby_version >= 0)
);

insert into public.room_lobby_updates (room_id, room_code, lobby_version, updated_at)
select r.id, r.code, 0, pg_catalog.now()
from public.rooms as r;

alter table public.room_lobby_updates enable row level security;

revoke all on table public.room_lobby_updates from public;
revoke all on table public.room_lobby_updates from anon;
revoke all on table public.room_lobby_updates from authenticated;
revoke all on table public.room_lobby_updates from service_role;

grant select on table public.room_lobby_updates to authenticated;

create policy room_lobby_updates_authenticated_read_own_rooms
on public.room_lobby_updates
for select
to authenticated
using (ngsllc_private.is_room_member(room_id));

create function ngsllc_private.initialize_room_lobby_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.room_lobby_updates (room_id, room_code, lobby_version, updated_at)
  values (new.id, new.code, 0, pg_catalog.now())
  on conflict (room_id) do nothing;
  return new;
end;
$$;

revoke all on function ngsllc_private.initialize_room_lobby_update() from public;
revoke all on function ngsllc_private.initialize_room_lobby_update() from anon;
revoke all on function ngsllc_private.initialize_room_lobby_update() from authenticated;
revoke all on function ngsllc_private.initialize_room_lobby_update() from service_role;

create trigger rooms_initialize_lobby_update
after insert on public.rooms
for each row execute function ngsllc_private.initialize_room_lobby_update();

create function ngsllc_private.bump_room_lobby_update()
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
  elsif tg_table_name = 'rooms' then
    v_room_id := new.id;
    v_meaningful := new.host_user_id is distinct from old.host_user_id
      or new.status is distinct from old.status;
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

revoke all on function ngsllc_private.bump_room_lobby_update() from public;
revoke all on function ngsllc_private.bump_room_lobby_update() from anon;
revoke all on function ngsllc_private.bump_room_lobby_update() from authenticated;
revoke all on function ngsllc_private.bump_room_lobby_update() from service_role;

create trigger room_players_bump_lobby_update
after insert or delete or update of display_name, player_color, is_ready
on public.room_players
for each row execute function ngsllc_private.bump_room_lobby_update();

create trigger rooms_bump_lobby_update
after update of host_user_id, status on public.rooms
for each row execute function ngsllc_private.bump_room_lobby_update();

alter publication supabase_realtime add table public.room_lobby_updates;
