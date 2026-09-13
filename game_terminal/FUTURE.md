# Game Terminal — Future Plans

Backlog and design notes for what comes next in this project. See `README.md` for how to run
and deploy it, and `IDEAS.md` #11 (repo root) for where this project originated.

**Shipped so far:** Shared Drawing Canvas, Hangman, Checkers, Chess, Slither — all live at
https://game-terminal.onrender.com.

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

**Remaining gaps / possible follow-ups:**
- Snake body point arrays are still sent in full every tick (not delta-encoded like food) —
  the natural delta would be "new head point + tail points dropped" since a snake's path only
  changes at the head/tail each tick, but wasn't done this pass: more complex (needs to handle
  respawn as a full reset, a snake's first appearance to a new joiner, etc.) for what's likely a
  smaller win than the food delta at hobby-project player counts. Revisit if it ever matters.
- No minimap — with shrink-to-zoom now in, a huge snake can see a wide radius around itself but
  still has no whole-arena overview. Could be added as a small corner inset if it turns out to
  matter at real playtime lengths.
- No self-collision difficulty toggle, no boost cooldown/regeneration mechanic beyond the simple
  floor — both are fine as-is but are the kind of thing a real playtest might reveal wanting.

**Architecture note:** `server/roomManager.js`'s `Room` constructor now supports an optional
`tick(room, ctx)` + `tickIntervalMs` on a plugin — `RoomManager`/`Room` calls it on that
interval for as long as the room has ≥1 client, and cleans up the interval when a private room
is destroyed. This is the generic hook the original design note below asked for; any future
real-time game plugs into it the same way slither does, without another core change.

---

## Other game ideas mentioned

- **Tic-tac-toe / Connect4-style board game** — called out in `IDEAS.md` #11's original pitch
  as a lighter-weight "synchronized game board" alternative. Would reuse the same turn-based,
  two-seat plugin pattern as Checkers/Chess almost directly (seat/turn model, click-to-place,
  win detection). Good candidate for a quick, low-effort addition if we want something small
  between bigger builds.

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
