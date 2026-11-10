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
  lb/kg, theme, and back up / restore (one JSON file; once there are two weeks of logs, Today nags
  whenever the last backup is over a month old).

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
  maintenance, Open Food Facts parsing, suggestions.
- `python3 -m http.server 5192`, then `node e2e.mjs [screenshot-dir]`: drives setup, logging, barcode,
  edits/undo, meals, progress, foods, plan, metric and dark mode in Firefox at phone size (Open Food Facts mocked).
- The service worker is network-first: deploys show up on the next open.

## Files

`logic.js` (pure maths, no DOM), `foods.js` (built-in list), `app.js` (UI), `style.css`, `sw.js` (offline
cache), `manifest.webmanifest`, `archivo.woff2` (Archivo, OFL).
