# Project Ideas

Backlog of self-directed project ideas. Each entry has enough context to pick back up cold in a future session.

**Shipped entries stay short:** once an idea is Done, its "Why this one" and "What it needs when
resumed" sections get cut — that planning context no longer matters once built, and any lasting
architecture/status detail belongs in the project's own README/FUTURE.md instead of duplicated
here. This file is read in full at the start of every session (see the root `CLAUDE.md`), so
keeping shipped entries to a one-line pointer keeps that fixed per-session cost from growing
forever as more ideas ship.

---

## 0. 3D-Rendered Games (WebGL / Three.js)

**Status:** In progress — see `3dgames/shooter/` for the first build (round-based FPS wave shooter).
**Pitch:** Browser-based 3D content (WebGL via Three.js) rather than 2D canvas/DOM — first-person or third-person games with real depth, lighting, and movement, opened as a local HTML file just like the 2D projects.

**Why this one:** Came up when discussing capability limits — genuinely achievable at solo/single-session scope for a local single-player game (movement, hitscan/raycasting, simple AI, lighting). The explicit non-goal: a real competitive multiplayer shooter (Valorant/CS-tier) is out of reach solo — that needs server-authoritative netcode, anti-cheat, and years of asset/tuning work. Scope stays to single-player, local, one arena at a time.

**What it needs when resumed (general, beyond the specific shooter build):**
- **Rendering stack:** Three.js. Use an old pre-module version (this project vendors `three@0.128.0`'s `build/three.min.js`, a plain global-attaching UMD-style script) rather than the modern ES-module-only builds — avoids `file://` CORS issues with `<script type="module">` imports so double-click-to-play keeps working with no local server, in both Firefox and Chromium.
- **FPS controls:** hand-rolled pointer-lock camera rig (yaw `Object3D` containing a pitch `Object3D` containing the `PerspectiveCamera`) rather than the `PointerLockControls` example addon — keeps it dependency-free and gives full control for combining with shooting/collision code.
- **Collision:** simple 2D (XZ-plane) circle-vs-AABB resolution against pillar/obstacle boxes, plus a straightforward bounds clamp for the arena edge — no physics engine needed at this scope.
- **Hit detection:** `THREE.Raycaster` from the camera for hitscan shooting; same raycaster reused against obstacle meshes for AI line-of-sight checks.
- **Testing approach (no Chrome extension / browser automation available this session):** `puppeteer-core` pointed at the system's already-installed Chromium binary (`/snap/bin/chromium`) works for headless scripted testing — install with `npm install puppeteer-core --no-save` in the scratchpad. Pointer lock generally won't engage in headless/automated contexts, so verify game-logic/state-machine correctness (round progression, damage, economy, purchases) via temporary `window.__debug` hooks exposing internal functions/state, exercised through `page.evaluate`; strip the hooks from the shipped file before calling it done. Movement/keyboard input can still be tested directly via simulated keypresses since it isn't gated behind pointer lock in this codebase.
- **Pointer Lock on Linux: prefer Chromium over Firefox.** Hit a real, user-confirmed bug in `3dgames/shooter/`: on this user's Firefox + X11 session, the mouse-look cursor would intermittently get "stuck" at a screen edge/corner (unable to turn further right or down) shortly after a direction reversal — consistent with known longstanding Firefox-on-Linux-X11 Pointer Lock cursor-recentering bugs, not an app bug (confirmed: the game's yaw rotation has no clamp at all, so it can't be a client-side logic issue causing that symptom). Tried and confirmed insufficient on their setup: `requestPointerLock({unadjustedMovement: true})`, pairing pointer lock with `document.documentElement.requestFullscreen()` (note: must fullscreen a common ancestor of the canvas and any sibling HUD/overlay divs, not the canvas alone — the Fullscreen API hides everything outside the fullscreen element's subtree), and clamping per-frame mouse deltas defensively. Confirmed on the same machine: **the bug does not occur in Chromium-family browsers** — same page, same OS, same X11 session, Firefox-specific. Decision: this user runs 3D shooter/pointer-lock games in **actual Google Chrome** going forward (installed after initially testing in Chromium — Chrome has worked best in practice across these games), not their usual Firefox default. The Firefox-skip-fullscreen branch (`isFirefox` check in `requestPointerLock()`) is still in the shipped code as a harmless partial mitigation, but does not fully resolve it. **For any future pointer-lock-heavy browser game, default to recommending Chrome on Linux and mention this known Firefox/X11 limitation up front**, rather than rediscovering it via multi-round bug reports.

**Possible extensions once comfortable with the stack:** third-person or top-down 3D instead of first-person, vehicle/flight physics, a small explorable 3D environment (walking sim), simple ragdoll/physics via a lightweight physics lib (e.g. cannon-es) if a project actually needs real physics response instead of hand-rolled collision.

---

## 0a. Shooter: Arena Variety (deferred from the round 2 content pass)

**Status:** Deferred — user explicitly asked to log this and come back to it later, after enemy variety / bosses / weapons / perks / sound land first.
**Pitch:** `3dgames/shooter/` currently has exactly one arena layout (fixed `PILLAR_LAYOUT` of 6 box pillars in a 44x44 walled square). Add variety:
- 2-3 alternate pillar/cover layouts, picked randomly per new game (or rotated every N rounds) instead of the single hardcoded `PILLAR_LAYOUT`.
- Possibly environmental hazards (a shootable explosive barrel that damages nearby enemies, a hazard floor zone) as a stretch goal once basic layout variety works.

