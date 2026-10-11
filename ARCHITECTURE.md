# Worship Me! architecture (NGS201)

NGS201 is the source of truth for Worship Me!. It owns the deterministic game
engine, AI policies and simulations, reusable DOM renderers, standalone local
application, game artwork, rules documentation, and game-owned tests.

```text
src/
  main.ts                         standalone development entry point
  styles.css                      standalone application layout
  games/worship-me/
    engine/                       deterministic rules and state transitions
    ai/                           policies, simulation, and diagnostics
    ui/                           reusable renderers and rules content
    localApp.ts                   standalone browser composition
```

The engine is independent of the DOM, browser storage, networking, Supabase,
and NGS Play. It is deterministic for a canonical state, action, and seeded RNG
state.

NGS900 owns the player-facing platform at `play.newgamestudios.com`, including
identity, catalog, rooms, lobby, chat, Realtime, Supabase migrations and Edge
Functions, trusted command parsing, public-state projection, and deployment.
NGS900 consumes this repository through the private local-development package
`@new-game-studios/worship-me`.

The local package link used during extraction is not a production dependency
strategy. NGS900 deployment must eventually pin an immutable NGS201 package
version or repository revision.
