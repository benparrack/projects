# Loop Heist

A top-down stealth heist where the whole crew is you.

Every heist runs inside one fixed time loop (60–120 seconds). You record crew members one at a
time. While you play the second, the first replays exactly what you did, and so on. Later takes
can change the world under earlier ones: open a door that was shut, lure a guard somewhere else,
cut the power. If a replay can no longer do what it did when you recorded it, it's a **paradox**:
that clone loses the plot and freezes where guards can find it.

## Play

```
npm start          # http://localhost:5090
```

No build step and no dependencies. It's plain ES modules served by a tiny Node static server.

| Key | |
|---|---|
| WASD / arrows | move |
| Shift | sneak (silent, harder to sense up close) |
| E | use / hold for timed actions (hack, pick, crack, cut power) |
| Q | role ability (Ghost: whistle) |
| Backspace | rewind the current take |
| F | fast-forward · R restart take · Esc back to plan · M mute |

### Roles
- **Ghost**: sneaks faster, whistles to lure guards.
- **Hacker**: terminals unlock doors and loop or disable cameras.
- **Cracker**: picks locks, cracks vaults.
- **Muscle**: takes guards down from behind and carries bodies. Guards radio in, though, so a
  missing guard is noticed at the next check-in.

### Content
- **10 handcrafted heists**, from one guard and one corridor up to *The Grand Vault*, a four-crew
  finale, plus encores: *The Showroom* (cover and shadows) and *Hold the Door* (a pressure plate
  that your earlier self has to stand on). Each one has a reference solution that the test suite replays.
- **Contracts**: procedurally generated buildings in Easy, Medium and Hard, plus a **Daily Job**
  (the same building for everyone each day). Every generated job is checked solvable before you
  see it (see below).

## How it works

- `src/sim/`: a deterministic integer simulation at 20 ticks/s, with no floats or `Math.random`
  in game logic. Trig comes from a fixed lookup table and randomness from a seeded RNG. Clones
  are just input recordings, which is why a replay is exact.
  - A clone is lost when it drifts more than ~¼ tile from its recorded path.
  - It is also lost when an interaction turns out differently from the recording.
- Pressure plates (`security.js`) hold a linked gate open while anyone, or anything, is on them.
  That includes a frozen clone or a dumped body. Gates can't be opened by hand, and guards wait at them.
- Guards (`guards.js`) patrol, see in cones, sense close-by crew, hear footsteps and whistles
  (more faintly through walls), investigate, search, open doors, fix cut power and do radio
  check-ins.
- `src/render/` draws everything on a canvas. `src/game/` holds the screens (plan, take, replay
  scrubber), synthesised WebAudio sound and localStorage progress.
- `src/levels/procgen.js` generates a seeded grid of rooms joined by archways. The van goes on
  the left, and the loot sits in the furthest dead-end room behind the vault door. It also
  places a keycard, terminal, guard beats and sweeping cameras.
- `src/levels/planner.js` checks that a generated job is beatable:
  1. It plays the loop with nobody inside and records which tiles are watched in each
     5-tick slice.
  2. It runs a time-expanded BFS over (phase, tile, time) for a lone sneaking Ghost, who can
     hide, double back and wait out patrols.
  3. It replays the route in the real sim, and rejects the building if that fails.

## Development

```
npm test                                   # node --test: sim, guards, security, every level, contracts
node tools/search.mjs <level> --all        # brute-force a level draft's timing parameters
node tools/trace.mjs <level> <member> ...  # tick-by-tick trace of a draft
```

To design a heist, write a parametrised draft in `tools/drafts.mjs`, then search it
(`MAXWINS=100000 EMIT=1`). The win count tells you how forgiving the heist is, and the median
plan goes into `src/levels/solutions.js`. For multi-crew heists, `PARTIAL=1` builds the plan one
member at a time.

Progress notes and the roadmap are in `PROGRESS.md`.
