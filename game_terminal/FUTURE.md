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
- ~~Self-collision~~ — originally shipped (looping your head back into your own body killed you,
  same as hitting another snake), later removed per playtest feedback; see below.
- Shrink-to-zoom: the client (`public/games/slither/client.js`, `computeZoom`) zooms the camera
  out as your own snake's length grows past `START_LENGTH`, down to a floor (`ZOOM_MIN`), so a
  huge snake can still see threats coming instead of only ever seeing a tiny sliver of the
  arena around its head. Zoom scales the camera transform, snake/food radii, and nickname text
  together so everything stays visually consistent, not just spread out.
- Death drops the corpse as a trail of food pellets (every 4th body point becomes a pellet) so
  killing another snake is immediately rewarding.
- Snake body is stored as a full point-path per snake, trimmed to arc length each tick
  (`trimToLength`) rather than a fixed segment count — growth just raises the target length.
- **Girth grows with length, not just the tail.** Eating used to only extend length at a fixed
  radius; a `radiusFor(snake)` formula in `server/games/slither.js` now scales each snake's
  radius from `BASE_SNAKE_RADIUS` (9) up to `MAX_SNAKE_RADIUS` (13) over `RADIUS_GROWTH_LENGTH`
  (1800) length gained past `START_LENGTH`, then caps — "slightly larger, nothing insane" per
  Ben's ask. Collision distance between two snakes now scales with both snakes' current radii
  (`(aRadius + bRadius) * 0.8`, matching the old fixed `SNAKE_RADIUS * 1.6` exactly at base
  radius) and a snake's own eating reach scales with its own radius, so hitbox and reach stay
  consistent with the rendered size rather than a fatter snake looking bigger but hitting like a
  thin one. Client (`public/games/slither/client.js`) mirrors the same formula by hand
  (`computeRadius`) to size the rendered stroke width — same pattern as `START_LENGTH`/
  `computeZoom` already being kept in sync by hand (no shared module in this repo).
- ~~Client renders every state broadcast directly (no interpolation/prediction)~~ — later found
  to read as jittery in real play; client now runs a `requestAnimationFrame` loop with
  tick-to-tick interpolation, see the fixed playtest feedback below.

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

**Playtest feedback — fixed:**
- **Self-collision removed.** Ben's playtesting verdict was that it was "a step in the wrong
  direction" — reverted to the original design (only walls and other snakes kill you; your own
  tail is harmless). Removed the self-collision check block from `tick()` in
  `server/games/slither.js` along with `SELF_COLLISION_SKIP_DIST`/`selfCollisionStartIndex`
  (dead code, no persisted tests referenced them).
- **Jitter/lag fixed.** `public/games/slither/client.js` now runs a `requestAnimationFrame` loop
  that redraws every frame from the latest state (`currentRenderView()`), decoupled from
  WebSocket message arrival, and interpolates each live snake's points between the last two tick
  views (`interpolateSnakes`) so motion reads continuous between the server's 50ms ticks instead
  of snapping. A distance-based teleport guard (`TELEPORT_DIST_SQ`) skips interpolation across a
  respawn jump. Verified live: sampling `window.__slitherDebug.getRenderView()` across animation
  frames showed smooth fractional-unit sub-tick movement (e.g. head.x advancing 2082.24 →
  2082.96 → 2083.64 → … every frame rather than only on tick boundaries).

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

**Fixed (found via playtesting): the column drop arrows didn't line up with the board.** Root
cause was `colRow` (the row of ↓ buttons) missing the `gap`/`padding` that `board` had, so the
offset compounded further right across the 7 columns. Fix: gave `colRow` the same `gap: 4px` /
`padding: 0 4px` the board uses. Verified live (two-tab Playwright/Firefox session) — a dropped
piece lands exactly under its arrow in every column, including column 7.

---

## Chess — playtest feedback, shipped

Two UX requests from playtesting, both done:

- **Move history**, shown to the right of the board. `st.moveHistory` in `server/games/chess.js`
  records `{from, to, piece, color, captured, promotion, castle}` per move, included in
  `buildPublicState`. Client (`public/games/chess/client.js`) renders it as plain coordinate
  notation ("e2→e4", "f3xe5" for captures, "O-O"/"O-O-O" for castling) in a scrolling panel next
  to the board. Full SAN (disambiguation, check/mate suffixes) stayed a non-goal per the original
  plan.
