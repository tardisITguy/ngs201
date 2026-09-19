-- Initial reusable NGSLLC platform schema. This migration is intentionally
-- limited to the game registry, rooms, room membership, and server-only
-- canonical room state.

create schema if not exists ngsllc_private;

revoke all on schema ngsllc_private from public;
revoke all on schema ngsllc_private from anon;
revoke all on schema ngsllc_private from authenticated;

create table public.games (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint games_slug_format check (
    char_length(slug) between 2 and 64
    and slug = btrim(slug)
    and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  constraint games_name_length check (
    char_length(name) between 1 and 100
    and name = btrim(name)
  ),
  constraint games_status check (status in ('active', 'disabled'))
);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id),
  code text not null unique,
  host_user_id uuid not null references auth.users(id),
  status text not null default 'lobby',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rooms_code_format check (code ~ '^[A-Z0-9]{6,10}$'),
  constraint rooms_status check (status in ('lobby', 'active', 'finished', 'abandoned'))
);

create table public.room_states (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  game_state jsonb,
  state_version bigint not null default 0,
  updated_at timestamptz not null default now(),
  constraint room_states_state_version_nonnegative check (state_version >= 0),
  constraint room_states_game_state_object check (
    game_state is null or jsonb_typeof(game_state) = 'object'
  )
);

create table public.room_players (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  player_color text,
  turn_order smallint,
  is_ready boolean not null default false,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (room_id, user_id),
  constraint room_players_display_name_length check (
    char_length(display_name) between 1 and 50
    and display_name = btrim(display_name)
  ),
  constraint room_players_turn_order_range check (
    turn_order is null or turn_order between 0 and 63
  ),
  constraint room_players_color_length check (
    player_color is null
    or (char_length(player_color) between 1 and 40 and player_color = btrim(player_color))
  )
);

create index rooms_game_id_idx on public.rooms(game_id);
create index rooms_host_user_id_idx on public.rooms(host_user_id);
create index room_players_user_id_idx on public.room_players(user_id);
create unique index room_players_room_turn_order_uidx
on public.room_players(room_id, turn_order)
where turn_order is not null;
create unique index room_players_room_color_uidx
on public.room_players(room_id, player_color)
where player_color is not null;

create function ngsllc_private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function ngsllc_private.set_updated_at() from public;
revoke all on function ngsllc_private.set_updated_at() from anon;
revoke all on function ngsllc_private.set_updated_at() from authenticated;

create trigger games_set_updated_at
before update on public.games
for each row execute function ngsllc_private.set_updated_at();

create trigger rooms_set_updated_at
before update on public.rooms
for each row execute function ngsllc_private.set_updated_at();

create trigger room_states_set_updated_at
before update on public.room_states
for each row execute function ngsllc_private.set_updated_at();

-- RLS policies on rooms and room_players both need membership checks. Using a
-- narrowly scoped SECURITY DEFINER helper avoids policy recursion. The helper
-- accepts only a room id, derives the user from auth.uid(), has an empty search
-- path, and schema-qualifies the protected table.
create function ngsllc_private.is_room_member(target_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.room_players rp
    where rp.room_id = target_room_id
      and rp.user_id = (select auth.uid())
  );
$$;

revoke all on function ngsllc_private.is_room_member(uuid) from public;
revoke all on function ngsllc_private.is_room_member(uuid) from anon;
revoke all on function ngsllc_private.is_room_member(uuid) from authenticated;
grant usage on schema ngsllc_private to authenticated;
grant execute on function ngsllc_private.is_room_member(uuid) to authenticated;

alter table public.games enable row level security;
alter table public.rooms enable row level security;
alter table public.room_players enable row level security;
alter table public.room_states enable row level security;

revoke all on table public.games from public, anon, authenticated;
revoke all on table public.rooms from public, anon, authenticated;
revoke all on table public.room_players from public, anon, authenticated;
revoke all on table public.room_states from public, anon, authenticated;

revoke all on table public.games from service_role;
revoke all on table public.rooms from service_role;
revoke all on table public.room_players from service_role;
revoke all on table public.room_states from service_role;

grant select on table public.games to authenticated;
grant select on table public.rooms to authenticated;
grant select on table public.room_players to authenticated;

grant select on table public.games to service_role;
grant select, insert, update, delete on table public.rooms to service_role;
grant select, insert, update, delete on table public.room_players to service_role;
grant select, insert, update, delete on table public.room_states to service_role;

create policy games_authenticated_read_active
on public.games
for select
to authenticated
using (status = 'active');

create policy rooms_authenticated_read_host_or_member
on public.rooms
for select
to authenticated
using (
  host_user_id = (select auth.uid())
  or ngsllc_private.is_room_member(id)
);

create policy room_players_authenticated_read_own_rooms
on public.room_players
for select
to authenticated
using (ngsllc_private.is_room_member(room_id));

insert into public.games (slug, name, status)
values ('worship-me', 'Worship Me!', 'active')
on conflict (slug) do update
set name = excluded.name,
    status = excluded.status,
    updated_at = now();
