# Loop Heist — progress

Built autonomously in a `/loop`. The design is in `../game_ideas.md` #2.

## Milestones
- [x] 1. Deterministic sim core: integer math, hardcoded trig table, seeded RNG, tile world, movement/collision, doors/keys/loot/van, state hash, snapshots
- [x] 2. Clone record/replay + paradox detection (position drift and interaction-outcome mismatch → clone "lost")
- [x] 3. Guard AI: patrol/wait/investigate/search/restore, vision cones + close-range notice, suspicion → alarm, hearing (footsteps, whistle, thuds, vault), BFS pathing, guards open and re-close doors, bodies, radio check-ins
- [x] 4. Security: sweeping cameras (loopable/disable via terminal), lasers (circuit-powered, optional blink), power boxes (guard dispatched to restore), terminals, vaults
- [ ] 5. Renderer + game UI: planning screen, live take, ghost paths of clones, paradox visualisation, timeline scrubber, rewind during a take
- [ ] 6. Handcrafted tutorial heists (one mechanic each) + solver-verified solutions
- [ ] 7. Procedural campaign (building generator + solvability check)
- [ ] 8. Polish: juice, audio, menus, save progress, README

## Notes
- Run tests: `npm test` (node --test, no deps).
- `src/sim/bot.js` is a scripted crew member used by tests (and later the level solver).

## Needs sudo
(none yet)
