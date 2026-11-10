# Tally

A calorie and weight tracker for the phone, built so logging takes seconds. It shows calories and protein left
for today, and over the weeks it shows how fast the weight is really moving compared with the plan.

- **Setup**: height, weight, age, sex and how active you are, then a goal weight and an optional date. It offers
  paces (easy / steady / fast, plus one that hits your date), each with kcal per day, lb per week and a finish date.
  Optional flex days move calories to the weekend while keeping the weekly total the same. Protein target comes
  from your goal weight.
- **Today**: a nutrition-label card (calories left, eaten, protein, carbs, fat), a morning weigh-in, and four
  meals. **+** opens one search over your foods, recents, the built-in list and Open Food Facts. A food's
  **+** logs your usual amount in one tap; tapping the food opens the amount picker. Other ways to log:
  barcode scan, quick add (calories only), saved meals, "Same as yesterday" per meal, and a few suggestions
  that fit what's left. Every add, edit and delete can be undone. Days before today can be filled in too.
- **Progress**: trend weight (a smoothed average, so one salty day doesn't count) against the plan line and the
  goal, 1M / 3M / 6M / 1Y / All. Rate over the last 4 weeks, when you'll reach the goal at that rate, 7-day
  averages, calorie bars against target. After a few weeks it works out your **real maintenance** from what
  you ate and how the trend moved, and offers to use it.
- **Foods**: saved foods, saved meals, and the whole list. Create your own foods (per serving or per 100 g).
- **Plan**: the plan as a label, change goal or pace (the log is kept), edit your details, tips and tricks,
  lb/kg, theme, sync, and back up / restore (one JSON file; without sync, once there are two weeks of logs,
  Today nags whenever the last backup is over a month old).

## Sync

Phone and computer stay in step through a secret gist on your GitHub account (`tally.json`, description
"Tally sync"). Set it up once per device under Plan, Sync:

1. **Make a sync token** (the link opens GitHub with only the `gist` box ticked). Set Expiration to
   **No expiration**, generate, copy.
2. Paste it and Connect. The first device creates the gist; later devices find it.
3. On the next device, tap **Sync it here** on the welcome screen (or Plan, Sync), then **Scan a code** and
   point it at the QR on a connected device. No camera: copy the code there and paste it, or make a second token.

How it works: every saved change stamps the records it touched (an entry, a weigh-in, a food, the plan...), and
a sync merges the two copies record by record with the newer stamp winning, so edits on both devices while
apart are all kept, and deletes carry over too. Devices sync on open, a couple of seconds after each change,
when coming back online, and every 30 s while open; an unchanged gist costs a free 304. The token stays in
its own localStorage key and never goes into the gist or a backup. A revoked token or deleted gist pauses
sync and shows a banner on Today. Merge rules are in `logic.js` (`flatten`, `stamp`, `merge`).

## Run

Static files, no build. Data lives in the browser's localStorage for whatever origin you open it from.

- `./tally-app`: starts `python3 -m http.server 5182` if needed and opens a Chrome app window.
- On a phone: https://benparrack.github.io/tally/ then Share → Add to Home Screen (iPhone).
  After committing changes, `./deploy.sh` republishes it (pushes `tally/` to the benparrack/tally mirror repo).
  The first deploy needs that repo created on GitHub, with Pages serving its `main` branch.

## Food data

`foods.js` holds about 200 common foods (US and Swedish staples), values per 100 g with household servings.
Searches with few local hits also query [Open Food Facts](https://world.openfoodfacts.org) (only the search
text or barcode is sent). Barcodes use the browser's BarcodeDetector, or the vendored zxing wasm ponyfill on
Safari (`vendor/`, MIT); its wasm file loads from jsDelivr on the first scan. A barcode Open Food Facts doesn't
know opens the create-a-food form, and the food is remembered for next time.

## Test

- `node test.js`: food data checks, search, BMR/TDEE, paces, flex days, trend weight and ETA, measured
  maintenance, Open Food Facts parsing, suggestions, and the sync merge (concurrent edits, deletes, undo,
  erase, old unstamped data).
- `python3 -m http.server 5192`, then `node e2e.mjs [screenshot-dir]`: drives setup, logging, barcode,
  edits/undo, meals, progress, foods, plan, metric and dark mode in Firefox at phone size, then sync between
  two browsers (Open Food Facts and the GitHub API mocked).
- The service worker is network-first: deploys show up on the next open.

## Files

`logic.js` (pure maths and the sync merge, no DOM), `foods.js` (built-in list), `app.js` (UI and sync),
`style.css`, `sw.js` (offline cache), `manifest.webmanifest`, `archivo.woff2` (Archivo, OFL),
`vendor/qrcode.js` (qrcode-generator, MIT) for the device-linking QR.