**What it needs when resumed:** generalize `PILLAR_LAYOUT` into an array of layouts (`ARENA_LAYOUTS`), pick one in `resetGame()`/on new game start, rebuild the `pillars`/`pillarMeshes` arrays from the chosen layout instead of the module-level constant (currently pillars are built once at load time from a single hardcoded layout — needs to become rebuildable). Keep spawn points and arena bounds layout-agnostic (they already don't depend on pillar positions) or make them layout-specific too if a layout wants to change spawn geometry.

---

## 1. Toy Language + Interpreter

**Status:** Stocked, not started.
**Pitch:** Design a small original programming language (variables, arithmetic, if/else, loops, functions, maybe closures) and build a complete interpreter for it from scratch. Not visual/interactive by default — it's a correctness-and-design exercise, not a demo.

**Why this one:** Self-contained (no external APIs, nothing that needs a browser to verify), and it's a real test of whether coherent system design + correctness discipline holds up over a full pipeline, rather than just gluing together calls to other tools/APIs.

**What it needs when resumed:**
- **Pipeline stages:**
  1. *Lexer* — raw source text → token stream (identifiers, numbers, operators, keywords, punctuation).
  2. *Parser* — tokens → AST (recursive descent is simplest to hand-write; needs an operator-precedence/Pratt parser for expressions with correct precedence and associativity).
  3. *Evaluator* — either a tree-walking interpreter (simpler, slower) or compile the AST to a small bytecode + stack-based VM (more impressive, more work). Start tree-walking, note bytecode VM as a stretch goal.
- **Language design decisions to make up front:** static vs dynamic typing (dynamic is much less work), scoping rules (lexical scoping with an environment chain is standard), error handling model (exceptions vs result values), whether functions are first-class/support closures.
- **Test strategy:** write the test suite *before or alongside* the interpreter — example programs with expected output, plus edge cases: variable shadowing, undefined-variable errors, loop termination, recursion depth, integer overflow/float behavior, string escaping.
- **Suggested scope for a first pass:** arithmetic + variables + print + if/else + while loops + functions. Skip classes/modules/imports — treat those as stretch goals if the core is solid and fun to keep extending.
- **Reference concepts worth knowing:** recursive descent parsing, Pratt parsing (precedence climbing) for expressions, environment/closure representation (linked scope objects), the "Crafting Interpreters" book (Bob Nystrom) as the canonical free reference for exactly this project (tree-walking interpreter in part 1, bytecode VM in part 2).

**Possible extensions once core works:** a REPL, a bytecode VM version for speed comparison against the tree-walker, basic type checking, a small standard library (arrays, strings, maps).

---

## 2. Falling-Sand / Cellular Automaton Playground

**Status:** Done — see `physics_sandbox/` (sand, water, stone, wood, fire, smoke, paint-to-place UI).
**Pitch:** A pixel-grid physics sandbox in the style of "Sandspiel" — sand, water, fire, smoke, stone — each cell type follows a simple local update rule, and the emergent behavior (sand piling, water flowing, fire spreading/consuming) comes for free from those rules interacting.

---

## 3. Boids / Flocking + Predator-Prey Ecosystem

**Status:** Stocked, not started.
**Pitch:** Agents on a canvas following simple local rules (separation, alignment, cohesion — classic Reynolds boids) that produce emergent flocking; extend with predator/prey roles and energy/reproduction for an evolving mini-ecosystem.

**Why this one:** Emergent behavior from simple math is inherently fun to watch and tune live; parameters are few enough to expose as sliders.

**What it needs when resumed:**
- Core boids algorithm: each agent steers based on nearby neighbors' average position (cohesion), average heading (alignment), and avoidance of crowding (separation) — three weighted vectors summed each frame.
- Spatial partitioning (grid buckets) if agent count gets large, to avoid O(n²) neighbor checks.
- Predator-prey extension: predators seek nearest prey, prey flee nearest predator, add energy/hunger and simple reproduction to get population dynamics over time.
- UI: sliders for rule weights, agent counts, speed; canvas render loop.

---

## 4. Procedural Dungeon Crawler

**Status:** Done — see `dungeon_crawler/` (BSP room/corridor generation, enemies, items, combat, line-of-sight/visibility, leveling). Predates the IDEAS.md tracking convention (came in with the repo's initial commit), so it went unlogged until now.
**Pitch:** Randomly generate a playable dungeon (rooms, corridors, loot, enemies) each run, with real keyboard-driven movement and combat — not just a generator, an actually playable mini-game.

---

## 5. Playable Chess/Checkers Engine with AI Opponent

**Status:** Stocked, not started.
**Pitch:** A real board game (chess or checkers — checkers is much less work) playable against an AI, using minimax with alpha-beta pruning and a hand-tuned evaluation function.

**Why this one:** Satisfying because the opponent's strength is tunable and visibly "smarter" as search depth/eval improves; classic, well-understood algorithm to implement correctly.

**What it needs when resumed:**
- Board representation + legal move generation (chess move generation, esp. special rules — castling, en passant, promotion — is the hard/tedious part; checkers is far simpler and a safer scope choice).
- Minimax + alpha-beta pruning search, with a depth limit tuned for in-browser response time (JS, no heavy compute available).
- Evaluation function: material count at minimum, positional heuristics (center control, king safety, piece mobility) as refinement.
- UI: clickable board, legal-move highlighting, move history.
- Recommend starting with checkers to get the full pipeline (rules + search + UI) working, then porting the search/UI pattern to chess if desired.

---

## 6. Algorithmic Music Sequencer

**Status:** Stocked, not started.
**Pitch:** Procedurally generate melodies/rhythms (via Markov chains, L-systems, or basic music-theory rules — scales, chord progressions) and play them live using the Web Audio API in-browser.

**Why this one:** Different sensory channel than everything else on this list (audio, not visuals) — genuinely novel test of capability, and satisfying to hear something coherent come out of generative rules.

**What it needs when resumed:**
- Web Audio API basics: oscillators/synths for tone generation, a scheduler loop for timing notes accurately (naive `setTimeout` drifts — use the standard "lookahead scheduler" pattern for Web Audio timing).
- Generation approach: pick a scale/key, generate a chord progression (simple diatonic rules), generate melody notes constrained to the current chord/scale, generate rhythm (fixed grid or weighted note-duration choices).
- UI: play/stop, tempo control, maybe key/mood selection (major = happy, minor = somber, etc.), visual indicator of the currently playing note/beat.
- Keep first version simple (single melodic voice + basic drum pulse) before layering harmony/multiple instruments.

---

## 7. Puzzle Generator + Solver Pair (Sudoku or Nonograms)

**Status:** Stocked, not started.
**Pitch:** Generate puzzles (Sudoku or nonograms/picross) that are guaranteed to have a unique solution, rate their difficulty, implement a solver, and wrap both in a playable UI.

**Why this one:** Generation is often the harder and less obvious half (most people only ever build solvers) — interesting algorithmic contrast, and the result is directly playable/useful.

**What it needs when resumed:**
- Solver first (needed to validate generated puzzles anyway): backtracking + constraint propagation (Sudoku: naked/hidden singles before brute-force backtracking, for speed and to help estimate difficulty).
- Generator: start from a complete solved grid (randomized fill via backtracking), then remove clues one at a time, checking after each removal that the solver still finds a *unique* solution (stop removing when removal would allow multiple solutions).
- Difficulty rating: correlate with how much the solver needed brute-force backtracking vs simple logical deduction, and/or number of clues remaining.
- UI: playable grid, input validation, hint/check button, difficulty selector at generation time.

---

## 8. Tiny Search Engine Over a Real Corpus

**Status:** Stocked, not started.
**Pitch:** Fetch a small set of real pages/documents, build an inverted index, implement ranking (TF-IDF or BM25), and wrap it in a search box UI — a minimal but real version of how search engines work.

**Why this one:** Exercises real tool use (fetching live data) rather than a closed sandbox, plus a classic algorithm (ranked retrieval) that's easy to get working but has real depth to get right (tokenization, stopwords, ranking tuning).

**What it needs when resumed:**
- Corpus acquisition: fetch a bounded set of pages (WebFetch/WebSearch tools) on a chosen topic — needs to be small enough to index by hand (tens to low hundreds of docs), not a real crawler.
- Indexing: tokenize + normalize (lowercase, strip punctuation, maybe stem), build an inverted index (term → list of docs + term frequency).
- Ranking: TF-IDF (term frequency × inverse document frequency) is the simple baseline; BM25 is a stretch goal and generally ranks better.
- UI: search box, ranked results list with snippets/highlighting of matched terms.
- Note: since the corpus is static once fetched, this is really "build a search index for a frozen dataset" rather than a live crawler — fine for a demo, worth being explicit about the scope limit.

---

## 9. City/Ant-Colony Optimization Visualizer

**Status:** Done — see `ant_colony_optimization/`.
**Pitch:** Visualize agents solving a real optimization problem live — e.g. ant colony optimization finding shortest paths (pheromone trails converging over iterations), or simple traffic-flow simulation on a road grid — so you watch an algorithm converge in real time.

---

## 10. Text Adventure with LLM Dungeon Master

**Status:** Stocked, not started.
**Pitch:** A choose-your-own-path text adventure where an LLM acts as a live dungeon master, reacting to arbitrary free-text player input instead of a fixed branching-tree script — genuinely open-ended interaction.

**Why this one:** Different kind of "coolest thing" than the algorithmic projects on this list — uses an LLM as the actual game engine/narrator at runtime rather than only using AI to help write code beforehand.

**What it needs when resumed:**
- Persistent world/game state (inventory, location, NPC status) that the LLM must respect each turn, rather than trusting model memory alone across a long session.
- A system prompt establishing tone/rules and hard constraints (e.g. can't just narrate the player winning outright, must ask before major state changes).
- A tracked state object updated after each turn (parsed from structured output or via tool-calling) to keep the world consistent over many turns.
- UI: a simple HTML chat-style artifact, or even a terminal input loop, works fine — the interesting part is the state/prompt design, not the interface.

---

## 11. Real-Time Multiplayer Shared Canvas / Mini Game

**Status:** Done — see `game_terminal/README.md` and `game_terminal/FUTURE.md`, deployed at https://game-terminal.onrender.com. Seven games live: drawing, Hangman, Checkers, Chess, Slither, Connect 4, Arena Duel (1v1 3D shooter, ported from `3dgames/shooter/` — see idea #0).
**Pitch:** A lightweight multiplayer experience where multiple browser tabs/players share live state — a shared drawing canvas, a tiny `.io`-style game, or a synchronized game board.

---

## 12. Generative Art Gallery

**Status:** Done — see `generative_art_gallery/`.
**Pitch:** A page that generates an endless stream of unique visual art pieces algorithmically — flow fields, L-systems, Perlin-noise compositions, recursive/fractal patterns — no two alike, purely from code and randomness.

---

## 13. Procedural Terrain / World Map Generator

**Status:** Done — see `terrain_generator/`. Layered Perlin fbm for elevation (with a radial island mask) and moisture, latitude+elevation-derived temperature, a Whittaker-style biome lookup (14 biomes), steepest-descent rivers to the coast, and procedurally-named settlements biased toward coasts/riverbanks. Seed + sliders (sea level, island strength, moisture, river count) fully reproducible per seed.
**Pitch:** Generate a full fantasy-style or realistic world map from scratch — elevation via noise functions, then derived biomes, rivers, and coastlines — rendered as a colored, readable map, not just a heightmap.

---

## 14. Audio-Reactive Music Visualizer

**Status:** Done — see `music_visualizer/`.
**Pitch:** A visualizer that reacts live to actual audio (an uploaded file or microphone input) — bars, particles, or generative shapes pulsing/moving with the music's frequency and amplitude in real time.

---

## 15. ASCII / Terminal Art Renderer

**Status:** Stocked, not started.
**Pitch:** Convert images (or a live 3D scene) into ASCII art — mapping pixel brightness to character density, optionally in color.

**Why this one:** Small and self-contained, with the specific charm of an old technique that still looks great — a different medium from every canvas/WebGL project here despite reusing similar image-processing fundamentals.

**What it needs when resumed:**
- Sample an image (or a render-to-canvas snapshot of a 3D scene) at low resolution.
- Map per-pixel brightness to a character ramp (sparse `.` to dense `@`/`#`).
- Optional color via terminal ANSI codes (real terminal target) or styled `<span>` colors (web page mimicking a terminal).
- Stretch goal: animate a live webcam feed or a rotating 3D object as continuously updating ASCII frames.

---

## 16. Multi-Agent Debate Simulator

**Status:** Stocked, not started.
**Pitch:** Spin up multiple distinct AI personas with assigned positions/personalities and let them argue a topic back and forth, producing a real multi-turn debate transcript.

**Why this one:** A different kind of "AI as content" project than the dungeon-master text adventure (`#10`) — this is about orchestrating multiple model calls with distinct roles and managing turn-taking/context between them, not one persistent single-agent conversation.

**What it needs when resumed:**
- Distinct system prompts per persona (position, tone, argument style), each fed the same running transcript so every turn sees prior turns.
- A turn-taking loop (fixed rounds, or a moderator persona deciding when the debate concludes).
- A simple UI to pick the topic and personas and watch turns stream in.
- Guardrails so personas maintain their assigned position rather than converging/agreeing or dissolving into repetition.

---

## 17. Codebase History Storyteller

**Status:** Stocked, not started.
**Pitch:** Walk a repo's git history and turn it into a readable narrative — how the project evolved, what changed and roughly why, major turning points — rather than a raw `git log`.

**Why this one:** A genuinely different use of AI-as-tool than any code-generation project: summarization and synthesis over structured historical data (commits/diffs), applied to a codebase you actually have.

**What it needs when resumed:**
- Walk `git log` with diffs for a target repo, chunked since a large history won't fit one pass.
- Summarize eras/phases rather than every single commit — group by time window or by detecting shifts in what files get touched.
- Output as a written narrative or a simple visual timeline.
- Works best on a repo with real history — a good candidate once one of the projects here has enough commits to be interesting.

---

## 18. Personal "On This Day" Memory App

**Status:** Stocked, not started — needs a look at what local data actually exists before this is more than a pitch.
**Pitch:** Surface old photos, notes, or commits from exactly N years/months ago today, pulled from your own local data — a nostalgia feed that doesn't need manual curation.

**Why this one:** A rare "useful to Ben specifically" entry on this otherwise build-for-fun list.

**What it needs when resumed:**
- An inventory pass of what dated personal data actually exists locally (photo directories with EXIF dates, notes with timestamps, commit history) before designing anything further.
- A scheduled or on-demand check comparing today's date against historical items.
- A simple display — a terminal digest, a small local web page, or a scheduled notification would all work.

---

## 19. Raytracer From Scratch

**Status:** Done — see `raytracer/`.
**Pitch:** A from-scratch raytracer — rays cast per-pixel into a 3D scene, intersecting spheres/planes, with real lighting, shadows, and reflections.

---

## 20. Terminal "Mission Control" Dashboard

**Status:** Done — see `mission_control/README.md` and `mission_control/FUTURE.md`.
**Pitch:** A glanceable terminal dashboard (a TUI) showing live system stats, weather, calendar, and whatever else is useful, all in one view.

---

## 21. Webcam Hand-Tracking Paintbrush

**Status:** Done — see `hand_paintbrush/`.
**Pitch:** Paint on a canvas using hand position/gesture tracked live from
a webcam feed, rendered with a soft watercolor-style brush rather than a
hard cursor line.

---

## 22. Daily Learning (Random Topic Deep-Dive)

**Status:** Done — see `daily_learning/`. Fetches a random Wikipedia article
each day (validated non-disambiguation, filtered for stub-length extracts),
shows the full plain-text article with section headings restored, and caches
it in `localStorage` so revisits show the same topic until you ask for a new
one. Tracks a per-day history log and a consecutive-day streak counter.
2026-09-27: topics now come from a hand-curated pool (`topics.js`, ~276
articles across 12 subjects: Money, Mind, Health, How Things Work, Thinking
Tools, History, Space & Physics, Life & Nature, Earth & Climate, Philosophy,
Food Science, Tech), each with a "why it's worth knowing" line, and unseen
topics are preferred. This replaced the random/`incategory:` picks, which
kept landing on junk like film stubs or "Biography". Custom subjects search
Featured/Good articles only. The page was also restyled (editorial serif
reading view, light/dark, TOC, reading time, reroll-within-subject).
**Pitch:** A daily-habit page for learning something new — one random topic a
day, read in real depth rather than a one-line trivia fact.

---

## 23. Roguelike Deckbuilder

**Status:** Stocked, not started.
**Pitch:** Slay the Spire–style single-player card combat — build up a deck over the course of a run, fighting a sequence of enemies with escalating difficulty, ending in a boss.

**Why this one:** A genuinely new genre for this repo — nothing here is card/strategy-based yet. Strategy depth comes from a small, tight rule set (card costs, energy per turn, status effects) rather than raw content volume, so it stays scoped.

**What it needs when resumed:**
- Card data model: cost, effect(s), targeting (self/single enemy/all enemies).
- Turn/energy system: fixed energy per turn, cards played from hand until energy runs out, hand refills each turn.
- Simple enemy AI: telegraphed intents shown before they act (genre convention — e.g. "will attack for 8" shown a turn ahead) rather than hidden logic.
- Run structure: a branching map with node types (fight, elite fight, shop, rest/heal), ending in a boss node.
- Starting scope: a small hand-balanced card pool (~20-30 cards) before considering any procedural card generation.

---

## 24. Tower Defense

**Status:** Stocked, not started.
**Pitch:** Waves of enemies follow a path; place and upgrade towers along it to stop them before they reach the end. Classic escalating-numbers game loop.

**Why this one:** A different core loop than anything else here — economy/placement decisions plus real-time wave pacing — and naturally satisfying: visible upgrade payoff, and a difficulty curve that's easy to tune via wave composition alone.

**What it needs when resumed:**
- Grid- or path-based tower placement.
- Tower stats: targeting rule, range, damage, upgrade tiers.
- Wave spawner with escalating composition (more enemies, tougher types, eventually bosses).
- Enemy pathfinding: a fixed path is fine for v1; A* only needed later if towers can block/reroute paths.
- Currency earned from kills to fund new towers/upgrades.

---

## 25. Voxel Mini-Builder (Minecraft-lite, single chunk)

**Status:** Stocked, not started.
**Pitch:** A small explorable/buildable voxel world — walk around, place/break blocks — scoped to a single chunk (not infinite terrain) to stay achievable.

**Why this one:** A distinct WebGL exercise from the existing `raytracer/` (rasterization + meshing instead of ray-per-pixel) and `3dgames/shooter/` (building/exploration instead of combat). Also a good sandbox for a later survival/crafting extension if it turns out to be fun.

**What it needs when resumed:**
- Three.js, reusing the vendored pre-module build from `3dgames/` (see idea #0's stack notes) so `file://` double-click-to-play keeps working.
- A chunk data structure: a 3D typed array of block IDs.
- Greedy meshing or at minimum naive per-cube-face culling to keep triangle count sane.
- Raycast-based block placement/removal from the camera.
- The same hand-rolled pointer-lock camera rig already proven in `3dgames/shooter/` for first-person look — see idea #0's Firefox/X11 pointer-lock caveat (default to Chrome for testing).

---

## 26. Idle/Incremental Game

**Status:** Done — `cosmic_forge/`. A cosmic-growth theme (Spark → Dust → Protostars → Stars → Solar Systems → Galaxies → Superclusters → Cosmic Web) with a narratively-justified prestige reset ("The Big Collapse" / Big Bang), 7 gated generator tiers, a thin secondary Matter currency spent on permanent Monuments, timed random events (Solar Flare/Meteor Shower/Supernova/Wormhole), achievements, and a tier-synced animated canvas backdrop.
**Pitch:** A clicker that automates itself over time — manual actions early on, automation/upgrades take over, exponential number growth, with a prestige/reset mechanic for meta-progression.

**Why this one:** Deceptively deep design space in balancing growth curves and pacing, for comparatively little rendering work — mostly numbers, timers, and a shop UI.

**What it needs when resumed:**
- Core resource loop: manual click generates a resource; purchasable generators/automators produce it passively over time.
- Exponential cost scaling for upgrades (standard idle-game formula: `cost = base * growth_rate^owned`).
- A prestige mechanic: reset progress for a permanent multiplier/bonus, creating a second, longer-term progression curve.
- Big-number handling once values exceed normal float precision (scientific notation display, or a bignum library) if growth is left unclamped.
- UI: resource counter(s), purchase buttons with live cost display; offline-progress calculation on reload is a reasonable stretch goal.

---

## 27. Rhythm Game

**Status:** Done — see `rhythm_game/` ("Pulse Catcher"). Deliberately not a lane-based Guitar Hero clone: a single free-roaming reticle (mouse/pointer, with arrow-key fallback) chases orbs that bloom anywhere across the field. Catching requires both timing *and* position. Heavy juice: particle bursts, screen shake, a synthesized combo-rising chime (no audio assets — oscillators + envelopes), floating score text, a miss-flash vignette, orb anticipation glow, combo-tier color escalation, combo-milestone callouts (10/25/50/...), and a background aura that breathes with the song's live energy via an `AnalyserNode` tap. A "3, 2, 1, Go!" countdown (synced off the real audio clock, not a timer) leads into every round, a live progress bar tracks the song, and results show a letter grade (S/A/B/C/D) plus a locally-persisted best score per track+difficulty. Judging keyed directly off `audioCtx.currentTime`, no scheduler needed. Two track sources: upload any local file (offline amplitude-envelope peak-picking + a zero-crossing-rate timbre estimate sampled from each note's sustain, not its attack transient, for bass/mid/treble color) or pick one of 6 "featured tracks" — original songs procedurally composed and synthesized entirely in Web Audio (`OfflineAudioContext`, no bundled/copyrighted audio at all) across varied genres (synthwave, chiptune, ambient, D&B, ethereal, anthem); since the composer places every note itself, difficulty there gates which instrument layers become catchable (kick only → +snare → +melody) instead of an amplitude threshold. HiDPI-aware and responsive down to phone widths, with a master volume control and an ambient animated backdrop. Full pause/resume (Escape key, on-screen button, or auto-pause on tab-blur — correctly excludes paused wall-clock time from the song clock, and can even pause mid-countdown), and touch taps now aim+catch correctly on the very first touch (a `pointerdown` with no preceding `pointermove`, which touchscreens never send, previously judged against the stale old reticle position).
**Pitch:** Notes scroll/fall in time with a track; the player hits them on beat, judged on timing accuracy (perfect/good/miss) for a score and combo.

---

## 28. Turn-Based Tactics (Into the Breach–style)

**Status:** Stocked, not started.
**Pitch:** Small grid, few units per side, every enemy action telegraphed a turn ahead — the player sees exactly what will happen before it does, making it a puzzle of positioning rather than a fog-of-war strategy game.

**Why this one:** The telegraph-everything design makes it fully solvable and satisfying at small scope — no hidden information or randomness to balance, unlike most tactics games.

**What it needs when resumed:**
- Grid representation, unit stats (HP, movement range, attack pattern).
- Enemy AI that's deterministic and revealed: each enemy turn, compute and display its intended action (target tile/unit) before the player's turn resolves, then execute it exactly as shown.
- Player turn: move + one action per unit, resolved simultaneously with enemy intents once confirmed.
- Terrain/knockback mechanics (a staple of the genre) add depth without adding hidden randomness — worth including even in a small first pass.
- UI: grid highlighting for movement/attack range, telegraph icons/arrows on threatened tiles.

---

## 29. Maze Generator + Solver Showcase

**Status:** Stocked, not started.
**Pitch:** Generate mazes with multiple algorithms (DFS backtracker, Prim's, Kruskal's) and race multiple solvers (BFS, A*, wall-follower) against each other, animated step by step.

**Why this one:** A satisfying "watch the algorithm think" visual, cousin to the ant colony optimization visualizer but for deterministic pathfinding/generation instead of stochastic convergence — good side-by-side comparison format.

**What it needs when resumed:**
- Maze representation: a grid with wall bits per cell (standard for animated generation — easy to draw incrementally).
- Generation algorithms: randomized DFS (recursive backtracker), Prim's, Kruskal's — each has a visually distinct generation pattern, which is part of the appeal.
- Solver algorithms: BFS (guaranteed shortest, level-by-level fill is visually satisfying), A* (same but directed), a simple wall-follower (visually shows why it's not always optimal).
- Animation: step through generation/solving frame by frame rather than computing instantly, with a speed slider.
- UI: pick generator + solver(s) independently, run side by side on the same maze for direct comparison.

---

## 30. Wave Function Collapse Content Generator

**Status:** Stocked, not started.
**Pitch:** Constraint-propagation procedural generation — feed it a small example (tilemap or texture), and it generates new, larger output that locally resembles the example by propagating adjacency constraints until every cell "collapses" to a single tile.

**Why this one:** A genuinely different generative technique than the Perlin-noise-based projects already shipped here (`terrain_generator/`, `generative_art_gallery/`) — constraint satisfaction instead of continuous noise fields, with its own distinct failure mode (contradictions requiring backtracking/retry) that's interesting to implement correctly.

**What it needs when resumed:**
- Input: a small hand-authored example tileset with defined adjacency rules (which tiles can be next to which, in each direction) — simplest to start with a tiny hand-built set rather than deriving rules from a sample image.
- Core algorithm: each cell starts with all tiles as possible states; repeatedly pick the lowest-entropy uncollapsed cell, collapse it to one tile, propagate the constraint to neighbors (removing now-impossible options), repeat until fully collapsed or a contradiction is hit.
- Contradiction handling: backtrack or restart when propagation leaves a cell with zero valid options.
- Visualization: render the in-progress collapse (still-uncertain cells shown as overlapping/faded possibilities) since watching it converge is most of the appeal.
- Stretch: derive adjacency rules automatically from a sample bitmap instead of hand-authoring them (the more common WFC demo format).

---

## 31. Conway's Game of Life Sandbox with Custom Rule Editor

**Status:** Stocked, not started.
**Pitch:** The standard Game of Life grid, but with an editable birth/survival ruleset (not just the default B3/S23) — change the rules and watch completely different emergent behaviors appear, from stable oscillators to total chaos.

**Why this one:** Distinct from the falling-sand automaton (`physics_sandbox/`) since the rules themselves are player-authored rather than fixed per-material — same "simple local rule, complex global behavior" appeal as boids (#3), but for a grid automaton instead of continuous agents.

**What it needs when resumed:**
- Grid simulation: standard 2D cellular automaton with wraparound or bounded edges, editable birth/survival counts (e.g. "B3/S23" notation input, or checkboxes for neighbor counts 0-8 that cause birth/survival).
- A pattern library of interesting known rulesets/starting patterns (gliders, oscillators for classic B3/S23; other rulesets like HighLife B36/S23 have their own notable patterns) to seed exploration.
- UI: click/drag to paint live cells, play/pause/step, speed control, rule editor, save/load a pattern.
- Stretch: pattern detection (recognize and highlight known stable/periodic structures), zoom/pan for large grids.

---

## 32. Match-3 with Cascade Physics

**Status:** Stocked, not started.
**Pitch:** Bejeweled-style grid — swap adjacent pieces to make lines of 3+, matched pieces clear, everything above falls to fill the gaps (potentially triggering chain-reaction cascades), with combo scoring for chains.

**Why this one:** Simple rules, but the "juice" (falling animation, particle bursts, chain multipliers) is most of what makes the genre satisfying — a good exercise in game feel/polish on top of straightforward grid logic.

**What it needs when resumed:**
- Grid + piece types, swap validation (must create a match to be a legal move), match detection (3+ in a row/column).
- Gravity/fill: after a clear, existing pieces fall to fill gaps, new pieces spawn at the top — needs to detect resulting cascades (a fall can create new matches) and keep resolving until stable.
- Combo scoring: track chain depth per cascade for escalating combo multipliers.
- Move validation: ensure the board always has at least one possible match (regenerate/shuffle if not) so the player is never stuck.
- Polish: fall animation timing, clear particle effects, combo popup text — this is genuinely where most of the "fun" lives for this genre.

---

> **Entries 33–42** came from a 2026-09-27 brainstorm of "limit-test the new model" ideas —
> each picked to stress long autonomous runs, checkable correctness, and from-scratch
> engineering while still producing something usable. Each has an objective "done when" bar.

## 33. Game Boy / NES Emulator

**Status:** Stocked, not started.
**Pitch:** A from-scratch emulator (browser/JS or Rust→WASM) that plays real ROMs — CPU, PPU (graphics), APU (audio), memory mappers/cartridge types, gamepad input, save states.

**Why this one:** Hardest pure-engineering test on the list — cycle-level accuracy where one wrong flag bit breaks everything, and public test ROMs make success objective rather than vibes-based.

**What it needs when resumed:**
- Done when: passes blargg's `cpu_instrs` (Game Boy) or matches the `nestest` log (NES); plays a homebrew/legally-owned ROM with sound.
- Pick one system first (Game Boy is smaller: SM83 CPU, simpler PPU, MBC1/3/5 mappers).
- Debug tooling early: instruction trace log diffable against reference emulator logs.
- Stretch: rewind, fast-forward, gamepad API, link-cable-over-websocket via `game_terminal`.

---

## 34. Strong Card/Board Game AI ("Hard Bot" for game_terminal)

**Status:** Stocked, not started.
**Pitch:** Replace/augment `game_terminal`'s uniform-random bots with a genuinely strong AI — ISMCTS (information-set Monte Carlo tree search) for hidden-info games like Hearts/Spades, expectimax or self-play-trained eval for Backgammon, alpha-beta for Checkers/Connect 4.

**Why this one:** Requires real algorithm design (hidden information, determinization, time budgets on a shared server tick) plus measurable tuning, and ships directly as a "PLAY VS HARD BOT" option friends actually use.

**What it needs when resumed:**
- Done when: bot win rate vs. the existing random bot is ~95%+ over a few hundred simulated games, and it's competitive against Ben.
- Headless simulation harness to pit bots against each other (reuse server game-logic modules).
- Must respect server CPU budget (Render free tier) — iteration/time cap per move, maybe a worker thread.
- See `game_terminal/FUTURE.md` for the existing `'BOT'` seat sentinel convention.

---

## 35. Netcode Upgrade: Prediction + Rollback + Lag Compensation

**Status:** Stocked, not started.
**Pitch:** Give `game_terminal`'s real-time games (Arena Duel, TRON, Slither) client-side prediction, server reconciliation, entity interpolation, and hit-scan lag compensation, plus a debug "simulate 150ms/jitter/packet loss" mode.

**Why this one:** Netcode is notoriously easy to get subtly wrong (rubber-banding, desync, favor-the-shooter edge cases); the difference is immediately felt by real players.

**What it needs when resumed:**
- Done when: at simulated 150ms RTT, local movement feels instant with no visible snap-back, and remote players move smoothly.
- Input sequence numbers + server acks; client replays unacked inputs after each authoritative snapshot.
- Deterministic shared simulation step between client and server (share the physics module).
- Server-side rewind of hitboxes for Arena Duel shots.

---

## 36. Tiny Programming Language + Browser Playground

**Status:** Stocked, not started.
**Pitch:** Lexer → parser → type checker → bytecode compiler → VM, with a web playground (editor, error squiggles, step-through debugger showing the VM stack). Optional angle: make it a scripting language for writing `game_terminal` bots.

**Why this one:** Deep, interlocking system where every stage depends on the last; a large test corpus of programs (expected output/expected error) makes correctness objective.

**What it needs when resumed:**
- Done when: a suite of ~100+ test programs pass, including closures, recursion, and type errors with good messages.
- Language design decisions up front: static vs. dynamic typing, first-class functions, structs.
- Stretch: garbage collector, REPL, compile to WASM.

---

## 37. Personal Finance Dashboard (from bank CSV exports)

**Status:** Stocked, not started.
**Pitch:** A local-only tool that ingests raw bank/credit card CSV exports, auto-categorizes transactions, detects recurring subscriptions, flags anomalies, and forecasts cash flow.

**Why this one:** Real bank CSVs are messy (inconsistent formats per bank, merchant name noise like `SQ *COFFEE 0423 SEATTLE`), so it tests robust data wrangling; and it's genuinely useful for a student budget.

**What it needs when resumed:**
- Done when: import of Ben's actual exports produces categories he agrees with ≥90% of the time, with a correction UI that learns rules.
- Per-bank CSV format adapters, dedup across overlapping exports.
- Subscription detection: same merchant, regular interval, similar amount.
- Fully local (no uploading financial data anywhere).

---

## 38. Marketplace Flip Bot

**Status:** Built 2026-09-27, `money/flip-bot/` (Stockholm: Blocket alerts + Tradera auto-buy/list/reprice, dry run by default). Needs Ben's Tradera keys, then an API verification pass (see its PROGRESS.md). Same idea as the top unbuilt pick in `money/money_ideas.md`; see that file for the canonical entry.
**Pitch:** Scan Facebook Marketplace/Craigslist for underpriced listings, estimate resale value from sold-comps, score deals, alert to phone.

**Why this one (as a model test):** Stitches together scraping, fuzzy product matching, price estimation, and alerting — plus judgment about what's actually a deal vs. a scam/broken item.

---

## 39. Claude Code Usage Analyst

**Status:** Done (2026-09-27) — `claude_usage_analyst/`, run `claude-usage`. See its README for the limit-calibration findings.
**Pitch:** Parse local Claude Code transcripts (`~/.claude/projects/**/*.jsonl`) into a dashboard: cost/tokens by project, session, and day; which sessions blew up on cache reads; tool-call patterns; actionable habit suggestions.

**Why this one:** Directly serves the token/context discipline goals in this repo's `CLAUDE.md` (cache-read tokens dominate cost), using Ben's own real data.

---

## 40. One-Prompt Complete Game (no follow-ups)

**Status:** Stocked, not started.
**Pitch:** A test of full autonomy: from a single prompt, produce a complete, polished game — e.g. a Vampire Survivors-like or a Zelda-like with 3 levels, a boss, save system, sound, title screen — with the model self-playtesting via Playwright and polishing without any steering.

**What it needs when resumed:**
- Write the prompt with an explicit "done when" checklist, then walk away; evaluate on first play.
- Afterwards ask the model to list what it'd do with 4 more hours, and check that list for honesty.

---

## 41. Jackbox-Style Phone Party Game

**Status:** Stocked, not started.
**Pitch:** TV/laptop shows a shared "host" screen; everyone joins on their phone via room code and plays 3 original party mini-games (e.g. a prompt/answer voting game, a drawing-bluff game, a quick-reaction game).

**Why this one:** Fits `game_terminal`'s multiplayer infrastructure (could live there as a new category), and it's built for actual game nights with friends.

**What it needs when resumed:**
- Two distinct client views (host screen vs. phone controller), phone-first touch UI.
- Timers, voting, scoring across rounds; audience/late-join handling.
- 3 original mini-game designs — the design quality is most of the fun.

---

## 42. Chess Engine + Measured Elo

**Status:** Stocked, not started.
**Pitch:** A from-scratch chess engine — bitboards, magic-bitboard move generation, alpha-beta with iterative deepening, transposition table, quiescence search, hand-tuned eval — with UCI support, then its strength measured by playing Stockfish at fixed skill levels.

**Why this one:** Gives a hard number for "how good did it get"; perft tests make move-gen correctness objective. Could replace `game_terminal`'s random chess bot.

**What it needs when resumed:**
- Done when: perft matches reference counts on standard positions; estimated Elo reported from a match series (e.g. via `cutechess-cli` vs. Stockfish `Skill Level` settings).
