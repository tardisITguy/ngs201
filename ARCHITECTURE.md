# Worship Me! architecture

## Boundaries

The repository is organized as a small application containing one independently
embeddable game module:

```text
src/
  platform/                         shared NGSLLC platform types and adapters
  games/worship-me/
    engine/                         deterministic rules and state transitions
    ai/                             bot policies and headless simulations
    ui/                             Worship Me! DOM rendering helpers
  main.ts                           NGS Play browser composition root
```

## Worship Me! engine

`src/games/worship-me/engine/index.ts` is the supported host-facing interface.
It exposes the Worship Me! `GameState`, `GameAction`, initial-state creation,
the reducer/action application functions, legal-action discovery, placement
validation, serialization, and victory inspection.

The engine is deterministic for a supplied state, action, and seeded RNG state.
It has no dependency on React, DOM globals, browser storage, HTTP, WebSockets,
Supabase, or server APIs. Rules remain game-specific; internal modules cover the
board, placement claims, ordered resolution, movement, production, births,
Priests, Neutrals, history, persistence validation, and victory evaluation.

The current reducer is named `applyAction` internally and is also exported as
`reducer` from the public interface. Pending resolution decisions use the
separate deterministic `resolvePendingDecision` entry point because they are a
distinct action shape in the existing rules model.

## AI

`src/games/worship-me/ai` consumes the engine API and internal deterministic
helpers. Bots receive legal engine actions and submit their selected actions
through the same reducer as human players. Headless simulation and diagnostic
CLI code belong here, not in the engine.

## NGS Play deployment and player journey

```text
Squarespace: newgamestudios.com (public studio and marketing site)
  -> PLAY
Hostinger: play.newgamestudios.com (static Vite application)
  -> NGS identity -> Games -> Worship Me! -> Host
  -> trusted Create Room command -> Lobby
  -> future trusted Start Game command -> Worship Me! network game
```

GitHub remains the source of truth. Hostinger serves the compiled static app
and its Apache History API fallback. Supabase provides Auth, Postgres, Edge
Functions, and future Realtime. `ngsllc-dev` is currently the development
backend; `play.newgamestudios.com` remains an unlinked development/test
deployment until `ngsllc-prod` exists.

The shell uses `/`, `/games`, `/games/worship-me`, and `/room/:code`.
Anonymous Supabase users are real authenticated users. The local
`ngs.playerDisplayName` is presentation convenience, never authorization.
Catalog and lobby browser reads remain RLS-controlled, and canonical
`public.room_states` stays server-only.

## Browser application and persistence

`src/main.ts` is the browser composition root. The NGS Play shell owns the site
root and precedes the game experience. The retained local game composition owns DOM event binding,
`window.setTimeout`, file downloads/imports, and the current
`localStorage` save/resume adapter. The UI renderers under
`src/games/worship-me/ui` consume game state but do not define rules.

Serialization of a state to/from JSON is environment-neutral engine behavior.
Choosing to store that JSON in localStorage is an application-adapter concern
and remains in `main.ts`.

## NGSLLC platform and future multiplayer

`src/platform` owns reusable infrastructure rather than game rules. Its first
foundation consists of generic game/room/membership records, a lazy browser
Supabase client, and a reviewed-but-not-yet-applied SQL migration. The browser
client reads only the public Supabase URL and publishable key. It currently has
no application call sites and does not alter local play.

The platform will eventually provide:

- authentication and player identity;
- rooms, invitations, matchmaking, presence, and chat;
- persistence/repository adapters;
- realtime command and state delivery;
- authorization, sequencing, idempotency, and reconnect handling;
- server deployment and operational telemetry.

Canonical multiplayer flow will be:

```text
Browser -> command -> trusted server layer
        -> select game engine
        -> reducer(currentState, action)
        -> atomic versioned database commit
        -> realtime notification
```

The trusted layer will load authoritative state from server-only
`public.room_states` and invoke the same exported game reducer server-side.
The browser must never be authoritative and has no direct read or write access
to canonical state. The trusted layer will eventually transform canonical
state/version changes into player-safe views or events. Supabase connects only
through platform adapters; it must not be imported into the Worship Me! engine.

