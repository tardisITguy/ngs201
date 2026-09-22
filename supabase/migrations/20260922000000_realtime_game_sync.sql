-- Safe Realtime synchronization metadata. Canonical GameState remains only in
-- public.room_states and is intentionally excluded from this table/publication.

create table public.room_game_updates (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  room_code text not null unique,
  state_version bigint not null,
  updated_at timestamptz not null,
  constraint room_game_updates_code_format check (room_code ~ '^[A-Z0-9]{6,10}$'),
  constraint room_game_updates_state_version_nonnegative check (state_version >= 0)
);

insert into public.room_game_updates (room_id, room_code, state_version, updated_at)
select rs.room_id, r.code, rs.state_version, rs.updated_at
from public.room_states as rs
join public.rooms as r on r.id = rs.room_id;

alter table public.room_game_updates enable row level security;

revoke all on table public.room_game_updates from public;
revoke all on table public.room_game_updates from anon;
revoke all on table public.room_game_updates from authenticated;
revoke all on table public.room_game_updates from service_role;

grant select on table public.room_game_updates to authenticated;

create policy room_game_updates_authenticated_read_own_rooms
on public.room_game_updates
for select
to authenticated
using (ngsllc_private.is_room_member(room_id));

create function ngsllc_private.sync_room_game_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.state_version is distinct from old.state_version then
    insert into public.room_game_updates (room_id, room_code, state_version, updated_at)
    select new.room_id, r.code, new.state_version, new.updated_at
    from public.rooms as r
    where r.id = new.room_id
    on conflict (room_id) do update
    set room_code = excluded.room_code,
        state_version = excluded.state_version,
        updated_at = excluded.updated_at;
  end if;
  return new;
end;
$$;

revoke all on function ngsllc_private.sync_room_game_update() from public;
revoke all on function ngsllc_private.sync_room_game_update() from anon;
revoke all on function ngsllc_private.sync_room_game_update() from authenticated;
revoke all on function ngsllc_private.sync_room_game_update() from service_role;

create trigger room_states_sync_room_game_update
after insert or update of state_version on public.room_states
for each row execute function ngsllc_private.sync_room_game_update();

alter publication supabase_realtime add table public.room_game_updates;
