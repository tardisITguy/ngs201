# Worship Me! game module (NGS201)

NGS201 is the source of truth for Worship Me!: its deterministic engine, AI,
reusable UI helpers, artwork, rules documentation, simulations, and game-owned
tests.

For local NGS Play development it exposes the private package
`@new-game-studios/worship-me` with these entry-point families:

- `@new-game-studios/worship-me/engine`
- `@new-game-studios/worship-me/engine/*`
- `@new-game-studios/worship-me/ai/*`
- `@new-game-studios/worship-me/ui/*`

NGS900 owns identity, catalog, rooms, lobbies, Supabase migrations and Edge
Functions, trusted transport, public projection composition, and deployment to
`play.newgamestudios.com`. The current local package link is development-only;
a deployment must use an immutable package version or pinned repository
revision.
