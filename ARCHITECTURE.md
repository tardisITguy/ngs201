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
  main.ts                           current browser application composition root
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

## Browser application and persistence

`src/main.ts` is the browser composition root. It owns DOM event binding,
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

The former development-only local Undo control has been removed. A future
multiplayer undo policy, if desired, would require an explicit authorized
server command and must never rewind canonical shared state client-side.

## Game-specific responsibilities

Worship Me! retains its own rules contract, state schema, actions, validation,
resolution queue, production and victory behavior, save schema, AI strategies,
art assets, and UI. Future games should add sibling modules rather than extend
or parameterize a universal Worship Me! reducer.
