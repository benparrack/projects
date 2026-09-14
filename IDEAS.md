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
**Pitch:** A daily-habit page for learning something new — one random topic a
day, read in real depth rather than a one-line trivia fact.
