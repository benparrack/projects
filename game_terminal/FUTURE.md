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

## Slope-style ball runner — shipped

See `server/games/slope.js` + `public/games/slope/client.js` + a vendored
`public/games/slope/three.min.js` (same r128 UMD build `3dgames/shooter/` already uses,
lazy-loaded via a dynamically injected `<script>` tag on mount so it never touches
`public/index.html` or loads for every other game). The first 3D game in the hub, and the first
auto-scrolling endless runner.

Went with the **shared-track race** design recommended below: every player in a room gets their
own ball on the same seeded procedural track (identical hazard layout for all), racing to
survive longest, with a live leaderboard by distance. Real-time tick loop, same
`tickIntervalMs`/`tick(room, ctx)` hook Slither pioneered.

**Design decisions made:**
- Track geometry is a deterministic hash `(seed, segmentIndex) -> float`, not a sequential PRNG
  replayed from 0 — lets either side query any segment's center-offset/hazard directly. Half-width
  narrows linearly from 6 down to a floor of 2.5 as distance increases; hazards are lateral
  kill-ranges per segment, always capped to leave at least 2.4 units of safe passage (no segment
  is unbeatable). A deliberate simplification of "winding track with red obstacles" — no
  elevation/jumps, continuous lateral position rather than lane-snapping — kept simple enough to
  guarantee the server and client agree on where the hazards are, which is the one property that
  actually matters for fairness (the server is sole collision authority).
- Round flow: `waiting -> countdown(3s) -> racing -> results(4s) -> waiting`, looping forever with
  a fresh seed each round. A player joining mid-race spectates and starts at the next countdown.
  Solo play works fine too — a lone player still gets a full round against the track alone.
- Client renders with prev/cur linear interpolation between the 20Hz broadcasts (the same jitter
  fix Slither needed), a chase camera, and disposes the renderer/cancels its animation loop and
  key listeners on unmount so switching games doesn't leak a WebGL context.

**Verified:** a standalone Node script (fake room/ctx, forcing phase transitions by moving
`phaseEndsAt` into the past rather than waiting on real timers) covering countdown->racing,
per-seed determinism, steering, results->waiting cycling, and independent multiplayer death: all
passed. The server/client track-generation code was diffed line-by-line to confirm they're
identical. Live-verified in a real Playwright/Firefox session: Three.js loads lazily without
touching any other game, the 3D scene actually renders (neon-green ball, narrowing track,
leaderboard), arrow-key steering works, and a death correctly triggers a fresh countdown/round
with the distance and leaderboard reset.

**Playtest feedback — fixed (2026-09-22):** steering snapped to full lateral speed almost
instantly instead of gliding, there weren't enough obstacles, and going off the track edge
looked like hitting a broken black void rather than falling off a platform. Fixed:
`LATERAL_ACCEL` 0.35→0.12 and `LATERAL_FRICTION` 0.85→0.82 (holding a direction now reaches
steady-state drift over ~10 ticks/~0.5s instead of ~4 ticks/~0.2s); hazard density raised; a new
"gap" obstacle type added (2-segment blocks with no ground, a cosmetic jump-arc over them on the
client); and a `deathReason` ('edge'|'hazard') added to player state so an edge death animates
the ball dropping away below a fixed death-point camera instead of freezing against the dark
background, while a hazard death still just dims in place. No solid wall geometry was added —
sides stay open air per the request. See commit `45b14c9`.

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

## Backgammon — shipped

See `server/games/backgammon.js` + `public/games/backgammon/client.js`. Standard rules, casual
scope: 2 seats, mirror-symmetric standard starting position, opening roll-off (reroll on a tie),
mandatory bar-entry before any other move, blot-hitting, blocked points (2+ enemy checkers),
bear-off only once all 15 checkers are home (both the exact-roll and "no checker further back"
overage cases), doubles = 4 dice, win on bearing off all 15.

