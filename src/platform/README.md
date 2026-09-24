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
migration is not applied by the browser. NGS Play now includes identity, an
active-games catalog, the existing trusted Create Room command, and a read-only
lobby. Subscriptions and gameplay commands remain future work.

## Player journey and hosting

```text
Squarespace: newgamestudios.com (public studio/marketing site)
  -> PLAY
Hostinger: play.newgamestudios.com (static NGS Play Vite app)
  -> NGS identity -> Games -> Worship Me! -> Host
  -> trusted Create Room -> Lobby
  -> future trusted Start Game -> Worship Me! network game
```

GitHub remains source of truth. Supabase supplies Auth, database, Edge
Functions, and safe game-version Realtime. `ngsllc-dev` is the current development
backend. Until `ngsllc-prod` exists, `play.newgamestudios.com` is an unlinked
development/test deployment.

The browser routes are `/`, `/games`, `/games/worship-me`, and `/room/:code`.
The `ngs.playerDisplayName` value is local UI/profile convenience only.
Anonymous Supabase users are real authenticated users and Supabase identity is
authoritative. Catalog and lobby reads use the normal browser client and
existing RLS. Lobby reads access `rooms` and `room_players`, never
`room_states`, whose canonical state remains server-only.

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

## Trusted Join Room flow

```text
Player B with an authenticated anonymous Supabase identity
        -> room code entry
        -> join-room Edge Function
        -> verified caller identity
        -> service-only join_room_server RPC
        -> atomic room_players membership
        -> existing RLS-protected lobby reads
```

The Join screen is `/games/worship-me/join`. A room code is discovery
information, not authorization: non-members cannot browse rooms and the
browser performs no existence lookup before calling the trusted command. The
server locks the lobby row, reads the active game's authoritative
`max_players`, and prevents concurrent final-slot joins from overfilling the
room. Rejoining with the same authenticated user is idempotent; it refreshes
the validated display name and `last_seen_at` without consuming another slot.

After membership exists, existing RLS permits that user to read the room and
its `room_players`. `room_states` remains server-only. Lobby-state Realtime is
deferred; the joining player loads the lobby immediately and the host uses **Refresh
Players** to see the new member.

## Lobby lifecycle

An authenticated user may participate in at most one room whose status is
`lobby`. Explicit Leave follows this trusted path:

```text
Browser -> leave-room Edge Function -> leave_room_server
        -> remove membership -> transfer host or abandon empty lobby
```

Create and Join also perform an automatic atomic lobby transition. Each
command acquires the same transaction-level advisory lock derived from the
authenticated user ID, finds every prior lobby membership, locks all affected
room rows in ascending UUID order, departs prior lobbies, performs host
transfers, and then creates or enters the target lobby. Failure rolls back the
whole transition. This also self-heals legacy multiple-lobby memberships.

Host succession chooses the earliest remaining `joined_at`, with `user_id` as
the stable tie-breaker. An empty lobby becomes `abandoned`. Active-game
membership is intentionally outside this milestone.

Browser Back, tab closure, crashes, unload events, and local storage are not
authoritative lifecycle operations. The in-app lobby control explicitly calls
Leave. While a lobby is visible, one coordinator immediately touches trusted
lobby presence and repeats every 20 seconds, with visible-only
visibility/focus/online recovery touches and no overlapping calls. Hidden tabs
do not refresh presence. The browser sends only `roomCode`; the Edge Function
derives the user from the JWT, and the locked service RPC captures wall-clock
time after locking, monotonically updates only that member's `last_seen_at`,
then sweeps other humans stale for more than 90 seconds through the existing
departure helper. AI rows have no presence and are never swept.

The public room directory requires a fresh current human host. Consequently,
a zero-observer room may remain `lobby` with stale memberships in storage but
disappears from discovery after 90 seconds without a cron or destructive
cleanup. Code-based Join intentionally remains available; a returning member
refreshes itself before stale peers are considered. Presence writes alone do
not bump M10, while stale membership removal and host transfer do. Lobby
presence stops on Leave, Kick, Start, route exit, and non-lobby status; active
game presence takes over after Start, and lobby presence resumes after Return
to Lobby. M10 Realtime—not the heartbeat—continues to synchronize lobby state.

