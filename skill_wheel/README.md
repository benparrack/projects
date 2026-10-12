# Skill Wheel 🎡

Spin a wheel once a week, learn one new skill. When the wheel stops you get the full rundown for the skill, plus a 7-day training plan you tick off as you go.

**Run it:** open `index.html` in a browser. It works straight from the file. You can also run `python3 -m http.server` here and open http://localhost:8000.

## What's in it
- **48 skills** in 7 categories: Mind, Body, Creative, Practical, Social, Tech and Music. Each takes 1 to 8 weeks to reach a solid beginner level and costs $0 to roughly $25 to set up.
- Each skill has:
  - what it is and why it's worth learning
  - what you'll need and how to learn it
  - a day-by-day 7-day plan
  - a "you've got it when…" goal
  - tips and resource links (YouTube and Google searches, so the links never go dead)
  - what to learn next
- **The wheel:**
  - A pegged wheel with a ticking flapper, motion blur at speed, chasing rim lights, a settle-back against the flapper, a spotlight on the winner, sound and confetti.
  - Spin with the button or <kbd>Space</kbd>, or grab the wheel and flick it.
  - You get one re-spin per week.
  - While a skill is in progress, spins are "just for fun" and don't change your pick.
- **This week:**
  - today's session with a practice timer (pausable, shows in the tab title, ticks the day off when done) and a progress ring
  - tick-off plan, notes and print
  - "I've learned it!" with a rating, or skip
  - a "week" runs 7 days from your spin, not Monday to Sunday
- **Library:** browse or search every skill, take a skill off the wheel, or start one directly.
- **Journey:** stats, streak, a collection of learned skills, a timeline, and JSON export/import.
- **Settings:** turn categories on or off, "quick wins only", "free only", allow repeats, sound (<kbd>M</kbd>).

Progress is saved in `localStorage` in this browser only. Use **Journey → Export backup** to move it to another browser or device.

## Files
- `skills.js`: all the skill content. Add a skill by copying an entry; `test.js` checks the shape.
- `logic.js`: pure logic (current run, plan day, wheel pool, segment under the pointer, streak).
- `app.js`: the wheel, the views and saving progress. `index.html` and `style.css` hold the page and styles.

## Tests
- `node test.js`: checks the skill data and the logic.
- `node e2e.mjs`: full browser flows in Firefox through playwright-core, with the app served on port 5177. `BROWSER=chrome node e2e.mjs` runs the same flows in Google Chrome. It covers a targeted spin, re-spin, a fun spin, 7-day expiry, finish and rate, flick-to-spin, and settings.
