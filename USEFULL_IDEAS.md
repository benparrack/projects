# Useful Ideas — Things Ben Would Actually Use

Generated 2026-10-11. Unlike `IDEAS.md` and `NEW_IDEAS.md`, these are picked
for being useful, not flashy. They're aimed at Ben's real situation: a student
in Stockholm until ~end of Dec 2026, on a tight budget, with ntfy push
notifications already working (flip-bot, trading-cockpit).

Grouped by what they save: money, time, or stalled work in this repo.

---

## U1. Grocery Deal Matcher

**Status:** Built 2026-10-11 in `grocery_deals/`: ICA (Kvantum Kungsholmen) + Willys + Hemköp, a desktop app with live deals and an in-app list editor, and a Monday 08:00 push. Coop/Lidl not yet. Ben wants to develop this one the most.
**Pitch:** Scrapes the weekly offers from nearby Willys, ICA, Coop and Lidl stores and matches them against a standing shopping list. Every Monday it sends a push like "Willys has your chicken and oat milk on sale, ~140 kr saved."

**Why this one:** You'd use it every week, and the savings are small but real on a student budget.

**What it needs when resumed:**
- Done when: a weekly ntfy digest lists the matched offers per store, with the estimated savings.
- Check how each chain publishes offers (an API behind the website, a JSON endpoint, or HTML) before writing scrapers.
- Fuzzy matching between list items and offer names ("havredryck" ↔ "Oatly Barista 1L").
- Stretch: suggest which single store to go to this week.

---

## U2. Personal Finance Dashboard

**Status:** Stocked, not started. Same as `IDEAS.md` #37.
**Pitch:** Drop in bank CSV exports. It sorts transactions into categories, finds subscriptions you forgot about, flags odd charges, and forecasts whether your money lasts until December.

**Why this one:** It answers "am I on track?" without a spreadsheet, and it runs fully locally.

**What it needs when resumed:**
- Done when: your real exports are categorized correctly ≥90% of the time, and a correction UI learns rules from your fixes.
- Need to know first: which bank(s), and whether they're USD, SEK or both (currency conversion).
- A format adapter per bank, and dedup across overlapping exports.
- Subscription detection: same merchant, a regular interval, a similar amount.

---

## U3. Flight-Home Price Watcher

**Status:** Stocked, not started.
**Pitch:** Tracks Stockholm → home fares for late December and pushes when a price drops or looks like the low for that route.

**Why this one:** It's timely: prices for the end-of-December window are moving now, and a one-time saving here could be large.

**What it needs when resumed:**
- Done when: it checks on a schedule, keeps a price history per date and route, and pushes on a real drop.
- Need to know first: the destination airport(s), date flexibility, and airlines Ben would accept.
- Find a data source that doesn't block scrapers (a free flights API, or Google Flights via a headless browser as a fallback).

---

## U4. Deadline Radar

**Status:** Stocked, not started.
**Pitch:** Pulls every course calendar (Canvas or KTH/SU iCal feeds) into one list and sends a morning push like "2 things due this week; the lab report is in 3 days."

**Why this one:** No more surprise deadlines, and it's very little code once the feeds are in hand.

**What it needs when resumed:**
- Done when: all courses' deadlines show up in one place, and daily plus 3-day/1-day pushes fire correctly.
- Need to know first: which LMS the school uses, and whether it exposes an iCal feed URL (Canvas does).
- Stretch: a manual-add option for deadlines that only appear in course PDFs.

---

## U5. "Leave Now" Transit Pings

**Status:** Stocked, not started.
**Pitch:** Uses SL's real-time departures (Trafiklab's free API) for your regular trips. It pushes when you need to leave to catch the next train or bus, accounting for delays.

**Why this one:** It's daily and practical, and a first version is about one evening of work.

**What it needs when resumed:**
- Done when: for a configured trip and arrival time, a "leave in 5 min" push arrives that matches real departures.
- A free Trafiklab API key (Ben signs up).
- Config: home stop, regular destinations, walking time to the stop.
- Stretch: a mission_control panel showing the next departures.

---

## U6. Ask Your Course Materials

**Status:** Stocked, not started.
**Pitch:** Local search over your lecture PDFs and slides that answers questions with page citations ("where did the lecture define X?").

**Why this one:** Most useful before exams, and it turns a pile of PDFs into something you can query.

**What it needs when resumed:**
- Done when: questions about real course material come back with correct page citations.
- PDF text extraction, chunking, and keyword search to start (embeddings only if keyword search falls short).
- Optional Claude answer layer when `ANTHROPIC_API_KEY` is set; plain search results otherwise.

---

## U7. "Waiting on Ben" Board

**Status:** Stocked, not started.
**Pitch:** One page or terminal command listing every manual step that's blocking a project in this repo, with the exact steps for each. Items tick off as you finish them.

**Why this one:** Several finished projects are stalled only on Ben's manual steps: publishing the Roblox games, Tradera keys for flip-bot, Clip Studio account setup, and linking a broker to trading-cockpit. Clearing those gets more value out of work that's already done than building anything new.

**What it needs when resumed:**
- Done when: running one command shows each open blocker, its steps, and its status, and checks status automatically where possible (e.g. whether a key is present in `.env`).
- Source the blockers from `TODO_FIRST.md` and each project's SETUP.md/PROGRESS.md.
- Keep it tiny: a script plus a short checklist file, not an app.

---

## U8. Subscription Killer