**Known deviation, flagged deliberately:** "must use both dice if legally possible" is
approximated rather than fully solved — dice are played in whatever order the player picks, and
any die left unplayable after a move is simply forfeited, rather than the full lookahead a strict
tournament ruleset would use to force the die-order that maximizes total dice played. A real, if
narrow, rules gap — worth knowing about, not worth the complexity for a casual hobby-project game.
No doubling cube, no gammon/backgammon scoring multiplier, no bot support (see "Bot/CPU
opponents" above for the pattern if this ever gets added) — all out of scope for v1.

The client has no legal-destination highlighting (unlike Checkers) — backgammon's
blocking/bear-off legality was judged complex enough that duplicating it client-side risked
drifting out of sync with the server; the server is sole legality authority and an illegal
attempt just gets a rejection flash with a reason. The client does gate which points/bar piles
even *look* clickable to "your checkers, on your turn" (a fix made during the live-verification
pass — the first version made your own checkers look clickable on the opponent's turn too; harmless
since `playFrom` already no-ops without a turn check, but confusing to look at).

**Verified:** a standalone Node script covering starting position/piece counts, the opening
roll-off, turn alternation, out-of-turn and blocked-point rejection, blot-hit-to-bar +
mandatory re-entry, bear-off gating, both bear-off cases, and doubles giving 4 dice. Live-verified
in a real 2-tab Playwright/Firefox session: the board renders with correct starting counts, an
opening roll assigns the correct starting color, dice work correctly (spending a die updates the
board and leaves the correct one remaining), and turn passes correctly between seats.

**Playtest feedback — fixed (2026-09-22):** "I can't even tell whats going on, the gui needs to
be cleaned up a ton and it looks terrible." Full client-side visual revamp (server/wire protocol
untouched): points now render as real triangles (CSS `clip-path`) alternating between two dark
tones instead of a flat grid, checkers got a radial-gradient + shadow for depth, the board is
framed in a bordered panel with a clearer status/dice/seat layout, and clickable
points/bar/dice get an unmistakable glow outline so "yours to play right now" is obvious. Every
checker/point plays a short pop-in transition on render for a smoother feel. See commit
`644fb33`.

---

## TRON (light cycles) — shipped

