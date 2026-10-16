# Rise

Gets Ben to morning classes. The class schedule sets the iPhone alarm every night. The
phone screen fades in like a sunrise before it. Backup alarms keep coming every 5 min
until you scan a QR code taped in another room. Then the screen shows your class, room,
when to leave, the weather and your streak. It never makes more noise than a normal
iPhone alarm, so it's roommate-safe.

## What's where

- `plan.js`: pure logic. Picks the coming morning (tomorrow, or today before 05:00), finds the
  first timed class (skips Canvas due dates, all-day and cancelled items; expands
  DAILY/WEEKLY repeating events with EXDATE and moved sessions), applies overrides, and scores
  mornings (on time = scanned before the last backup + 5 min).
- `worker.js`: Cloudflare Worker. `/alarms` and `/note` (plain text for the Shortcut), `/api/home`,
  `/api/up`, `/api/override`. Every endpoint needs `?k=KEY`. KV keeps the last good calendar (used
  when the feed is down), the morning log and the overrides. `/alarms` never answers empty because of
  a bad feed: it uses the saved calendar, then `FALLBACK`.
- `public/`: the app. Home (next alarm, phone check, streak, history, week with skip and custom-time controls),
  night mode (checklist, then black, then a 20-min sunrise, then the morning screen with a countdown to the next
  backup), and the setup guide at `/#setup` with your links filled in. `?at=HH:MM&ramp=MIN` tries night mode.
- `ics.js`: iCal parser, copied from `backpack/` and extended (location, status, repeats).
- Settings are in `wrangler.toml` `[vars]`.

## Run / deploy

```
npm test
printf 'FEED_URL=<link>\nKEY=dev\n' > .dev.vars && npm run dev    # http://localhost:8787/?k=dev

npx wrangler login
npx wrangler kv namespace create RISE    # paste the id into wrangler.toml
npx wrangler secret put FEED_URL         # TimeEdit "subscribe" link (space-separate several)
npx wrangler secret put KEY              # any long random string
npm run deploy                           # then open https://rise.<you>.workers.dev/?k=<KEY>#setup on the iPhone
```

The setup guide inside the app walks through the two Shortcuts, the two automations, the QR
and the iPhone settings. The Shortcuts action names are from iOS 17+ and have not been
checked on a real phone yet.