**Status:** Stocked, not started.
**Pitch:** Finds recurring charges in your email receipts (or the U2 finance CSVs) and pushes about 3 days before each renewal: "Spotify renews Friday, still using it?"

**Why this one:** Forgotten subscriptions are the easiest money to save, and a heads-up before renewal is the only point where it's easy to act.

**What it needs when resumed:**
- Done when: every real recurring charge is detected with its next renewal date, and pre-renewal pushes fire on time.
- Source: Gmail (IMAP or the API, read-only, receipts only) or the U2 CSVs; decide which before building.
- Detection: same merchant, a regular interval, a similar amount (shared with U2).
- Stretch: a one-tap "cancel" link per service.

---

## U9. Second-Hand Price Checker

**Status:** Stocked, not started.
**Pitch:** Paste a Blocket or Tradera link (or type an item) and it shows what that item actually sells for, based on sold and completed listings, with a fair-price range.

**Why this one:** Useful for buying furniture or winter gear cheaply now, and for pricing everything when you sell up before leaving in December.

**What it needs when resumed:**
- Done when: for a real listing it returns comparable sold items and a price range that matches what Ben would judge fair.
- Reuse `money/flip-bot/`: it already has `fair_value`, `trimmed_median` and listing matching.
- Check what Blocket exposes. Tradera's API needs the dev keys that are already pending for flip-bot.

---

## U10. Receipt Splitter

**Status:** Stocked, not started.
**Pitch:** Snap a photo of a receipt, tap who had what, and get each person's share plus a Swish payment link or QR code.

**Why this one:** It's for flatmates, group dinners and trips, and you'd use it right away.

**What it needs when resumed:**
- Done when: a real Swedish receipt photo is parsed into items and amounts correctly, and the split and Swish links work on a phone.
- A phone-first web page (PWA, like trading-cockpit's).
- OCR: Claude vision if `ANTHROPIC_API_KEY` is set, otherwise local Tesseract with manual fixes.
- Swish deep links use the `swish://payment?data=...` format; verify it against the current Swish docs.
- Handles shared items, tip and rounding.

---

## U11. Daily "Plan My Day" Brief

**Status:** Stocked, not started.
**Pitch:** One morning push combining deadlines (U4), transit (U5), the weather ("bring a jacket, 4°C and rain at 17:00") and the first event in your calendar.

**Why this one:** One glance replaces opening four apps, and it ties several of the other ideas together.

**What it needs when resumed:**
- Done when: a single ntfy push arrives at a set time every morning with accurate data from each source.
- Weather from SMHI's free open API (no key needed).
- Start with whatever sources exist; plug in U4/U5 as they get built.
- Note: `claude-control` already has morning-hello timers, so reuse that scheduling.

---

## U12. Swedish From Your Own Life

**Status:** Stocked, not started.
**Pitch:** Snap signs, menus, texts and screenshots. It pulls out the words you don't know and turns them into spaced-repetition flashcards, with the photo as context.

**Why this one:** The vocabulary you actually ran into sticks far better than textbook lists.

**What it needs when resumed:**
- Done when: a photo becomes sensible cards (word, translation, example sentence from the photo), and a daily review works on the phone.
- Phone-first PWA. OCR plus translation via Claude, or a local fallback.
- An SM-2-style scheduler, with known words filtered out over time.
- Stretch: export to Anki.

---

## U13. Lecture Recorder → Notes

**Status:** Maybe. Stocked, not started.
**Pitch:** Turns a lecture recording into structured notes with timestamps, key terms and a summary.

**Why this one:** Notes you can search and review without re-watching the lecture.

**Battery concern (Ben):** He doesn't want the laptop recording all class. Design around that: **record on the phone** (its built-in recorder), then drop the file in a folder. Transcription runs later on the desktop's RTX 4060 while it's plugged in, so nothing runs during class.

**What it needs when resumed:**
- Done when: a real lecture recording becomes accurate notes in a few minutes on the desktop.
- Reuse Clip Studio's transcription (`money/clip-studio/app/transcribe.py`).
- A watched folder plus Syncthing or a manual copy from the phone.
- Pairs well with U6: notes become searchable alongside the slides.

---

## U14. Universal "Notify Me When" Tool

**Status:** Built 2026-10-11 in `notify_when/`, timer running every 10 min. Pinned (paused) by Ben the same day.
**Pitch:** Watch any page or API and push to ntfy when a condition is true: "when this item is back in stock," "when this price < X," "when this page changes."

**Why this one:** One generic tool covers several narrow ideas (U3 price drops, restocks, ticket releases, course seats opening).

**What it needs when resumed:**
- Done when: adding a watch is one line (URL + selector/JSON path + condition), and pushes fire only on real changes, with no spam.
- Plain fetch first, with a headless browser fallback for JS-heavy pages.
- Runs on a systemd timer (like copy-trader), and keeps a small history per watch.
- Stretch: "watch this" from the phone via an ntfy action or a tiny web form.

---

## U15. Weekly Repo Digest

**Status:** Stocked, not started.
**Pitch:** Every Sunday, a short summary of what got built in this repo that week, what's stalled and on what, and where the Claude tokens went.

**Why this one:** It keeps the many parallel sub-projects legible without re-reading `TODO_FIRST.md`, and spots projects that are quietly stuck.

**What it needs when resumed:**
- Done when: a Sunday push or page shows commits by sub-project, stalled items, and token use by project, all matching reality.
- Git log for what got built; U7's blocker list for what's stalled.
- Reuse `claude_usage_analyst/` for token and cost data.
