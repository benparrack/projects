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

The **GAMEPIGEON** tab recreates the GamePigeon set: 8-Ball Pool, Cup Pong, Darts, Basketball,
Sea Battle, Filler, Word Hunt, Word Bites, 20 Questions, Tanks, Mini Golf, Archery,
Shuffleboard, Bowling, Knockout, Paintball and Skee-Ball. The **WORD GAMES** tab has Word Hunt,
Word Bites, Word Trails, Crossword, 20 Questions and others. Every game there has PLAY VS BOT at
Easy/Medium/Hard/Expert. The physics games share a deterministic `sim.js` between server and
client (see `public/games/cuppong/`), and the server's result is the authoritative one.

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

### Environment variables

| Variable | Required | What it is |
|---|---|---|
| `NODE_ENV` | recommended: `production` | Turns on HSTS and **turns off the dev sign-in bypass** (`dev:<name>` tokens, which would let anyone sign in as anyone). Render also sets `RENDER=true` on every service, which does the same, so a Render deploy is safe even without it. |
| `FIREBASE_SERVICE_ACCOUNT` | for accounts | The whole service-account JSON (one line). Enables Firebase token checks and the Firestore database. **Secret: never commit it.** |
| `FIREBASE_WEB_CONFIG` | for accounts | The web app's `firebaseConfig` object as JSON. Not secret; served to browsers from `/api/config`. |
| `ADMIN_UIDS` | to moderate | Comma-separated Firebase uids that get the `/admin` moderation console (reports queue, mutes, bans, renames). Find your uid in Firebase → Authentication → Users after signing in once. |
| `PORT` | no | Set by Render automatically (local default is 3000). |

Without the Firebase vars the site still runs: everyone plays as a guest, and nothing is
persisted (an in-memory DB is used instead). Locally, leave them unset to get the dev sign-in
bypass, which lets you test accounts without a Firebase project.

### Firebase setup checklist

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com).
2. **Authentication → Sign-in method:** enable **Google** and **Email/Password**.
3. **Authentication → Settings → Authorized domains:** add `gameterminal.onrender.com` (and
   any custom domain).
4. **Firestore Database → Create database:** production mode, region `europe-west`.
5. **Firestore → Rules:** paste in [`firestore.rules`](firestore.rules) and publish. It denies
   every client read/write. Browsers never touch Firestore directly; the server uses
   `firebase-admin`, which ignores rules. Or deploy it with
   `npx firebase-tools deploy --only firestore:rules`.
6. **Project settings → General → Your apps → Add web app:** copy the `firebaseConfig`
   object into `FIREBASE_WEB_CONFIG` as JSON, for example
   `{"apiKey":"…","authDomain":"…","projectId":"…","appId":"…"}`.
7. **Project settings → Service accounts → Generate new private key:** paste the downloaded
   JSON into `FIREBASE_SERVICE_ACCOUNT` on Render, then delete the local file.
8. Render → your service → **Environment:** set the three variables above and redeploy. The
   server logs `accounts: auth=<mode> db=<backend>` at startup; you want `auth=firebase`.
9. Sign in on the live site once, then add your uid to `ADMIN_UIDS` to get `/admin`.

No Firestore indexes are needed: every query is a single equality filter or a single
`orderBy`, which Firestore indexes automatically.

### Built-in protections

Security headers (CSP, HSTS, `nosniff`, `frame-ancestors 'self'`, referrer policy) are set in
`server/static.js`. The WebSocket server caps each IP at 20 sockets, gives each socket a
200-messages/second budget (with a burst of 400; extra messages are dropped), and rejects
payloads over 64 KB. Chat has its own rate limits and filters (`server/chat.js`).
