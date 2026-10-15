# Rise

Gets Ben to morning classes. The class schedule sets the iPhone alarm each night,
the phone screen fades in like a sunrise before it, and the backup alarms keep
coming every 5 min until you scan a QR code taped in another room. It never makes
more noise than a normal iPhone alarm (roommate-safe).

- `worker.js` (Cloudflare Worker): reads the iCal feed in `FEED_URL`, finds the first
  timed class on the coming morning (tomorrow, or today if it's before 05:00),
  and serves `GET /alarms` (`08:00\n08:05\n08:10`, or empty when there's no class)
  and `GET /note` (bedtime line). Canvas assignment due dates are ignored. If the feed
  can't be read, it answers with the `FALLBACK` time, never with no alarm.
- `public/index.html`: sunrise page. It stays black, then goes red, orange and warm white over the
  20 min before the first alarm. `?at=07:45&ramp=1` to try it.
- `public/qr.html`: printable QR that runs the "I'm up" Shortcut.
- Settings are in `wrangler.toml` `[vars]`: `PREP_MIN`, `BACKUP_ALARMS`, `FALLBACK`, `TZ`.

## Run / deploy

```
npm test                              # schedule logic
echo "FEED_URL=<feed link>" > .dev.vars && npm run dev   # local, http://localhost:8787
npx wrangler login
npx wrangler secret put FEED_URL      # paste the iCal link (TimeEdit or Canvas)
npm run deploy                        # prints https://rise.<you>.workers.dev
```

## iPhone setup (Shortcuts app, iOS 17+)

Action names below are from iOS 17. Check them on the phone, because they may differ slightly.

**Shortcut "Rise"**
1. Get Contents of URL `https://rise.<you>.workers.dev/alarms`
2. Find Alarms where Label is `Rise`, then Delete Alarms (switch off "Confirm" if it's there).
3. Split Text (step 1 result) by New Lines, then Repeat with Each: if Repeat Item has any value,
   Create Alarm at Repeat Item, label `Rise`.
4. Get Contents of URL `.../note`, then Show Notification.

Step 1 runs first, so if the phone is offline the shortcut stops there and yesterday's alarms are left alone.

**Shortcut "I'm up"**: Find Alarms where Label is `Rise` and Is Enabled, then Toggle Alarm **off**.

**Automations** (Automation tab, set each to *Run Immediately*):
- Time of Day 22:00: run "Rise". This is the bedtime nudge, and the alarm gets set even if you forget to charge.
- Charger is Connected: run "Rise", then Open URLs `https://rise.<you>.workers.dev/`.

**Sunrise page**: open it in Safari, Share, then Add to Home Screen. Open it from there (only
home-screen apps can keep the screen on), turn brightness up and tap *Start night mode*.

**QR**: open `/qr.html`, print it and tape it in the kitchen or bathroom. Scanning it with the
Camera opens the "I'm up" Shortcut.
