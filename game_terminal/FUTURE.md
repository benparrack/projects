# Game Terminal — Future Plans

Backlog and design notes for what comes next in this project. See `README.md` for how to run
and deploy it, and `IDEAS.md` #11 (repo root) for where this project originated.

**Shipped so far:** Shared Drawing Canvas, Hangman, Checkers, Chess, Slither, Connect 4 — all
live at https://game-terminal.onrender.com.

---

## Slither.io-style game — shipped

See `server/games/slither.js` + `public/games/slither/client.js`. The first **real-time
tick-loop** game in the hub — unlike the four event-driven games (which only broadcast in
response to a player action), the server advances the world on its own schedule at 20Hz
regardless of whether anyone just sent a message.

**Design decisions made (see conversation that built this for the full discussion):**
- Bounded box arena (3000x3000 world units) — hitting the wall kills you, no wraparound.
- Instant respawn ~1.2s after death, at a fresh random spot with base length.
- Boost included: hold click or Space to move at 2x speed while draining length down to a
  floor (`MIN_BOOST_LENGTH`), dropping food behind as you go.
- Reuses the existing public-room / private-room-code model, same as the other four games.
- Self-collision: looping your head back into your own body kills you, same as hitting another
  snake. A distance-based grace buffer near the head (`SELF_COLLISION_SKIP_DIST`, in
  `server/games/slither.js`) exempts the body immediately behind the head so an ordinary turn
  (bounded by `TURN_RATE` anyway) can never clip your own neck — only a real tight loop back
  into your own trailing body counts. Distance-based rather than a fixed point count because
  points end up spaced by however far the snake moves per tick (`BASE_SPEED`, faster while
  boosting), not by the `POINT_SPACING` used only for the initial spawn tail — a point-count
  skip would give an inconsistent grace radius depending on speed.
- Shrink-to-zoom: the client (`public/games/slither/client.js`, `computeZoom`) zooms the camera
  out as your own snake's length grows past `START_LENGTH`, down to a floor (`ZOOM_MIN`), so a
  huge snake can still see threats coming instead of only ever seeing a tiny sliver of the
  arena around its head. Zoom scales the camera transform, snake/food radii, and nickname text
  together so everything stays visually consistent, not just spread out.
- Death drops the corpse as a trail of food pellets (every 4th body point becomes a pellet) so
  killing another snake is immediately rewarding.
- Snake body is stored as a full point-path per snake, trimmed to arc length each tick
  (`trimToLength`) rather than a fixed segment count — growth just raises the target length.
- Client renders every state broadcast directly (no client-side interpolation/prediction) —
  at 20Hz this reads as reasonably smooth for a casual game; revisit if it ever looks choppy
  under real network latency (Render free tier, phone on wifi, etc.) rather than the loopback
  testing done so far.

**Player-readiness polish pass (done):**
- **Bandwidth:** tick broadcasts now send a food add/remove delta (`foodAdded`/`foodRemoved`)
  instead of resending the full ~220-440-item food list every tick — the client
  (`public/games/slither/client.js`) keeps a local `foodMap` built from the one-time full list
  in the join snapshot, then applies deltas. Order matters: added is applied before removed,
  since a corpse-drop pellet and its being eaten can both happen within the same tick, and
  applying removed-first would leave it dangling as "still there" on the client when the server
  no longer has it. All point/food coordinates are also rounded to whole world units on the
  wire (`roundPoint`) — sub-pixel precision doesn't matter at this render scale, and shrinking
  the numbers cuts JSON size further. Snake body point arrays are still sent in full every tick
  (not delta-encoded) — see below.
- **Spawn fairness:** both initial spawn and respawn now pick a point that's clear of other live
  snakes' heads where possible (`pickSpawnPoint`, checks heads only, not full bodies, as a cheap
  approximation — retries `SPAWN_ATTEMPTS` times, falls back to the last attempt if the arena is
  too crowded). Before this fix, respawning directly into another snake's body — an instant,
  no-fault-of-your-own second death — was possible.
