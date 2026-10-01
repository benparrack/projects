# Setup

## 1. Run it
```bash
cd ~/projects/money/trading-cockpit && ./run.sh
```
Open http://localhost:5070. Data lives in `data/cockpit.sqlite` (git-ignored). Delete that file to start over.

## 2. Phone alerts (ntfy, free, no account)
1. Install **ntfy** (Play Store / App Store / F-Droid).
2. In the cockpit, open **Alerts**. Copy the topic shown there (generated on first start, like `cockpit-AbC123…`).
3. In the app: **+** → paste the topic → Subscribe.
4. Click **Send test alert**. It should arrive within a few seconds.

Keep the topic secret, since anyone who knows it can read your alerts. To get a new one, change it in Settings.

**Insider-buy alerts (optional):** the SEC asks automated tools to say who they are. In Settings → *SEC contact*,
enter something like `Ben Parrack yourname@example.com`. Leave it empty to skip insider checks. Only US tickers are covered.

## 3. Keep it running in the background (so alerts work with the browser closed)
```bash
mkdir -p ~/.config/systemd/user
cp ~/projects/money/trading-cockpit/cockpit.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now cockpit
loginctl enable-linger "$USER"     # keep running after logout
journalctl --user -u cockpit -f    # logs
```
Run `./run.sh` once before this so `.venv` exists. While the service runs, don't also start `./run.sh` (same port).

The scanner checks every 5 min while a market you watch is open (US 15:30–22:00, Stockholm 09:00–17:30 Swedish
time) and hourly otherwise. Change this in Settings. Exchange holidays aren't modeled; on a holiday it just
sees no movement.

## 4. Real money: link your broker
Three ways to get real fills in, set up under **Settings → Accounts & broker links** (add more accounts there, e.g.
"Avanza ISK"):

**Alpaca (live sync).** alpaca.markets → sign up → dashboard → *API Keys* → Generate. Use the Paper Trading
dashboard for paper keys first. Paste key ID + secret, pick paper/live. Every alert scan (and the *Sync now*
button) pulls new fills, deposits and dividends, attaches each buy to your planned trade for that ticker (or
creates an "unplanned" trade to review), and closes plans when you sell. Read-only by default; tick "allow orders"
to get a *Send bracket order to Alpaca* button in the plan window, and to let trailing stops move the stop order.
Alpaca is US-only for stocks, but accepts non-US residents for some account types; check before funding.

**CSV import (any broker).** Re-importing the same file never duplicates anything.
- *Avanza:* Min ekonomi → Transaktioner → pick dates → Exportera.
- *Nordnet:* Min sida → Transaktioner och notor → Exportera (the UTF-16 tab file is fine).
- *Interactive Brokers:* Reports → Statements → Activity → CSV.
- *Anything else:* columns `date,ticker,side,qty,price` (+ optional `fees,currency`).
Swedish exports name securities, not tickers; the preview looks up the Yahoo symbol (e.g. `VOLV-B.ST`) and lets you
fix it before importing.

**By hand.** Run a check, place the order at your broker, then record the actual fill.

## 5. AI features (optional)
Add an Anthropic API key (console.anthropic.com) in Settings. Used for the news summary button and the journal
coach (manual, or every Friday with the weekly report). Expect a few cents a week. Without a key, everything else works.

## 6. Phone app
1. Set an **access PIN** in Settings (any request not from this computer must enter it; without a PIN, remote access is refused).
2. Install Tailscale on the PC and the phone (free), then on the PC: `tailscale serve --bg 5070`.
   It prints an `https://<pc>.<tailnet>.ts.net` address. Put that in Settings → *Public URL* so notifications link to it.
3. Open that address on the phone, log in with the PIN, and use **Add to Home Screen**.

Alternative on the home Wi-Fi only: `COCKPIT_HOST=0.0.0.0 ./run.sh` (refuses to start without a PIN), then open
`http://<pc-ip>:5070`. Plain http means no install prompt or offline shell, but it works as a bookmark.
