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
Functions, and safe game-version Realtime. `ngsllc-dev` is currently the development
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
authoritative lobby mutations. The explicit lobby button calls Leave Lobby.
While a lobby is actually visible, a 20-second presence heartbeat sends only
the room code through the authenticated `lobby-presence` Edge Function. Hidden
tabs do not refresh presence; becoming visible, focus, and online events touch
immediately only while visible. The service-only
`touch_lobby_presence_server` locks the room, captures wall-clock time after
the lock, monotonically refreshes only the verified caller, and removes other
humans stale for more than 90 seconds through the existing departure helper. This preserves the
same deterministic host succession and M10 notifications. The heartbeat is
presence only; M10 Realtime remains the lobby-state synchronization path.

Public directory discovery additionally requires the current human host's
`last_seen_at` to be within 90 seconds of server time. Thus a zero-observer
room may retain stale database membership and `lobby` status, but it becomes
undiscoverable without cron or destructive cleanup. Explicit join by room code
does not use host freshness; an admitted member starts presence, which may
clean stale peers and transfer host authority. Lobby presence stops on Leave,
Kick, Start, room navigation, and non-lobby states, and restarts when a
finished game returns to the lobby.

## Game-specific responsibilities

### Trusted player-color command

```text
Browser -> set-player-color Edge Function -> verified JWT
        -> service-only set_player_color_server -> locked lobby room
        -> server game-color validation -> unique room assignment
```

`public.game_player_colors` is the reusable, server-authoritative catalog of
colors supported by each game. Worship Me! seeds its existing eight engine
colors. Browser constants and lobby reads are presentation hints, not
authority. The RPC locks the room before checking membership and availability;
the existing partial unique `(room_id, player_color)` index is final
race-safety defense. A stale client losing a color race receives a safe
conflict and refreshes the lobby. Realtime remains deferred.

Actual color changes and clearing reset `is_ready` to false. Selecting the
already-owned color is idempotent and preserves readiness. Leaving deletes the
membership and releases its color.

### Trusted Ready command

```text
Browser -> set-player-ready Edge Function -> verified JWT
        -> service-only set_player_ready_server -> locked lobby room
        -> membership and supported-color validation -> is_ready update
```

Ready is server-authoritative and changes only the authenticated member's
`is_ready` value. Becoming Ready requires a currently selected color that is
still present in the game's server color catalog; becoming Not Ready never
requires a color. Same-state requests are idempotent. Ready and color commands
lock the same room row, so a concurrent color change/clear cannot commit a
ready player without a color. Actual color changes and clears continue to reset
Ready, while same-color selection preserves it.

Realtime remains deferred, so other players use **Refresh Players** to observe
Ready changes. The host's local Start eligibility display is advisory; the
trusted Start command revalidates all eligibility server-side before creating
canonical state.

### Trusted Start Game command

```text
Browser roomCode only -> start-game Edge Function -> verified JWT
  -> privileged ordered-lobby snapshot -> server crypto seed
  -> existing Worship Me! createGame() -> start_game_server
  -> locked exact-snapshot and lobby validation
  -> turn_order + canonical room_states state/version + active status
```

Start is host-only and atomic. The Edge Function imports the existing pure
engine setup implementation; the browser never constructs or submits players,
order, seed, or canonical state. The database locks the room and rejects stale
rosters before persisting anything. A successful Start writes state version 1,
freezes the ordered roster, and activates the room exactly once. Canonical
`room_states` remains unreadable to browser roles.

Lobby order is stable `joined_at`, then `user_id`. Database `turn_order = 0`
maps to engine `p1`, `1` to `p2`, and so on, using precisely the array supplied
to `createGame()`. Name Room and Start Game are host-only controls.

### Trusted active game-state delivery

```text
Browser roomCode only -> get-game-state Edge Function -> verified JWT
  -> service-only get_active_game_state_server -> membership-gated room_states read
  -> buildWorshipMePublicGameView allowlist projection -> read-only board
```

