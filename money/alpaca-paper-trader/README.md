# Alpaca Paper-Trading Bot

Runs a mechanical, rule-based technical strategy (no prediction/ML) against a
randomly-sampled slice of the US stock market, and places **paper** (simulated
money, real market data) orders through [Alpaca](https://alpaca.markets/)
when its rules trigger.

**Disclaimer:** Paper trading only. Even good paper results don't guarantee
live performance — slippage, fees, execution latency, and psychology under
real money all differ. Not financial advice.

## Setup

```bash
cd alpaca-paper-trader
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Get free Alpaca paper trading API keys at https://alpaca.markets/ — sign up,
generate keys from the paper trading dashboard, no funding required. Paste
them into `.env`:

```
ALPACA_API_KEY=your_key
ALPACA_SECRET_KEY=your_secret
```

## Strategy

SMA(20)/SMA(50) crossover: a **golden cross** (the 20-day average crosses
above the 50-day average on the latest bar) triggers a BUY; a **death cross**
(20-day crosses below 50-day) triggers a SELL on any currently-held position.

Known limitations of this v1 rule: it whipsaws (generates false signals) in
choppy/sideways markets, and there's no stop-loss — a SELL only fires on the
next death cross, however far price has moved by then. RSI is a natural v2
addition, following the same pure-function pattern as `indicators.py`.

## Universe & sampling

Rather than trading a curated list like the S&P 500, each run pulls Alpaca's
full tradable US equity list, filters to NASDAQ/NYSE/ARCA with plain ticker
symbols, shuffles it, and walks the shuffled list checking price/liquidity
(min price $5, min 20-day average volume 500,000 shares) until it collects a
sample (default 30 symbols). This is capped at a fixed API call budget
regardless of market size: 1 call to list assets + a few batched bars calls
(~4 Alpaca calls total per run at default settings) — it never fetches bars
for the entire multi-thousand-symbol market.

## Position sizing & risk caps

| Parameter | Default |
|---|---|
| Dollars per new BUY | $500 flat (`notional`) |
| Max concurrent positions | 10 |
| **Max capital ever deployed at once** | **$5,000** |
| Add to an existing position | Never — a BUY signal on an already-held symbol is a no-op |
| Sell without a position | No-op |
| Sell sizing | Full position — no partial scale-out |

## Safety rails

- **Paper vs. live**: this project only trades paper by default. Reaching the
  live endpoint requires *both* `--live` on the command line *and*
  `ALLOW_LIVE_TRADING=true` in `.env` — checked twice in code. There is no
  other way to enable live trading.
- **Error handling is tiered by blast radius**: a failure fetching
  account/positions/orders aborts the whole run (can't safely trade blind to
  current state); a failed bars batch drops only those ~50 candidate symbols;
  a failure on one symbol's signal/order skips only that symbol.
- **Duplicate-order protection**: before evaluating a symbol, the bot skips
  it if an order is already open for it; every submitted order also carries a
  deterministic `client_order_id` (`papertrader-{symbol}-{date}-{side}`), so
  Alpaca itself rejects an accidental double-submission.
- **Spending cap**: max concurrent positions × dollars per trade = a hard
  $5,000 ceiling at defaults, enforced before every BUY.

## CLI reference

```bash
# One-time manual cycle, default sample size (30), paper trading
python main.py run

# Manual cycle with a smaller sample for a first real test
python main.py run --sample-size 3

# Check connectivity, account, positions, orders — zero risk, no trading
python main.py status

# Flip the scheduled-run toggle on/off
python main.py enable
python main.py disable

# What a future scheduler would call — exits quietly if disabled
python main.py scheduled-run

# Custom log file location
python main.py run --log-file logs/manual_run.log
```

`run` always executes immediately, ignoring the enable/disable toggle.
`scheduled-run` checks the toggle first and does nothing if disabled.

## Wiring `scheduled-run` to a real scheduler (later)

`main.py scheduled-run` is designed to be pointed at cron, or at Claude
Code's own `schedule` skill, whenever you're ready for unattended runs. That
wiring is intentionally not set up yet — this version only builds the
toggle and the entry point.

## Testing

```bash
pytest
```

Unit tests cover `indicators.py`, `strategy.py`, and `state.py` — no network,
using hand-computed fixtures.

## Manual end-to-end verification

1. `python main.py status` — confirms connectivity/account info, zero risk.
2. `python main.py run --sample-size 3` — a small real cycle; check
   `logs/trader.log` and re-run `status` to see any resulting paper
   position/order.
3. `python main.py enable` → `python main.py scheduled-run` (should trade) →
   `python main.py disable` → `python main.py scheduled-run` (should exit
   quietly, no trading).
