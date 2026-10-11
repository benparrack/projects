# Accounts & Platform Overhaul — Plan

Status: **planned, not started** (written 2026-10-11). Ben approved every idea below,
plus a global chat (Clash of Clans style) and the legal pages a real site needs.
Work through the phases in order. Tick boxes as they land and commit after each item.

Today's baseline: identity is a nickname sent in `hello`, plus a random `clientId` per
socket (`server/index.js`). Nothing persists. Render's free tier has no persistent disk,
so all durable data lives in Firebase.

---

## Architecture

- **Auth: Firebase Auth** in the browser (Google + email/password). The client loads the
  Firebase JS SDK as ES modules from gstatic's CDN, which needs no bundler and matches
  the repo. After sign-in, the client sends its ID token in `hello`. The server checks
  it with `firebase-admin` (`verifyIdToken`) and puts `uid` on the session.
- **Database: Firestore, written only by the server.** Firestore security rules deny
  all client reads and writes, and every read and write goes through our WebSocket or
  HTTP API. That way stats can't be faked from the dev console, and there's a single
  place to enforce bans and rate limits.
- **Guests stay.** Nickname-only play works exactly as it does today. Guests can't
  chat globally, add friends or appear on leaderboards. Their games count toward
  nothing, but a "sign up to save this" prompt shows after a match.
- **`server/db.js` with two backends.** It uses Firestore when `FIREBASE_SERVICE_ACCOUNT`
  is set, and otherwise an in-memory store. Tests and local dev then run without
  Firebase credentials. With no Firebase config, a dev-auth bypass accepts the token
  `dev:<name>`, so multi-account flows can be tested in two tabs. That bypass is
  disabled whenever `NODE_ENV=production`.
- **New dependency:** `firebase-admin` only. Everything else (the profanity list, rate
  limiting, routing) is small enough to write in the repo.
- **Free-tier budget:** Firestore Spark allows 50k reads and 20k writes per day. A match
  costs about 2 writes per player plus 1. Leaderboards and the homepage stats are cached
  in server memory and refreshed every few minutes, so page views don't hit Firestore
  each time. This works because Render runs a single instance, so in-memory caches and
  presence are authoritative.

### Data model (Firestore)

```
users/{uid}            username, usernameLower, avatar, createdAt, xp, level, termsVersion,
                       termsAcceptedAt, renamedAt, cosmetics{}, settings{}, achievements{id: ts},
                       role ('user'|'admin'), bannedUntil, mutedUntil
usernames/{lower}      { uid, at }   (claimed with an atomic create(), so names stay unique)
stats/{gameType}_{uid} played, wins, losses, draws, streak, bestStreak, botPlayed, botWins,
                       botWins_<level>, soloPlayed, best, bestAt, lastPlayed, username
                       (flat collection, so leaderboards are one query per game)
users/{uid}/matches/{id}   match summary + `me` {place, won, draw, score}: the history list
pairs/{pairKey}        uids[2], games{gameType: {played, draws, wins{uid: n}}}, lastPlayed
pairs/{pairKey}/matches/{id}   shared match summaries (head-to-head page)
matches/{id}           gameType, endedAt, players, replay (turn-based games only)
users/{uid}/friends/{otherUid}   { status: 'pending_in'|'pending_out'|'accepted', since }
seasons/{seasonId}/stats/{gameType_uid}   season-scoped copy of rating/wins
daily/{yyyy-mm-dd}/scores/{gameType_uid}  the day's challenge result
reports/{id}           reporter, target, context (chat msg / profile), status
dms/{pairKey}/msgs/{id}   friend DMs, last 50 kept
```
No composite indexes: queries use one where/orderBy field and sort in memory.

Global chat lives **in memory only** (the last 100 messages, replayed on join). That's
cheaper and more privacy-friendly, and it matches how a CoC-style feed feels. A
reported message gets copied into `reports/` so it isn't lost on restart.

### The `reportResult` hook (the core of Phase 1)

The 51 registered plugins each record the winner differently (`winner`, `winnerSeat`, `winners`,
`winnerTeam`…). Seats hold `clientId`s or the `'BOT'` sentinel (e.g. chess
`st.players[color]`, `endGame()` at `server/games/chess.js:448`). Each plugin gets one
call at its game-over point:

```js
ctx.reportResult({ placements: [[clientIdA], [clientIdB]], scores?, replay? })
// placements: best first; ties share an inner array; 'BOT' allowed as an entry
```

The room maps `clientId → uid/nickname` (`room.clients` gains `uid`). Stats, rating,
match history, XP, achievements, season stats and daily scores are all updated from
this one place (`server/results.js`). Games without a clear match end define it like this:

| Game | What counts |
|---|---|
| Slither | a "life" ends on death: record length + kills as `bests`, no win/loss |
| TRON, Arena Duel, Slope | each round/match already has a winner, so report it |
| Maze Dash, Minesweeper race, daily-able solo games | placements + finish time in `bests` |
| Drawing canvas, Game Boy | no stats (maybe "time played" for XP only) |
| Pictionary / Drawing Phone | points ranking at the end of the game |