- **Mobile/touch:** canvas `pointerdown` no longer always engages boost. Touch has no "hover"
  state — every touch is a pointerdown just to steer-by-drag — so tying boost to canvas
  pointerdown made it impossible for a touch player to steer without also constantly boosting
  (draining length nonstop). Boost via canvas click-and-hold is now mouse-only
  (`ev.pointerType === 'mouse'`); a dedicated on-screen BOOST button (bottom-right of the
  canvas) works for touch (and mouse, and is also just a more discoverable affordance than
  "hold click" alone).
- **Respawn countdown:** the death overlay now shows "YOU DIED — RESPAWNING IN Ns…" using a new
  `respawnAt` field exposed per-snake in the broadcast view, instead of a static message.
- **Real bug caught by this pass, live in the browser (not by unit tests):** `respawn()` used to
  force `snake.boosting = false`. But the client only resends its boost message when the input
  *state changes* (edge-triggered) — so a player still holding boost across a death would have
  boost silently stop working after respawn, since from the client's point of view nothing
  changed. Fixed by simply not touching `snake.boosting` in `respawn()` — it should keep
  reflecting whatever the client's last message said, same as it does the rest of the time.
  Caught by noticing a boosted snake's length wasn't draining after what should have been a
  continuous boost across a death in a live two-tab test — see the "boost held across a death"
  test in the standalone verification script for the regression test this produced.

**Playtest feedback — needs fixing:**
- **Self-collision feels bad and should be disabled.** Ben's own playtesting verdict: it's "a
  step in the wrong direction" — kill it rather than tune it. Revert to the original design
  (only walls and other snakes kill you; your own tail is harmless), i.e. remove the
  self-collision check block in `server/games/slither.js`'s `tick()` (the one that calls
  `selfCollisionStartIndex` and checks `a`'s own points) while leaving the separate
  other-snake-collision check intact. `SELF_COLLISION_SKIP_DIST`/`selfCollisionStartIndex` and
  their unit tests (self-collision kill + grace-buffer-survives-normal-turn, in the standalone
  verification script) should come out too rather than leaving dead code around.
- **Gameplay reads as laggy/jittery in real play** (loopback dev testing during the build didn't
  surface this). Prime suspect worth checking first: the client only redraws when a network
  message actually arrives (`applyTickView`/`applySnapshotView` call `draw()` directly — there's
  no separate `requestAnimationFrame` loop), so rendering smoothness is directly at the mercy of
  WebSocket delivery timing, not just the server's own steady 20Hz tick. Real network delivery
  isn't perfectly evenly spaced the way the local dev-server loopback testing was, so this could
  read as jitter even though the server ticks on time. Two independent things worth trying:
  (1) decouple rendering from message arrival — a `requestAnimationFrame` loop that redraws from
  whatever the latest received state is, so a late/bunched-up network message doesn't directly
  stall a frame; (2) actual client-side interpolation between the last two received snapshots
  (already flagged as not done in the original design notes above) so movement looks continuous
  between the 50ms server ticks instead of snapping. Worth measuring on the real deployed Render
  instance (not loopback) before assuming which of these actually matters — might be one, both,
  or something else (e.g. actual tick-timer drift under server load) entirely.

**Remaining gaps / possible follow-ups:**
- Snake body point arrays are still sent in full every tick (not delta-encoded like food) —
  the natural delta would be "new head point + tail points dropped" since a snake's path only
  changes at the head/tail each tick, but wasn't done this pass: more complex (needs to handle
  respawn as a full reset, a snake's first appearance to a new joiner, etc.) for what's likely a
  smaller win than the food delta at hobby-project player counts. Revisit if it ever matters.
- No minimap — with shrink-to-zoom now in, a huge snake can see a wide radius around itself but
  still has no whole-arena overview. Could be added as a small corner inset if it turns out to
  matter at real playtime lengths.
- No boost cooldown/regeneration mechanic beyond the simple floor — fine as-is, but the kind of
  thing a real playtest might reveal wanting.