- **Legal-move dots when a piece is selected.** `buildPublicState` now includes `legalMoves` for
  whichever color's turn it is (via the existing `getLegalMoves`), and the client filters that by
  the selected square to render a dot on empty destinations or a ring around a capturable piece —
  no move generation duplicated client-side.

Verified with a standalone script (scholar's mate move-by-move: history entries, capture
recording, checkmate detection, legal-move count/ownership at the opening position) plus a live
two-tab Playwright/Firefox session confirming the dots, capture ring, and history panel render
correctly during real play.

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

## Bot/CPU opponents — shipped (Checkers, Chess, Connect 4)

Lets a solo player fill an empty seat with a bot instead of waiting for a second human — a
"PLAY VS BOT" button sits alongside each game's existing "PLAY RED"/"PLAY WHITE"/etc. seat
buttons, visible even once the viewer has already sat down themselves (that's the whole point:
one lone human should be able to fill the *other* seat without waiting on anyone).

**Design decisions made:**
- **Sentinel seat value**, exactly as originally proposed: `st.players.red = 'BOT'` instead of a
  real clientId, in `server/games/{checkers,chess,connect4}.js`. No core room/connection change —
  entirely inside each plugin's existing `sit`/`onMessage` pattern.
- **New client action `sit` with `seat` + `bot: true`** (the first of the two options the
  original writeup considered) — reuses the existing `sit` handler rather than adding a parallel
  `addBot` action. A second new action, **`removeBot`**, clears a bot back to an empty seat (a
  human can't "sit" over the sentinel via the normal seat-taken check, so this is the only way to
  free it — e.g. to sit down there themselves).
- **Move selection is uniform-random over the legal-move set** (`getAllMovesForColor` /
  `getLegalMoves`, whichever the game already exposes) — no material-count eval, per the original
  scope note that a difficulty knob/stronger eval was explicitly out of scope for a first pass.
  Checkers' bot correctly respects `mustContinueFrom` (filters candidates to the forced piece
  during a multi-jump chain) rather than picking any capture.
- **"Thinking" delay** of 400-900ms (randomized) before a bot moves, via `setTimeout` — instant
  moves read as jarring, matching the original ask. The scheduling function re-validates
  phase/turn/seat when the timer actually fires rather than trusting state captured at schedule
  time, so a stale or duplicate schedule (e.g. two actions both landing on the same pending bot
  turn) harmlessly no-ops instead of double-moving. A capturing multi-jump or a promotion doesn't
  break the chain — the scheduler reschedules itself for the continuation the same way.
- **Shared move-application helper per game** (`applyCheckersMove`/`applyChessMove`, Connect 4's
  `applyDrop`): the existing human `onMessage` 'move' branch was refactored to call the same
  function a bot move calls, so a bot's move goes through identical post-move bookkeeping (capture
  chains, kinging, check/checkmate detection, castling rights, clocks) rather than a
  separately-maintained copy that could drift out of sync.
- **Chess clocks**: when a time control is active, a bot's "thinking" delay charges its clock the
  same way a human's move does (`applyClockElapsed` before the bot moves) — a bot can in principle
  still lose on time, kept consistent rather than special-cased, even though the short delay makes
  it unlikely in practice.
- UI: seat label reads e.g. `RED: (bot)` once filled (`nicknameFor` special-cases the `'BOT'`
  sentinel in each client), plus the `REMOVE BOT` button described above.

