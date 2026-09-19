# AI playtesting

Players can be configured as Human, Random AI, Growth AI, Temple Rush AI, or Balanced AI on the New Game screen. Browser bots pause between actions by default; the delay can be disabled in the status panel.

Bots receive only actions returned by `getLegalActions`, and every selected action is submitted to `applyAction`. Policies rank choices but do not mutate state or reproduce legality rules. Seeded selection makes runs replayable.

Run a batch with:

```bash
npm run simulate -- --games 1000 --players 4 --seed experiment-name --output results.json
```

Optional safety flags are `--max-rounds` and `--max-actions`. The command prints a summary and writes full structured results, including each reproducible game seed. To capture an action trace programmatically, call `simulateGame` with `trace: true`.