**Architecture note:** `server/roomManager.js`'s `Room` constructor now supports an optional
`tick(room, ctx)` + `tickIntervalMs` on a plugin — `RoomManager`/`Room` calls it on that
interval for as long as the room has ≥1 client, and cleans up the interval when a private room
is destroyed. This is the generic hook the original design note below asked for; any future
real-time game plugs into it the same way slither does, without another core change.

---

## Connect 4 — shipped

See `server/games/connect4.js` + `public/games/connect4/client.js`. Standard rules: 7x6 grid,
gravity-drop columns, first to 4-in-a-row (horizontal/vertical/either diagonal) wins, a full
board with no winner is a draw. Reuses the Checkers/Chess two-seat plugin pattern directly
(`sit`/`leaveSeat`/`resetGame`, a `moveRejected` event for illegal drops) — the only new
interaction is a row of column "drop" buttons above the board instead of click-to-select on the
board itself, since Connect 4's only real decision is "which column", not "which cell". Board
cells stay purely visual (plus `data-row`/`data-col`, per this hub's grid-game convention) so
automated tests can still read placed pieces directly.

Verified with a standalone-script test suite (seat/turn flow, gravity stacking, out-of-turn and
full-column rejection, horizontal/diagonal win detection, draw detection, leave/reset flow) plus
a live two-tab Playwright/Firefox session playing a full game to a win and a reset. Notably, the
draw-detection test needed a real constructed fixture rather than a quick hand-built one — a
naive "checkerboard" full-board pattern turns out to still contain 4-in-a-row on the diagonals
(the (r+c) parity is invariant along one of the two diagonal directions), so the test instead
backtracks a fill that's verified 4-in-a-row-free in all four directions before handing it to
the real plugin logic for the actual draw check.

**Known bug (found via playtesting): the column drop arrows don't line up with the board.**
Root cause: `public/games/connect4/client.js`'s `colRow` (the row of ↓ buttons) is styled with
just `gridTemplateColumns: repeat(COLS, CELL)` and no gap/padding, while `board` right below it
uses the same column template *plus* `gap: 4px` and `padding: 4px`. That extra 4px-per-column
gap and 4px edge padding on the board (but not on the button row above it) means button N and
board column N drift further apart the further right you go — button 0 is close but not exact,
and by column 6 the offset has compounded across 6 gaps. Fix: give `colRow` the same `gap`/
`padding` the board uses (or wrap both in a shared grid container with one column template
covering both rows, which would also structurally guarantee they can't drift apart again).

---

## Chess — playtest feedback, two feature requests

Both found via playtesting; neither is a correctness bug, just missing UX polish.

- **Move history, shown to the right of the board.** Nothing tracks this today —
  `server/games/chess.js`'s state has no history array at all. Needs: a `st.moveHistory` list,
  appended to on every successful move in the `move` handler (alongside the existing board
  mutation), included in `buildPublicState`/`broadcastState` like every other field. Simplest
  first pass: record `{from, to, piece, captured, promotion, castle}` per move and render it
  client-side as plain coordinate notation ("e2 → e4"); full SAN (`Nf3`, `O-O`, `exd5`, check/
  mate suffixes) is a nice stretch goal but real work (disambiguation when two pieces of the
  same type can reach the same square, etc.) — don't block the first version on it.
- **Legal-move dots when a piece is selected.** The client (`public/games/chess/client.js`)
  currently just tracks `selected = {r, c}` and fires the move directly on the second click —
  it has no idea which destination squares are actually legal, so it can't highlight them. The
  server already computes exactly this via `getLegalMoves(board, color, st)` in
  `server/games/chess.js` (used today only to validate a submitted move) — reuse it rather than
  porting move generation to the client: have `buildPublicState` include the legal moves for
  whichever color's turn it currently is (both players receive the same shared broadcast
  already, same as Checkers/Connect 4, so this is just one more field), and have the client
  filter that list by `selected` to get the destination squares to render a dot on. Avoids ever
  needing chess rules duplicated client-side.

---

## Slope-style ball runner — proposed, not started

**Pitch:** A 3D endless runner modeled on the browser game "Slope" — you control a neon-green
ball that auto-moves forward and downhill along a winding, narrow, procedurally-generated
track, steering left/right to avoid red obstacles, gaps, and the track edges. Speed ramps up
the longer you survive; falling off or hitting a hazard ends the run. Score is distance
traveled. (Researched via web search — the original is a single-player Unity/WebGL game by
various mirror sites; no source available to reference directly, just the mechanic.)

**Why this one:** A genuinely different genre from everything else in the hub — the other
games are all turn-based board games, a drawing canvas, or Slither's top-down 2D arena. This
would be the first *3D* game and the first with an auto-scrolling "endless runner" pace (the
player never stops moving forward, unlike Slither where the player fully controls speed via
boost) — a good stretch for the client rendering side even at prototype fidelity.

**Design question to resolve before starting:** the original Slope is single-player, but this
hub is built entirely around shared multiplayer state — every existing game (including Slither)
puts multiple people in the same room seeing each other. Two ways to reconcile that:
- **Shared-track race (recommended):** everyone in a room gets their own ball on the *same*
  seeded procedural track (so obstacles are identical for all), racing to survive longest/go
  farthest, with a live leaderboard by distance — genuinely multiplayer, and reuses Slither's
  `tick(room, ctx)`/`tickIntervalMs` real-time hook almost directly (continuous forward motion
  + steering input is structurally the same problem Slither already solved).
- **Solo run in a shared room:** each player's run is fully independent (no shared track seed,
  no interaction between runs), the room is just a lobby/leaderboard around otherwise
  single-player sessions. Simpler, but doesn't use the room model for much beyond a scoreboard.

