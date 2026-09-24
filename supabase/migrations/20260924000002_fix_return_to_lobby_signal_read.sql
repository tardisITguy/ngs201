-- Allow the service-only SECURITY INVOKER Return-to-Lobby RPC to read the
-- safe lobby synchronization row it returns after completing the reset.
grant select
on table public.room_lobby_updates
to service_role;
