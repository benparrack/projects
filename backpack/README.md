# Backpack

A myHomework-style planner that fills itself in. A student pastes their school
calendar feed link once (Canvas, Schoology, or anything with an iCal feed), and their
classes and assignments show up on their own.

**Features:** Overdue / Today / Tomorrow / This week / Later list, month calendar,
summary counts, class filters and colors, tests and quizzes flagged, lectures and other
calendar events shown separately (no checkbox), detail sheet with the assignment text,
your own notes and an "Open in Canvas" link, your own tasks (with optional time), an undo
toast, sample-data mode for first-time visitors, a backup file to move to a new phone,
dark mode, and it installs to the home screen and opens offline.

**How it's built:**
- **Data stays on the device** (localStorage). There are no accounts and no database.
  Syncing replaces only the feed items. Checkmarks, notes, class moves and colors, and
  the user's own tasks are never overwritten. If a feed fails to load, its last copy is kept.
- **`worker.js`** is a Cloudflare Worker. It serves `public/` and has one endpoint,
  `/feed?url=…`, which fetches a feed on the browser's behalf, because school servers
  don't allow cross-site fetches. It only ever returns content that starts with
  `BEGIN:VCALENDAR`, so it can't be abused as a general proxy.
- **Feed formats** (`public/ics.js`) were checked against Canvas's source
  (`CalendarEvent#to_ics`: `Title [COURSE CODE]`, UIDs `event-assignment-N` vs
  `event-calendar-event-N`, `TZID=UTC` times) and two open-source Schoology parsers
  (no course in the feed, link at the end of DESCRIPTION, `TZID=America/...` wall times).
  Schoology items land in "Unsorted"; tap one to file it under a class.

## Run

```
npm run dev      # http://localhost:5195 (same /feed handler as the Worker)
npm test         # parser + proxy tests
```

## Deploy (free Cloudflare account)

```
npx wrangler login
npm run deploy   # → https://backpack.<your-subdomain>.workers.dev
```

On a phone, open the URL and use "Add to Home Screen" to get it as an app.

## Not done yet

- Sync across devices (would need accounts and a database, e.g. Cloudflare D1).
- Reminders and push notifications.
- Auto-checking submitted work (Canvas API + personal token).
- Not yet tried against a real Canvas or Schoology feed. Formats come from their source code and other parsers.
