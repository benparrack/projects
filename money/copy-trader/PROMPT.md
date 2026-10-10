Build a new sub-project at money/copy-trade/: a fully autonomous paper-trading
copy-trading bot. It runs unattended, places FAKE trades itself, and reports how
each copy strategy is doing. I should never have to do anything by hand after
setup. Work end-to-end without asking me questions; make sensible calls and write
them down.

## Context
- I'm a US taxpayer (currently studying in Stockholm). My eventual goal is to
  copy-trade with real money, but this project is paper-only: it must    never place
  real orders or hold exchange API keys. Keep the broker behind an       interface so a
  real broker could be added later, but don't build one.                 - The point is to finrading beats justholding an                                                                 index before I risk than making theresults look                                                               good.
                                                                         ## What it copies (fr
1. Stocks, big funds: SEC EDGAR 13F filings (use the official API with a proper
   User-Agent). Pick a set of well-known funds.
2. Stocks, politicianransaction reports.Find a free,
   working source; if official disclosuresites or                                                                   document why this
3. Crypto: Hyperliquid's public info API (leaderboard, user fills,      positions).
   Copy the top traders, chosen by the rules below.                     Prices: yfinance (or ks; Hyperliquid/public exchange                                                                APIs for crypto.
                                                                        ## Simulation rules (
- No lookahead. A copy trade executes only once the information was     public (13F
  filing date, disclosure date, fill timestamp plus a realistic delay), at the
  next available price after that.                                     - Pick leaders withouopy using only dataavailable                                                                at that time, and ror example monthly or
  quarterly). Never pick "today's best trader" and backtest them over  the past.
- Model costs: commissions/spreads, slippage, and for crypto the taker fees,
  funding and liquidation risk. Scale leveraged positions down to a    configurable
  max leverage (default 1x, i.e. no leverage).                         - Each strategy gets ing at $1,000, withposition                                                                 sizing proportional
- Always compare against buy-and-hold benchmarks: SPY for stocks, BTC  for crypto.
- Report after-tax figures for a US taxpayer as well: short-term gains at a
  configurable ordinary-income rate, long-term at 15%.                 
## Two modes                                                           1. Backtest: replay hdata allows) throughthe same                                                                  engine and paper bthe results aredirectly                                                                  comparable.
2. Live paper trading: a scheduler runs automatically. Use a systemd   user timer or
   service like money/flip-bot does; check that project for conventionsand for
   any notification channel I already use. It polls the sources, detectnew
   leader trades, places the paper trades, and logs everything to      SQLite.
                                                                       ## Reporting
- CLI commands for status, per-strategy performance, and trade log.    - A generated static  benchmark, total andannualized                                                               return, max drawdowd, and after-taxreturn.                                                                - A short daily summaon channel if oneexists in                                                                money/; otherwise j
                                                                       ## Engineering
- Python. Follow money/flip-bot for repo conventions (README, SETUP.md,and a
  PROGRESS.md handoff).                                                - Tests for the enginath, and positionsizing. Use                                                              fixtures, not live
- Handle API failures and rate limits gracefully; the live loop must   never crash
  permanently.                                                         - Run a real backtestine results inPROGRESS.md,                                                             including an honestegy beat itsbenchmark.                                                             - Follow the repo CLArst, updateTODO_FIRST.md and                                                        IDEAS.md when done,--only -- <paths>`.
- Set up and start the timer yourself so it's already running when you finish,
  and tell me the one command to check on it.
