# Project Ideas

Backlog of self-directed project ideas. Each entry has enough context to pick back up cold in a future session.

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
- **Pointer Lock on Linux: prefer Chromium over Firefox.** Hit a real, user-confirmed bug in `3dgames/shooter/`: on this user's Firefox + X11 session, the mouse-look cursor would intermittently get "stuck" at a screen edge/corner (unable to turn further right or down) shortly after a direction reversal — consistent with known longstanding Firefox-on-Linux-X11 Pointer Lock cursor-recentering bugs, not an app bug (confirmed: the game's yaw rotation has no clamp at all, so it can't be a client-side logic issue causing that symptom). Tried and confirmed insufficient on their setup: `requestPointerLock({unadjustedMovement: true})`, pairing pointer lock with `document.documentElement.requestFullscreen()` (note: must fullscreen a common ancestor of the canvas and any sibling HUD/overlay divs, not the canvas alone — the Fullscreen API hides everything outside the fullscreen element's subtree), and clamping per-frame mouse deltas defensively. Confirmed on the same machine: **the bug does not occur in Chromium** — same page, same OS, same X11 session, Firefox-specific. Decision: this user runs this game in Chromium going forward rather than their usual default browser. The Firefox-skip-fullscreen branch (`isFirefox` check in `requestPointerLock()`) is still in the shipped code as a harmless partial mitigation, but does not fully resolve it. **For any future pointer-lock-heavy browser game, default to recommending Chromium on Linux and mention this known Firefox/X11 limitation up front**, rather than rediscovering it via multi-round bug reports.

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

**Status:** Stocked, not started.
**Pitch:** A pixel-grid physics sandbox in the style of "Sandspiel" — sand, water, fire, smoke, stone — each cell type follows a simple local update rule, and the emergent behavior (sand piling, water flowing, fire spreading/consuming) comes for free from those rules interacting.

**Why this one:** Highly visual and immediately satisfying to interact with; a good demo of emergent complexity from simple rules.

**What it needs when resumed:**
- A 2D grid (canvas-backed), updated once per frame, each cell processed bottom-to-top (or with randomized scan order to avoid directional bias).
- Per-material update rules: sand falls down/diagonally if empty below; water falls and spreads sideways; fire spreads to flammable neighbors and burns out; smoke rises and dissipates.
- Mouse/touch input to "paint" materials onto the grid, a material picker UI, adjustable brush size.
- Performance note: naive full-grid scan is fine at small resolution (e.g. 150x100 cells) rendered scaled-up; keep cell count modest to stay smooth in-browser.
- Build as an HTML/JS artifact (canvas + requestAnimationFrame loop).

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

**Status:** Stocked, not started.
**Pitch:** Randomly generate a playable dungeon (rooms, corridors, loot, enemies) each run, with real keyboard-driven movement and combat — not just a generator, an actually playable mini-game.

**Why this one:** Combines a generation algorithm (interesting on its own) with a full interactive game loop (state, input, rendering) — bigger scope than the others, good "flagship" candidate.

**What it needs when resumed:**
- Generation approach: pick one — BSP (binary space partition) room splitting, random room placement + corridor connection via minimum spanning tree, or cellular-automaton cave generation. BSP is easiest to get "proper rooms + corridors" from.
- Game state: player position/stats, tile grid (floor/wall/door), entity list (enemies, items), simple turn-based or real-time movement.
- Combat: minimal — bump-to-attack or a small stat-based resolution.
- Rendering: could be ASCII/tile-based in a canvas or styled divs; keep art simple (colored tiles/emoji) rather than sprites.
- Scope discipline: get "generate + walk around + pick up items" solid before adding combat/progression depth.

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

**Status:** Stocked, not started.
**Pitch:** Visualize agents solving a real optimization problem live — e.g. ant colony optimization finding shortest paths (pheromone trails converging over iterations), or simple traffic-flow simulation on a road grid — so you watch an algorithm converge in real time.

**Why this one:** Makes an abstract optimization algorithm tangible; satisfying to watch chaotic initial exploration resolve into an efficient solution.

**What it needs when resumed:**
- Pick one problem to focus on: ant colony optimization (ACO) on a graph (e.g. shortest path or small TSP instance) is the most classic/well-documented choice.
- ACO core loop: ants probabilistically choose paths weighted by pheromone strength + heuristic (e.g. inverse distance); after each ant completes a path, deposit pheromone proportional to path quality; apply evaporation each iteration so bad paths fade.
- Visualization: render the graph/grid, animate ants moving, show pheromone trail strength as line thickness/opacity, show convergence over iterations (e.g. best-path-length-so-far chart).
- UI: iteration speed control, reset/re-randomize graph, parameter sliders (evaporation rate, pheromone weight vs heuristic weight).