One test per plugin asserts that a scripted game ends in exactly one `reportResult`
call with the right placements. This is the long, careful part of the project.

---

## Phases

### Phase 1 — Foundation
- [x] `firebase-admin` dependency, `server/db.js` (Firestore + memory), dev-auth bypass
- [x] Auth in `hello`: verify token, attach `uid`, load or create the user doc
- [x] Sign-in screen: Google / email / continue as guest. First sign-in picks a
      username (unique, 3–16 chars `[a-z0-9_]`, reserved-name list, profanity check) and an avatar
- [x] Avatar set: 24 retro 8×8 pixel icons (`public/avatars.js`, inline SVG), so there are no uploads to moderate
- [x] `room.clients` carries `uid`; the roster shows avatar + username for account holders
- [x] `ctx.reportResult` + `server/results.js` (stats, streaks, match docs, bot games kept separate)
- [x] Wire `reportResult` into all 51 plugins, with a test each
- [x] History-API router in `hub.js` (`/`, `/r/<code>` invite links, `/u/<name>`, … + styled 404) and a top nav bar.
      `static.js` serves `index.html` for every extensionless path, plus CSP/security headers

### Phase 2 — Profiles, stats, history
- [x] Profile page: avatar, username, join date, level, a per-game stats table, recent matches
- [x] Public profile URL `/u/<username>` (read-only HTTP JSON API: `GET /api/user/<name>`)
- [x] Match history list + replay viewer for turn-based games (chess, checkers, connect4,
      reversi, gomoku, mancala, dots&boxes, blockade, backgammon). The viewer re-feeds the
      moves list through the client's existing render code with prev/next/autoplay
- [ ] Settings page synced to the account: volume/mute, reduced motion, default bot difficulty
- [ ] Account deletion (removes the user doc, subcollections and username claim, and
      anonymizes the name in old match docs) + "download my data" (a JSON export, for the GDPR right of access)

### Phase 3 — Friends & social
- [ ] Friend requests (send/accept/decline/remove), friends list with online status and
      "currently playing X"
- [ ] Invite a friend into your current room (a toast with a JOIN button), so there's no code-sharing
- [ ] Party system: a leader + up to 7 members; when the leader joins a room, the
      party follows. Party chat
- [ ] Recent players list (last 20 people you shared a room with) → add friend / view profile
- [ ] Head-to-head page vs. any user: record per game + recent shared matches (`pairKey` query)
- [ ] Block user (hides their chat, blocks friend requests and invites)

### Phase 4 — Chat & moderation
- [ ] **Global chat** dock (collapsible side panel on the menu, CoC style): accounts only,
      the last 100 messages, avatar + name + level badge, click a name → profile
- [ ] In-room chat (all players in a room) and friend DMs
- [ ] Rate limit (e.g. 5 messages / 10s, slow mode when busy), max length, profanity
      mask, link blocking, a new-account delay (must play 1 game before global chat)
- [ ] Report message / report user → `reports/`
- [ ] Admin view (`#/admin`, `role == 'admin'` only): the reports queue, mute/ban with a
      duration, delete message, reset stats, rename an offensive username

### Phase 5 — Competitive
- [ ] Elo rating per 2-player game (start 1000, K=32 for the first 20 games, then K=16);
      multi-player games use pairwise Elo from placements
- [ ] Ranked vs. casual: a RANKED button next to JOIN PUBLIC for rated games (accounts
      only, humans only). Only ranked games move rating. Casual and private games still count
      in played/wins
- [ ] Rank tiers from rating (Bronze → Silver → Gold → Platinum → Diamond → Master), shown on the profile
- [ ] Leaderboards page: per game, by rating (ranked games) or by wins / best time /
      best score, with all-time, this season and friends-only tabs. Cached and refreshed every 5 min
- [ ] Seasons: calendar quarters (S1 = 2026 Q4). On rollover, archive the final season
      standings and soft-reset ratings toward 1000. Past seasons appear on the profile with final rank
- [ ] Bot games stay in `botPlayed/botWins` only and never touch rating or leaderboards

### Phase 6 — Progression & daily
- [ ] XP for every finished match (more for wins, a small amount for bot games, capped
      per day) → account level shown next to the name everywhere
- [ ] Achievements: ~40 to start (per-game firsts and milestones, plus cross-game ones
      like "played 20 different games", "beat a friend", "10-win streak", "Expert bot slayer").
      Toast on unlock, grid on the profile
- [ ] Cosmetic unlocks from levels and achievements: name colors, avatar frames, slither
      skins, TRON trail colors, chess/checkers board themes. Equip from the profile; games read
      `cosmetics.equipped` from the roster
