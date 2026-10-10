# Copy Trader: Setup

It is already installed and running (systemd user timer). These are the steps to redo it from
scratch.

```
cd ~/projects/money/copy-trader
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python copytrade.py fetch-history      # 1–3 h: EDGAR, House PDFs, Senate, prices, Hyperliquid
.venv/bin/python copytrade.py backtest
```

## Phone summary (optional)
Put `NTFY_ALERT_TOPIC=<topic>` in `.env` (it's the same topic flip-bot uses, already copied).
Without it, the summary is only logged. Test it with `copytrade.py notify-test`.

## Timer
```
mkdir -p ~/.config/systemd/user
ln -sf ~/projects/money/copy-trader/copytrader.service ~/.config/systemd/user/
ln -sf ~/projects/money/copy-trader/copytrader.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now copytrader.timer
loginctl enable-linger $USER        # keep running while logged out (optional)
```
Check: `.venv/bin/python copytrade.py status`. Logs: `journalctl --user -u copytrader -n 50`.
Pause: `touch STOP` (or `systemctl --user disable --now copytrader.timer`).

## Restart live paper trading from today
`sqlite3 copytrader.sqlite "DELETE FROM kv WHERE k='live_start'; DELETE FROM runs WHERE mode='live'; DELETE FROM hl_selections;"`