## Trusted player-color selection

```text
Browser -> set-player-color Edge Function -> verified JWT
        -> service-only set_player_color_server -> room lock
        -> game-color metadata validation -> unique assignment
```

Supported colors are stored per game in `public.game_player_colors`; browser
constants are presentation only. The command locks the lobby room before
checking membership or availability, and the existing partial unique index on
`(room_id, player_color)` remains defense in depth. Browser availability can
be stale without Realtime: a losing same-color race receives a safe conflict
and refreshes the lobby. Other players use **Refresh Players**.

Changing or clearing a color resets that player's future Ready state to false.
Selecting the same color is idempotent and does not reset Ready. Leaving a
lobby releases the color automatically because the membership row is removed.

## Trusted Ready state

```text
Browser -> set-player-ready Edge Function -> verified JWT
        -> service-only set_player_ready_server -> room lock
        -> member/color validation -> is_ready mutation
```

Ready is authoritative server state. Ready=true requires a valid selected game
color; Ready=false does not. Same-state commands are idempotent. The Ready and
color RPCs serialize on the same room row, and color changes or clears reset
Ready while selecting the same color preserves it. The browser sends only room
code and the desired boolean, never user identity or color authority.

Realtime remains deferred, so another member may need **Refresh Players** to
see the change. The host's local Start eligibility preview uses the current
lobby read plus Worship Me!'s authoritative engine minimum of two players, but
the trusted Start command performs its own locked validation.

## Trusted Start Game

```text
Browser { roomCode } -> start-game Edge Function -> verified JWT
  -> privileged roster snapshot + server seed -> existing createGame()
  -> service-only start_game_server -> locked snapshot revalidation
  -> turn_order assignment + room_states version 1 + room active
```

The browser supplies no roster, colors, readiness, seed, order, or GameState.
The Start RPC locks the room and atomically validates host, active game, player
limits, Ready/color state, empty canonical state, and the exact stable roster.
Stale candidates fail without partial writes, and an initialized room cannot be
started again. `room_states` retains no browser read policy or grant.

Stable lobby ordering is `joined_at`, then `user_id`; `turn_order 0` maps to
engine `p1`, `1` to `p2`, and so forth. Name Room and Start Game render only for
the host.

## Trusted active game reads

An authenticated active-room member sends only `roomCode` to the
`get-game-state` Edge Function. It verifies the JWT, calls the service-only
`get_active_game_state_server`, and passes canonical state through
`buildWorshipMePublicGameView` before responding.

Raw canonical GameState is never sent to browsers. The allowlisted public DTO
excludes face-down `hiddenKind`, `seed`, `rngState`, `removedVillageTiles`,
`newVillagerBag`, `history`, and `eventLog`. Browser roles retain no access to
`room_states`.

Persisted `turn_order` derives `viewerPlayerId` (`0` to `p1`, `1` to `p2`,
etc.), while the projection supplies canonical `currentPlayerId` and the
response supplies canonical `stateVersion`. Manual **Refresh Game** remains
available as a fallback to live synchronization.

## Trusted gameplay actions

The browser submits only `{ roomCode, expectedStateVersion, command }` to the
`game-action` Edge Function. The function verifies the JWT, reads canonical
state through the existing service-only read RPC, derives `pN` from persisted
`turn_order`, and passes the intent to the existing Worship Me! `applyAction()`
or `resolvePendingDecision()` implementation.

The resulting candidate is first checked through the browser-safe public
projection, then committed by service-only `commit_game_action_server`. That
RPC locks the room and canonical state in the established order, revalidates
membership/current player and immutable setup structure, and performs a
compare-and-swap on `state_version`. A successful action advances the version
by exactly one; stale commands return a conflict and never overwrite newer
state.

The browser never computes or submits the authoritative next state. Pending
Bless Edge and Smite choices are exposed through a narrow allowlisted public
DTO without internal queue indices.

## Safe Realtime game synchronization

```text
canonical room_states -> trusted DB mutation -> safe version-signal trigger
  -> room_game_updates -> Supabase Realtime -> browser version signal
  -> get-game-state -> allowlisted public GameView
```

