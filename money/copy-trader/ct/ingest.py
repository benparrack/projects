"""Data collection. Every step is independent and failure-tolerant: one dead source never blocks the rest."""
import json
import logging
import time
from datetime import date, timedelta

from . import db, prices
from .sources import congress, edgar, figi
from .sources import hyperliquid as hl

log = logging.getLogger("ingest")
DAY = 86400


def stock_tickers(con):
    cmap = figi.cusip_map(con)
    out = {"SPY"}
    for src, payload in con.execute("SELECT src, payload FROM filings"):
        p = json.loads(payload)
        if src == "13f":
            out |= {cmap[c] for c in p["holdings"] if c in cmap}
        else:
            out |= {t["ticker"] for t in p.get("txns", []) if t["ticker"]}
    return out


def history_start(cfg):
    return date.fromisoformat(str(cfg["backtest"]["history_start"]))


def run_13f(con, cfg, since=None):
    since = since or history_start(cfg) - timedelta(days=200)   # the 13F in force at history start
    n = edgar.ingest(con, cfg, since)
    cus = set()
    for (p,) in con.execute("SELECT payload FROM filings WHERE src='13f'"):
        cus |= set(json.loads(p)["holdings"])
    figi.map_cusips(con, cus)
    return n


def run_house(con, cfg, years=None):
    years = years or range(history_start(cfg).year, date.today().year + 1)
    return congress.ingest_house(con, cfg, years)


def run_senate(con, cfg, since=None):
    return congress.ingest_senate(con, cfg, since or history_start(cfg))


def run_stock_prices(con, cfg, refresh_after_s=None, syms=None):
    return prices.fetch_stocks(con, syms or stock_tickers(con), history_start(cfg) - timedelta(days=200),
                               refresh_after_s=refresh_after_s)


def crypto_window(cfg, now=None):
    now = now or time.time()
    return now - cfg["backtest"]["crypto_days"] * DAY


def run_hl_history(con, cfg):
    """Backtest data: candidate pool from today's leaderboard (survivorship-biased, see PROGRESS.md),
    their fills/positions/account history, and hourly candles + funding for every coin they touched."""
    start = crypto_window(cfg) - 2 * DAY
    rows = hl.pool_filter(hl.leaderboard(), cfg["hyperliquid"])[:cfg["hyperliquid"]["pool_size"]]
    db.kv_set(con, "hl_pool", {"t": time.time(), "users": [r["user"] for r in rows]})
    done = {u for (u,) in con.execute("SELECT user FROM hl_users WHERE fetched > ?", (time.time() - DAY,))}
    for i, r in enumerate(rows):
        if r["user"] in done:
            continue
        try:
            n, trunc = hl.fetch_user(con, r["user"], start)
            log.info("HL %d/%d %s: %d fills%s", i + 1, len(rows), r["user"][:10], n, " (truncated)" if trunc else "")
        except Exception as e:
            log.warning("HL user %s failed: %s", r["user"], e)
    coins = {c for (c,) in con.execute("SELECT DISTINCT coin FROM hl_fills")}
    for (p,) in con.execute("SELECT positions FROM hl_users"):
        coins |= set(json.loads(p))
    coins.add("BTC")
    db.kv_set(con, "hl_meta", hl.meta())
    prices.fetch_crypto(con, coins, start - 2 * DAY)
