# NGSLLC platform boundary

This directory is reserved for infrastructure shared by multiple NGSLLC games.
The intended direction is:

```text
NGSLLC platform
  -> games/worship-me
  -> games/<future-game>
```

The platform owns cross-game concerns: the game registry, authentication,
rooms, membership, persistence, and—later—chat, realtime transport, command
authorization, and observability. This first foundation includes generic
record types, a lazy Supabase browser client, and a local migration defining
the registry, room, membership, and server-only canonical-state schema. The
migration is not applied remotely and there are no room commands,
subscriptions, or authentication UI yet.

Each game keeps its own state model, actions, validation, reducer, AI, and UI.
There is deliberately no universal game reducer and no attempt to make Worship
Me! rules generic.

Future canonical multiplayer actions follow this boundary:

```text
Browser -> command -> trusted server layer
        -> select game engine
        -> reducer(currentState, action)
        -> atomic versioned database commit
        -> realtime notification
```

The browser is never authoritative. It has neither read nor write privileges
on `public.room_states`; a future trusted command layer will turn canonical
state/version changes into player-safe views or events. The browser may choose
an available game-defined color only through a future trusted lobby command.
It never chooses `turn_order`: Start Game will validate the lobby, randomly
shuffle once, atomically persist order `0..N-1`, create canonical state from
that order, and activate the room. Reconnects reuse that persisted order.
`src/platform/supabase/client.ts` may use only the public project URL and
publishable key; privileged credentials belong only in the trusted server
environment.

## Trusted Create Room flow

```text
Anonymous browser user
        -> authenticated JWT
        -> create-room Edge Function
        -> trusted identity and payload validation
        -> service-only create_room_server RPC
        -> rooms + host membership + room_states
        -> safe room metadata
```

Anonymous users are authenticated Supabase users. The browser reuses its
persisted anonymous session, supplies only a game slug and display name, and
never writes tables directly. The Edge Function validates the caller JWT and
derives `host_user_id`; request JSON cannot select the host. The atomic RPC is
not executable by browser roles and returns no canonical state. A room code is
for discovery, not authorization.

The initial host has no color or turn order. Color selection, Ready, Start
Game, and the one-time random persisted turn-order assignment are later
trusted commands. Canonical `room_states.game_state` remains server-only and
will eventually be transformed into player-safe views or events.
