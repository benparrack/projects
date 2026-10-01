# Progress

## 2026-10-01: all four parts built
- [x] Pre-trade check: sizing, flags, base rates, earnings, correlation/sector/heat, chart, verdict
- [x] Journal + portfolio: paper/real accounts, plans → fills → review, stats by setup/discipline/exit,
      equity vs SPY, FIFO tax estimate with wash sales, USD conversion for foreign stocks
- [x] Phone alerts via ntfy: stop/target/time on open trades (paper auto-exit), planned-entry reached, custom
      price/move rules, earnings soon, volume spike, 52-week high/low, unusual move, SEC Form 4 insider buys,
      saved-strategy signals; watcher thread + systemd unit
- [x] Strategy lab: safe rule language, next-open execution, in/out-of-sample split, random-entry baseline,
      presets (RSI-2 dip, 20-day breakout, golden cross, gap-down reversal), save + alert
- [x] 21 offline pytest tests; UI tested in Firefox (desktop + 390px phone width)

Observed on launch day, 10 volatile tickers over 5 years: RSI-2 dip NO EDGE (p≈0.22), 20-day breakout NO EDGE,
gap-down reversal NO EDGE, golden cross TOO FEW TRADES. That's expected and is the point of the random baseline.

## Waiting on Ben
- Subscribe to the ntfy topic (Alerts tab) and press "Send test alert".
- Optionally add an SEC contact in Settings for insider-buy alerts.
- Optionally install the systemd service (SETUP.md step 3).
- Paper trade for a few weeks: every trade through Check → Journal review. Look at Stats after ~20 trades.

## Ideas / not done
- Exchange holiday calendars (the scanner currently assumes every weekday is a session)
- Import fills from a broker CSV (Avanza / IBKR) instead of typing them
- Swedish tax view (ISK / KF accounts are taxed on value, not gains)
- Lab: position-sizing simulation (equity curve with 1% risk per trade), walk-forward parameter search
- Trailing-stop automation for paper trades
