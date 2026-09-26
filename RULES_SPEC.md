# Worship Me! — Queued Bless/Smite Rules

This is the authoritative rules contract for the schema-v10 queued-action engine. It supersedes the former immediate-action rules.

## Round structure

1. **Placement Phase.** In turn order, each player completes all placements before the next player. A normal turn permits two placements and at most one Smite; a player may stop early. An extra Bless earned last round adds one Bless-only placement.
2. **Resolution Phase.** Resolve the ordered queue exactly as placed. Decisions that depend on current board state are made now.
3. **Production and end of round.** Farm/Bakery production resolves, then Home births in deterministic current-round order, then Priest creation, then the fallback Neutral check, then victory. If play continues, clean up and apply next-round effects.

The four placement targets are Bless Tile, Bless Edge, Smite Tile, and Smite Edge. Movement is the resolution of Bless Edge, not a separately placed action.

## Placement claims

A placed tile token immediately claims that tile against all later opponents' tile placements and placements on its incident edges. A Bless Edge claims that edge against later opponents. A Smite Edge claims the edge and both endpoint tiles against later opponents. Same-player duplicate edge or tile tokens are not allowed. A Temple may be targeted only once per round.

An opposing Priest absolutely protects its tile and all incident edges from placement. Its owner may still target those areas.

## Tile resolution

- Blessing face-down land reveals its Farm, Bakery, or Home type.
- A Blessed Farm produces two Wheat per villager; a normal Farm produces one.
- A Blessed Bakery costs one Wheat per Bread; a normal Bakery costs two.
- An explicit Home Bless changes mixed birth probabilities or adds a bonus Neutral when the normal birth is guaranteed; see Home production.
- Smiting an empty, revealed production tile turns it face down.
- If a Smited tile has resources, exactly one Wheat or Bread is removed; when both exist, the Smiting player chooses during resolution.
- Smite never ejects a villager. A Smited production tile produces nothing that round.

## Edge resolution

A Smite Edge is an undirected physical block and is impassable in both directions for the round. A Bless Edge is directed during placement: the first selected tile is the origin and the second is the destination. At resolution, pawn and optional cargo are chosen only from that origin:

1. If the Blessing player's ordinary villager or Priest exists on the origin, move one eligible own pawn to the destination, optionally carrying one Wheat or Bread from the origin.
2. Otherwise, if a Neutral exists on the origin, move one Neutral to the destination without cargo and apply the Neutral influence rule.
3. Otherwise, an opponent-colored ordinary villager on the origin may be moved under the opponent-conversion and Neutral-cap rules.
4. Independently, one Wheat or Bread may move from origin to destination without a pawn when the Blessing player's color is already present on both endpoints.

Destination occupants never supply movement candidates or cargo. A moved Neutral becomes the Blessing player's color. A moved opponent-colored ordinary Villager becomes Neutral if the global cap allows; otherwise it keeps its color. No replacement pawn is created or stored. Total board pawn count is unchanged by conversion. Capacity applies to pawn movement. With no legal choice, the action is a logged no-op.

## Temples

- Bless own Temple: earn one extra Bless placement next round.
- Bless opponent Temple: its owner becomes persistent first player starting next round, until replaced by a later opponent-Temple Bless.
- Smite own Temple: reverse direction starting next round.
- Smite opponent Temple: its owner loses one placement on its next Placement turn. The penalty subtracts from the normal two placements plus any earned extra Bless, is clamped at zero, and expires after that round.

All effects begin next round and competing effects follow queue order.

## Home production

A revealed Home produces only when not Smited, with exactly two pawns, at least 1 Bread, and a compatible pairing. It consumes 1 Bread only when eligible.

With no Priest, two same-color ordinary Villagers guarantee that color (including Neutral + Neutral). Two different ordinary colors produce either with 50% probability. A Priest can reproduce only with its own player color: like-color Priest + Villager or Priest + Priest guarantees that color. A Priest with an unlike color or Neutral cannot reproduce, even with a Bless, and spends no Bread. Priests do not passively Bless Homes.

For a mixed ordinary pairing with an explicit Bless, Neutral has exactly 25%. The other 75% is divided among one influence slot per non-Neutral occupant plus one slot for the Blessing player's color. Duplicate colors combine:

