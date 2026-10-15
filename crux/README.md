# Crux

A climbing logbook for gym sessions: log each climb as you go, keep a list of open projects, and see
your stats. Bouldering (Font grades) and rope routes (French grades), kept separate.

- **Climb**: pick your gym, start a session, then **Log a climb** after each problem: pick the route (or add it on the spot:
  grade and colour default to your last route; optional name, wall, photo and beta), set the tries, tap **Sent it** or **Not yet**.
  Tap a climb in the session to log another go (goes on an unsent route merge into one entry). Removing a climb can be undone.
  Ending a session shows a recap with sends, flashes and any new personal best.
  Past sessions open to show their climbs; fix mistakes or delete the session there.
- **Routes**: Projects (tried, not sent) / Sent / All / Archived. Archive routes when the gym resets them.
  Tap one for its photo, notes, history, **Log a go**, edit and delete.
- **Stats** (per discipline): hardest send, routes sent, flash rate, open projects, grade pyramid,
  hardest send per session over time, sessions per week (last 12 weeks).
- **More**: back up (one JSON file with photos; on a phone it opens the share sheet) and restore. The Climb tab nags after
  2 weeks without a backup.

A *flash* is a route sent on the first try of its first log. Grades are stored as an index into the scale in
`logic.js`, so the scales can change later.

## Run

Static files, no build. Data lives in the browser's localStorage for whatever origin you open it from.

- `./crux-app`: starts `python3 -m http.server 5181` if needed and opens a Chrome app window.
- On a phone: https://benparrack.github.io/crux/ then Share → Add to Home Screen (iPhone) or Install app (Android).
  After committing changes, `./deploy.sh` republishes it (pushes `crux/` to the benparrack/crux mirror repo).
  Logbook in localStorage, photos (shrunk to ~900px JPEG) in IndexedDB, so there is room for thousands.

## Test

- `node test.js`: logic (sends, flashes, pyramid, per-session hardest, summaries).
- `python3 -m http.server 5191`, then `node e2e.mjs [screenshot-dir]`: drives the whole flow in Firefox at phone size.

## Files

`logic.js` (pure maths, no DOM), `app.js` (UI), `style.css`, `sw.js` (offline cache), `manifest.webmanifest`.
