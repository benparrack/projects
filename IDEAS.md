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

**Status:** Done — see `ant_colony_optimization/`. Ants build closed TSP tours over a random scatter of cities; pheromone-weighted roulette selection with evaporation and elitist reinforcement, animated per-edge, with a live convergence chart and sliders for city/ant count, α/β, evaporation rate, and speed.
**Pitch:** Visualize agents solving a real optimization problem live — e.g. ant colony optimization finding shortest paths (pheromone trails converging over iterations), or simple traffic-flow simulation on a road grid — so you watch an algorithm converge in real time.

**Why this one:** Makes an abstract optimization algorithm tangible; satisfying to watch chaotic initial exploration resolve into an efficient solution.

**What it needs when resumed:**
- Pick one problem to focus on: ant colony optimization (ACO) on a graph (e.g. shortest path or small TSP instance) is the most classic/well-documented choice.
- ACO core loop: ants probabilistically choose paths weighted by pheromone strength + heuristic (e.g. inverse distance); after each ant completes a path, deposit pheromone proportional to path quality; apply evaporation each iteration so bad paths fade.
- Visualization: render the graph/grid, animate ants moving, show pheromone trail strength as line thickness/opacity, show convergence over iterations (e.g. best-path-length-so-far chart).
- UI: iteration speed control, reset/re-randomize graph, parameter sliders (evaporation rate, pheromone weight vs heuristic weight).

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

**Status:** Done — see `game_terminal/`, deployed at https://game-terminal.onrender.com. A "game terminal" hub: Node + `ws` server, public rooms + private rooms via short codes, and a per-game plugin interface (`server/games/<name>.js` + `public/games/<name>/client.js`) so more mini-games plug in without touching core room/connection code. Four games live: shared drawing canvas, Hangman (picker sets a word, per-recipient masked views so the secret never reaches guessers), Checkers (standard American rules, mandatory capture/multi-jump/kinging, rules engine covered by a standalone unit test), and Chess. Next up per the game_terminal memory notes: a slither.io-style game, which needs a real-time tick loop rather than the turn-based model the board games use.
**Pitch:** A lightweight multiplayer experience where multiple browser tabs/players share live state — a shared drawing canvas, a tiny `.io`-style game, or a synchronized game board.

**Why this one:** The WebGL shooter (`#0`) explicitly scoped out "real" competitive multiplayer as too large solo. This is the achievable version: no anti-cheat, no ranked matchmaking, just shared live state between a handful of clients — a genuinely new category (networking/sync) versus everything else here, which is all single-player/local.