**What it needs when built:**
- 3D rendering: likely Three.js (`3dgames/shooter/` in this repo already vendors a
  pre-module `three@0.128.0` build for exactly this — file:// / no-bundler friendliness — worth
  reusing that same approach here, though game_terminal is server-hosted so the CORS-avoidance
  reason doesn't strictly apply; still worth matching for consistency and because the vendored
  build is already proven to work in this repo).
- Procedural track generation: a seeded RNG so a shared-track race can give every client in a
  room the identical sequence of turns/gaps/hazards from just a shared seed, rather than
  streaming full geometry over the wire.
- Auto-forward movement + left/right steering input — conceptually close to Slither's
  angle-based steering, but constrained to lane-relative left/right rather than a free angle.
- Collision/fall-off detection against the track's actual (bending, narrowing) geometry, not
  just a flat bounding box.
- Speed ramp over time/distance, and a death/respawn-or-round-end flow — if it's a shared race,
  probably "round ends when everyone's died or after a time cap" rather than Slither's instant
  individual respawn, since a race implies a shared start/end rather than a persistent world.

---

## Bot/CPU opponents — proposed, not started

**Pitch:** Let a solo player fill an empty seat with a bot instead of waiting for a second
human to show up — "PLAY VS BOT" alongside the existing "PLAY RED"/"PLAY YELLOW" etc. buttons.
Directly serves this hub's actual biggest usability gap: every game right now needs someone
else online at the same time, which is a real barrier for a hobby project without a built-in
player base.

**Why this one:** Ties directly into `IDEAS.md` #5 (Playable Chess/Checkers Engine with AI
Opponent — minimax + alpha-beta pruning, material + positional eval), which was scoped as a
separate single-player page — this is the same core algorithm work, just plugged into the
existing multiplayer hub's seats instead of a standalone page. One AI effort serves both.

**Which games this applies to:**
- **Checkers, Chess, Connect 4 (recommended first):** the two-seat turn-based games are the
  natural fit — a bot just occupies the empty seat and moves on its turn. Straightforward to
  reason about since the plugin already fully validates state; the bot only needs to *choose*
  a legal move, not enforce rules.
- **Slither:** a different flavor — not a "seat" to fill, but ambient wandering bot snakes with
  simple steering (seek nearest food, avoid walls, maybe flee larger snakes) so a public room
  doesn't feel like an empty arena when nobody else happens to be online. Reuses the existing
  `tick(room, ctx)` loop: a bot snake is just a `st.snakes` entry whose `targetAngle`/`boosting`
  get set by a small policy function each tick instead of by a real client's `onMessage`.
  Different problem from the turn-based games' move-selection bots, so likely a separate,
  later pass rather than bundled with the first three.
