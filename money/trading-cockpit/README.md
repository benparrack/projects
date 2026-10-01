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
| **Today** | Morning briefing (also pushed to your phone on weekdays): positions near their stop or target, hold time up, planned entries in reach, earnings in the next 2 days, heat over the cap, lab signals and screener hits. Discipline status (today/week realized P/L vs your limits, losing streak). **AI journal coach** (Claude reviews your process, not stock picks). Weekly HTML reports. |
| **Check** | Pre-trade check. Enter a ticker (and optionally entry/stop/target; defaults are 2×ATR / 4×ATR). You get a position size so a stop-out costs ~1% of the account, plus a GO / CAUTION / STOP verdict with flags: reward:risk, stop too tight vs ATR, overnight gaps through the stop, **earnings inside your hold window** (with that stock's past earnings moves), portfolio heat, sector concentration, correlation with holdings, liquidity, penny stock, below the 200-day average. It also shows **base rates**: from every day in the last 3 years, how often this exact stop/target hit the target first vs the stop. Save the plan, then paper-buy or record your real fill. |
| **Portfolio** | Equity, cash, P/L, **your account vs. the same deposits put in SPY**, total open risk, open trades with distance to stop/target, planned trades, holdings with days until long-term, deposits/withdrawals. |
| **Journal** | Every plan with thesis, setup tag, fills, R-multiple, return, exit reason, and whether you followed the plan. Closed trades without a review get flagged. |
| **Stats & Tax** | Win rate, expectancy in R, profit factor, stats by setup / discipline / exit reason. Estimated US tax per year (FIFO lots, short- vs long-term, $3k loss limit + carryover, wash-sale flags). |
| **Alerts** | Watchlist + price alerts + ntfy phone pushes. Automatic for open trades: stop hit, target hit (paper trades auto-sell), planned hold time up; for planned trades: price at entry. For watched tickers: earnings within N days, volume spike, 52-week high/low, unusually large move, **insider open-market buys** from SEC Form 4 (needs an SEC contact in Settings). |
| **Chart** | Candlesticks with volume and 20/50/200-day averages, your buys and sells as markers, and the open plan's entry/stop/target (and the original stop, once trailing has raised it). Crosshair readout, 3M–2Y. Headlines for the ticker, plus an optional Claude summary of them. |
| **Screener** | Run any Lab rule across the S&P 500, Stockholm large/mid cap, a volatile-US list, or your watchlist, with price / dollar-volume / ATR% filters. Saved screens run every weekday evening; hits land in the briefing and (optionally) as a push. |
| **Lab** | Write a buy rule like `close > sma(close, 200) and rsi(2) < 10`, an optional sell rule, stop/target/max-hold, and backtest it across tickers. It trades at the next open (no lookahead), holds out the last 30% of data, and compares against **random entries with the same exits** (500 runs). Verdict: EDGE / NO EDGE / TOO FEW TRADES. Strategies you save can send phone alerts when they fire. **Account simulation:** the same trades run as one $10k account (1% risk per trade, max N positions) vs SPY, with CAGR and max drawdown. **Robustness search:** grid over stop/hold/target (and a `$p` number in the rule), choose on the older 70%, see where the pick lands on the newer 30%; verdict ROBUST-ISH / OVERFIT RISK. **Compare** saved strategies side by side. |
| **Settings** | **Accounts & broker links** (Alpaca API, CSV import from Avanza / Nordnet / IBKR / any CSV), guardrails, briefing/report times, Anthropic key, phone-app PIN, risk per trade, max position, max heat, tax rates, paper slippage/fees, fractional shares, paper auto-exit, alert thresholds, ntfy topic, SEC contact. |

**Managing trades:** a plan can carry rules: stop to breakeven at +xR, trail N×ATR or N% under the high, sell part at
+xR. The alert scan applies them (paper: automatically; real: you get a push, and a linked Alpaca stop order is moved).
**Guardrails** block new buys after a daily/weekly loss limit or a losing streak, and adding to a loser; you can
override by writing why, and Stats tracks how overridden and unplanned trades do. **After-exit tracker:** for every
sale, where the price was 5/10/20 days later in R, summed up by exit reason, to show whether your exits are early.

**Accounts:** a *Paper* account ($1,000 to start; fills at the live price plus slippage) and a *Real* account, where
you enter what your broker actually filled you at. Everything is converted to USD at the time of the trade, so
Stockholm (`.ST`) stocks work too.

## Layout

```
cockpit/
  server.py   Flask routes, chart data; registers the modules below
  service.py  glue: state, check, plans, trades, journal, equity curve
  risk.py     sizing, ATR, base rates, earnings moves, the check's flags/verdict   (pure)
  ledger.py   cash, FIFO lots, wash sales, tax, per-plan P/L, equity curve         (pure)
  market.py   yfinance with disk/memory caches, FX, exchange hours
  alerts.py   watchlist/rules, scanners, SEC Form 4, watcher loop (`python -m cockpit.alerts --once`)
  notify.py   ntfy.sh push
  lab.py      safe rule language (AST whitelist), backtest engine, presets, strategy signals
  broker.py   Alpaca sync/bracket orders/stop moves; CSV parsers (Avanza, Nordnet, IBKR, generic) + import
  manage.py   guardrails, trailing stops / scale-outs, after-exit tracker
  screener.py market-wide scans (universes/*.csv)
  reports.py  morning briefing, weekly HTML report, scheduler; /api/today, news routes
  ai.py       Anthropic API: news summaries, journal coach (optional)
  pwa.py      phone app: manifest, service worker, icons, PIN gate for non-local requests
  db.py       SQLite schema + settings (data/cockpit.sqlite)
  static/     index.html, app.js (check/portfolio/journal/stats/settings), alerts.js, lab.js, more.js (today/screener/chart/broker), Chart.js
tests/        pytest, offline (`.venv/bin/python -m pytest -q tests`)
```

See SETUP.md for phone alerts and running it in the background, and PROGRESS.md for status and ideas.

**Not financial advice.** Data comes from Yahoo Finance via yfinance (unofficial, sometimes delayed or wrong).
Tax numbers are a rough US federal estimate; living in Sweden may create Swedish obligations too.
