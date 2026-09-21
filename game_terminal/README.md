# Game Terminal

**Play now: https://gameterminal.onrender.com** (free-tier hosting — the first load after a
period of inactivity can take 30-60 seconds to cold-start, see note below).

A retro terminal-styled hub for real-time multiplayer mini-games. Pick a game, join the
public room or a private room via a short code, and play live with anyone else connected.

Unlike the other demos in this repo, this one needs an actual running server — it can't be
opened as a local file, since multiple browser tabs need to talk to each other through
something in the middle.

## Games

- **Shared Drawing Canvas** — everyone in a room draws on the same canvas in real time.
- **Hangman** — one player picks a word, everyone else guesses letters.
- **Checkers** — standard American rules, mandatory capture/multi-jump/kinging.
- **Chess** — standard rules.
- **Slither** — real-time multiplayer snake: steer with the mouse, hold click/Space to boost,
  eat food to grow, avoid walls and other snakes. The first game driven by a server-side tick
  loop rather than only reacting to player messages (see `FUTURE.md`).
- **Connect 4** — standard rules, 7x6 grid, click a column to drop a piece.

Checkers, Chess, and Connect 4 all support a "PLAY VS BOT" seat button for solo play against a
CPU opponent — see `FUTURE.md`'s "Bot/CPU opponents" section. (This list predates several other
games already shipped in `server/games/`/`public/games/` — see those directories or
`TODO_FIRST.md` for the full current roster.)

More games plug into the same hub without touching the core server/room code — see
`server/games/index.js` and the `GAMES` array in `public/hub.js`.

## Run locally

Requires Node.js 18+.

```
npm install
npm start
```

Then open `http://localhost:3000`.

## Architecture

- `server/index.js` — one Node process serves both static files and the WebSocket endpoint
  (`/ws`) on a single port, so it works within Render's free-tier single-port constraint.
- `server/roomManager.js` — game-agnostic room lifecycle (create/join/leave/cleanup).
- `server/games/<name>.js` — one plugin per mini-game (state, message handling, snapshot for
  late joiners). Adding a new game is: new plugin file, one line in `server/games/index.js`,
  a matching `public/games/<name>/client.js`, and one entry in `public/hub.js`'s `GAMES` list.
- `server/protocol.js` / `public/protocol.js` — the WebSocket message envelope and type
  constants, hand-kept in sync between server and client (no bundler in this repo).

Rooms are either the well-known public room for a game (never deleted, history capped) or a
private room created with a short shareable code (deleted a few seconds after the last player
leaves).

## Deploying to Render (free tier)

1. Push this repo to GitHub if it isn't already there.
2. Render dashboard → New → Web Service → connect the repo.
3. **Root Directory: `game_terminal`** — this matters, since the repo root also has unrelated
   projects; without it Render looks for `package.json` in the wrong place.
4. Environment: Node. Build command: `npm install`. Start command: `npm start`.
5. Instance type: Free.

**Cold start note:** Render's free tier spins the service down after ~15 minutes idle, and the
next request cold-starts it (can take 30-60 seconds). The client reconnects automatically with
backoff and shows a "reconnecting" status during this window, and restores your nickname/room
from the tab's session storage — so the first visit after idling just takes a little longer to
connect, nothing breaks.
