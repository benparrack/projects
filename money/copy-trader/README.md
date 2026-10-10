# Copy Trader (paper only)

Does copying "smart money" actually beat buying the index? This bot copies three kinds of
leaders with **simulated money only**:

- **13F funds** (SEC EDGAR): Berkshire, Pershing Square, Appaloosa, Baupost, Duquesne,
  Third Point, Lone Pine, Tiger Global.
- **US Congress** stock trades (House Clerk PTR PDFs and Senate eFD).
- **Hyperliquid** top perp traders (public info API).

It runs a backtest and a live paper-trading loop through the **same engine**, then reports
the results against SPY (stocks) or BTC (crypto), before and after US tax. It never places a
real order and holds no exchange keys. Setup: **[SETUP.md](SETUP.md)**. Results and caveats:
**[PROGRESS.md](PROGRESS.md)**.

```
.venv/bin/python copytrade.py status            # live state + live performance  ← the one to remember
.venv/bin/python copytrade.py perf --mode backtest
.venv/bin/python copytrade.py trades [--mode backtest] [--strategy congress_all] [-n 40]
.venv/bin/python copytrade.py report            # -> report/index.html (charts + tables)
.venv/bin/python copytrade.py backtest [--only ID ...] [--kinds stocks crypto]
.venv/bin/python copytrade.py fetch-history [13f house senate prices hl]   # slow, resumable
.venv/bin/python copytrade.py tick              # one live step (what the timer runs)
.venv/bin/python copytrade.py notify-test
.venv/bin/python -m unittest discover -s tests -t .
```

## How it works
- **Sources** (`ct/sources/`)
  - EDGAR: 13F-HR information tables. The filing's acceptance time is when it became public.
    CUSIPs are mapped to tickers through OpenFIGI.
  - House: the yearly FD index ZIP plus each electronic PTR PDF (parsed with pdfplumber).
    Paper filings (scans) are skipped.
  - Senate: eFD search plus each PTR page. Congress filings count as public at the end of
    the filing day + 1 day.
  - Hyperliquid: the leaderboard, plus each trader's fills, positions and account history,
    and hourly candles and funding.
- **Strategies** (`config.yaml`)
  - **Fund strategies:**
    - `13f_<fund>`: copy one fund.
    - `13f_all_funds`: the average of all funds.
    - `13f_top3_trailing`: each quarter after the filing deadline, hold the 3 funds whose
      13F portfolios did best over the trailing year.
  - **Congress strategies:**
    - `congress_all`: every member's disclosed book, weighted by dollar size.
    - `congress_top10_trailing`: each quarter, the 10 members whose disclosed books did best
      over the trailing year (minimum 4 trades).
  - **Hyperliquid strategies:**
    - `hl_top5_roi30` / `hl_top5_roi90`: each month, the 5 traders with the best 30- or
      90-day return on account value. They must be profitable, have ≥ $100k, and make
      between 3 and 2000 fills a month.
  - Positions are copied proportionally: our weight = the leader's position ÷ the leader's
    account value, capped at `max_leverage` gross (default 1x).
- **Engine** (`ct/engine.py`)
  - Execution waits for the next bar's open after the information became public, plus a
    delay: the next day's open for stocks, the next hourly open for crypto. There is no
    lookahead.
  - Costs: slippage, commissions or taker fees, Hyperliquid funding, and liquidation at
    maintenance margin (checked with the bar's high/low).
  - Tax: FIFO lots. US federal short-term rate (configurable) vs 15% long-term, with
    loss carry-forward. After-tax figures assume you sell everything at the end.
  - `Broker` is an interface; only `PaperBroker` exists.
- **Live** (`ct/live.py`): a systemd user timer runs `tick` every 15 minutes.
  - Throttled ingestion.
  - Monthly Hyperliquid re-pick, and a snapshot of the followed traders on every tick.
  - Deterministic replay of everything since the live start, into SQLite (`copytrader.sqlite`).
  - `report/index.html` is regenerated, and a daily ntfy summary is sent after 22:15 Stockholm time.
- **Robustness:** every step is wrapped. A dead source is logged, shown in `status`, and
  retried on the next tick. A `STOP` file in this folder pauses ticks.
