# Crux

A climbing logbook for gym sessions: log each climb as you go, keep a list of open projects, and see
your stats. Bouldering (Font grades) and rope routes (French grades), kept separate.

- **Climb**: start a session, then **Log a climb** after each problem: pick the route (or add it on the spot:
  grade, hold colour, optional name, photo and beta), set the number of tries, tap **Sent it** or **Not yet**.
  Past sessions show time, climbs, sends and best grade.
- **Routes**: Projects (tried, not sent) / Sent / All / Archived. Archive routes when the gym resets them.
  Tap one for its photo, notes, history, **Log a go**, edit and delete.
- **Stats** (per discipline): hardest send, routes sent, flash rate, open projects, grade pyramid,
  hardest send per session over time.
- **More**: export/import a JSON backup.

A *flash* is a route sent on the first try of its first log. Grades are stored as an index into the scale in
`logic.js`, so the scales can change later.

## Run

Static files, no build. Data lives in the browser's localStorage for whatever origin you open it from.

- `./crux-app`: starts `python3 -m http.server 5181` if needed and opens a Chrome app window.
- On a phone: it's an installable PWA but must be hosted (e.g. GitHub Pages) and then has its own data.
  Photos are shrunk to ~40KB each; localStorage holds ~5MB, so roughly 100 photos.

## Test

- `node test.js`: logic (sends, flashes, pyramid, per-session hardest, summaries).
- `python3 -m http.server 5191`, then `node e2e.mjs [screenshot-dir]`: drives the whole flow in Firefox at phone size.

## Files

`logic.js` (pure maths, no DOM), `app.js` (UI), `style.css`, `sw.js` (offline cache), `manifest.webmanifest`.
