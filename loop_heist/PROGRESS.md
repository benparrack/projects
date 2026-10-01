# Loop Heist — progress

Built autonomously in a `/loop`. The design is in `../game_ideas.md` #2.

## Milestones
- [x] 1. Deterministic sim core: integer math, hardcoded trig table, seeded RNG, tile world, movement/collision, doors/keys/loot/van, state hash, snapshots
- [x] 2. Clone record/replay + paradox detection (position drift and interaction-outcome mismatch → clone "lost")
- [x] 3. Guard AI: patrol/wait/investigate/search/restore, vision cones + close-range notice, suspicion → alarm, hearing (footsteps, whistle, thuds, vault), BFS pathing, guards open and re-close doors, bodies, radio check-ins
- [x] 4. Security: sweeping cameras (loopable/disable via terminal), lasers (circuit-powered, optional blink), power boxes (guard dispatched to restore), terminals, vaults
- [x] 5. Renderer + game UI: planning screen, live take, ghost paths of clones, paradox visualisation, timeline scrubber, rewind during a take
- [x] 6. Handcrafted tutorial heists (one mechanic each) + solver-verified solutions
  - done: night-shift (sneak/timing), double-act (whistle lure, 2 crew), keycard (card or lockpick — both routes tested), closed-circuit (hacker re-loops cameras for the ghost; reusable terminals), blackout (power cut → lasers off, repair guard), heavy-hands (muscle takedowns, carrying bodies, radio check-ins shown on the timeline), relay (3 crew: hacker unlocks, ghost walks the guard to the van with 3 whistles, cracker hides in the office → vault → corner; 759 winning timings)
  - grand-vault finale (4 crew: hacker keeps cameras looped, ghost whistles Nell out and hides, muscle ambushes her right after the 45s radio check and cuts laser power, cracker cracks the vault; 333 winning timings)
  - level design workflow: write a parametrised draft in `tools/drafts.mjs`, `MAXWINS=100000 EMIT=1 node tools/search.mjs <id> --all` → counts winning timings (robustness) and prints the median plan for `solutions.js`. `PARTIAL=1` treats the last drafted member's clean take as a win (build big heists one member at a time).
- [x] 7. Procedural campaign (building generator + solvability check)
  - `src/levels/procgen.js`: seeded room-grid buildings (spanning tree + extra loops, van in the left column, loot in the furthest dead-end room behind the vault door), 3 tiers (Easy: plain door, 1–2 guards; Medium: keycard + optional unlock terminal, 2–3 guards, ≤1 camera; Hard: 2–4 guards, 1–2 sweeping cameras). Guards walk local beats (home room + one linked room), never stand next to a gap.
  - `src/levels/planner.js`: dry-run watch map (per 5-tick slice, which tiles a guard/camera sees) → time-expanded BFS over (phase, tile, slice) for a solo sneaking Ghost (can hide, double back, wait) → Bot commands with absolute `{until}` ticks → verified in the real Sim. `makeJob(seed, tier)` rejects until one passes (~0.2/0.7/1.2s per job for tiers 1/2/3).
  - Menu "Contracts": Daily Job (date seed, Medium), Easy/Medium/Hard (random seed), Resume last. Contracts tracked separately (`store.contracts`); only the current contract's plan is kept.
  - Next ideas: props/cover inside rooms (desks/shelves that block sight), windows, lasers+powerbox in Hard, a "show me a way in" hint using the planner's solution.
- [x] 8. Polish: juice, audio, menus, save progress, README
  - Map layer baked to an offscreen canvas per level/zoom: checker floor, wall ambient-occlusion shadows, hatched blueprint walls, glowing wall outlines, plus a screen vignette.
  - Menu: background map blurred/dimmed via `body[data-screen]` CSS. Mute button (corner) + M key. README.md written.
  - Still worth doing later: radio-warning toast before check-ins, more audio variety (footsteps, door creaks), a planner-based hint for contracts.
- [ ] 9. Ongoing (Ben, 2026-10-01): after 7–8, keep looping — new exciting levels, new mechanics/features, and keep making it look as good as possible

## Notes
- Run tests: `npm test` (node --test, no deps).
- `src/sim/bot.js` is a scripted crew member used by tests (and later the level solver).

- Run the game: `npm start` → http://localhost:5090
- Browser testing: the Playwright MCP's Firefox can't start here (AppArmor blocks unprivileged user namespaces:
  `kernel.apparmor_restrict_unprivileged_userns = 1`). Workaround: drive playwright-core directly from a Node script
  with `MOZ_DISABLE_CONTENT_SANDBOX=1`. `window.loopHeist` exposes `screen`, `open(id)`, `store`, `input` for tests.
- Tuning log: guard alarm threshold 22 → 40 (≈1–2s of being seen), whistle radius 9 tiles (beats 7-tile sight),
  noise through walls heard at 2/3 radius. Camera alarm 24 → 30 ticks. Sneaking crew are only sensed outside a guard's cone within ½ tile (was 1.4) so takedowns from behind work; doors beat bodies on equal-distance E. `tools/trace.mjs` prints a tick-by-tick trace of a draft.

## Needs sudo
(none yet)
