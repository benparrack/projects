"""Price cache. Stocks: Yahoo daily bars via yfinance (auto-adjusted = total return incl. dividends).
Crypto: Hyperliquid hourly perp candles and hourly funding rates."""
import logging
import time
from datetime import date, timedelta

import numpy as np

from .sources import hyperliquid as hl
from .timeutil import day_t

log = logging.getLogger("prices")


def fetch_stocks(con, syms, start, refresh_after_s=None, chunk=60):
    """Download daily bars for syms not cached yet (or cached longer ago than refresh_after_s)."""
    import yfinance as yf
    meta = {s: (f, ok) for s, f, ok in con.execute("SELECT sym, fetched, ok FROM price_meta WHERE iv='1d'")}
    now = time.time()
    todo = sorted({s for s in syms if s and (s not in meta or
                   (refresh_after_s is not None and now - meta[s][0] > refresh_after_s))})
    for i in range(0, len(todo), chunk):
        part = todo[i:i + chunk]
        for attempt in range(4):
            try:
                df = yf.download(part, start=start.isoformat(), auto_adjust=True, progress=False,
                                 group_by="ticker", threads=True)
                break
            except Exception as e:
                log.warning("yfinance failed (%s), retrying", e)
                time.sleep(20 * (attempt + 1))
        else:
            continue
        for s in part:
            try:
                sub = df[s] if len(part) > 1 else (df[s] if s in df.columns.get_level_values(0) else df)
                sub = sub.dropna(subset=["Open", "Close"])
            except Exception:
                sub = None
            ok = int(sub is not None and len(sub) > 0)
            if ok:
                con.executemany("INSERT OR REPLACE INTO bars VALUES(?,?,?,?,?,?,?)",
                                [(s, "1d", day_t(d.date()), float(r.Open), float(r.High), float(r.Low), float(r.Close))
                                 for d, r in sub.iterrows() if r.Open > 0 and r.Close > 0])
            con.execute("INSERT OR REPLACE INTO price_meta VALUES(?,?,?,?)", (s, "1d", now, ok))
        con.commit()
        log.info("prices %d/%d", min(i + chunk, len(todo)), len(todo))
    return len(todo)


def calendar(con, ref="SPY", start=None, end=None):
    q = "SELECT t FROM bars WHERE sym=? AND iv='1d'"
    ts = [r[0] for r in con.execute(q + " ORDER BY t", (ref,))]
    if start:
        ts = [t for t in ts if t >= day_t(start)]
    if end:
        ts = [t for t in ts if t <= day_t(end)]
    return np.array(ts, dtype=np.int64)


def load_bars(con, syms, iv, cal):
    """{sym: (open, high, low, close)} arrays aligned to cal (NaN where there is no bar)."""
    idx = {int(t): i for i, t in enumerate(cal)}
    out = {}
    lo, hi = int(cal[0]), int(cal[-1])
    for s in syms:
        a = np.full((4, len(cal)), np.nan)
        for t, o, h, l, c in con.execute("SELECT t,o,h,l,c FROM bars WHERE sym=? AND iv=? AND t BETWEEN ? AND ?",
                                         (s, iv, lo, hi)):
            j = idx.get(t)
            if j is not None:
                a[:, j] = (o, h, l, c)
        if not np.all(np.isnan(a[3])):
            out[s] = a
    return out


def close_on_or_before(con, sym, d):
    r = con.execute("SELECT c FROM bars WHERE sym=? AND iv='1d' AND t<=? ORDER BY t DESC LIMIT 1",
                    (sym, day_t(d))).fetchone()
    return r[0] if r else None


def fetch_crypto(con, coins, start_s, end_s=None):
    end_s = end_s or time.time()
    for coin in sorted(set(coins)):
        first, last = con.execute("SELECT MIN(t), MAX(t) FROM bars WHERE sym=? AND iv='1h'", (coin,)).fetchone()
        # re-fetch the last (possibly incomplete) bar; refetch everything if history starts too late
        frm = start_s if first is None or first > start_s + 2 * 3600 else max(start_s, last - 3600)
        try:
            rows = hl.candles(coin, frm, end_s)
            con.executemany("INSERT OR REPLACE INTO bars VALUES(?,?,?,?,?,?,?)",
                            [(coin, "1h", *r) for r in rows])
            firstf, lastf = con.execute("SELECT MIN(t), MAX(t) FROM funding WHERE coin=?", (coin,)).fetchone()
            ffrm = start_s if firstf is None or firstf > start_s + 2 * 3600 else max(start_s, lastf + 1)
            fr = hl.funding(coin, ffrm, end_s)
            con.executemany("INSERT OR REPLACE INTO funding VALUES(?,?,?)", [(coin, *r) for r in fr])
            con.execute("INSERT OR REPLACE INTO price_meta VALUES(?,?,?,?)", (coin, "1h", time.time(), int(bool(rows))))
            con.commit()
        except Exception as e:
            log.warning("crypto prices %s failed: %s", coin, e)


def load_funding(con, coins, cal):
    """{coin: array of the funding rate charged at the end of each hourly bar (0 when absent)}."""
    idx = {int(t): i for i, t in enumerate(cal)}
    out = {}
    for coin in coins:
        a = np.zeros(len(cal))
        for t, r in con.execute("SELECT t, rate FROM funding WHERE coin=? AND t BETWEEN ? AND ?",
                                (coin, int(cal[0]), int(cal[-1]) + 3600)):
            j = idx.get((t // 3600) * 3600 - 3600)    # funding paid at hh:00 settles the bar that just ended
            if j is not None:
                a[j] += r
        out[coin] = a
    return out
