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

## 4. Real money
Use the **Real** account: add your deposit on the Portfolio tab, run a check, place the order at your broker,
then record the actual fill (shares, price, fees). The cockpit never talks to a broker.
