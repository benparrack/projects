# Backpack

A myHomework-style planner that fills itself in. A student pastes their school
calendar feed link once (Canvas, Schoology, or anything with an iCal feed).
Their classes and assignments then show up grouped by Overdue / Today / Tomorrow /
This week / Later, and they check them off.

- **Data stays on the device** (localStorage). There are no accounts and no database.
  Syncing replaces only the feed items. Checkmarks, class colors and names, and the
  user's own tasks are never overwritten. If a feed fails to load, its last copy is kept.
- **`worker.js`** is a Cloudflare Worker. It serves `public/` and has one endpoint,
  `/feed?url=…`, which fetches a feed on the browser's behalf, because school servers
  don't allow cross-site fetches. It only ever returns content that starts with
  `BEGIN:VCALENDAR`, so it can't be abused as a general proxy.
- Canvas puts the course in the title as `Title [Course]`. Other feeds fall back to
  the calendar's name, so all of a Schoology feed lands in one class for now.

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
- Splitting Schoology items into classes (needs a real Schoology feed to see its format).
- Auto-checking submitted work (Canvas API + personal token).
- Offline service worker, reminders, calendar view.