The intended lobby/start flow is:

1. A player joins a room.
2. The player chooses an available color allowed by that game.
3. The player marks Ready.
4. The host requests Start Game.
5. The trusted server validates the lobby.
6. The trusted server randomly shuffles the players once.
7. It atomically persists `turn_order` values `0..N-1`.
8. It creates canonical initial state using that persisted order.
9. It changes the room status to active.

The browser never chooses or directly writes `turn_order`. Refreshing and
reconnecting reuse the persisted order rather than randomizing again. Future
trusted lobby commands may change `player_color` only while a room is in lobby;
normal active-game commands must not alter color or turn order.

### First trusted command: Create Room

Room creation follows the platform trust boundary:

```text
Anonymous browser user
        -> authenticated Supabase JWT
        -> create-room Edge Function
        -> validated caller identity and request
        -> service-only create_room_server RPC
        -> rooms + host room_players row + room_states
        -> safe room metadata response
```

Anonymous Supabase users use the normal authenticated role. The browser reuses
its persisted session and sends only game slug and display name; it cannot
choose `host_user_id`, write platform tables, call the RPC, or read canonical
state. The Edge Function validates the JWT, derives the host ID from that
identity, and invokes the restricted atomic RPC through its server context.
Room codes support discovery and invitation only; possession of a code is not
authorization. Host membership and the server-only state row are created in
the same transaction as the room.

Color selection and random persisted turn order remain future trusted
commands. Future mutations should use this same authenticated Edge Function to
service-only atomic-command pattern and expose player-safe views/events rather
than canonical `game_state`.

### Second trusted command: Join Room

```text
Player B with an authenticated anonymous Supabase identity
        -> room code entry
        -> join-room Edge Function
        -> verified caller identity
        -> service-only join_room_server RPC
        -> atomic room_players membership
        -> RLS-protected room + room_players reads
```

The Join screen is `/games/worship-me/join`. Room codes enable discovery but
confer no authorization. A non-member cannot query an arbitrary room, so the
browser invokes the trusted command without a preflight lookup. The server
locks the room row, requires lobby status, and checks the active game's
persisted `max_players` before inserting a new member. Existing-member rejoin
is idempotent and refreshes the validated display name and `last_seen_at`.

The browser sends only `roomCode` and `displayName`; the Edge Function derives
the user ID from the validated JWT. `room_states` remains server-only. Realtime
is deliberately deferred: the joining player loads the existing lobby after
membership is created, while the host manually uses **Refresh Players**.

The former development-only local Undo control has been removed. A future
multiplayer undo policy, if desired, would require an explicit authorized
server command and must never rewind canonical shared state client-side.

### Lobby lifecycle and single-lobby membership

An authenticated user may belong to at most one `lobby` room. Explicit leave
uses the same trusted-command boundary:

```text
Browser -> leave-room Edge Function -> verified caller identity
        -> service-only leave_room_server -> membership removal
        -> deterministic host transfer or empty-room abandonment
```

Create, Join, and Leave take a transaction-level advisory lock derived from
the authenticated user UUID. Create and Join identify all relevant lobby rooms
and lock their rows in ascending UUID order before mutating membership. This
serializes same-user concurrent commands and avoids arbitrary cross-room lock
ordering. Failure restores old membership through transaction rollback, and a
successful command self-heals legacy multiple-lobby membership.

Host succession selects the earliest remaining `joined_at`, using `user_id` as
a deterministic secondary key. If no member remains, the lobby is marked
`abandoned`; the room and canonical `room_states` row are retained. These
rules apply only to lobbies. Active-game disconnect and reconnect semantics
remain deferred.

Browser navigation, unload, tab closure, and local storage are never
authoritative lobby mutations. The explicit lobby button calls Leave Lobby;
otherwise the next trusted Create or Join cleans up stale membership. Realtime
is still deferred, so remaining players use **Refresh Players** to observe a
host transfer.

## Game-specific responsibilities

Worship Me! retains its own rules contract, state schema, actions, validation,
resolution queue, production and victory behavior, save schema, AI strategies,
art assets, and UI. Future games should add sibling modules rather than extend
or parameterize a universal Worship Me! reducer.
