# Game Terminal

**Play now: https://gameterminal.onrender.com** (free-tier hosting — the first load after a
period of inactivity can take 30-60 seconds to cold-start, see note below).

A retro terminal-styled hub for real-time multiplayer mini-games. Pick a game, join the
public room or a private room via a short code, and play live with anyone else connected.

Unlike the other demos in this repo, this one needs an actual running server — it can't be
opened as a local file, since multiple browser tabs need to talk to each other through
something in the middle.

## Games

59 games in eight menu tabs (the full list is `CATEGORIES` in `public/hub.js`):

- **CARD GAMES**: War, Crazy Eights, BS, Spades, Hearts.
- **CASINO**: Blackjack (plus a high-roller table), Slots, Crash, Plinko, Mines, Texas Hold'em
  and Roulette, all on one money balance per account. Going broke means working shifts at your
  own restaurant (the Diner). Money never shows outside this tab (see `public/casino/`,
  `server/casino/`).
- **BOARD GAMES**: Checkers, Chess, Four in a Row, Backgammon, Reversi, Gomoku, Mancala, Dots
  and Boxes, Codebreaker, Minesweeper race, Blockade.
- **ARENA & REAL-TIME**: Slither, Light Cycles, Arena Duel (1v1 FPS), Slope (3D runner), Maze
  Dash. These run on a server-side tick loop instead of only reacting to messages.
- **WORD GAMES**: Wordle, Word Tiles, Word Wheel, Word Search, Hangman, Anagrams, Word Bites,
  Word Hunt, Word Trails, Crossword, 20 Questions.
- **POCKET CLASSICS**: quick head-to-head games (Pool, Cup Pong, Darts, Basketball, Sea Battle,
  Filler, Tanks, Mini Golf, Archery, Shuffleboard, Bowling, Knockout, Paintball, Alley Ball)
  plus some board and word games from the other tabs.
- **PARTY & DRAWING**: Shared Drawing Canvas, Sketch & Guess, Drawing Phone.
- **RETRO**: a Game Boy emulator with watch and link-cable play (synced from `../games/gameboy/`).

Every turn-based or competitive game has PLAY VS BOT at Easy/Medium/Hard/Expert
(`server/games/ai/`). The physics games share a deterministic `sim.js` between server and
client (see `public/games/cuppong/`), and the server's result is the authoritative one.

More games plug into the same hub without touching the core server/room code — see
`server/games/index.js` and `CATEGORIES` in `public/hub.js`.

## Run locally

Requires Node.js 18+.

```
npm install
npm start
```

Then open `http://localhost:3000`.

Tests are plain Node scripts, one per area: `npm test` runs them all, or run one with
`node test/chess.test.js`.

## Architecture

- `server/index.js` — one Node process serves both static files and the WebSocket endpoint
  (`/ws`) on a single port, so it works within Render's free-tier single-port constraint.
- `server/roomManager.js` — game-agnostic room lifecycle (create/join/leave/cleanup).
- `server/games/<name>.js` — one plugin per mini-game (state, message handling, snapshot for
  late joiners). Adding a new game is: new plugin file, one line in `server/games/index.js`,
  a matching `public/games/<name>/client.js`, and one entry in `public/hub.js`'s `CATEGORIES`.
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

## Backups

`.github/workflows/game-terminal-backup.yml` (repo root) runs `scripts/backup.js` every night at
03:17 UTC: it copies every Firestore document into one gzipped JSON, encrypts it with
AES-256-GCM, and keeps it as a workflow artifact for 90 days. The repo is public and anyone
signed in to GitHub can download its artifacts, which is why the file is encrypted.

Setup (once): in GitHub → Settings → Secrets and variables → Actions, add
`FIREBASE_SERVICE_ACCOUNT` (the same JSON as on Render) and `BACKUP_PASSPHRASE` (a long random
string; keep a copy in your password manager, since a backup can't be opened without it). Then
run the workflow once from the Actions tab to check it.

Restore: download the artifact, then from `game_terminal/`:

```sh
BACKUP_PASSPHRASE=... node scripts/backup.js inspect firestore-YYYY-MM-DD.bak   # counts only
FIREBASE_SERVICE_ACCOUNT="$(cat key.json)" BACKUP_PASSPHRASE=... node scripts/backup.js restore firestore-YYYY-MM-DD.bak --yes
```

Restore overwrites the documents in the backup and leaves newer documents alone. Each backup
reads every document once, which counts against Firestore's free 50,000 reads per day.
