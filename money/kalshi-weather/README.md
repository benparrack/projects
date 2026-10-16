# kalshi-weather

Does a weather model beat Kalshi's daily temperature markets ("Will NYC's high be 72–73°F today?") after fees?
This project downloads every settled market, its hourly order-book quotes and archived forecasts from nine
weather models, then runs a strict walk-forward backtest and prints a verdict: **EDGE**, **MAYBE** or **NO EDGE**.
Live picks are paper-traded until the verdict is EDGE.

## Run

```bash
./run.sh pull          # first time: several hours (~70k quote requests at Kalshi's ~5 requests/s). Resumes; re-run to top up.
./run.sh backtest      # walk-forward test, verdict, trains the live models, writes reports/latest.html
./run.sh scan          # today's picks from live quotes (logged to data/paper.csv)
./run.sh settle        # fill in paper-trade results
./run.sh report        # rebuild the report with current picks and the paper ledger
.venv/bin/python -m pytest -q tests
```

`scan` only shows markets at the two moments the backtest tested: **day-of** (daily highs, 07:00–08:59 local,
modelled at 08:00) and **evening-before** (highs and lows for tomorrow, from 18:00 local). Later in the morning the market
has seen hours of observations the model hasn't, so its picks would be stale.

## How it works

| Step | Where | What |
|---|---|---|
| Markets | `kalshi.py`, `data.py` | Every `KXHIGH*`/`KXLOW*` series, settled markets from both the live and historical endpoints, and hourly bid/ask candles (batched for recent markets). |
| Stations | `stations.py` | Settlement station parsed from each series' rules (`CLINYC` → KNYC, "recorded at EGLL"). US climate days run midnight to midnight local *standard* time all year; international ones use the civil day. |
| Forecasts | `weather.py` | Open-Meteo Previous Runs API: what GFS, ECMWF, ICON, GEM, JMA, Météo-France, UKMO, NBM and AIFS forecast 1–2 days ahead, from Feb 2024. Only forecasts already public at decision time are used. |
| NWS guidance | `nbs.py` | National Blend of Models text guidance (NBS, US stations), archived per run at IEM: the newest run issued ≥3 h before each decision. Alone it beats the 9-model ensemble (RMSE 2.7 vs 3.2 °F). |
| Observations | `obs.py` | ASOS observations from IEM: how far the models were off in the 3 hours before the decision. |
| Temperature model | `model.py` | Ridge regression of the settled value on the models' forecasts (bias-corrected per station and season), a second ridge for the spread, Student-t tails. Each bracket's probability is the t mass between its edges. |
| Blend | `model.py` | Logistic regression on the model's and the market's log-odds. If the market already knows everything, the model weight goes to ~0. A model-free baseline (`MarketCal`, the price recalibrated on history) shows how much is just favorite-longshot bias. |
| Backtest | `backtest.py` | Each month is predicted by models trained only on days before it. Trade if expected value beats the price plus Kalshi's taker fee (`ceil(0.07·C·P·(1−P))`) by a margin. The margin is picked on the first half of the months, and the second half (the holdout) decides the verdict. p-values come from a bootstrap over whole dates. |
| Live | `live.py` | Same features from current forecasts, quarter-Kelly sizing (≤10% of bankroll per market), paper ledger. |

`dataset.check_brackets` re-derives every market's result from the settled temperature (e.g. NYC: 0 of 8,277 wrong),
so the bracket semantics can't drift silently.

## Limits

- Forecasts more than 12 °F from the other models' median are dropped (NBM's archive has 72 °F highs on 29 °F days in Nov 2024).
- Since mid-August 2026 Kalshi settles on The Weather Company's figure instead of the NWS climate report (same stations).
  Settled minus hourly-METAR max looks the same before and after (~+0.7 °F at NYC/CHI/AUS/MIA/LAX), so older data is kept.
- Taker fills at the hourly closing bid/ask, and assumes our 10 contracts don't move the price. Thin markets will be worse.
- No maker (resting order) strategy. Makers pay no fee on most of these series, so a maker strategy could beat this one, but its fills can't be backtested from candles.
- Open-Meteo's free API is for non-commercial use, which covers paper trading. Real-money use should move to a paid key.
- Placing orders is out of scope: it needs a funded Kalshi account and API keys.