- **Hangman:** doesn't obviously fit — the core loop needs someone to *pick* a word, and a bot
  picking from a wordlist is easy but a bot *guessing* letters well is a different, less
  interesting problem. Low priority, possibly skip entirely.
- **Drawing canvas:** no opponent concept, doesn't apply.

**Architecture question to resolve before starting:** bots aren't real WebSocket clients, so
they can't just occupy a normal `room.clients` entry (which expects a live `ws` to send to).
For the turn-based games, the simplest approach is entirely inside the plugin: a seat holds a
sentinel value (e.g. `players.red = 'BOT'`) instead of a clientId, and when `st.turn` becomes
the bot's color, the plugin itself computes and applies a move (on a short delay for pacing —
instant bot moves feel jarring, a human "thinking" delay of even a few hundred ms reads better)
rather than waiting for an `onMessage` that will never come. Needs one new client action (e.g.
`sit` with `seat` + a `bot: true` flag, or a dedicated `addBot` action) and a small addition to
each plugin's `onMessage`/turn-advance logic to trigger the bot's move — no core room/connection
change anticipated, this stays inside the existing plugin pattern.

**What it needs when built:**
- Move-selection AI per turn-based game: start simple (random legal move, or a shallow
  minimax + material-count eval per `IDEAS.md` #5) before investing in stronger eval/deeper
  search — get "a bot that plays legally and isn't trivially dumb" working first.
- A difficulty knob is a natural stretch goal (search depth is the easy lever for
  chess/checkers) but not needed for a first pass — one fixed difficulty ships first.
- UI: a "PLAY VS BOT" button per empty seat, and the seat label should read something like
  "RED: (bot)" instead of a nickname once filled.
- Slither's ambient bots (if/when tackled) need their own tuning pass — how many bots per
  room, how aggressive their steering is, whether they respawn like real players.

---

## Other game ideas mentioned

`IDEAS.md` #11's original "lighter-weight synchronized game board" alternative
(tic-tac-toe/Connect4) is now done via Connect 4 above.

---

## Architecture recap (for whoever/whatever builds the next game)

- **Adding an event-driven game** (like the first four): new `server/games/<name>.js` +
  `public/games/<name>/client.js`, one line in `server/games/index.js`, one entry in
  `public/hub.js`'s `GAMES` array. Core room/connection code
  (`server/roomManager.js`, `server/protocol.js`, `server/index.js`) shouldn't need to change.
- **Adding a real-time tick-loop game** (like slither): same plugin/registry/hub wiring as
  above, plus export `tickIntervalMs` (ms between ticks) and `tick(room, ctx)` from the plugin.
  `Room` (in `server/roomManager.js`) calls it on that interval automatically whenever the room
  has at least one client — no other core change needed, this hook already exists.
- **Optional plugin hooks available:** `onJoin(room, client)` / `onLeave(room, client)` for
  seat/roster bookkeeping, `serializeSnapshot(room, client)` for per-recipient hidden state
  (Hangman uses this to hide the secret word from guessers while showing it to the picker;
  Checkers/Chess ignore the `client` argument since there's no hidden info).
- **Two-seat board game pattern** (Checkers/Chess): `sit`/`leaveSeat`/`resetGame` actions,
  click-to-select-then-click-destination interaction, a `moveRejected` event so illegal
  attempts flash visible feedback instead of silently doing nothing, and `data-row`/`data-col`
  attributes on board cells (added specifically to make browser-automation testing reliable —
  keep this convention for any future grid-based game).
- **Verification that's worked well:** game *rules/logic* (move generation, mandatory capture,
  castling, checkmate detection, etc.) is fastest and most reliable to verify with a standalone
  Node script that `require()`s the plugin directly and fakes a minimal room/ctx — much better
  than driving a browser for pure logic bugs. Browser automation (Playwright/Firefox, two tabs)
  is for verifying the actual UI wiring and multi-client sync, not core rules correctness.
