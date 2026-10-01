# Game Ideas

Standalone, complex game concepts, picked so they don't repeat anything already in
`IDEAS.md`, `NEW_IDEAS.md` or the existing sub-projects. Each one has a genuinely
hard core system, not just content. Generated 2026-10-01.

**Status:** #2 Loop Heist is picked as the next build (not started yet).

---

## 1. Clockwork Manor — a procedural murder mystery that actually happens

A country house with about 10 NPCs. Each has a daily schedule, motives,
relationships and secrets. The murder is **not scripted**: the killer plans it and
carries it out inside the simulation. Each witness's memories come only from what
that NPC could actually perceive: line of sight, sound through walls, timestamps.
The player walks the house, finds physical evidence (mud on boots, a stopped
clock, a missing letter opener) and questions people. The guilty NPC lies, and so
do NPCs hiding unrelated secrets. Their lies stay consistent with each other. The
player builds a deduction board and makes an accusation.

- **Hard core:** the agent simulation, a perception model (vision plus sound
  propagation), and a lie engine that stays consistent. A solvability checker
  guarantees that every seed can be deduced from the evidence that is available.
- **Wow moment:** after the accusation, replay the whole day from the simulation
  and see exactly how it happened.
- **Optional:** an LLM voices the dialogue, but the facts and the lies underneath
  stay deterministic.

## 2. Loop Heist — plan a robbery with copies of yourself  ← NEXT

A top-down stealth heist. The player plays each crew member **one after another in
the same ~90-second loop**, and every earlier run replays alongside the current
one. Loop 1 cuts the power, then loop 2 slips past the guards it left blind, and
so on. Guards have vision cones, investigate sounds, raise alarms and react to
bodies and to open doors. If a later run changes what an earlier clone ran into
(you opened a door that clone #1 expected to be shut), the game finds the
**paradox** and that clone desyncs: it freezes or panics, shown visually, and you
fix the plan.

- **Hard core:**
  - A fully deterministic fixed-tick simulation with no float drift and no
    `Math.random` outside a seeded RNG.
  - Each clone is stored as an input recording that gets replayed.
  - Desync detection: check the replayed clone's expected state and observations
    against what actually happens.
  - Guard AI with patrols, vision cones, hearing, suspicion levels, investigation,
    alarm propagation and radio check-ins.
  - Procedural buildings with security systems: cameras, keycards, laser grids,
    vault timers, power circuits, alarm panels.
- **Design hooks:** a timeline scrubber to rewind and inspect all clones, a crew
  with distinct roles (hacker, muscle, cracker, lookout) and gadgets, scoring
  (loot vs. number of clones vs. time), and handcrafted tutorial heists followed by
  a procedural campaign.
- **Likely stack:** browser (TypeScript + Canvas/WebGL or PixiJS), standalone in
  its own folder. Test determinism with headless Node sims: replay the same inputs
  and assert identical state hashes.

## 3. Hull Breach — a starship crew sim with real physical systems

FTL meets Oxygen Not Included. Every ship tile simulates air pressure and gas mix,
heat, fire spread, and a power grid the player wires by hand. A hull breach really
vents air: crew get pulled toward it and doors slam under pressure. The player sets
crew priorities and survives procedurally generated encounters across a sector map.

- **Hard core:** a fluid and gas simulation on a grid, electrical circuits, crew AI
  with pathfinding and a job/priority system, and ship-to-ship combat.

## 4. Burn — a 2D space program

Build rockets from parts (tanks, engines, decouplers, struts) and fly them with
real orbital mechanics. Plan maneuver nodes, use gravity assists, do orbital
rendezvous, and land on moons with no atmosphere using suicide burns. Career mode
has contracts and a budget.

- **Hard core:** a rigid-body physics engine with staging, a stable orbit
  integrator (patched conics plus time warp), a maneuver planner with trajectory
  prediction, and a rocket editor.

## 5. Assembly Line — a factory automation game

Factorio-lite. Mine ore, then run it through belts, inserters, smelters and
assemblers, with recipe trees, power and trains. The goal is a megaproject such as
a rocket launch.

- **Hard core:** a deterministic tick simulation that stays fast with 10,000+
  items in motion. That needs real data structures: belts as compressed lanes with
  gap tracking, not per-item updates.

## 6. Contraption — a 2D physics vehicle and siege builder

Besiege in 2D. Build machines from beams, wheels, motors, springs, pistons and
catapult arms, with logic gates driven by key bindings. Then beat physics puzzle
levels: cross a canyon, break a castle, deliver an egg intact.

- **Hard core:** a custom constraint-based physics engine with joints, breakable
  connections and soft bodies, plus a building editor.