**Raw canonical GameState is never sent to the browser.** Canonical state
contains face-down `hiddenKind`, the setup seed, RNG state, removed tiles, bag
contents, history, and a seed-bearing event log. The server constructs a new
allowlisted DTO rather than shallow-copying and redacting state. Browser roles
retain no access to `room_states`.

Persisted `turn_order` maps to engine IDs (`0` to `p1`, `1` to `p2`, and so
on), allowing the trusted response to identify `viewerPlayerId`.
`currentPlayerId` comes from canonical `turnOrder[currentPlayerIndex]`, and
the response carries canonical `stateVersion` without changing it. Manual
**Refresh Game** remains available as a fallback to live synchronization.

### Trusted gameplay mutation

```text
Browser intent { roomCode, expectedStateVersion, command }
  -> game-action Edge Function -> verified JWT -> trusted canonical read
  -> derive viewer pN from persisted turn_order
  -> existing applyAction() / resolvePendingDecision()
  -> validate public projection -> commit_game_action_server
  -> rooms lock -> membership/current-player check -> room_states lock
  -> optimistic version check -> atomic state + version commit
  -> browser-safe public projection
```

The browser never computes or submits an authoritative next state. It cannot
choose a user/player ID, seed, roster, hidden data, or canonical state. The
trusted Edge Function injects the authenticated engine player ID and delegates
all legality, queue resolution, production, births, Priests, round changes,
and victory behavior to the existing reducer.

Every successful command increments `room_states.state_version` exactly once.
The commit RPC locks `rooms` before `room_states`, compares the expected
version, confirms the locked current player, and preserves setup identity such
as seed, config, roster, turn order, and board structure. Stale commands fail
without overwriting newer state. The public DTO exposes only an allowlisted
pending choice and never canonical `pendingResolution` or its `queueIndex`.
### Safe Realtime game synchronization

```text
canonical room_states -> trusted DB mutation -> safe version-signal trigger
  -> room_game_updates -> Supabase Realtime -> browser version signal
  -> get-game-state -> allowlisted public GameView
```

Realtime never transports canonical GameState. `public.room_states` remains
server-only and is not in the Realtime publication. The published
`room_game_updates` row contains only `room_id`, `room_code`, `state_version`,
and `updated_at`; authenticated members receive its updates through an
RLS-protected, read-only subscription scoped to their current room.

The browser treats a Realtime row only as notice that a newer canonical
version may exist. It validates the room/version signal, compares it with the
latest trusted version, and fetches the actual public state through the
existing `get-game-state` Edge Function. Equal and older signals are ignored,
bursts are coalesced, and successful `game-action` responses advance the
trusted version immediately so the acting player's matching self-event is
discarded. Reconnection performs one trusted catch-up read. There is no HTTP
polling; **Refresh Game** remains the manual fallback when live sync is
unavailable.

Room subscriptions are established before the initial room read and are
removed on room changes or route exit. This lets the version `0 -> 1` Start
transition move every subscribed member from the lobby to the active game
automatically.

### Safe Realtime lobby synchronization

```text
trusted lobby mutation -> rooms / room_players -> private version bump
  -> room_lobby_updates -> Supabase Realtime -> browser version signal
  -> existing RLS-protected getLobby() -> refreshed lobby
```

Realtime does not transport the player roster or canonical game state. The
published `room_lobby_updates` row contains only room ID, room code, a
monotonic lobby version, and its timestamp. Authenticated members can select
the signal row through RLS but cannot write it. `rooms`, `room_players`, and
`room_states` remain outside the Realtime publication.

The lobby and game channels are separate version signals. While a lobby is
visible, the UI reports healthy live synchronization only when both channels
are live: lobby signals refresh joins, leaves, display names, colors, Ready,
host transfer, and status through `getLobby()`, while the game signal detects
Start. Once an active GameView is rendered, lobby sync is removed and only
game synchronization drives the active indicator.

Fetches are single-flight. Each lobby fetch captures the highest signal
version known when it begins and marks only that captured version handled. A
newer signal received in flight therefore causes one catch-up fetch. A
connection gap similarly causes one trusted catch-up after recovery. There is
no polling, and manual **Refresh** remains available if Realtime is down.
Milestone 11 adds server-authoritative AI participants on top of this generic
synchronized-lobby foundation.

