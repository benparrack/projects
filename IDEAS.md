# Projects and ideas

Every project in this repo in one file: what's in progress, what's done, and the full idea backlog.
Read from the top through **Other tracked work** at the start of a session. That part is the
status overview. Everything after it is the backlog, which you grep instead of reading in full.

| Section | IDs | What's in it |
|---|---|---|
| [Up next](#up-next) | | Projects in progress and their next step |
| [Done](#done) | | Log of finished projects |
| [Other tracked work](#other-tracked-work) | | Work outside the numbered sections |
| [General backlog](#general-backlog) | #0 to #44 | The original list: games, visualizers, tools |
| [Big builds](#big-builds) | N1 to N18 | Hard single-prompt builds with an objective self-check |
| [Useful](#useful) | U1 to U15 | Things Ben would actually use day to day |
| [Games](#games) | G1 to G6 | Standalone games with a hard core system |
| [Computer vision](#computer-vision) | none | Follow-ups to the ASL project |

To look up one entry, grep its heading: `## 22.`, `## N5.`, `## U1.` or `## G2.`.

**Shipped entries stay short:** once an idea is Done, its "Why this one" and "What it needs when
resumed" sections get cut — that planning context no longer matters once built, and any lasting
architecture/status detail belongs in the project's own README/FUTURE.md instead of duplicated
here. This file is read in full at the start of every session (see the root `CLAUDE.md`), so
keeping shipped entries to a one-line pointer keeps that fixed per-session cost from growing
forever as more ideas ship.

---

# Up next

- **Rise** (`apps/rise/`, started 2026-10-15): wake-up system for morning classes. Cloudflare Worker + KV reads the class-schedule iCal (repeats supported, saved copy if the feed is down) and serves the coming morning's alarms; iOS Shortcuts set the iPhone alarm nightly with 4 backups until an "I'm up" QR in the kitchen is scanned. App: next alarm + phone-has-it check, skip/custom mornings, streak/history, night mode (sunrise fade, then morning screen with countdown, leave-by, weather), setup guide at `/#setup`. No penalty (Ben's call). Next: Ben finds his schedule feed (TimeEdit?), deploys per `apps/rise/README.md`, builds the Shortcuts from the in-app guide, does the dress rehearsal.
- **Crux** (`apps/crux/`, started 2026-10-15): climbing logbook PWA. Sessions (log each climb: tries + sent/not yet), routes with hold colour/grade/photo/beta, Projects/Sent/Archived, stats per discipline (hardest, flash rate, grade pyramid, hardest-per-session chart), JSON export. Bouldering = Font, rope = French. Live at https://benparrack.github.io/crux/ (phone, add to home screen); `apps/crux/deploy.sh` republishes the committed folder to the benparrack/crux mirror repo. Next: Ben uses it at the gym and gives feedback.
- **Backpack** (`apps/backpack/`, IDEAS #44, started 2026-10-15): homework planner that fills itself from a Canvas/Schoology iCal feed link; meant for friends to use. `npm run dev` → http://localhost:5195. Next: Ben runs `npx wrangler login && npm run deploy` in `apps/backpack/`, tries it with his real Canvas feed, shares with friends.
- **Limber** (`apps/limber/`, started 2026-10-13, built autonomously): daily stretching coach for tight hamstrings/hips/groin. Mat / couch-in-bed / quick-reset routines, guided player, 4-phase program, streaks, heatmap, range check-ins, ntfy phone reminders (systemd `limber-remind.timer`, topic in `apps/limber/reminders/config.json`). Open with the **Limber** app launcher (`apps/limber/limber-app`, Chrome app window on :5180). Next: Ben subscribes to the topic in the ntfy app, uses it for a week, gives feedback; maybe host on GitHub Pages for phone use.
- **Field Guide** (`apps/fieldguide/`, started 2026-10-13, built autonomously): point it at a project and it writes a course about the code with Claude: chapters with real excerpts, generated diagrams, design decisions, improvements, quizzes, plus an architecture map, a file explorer, a glossary and Ask-a-question. `python3 -m fieldguide build <path>`, then `python3 -m fieldguide serve` → http://127.0.0.1:8770. Guides built: claude-usage-analyst, field-guide (itself). Next: Ben reads a guide for real and gives feedback; try it on a big project (game_terminal) to check scale and cost.
- **Loop Heist** (`games/loop_heist/`, `IDEAS.md` G2, started 2026-10-01, built autonomously in a /loop): top-down stealth heist where you record each crew member in turn in the same loop alongside replays of your earlier takes (paradox detection, guard AI, cameras/lasers/power/terminals/vaults). Done so far: 10 handcrafted solver-verified heists (latest has pressure plates and gates) plus procedural "Contracts" (daily job + Easy/Medium/Hard, each checked beatable by a planner). Run `npm start` in `games/loop_heist/` → http://localhost:5090. Polish pass + README done; the loop now keeps adding levels, mechanics and visual polish. Status lives in `games/loop_heist/PROGRESS.md`.
- **Roblox studio** (`money/roblox/`): Ben wants to publish several Robux-earning Roblox games; `RESEARCH.md` has the ranked concepts. **+1 Jump Tower** and **Steal a Satellite** are both playtested in Studio over MCP, polished, with promo shots. Next, Ben does the manual steps: publish each game (Steal a Satellite with max players 8), create the passes/products and paste their ids into each `Config.luau`. **Anomaly Shift** (max players 12) and **Grow a Candy Garden** (max players 6) are also built, Studio-tested and have marketing shots, so they're ready for the same publish steps. Ore Tycoon and more come after that. Note: `tools/studio-sync.py <game>` pushes scripts into whichever place Studio has open. **Don't save that place** unless it's the same game.
- **Flip bot** (`money/flip-bot/`): built and runs in dry run. Waiting on Ben: SETUP.md steps 1–3 (ntfy app, Tradera dev keys, `flip auth`). Then a short session to verify the Tradera API details listed in `money/flip-bot/PROGRESS.md`.
- **Clip Studio** (`money/clip-studio/`, built 2026-10-01): a local ssemble-style clip editor. Run `./run.sh` and open http://localhost:5055. It now also publishes straight to YouTube Shorts, TikTok, Instagram Reels or a folder (on a schedule), and has an Autopilot mode: it watches channels → auto-clips → auto-posts into daily slots, with optional approval and ntfy pings. Next, Ben does the one-time account setup in the README (Google consent screen → In production; TikTok dev app; Instagram token), then makes real clips and reports what's clunky. To use the Claude clip finder and captions, set `ANTHROPIC_API_KEY`.
- **Trading Cockpit** (`money/trading-cockpit/`, built 2026-10-01): run `./run.sh` and open http://localhost:5070 (not 5060, which Firefox blocks). It has four parts. (1) A pre-trade check: sizing, earnings, gap and correlation flags, base rates. (2) A journal and portfolio: paper and real accounts, comparison with SPY, US tax with wash sales. (3) ntfy phone alerts: stops and targets with paper auto-exit, earnings, volume, 52-week highs, SEC insider buys, strategy signals. (4) A strategy lab: a safe rule language, a random-entry baseline and out-of-sample tests. The same day it was expanded with: broker linking (Alpaca live sync and bracket orders; CSV import from Avanza, Nordnet, IBKR or any CSV); trailing stops and scale-outs; guardrails; an after-exit tracker; a Today tab with a morning briefing push; a weekly report; an AI journal coach; news with an AI summary; a market screener; Lab upgrades (account simulation, overfitting search, compare); candlestick charts showing your trades; and a PWA phone app with a PIN. That evening it got a redesign: a dashboard Home page, Ctrl K search, a ticker quick view, light and dark themes, market clocks, and a P/L heatmap. On 2026-10-15 it gained an **Evolution** page (`g e`): 308 literature strategies plus coin-flip placebos are culled over 5 generations on 609 stocks, then sit a holdout exam. 11 finalists passed and 0/24 placebos did. On 2026-10-16 a second batch of 1,038 strategies (about 432 made up, 84 placebos) added 33 more finalists (0/84 placebos survived), and the Live trial tab got paper books vs SPY plus open-position tiles. All 44 are on a live paper trial that runs every weekday, with graduation after at least 20 days and 25 trades at z ≥ 1.65; no real orders are placed. Next, Ben links a broker (Alpaca paper keys or an Avanza CSV, see SETUP.md §4; the Alpaca code is only tested against mocked responses), subscribes to ntfy, optionally adds an Anthropic key and sets up Tailscale for the phone, then paper trades and reports friction.
- **Kalshi weather** (`money/kalshi-weather/`, built 2026-10-16): backtests Kalshi's daily high/low temperature markets (47 US series) against 9 weather models (Open-Meteo archive), NWS blend guidance (NBS, IEM) and live observations. It uses a walk-forward model + market blend, taker fees, and verdict on a holdout. Result: **MAYBE**, +1.8% ROI over 14,931 holdout trades (evening-before highs +3.0%), but −0.9% since Kalshi switched settlement to The Weather Company on ~2026-08-15, and only +0.5% if fills are 1¢ worse. Paper scan runs hourly on systemd user timer `kalshi-weather.timer` (ledger `data/paper.csv`, report `reports/latest.html`). Next: ~2026-11-16 run `./run.sh pull && ./run.sh backtest` and `./run.sh settle`; real money only if the post-switch line and the paper ledger turn positive (needs a funded Kalshi account + API keys, order placement not built).
- **Copy trader** (`money/copy-trader/`, built 2026-10-10/11, `IDEAS.md` #43): a paper-only bot that copies 13F funds, Congress PTRs and Hyperliquid top traders through one engine. It runs live on a systemd timer every 15 min. Check it with `cd money/copy-trader && .venv/bin/python copytrade.py status`; the report is `report/index.html`. Backtest verdict in its PROGRESS.md: 9 of 12 stock strategies lost to SPY, Congress included. The only rules-based winner was `13f_top3_trailing` (+236% vs +165%). The crypto window is too short to mean anything. Next: let the live results accumulate and revisit after a month or so.
- **Useful tools** (`IDEAS.md`, started 2026-10-11): **grocery-deals** (`apps/grocery_deals/`, U1, Ben's main focus) is a desktop app ("Grocery Deals" in the app menu, Chrome app window on :5077) with live ICA Kvantum Kungsholmen + Willys + Hemköp + Coop Daglivs + Lidl offers matched to his list, editable in-app (`settings.json`), a Trip tab (send to phone), price history, a Monday 08:00 ntfy push and daily 09:00 alerts for new matches. **notify-when** (`apps/notify_when/`, U14) is pinned/paused by Ben: works, timer every 10 min, only the example watch.

# Done
- **The Nowhere House** — `games/nowhere/` (2026-10-21, built autonomously, not from any idea list): a walkable non-Euclidean house in three.js. A wardrobe opens onto a huge hall, a hallway loops until you've done 4 laps, and a doorframe in the night courtyard shrinks you 10× onto the sitting-room table. Recursive portal rendering (3 deep, scissored, 60 fps on the iGPU). `./serve.sh` → :8091, or the Projects app.
- **game_terminal CASINO** — `game_terminal/` (2026-10-20, pushed): a separate CASINO menu tab with one money balance per account ($100 start, $25 daily stipend; guests get play money). It holds blackjack, high-roller blackjack, slots with a site-wide progressive jackpot, roulette, and a poker cash table. Going broke means working TERMINAL DINER shifts (a Papa's-style burger job, up to $120, 6 a day). The shop sells felts, card backs, slot skins, lucky charms and a VIP key; tiers run Bronze to Diamond; there are casino-only leaderboards. Money never shows outside the casino. Plan: `~/.claude/plans/jiggly-swinging-whale.md`.
- **Skill Wheel** — `apps/skill_wheel/` (2026-10-12): spin a wheel weekly to pick one new skill to learn. It has 48 low-setup skills, each with a full rundown and a 7-day tick-off plan. Also a library, a journey log (streak, ratings, collection) and settings; static, no build step. Open `apps/skill_wheel/index.html`. Tests: `node test.js`, plus `node e2e.mjs` (Firefox). See the README.
- **Drift** — `games/drift/` (2026-10-12): a single-file WebGL2 ambient piece. Up to 1M motion-blurred particles trace 11 attractors and flow fields, including a lensed black hole with jets, a torus and silk ribbons. Round 2 added a hold-to-gather gravity well, chime-synced light waves, a breathing mode (B), a scene gallery (G) and a parallax starfield, with stardust-dissolve transitions, HDR trails, bloom and ACES, stirring and ripples, and optional generative ambient sound. Run it with `python3 -m http.server` in `games/drift/`. See the README.
- **Stock predictor** — `money/stock-predictor/` (2026-10-01): trains a walk-forward gradient-boosting model on daily prices of volatile stocks (scan, your own tickers, or CSV) and gives BUY/WAIT/AVOID calls with stops and position sizes, plus an HTML report. A strict edge test (out-of-sample AUC p-value, quintile returns, comparison with buy-and-hold, permutation test) gates every BUY. On 60 volatile stocks it found **no edge** at 5, 10 or 20-day horizons, so today it says NO EDGE for everything. The next idea, if any: add non-price inputs (earnings, sentiment) and see whether the verdict changes.
- **Webslinger** — `games/webslinger/` — a Spider-Man-style web-swinging game in a procedural Manhattan grid, built with vendored three.js and no build step. Swing physics run at 240 Hz with an inextensible rope: you carry momentum through the arc, pump on the downswing, get a big fling on release, and hold to chain swings. It also has wall-running, zip, dash and super jumps. The city uses interior-mapped windows, metallic reflective curtain-wall glass, a Nishita sky/IBL/fog, CSM shadows, bloom, god rays and dynamic resolution. There are 7 time-of-day presets (T), three looks cycled with V (Cinematic, a Realistic look with AgX, SSAO and eye adaptation, and Comic), traffic and collectibles. Polish pass 2026-09-28: fixed NaN white-dot artifacts and rooftop z-fighting; added curtain-wall mullions, louvred mechanical floors and muted shop signage; added a springy rope catch that carries your momentum and 240 Hz render interpolation, which removes stutter at 144 Hz and similar rates. Momentum pass 2026-09-28:
  - Swing assist (Esc toggle): arc-preview anchor scoring, a heading-biased rope pivot, steering around walls, lining up with streets, and glancing-hit grazes.
  - Flow-bot results: wall hits 14→2, average speed 21→34 m/s (`tests/flow.test.mjs`).
  - Toned-down, varied glass reflections, and an eye-adaptation reset.
  - Ultra runs ~20% faster at HiDPI: staggered CSM cascades, MSAA 2× at HiDPI, no FXAA on top of MSAA.
  Features pass 2026-09-28:
  - Style combos: swings, flings, tricks, near misses, close calls, swoops and rings build a multiplier; the combo banks on landing and is lost on a bail or a fall into the river. Ranks run from Nice to Legendary.
  - Air tricks (F + direction): front flip, backflip, corkscrews and 360. Landing mid-trick is a bail.
  - 4 ring races (G, or the Esc menu) with saved bests, splits and a ghost; a heading-up minimap (M); slow-mo focus (Tab/MMB) with a lowpass; speed lines; tokens are saved between sessions.
  - Tests: `tests/style.test.mjs`.
  Targeting pass 2026-09-28:
  - A white ring previews where the web will stick. Poles are now swing points: 768 antenna, spire and new rooftop-mast tips. Looking at one near the crosshair locks the web onto it and turns the ring gold.
  - Fix, same day: swinging broke in real play. The "look up at a building picks that spot" bonus kept swinging players into walls, so it's removed. Pole locks now preview the whole arc, and rooftop masts no longer collide.
  - H pauses on the controls page.
  - Tests: `tests/aim.test.mjs`.
  Life & feel pass 2026-09-28:
  - Particles (`src/fx.js`): landing dust, web-impact puffs and chips, wall-run grit, river splash and feathers, all lit by the sky.
  - About 950 pigeons (`src/birds.js`): they sit on ledges and peck in the park, scatter when you swing past, land hard or a web hits near them, circle above the skyline, then glide home.
  - A web twang on impact and on the catch, a rope creak, camera g-force sag and wind buffet, and distant sirens.
  - Tests: `tests/birds.test.mjs`.
  Swing-feel fix 2026-09-29: holding swing (the default) only let go near the top of the arc, so you shot straight up or rocked under the anchor (14.7 m/s, 21 m in 25 s). It now auto-releases at about 47° (was 39°, felt early), or earlier when your flight would peak under the roofline: 44 m/s. The web no longer goes slack and snaps taut, the reel and release pop ease in and out, and the camera eases back out after a wall. Flow bot: 34→40 m/s. Tests: `tests/hold.test.mjs`.

  `./serve.sh` → localhost:8084. Play in Chrome because of pointer lock. Note: the vendored `CSMShader.js` carries a required patch (see README).
- **Stockholm in 3D** (`IDEAS.md` N5) — `playground/stockholm3d/` — a browser 3D explorer of central Stockholm built from open data. A Python pipeline turns the OSM extract and the Copernicus GLO-30 DEM into compact 500 m tiles (~40 MB): 0.56M-triangle buildings at real heights with procedural windows, a bare-earth heightmap, ground textures, water carved from coastline+DEM+land evidence, bridges/piers, and ~90k trees. The three.js viewer (vendored, no build step) has the real sun for any date/time (NOAA algorithm, Swedish DST, real sunrise/sunset), Rayleigh sky, shadows, stars on sidereal time, lit windows and streets at night, and seasons with snow and autumn leaves. Camera modes: map, fly, and street-level walk with wall collision. Also: search, 20 framed landmarks, click-a-building info with Wikipedia/OSM links, and a shareable URL hash. Run `./build.sh` (data is git-ignored), then `./serve.sh` → localhost:8083.
- **Game Boy / Game Boy Color Emulator** (`IDEAS.md` N18) — `games/gameboy/` — a from-scratch, M-cycle-accurate DMG+CGB emulator in vanilla JS with no build step. It passes 141/141 Blargg/Mooneye/acid2 test ROMs (`npm test`) and runs headless at ~900 fps. The standalone page (`node games/gameboy/serve.js`) has a CSS handheld shell, AudioWorklet audio, IndexedDB battery saves and 4 save-state slots, rewind, fast-forward, and gamepad/touch input. It bundles only free homebrew (9 games plus our own 2-player **Link Tron**, `games/gameboy/homebrew/linktron/`). It's also a **game_terminal** room (RETRO → GAME BOY): everyone plays locally and can WATCH each other live via lockstep replay (one gzipped save state, then only button changes; bit-exact per `test/determinism.js`), or LINK with someone for link-cable 2-player (both browsers emulate both consoles in lockstep, only inputs sent; `test/link.js`, `test/netlink.js`). Edit `games/gameboy/` and re-run `games/gameboy/tools/sync-game-terminal.sh` to update the game_terminal copy.
- **Code-Rendered Animated Short — "LANTERN"** (`IDEAS.md` N2) — `playground/animated_short/` — a wordless 2:56 sci-fi short made entirely in code. A failing probe pings into the void, finds a dead 6,000 km ring-gate around a gas giant, wakes it, and dives through to where all the other lanterns went. Picture: a raymarched GLSL world on moderngl/EGL (the RTX 4060) with bloom, ACES, a 2.39 letterbox and 6-sample AA/motion blur. Sound: a numpy/scipy synthesized score + SFX built on a two-note ping motif, cue-synced from `src/timeline.py` (single source of truth). Three self-review passes are logged in `REVIEW.md` and every decision in `DECISIONS.md`. `./make_film.sh` re-renders audio and 1080p60 video in ~8 min; the output is `playground/animated_short/output/film.mp4` (git-ignored, ~1 GB).
- **Claude Code Usage Analyst** (`IDEAS.md` #39) — `apps/claude_usage_analyst/` — `claude-usage` command (symlinked in `~/.local/bin`) opens a local stdlib-Python dashboard over all `~/.claude` transcripts: cost by project/sub-project/session/day/model, a live 5-hour-window limit tracker with burn rate + projected hit time + desktop notifications, per-session drill-downs (context growth, per-prompt cost, subagents, heaviest tool results), and an Insights page that simulates cheaper habits (earlier /compact, /clear on sub-project switch, trimming big tool outputs). Key finding: Pro limits track `output + 0.2×(input+cache writes)` tokens, not API dollars — calibrated automatically from real limit hits. Costs reconcile exactly with Claude Code's own `cost-state` totals. Limit % now comes live from the same endpoint `/usage` uses (OAuth token read per fetch, never stored/refreshed; estimate is the fallback). Auto-starts on `dev` via a SessionStart hook in `.claude/settings.local.json` (opens Firefox once a day). Next up per Ben: money/ side-income projects.
- **Idle/Incremental Game — "Cosmic Forge"** (`IDEAS.md` #26) — `games/cosmic_forge/` — grow a universe (Spark → Dust → Protostars → Stars → Solar Systems → Galaxies → Superclusters → Cosmic Web) with a tier-synced animated canvas backdrop, 7 gated generator tiers, click crits/Matter/Monuments, timed events (Solar Flare/Meteor Shower/Supernova/Wormhole), achievements, offline progress, and a narratively-justified prestige reset ("The Big Collapse") with a permanent Singularity upgrade shop. Later passes added retention systems (goals, Surge, daily streak, CrazyGames SDK adapter) and the **Void Front** combat panel: zones/bosses with affixes, 6 hotkey abilities, permanent rarity-rolled relics, and an Armory. Pacing is measured with `games/cosmic_forge/pacing_sim.js`, an in-page bot; see the README for the numbers. **Published 2026-09-27:** live on itch.io and submitted to CrazyGames (awaiting their review/QA); the listing kit, build script and preview videos are in `games/cosmic_forge/release/`.
- **Rhythm Game — "Pulse Catcher"** (`IDEAS.md` #27) — `playground/rhythm_game/` — not a lane-based Guitar Hero clone: a single mouse-driven reticle chases orbs, catching requires timing *and* position, heavy juice (particle bursts, screen shake, synthesized combo-rising chimes/milestones, miss-flash, audio-reactive aura), a synced countdown + progress bar, results with a letter grade + persisted best score, and full pause/resume (key, button, or auto on tab-blur). Play any uploaded song, or pick one of 6 original "featured tracks" procedurally composed and synthesized on the fly (Web Audio `OfflineAudioContext`, zero bundled audio/copyright concerns). Touch/mobile play verified working (tap correctly aims+catches on first touch).
- **Daily Learning** (`IDEAS.md` #22) — `apps/daily_learning/` — a random Wikipedia deep-dive each day, cached per-day with a history log and streak counter. Started as a cloud-scheduled-routine idea but pivoted to a local sandbox page (matching this repo's pattern) after hitting a cloud/GitHub-connection blocker.
- **Procedural Terrain / World Map Generator** (`IDEAS.md` #13) — `playground/terrain_generator/` — noise-based elevation/moisture/temperature, Whittaker-style biomes, steepest-descent rivers, named settlements, seeded + reproducible.
- **Real-Time Multiplayer Shared Canvas / Mini Game** (`IDEAS.md` #11) — `game_terminal/` — https://game-terminal.onrender.com — seven games live: shared drawing canvas, Hangman, Checkers, Chess, Slither (the first real-time tick-loop game in the hub, vs. the event-driven others), Connect 4, and Arena Duel (1v1 3D shooter — ported movement/camera/weapon math from the single-player `games/shooter/` prototype onto server-authoritative tick-loop netcode + a new full-viewport takeover layout; round-based best-of-5 with real per-round health bars). Bot/CPU opponents added for Checkers, Chess, and Connect 4 (a "PLAY VS BOT" seat button, sentinel `'BOT'` seat value, uniform-random legal-move selection, see `game_terminal/FUTURE.md`). Spades, Hearts (4-seat trick-taking card games, standard rules and scoring), Backgammon (standard rules, casual scope), TRON (light-cycle arena, the hub's second real-time tick-loop game), Pictionary (shared-canvas drawing + rotating hidden-word guessing), Slope (a 3D shared-track endless runner, the hub's first 3D game, Three.js), and Maze Dash (the requested "speedrun game" — settled on a shared-seed procedural maze race, event-driven, fastest-finish-time leaderboard) also shipped, completing a 2026-09-21 request for 8 new games/features, one commit per game. Two rounds of playtest fixes followed (2026-09-22): round 1 fixed Slope's steering feel/obstacles/edge-death, TRON's blocky rendering, and Backgammon's GUI; round 2 added Slope speed boosts/downhill visual/moving hazards, fixed TRON's trail-displacement bug, and grouped the now-19-game hub menu into collapsible category tabs (Card Games/Board Games/Arena & Real-Time/Party & Drawing); round 3 fixed Slope's staircase-looking ground (planks now tilt to form a continuous ramp) and made `updown` hazards telegraph (rise/hold/fall instead of an instant-lethal flash). 2026-09-27 bots pass: Easy/Medium/Hard/Expert difficulty for every bot (real search engines for chess/Connect 4/checkers, a backgammon engine with 2-ply Expert, card-counting/Monte-Carlo card bots), new bots for TRON, Slither, Maze Dash, Hangman (bot picker = solo play) and the Arena Duel shooter; Slope rebuilt from scratch (shared client/server physics in `public/games/slope/sim.js`: gravity, ramps/gaps, drops, banks, holes, always-passable block walls, synthwave valley visuals, server-side CPU racers). Drawing/Pictionary/Gartic Phone still have no bots. Slope playtest polish (same day): rigid chase cam, render interpolation + HUD/streaming perf fixes, boost pads that permanently raise cruise speed, piston blocks, holes removed, sideways momentum, gravity slide on tilted track, platforms as solid towers down to the valley floor, calmer ball skin — Ben: "feels great now". 2026-10-11 LOOP_TASKS batch done: new GAMEPIGEON tab (17 GamePigeon remakes: pool, cup pong, darts, basketball, sea battle, filler, word hunt/bites, 20 Questions, tanks, mini golf, archery, shuffleboard, bowling, knockout, paintball, skee-ball) and a WORD GAMES tab (+ Word Trails, Crossword). All have Easy–Expert bots, 49 hub types, and all 32 test files pass. Committed locally, NOT yet pushed/deployed. Next: Ben playtests the new games.
- **Procedural Dungeon Crawler** (`IDEAS.md` #4) — `playground/dungeon_crawler/` — predates the tracking convention, discovered already-complete and logged 2026-09-13.
- **Ant Colony Optimization Visualizer** (`IDEAS.md` #9) — `playground/ant_colony_optimization/`
- **Physics Sandbox** (falling-sand, `IDEAS.md` #2) — `playground/physics_sandbox/`
- **Generative Art Gallery** (`IDEAS.md` #12) — `playground/generative_art_gallery/`
- **Webcam Hand-Tracking Paintbrush** (`IDEAS.md` #21) — `playground/hand_paintbrush/`
- **Raytracer From Scratch** (`IDEAS.md` #19) — `playground/raytracer/`
- **Audio-Reactive Music Visualizer** (`IDEAS.md` #14) — `playground/music_visualizer/`
- **Terminal "Mission Control" Dashboard** (`IDEAS.md` #20) — `apps/mission_control/` — system/weather/calendar/clock/git/up-next panels plus a full Spotify Web API integration (now-playing, playback controls, queue peek), an editable notes/to-do panel, three switchable layouts (grid/sidebar/stacked), sidebar as default, sidebar panels tiled to fit the screen exactly with no gaps/overflow/cutoff. Further ideas logged in `apps/mission_control/FUTURE.md`.

# Other tracked work

Outside the numbered sections below.
- `money/` — money-making tools, own backlog in `money/money_ideas.md`. Two already built: `sports-arb-scanner/` (cross-book soccer odds arbitrage scanner) and `alpaca-paper-trader/` (SMA-crossover paper trading bot). Top unbuilt pick per that file's own ranking: a marketplace flip bot (scan Facebook Marketplace/Craigslist for underpriced listings).

---

# General backlog

## 0. 3D-Rendered Games (WebGL / Three.js)

**Status:** In progress — see `games/shooter/` for the first build (round-based FPS wave shooter).
**Pitch:** Browser-based 3D content (WebGL via Three.js) rather than 2D canvas/DOM — first-person or third-person games with real depth, lighting, and movement, opened as a local HTML file just like the 2D projects.

**Why this one:** Came up when discussing capability limits — genuinely achievable at solo/single-session scope for a local single-player game (movement, hitscan/raycasting, simple AI, lighting). The explicit non-goal: a real competitive multiplayer shooter (Valorant/CS-tier) is out of reach solo — that needs server-authoritative netcode, anti-cheat, and years of asset/tuning work. Scope stays to single-player, local, one arena at a time.

**What it needs when resumed (general, beyond the specific shooter build):**
- **Rendering stack:** Three.js. Use an old pre-module version (this project vendors `three@0.128.0`'s `build/three.min.js`, a plain global-attaching UMD-style script) rather than the modern ES-module-only builds — avoids `file://` CORS issues with `<script type="module">` imports so double-click-to-play keeps working with no local server, in both Firefox and Chromium.
- **FPS controls:** hand-rolled pointer-lock camera rig (yaw `Object3D` containing a pitch `Object3D` containing the `PerspectiveCamera`) rather than the `PointerLockControls` example addon — keeps it dependency-free and gives full control for combining with shooting/collision code.
- **Collision:** simple 2D (XZ-plane) circle-vs-AABB resolution against pillar/obstacle boxes, plus a straightforward bounds clamp for the arena edge — no physics engine needed at this scope.
- **Hit detection:** `THREE.Raycaster` from the camera for hitscan shooting; same raycaster reused against obstacle meshes for AI line-of-sight checks.
- **Testing approach (no Chrome extension / browser automation available this session):** `puppeteer-core` pointed at the system's already-installed Chromium binary (`/snap/bin/chromium`) works for headless scripted testing — install with `npm install puppeteer-core --no-save` in the scratchpad. Pointer lock generally won't engage in headless/automated contexts, so verify game-logic/state-machine correctness (round progression, damage, economy, purchases) via temporary `window.__debug` hooks exposing internal functions/state, exercised through `page.evaluate`; strip the hooks from the shipped file before calling it done. Movement/keyboard input can still be tested directly via simulated keypresses since it isn't gated behind pointer lock in this codebase.
- **Pointer Lock on Linux: prefer Chromium over Firefox.** Hit a real, user-confirmed bug in `games/shooter/`: on this user's Firefox + X11 session, the mouse-look cursor would intermittently get "stuck" at a screen edge/corner (unable to turn further right or down) shortly after a direction reversal — consistent with known longstanding Firefox-on-Linux-X11 Pointer Lock cursor-recentering bugs, not an app bug (confirmed: the game's yaw rotation has no clamp at all, so it can't be a client-side logic issue causing that symptom). Tried and confirmed insufficient on their setup: `requestPointerLock({unadjustedMovement: true})`, pairing pointer lock with `document.documentElement.requestFullscreen()` (note: must fullscreen a common ancestor of the canvas and any sibling HUD/overlay divs, not the canvas alone — the Fullscreen API hides everything outside the fullscreen element's subtree), and clamping per-frame mouse deltas defensively. Confirmed on the same machine: **the bug does not occur in Chromium-family browsers** — same page, same OS, same X11 session, Firefox-specific. Decision: this user runs 3D shooter/pointer-lock games in **actual Google Chrome** going forward (installed after initially testing in Chromium — Chrome has worked best in practice across these games), not their usual Firefox default. The Firefox-skip-fullscreen branch (`isFirefox` check in `requestPointerLock()`) is still in the shipped code as a harmless partial mitigation, but does not fully resolve it. **For any future pointer-lock-heavy browser game, default to recommending Chrome on Linux and mention this known Firefox/X11 limitation up front**, rather than rediscovering it via multi-round bug reports.

**Possible extensions once comfortable with the stack:** third-person or top-down 3D instead of first-person, vehicle/flight physics, a small explorable 3D environment (walking sim), simple ragdoll/physics via a lightweight physics lib (e.g. cannon-es) if a project actually needs real physics response instead of hand-rolled collision.

---

## 0a. Shooter: Arena Variety (deferred from the round 2 content pass)

**Status:** Deferred — user explicitly asked to log this and come back to it later, after enemy variety / bosses / weapons / perks / sound land first.
**Pitch:** `games/shooter/` currently has exactly one arena layout (fixed `PILLAR_LAYOUT` of 6 box pillars in a 44x44 walled square). Add variety:
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

**Status:** Done — see `playground/physics_sandbox/` (sand, water, stone, wood, fire, smoke, paint-to-place UI).
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

**Status:** Done — see `playground/dungeon_crawler/` (BSP room/corridor generation, enemies, items, combat, line-of-sight/visibility, leveling). Predates the IDEAS.md tracking convention (came in with the repo's initial commit), so it went unlogged until now.
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

**Status:** Done — see `playground/ant_colony_optimization/`.
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

**Status:** Done — see `game_terminal/README.md` and `game_terminal/FUTURE.md`, deployed at https://game-terminal.onrender.com. Seven games live: drawing, Hangman, Checkers, Chess, Slither, Connect 4, Arena Duel (1v1 3D shooter, ported from `games/shooter/` — see idea #0).
**Pitch:** A lightweight multiplayer experience where multiple browser tabs/players share live state — a shared drawing canvas, a tiny `.io`-style game, or a synchronized game board.

---

## 12. Generative Art Gallery

**Status:** Done — see `playground/generative_art_gallery/`.
**Pitch:** A page that generates an endless stream of unique visual art pieces algorithmically — flow fields, L-systems, Perlin-noise compositions, recursive/fractal patterns — no two alike, purely from code and randomness.

---

## 13. Procedural Terrain / World Map Generator

**Status:** Done — see `playground/terrain_generator/`. Layered Perlin fbm for elevation (with a radial island mask) and moisture, latitude+elevation-derived temperature, a Whittaker-style biome lookup (14 biomes), steepest-descent rivers to the coast, and procedurally-named settlements biased toward coasts/riverbanks. Seed + sliders (sea level, island strength, moisture, river count) fully reproducible per seed.
**Pitch:** Generate a full fantasy-style or realistic world map from scratch — elevation via noise functions, then derived biomes, rivers, and coastlines — rendered as a colored, readable map, not just a heightmap.

---

## 14. Audio-Reactive Music Visualizer

**Status:** Done — see `playground/music_visualizer/`.
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

**Status:** Done — see `playground/raytracer/`.
**Pitch:** A from-scratch raytracer — rays cast per-pixel into a 3D scene, intersecting spheres/planes, with real lighting, shadows, and reflections.

---

## 20. Terminal "Mission Control" Dashboard

**Status:** Done — see `apps/mission_control/README.md` and `apps/mission_control/FUTURE.md`.
**Pitch:** A glanceable terminal dashboard (a TUI) showing live system stats, weather, calendar, and whatever else is useful, all in one view.

---

## 21. Webcam Hand-Tracking Paintbrush

**Status:** Done — see `playground/hand_paintbrush/`.
**Pitch:** Paint on a canvas using hand position/gesture tracked live from
a webcam feed, rendered with a soft watercolor-style brush rather than a
hard cursor line.

---

## 22. Daily Learning (Random Topic Deep-Dive)

**Status:** Done — see `apps/daily_learning/`. Fetches a random Wikipedia article
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

**Why this one:** A distinct WebGL exercise from the existing `playground/raytracer/` (rasterization + meshing instead of ray-per-pixel) and `games/shooter/` (building/exploration instead of combat). Also a good sandbox for a later survival/crafting extension if it turns out to be fun.

**What it needs when resumed:**
- Three.js, reusing the vendored pre-module build from `games/` (see idea #0's stack notes) so `file://` double-click-to-play keeps working.
- A chunk data structure: a 3D typed array of block IDs.
- Greedy meshing or at minimum naive per-cube-face culling to keep triangle count sane.
- Raycast-based block placement/removal from the camera.
- The same hand-rolled pointer-lock camera rig already proven in `games/shooter/` for first-person look — see idea #0's Firefox/X11 pointer-lock caveat (default to Chrome for testing).

---

## 26. Idle/Incremental Game

**Status:** Done — `games/cosmic_forge/`. A cosmic-growth theme (Spark → Dust → Protostars → Stars → Solar Systems → Galaxies → Superclusters → Cosmic Web) with a narratively-justified prestige reset ("The Big Collapse" / Big Bang), 7 gated generator tiers, a thin secondary Matter currency spent on permanent Monuments, timed random events (Solar Flare/Meteor Shower/Supernova/Wormhole), achievements, and a tier-synced animated canvas backdrop.
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

**Status:** Done — see `playground/rhythm_game/` ("Pulse Catcher"). Deliberately not a lane-based Guitar Hero clone: a single free-roaming reticle (mouse/pointer, with arrow-key fallback) chases orbs that bloom anywhere across the field. Catching requires both timing *and* position. Heavy juice: particle bursts, screen shake, a synthesized combo-rising chime (no audio assets — oscillators + envelopes), floating score text, a miss-flash vignette, orb anticipation glow, combo-tier color escalation, combo-milestone callouts (10/25/50/...), and a background aura that breathes with the song's live energy via an `AnalyserNode` tap. A "3, 2, 1, Go!" countdown (synced off the real audio clock, not a timer) leads into every round, a live progress bar tracks the song, and results show a letter grade (S/A/B/C/D) plus a locally-persisted best score per track+difficulty. Judging keyed directly off `audioCtx.currentTime`, no scheduler needed. Two track sources: upload any local file (offline amplitude-envelope peak-picking + a zero-crossing-rate timbre estimate sampled from each note's sustain, not its attack transient, for bass/mid/treble color) or pick one of 6 "featured tracks" — original songs procedurally composed and synthesized entirely in Web Audio (`OfflineAudioContext`, no bundled/copyrighted audio at all) across varied genres (synthwave, chiptune, ambient, D&B, ethereal, anthem); since the composer places every note itself, difficulty there gates which instrument layers become catchable (kick only → +snare → +melody) instead of an amplitude threshold. HiDPI-aware and responsive down to phone widths, with a master volume control and an ambient animated backdrop. Full pause/resume (Escape key, on-screen button, or auto-pause on tab-blur — correctly excludes paused wall-clock time from the song clock, and can even pause mid-countdown), and touch taps now aim+catch correctly on the very first touch (a `pointerdown` with no preceding `pointermove`, which touchscreens never send, previously judged against the stale old reticle position).
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

**Why this one:** A genuinely different generative technique than the Perlin-noise-based projects already shipped here (`playground/terrain_generator/`, `playground/generative_art_gallery/`) — constraint satisfaction instead of continuous noise fields, with its own distinct failure mode (contradictions requiring backtracking/retry) that's interesting to implement correctly.

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

**Why this one:** Distinct from the falling-sand automaton (`playground/physics_sandbox/`) since the rules themselves are player-authored rather than fixed per-material — same "simple local rule, complex global behavior" appeal as boids (#3), but for a grid automaton instead of continuous agents.

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

**Status:** Done (2026-09-27) — `apps/claude_usage_analyst/`, run `claude-usage`. See its README for the limit-calibration findings.
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

---

## 43. Copy-Trading Paper Bot ("does smart money beat the index?")

**Status:** Built 2026-10-10/11 in `money/copy-trader/`; live paper trading via systemd timer (`copytrade.py status`). Spec in its `PROMPT.md`, results and caveats in its `PROGRESS.md`.
**Pitch:** Copy 13F hedge funds, Congress members' disclosed trades, and Hyperliquid top perp traders with fake money. Backtest and live-paper through the same engine (no lookahead, real costs/funding/liquidation, US after-tax), and report honestly against SPY/BTC.

**Why this one (as a model test):** Messy real data (SEC XML, House PTR PDFs, Senate eFD scraping, a rate-limited crypto API). It also tests the discipline of not fooling yourself: lookahead, survivorship, and hindsight in picking leaders.

**What it needs when resumed:**
- Revisit live results after ~1–3 months.
- Possible upgrades: a rule-picked fund universe (e.g. the top 13F filers by AUM as of 2019) to remove hindsight; delisted price data; a longer crypto history source.

## 44. Auto-Synced Homework Planner (myHomework, minus the typing)

**Status:** v1 built 2026-10-15 in `apps/backpack/` (iCal sync via Cloudflare Worker proxy, data on-device, no accounts). Not deployed yet. See its README. Idea came from a friend using myhomeworkapp.com.
**Pitch:** A myHomework-style planner (classes, upcoming assignments, due-date list/calendar, mark done) that fills itself from the school's LMS (Canvas, Schoology, others) instead of the student typing everything in.

**Why this one:** The manual-entry step is the whole reason people abandon planners. Removing it is the product.

**What it needs when resumed:**
- Cheapest universal sync path: **calendar iCal feeds**. Canvas (Calendar → "Calendar Feed") and Schoology (Calendar → iCal export) both give each student a private URL with every assignment and its due date, with no API keys and no school admin approval. Google Classroom and Brightspace have similar feeds. The student pastes one URL and you poll it.
- Richer path, later: Canvas REST API with a personal access token (`/api/v1/courses`, `/users/self/todo`, submissions → auto-mark done when submitted). Some schools block student tokens. Schoology's API needs per-school keys, so use iCal there.
- Feeds give class names inconsistently (Canvas puts `[Course]` in the summary). A parse step maps events to classes and lets the user rename and color them.
- Keep user state (done flags, notes, personal tasks) separate from synced data so a re-sync never wipes it. Dedupe on the event UID.
- Done when: paste a real Canvas feed URL, see classes and assignments appear, check some off, re-sync, and the checkmarks survive.
- Question for Ben: personal tool for his own Canvas, or something friends could use (hosted, accounts, phone)? That decides local web app vs hosted PWA.

---

# Big builds

Generated 2026-09-28. Each one is meant to be run from a single well-planned
prompt with full permissions and no follow-up questions. They're picked to be
completely different from everything in the general backlog, and to have an objective
way for the model to check its own work: test suites, reference diffs, or
rendered output it can inspect.

Recommended picks: **N1** (best mix of cool and objectively checkable),
**N2** (most different kind of stress test), **N5** (most personal payoff).

---

## N1. Web Browser Engine From Scratch

**Status:** Stocked, not started.
**Pitch:** A from-scratch browser engine: HTML tokenizer/parser → DOM, CSS parser + cascade/specificity, block and inline layout, painting to a canvas. Has a URL bar and loads real, simple sites (Wikipedia articles, Hacker News, old personal pages).

**Why this one:** "I browsed Wikipedia in a browser Claude wrote" is a great demo, and correctness is checkable against a real browser.

**What it needs when resumed:**
- Done when: renders a chosen set of real pages recognizably close to Firefox (screenshot diffs via Playwright); passes a small web-platform-tests subset.
- Runs in the browser with a fetch proxy (small local server) to get around CORS.
- Stretch: links + history, forms, basic flexbox, images, a devtools-style DOM/box-model inspector.

---

## N2. Code-Rendered Animated Short Film

**Status:** ✅ Done 2026-09-28 — "LANTERN", 2:56, 1080p60, in `playground/animated_short/` (`./make_film.sh` re-renders everything in ~8 min; film at `playground/animated_short/output/film.mp4`, git-ignored). Was: brief locked (sci-fi/awe, wordless, style = Claude's pick). Prompt in `playground/animated_short/PROMPT.md`.
**Pitch:** A 2–3 minute animated short made entirely in code: Three.js or a custom renderer, a real script/storyboard, procedurally synthesized score and sound effects, exported to `.mp4` via ffmpeg.

**Why this one:** The end product is an actual film to watch and share. It stresses creative and directorial judgment, unlike anything else in the repo.

**What it needs when resumed:**
- Done when: a finished `.mp4` with a beginning/middle/end, synced audio, and no rendering glitches.
- Self-review loop: render keyframes/contact sheets, inspect them, fix composition, pacing and audio sync.
- Deterministic frame-by-frame offline rendering (not real-time capture) so the output is stable.
- Write `SCRIPT.md` + storyboard first; keep the scope to one location and 1–2 characters.

---

## N3. Hobby Operating System

**Status:** Stocked, not started.
**Pitch:** A bootable OS (x86 or RISC-V): bootloader, memory management (paging + allocator), preemptive multitasking, a simple filesystem, a shell with a few programs, maybe a tiny game. Boots in QEMU and in the browser via v86, so anyone can try it from a link.

**Why this one:** Low-level systems work where bugs are brutal (triple faults, stack corruption), but progress is still testable.

**What it needs when resumed:**
- Done when: boots to a shell, runs multiple processes, reads/writes files that persist, and runs in-browser via v86.
- Testing: headless QEMU with scripted tests over the serial console.
- Dependencies: QEMU + a cross-compiler toolchain. Ben may need to run one `sudo apt install` before starting.

---

## N4. SQL Database From Scratch

**Status:** Stocked, not started.
**Pitch:** A real database engine: page-based B-tree storage, SQL parser, query planner, transactions, write-ahead log, crash recovery. Plus a web "explain" view that animates how a query executes through the plan and pages.

**Why this one:** The most rigorous engineering test of the set: correctness is fully objective. It's the least flashy, which the visualizer offsets.

**What it needs when resumed:**
- Done when: passes a chosen subset of SQLite's sqllogictest suite, and survives kill-it-mid-write crash tests with no data loss.
- Stretch: indexes + planner choosing between them, joins, concurrent readers.

---

## N5. Stockholm in 3D

**Status:** Done 2026-09-28, including all three stretch goals. The code is in `playground/stockholm3d/`: run `./build.sh`, then `./serve.sh`.
**Pitch:** A browser 3D explorer of Stockholm built from open data: OpenStreetMap buildings extruded to their real heights, elevation data, water, and a day/night cycle with the correct sun position for Stockholm's latitude and date. Fly-through camera, click a building for its info.

**Why this one:** Personal while Ben is living in Stockholm (through ~Dec 2026). Real-world data, unlike the procedural `playground/terrain_generator/`.

**What it needs when resumed:**
- Done when: central Stockholm (Gamla stan, Södermalm, Norrmalm, Djurgården at minimum) renders smoothly, and landmarks are recognizable in screenshots.
- Data: OSM extract (Overpass or Geofabrik) + open elevation data. No API keys needed.
- Preprocess the data into compact tiles offline so the browser loads fast.
- Stretch: seasons/snow, the real sunrise/sunset times (very short days in December), walking mode.

---

## N6. Tiny GPT With No ML Libraries

**Status:** Stocked, not started.
**Pitch:** A from-scratch autograd engine and transformer, trained locally on something fun (Swedish text, Strindberg, etc.), with an interactive page that shows attention patterns and token probabilities live as it generates.

**Why this one:** Builds the whole stack from the math up, with no PyTorch, and makes an otherwise invisible process visible.

**What it needs when resumed:**
- Done when: gradient checks pass against numerical gradients, the loss curve drops meaningfully, and it generates recognizable text in the training style.
- CPU-only training, so the model stays small: expect fun, semi-coherent output, not smart output.
- Tokenizer from scratch too (char-level or small BPE).

---

## N7. A Fully Realized Fictional World

**Status:** Stocked, not started.
**Pitch:** A constructed language with real grammar and a dictionary, plus a generator for its writing system. On top of that: a wiki with history, a timeline, maps, and a virtual museum of artifacts.

**Why this one:** A creative-writing and worldbuilding stress test at scale, different from all the engineering-heavy ideas.

**What it needs when resumed:**
- Done when: the conlang has a documented grammar and dictionary, and the wiki has dozens of interlinked pages, a timeline and maps.
- Automated consistency checks: every conlang phrase on the wiki parses under the grammar, no timeline contradictions, no broken wiki links.
- Judging is more subjective than the others; lean on those checks.

---

**Batch 2, generated 2026-09-28.**

Same rules: one well-planned prompt, full permissions, and an objective way
for the model to check its own work. None of these overlap the general backlog, batch 1,
or an existing directory.

Recommended picks: **N8** (hardest objective test), **N12** (most personal:
ISS passes over Stockholm), **N16** (most unusual kind of check: a speech
recognizer grades the output).

---

## N8. Self-Hosting C Compiler

**Status:** Stocked, not started.
**Pitch:** A compiler for a real subset of C (structs, pointers, arrays, function pointers, a preprocessor) that emits x86-64 assembly: lexer, parser, type checker, an SSA IR with a few optimization passes, and register allocation. The finish line is self-hosting: the compiler compiles itself, and that binary compiles itself again to a byte-identical result.

**Why this one:** `IDEAS.md` #1/#36 are interpreters; this goes all the way down to machine code. Self-hosting is an unfakeable finish line.

**What it needs when resumed:**
- Done when: passes a public C test suite subset (e.g. `c-testsuite`), is self-hosting with a stage2 == stage3 check, and a benchmark shows optimizations beat its own `-O0`.
- Uses the system `as`/`ld` for assembling and linking; the compiler itself uses no LLVM or libraries.
- Stretch: a browser page that shows source → IR → assembly side by side, with passes stepping.

---

## N9. Git, Reimplemented

**Status:** Stocked, not started.
**Pitch:** A from-scratch git: object store (blob/tree/commit/tag), zlib, the index, `add`/`commit`/`log`/`diff`/`branch`/`checkout`/`merge` (with a real three-way merge), packfiles with delta compression, and `clone`/`fetch`/`push` over the smart HTTP protocol, so it can clone a real GitHub repo.

**Why this one:** It's checkable against the real thing: every repo it writes must pass `git fsck` and be readable by real git, and every repo real git writes must be readable by it.

**What it needs when resumed:**
- Done when: it clones a medium-size public GitHub repo byte-for-byte (same tree hashes as real git), round-trips repos with real git both ways, and passes a differential fuzz test against real git on random edit/commit/merge sequences.
- Stretch: a browser visualizer of the object graph that animates as you commit, branch and merge.

---

## N10. A Computer From NAND Gates

**Status:** Stocked, not started.
**Pitch:** Build a CPU up from a single NAND primitive: gates → adders/ALU → registers/RAM → a custom 16-bit CPU. Then an assembler, a tiny high-level language compiled to it, and a game (Tetris or Snake) running on the simulated gates. A browser view lets you zoom from the running game down to individual gates toggling.

**Why this one:** Different from the Game Boy emulator (#33): here the hardware is the thing being built, not emulated from a spec. Every layer gets its own truth-table and program tests.

**What it needs when resumed:**
- Done when: every chip passes exhaustive or randomized truth-table tests, the CPU passes an instruction-level test suite, and the game is playable at a usable speed. Gate-level simulation will need compiling or levelizing the netlist to be fast enough.
- Stretch: export the design to Verilog and simulate it in Icarus/Verilator as a second opinion.

---

## N11. Raft Key-Value Store + Jepsen-Style Torture Tester

**Status:** Stocked, not started.
**Pitch:** A distributed, replicated key-value store on Raft (leader election, log replication, snapshots, membership changes), plus a fault injector that partitions the network, kills nodes, pauses them and skews clocks while clients hammer it. A linearizability checker proves no acknowledged write was lost or reordered.

**Why this one:** Distributed systems are the classic domain where "it works in the demo" means nothing. The checker makes correctness objective.

**What it needs when resumed:**
- Done when: thousands of randomized fault schedules pass the linearizability check (Knossos/Porcupine-style, written from scratch). Planted bugs (e.g. skip the term check) must be caught, which proves the tester works.
- Deterministic simulation mode (seeded, single-threaded, fake network and clock), so any failure replays exactly.
- Stretch: a browser timeline that replays a run: nodes, messages flying, elections, and the partition that caused an anomaly.

---

## N12. Satellite Tracker — What's Over Stockholm Right Now

**Status:** Stocked, not started.
**Pitch:** SGP4/SDP4 orbit propagation implemented from the spec, fed with live TLEs from CelesTrak. It drives a 3D globe with the ~10k active satellites, Starlink trains, ISS ground tracks, and a pass predictor for Stockholm: when the ISS or other bright satellites will be visible tonight (sunlit satellite, dark sky), and where to look.

**Why this one:** Real physics plus real data, and there's an official answer key. It also has a personal payoff: go outside and actually see the predicted pass.

**What it needs when resumed:**
- Done when: matches the official SGP4 verification test vectors (Vallado's `SGP4-VER.TLE`) to within millimetres, and ISS pass times for Stockholm agree with Heavens-Above to within a few seconds.
- No API keys needed (CelesTrak is open).
- Stretch: a phone-friendly page with a compass/AR "look here" arrow, and notifications before good passes (reuse the ntfy setup from `money/flip-bot/`).

---

## N13. Spreadsheet App With an Excel-Compatible Formula Engine

**Status:** Stocked, not started.
**Pitch:** A browser spreadsheet: a virtualized grid for 1M rows, a formula parser and evaluator for ~150 common functions, a dependency graph with incremental recalculation, circular-reference detection, array formulas/spill, charts, and `.xlsx` import/export.

**Why this one:** Deceptively deep (Excel's semantics are full of edge cases), and there's a perfect oracle: LibreOffice headless computes the same workbooks.

**What it needs when resumed:**
- Done when: a corpus of generated and real `.xlsx` files recalculates to the same values as `soffice --headless`, incremental recalc stays interactive on a 100k-formula sheet, and exported files open cleanly in LibreOffice.
- Dependency: `libreoffice` installed for the oracle (may need one `sudo apt install`).
- Stretch: live multi-user editing, reusing ideas from `game_terminal/`.

---

## N14. Font Rasterizer + Text Shaper From Scratch

**Status:** Stocked, not started.
**Pitch:** Parse TrueType/OpenType files (glyf, cmap, hmtx, kern, GPOS/GSUB basics) and rasterize glyph outlines with exact-coverage antialiasing. Add a line-breaker (Knuth-Plass) and hyphenation, and typeset a book chapter into a PDF writer that is also written from scratch.

**Why this one:** Small in scope, but pixel-level objective: every glyph can be diffed against FreeType, and every line break against TeX.

**What it needs when resumed:**
- Done when: rendered glyphs across several fonts match FreeType's output within a small per-pixel error, ligatures and kerning match HarfBuzz on a test string set, and the typeset PDF opens in real viewers and looks professionally set.
- Stretch: variable fonts, and a playground page with live Knuth-Plass vs greedy line-breaking comparisons.

---

## N15. Design an Original Board Game, Balanced by AI Playtesters

**Status:** Stocked, not started.
**Pitch:** Claude invents an original tabletop game (theme, mechanics, rulebook), implements it as a rules engine, and runs thousands of simulated games with MCTS/heuristic bots to tune the balance. Iterate until the design is healthy. Output: a polished print-and-play PDF (cards, board, rulebook) plus a playable web version.

**Why this one:** A design-judgement stress test with numbers behind it, unlike N7's worldbuilding. Different from the card/board game *AIs* in `game_terminal/` (#34): here the game itself is the product.

**What it needs when resumed:**
- Done when: first-player win rate is within ±3%, no single strategy dominates (bots with different strategy weights all win meaningfully often), games end in a target length, and a written design log explains each balance change with the data behind it.
- Stretch: add it to `game_terminal/` as a new multiplayer game type.

---

## N16. Speech Synthesizer From Scratch, Graded by Whisper

**Status:** Stocked, not started.
**Pitch:** A text-to-speech engine with no neural nets: English (and maybe Swedish) text normalization → phonemes via rules plus a pronouncing dictionary → prosody → a formant or articulatory synthesizer (vocal tract model) → audio. Includes a web page where you type and hear it, with the spectrogram and vocal-tract shape animated.

**Why this one:** It closes the loop with an objective judge: run the output through Whisper and measure the word error rate. Self-improvement becomes a measurable number.

**What it needs when resumed:**
- Done when: Whisper transcribes a held-out set of sentences with a low WER (target under 10%), and the voice sounds like a 1980s DECtalk rather than noise.
- Dependency: `openai-whisper` or `whisper.cpp` locally, as the judge only. The RTX 4060 makes this fast.
- Stretch: singing mode (feed it a melody), and Swedish with its pitch accent. Ben could test the Swedish on locals.

---

## N17. Evolved Virtual Creatures

**Status:** Stocked, not started.
**Pitch:** Karl Sims–style evolution: creatures made of rigid blocks and motorized joints, with bodies and neural controllers co-evolved in a physics engine written from scratch. Fitness tasks are walking, swimming, jumping and competing for a cube. The result is a browser "zoo" of champions with their family trees.

**Why this one:** Emergent behaviour you can't design by hand, backed by a deterministic simulation. It's different from boids (#3): here the bodies themselves evolve.

**What it needs when resumed:**
- Done when: the physics engine passes conservation and stability tests (no explosions and no energy gain in a passive stack), fitness curves climb across seeded runs, and at least three qualitatively different locomotion strategies emerge (rendered clips for comparison).
- Deterministic, headless evolution on all CPU cores; the browser only replays saved genomes.
- Stretch: a head-to-head tournament mode, and letting the viewer breed creatures by hand.

---

## N18. Game Boy / Game Boy Color Emulator

**Status:** Done 2026-09-28. The code is in `games/gameboy/` and it's playable in `game_terminal/` (RETRO → GAME BOY).
**Pitch:** A cycle-stepped DMG + CGB emulator written from scratch in vanilla JS (CPU, PPU, APU, timer, MBC1/2/3+RTC/5). It comes with a browser player (AudioWorklet audio, IndexedDB saves, save states, rewind, fast-forward, gamepad and touch) and bundles only free homebrew.

**Why this one:** Public test ROMs (Blargg, Mooneye, acid2) grade accuracy objectively, and a finished emulator slots into game_terminal as a new room.

**What it needs when resumed:**
- Done when: most test ROMs pass (currently 131/141), homebrew is playable at full speed with sound, and it works in game_terminal. All three are met.
- Remaining accuracy failures: `dmg_sound` 09/12, the Mooneye `boot_*` tests, and 5 PPU timing edge cases (listed in `games/gameboy/README.md`).
- game_terminal spectating replays the streamer's keyframe and inputs in lockstep. `games/gameboy/test/determinism.js` must keep passing, and after editing `games/gameboy/` you have to run `games/gameboy/tools/sync-game-terminal.sh`.
- Stretch: link-cable multiplayer between two game_terminal players (serial port over WS, lockstep), a debugger panel, and more bundled homebrew.

---

# Useful

Generated 2026-10-11. Unlike the general backlog and the big builds, these are picked
for being useful, not flashy. They're aimed at Ben's real situation: a student
in Stockholm until ~end of Dec 2026, on a tight budget, with ntfy push
notifications already working (flip-bot, trading-cockpit).

Grouped by what they save: money, time, or stalled work in this repo.

---

## U1. Grocery Deal Matcher

**Status:** Built 2026-10-11 in `apps/grocery_deals/`: ICA (Kvantum Kungsholmen) + Willys + Hemköp, a desktop app with live deals and an in-app list editor, and a Monday 08:00 push. Same day: Trip tab (shopping list from picked deals, send to phone via ntfy), price history (`history.db`, "best price in N wks"), Coop + Lidl sources, daily 09:00 alerts for new list matches. Ben wants to develop this one the most.
**Pitch:** Scrapes the weekly offers from nearby Willys, ICA, Coop and Lidl stores and matches them against a standing shopping list. Every Monday it sends a push like "Willys has your chicken and oat milk on sale, ~140 kr saved."

**Why this one:** You'd use it every week, and the savings are small but real on a student budget.

**What it needs when resumed:**
- Done when: a weekly ntfy digest lists the matched offers per store, with the estimated savings.
- Check how each chain publishes offers (an API behind the website, a JSON endpoint, or HTML) before writing scrapers.
- Fuzzy matching between list items and offer names ("havredryck" ↔ "Oatly Barista 1L").
- Stretch: suggest which single store to go to this week.

---

## U2. Personal Finance Dashboard

**Status:** Stocked, not started. Same as `IDEAS.md` #37.
**Pitch:** Drop in bank CSV exports. It sorts transactions into categories, finds subscriptions you forgot about, flags odd charges, and forecasts whether your money lasts until December.

**Why this one:** It answers "am I on track?" without a spreadsheet, and it runs fully locally.

**What it needs when resumed:**
- Done when: your real exports are categorized correctly ≥90% of the time, and a correction UI learns rules from your fixes.
- Need to know first: which bank(s), and whether they're USD, SEK or both (currency conversion).
- A format adapter per bank, and dedup across overlapping exports.
- Subscription detection: same merchant, a regular interval, a similar amount.

---

## U3. Flight-Home Price Watcher

**Status:** Stocked, not started.
**Pitch:** Tracks Stockholm → home fares for late December and pushes when a price drops or looks like the low for that route.

**Why this one:** It's timely: prices for the end-of-December window are moving now, and a one-time saving here could be large.

**What it needs when resumed:**
- Done when: it checks on a schedule, keeps a price history per date and route, and pushes on a real drop.
- Need to know first: the destination airport(s), date flexibility, and airlines Ben would accept.
- Find a data source that doesn't block scrapers (a free flights API, or Google Flights via a headless browser as a fallback).

---

## U4. Deadline Radar

**Status:** Stocked, not started.
**Pitch:** Pulls every course calendar (Canvas or KTH/SU iCal feeds) into one list and sends a morning push like "2 things due this week; the lab report is in 3 days."

**Why this one:** No more surprise deadlines, and it's very little code once the feeds are in hand.

**What it needs when resumed:**
- Done when: all courses' deadlines show up in one place, and daily plus 3-day/1-day pushes fire correctly.
- Need to know first: which LMS the school uses, and whether it exposes an iCal feed URL (Canvas does).
- Stretch: a manual-add option for deadlines that only appear in course PDFs.

---

## U5. "Leave Now" Transit Pings

**Status:** Stocked, not started.
**Pitch:** Uses SL's real-time departures (Trafiklab's free API) for your regular trips. It pushes when you need to leave to catch the next train or bus, accounting for delays.

**Why this one:** It's daily and practical, and a first version is about one evening of work.

**What it needs when resumed:**
- Done when: for a configured trip and arrival time, a "leave in 5 min" push arrives that matches real departures.
- A free Trafiklab API key (Ben signs up).
- Config: home stop, regular destinations, walking time to the stop.
- Stretch: a mission_control panel showing the next departures.

---

## U6. Ask Your Course Materials

**Status:** Stocked, not started.
**Pitch:** Local search over your lecture PDFs and slides that answers questions with page citations ("where did the lecture define X?").

**Why this one:** Most useful before exams, and it turns a pile of PDFs into something you can query.

**What it needs when resumed:**
- Done when: questions about real course material come back with correct page citations.
- PDF text extraction, chunking, and keyword search to start (embeddings only if keyword search falls short).
- Optional Claude answer layer when `ANTHROPIC_API_KEY` is set; plain search results otherwise.

---

## U7. "Waiting on Ben" Board

**Status:** Stocked, not started.
**Pitch:** One page or terminal command listing every manual step that's blocking a project in this repo, with the exact steps for each. Items tick off as you finish them.

**Why this one:** Several finished projects are stalled only on Ben's manual steps: publishing the Roblox games, Tradera keys for flip-bot, Clip Studio account setup, and linking a broker to trading-cockpit. Clearing those gets more value out of work that's already done than building anything new.

**What it needs when resumed:**
- Done when: running one command shows each open blocker, its steps, and its status, and checks status automatically where possible (e.g. whether a key is present in `.env`).
- Source the blockers from the Up next section and each project's SETUP.md/PROGRESS.md.
- Keep it tiny: a script plus a short checklist file, not an app.

---

## U8. Subscription Killer

**Status:** Stocked, not started.
**Pitch:** Finds recurring charges in your email receipts (or the U2 finance CSVs) and pushes about 3 days before each renewal: "Spotify renews Friday, still using it?"

**Why this one:** Forgotten subscriptions are the easiest money to save, and a heads-up before renewal is the only point where it's easy to act.

**What it needs when resumed:**
- Done when: every real recurring charge is detected with its next renewal date, and pre-renewal pushes fire on time.
- Source: Gmail (IMAP or the API, read-only, receipts only) or the U2 CSVs; decide which before building.
- Detection: same merchant, a regular interval, a similar amount (shared with U2).
- Stretch: a one-tap "cancel" link per service.

---

## U9. Second-Hand Price Checker

**Status:** Stocked, not started.
**Pitch:** Paste a Blocket or Tradera link (or type an item) and it shows what that item actually sells for, based on sold and completed listings, with a fair-price range.

**Why this one:** Useful for buying furniture or winter gear cheaply now, and for pricing everything when you sell up before leaving in December.

**What it needs when resumed:**
- Done when: for a real listing it returns comparable sold items and a price range that matches what Ben would judge fair.
- Reuse `money/flip-bot/`: it already has `fair_value`, `trimmed_median` and listing matching.
- Check what Blocket exposes. Tradera's API needs the dev keys that are already pending for flip-bot.

---

## U10. Receipt Splitter

**Status:** Stocked, not started.
**Pitch:** Snap a photo of a receipt, tap who had what, and get each person's share plus a Swish payment link or QR code.

**Why this one:** It's for flatmates, group dinners and trips, and you'd use it right away.

**What it needs when resumed:**
- Done when: a real Swedish receipt photo is parsed into items and amounts correctly, and the split and Swish links work on a phone.
- A phone-first web page (PWA, like trading-cockpit's).
- OCR: Claude vision if `ANTHROPIC_API_KEY` is set, otherwise local Tesseract with manual fixes.
- Swish deep links use the `swish://payment?data=...` format; verify it against the current Swish docs.
- Handles shared items, tip and rounding.

---

## U11. Daily "Plan My Day" Brief

**Status:** Stocked, not started.
**Pitch:** One morning push combining deadlines (U4), transit (U5), the weather ("bring a jacket, 4°C and rain at 17:00") and the first event in your calendar.

**Why this one:** One glance replaces opening four apps, and it ties several of the other ideas together.

**What it needs when resumed:**
- Done when: a single ntfy push arrives at a set time every morning with accurate data from each source.
- Weather from SMHI's free open API (no key needed).
- Start with whatever sources exist; plug in U4/U5 as they get built.
- Note: `claude-control` already has morning-hello timers, so reuse that scheduling.

---

## U12. Swedish From Your Own Life

**Status:** Stocked, not started.
**Pitch:** Snap signs, menus, texts and screenshots. It pulls out the words you don't know and turns them into spaced-repetition flashcards, with the photo as context.

**Why this one:** The vocabulary you actually ran into sticks far better than textbook lists.

**What it needs when resumed:**
- Done when: a photo becomes sensible cards (word, translation, example sentence from the photo), and a daily review works on the phone.
- Phone-first PWA. OCR plus translation via Claude, or a local fallback.
- An SM-2-style scheduler, with known words filtered out over time.
- Stretch: export to Anki.

---

## U13. Lecture Recorder → Notes

**Status:** Maybe. Stocked, not started.
**Pitch:** Turns a lecture recording into structured notes with timestamps, key terms and a summary.

**Why this one:** Notes you can search and review without re-watching the lecture.

**Battery concern (Ben):** He doesn't want the laptop recording all class. Design around that: **record on the phone** (its built-in recorder), then drop the file in a folder. Transcription runs later on the desktop's RTX 4060 while it's plugged in, so nothing runs during class.

**What it needs when resumed:**
- Done when: a real lecture recording becomes accurate notes in a few minutes on the desktop.
- Reuse Clip Studio's transcription (`money/clip-studio/app/transcribe.py`).
- A watched folder plus Syncthing or a manual copy from the phone.
- Pairs well with U6: notes become searchable alongside the slides.

---

## U14. Universal "Notify Me When" Tool

**Status:** Built 2026-10-11 in `apps/notify_when/`, timer running every 10 min. Pinned (paused) by Ben the same day.
**Pitch:** Watch any page or API and push to ntfy when a condition is true: "when this item is back in stock," "when this price < X," "when this page changes."

**Why this one:** One generic tool covers several narrow ideas (U3 price drops, restocks, ticket releases, course seats opening).

**What it needs when resumed:**
- Done when: adding a watch is one line (URL + selector/JSON path + condition), and pushes fire only on real changes, with no spam.
- Plain fetch first, with a headless browser fallback for JS-heavy pages.
- Runs on a systemd timer (like copy-trader), and keeps a small history per watch.
- Stretch: "watch this" from the phone via an ntfy action or a tiny web form.

---

## U15. Weekly Repo Digest

**Status:** Stocked, not started.
**Pitch:** Every Sunday, a short summary of what got built in this repo that week, what's stalled and on what, and where the Claude tokens went.

**Why this one:** It keeps the many parallel sub-projects legible without re-reading the Up next section, and spots projects that are quietly stuck.

**What it needs when resumed:**
- Done when: a Sunday push or page shows commits by sub-project, stalled items, and token use by project, all matching reality.
- Git log for what got built; U7's blocker list for what's stalled.
- Reuse `apps/claude_usage_analyst/` for token and cost data.

---

# Games

Standalone, complex game concepts, picked so they don't repeat anything already in
the sections above or the existing sub-projects. Each one has a genuinely
hard core system, not just content. Generated 2026-10-01.

**Status:** G2 Loop Heist was built: `games/loop_heist/`.

---

## G1. Clockwork Manor — a procedural murder mystery that actually happens

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

## G2. Loop Heist — plan a robbery with copies of yourself

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

## G3. Hull Breach — a starship crew sim with real physical systems

FTL meets Oxygen Not Included. Every ship tile simulates air pressure and gas mix,
heat, fire spread, and a power grid the player wires by hand. A hull breach really
vents air: crew get pulled toward it and doors slam under pressure. The player sets
crew priorities and survives procedurally generated encounters across a sector map.

- **Hard core:** a fluid and gas simulation on a grid, electrical circuits, crew AI
  with pathfinding and a job/priority system, and ship-to-ship combat.

## G4. Burn — a 2D space program

Build rockets from parts (tanks, engines, decouplers, struts) and fly them with
real orbital mechanics. Plan maneuver nodes, use gravity assists, do orbital
rendezvous, and land on moons with no atmosphere using suicide burns. Career mode
has contracts and a budget.

- **Hard core:** a rigid-body physics engine with staging, a stable orbit
  integrator (patched conics plus time warp), a maneuver planner with trajectory
  prediction, and a rocket editor.

## G5. Assembly Line — a factory automation game

Factorio-lite. Mine ore, then run it through belts, inserters, smelters and
assemblers, with recipe trees, power and trains. The goal is a megaproject such as
a rocket launch.

- **Hard core:** a deterministic tick simulation that stays fast with 10,000+
  items in motion. That needs real data structures: belts as compressed lanes with
  gap tracking, not per-item updates.

## G6. Contraption — a 2D physics vehicle and siege builder

Besiege in 2D. Build machines from beams, wheels, motors, springs, pistons and
catapult arms, with logic gates driven by key bindings. Then beat physics puzzle
levels: cross a canyon, break a castle, deliver an egg intact.

- **Hard core:** a custom constraint-based physics engine with joints, breakable
  connections and soft bodies, plus a building editor.

---

# Computer vision

Computer-vision project ideas, following on from the ASL project. **ASL isn't in this
repo.** It lives at `~/school/ml-project/asl-recognition/` (it started as a possible
school project and is now a personal one). It has a landmark MLP for static letters,
a J/Z motion-trajectory model, a GISLR 250-word transformer, and the SignDesk
dashboard. "Reuses ASL" below means borrowing from it.

Existing repo code worth stealing: `playground/hand_paintbrush/` (MediaPipe hands),
`money/clip-studio/app/faces.py` and `money/stream-clipper/face_track.py` (face tracking).

Difficulty: ★ weekend · ★★ a few sessions · ★★★ research-y.

## Ties into existing projects

1. **Limber form coach** ★★. A pose-tracking webcam runs during stretch routines. The
   hold timer only counts while you're actually in the pose, it measures hip and
   hamstring angles, and it logs range of motion over weeks. This turns Limber's
   "range check-ins" into real measurements.
2. **Crux beta reader** ★★★. Point your phone at a climbing video. It tracks your body
   and limbs on the wall, draws your hip path, and flags dead points and hesitations.
   You can compare two attempts at the same route side by side.
3. **Gesture-controlled game_terminal games** ★★. Webcam input for some of the 51
   games, e.g. Pong with your hand as the paddle, or real-hand rock-paper-scissors.
   Reuses the ASL hand classifier.

## Same shape as ASL (classifying hands or bodies)

4. **Fingerspelling typing racer** ★★. Words fall and you fingerspell them before
   they land. Multiplayer through game_terminal. Reuses the ASL letter + J/Z models.
5. **Air instrument** ★★. Hand height sets pitch, finger count picks the chord
   (theremin meets guitar). The fun part is keeping latency low.
6. **Gesture hotkeys** ★. Hold up a gesture and it triggers an action: mute, a
   Discord reaction, the next slide. Small and useful every day.

## Different CV skills (for range)

7. **Chessboard reader** ★★★. A camera on a real board reads the position and shows
   engine analysis live. Covers detection plus perspective warping.
8. **Rubik's cube solver** ★★. Show each face to the webcam. It reads the colors and
   guides you through the solve with AR arrows over the cube.
9. **Gaze/attention tracker** ★★★. Webcam eye tracking while studying: a heatmap of
   where you looked on screen, plus focus streaks.
10. **Juggling / keepy-uppy counter** ★★. Ball tracking with trajectory prediction.
    Fast-object tracking is a different skill from landmark models.

## Batch 2 (2026-10-16)

11. **ASL live captions in video calls** ★★. SignDesk output feeds a virtual webcam
    (v4l2loopback) with captions burned in, so Zoom/Discord just shows them.
    Reuses ASL almost entirely. The new parts are the camera plumbing and smoothing.
12. **ASL tutor with per-finger feedback** ★★. It shows a sign, you copy it, and it
    compares your landmarks to the reference and says *which* finger is wrong, so
    you get more than a pass/fail. Reuses ASL landmarks plus SignDesk practice mode.
13. **Gesture-triggered clip markers** ★. A streamer flashes a hand sign on camera,
    and Clip Studio / stream-clipper marks that moment as a clip. Reuses the ASL
    classifier and plugs into an existing money project.
14. **Climbing-wall hold mapper** ★★★. Photograph a wall, segment holds by color, tap
    the holds of a route, and it saves into Crux (which already stores hold color).
15. **Posture nag** ★. A webcam measures neck/shoulder angle while you study and sends
    an ntfy ping after N minutes of slouching. Reuses Limber's ntfy setup.
16. **Flip-bot listing vision** ★★★. Identify the item and its condition from Tradera
    listing photos (brand, damage, "is this the real thing"), then feed that into
    fair-value pricing. CV that could earn money.
17. **Hand-gesture 3D navigation** ★★. Fly around Stockholm in 3D with your hands, e.g.
    pinch-drag to pan, two hands to zoom and rotate (Minority Report style).
18. **Shadow puppet creatures** ★★. Classify hand-shadow shapes (dog, bird, rabbit) and
    swap them for animated creatures that copy your hand movements.
19. **Paper puzzle AR solver** ★★. Point at a sudoku or nonogram on paper. It finds
    the grid, reads the digits, and overlays the solution in the right perspective.
20. **Rep counter + workout race** ★★. Pushups/squats/pullups counted with form
    scoring (half reps don't count). Race friends live in game_terminal.
21. **Just Dance clone** ★★. Pose matching against a dance video, scored per beat. Any
    YouTube video becomes a level (pose-extract it offline).
22. **Face-mesh avatar** ★★. A VTuber-style puppet driven by your face and hands,
    usable as your game_terminal player avatar.
23. **Small-vocabulary lip reading** ★★★. Recognize ~20 words from mouth landmarks.
    Same sequence-model setup as the ASL word transformer, but with the face.
24. **Window bird feeder cam** ★★. Detects visitors and classifies species (Stockholm
    birds), keeps a daily log, and auto-clips the best frames.
25. **Real playing-card reader** ★★. Detect cards on a table and score poker hands /
    blackjack totals live. Useful for in-person game nights.
