# Limber

A daily stretching coach for tight legs, hips and groin. Built for one person (Ben) who is very
inflexible in the hamstrings, abductors and adductors and wants to actually stick with it.

- **Today**: a routine generated for the day. Pick how much effort you have:
  - **Mat session** (10–30 min): floor work, strap, wall, the proper version.
  - **Couch mode** (10–40 min): everything doable in bed or on a sofa with a show on. Dark player, chimes only, no voice.
  - **Quick reset** (5–10 min): standing and sitting stretches, no floor.
  Swap any stretch, shuffle the whole routine, or exclude stretches you hate.
- **Guided player**: get-into-position countdowns, holds, side switches, chimes and optional voice,
  pause/+15s/skip, wake lock. Keys: Space, ←/→, Esc. Sessions under 2 minutes don't count.
- **Program**: a 4-phase progression (holds get longer as your total days grow), weighted toward your
  priority areas (Settings → Focus areas).
- **Progress**: streaks, an 18-week heatmap, how sessions felt, time per body area, and range check-ins
  (sit and reach, butterfly knee height, straddle width) every two weeks.
- **Milestones**: 18 to earn (days stretched, streaks, hours held, measurably looser check-ins), the next one
  shown on Today, new ones celebrated when you finish.
- **Favourites**: heart a stretch and it comes up more often; hide ones you hate.
- **Log it elsewhere**: a yoga class, physio or your own routine (today or yesterday) counts toward the streak.
- **Breathing pacer**: during holds the ring glows on a slow 4-in, 6-out breath.
- **Reminders**: phone notifications via ntfy, only on days you haven't stretched, plus a Sunday recap of
  the week. See `reminders/README.md`.

## Run

Static files, no build. Data lives in the browser (localStorage) for whatever origin you open it from,
so pick one and stick to it (Settings has export/import for moving).

- `./limber-app`: starts `python3 -m http.server 5180` if needed and opens a Chrome app window.
  A `limber.desktop` entry in `~/.local/share/applications` points at it.
- Or: `python3 -m http.server 5180` and open http://127.0.0.1:5180/
- On a phone: it's an installable PWA, but it needs to be hosted somewhere (e.g. GitHub Pages) and
  then has its own separate data.

## Files

`stretches.js` (35 stretches with poses, cues and areas), `figure.js` (SVG stick figures),
`logic.js` (routine building, program phases, streaks; pure, no DOM), `app.js` (UI), `sw.js` (offline cache).

## Tests

```sh
node test.js                                  # routine/streak logic
python3 -m http.server 5181 & node e2e.mjs     # full UI flow in headless Firefox (add a dir to save screenshots)
python3 reminders/test_remind.py
```