## Multiplayer AI players

Authenticated humans remain `room_players`. AI participants are separate
`public.room_ai_players` rows with stable server-generated UUIDs, a room-local
`bot_number`, color, strategy, and eventual `turn_order`. They have no
`auth.users` record, JWT, or fake human membership.

```text
host -> manage-ai-player -> service-only AI-player RPC
     -> room_ai_players -> room_lobby_updates signal -> getLobby()
```

Only the human host can add or remove AI players or change an AI player's
server-validated color and strategy. Adding an AI selects the smallest unused
bot number and first available supported color while holding the room lock.
Human joins use the same lock and enforce capacity across humans plus AIs.
Bots never become host, and the lobby is abandoned when its last human leaves.

At Start, humans are ordered by `joined_at`, then `user_id`; AI players follow
in `bot_number` order. That exact trusted roster is passed to the existing
Worship Me! `createGame()` and persisted as `turn_order`, so the first human
maps to `p1` and AI players occupy the remaining engine IDs in stable order.

```text
browser scheduler -> advance-ai({ roomCode })
  -> verified human membership -> canonical AI strategy + RNG
  -> existing AI policy and reducer -> commit_ai_action_server CAS
  -> room_states version increment -> room_game_updates signal
  -> allowlisted public GameView
```

The browser may request host-authorized AI lobby configuration, but it never
chooses an active AI action, pending-resolution answer, RNG value, or canonical
state. Each AI decision is committed
separately against an expected canonical version, so concurrent schedulers
cannot overwrite one another. Realtime remains notification-only;
`room_ai_players` and `room_states` are not published. Meaningful AI add,
remove, color, and strategy changes bump the existing safe lobby signal.

Worship Me! retains its own rules contract, state schema, actions, validation,
resolution queue, production and victory behavior, save schema, AI strategies,
art assets, and UI. Future games should add sibling modules rather than extend
or parameterize a universal Worship Me! reducer.

## Optional room names

`rooms.room_name` is nullable cosmetic platform metadata. The room code remains
the unique room identifier and the sole direct-join key; names are non-unique,
are never authorization, and are never copied into canonical Worship Me!
`GameState`.

Only the current human host may set, change, or clear a room name, and only
while the room is a lobby. The browser sends the request through the existing
`manage-lobby` Edge Function; the verified user ID is passed to the
service-role-only `set_room_name_server` RPC, which locks and revalidates the
room before changing only `rooms.room_name`. A real change advances the M10
lobby version so members refetch the trusted lobby view; an exact no-op does
not write or signal.

Public-directory rows may expose the optional name, but remain subject to the
existing current-host freshness requirement and every other eligibility rule.
Code-only rooms remain absent from the directory even when named. Naming does
not touch `room_players.last_seen_at`, so lobby presence stays independent.
The name is preserved when the game starts and when a finished game returns to
the lobby for a rematch.

## Persistent room chat

Room chat is an independent, room-scoped stream available to authenticated
human members while a room is in `lobby` or `active` status:

```text
browser { roomCode, messageText } -> send-chat-message Edge Function
  -> verified JWT -> service-only send_room_chat_message_server
  -> membership/status validation + server-derived display name + rate limit
  -> room_chat_messages INSERT -> Supabase Realtime INSERT event
```

Messages contain only intrinsically public chat data: a generated message ID,
room ID, sender display-name snapshot, plain message text, and server time.
They never store or publish an Auth user ID, canonical `GameState`, game-state
version, presence information, or authorization state. RLS permits only current
room members to read a room's history; browsers cannot insert or mutate rows.
The private per-user rate-limit table is service-only and is not published.

The browser subscribes before loading the latest 100 rows, buffers and
deduplicates startup overlap by message ID, and keeps at most 200 messages in
memory. A connection gap schedules one trusted history catch-up; it does not
poll. Chat stays mounted across lobby, active play, game over, and Return to
Lobby, and it is removed immediately when the route or membership is left.
M9 game-state and M10 lobby-version synchronization remain separate from chat.
