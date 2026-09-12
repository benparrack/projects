# Game Terminal — Future Plans

Backlog and design notes for what comes next in this project. See `README.md` for how to run
and deploy it, and `IDEAS.md` #11 (repo root) for where this project originated.

**Shipped so far:** Shared Drawing Canvas, Hangman, Checkers, Chess — all live at
https://game-terminal.onrender.com.

---

## Next up: Slither.io-style game

The biggest remaining lift. Unlike the four games shipped so far — which are all
**event-driven** (the server only broadcasts in response to a player action: a stroke, a
letter guess, a move) — a slither.io-style game needs the server to drive updates on its own
schedule, independent of player input. That's a genuinely different core pattern, not just
another plugin file:

- **Server tick loop**: something like `setInterval` at ~20-30Hz advancing every snake's
  position, checking collisions, and broadcasting the current world state each tick — rather
  than reacting only to incoming messages.
- **Client input model**: players send steering direction (e.g. mouse position or turn angle)
  continuously or on change; the server is authoritative on where snakes actually end up.
- **Client-side interpolation**: smooth rendering between server ticks so movement doesn't
  look choppy at the tick rate.
- **Collision detection**: snake-vs-wall (or wrap-around?), snake-vs-snake body, snake-vs-food.
- **Growth mechanic**: eating food (and/or defeated snakes' remains) makes you longer.
- **Arena**: fixed bounds vs a larger scrollable world with a camera/viewport.

**Design questions to resolve when we start building this:**
- Arena shape/size — bounded box (die at the wall) or wraparound?
- What happens on death — respawn fresh, or removed until you rejoin?
- Boost mechanic (classic slither.io lets you speed up at the cost of shrinking) — include it?
- Leaderboard / current-length display?
- Does this fit the existing public-room-plus-private-room-code model, or does a free-for-all
  game want just one shared arena per room regardless of code?

**Architecture implication:** this will likely need a small, deliberate addition to the core
(`server/roomManager.js` / `server/index.js`) — e.g. an optional `tick(room, ctx)` hook that
`RoomManager` calls on an interval for rooms whose game plugin defines one — rather than
being purely self-contained the way the plugin interface has worked for the first four games.
Worth designing that hook generically enough that a future real-time game doesn't need its own
bespoke core change again.

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