Realtime never transports canonical GameState. `room_states` remains absent
from the Realtime publication and inaccessible to browser roles. The published
`room_game_updates` table carries only `room_id`, `room_code`, `state_version`,
and `updated_at`; RLS permits authenticated members to read only their rooms,
and browser roles receive no write privileges.

The room subscription starts before the initial room fetch and listens only to
UPDATE events for the normalized current room code. A signal is not rendered
as state: it prompts the existing `get-game-state` trusted read when its
version is newer than the latest trusted response. Equal/older versions are
ignored, bursts are coalesced, successful action responses suppress matching
self-events, reconnects perform a trusted catch-up, and room changes dispose
the old channel. There is no polling. **Refresh Game** remains available when
live sync is unavailable.

The `0 -> 1` Start signal automatically moves subscribed members from the
lobby to the active game. Gameplay version changes likewise refresh other
members automatically.

## Safe Realtime lobby synchronization

```text
trusted lobby mutation -> rooms / room_players -> private version bump
  -> room_lobby_updates -> Supabase Realtime -> browser version signal
  -> getLobby() -> current RLS-protected lobby snapshot
```

The lobby signal contains no roster, host ID, colors, Ready state, or game
state. `room_lobby_updates` contains only room identity, a server-incremented
version, and timestamp. RLS permits authenticated room members to read that
row; browser roles cannot write it. Neither `rooms`, `room_players`, nor
`room_states` is published.

The lobby coordinator uses the signal only to invoke the existing
`getLobby()` read. It keeps one request in flight, captures the highest signal
version when that request starts, and schedules one catch-up if a newer signal
arrives before completion. Reconnection after a gap also performs one trusted
catch-up. Route/room changes invalidate delayed reads and dispose both old
subscriptions. No polling is used.

While the lobby is shown, its compact status aggregates the separate game and
lobby channels. Automatic refresh covers joins, leaves, display-name changes,
colors, Ready, host transfer, abandonment, and activation. When the active
game is established, lobby sync is removed and the game channel alone owns
the active-game status. Manual **Refresh** remains available as a failure
fallback.

## Multiplayer AI players

Humans remain authenticated `room_players`. AI participants live in the
separate `room_ai_players` table and have no authentication identity, session,
JWT, or fake human membership. Only the human host may add or remove an AI or
change its server-validated color and strategy through `manage-ai-player`.

Adding an AI while holding the room lock assigns the smallest unused bot
number, the first available supported color, and the default Balanced
strategy. Human Join uses the same room lock and capacity is enforced across
humans plus AIs. Host succession remains human-only; the final human leaving
abandons the lobby regardless of its AI configuration.

`getLobby()` returns authenticated humans in stable join order followed by AI
participants in `bot_number` order. Meaningful AI additions, removals, color
changes, and strategy changes bump the existing M10 lobby version, so clients
refetch trusted lobby data; `room_ai_players` itself is not published through
Realtime.

At Start, humans are ordered by `joined_at`, then `user_id`, followed by AIs
ordered by `bot_number`. The shared engine creates AI players with canonical
`control: 'ai'` and `botStrategy`, while database `turn_order` matches engine
`pN` identity.

For active play, browsers may schedule `advance-ai` with `roomCode` only. The
trusted server reads canonical state, uses the existing deterministic AI
policy and canonical RNG, applies one engine decision, and commits it using
state-version compare-and-swap. A request may continue across consecutive AI
players, but every decision is a separate versioned commit. M9 synchronizes
the resulting safe public view. Browsers never select AI moves, and this path
uses neither polling nor AI-specific Realtime.

## Optional room naming

Room names are optional, non-unique display metadata. Room codes remain the
authoritative identifiers and direct-join keys. A current host may set or clear
a name only while the room is a lobby:

```text
browser setRoomName command -> manage-lobby Edge Function -> verified JWT
  -> service-only set_room_name_server -> locked host/lobby validation
  -> rooms.room_name -> M10 version signal -> trusted getLobby() refresh
```

The name is shown to room members and in eligible public-directory rows. A
named code-only room is still excluded from the directory, and a named public
room is still excluded when its current human host is stale. Naming never
updates lobby-presence timestamps and does not alter Ready state, colors, AI
configuration, kick records, or join mode. The metadata remains on the room
through Start, active play, game over, and Return to Lobby; it is not part of
canonical Worship Me! game state.