- [ ] Daily challenge: a shared seed per day for Maze Dash, Word Hunt, Minesweeper (and
      Crossword/Wordscapes if easy). One scored attempt per account, a daily leaderboard,
      and a streak counter
- [ ] Activity feed on the home screen: friends' notable results, unlocks and streaks
- [ ] Homepage live stats: online now, games played today, most popular game this week

### Phase 7 — "Real website" essentials
- [x] **Terms of Service** page (`/terms`): 13+ age requirement, acceptable use, chat
      rules, account termination, no warranty, governing law left as a placeholder for Ben
- [x] **Privacy Policy** (`/privacy`): what's collected (email via Firebase, username,
      stats, chat messages and how long they're kept), processors (Google/Firebase, Render),
      no ads/no selling, GDPR rights (access/export, deletion, correction), contact address
- [ ] **Cookie/storage notice:** only strictly necessary storage (Firebase auth,
      session, settings), and no analytics, so an info notice in the footer is enough
      and no consent banner is needed. If analytics get added later, a consent banner becomes required
- [x] **Community Guidelines** (`/rules`), linked from chat and the report dialog
- [x] Sign-up checkbox: "I'm 13+ and agree to the Terms and Privacy Policy" (stored
      with a timestamp and the policy version, so users can be re-prompted when the policy changes)
- [x] Footer on every non-game screen: Terms · Privacy · Rules · Credits · Contact
- [x] **Credits/licenses** page: Three.js (MIT), Firebase, homebrew Game Boy ROM
      licenses (`gameboy/`), word lists, and fonts
- [x] About/FAQ page, a styled 404 page, a contact email (Ben to choose)
- [ ] Security basics: HTTP security headers (CSP allowing gstatic/firebase, HSTS,
      X-Content-Type-Options, frame-ancestors), WebSocket rate limits per IP, max sockets per IP,
      and a size check on every client payload
- [x] SEO/sharing: `<meta description>`, Open Graph tags + a share image, favicon,
      `robots.txt`
- [ ] README "Deploying" section updated with the Firebase setup and env vars

The legal pages will be solid templates, not legal advice. Before real traffic,
Ben should read them and fill in his contact address and governing law.

---

## What Ben has to do (I can't do these)

1. Create a Firebase project (console.firebase.google.com) and enable Authentication
   with the **Google** and **Email/Password** providers.
2. Create a **Firestore** database (production mode, region `europe-west`).
3. Project settings → add a **Web app** and paste its `firebaseConfig` into the chat. It's public
   by design, so it goes in `public/firebase-config.js`.
4. Project settings → Service accounts → **Generate new private key**. Put the JSON
   in Render as the env var `FIREBASE_SERVICE_ACCOUNT`. **Never commit it.**
5. Firebase Auth → Authorized domains: add `gameterminal.onrender.com`.
6. Choose the contact email for the legal pages and the admin account to promote.

Phases 1–4 can be built and tested end to end without steps 1–5, thanks to the
memory backend and dev-auth. Real Firebase is only needed to deploy.

## Ground rules while building

- The site is live (Render auto-deploys from `main`?). Keep everything working for guests
  at every commit, and don't push half a phase.
- Commit per item with `git commit --only -- <paths>` (concurrent sessions, see root CLAUDE.md).
- Run `graphify update .` after code changes. `/compact` between phases.
- Every new server path gets a test in `test/`, and the existing 32 test files keep passing.

---

## Blocked / needs Ben

- `public/pages.js`: set `CONTACT_EMAIL` and `GOVERNING_LAW` (placeholders in the Terms/Privacy pages).

- Firebase project + credentials (see "What Ben has to do"). Until then the server runs on the
  in-memory backend + dev-auth locally; production keeps guest-only behaviour.

## Progress log

- 2026-10-11 — plan approved, /loop started on Phase 1.
- 2026-10-11 — Phase 1 done: db/auth/accounts/results/api server modules; sign-in, username
  setup, avatar picker, account chip, invite links, result toasts, 404; all 51 plugins report
  results (helpers: boardResult, duelResult, wordResults, cardBots.seatResult, tickBots.rankGroups).
  Follow-ups noted: shooter `leaveSeat` mid-match skips the rated loss (disconnect forfeits);
  minesweeper has no time score (board sizes differ); darts 501/301 averages share one board.
- 2026-10-11 — Phase 7 pages (Terms, Privacy, Rules, About/FAQ, Credits, og.png, robots.txt) from the game-terminal-65 session wired into the router + footer.
- 2026-10-11 — Phase 2: profile page `/u/<name>` (KPIs, per-game stats table, recent matches with linked opponents), API adds score meta + `account` flag; dev auth refused on Render.
- 2026-10-11 — Phase 2: replay viewer `/replay/<id>` (mounts the game's own client read-only; step/scrub/autoplay/speed, keyboard). Known gap: frames carry no seat names, so boards show "(empty)" seats.
