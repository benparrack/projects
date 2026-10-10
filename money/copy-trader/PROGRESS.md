# Copy Trader: Progress

Resume here. Usage is in `README.md`/`SETUP.md`, the spec is in `PROMPT.md` (garbled paste).
Tests: `.venv/bin/python -m unittest discover -s tests -t .` (27 passing, 2026-10-11).

## Status: built, backtested, live paper trading since 2026-10-10 11:31 (systemd timer, every 15 min)
Built in session 1 (2026-10-10/11):
- Sources: EDGAR 13F, OpenFIGI, House PTR PDFs, Senate eFD, Hyperliquid.
- Engine: costs, funding, liquidation, FIFO tax.
- 14 strategies; the runner shares one engine between backtest and live.
- Live tick, CLI, HTML report (`report/index.html`), ntfy daily summary, systemd units.

Data in the DB:
- 295 13F filings.
- Congress: 5,394 House and 1,454 Senate PTRs. That's about 35k transactions; paper
  filings are skipped.
- About 1,900 stock tickers.
- 150 Hyperliquid traders.

## Backtest results ($1,000 each, run 2026-10-11)

### Stocks: 2020-01-02 → 2026-10-09 (6.8 y) vs SPY +164.5% (CAGR 15.4%, max DD −33.7%, after tax +139.8%)
| strategy | return | CAGR | max DD | after-tax | beat SPY (pre/after tax) |
|---|---|---|---|---|---|
| 13f_duquesne | +413% | 27.3% | −35% | +335% | yes / yes |
| 13f_appaloosa | +309% | 23.1% | −31% | +254% | yes / yes |
| 13f_top3_trailing | +236% | 19.6% | −35% | +191% | yes / yes |
| 13f_pershing_square | +156% | 14.9% | −45% | +131% | no / no |
| 13f_tiger_global | +148% | 14.4% | −66% | +123% | no / no |
| 13f_all_funds | +145% | 14.1% | −33% | +120% | no / no |
| 13f_berkshire | +135% | 13.5% | −38% | +115% | no / no |
| congress_top10_trailing | +113% | 11.8% | −36% | +87% | no / no |
| congress_all | +104% | 11.1% | −30% | +86% | no / no |
| 13f_lone_pine | +81% | 9.2% | −58% | +66% | no / no |
| 13f_third_point | +73% | 8.4% | −48% | +59% | no / no |
| 13f_baupost | +72% | 8.3% | −46% | +59% | no / no |

### Crypto (Hyperliquid perps, 1x max leverage): 2026-04-01 → 2026-10-10 (0.53 y) vs BTC +21.5% (after tax +16.3%)
| strategy | return | max DD | after-tax | trades | fees | funding | beat BTC |
|---|---|---|---|---|---|---|---|
| hl_top5_roi30 | +51.5% | −34% | +39.1% | 882 | $47 | $31 | yes / yes |
| hl_top5_roi90 | −38.4% | −45% | −38.4% | 708 | $19 | $2 | no / no |

## Honest verdict
- **Most copy strategies lost to just holding the index.** 9 of the 12 stock strategies
  lost to SPY before and after tax. That includes the all-funds basket, both congress
  strategies, and Berkshire.
- **Copying Congress didn't work.**
  - The dollar-weighted book of every member returned +104% vs SPY's +165%.
  - "Copy the members whose disclosed books did best last year" did only slightly better
    (+113%).
  - The famous congressional alpha does not survive the ~1-month disclosure lag plus
    next-open execution.
- **The two 13F winners (Duquesne, Appaloosa) are hindsight.** They're on the list because
  they're famous now. Picking them in 2020 is exactly the bias this project is meant to
  expose.
- **The one rules-based winner is `13f_top3_trailing`** (+236% vs +165%, after tax +191% vs
  +140%). Each quarter it holds the 3 funds whose 13F portfolios did best over the past
  year, with no lookahead in the choice. But:
  - The pool it chooses from is the same hindsight-picked 8 funds.
  - It's one 6.8-year sample.
  - The live run is where it has to prove itself.
- **Crypto is noise, not signal.**
  - Over the same 6 months, two nearly identical rules picked overlapping traders and ended
    +52% and −38%.
  - The candidate pool is today's leaderboard, which is survivorship bias that
    flatters both.
  - The window is too short (API limit) to conclude anything. The live run is the real test.
- **Taxes:** they cost 15–25% of the gains on the high-turnover strategies, vs about 15% for
  holding SPY. That widens the gap.

## Caveats and limitations (read before trusting any number above)
- **Survivorship and hindsight:**
  - The Hyperliquid pool is today's top-150 by volume.
  - yfinance has no delisted tickers. Holdings we can't price are dropped and the rest
    renormalized. 617 of 1,419 13F CUSIPs are unmapped or unpriced. Average share of 13F
    value priced: Berkshire 96%, most funds 81–90%, Baupost only 52%.
  - The fund list itself is hindsight.
- **Crypto:**
  - The backtest is limited to about 200 days: Hyperliquid serves only ~5000 hourly candles
    and each user's 10k most recent fills.
  - Leader positions are rebuilt backwards from today's snapshot, with account value
    interpolated from about 47 portfolio points.
- **Congress modelling:**
  - Amounts are the midpoint of each disclosed range.
  - Partial sales are sized by amount.
  - A position not added to for 2 years is assumed gone.
  - Paper filings are skipped, and the occasional House row split across a page break
    is missed.
- **13F:** amendments, options and shorts are ignored. The holdings data is 45+ days old by
  design.
- **Prices and tax:**
  - Dividends are inside the total-return prices and not taxed.
  - Wash sales are ignored.
  - Tax is US federal only (not Swedish).
  - After-tax figures assume liquidation at the end.
- **Costs:** stocks pay 5 bps slippage and $0 commission. Crypto pays 4.5 bps taker fee + 5 bps
  slippage + real funding. The `fees` column excludes slippage, which is inside the fill prices.

## Live notes
- **Stocks** start replaying from the first session after go-live (Mon 2026-10-12).
- **Hyperliquid** leaders were re-picked at go-live and are re-picked on the 1st of each month.
  They're snapshotted every tick, and copies happen at the next hourly open.
- **Gaps:** when the laptop sleeps, ticks pause (Persistent=true catches up one). Each tick
  replays deterministically, so a pause only means copies execute later.

## Bugs found and fixed in session 1
- **Outcome markets:** Hyperliquid `#NNNN` outcome markets got through the perp filter.
  Their candle requests return HTTP 500, so every retry burned minutes.
- **Missing crypto history:** the first live tick cached 2 days of BTC candles, and the
  incremental fetch then never backfilled older history (the BTC benchmark showed +0.0%).
  `fetch_crypto` now refetches when stored history starts after the requested start.
  There's a regression test.

## Ideas for later
- Widen the fund universe to reduce hindsight, e.g. the top 50 13F filers by AUM as of
  2019, chosen by a rule.
- Add a delisted-price source to remove survivorship bias in stocks.
- Weight `congress_trailing` by trade size, or restrict it to committee-relevant sectors.
