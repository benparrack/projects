# Flip Bot — Setup (Ben's one-time steps, in order)

The bot runs fine with none of these done. It just does less: Blocket alerts go nowhere
without ntfy, and Tradera stays off without keys.

## 1. Phone alerts (2 min)
Install **ntfy** (Android/iOS) and subscribe to the topic from `grep NTFY_ALERT_TOPIC .env`.
Treat the topic name like a password: anyone who has it can read your alerts. The buttons on
alerts reply through the second topic (`NTFY_REPLY_TOPIC`), so you never need to type commands.
You *can* type them by publishing to the reply topic from the ntfy app: `status`, `stop`,
`resume`, `bought 3 250`, `arrived 3`, `shipped 3`.

## 2. Tradera API keys (10 min)
Register at the Tradera developer program (api.tradera.com → "Developer"/"Register
application"). You get an **App ID**, an **App key** and a **public key**. Set the application's
return/accept URL to anything (e.g. `https://example.com/tradera`); you only need to read the
`userId` from it in step 3. Add these to `.env`:
```
TRADERA_APP_ID=...
TRADERA_APP_KEY=...
TRADERA_PUBLIC_KEY=...
```
Check: `.venv/bin/python flip.py catalog check` prints real sold-price comps next to the seeds.
Fix any seed in `catalog.yaml` flagged as off by more than 25%.

## 3. Let the bot act on your Tradera account
`.venv/bin/python flip.py auth`: open the printed URL, accept, and paste the `userId`. The
token is saved to `.env`. Without it, Tradera deals arrive as alerts and you buy them
yourself. Payment still happens on Tradera: the bot buys, then you pay (Swish/card) when
Tradera asks.

## 4. Dry run for a day
`.venv/bin/python flip.py run` in a terminal. Everything says `[DRY RUN]`. Check that the
alerts look sane and the "would buy" picks are ones you'd actually buy.

## 5. Run in the background
```
mkdir -p ~/.config/systemd/user && cp flipbot.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now flipbot
journalctl --user -u flipbot -f     # logs
```
Note: the laptop has to be awake. Closing the lid pauses the bot.

## 6. Go live
In `config.yaml`, set `mode: live`, then run `systemctl --user restart flipbot`. Tune
`auto_buy_max_sek` (default 300; buys above it ask you first), `bankroll_sek`,
`daily_spend_cap_sek` and `max_open_flips`. To stop buying immediately: tap-publish `stop`,
or `touch STOP` in this folder.

## Your part of each flip
- **Tradera buy:** pay when Tradera asks → parcel arrives → drop photos in `inbox/<id>/`
  (the folder is created when you reply `arrived <id>`). The bot lists, reprices and tells you
  when it sells, with the address → ship → reply `shipped <id>`.
- **Blocket deal:** send the pre-written message → pick up + Swish → tap **Bought it** →
  same as above from "arrived".