**What it needs when resumed:**
- A lightweight realtime transport (a small WebSocket server, since browser tabs can't talk to each other directly).
- An authoritative-server model (server holds true state, clients send inputs, server broadcasts updates) to avoid classic peer-to-peer desync issues.
- Keep the shared mechanic simple (drawing strokes, or basic position broadcasting) rather than full networked hit detection, which reintroduces the netcode complexity `#0` deliberately avoided.

---

## 12. Generative Art Gallery

**Status:** Done — see `generative_art_gallery/` (noise-driven flow field renderer with multiple field shapes/color strategies, seeded PRNG, curated palettes, a black hole renderer, dark-mode and animate-forever toggles). A recursive branching-fractal renderer was tried and dropped — looked worse than the flow field.
**Pitch:** A page that generates an endless stream of unique visual art pieces algorithmically — flow fields, L-systems, Perlin-noise compositions, recursive/fractal patterns — no two alike, purely from code and randomness.

**Why this one:** Distinct from the falling-sand (`#2`) and ACO (`#9`) projects — this is aesthetic output for its own sake rather than simulating a physical/optimization process. A good showcase of how much visual richness comes from a few well-chosen math primitives.

**What it needs when resumed:**
- Pick 2-3 generative techniques to start — flow fields via Perlin/simplex noise are the most reliably beautiful and least finicky to tune.
- A canvas render loop or SVG output, plus a "regenerate" button using a new random seed each time.
- Optional export (`canvas.toDataURL`) to save a piece you like.
- Color palette choice matters as much as the algorithm — deliberate palette curation beats random RGB.

---

## 13. Procedural Terrain / World Map Generator

**Status:** Stocked, not started.
**Pitch:** Generate a full fantasy-style or realistic world map from scratch — elevation via noise functions, then derived biomes, rivers, and coastlines — rendered as a colored, readable map, not just a heightmap.

**Why this one:** A different generation problem than the dungeon crawler (`#4`) — continuous terrain and biome logic instead of discrete rooms/corridors. The "rivers flow downhill to the sea" and "biome depends on elevation + moisture" rules are satisfying emergent-from-simple-rules territory, visually distinct from the other simulations on this list.

**What it needs when resumed:**
- Layered noise (Perlin/simplex at multiple octaves) for elevation.
- A second noise layer for moisture/temperature to derive biomes (desert, forest, tundra, etc. via a Whittaker-diagram-style lookup).
- River generation by tracing steepest-descent paths from high-elevation points down to the sea/lowest neighbor.
- Rendering as a colored canvas map with a legend. Stretch goal: name generation for regions/settlements.

---

## 14. Audio-Reactive Music Visualizer

**Status:** Done — see `music_visualizer/`. File upload + microphone input, three modes (frequency bars, radial spokes, particle burst), bass-driven beat detection with a flash effect, sensitivity control. Fixed a launch bug where `URL.createObjectURL()` blob URLs never resolve when the page is opened directly as a local `file://` document (opaque origin) — switched file loading to `FileReader` → data URL, which works from any origin.
**Pitch:** A visualizer that reacts live to actual audio (an uploaded file or microphone input) — bars, particles, or generative shapes pulsing/moving with the music's frequency and amplitude in real time.

**Why this one:** Complements the algorithmic sequencer (`#6`), which generates audio, with the reverse: consuming and responding to it. A genuinely different technical skill (Web Audio API's analyser/FFT data) from anything else on this list, and immediately satisfying with a song you actually like.

**What it needs when resumed:**
- Web Audio API `AnalyserNode` for real-time frequency-domain (FFT) and time-domain data from an audio source.
- A canvas render loop mapping frequency bins to visual elements (bar heights, particle sizes/colors, radial patterns).
- Two source modes: file upload (`<input type="file">` → `AudioContext.decodeAudioData`) and live microphone (`getUserMedia`).
- Start with a simple frequency-bar visualization before attempting particle systems or 3D reactive scenes.

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

**Why this one:** Distinct from the WebGL/Three.js work in `#0` — that uses a rendering engine; this builds the render pipeline itself (ray-sphere intersection math, shading, recursive reflection). A deeper, more foundational graphics exercise.

**What it needs when resumed:**
- Basic scene representation: spheres/planes with material properties (color, reflectivity, diffuse/specular).
- A camera model casting one ray per pixel through a virtual image plane.
- Ray-object intersection math (ray-sphere is simplest to start).
- A shading model (Phong/Blinn-Phong is the standard starting point) plus shadow rays cast toward each light, checking for occlusion.
- Recursive reflection rays as a stretch goal. Renders directly to a canvas pixel-by-pixel — no WebGL needed, slower but that's the whole point.

---

## 20. Terminal "Mission Control" Dashboard

**Status:** Done — see `mission_control/`. Python + Textual. Seven panels:
system stats (CPU/mem/disk/net via `psutil`, with rolling Sparkline history
for CPU/memory), weather (IP-geolocated by default, or overridden in
`config.toml`, via Open-Meteo), calendar (Google Calendar's read-only secret
iCal URL, parsed with `icalendar` + `recurring-ical-events` to expand
recurring events correctly), a Clock panel (local time plus home/Eastern
time side by side), Now Playing (Spotify Web API — shows playback from any
device including a phone, not just this computer; `p`/`n`/`b` keybindings
for play-pause/next/previous, with a device-reactivation retry since a
paused device can drop out of Spotify's "active device" session almost
immediately; a 5-track queue peek), git/project status (this repo is one
monorepo of project folders rather than one-repo-per-project, so the panel
reports overall repo status plus which folder was touched most recently),
and an "Up Next" panel that reads `TODO_FIRST.md`/`IDEAS.md` directly. Three
switchable layouts (`l` to cycle) — grid, sidebar (the preferred default),
and a scrolling single-column stack for narrow terminals. Each panel
refreshes independently via a background worker so a slow network call
never blocks the others. Setup requires a one-time OAuth script
(`spotify_auth.py`) for the Spotify integration and a Google Calendar
secret-URL paste into `config.toml` (gitignored). Further ideas brainstormed
but not yet built are tracked in `mission_control/FUTURE.md` (progress
bar/volume/device-switcher for Now Playing, a "needs attention" digest
panel, theme cycling, and more).
**Pitch:** A glanceable terminal dashboard (a TUI) showing live system stats, weather, calendar, and whatever else is useful, all in one view.

---

## 21. Webcam Hand-Tracking Paintbrush

**Status:** Done — see `hand_paintbrush/`. Watercolor-style painting driven
by webcam hand tracking rather than mouse/touch input.
**Pitch:** Paint on a canvas using hand position/gesture tracked live from
a webcam feed, rendered with a soft watercolor-style brush rather than a
hard cursor line.

**Why this one:** A different input modality than anything else in this
repo (computer-vision-driven interaction instead of mouse/keyboard/touch),
paired with a generative-art-style rendering approach rather than a literal
1:1 cursor line.

**Why this one:** A genuinely different interaction surface (terminal UI, not a browser page) from almost everything else on this list, and practical enough that Ben might actually open it daily if it's good — unlike most of the purely-for-fun entries.

**What it needs when resumed:**
- A TUI framework/library (e.g. `blessed`/`ink` for Node, or Python's `rich`/`textual`) rather than hand-rolled ANSI escape codes.
- Data sources per panel: system stats via OS calls, weather via a public API, calendar via a local `.ics` file or an API.
- A refresh loop redrawing on an interval, laid out as a grid of panels rather than one long scroll.
- Scope discipline: start with 2-3 panels that are genuinely useful daily, not a kitchen-sink dashboard nobody reads.