**A real bug caught during live verification, not by the logic script:** the first version gated
the "PLAY VS BOT" button behind the same `!seat` condition as the human "PLAY RED" button (i.e.
only shown when the viewer isn't seated in *either* seat) — which defeated the entire point, since
a lone human who'd already sat down had no way to add a bot to the other seat. Fixed by splitting
the condition: the human "PLAY \<color\>" button still requires `!seat` (can't occupy two seats),
but "PLAY VS BOT" now shows for any empty seat regardless of whether the viewer is seated. Caught
by scripting the actual click flow in a live Playwright/Firefox session and noticing the button
was simply missing after sitting down — not visible from the logic-only tests, which only exercise
the server plugin directly and never touch the client's render conditionals.

**Verified:** standalone Node scripts (`require()` each plugin directly, fake a minimal
room/ctx) for bot-vs-human move application and full bot-vs-bot self-play to completion/timeout in
all three games (Connect 4 played to a real win in self-play; Chess and Checkers self-play run to
dozens of moves without error — see the remaining-gaps note below on why random-bot Checkers/Chess
games don't reliably reach game_over in a bounded self-play session). Live-verified in a real
Playwright/Firefox session for all three: "PLAY VS BOT" appears per empty seat (including once
already seated), the seat label reads "(bot)", a human move triggers a delayed bot reply (Connect 4
piece count 1→2 after a human drop; Checkers black's 2,1→3,0 followed by the bot's own 5,2→4,3;
Chess move history recording `1. e2→e4 a7→a5` after a human opening move).

**Scope not built (unchanged from the original proposal, still open):**
- **Slither's ambient wandering bots** — a different problem (no "seat" to fill, steering policy
  each tick rather than move-selection per turn) — not attempted this pass.
- **Hangman** — skipped per the original writeup's own call (a bot *guessing* letters well is a
  different, less interesting problem than picking a word).
- **A difficulty knob / stronger eval** (material-count, shallow minimax per `IDEAS.md` #5) — still
  open; ships as a clear next step on top of the uniform-random move selection now in place.

**Remaining gap surfaced by this work:** two random-move bots left playing each other in Checkers
or Chess can run for a very long time (observed 50+ ticks / 40+ moves without reaching
`game_over` in a bounded test) because neither game has draw-by-repetition/move-limit detection —
a pre-existing gap (chess.js's own file header already notes "No draw-by-repetition/50-move-rule
detection"), just newly exercisable by bot-vs-bot play where neither side will ever resign or get
bored. Not fixed here (real scope creep beyond the bot feature itself); worth a look if bot-vs-bot
play becomes a real usage pattern.

---

## Spades — shipped

See `server/games/spades.js` + `public/games/spades/client.js`. 4 seats, fixed partnerships
(NORTH+SOUTH vs EAST+WEST), standard American bidding/scoring: bid 0-13 per player (0 = nil),
spades always trump, must follow suit, spades can't lead until broken (or the leader's hand is
all spades). Made bid scores `10*bid + 1/overtrick`, failed bid loses `10*bid`; nil made is a
+100 bonus, nil failed is -100 (independent of the team bid math); every 10 accumulated
"bag" overtricks costs a team -100 (remainder kept, not reset to 0). First team to 500 wins.
Doubling and a losing-score cutoff are out of scope for this first version.

Hidden info (each seat's own hand) is handled the same way Hangman hides the secret word: state
is built per-recipient (`buildPublicStateFor(room, forClientId)`) and broadcast via a per-client
loop rather than one shared `ctx.broadcast`, since a shared broadcast has no way to vary payload
per recipient.

**Verified:** a standalone Node script driving all 4 seats through `onMessage` directly —
bidding transition, follow-suit/spades-broken rejection, trick-winner resolution (including a
low spade beating a high led-suit card), made/failed-bid scoring, nil bonus/penalty, the 10-bag
penalty threshold, and a full game reaching 500. Live-verified in a real 4-tab Playwright/Firefox
session: seating, bidding UI gated to the current bidder only, bid-turn-order, the trick table
updating live across all 4 tabs, and legal-card highlighting on the current player's hand.

## Hearts — shipped

See `server/games/hearts.js` + `public/games/hearts/client.js`. 4 individual seats (no
partnerships), standard rules: pass 3 cards each hand (left/right/across/none, cycling every 4
hands), the 2 of clubs must lead the first trick, hearts can't be led until broken, no
heart/queen-of-spades may be played on the first trick unless forced. Each heart taken is 1
point, the queen of spades is 13; lowest cumulative score is best. "Shooting the moon" (taking
all 26 points in one hand) flips the hand's scoring — the shooter scores 0, everyone else +26.
Game ends once someone crosses 100 points; the winner is whoever has the *lowest* score at that
point, not necessarily whoever crossed 100.

Same per-client hidden-hand pattern as Spades (`buildPublicStateFor` + a per-recipient broadcast
loop). The server also includes a `legalCardsHint` in the current turn-holder's own state
payload (mirroring Chess's `legalMoves`) so the client can grey out illegal cards without
duplicating the suit/point rules client-side.

**Verified:** a standalone Node script covering pass-direction cycling through all 4 hands,
2-of-clubs-must-lead, hearts-not-led-before-broken, no-points-on-first-trick, trick-winner
resolution, shoot-the-moon point math, and the "lowest score wins once someone crosses 100"
end condition — including a full 13-trick hand played end-to-end through real `onMessage` calls.
Live-verified in a real 4-tab Playwright/Firefox session: simultaneous passing (all 4 submit
before any hand exchanges), the 2-of-clubs-only legal-card restriction on the very first play of
a hand, and trick display syncing live across tabs.

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