See `server/games/tron.js` + `public/games/tron/client.js`. The second real-time tick-loop game
in the hub after Slither, and structurally its closest relative (continuous per-tick movement,
steering applied on the next tick, collision against persistent trails) — but round-based ("last
cycle alive wins") rather than Slither's persistent-world instant-respawn, since a last-one-alive
game only makes sense with a shared start/end.

**Design decisions made:**
- 64x48 grid at 10px/cell (matches Slither's canvas footprint), 90ms tick rate.
- Not seat-based — modeled as a dynamic collection of participants (closer to Slither's
  `st.snakes` than the 2-seat board games), supporting 2+ players: the first 4 spawn in the
  corners facing inward along the arena's long edges, 5th+ fall back to a randomized-but-retried
  position facing the center.
- Round flow: `waiting` (needs 2+) -> `countdown` (3s, locks in current players + bumps a
  `roundId` so clients wipe stale trails) -> `playing` -> `round_over` (4s winner/draw display) ->
  back to `waiting`.
- Crashed players' trails stay up as permanent obstacles for survivors (matching the arcade
  original), but a player who *leaves* the room has their trail removed entirely along with their
  record — an abandoned wall permanently blocking a public room's arena was judged worse than the
  minor unrealism of it vanishing.
- 180-degree reversal into the cell you just left is a silent no-op, not a death, per the genre's
  standard rule. Two movers landing on the same new cell in the same tick both die (head-on).
- Bandwidth: trails are sent in full only on join snapshot, ticks send only newly-added cells
  (`trailAdded`) — the same delta pattern Slither already uses for food.

**Verified:** a standalone Node script (fast-forwarding timers by mutating
`countdownEndAt`/`roundOverAt` directly rather than waiting on real timers) covering the full
countdown->spawn->play->round_over->waiting cycle, wall/self/other-trail death, the 180-degree-
reversal no-op, last-survivor-wins, a same-tick mutual out-of-bounds draw, and a same-cell head-on
collision killing both. Live-verified in a real 2-tab Playwright/Firefox session: the canvas
renders, arrow-key/on-screen-pad steering works, and a round correctly reached "ROUND OVER —
DRAW" with both trails visible on the board.

**Playtest feedback — fixed (2026-09-22):** "Should be much smoother instead of just blocks, the
trail should be seamless and turning should be much smoother and allow for more control." Root
cause: the client only redrew on server-tick arrival (~11Hz) with each trail cell as a separate
`fillRect` block. Added a `requestAnimationFrame` render loop that interpolates each racer's head
between the previous and current tick (same pattern as Slither/Slope), and the trail now renders
as one connected stroked path (round joins/caps) instead of individual squares. Server tick rate
also lowered 90ms→60ms for snappier steering registration. See commit `b3cb04c`.

---

## Pictionary — shipped

See `server/games/pictionary.js` + `public/games/pictionary/client.js`. Combines two mechanics
already in the hub: `drawing.js`'s live shared-canvas segment broadcast, and `hangman.js`'s
per-client hidden-word pattern (the current drawer sees the word, everyone else sees a blank/
length-only view until the round ends).

**Design decisions made:**
- Lobby auto-starts once 2 players are present; the drawer rotates through join order.
- The drawer picks from 3 random word options (a small built-in 40-word list — common, easily-
  drawable nouns, no dictionary file needed like Hangman's), with a 15s auto-pick fallback if they
  don't choose. Drawing round is 80s, server-authoritative (the server ends it on timeout, not
  just a client-side countdown display).
- Guesses are validated server-side (case/whitespace-normalized) and logged for everyone to see
  (right or wrong) without revealing the actual word to players who haven't gotten it yet — a
  correct guess broadcasts as "guessed the word!" only. Scoring: first correct guesser 3pts, later
  correct guessers 1pt each, the drawer gets a 2pt bonus if anyone guessed correctly at all. Round
  ends early once every non-drawer has guessed correctly, otherwise runs out the clock.
- The canvas/segment wire format is reused byte-for-byte from `drawing.js` so the client's
  rendering code is near-identical; canvas history clears at the start of each round.

**A real bug caught during live verification, not by the logic script:** the drawing toolbar
(color swatches, brush-size slider, CLEAR button) was being shown to every player, not just the
drawer — harmless functionally (the server already rejects `segment`/`clear` actions from anyone
but `st.drawerClientId`), but confusing UX, since a guesser could click a color or CLEAR and
nothing would visibly happen. Fixed by hiding the toolbar (`display: none`) whenever
`view.isDrawer` is false, re-evaluated every render.

**Verified:** a standalone Node script (globally stubbing `setTimeout`/`clearTimeout` to
fire-on-demand instead of waiting real wall-clock time) covering word-hiding, correct/incorrect
guess handling, drawer-can't-guess-own-word, no double-scoring, all-guessed early-end detection,
the word-choice and round timeouts, the post-round pause auto-advancing to the next drawer, and
leave-mid-round drawer rotation. Live-verified in a real 2-tab Playwright/Firefox session: a full
round start-to-finish — word auto-picked, a drawn stroke appeared, the word stayed hidden from the
guesser, a correct guess ended the round instantly with correct scoring (3pts guesser, 2pts
drawer) and the word revealed.

---

## Maze Dash (speedrun) — shipped

See `server/games/mazedash.js` + `public/games/mazedash/client.js`. The last of the 2026-09-21
new-games request — Ben deliberately left "speedrun game" open-ended and asked that it be
thought through rather than assumed, then deferred the final genre pick back to me. Landed on:
every player in the room races the SAME procedurally-generated maze (shared seed per round,
15x15, fixed top-left start / bottom-right exit), moving one grid cell at a time from the
top-left start to the bottom-right exit, fastest finish time wins. Purely event-driven — no tick
loop, unlike Slither/TRON/Slope — every state change happens synchronously inside `onMessage`.

**Design decisions made:**
- Maze generation is a randomized recursive backtracker (iterative, stack-based) seeded by a
  `mulberry32` PRNG — produces a "perfect" maze (exactly one path between any two cells), so it's
  connected and solvable by construction. Verified algorithmically anyway (an independent BFS
  solver, not just trusting the generator) as cheap insurance.
- **Server generates the maze once per round and sends the full wall data to clients**, rather
  than having clients regenerate it from the shared seed the way `slope.js`'s track math is
  duplicated client-side — a deliberate deviation from that precedent, since a maze generator has
  much more surface area to subtly diverge between two hand-kept-in-sync implementations than
  Slope's small arithmetic formulas did, and sending ~225 cells once per round is trivially cheap.
  Sidesteps the whole "must match" risk class entirely while keeping the server sole layout
  authority either way.
- A room needs just 1+ players — solo speedrunning for a personal best is a legitimate mode here,
  same call Slope made. Joining mid-race doesn't drop you into a race already in progress: you're
  added with `racingThisRound: false` and simply wait for the next `startRace`, which resets
  every currently-present player (including you) at the moment it fires.
- Live leaderboard: finished racers first (sorted by finish time), then still-racing racers
  (sorted by BFS distance-from-start, i.e. progress along the maze's one true path — free since
  the solver already computes it). Round ends when every enrolled racer finishes, or a 3-minute
  time cap elapses (a re-validated `setTimeout`, same stale-timer defensive pattern this hub's
  bot-move scheduling already uses, so an old round's timer can't force-end a newer round).

**A real bug caught during code review, not live testing:** `onLeave` gets no `ctx` (unlike
`onMessage`), so when a departure caused the round to end (the last still-racing player leaves),
the state mutation happened but nothing was ever broadcast to the remaining clients — they'd be
stuck on a stale "racing" view with no visible way to start a new race until some other action
happened to trigger a broadcast. Fixed by broadcasting manually via a `room.sendTo` loop on that
path, the same pattern `connect4.js`/`checkers.js` already use for their own leave-triggered
state changes.

**Verified:** a standalone Node script covering maze-generation determinism for a given seed, the
independent BFS solvability check, illegal-move (wall) rejection, legal-move position updates,
full-path traversal to the exit recording a finish time, a 2-player round reaching `results` with
correct leaderboard ordering, and a mid-race joiner correctly sitting out until the next round.
Live-verified in a real 2-tab Playwright/Firefox session: the maze renders correctly (walls, gold
exit cell, colored racer dot), arrow-key movement works and is correctly blocked by walls (a
down-move into a wall silently no-op'd while the following right-move succeeded), the live timer
counts up, and a second player joining mid-race showed up as a spectator without disrupting the
first player's in-progress run.

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
