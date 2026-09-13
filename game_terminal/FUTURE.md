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
- No self-collision in v1 (only wall and other-snake-body kill you) — turning into your own
  tail is harmless. Could be added later with a grace buffer near the head if it's missed.
- Death drops the corpse as a trail of food pellets (every 4th body point becomes a pellet) so
  killing another snake is immediately rewarding.
- Snake body is stored as a full point-path per snake, trimmed to arc length each tick
  (`trimToLength`) rather than a fixed segment count — growth just raises the target length.
- Client renders every state broadcast directly (no client-side interpolation/prediction) —
  at 20Hz this reads as reasonably smooth for a casual game; revisit if it ever looks choppy
  under real network latency (Render free tier, phone on wifi, etc.) rather than the loopback
  testing done so far.
- Camera follows the player's own head at 1:1 zoom, no minimap.

**Known gaps / possible follow-ups:**
- No self-collision (see above) — could be a difficulty toggle later.
- No shrink-to-zoom-out as you grow (classic slither.io does this so huge snakes can still see
  threats coming) — arena is small enough at 3000x3000 that it's not critical yet.
- Bandwidth: every tick broadcasts every snake's full point array and the full food list. Fine
  at hobby-project player counts; would need delta-encoding or spatial culling (only send
  what's near each viewer) to scale further.
- No mobile/touch-specific control affordance beyond the generic pointer events (should mostly
  work via touch already since input is pointer-event-based, but untested on an actual phone).

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
