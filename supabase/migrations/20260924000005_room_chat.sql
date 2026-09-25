-- Persistent room-scoped human chat. Published rows are intrinsically safe:
-- no auth identity, presence, kick, or canonical game-state data is stored here.

create table public.room_chat_messages (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  sender_display_name text not null,
  message_text text not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint room_chat_messages_sender_name_valid check (
    sender_display_name = pg_catalog.btrim(sender_display_name)
    and pg_catalog.char_length(sender_display_name) between 1 and 50
  ),
  constraint room_chat_messages_text_valid check (
    message_text = pg_catalog.btrim(message_text)
    and pg_catalog.char_length(message_text) between 1 and 500
    and message_text !~ '[[:cntrl:]]'
  )
);

create index room_chat_messages_room_history_idx
on public.room_chat_messages (room_id, created_at desc, id desc);

alter table public.room_chat_messages enable row level security;

revoke all on table public.room_chat_messages from public, anon, authenticated, service_role;
grant select on table public.room_chat_messages to authenticated;
grant select, insert on table public.room_chat_messages to service_role;

create policy room_chat_messages_authenticated_read_current_room
on public.room_chat_messages
for select
to authenticated
using (ngsllc_private.is_room_member(room_id));

create table ngsllc_private.room_chat_rate_limits (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_sent_at timestamptz not null,
  primary key (room_id, user_id)
);

revoke all on table ngsllc_private.room_chat_rate_limits from public, anon, authenticated, service_role;
grant select, insert, update on table ngsllc_private.room_chat_rate_limits to service_role;

create function public.send_room_chat_message_server(
  p_room_code text,
  p_user_id uuid,
  p_message_text text
)
returns table (
  message_id uuid,
  room_id uuid,
  sender_display_name text,
  message_text text,
  created_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_room_code text;
  v_room_status text;
  v_sender_display_name text;
  v_message_text text;
  v_now timestamptz;
  v_rate_allowed_at timestamptz;
  v_message_id uuid;
  v_created_at timestamptz;
begin
  v_room_code := pg_catalog.upper(pg_catalog.btrim(p_room_code));
  if p_user_id is null
    or v_room_code is null
    or pg_catalog.char_length(v_room_code) not between 6 and 10
    or v_room_code !~ '^[A-Z0-9]+$'
  then
    raise exception using errcode = '22023', message = 'Invalid chat request';
  end if;

  if p_message_text is null or p_message_text ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'Invalid chat message';
  end if;
  v_message_text := pg_catalog.btrim(p_message_text);
  if pg_catalog.char_length(v_message_text) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'Invalid chat message';
  end if;

  -- Lock the room before the membership row. Lifecycle commands use this same
  -- room -> membership order. KEY SHARE permits concurrent chat sends while
  -- serializing with lifecycle commands that explicitly take FOR UPDATE.
  select r.id, r.code, r.status
  into v_room_id, v_room_code, v_room_status
  from public.rooms as r
  join public.games as g
    on g.id = r.game_id
   and g.slug = 'worship-me'
   and g.status = 'active'
  where r.code = v_room_code
  for key share of r;

  if v_room_id is null then
    raise exception using errcode = 'P0002', message = 'Room not found or unavailable';
  end if;

  select member.display_name
  into v_sender_display_name
  from public.room_players as member
  where member.room_id = v_room_id
    and member.user_id = p_user_id
  for key share of member;

  if not found then
    raise exception using errcode = 'P0002', message = 'Room not found or unavailable';
  end if;
  if v_room_status not in ('lobby', 'active') then
    raise exception using errcode = 'P0004', message = 'Room does not allow chat';
  end if;

  v_now := pg_catalog.clock_timestamp();
  insert into ngsllc_private.room_chat_rate_limits as rate_limit (
    room_id, user_id, last_sent_at
  ) values (
    v_room_id, p_user_id, v_now
  )
  on conflict on constraint room_chat_rate_limits_pkey do update
  set last_sent_at = excluded.last_sent_at
  where rate_limit.last_sent_at <= excluded.last_sent_at - interval '1 second'
  returning last_sent_at into v_rate_allowed_at;

  if v_rate_allowed_at is null then
    raise exception using errcode = 'P0008', message = 'Chat rate limit exceeded';
  end if;

  insert into public.room_chat_messages as inserted_message (
    room_id, sender_display_name, message_text
  ) values (
    v_room_id, v_sender_display_name, v_message_text
  )
  returning inserted_message.id, inserted_message.created_at
  into v_message_id, v_created_at;

  return query
  select v_message_id, v_room_id, v_sender_display_name, v_message_text, v_created_at;
end;
$$;

revoke execute on function public.send_room_chat_message_server(text,uuid,text)
from public, anon, authenticated, service_role;

grant execute on function public.send_room_chat_message_server(text,uuid,text)
to service_role;

alter publication supabase_realtime add table public.room_chat_messages;
