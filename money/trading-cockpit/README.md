# Trading Cockpit

A local web app that helps with the trading *process*: sizing, risk checks, journaling, tracking, alerts and
honest backtests. It never predicts which way a stock will go. The sibling project `../stock-predictor/` tried
that and found no edge (out-of-sample AUC ≈ 0.51). This tool assumes the edge has to come from you, and its job is
to keep each trade small, planned and recorded.

```bash
./run.sh            # first run creates .venv; then open http://localhost:5070
```

(Port 5070 because Firefox refuses to open 5060/5061, which are SIP ports.)

## The tabs

| Tab | What it does |
|---|---|
| **Check** | Pre-trade check. Enter a ticker (and optionally entry/stop/target; defaults are 2×ATR / 4×ATR). You get a position size so a stop-out costs ~1% of the account, plus a GO / CAUTION / STOP verdict with flags: reward:risk, stop too tight vs ATR, overnight gaps through the stop, **earnings inside your hold window** (with that stock's past earnings moves), portfolio heat, sector concentration, correlation with holdings, liquidity, penny stock, below the 200-day average. It also shows **base rates**: from every day in the last 3 years, how often this exact stop/target hit the target first vs the stop. Save the plan, then paper-buy or record your real fill. |
| **Portfolio** | Equity, cash, P/L, **your account vs. the same deposits put in SPY**, total open risk, open trades with distance to stop/target, planned trades, holdings with days until long-term, deposits/withdrawals. |
| **Journal** | Every plan with thesis, setup tag, fills, R-multiple, return, exit reason, and whether you followed the plan. Closed trades without a review get flagged. |
| **Stats & Tax** | Win rate, expectancy in R, profit factor, stats by setup / discipline / exit reason. Estimated US tax per year (FIFO lots, short- vs long-term, $3k loss limit + carryover, wash-sale flags). |
| **Alerts** | Watchlist + price alerts + ntfy phone pushes. Automatic for open trades: stop hit, target hit (paper trades auto-sell), planned hold time up; for planned trades: price at entry. For watched tickers: earnings within N days, volume spike, 52-week high/low, unusually large move, **insider open-market buys** from SEC Form 4 (needs an SEC contact in Settings). |
| **Lab** | Write a buy rule like `close > sma(close, 200) and rsi(2) < 10`, an optional sell rule, stop/target/max-hold, and backtest it across tickers. It trades at the next open (no lookahead), holds out the last 30% of data, and compares against **random entries with the same exits** (500 runs). Verdict: EDGE / NO EDGE / TOO FEW TRADES. Strategies you save can send phone alerts when they fire. |
| **Settings** | Risk per trade, max position, max heat, tax rates, paper slippage/fees, fractional shares, paper auto-exit, alert thresholds, ntfy topic, SEC contact. |

**Accounts:** a *Paper* account ($1,000 to start; fills at the live price plus slippage) and a *Real* account, where
you enter what your broker actually filled you at. Everything is converted to USD at the time of the trade, so
Stockholm (`.ST`) stocks work too.

## Layout

```
cockpit/
  server.py   Flask routes; starts the alert watcher thread
  service.py  glue: state, check, plans, trades, journal, equity curve
  risk.py     sizing, ATR, base rates, earnings moves, the check's flags/verdict   (pure)
  ledger.py   cash, FIFO lots, wash sales, tax, per-plan P/L, equity curve         (pure)
  market.py   yfinance with disk/memory caches, FX, exchange hours
  alerts.py   watchlist/rules, scanners, SEC Form 4, watcher loop (`python -m cockpit.alerts --once`)
  notify.py   ntfy.sh push
  lab.py      safe rule language (AST whitelist), backtest engine, presets, strategy signals
  db.py       SQLite schema + settings (data/cockpit.sqlite)
  static/     index.html, app.js (check/portfolio/journal/stats/settings), alerts.js, lab.js, Chart.js
tests/        pytest, offline (`.venv/bin/python -m pytest -q tests`)
```

See SETUP.md for phone alerts and running it in the background, and PROGRESS.md for status and ideas.

**Not financial advice.** Data comes from Yahoo Finance via yfinance (unofficial, sometimes delayed or wrong).
Tax numbers are a rough US federal estimate; living in Sweden may create Swedish obligations too.
