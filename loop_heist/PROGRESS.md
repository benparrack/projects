# Loop Heist — progress

Built autonomously in a `/loop`. The design is in `../game_ideas.md` #2.

## Milestones
- [x] 1. Deterministic sim core: integer math, hardcoded trig table, seeded RNG, tile world, movement/collision, doors/keys/loot/van, state hash, snapshots
- [x] 2. Clone record/replay + paradox detection (position drift and interaction-outcome mismatch → clone "lost")
- [x] 3. Guard AI: patrol/wait/investigate/search/restore, vision cones + close-range notice, suspicion → alarm, hearing (footsteps, whistle, thuds, vault), BFS pathing, guards open and re-close doors, bodies, radio check-ins
- [x] 4. Security: sweeping cameras (loopable/disable via terminal), lasers (circuit-powered, optional blink), power boxes (guard dispatched to restore), terminals, vaults
- [x] 5. Renderer + game UI: planning screen, live take, ghost paths of clones, paradox visualisation, timeline scrubber, rewind during a take
- [ ] 6. Handcrafted tutorial heists (one mechanic each) + solver-verified solutions
  - done: night-shift (sneak/timing), double-act (whistle lure, 2 crew), keycard (card or lockpick — both routes tested), closed-circuit (hacker re-loops cameras for the ghost; reusable terminals), blackout (power cut → lasers off, repair guard), heavy-hands (muscle takedowns, carrying bodies, radio check-ins shown on the timeline)
  - todo: a 3-crew relay, a 4-crew finale
  - level design workflow: write a parametrised draft in `tools/drafts.mjs`, `MAXWINS=100000 EMIT=1 node tools/search.mjs <id> --all` → counts winning timings (robustness) and prints the median plan for `solutions.js`
- [ ] 7. Procedural campaign (building generator + solvability check)
- [ ] 8. Polish: juice, audio, menus, save progress, README

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
