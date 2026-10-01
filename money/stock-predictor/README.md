# Stock Predictor

Trains a machine-learning model on past daily prices of volatile stocks, tests it
honestly, and tells you whether to BUY, WAIT or AVOID each one right now. The
honest test matters most: if the model can't beat a coin flip out of sample, the
tool says so and refuses to make BUY calls.

**Not financial advice.** It's a statistical experiment, with no broker connection
and no real orders.

## Quick start

```bash
./run.sh scan                      # find the ~12 most volatile liquid stocks → watchlist.txt
./run.sh run --watchlist           # train, backtest, recommend for the watchlist
./run.sh run TSLA COIN PLTR --explain   # or name your own tickers (Stockholm: EVO.ST, SINCH.ST)
./run.sh run --csv my_prices.csv   # or your own data (Date, Open, High, Low, Close, Volume)
```

The first run creates `.venv` and installs the requirements. Each run writes
`reports/report_<date>.html` (and `reports/latest.html`) with the recommendation
table, a calibration chart and per-ticker equity curves. A run takes about a minute.

Useful flags for `run`: `--horizon 5` (days ahead), `--buy-threshold 0.55`,
`--account 1000` (position sizing), `--cost-bps 10`, `--train-on mine` (train only
on your tickers instead of also using the ~60 built-in volatile stocks).

## How it works

1. **Data**: yfinance daily adjusted OHLCV (cached in `data/` for the day), plus SPY and
   VIX for market context. Today's still-open bar is dropped.
2. **Features** (40): returns over 1–120 days, volatility and its regime, RSI, MACD,
   distances to moving averages, Bollinger position, ATR, gaps, volume surprises,
   1-year drawdown, and market/VIX state with relative strength. A test checks that
   every feature at day *t* uses only data up to *t*.
3. **Target**: is the close `horizon` days later higher than today?
4. **Walk-forward**: one pooled gradient-boosting model across all tickers, retrained
   every 63 trading days. Each model is trained only on labels that were already
   known when its test period started (purged by `horizon` days, also tested).
5. **Is there an edge?** The tool reports pooled out-of-sample AUC on
   non-overlapping predictions with a p-value. It also checks whether the model's
   most bullish fifth of predictions actually earned more than its least bullish
   fifth and more than average. All of these must pass, or every call becomes
   `NO EDGE`.
6. **Per-ticker backtest**: go long when P(up) ≥ threshold, exit below 0.50,
   charging costs per trade. It is compared with buy-and-hold over the same period,
   with a permutation test (random time-shifts of the same trades) to check whether
   the timing is real.
7. **Recommendation**: BUY needs a passing model, a bullish signal and a decent
   track record on that ticker. LEAN BUY is bullish with a weak track record. Each
   buy gets a 2×ATR stop and 3×ATR target, and is sized to risk 1% of the account.

## What it found (2026-10-01)

On the 60 built-in volatile stocks, with up to 10 years of history and about 100k
rows, the honest answer was **no edge** at 5, 10 and 20-day horizons. The best AUC
was about 0.51, and at 5 and 10 days the model's most bullish picks did worse than
its least bullish. Buy-and-hold beat the model's timing on Sharpe for almost every
ticker. This matches the research: past prices alone carry very little usable
signal for the short-term direction of single stocks. The tool's value is that it
won't fool you. If you add better inputs (earnings dates, news/sentiment, options
flow) to `features.py`, re-run it and see whether the verdict changes.

## Tests

```bash
.venv/bin/python -m pytest -q tests
```
