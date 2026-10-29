# Limber reminders

Evening pings on your phone, only on days you haven't stretched yet.

How it works: when you finish a session (2+ minutes), the app posts `done <date> <mode> <min>` to the
ntfy topic `<topic>-done`. `remind.py` runs every 15 minutes, reads that topic, and at each reminder time
(default 19:30 and 22:00) sends a nudge to `<topic>` if today isn't done. On Sunday evenings
(`recap`, default 20:45, `""` turns it off) it also sends a summary of the week. If the computer was off at
19:30 you get one ping at 22:00, not two.

## Setup

1. Install **ntfy** on your phone (Play Store / App Store) and subscribe to your topic.
2. Create `config.json` here (gitignored, the topic is your secret):
   ```json
   { "topic": "limber-something-random", "times": ["19:30", "22:00"], "recap": "20:45", "desktop": true, "app_url": "" }
   ```
   `desktop` also shows a `notify-send` popup on this machine. `app_url` is opened when you tap the notification.
3. Test it: `python3 remind.py --test`
4. Install the timer:
   ```sh
   cp limber-remind.service limber-remind.timer ~/.config/systemd/user/
   systemctl --user daemon-reload && systemctl --user enable --now limber-remind.timer
   ```

When the app is served over http from this folder it reads the topic from `config.json` automatically,
so Settings → Reminders is already filled in. Otherwise paste the same topic there.

Tests: `python3 test_remind.py`

Notes: ntfy.sh keeps messages about 12 hours, which is why the script polls often and remembers done
days in `state.json`. Anyone who knows the topic name can read or post to it.
