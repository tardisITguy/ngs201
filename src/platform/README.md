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
Functions, and future Realtime. `ngsllc-dev` is the current development
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
its `room_players`. `room_states` remains server-only. Realtime is deferred;
the joining player loads the lobby immediately and the host uses **Refresh
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
authoritative lifecycle operations. Stale membership is cleaned up by the
next trusted Create or Join; the in-app lobby control explicitly calls Leave.
Realtime remains deferred, so remaining users may need **Refresh Players** to
see host transfer.

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
response supplies canonical `stateVersion`. The active page is read-only and
updates only through the manual **Refresh Game** button. Gameplay mutation is
deferred to Milestone 8 and Realtime to Milestone 9.
