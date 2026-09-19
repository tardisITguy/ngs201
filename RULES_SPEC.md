# Worship Me! — Queued Bless/Smite Rules

This is the authoritative rules contract for the schema-v9 queued-action engine. It supersedes the former immediate-action rules.

## Round structure

1. **Placement Phase.** In turn order, each player completes all placements before the next player. A normal turn permits two placements and at most one Smite; a player may stop early. An extra Bless earned last round adds one Bless-only placement.
2. **Resolution Phase.** Resolve the ordered queue exactly as placed. Decisions that depend on current board state are made now.
3. **Production and end of round.** Farms, Bakeries, Homes and draws resolve; Priests are created; victory is checked; round markers are cleaned up; next-round Temple effects take effect; Square refill occurs at the round boundary.

The four placement targets are Bless Tile, Bless Edge, Smite Tile, and Smite Edge. Movement is the resolution of Bless Edge, not a separately placed action.

## Placement claims

A placed tile token immediately claims that tile against all later opponents' tile placements and placements on its incident edges. A Bless Edge claims that edge against later opponents. A Smite Edge claims the edge and both endpoint tiles against later opponents. Same-player duplicate edge or tile tokens are not allowed. A Temple may be targeted only once per round.

An opposing Priest absolutely protects its tile and all incident edges from placement. Its owner may still target those areas.

## Tile resolution

- Blessing face-down land reveals its Farm, Bakery, or Home type.
- A Blessed Farm produces two Wheat per villager; a normal Farm produces one.
- A Blessed Bakery costs one Wheat per Bread; a normal Bakery costs two.
- A successful explicitly Blessed Home makes its normal contribution plus one token of the Blessing player's color.
- Smiting an empty, revealed production tile turns it face down.
- If a Smited tile has resources, exactly one Wheat or Bread is removed; when both exist, the Smiting player chooses during resolution.
- Smite never ejects a villager. A Smited production tile produces nothing that round.

## Edge resolution

A Smite Edge is an undirected physical block and is impassable in both directions for the round. A Bless Edge is directed during placement: the first selected tile is the origin and the second is the destination. At resolution, pawn and optional cargo are chosen only from that origin:

1. If the Blessing player's ordinary villager or Priest exists on the origin, move one eligible own pawn to the destination, optionally carrying one Wheat or Bread from the origin.
2. Otherwise, if a Neutral exists on the origin, move one Neutral to the destination without cargo and apply the Neutral influence rule.
3. Otherwise, an opponent-colored ordinary villager on the origin may be moved under the opponent-conversion and Neutral-cap rules.
4. Independently, one Wheat or Bread may move from origin to destination without a pawn when the Blessing player's color is already present on both endpoints.

Destination occupants never supply movement candidates or cargo. Capacity applies to pawn movement. With no legal choice, the action is a logged no-op.

## Temples

- Bless own Temple: earn one extra Bless placement next round.
- Bless opponent Temple: its owner becomes persistent first player starting next round, until replaced by a later opponent-Temple Bless.
- Smite own Temple: reverse direction starting next round.
- Smite opponent Temple: its owner loses one placement on its next Placement turn. The penalty subtracts from the normal two placements plus any earned extra Bless, is clamped at zero, and expires after that round.

All effects begin next round and competing effects follow queue order.

## Priests

At end of round, a player with three ordinary own-color villagers in their Temple converts exactly one to a Priest, at most once per round and twice per game. It moves to the Village Square if capacity permits; otherwise it remains in the Temple. Priests count as villagers/followers and persist in saves.

A Priest enhances a Farm or Bakery to its Blessed rate, without stacking with explicit Bless. A Priest does not enhance a Home and grants no Home bonus. Priest protection is described under placement claims.

## Capacity and Neutrals

Farm, Bakery, Home, and Temple capacity is four pawns. Village Square capacity is player count plus two. Resources do not use pawn capacity. At the start of the round, if at least one Village tile remains unflipped, no player-colored villager or Priest occupies the Square, and the Square has room, add at most one Neutral Villager, subject to the global Neutral cap. If all Village tiles are flipped, no Neutral Villager is added. Total Neutrals on board plus in the bag may never exceed ten.

## Victory

The game-end trigger occurs when all remaining Village tiles are face up and at least one player has three own followers—including Priests—in their own Temple. The Temple condition only triggers the end; it does not restrict who can win. Once triggered, compare every player's total on-board followers and the player with the greatest total wins. A highest-total tie remains unresolved under the existing tie rule.

## Save compatibility

Schema v9 persists directed Bless Edge origin/destination, phase, ordered queue, queue index, placement counters, claims, pending resolution decisions, persistent first player, direction effects, next-round placement penalties, extra Blesses, and structured play-by-play history. Pre-v9 saves are rejected because older saves represent Bless Edge as an unordered pair.