- Red + Yellow, Blessed Blue: 25% each Red, Yellow, Blue, Neutral.
- Red + Yellow, Blessed Red: 50% Red, 25% Yellow, 25% Neutral.
- Red + Neutral, Blessed Red: 75% Red, 25% Neutral.
- Red + Neutral, Blessed Blue: 37.5% Red, 37.5% Blue, 25% Neutral.

One canonical RNG decision selects a mixed newborn using integer tickets. Guaranteed births need no RNG decision.

If the normal result is already guaranteed, an explicit Bless preserves that newborn and additionally attempts one bonus Neutral on the producing Home, regardless of the Blessing color. This includes Neutral + Neutral and compatible Priest pairs. Opposing Priest placement protection still applies: illegal opposing Blesses cannot be placed.

The normal newborn attempts to enter Village Square under normal capacity. If Square is full, Bread stays spent and that newborn is lost; nothing is deferred. A selected Neutral at the global cap is blocked without reroll. The bonus Neutral goes on the Home and respects the Neutral cap and Home capacity; a blocked bonus is not replaced.

Homes resolve sequentially in the actual current round's player order, derived from canonical roundFirstPlayerId, turnOrder and direction. An explicit Bless assigns priority to its player; otherwise the earliest represented non-Neutral player in that order assigns priority. Unblessed Neutral-only Homes resolve last. Row, column, then cell ID break ties. Queue resolution's changing currentPlayerIndex does not affect this order.

## Priests

After Home production, a player with at least three ordinary own-color Villagers in their own Temple converts exactly one into a Priest, at most once per player per round and twice per game. The Priest always moves to Village Square, even if already full. This mandatory arrival alone may exceed normal Square capacity. Ordinary movement, newborns and fallback Neutrals do not inherit the exception.

Priests enhance Farms and Bakeries to Blessed production without stacking, and protect their tile and incident edges from opposing placement. They do not enhance Homes and reproduce only with like color. Priests count in final follower totals, but never toward the Temple game-end trigger.

## Capacity and Neutrals

Farm, Bakery, Home, and Temple capacity is four pawns. Village Square normal capacity is player count plus two. Resources do not occupy pawn capacity. The global maximum is ten Neutral Villagers physically on the board; Priests are not Neutral. Every Neutral creation respects that cap. Moving an existing Neutral creates no new pawn.

After Home births and Priest creation, before victory, add at most one fallback Neutral to Square only if all are true:

- No Home successfully added any Villager anywhere this round.
- At least one Village tile remains face down.
- Square has normal pawn capacity available.
- The Neutral cap allows it.

Successful normal newborns (colored or Neutral) and successful bonus Neutrals suppress fallback. Blocked births, Priest conversion/movement and ordinary movement do not. Colored Villagers or Priests already in Square are not independent blockers; their occupancy may fill it. There is no start-of-round refill. Face-down land created by a later Smite can restore fallback eligibility.

## Victory

All remaining Village tiles must be face up and at least one player must have three ORDINARY OWN-COLOR VILLAGERS in their own Temple. Priests do not count toward this trigger.

Priest creation happens before victory: exactly three eligible ordinary Temple Villagers become two plus a Priest in Square, so that Temple no longer triggers. Four become three and can trigger. If both Priests have already been created, three ordinary Villagers remain and can trigger.

Once triggered, compare every player's total on-board ordinary own-color Villagers plus own-color Priests. The greatest total wins; the triggering player does not automatically win. A highest-total tie remains unresolved under the existing rule.

## Save compatibility

Canonical schema v10 removes the obsolete population reservoir, its draw phase and configuration, and records roundFirstPlayerId for stable production priority. There is no bag or deferred newborn storage. Structured birth and fallback events replace the former draw history.

Schema-v9 and earlier saves/canonical states are rejected; no conversion or silent reinterpretation occurs. V10 play-by-play artifacts describe these rules and cannot be replayed with the v9 engine. Active v9 matches must be completed, abandoned/reset, or otherwise cleared before deploying the v10 engine and its matching trusted RPC checks. Deployment is not part of this change.
