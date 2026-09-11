# Sports Arbitrage Scanner

Scans soccer odds across multiple bookmakers via [The Odds API](https://the-odds-api.com/)
and flags arbitrage opportunities: cases where the best available odds on all three
outcomes (home / draw / away) across different books imply a combined probability
under 100%, meaning you could stake all three outcomes and guarantee a profit
regardless of the result.

Pure odds math — no prediction, no machine learning.

**Disclaimer:** Odds move fast; an opportunity found here may shrink or vanish
before you can place bets. This is not financial advice. Some bookmakers restrict
or ban accounts that arbitrage consistently, and arbitrage betting/using multiple
accounts may be against a book's terms of service or local law — check both before
acting on anything this tool reports.

## Setup

```bash
cd sports-arb-scanner
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Get a free API key at https://the-odds-api.com/ (free tier: ~500 requests/month)
and paste it into `.env`:

```
ODDS_API_KEY=your_key_here
```

## Configuration

Defaults live in `config.py` (leagues, regions, bankroll, log path). Any of them
can be overridden per-run via CLI flags — see Usage below.

## Usage

```bash
# See currently active soccer league keys (free call, no credits used)
python main.py --list-sports

# Scan the default league set with default regions/bankroll
python main.py

# Scan specific leagues
python main.py --leagues soccer_epl,soccer_italy_serie_a

# Wider bookmaker coverage, bigger example bankroll
python main.py --regions uk,eu,us --bankroll 250

# Only report opportunities with at least 0.5% profit margin
python main.py --min-margin 0.5

# Custom log file
python main.py --log-file logs/custom.log
```

Every run is single-shot — it makes its API calls, reports results, and exits.
There's no built-in scheduler; if you want recurring scans, wire this into your
own cron job.

## Credit usage

The Odds API free tier gives ~500 credits/month. `--list-sports` is free.
`/odds` calls cost roughly `markets requested x regions requested` credits per
league per run — this tool always requests a single market (`h2h`), so cost is
just `regions x number of leagues scanned`. Tune `--leagues` and `--regions` to
control spend. Each run logs a summary line with your remaining credit balance.

## Output

Results go to both the console and `logs/scanner.log` (created automatically).
Each arbitrage opportunity includes the match, kickoff time, best odds and
bookmaker per outcome, total implied probability, profit margin, and a
suggested stake split for the configured bankroll that locks in an equal
payout regardless of the result.

## Tests

```bash
pytest
```

Unit tests cover the arbitrage math only (`arbitrage.py`) — no network calls,
using a known worked example plus edge cases (non-arbitrage odds, malformed
events).
