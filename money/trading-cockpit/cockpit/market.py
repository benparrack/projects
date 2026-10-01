"""Market data from yfinance, with on-disk and in-memory caches so the UI stays snappy."""
from __future__ import annotations

import datetime as dt
import json
import logging
import threading
import time
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from .db import ROOT

log = logging.getLogger("market")
CACHE = ROOT / "data" / "cache"
_mem: dict = {}
_lock = threading.Lock()


def _memo(key, ttl, fn):
    with _lock:
        hit = _mem.get(key)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    val = fn()
    with _lock:
        _mem[key] = (time.time(), val)
    return val


def _yf():
    import yfinance as yf
    return yf


def norm(ticker: str) -> str:
    return ticker.strip().upper()


def _clean(df: pd.DataFrame) -> pd.DataFrame:
    if isinstance(df.columns, pd.MultiIndex):
        df = df.droplevel(1, axis=1)
    df = df[[c for c in ("Open", "High", "Low", "Close", "Volume") if c in df.columns]].copy()
    df.index = pd.to_datetime(df.index)
    if df.index.tz is not None:
        df.index = df.index.tz_localize(None)
    df.index = df.index.normalize()
    df = df[~df.index.duplicated(keep="last")].sort_index().dropna(subset=["Close"])
    return df[df["Close"] > 0]


def history(ticker: str, years: int = 5, max_age_s: int = 4 * 3600) -> pd.DataFrame:
    """Daily adjusted OHLCV. Disk cache refreshed every few hours."""
    t = norm(ticker)

    def load():
        CACHE.mkdir(parents=True, exist_ok=True)
        path = CACHE / f"hist_{t.replace('^', '_').replace('=', '_')}_{years}y.csv"
        if path.exists() and time.time() - path.stat().st_mtime < max_age_s:
            return _clean(pd.read_csv(path, index_col=0, parse_dates=True))
        try:
            raw = _yf().download(t, period=f"{years}y", interval="1d", auto_adjust=True,
                                 progress=False, threads=False)
        except Exception as e:
            log.warning("history %s failed: %s", t, e)
            raw = None
        if raw is None or raw.empty:
            if path.exists():
                return _clean(pd.read_csv(path, index_col=0, parse_dates=True))
            raise LookupError(f"No price data for {t}. Check the ticker (Stockholm stocks end in .ST).")
        df = _clean(raw)
        df.to_csv(path)
        return df

    return _memo(("hist", t, years), 600, load)


def quote(ticker: str) -> dict:
    """Latest price (live during market hours, otherwise last close)."""
    t = norm(ticker)

    def load():
        fi = _yf().Ticker(t).fast_info
        try:
            price = float(fi["last_price"])
            prev = float(fi["previous_close"])
            cur = fi["currency"] or "USD"
        except Exception:
            price = prev = float("nan")
            cur = "USD"
        if not np.isfinite(price):
            h = history(t)
            price, prev = float(h["Close"].iloc[-1]), float(h["Close"].iloc[-2])
        return {"ticker": t, "price": price, "prev_close": prev, "currency": cur.upper(),
                "change_pct": price / prev - 1 if prev else 0.0, "open": market_open(t),
                "ts": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")}

    return _memo(("quote", t), 60, load)


def fx(currency: str) -> float:
    """USD per one unit of `currency`."""
    c = (currency or "USD").upper()
    if c == "USD":
        return 1.0
    pence = c in ("GBX", "GBP")
    if c == "GBX":
        c = "GBP"

    def load():
        rate = float(_yf().Ticker(f"{c}USD=X").fast_info["last_price"])
        return rate / 100 if pence and currency.upper() == "GBX" else rate

    return _memo(("fx", currency.upper()), 900, load)


def fx_history(currency: str, years: int = 5) -> pd.Series:
    c = (currency or "USD").upper()
    if c == "USD":
        return pd.Series(dtype=float)
    return history(f"{c}USD=X", years)["Close"]


def info(ticker: str) -> dict:
    """Name / sector / industry, cached on disk for a week."""
    t = norm(ticker)

    def load():
        CACHE.mkdir(parents=True, exist_ok=True)
        path = CACHE / f"info_{t}.json"
        if path.exists() and time.time() - path.stat().st_mtime < 7 * 86400:
            return json.loads(path.read_text())
        try:
            i = _yf().Ticker(t).info or {}
        except Exception as e:
            log.warning("info %s failed: %s", t, e)
            i = {}
        out = {k: i.get(k) for k in ("shortName", "longName", "sector", "industry", "beta", "marketCap",
                                     "quoteType", "exchange", "currency")}
        if any(out.values()):
            path.write_text(json.dumps(out))
        return out

    return _memo(("info", t), 3600, load)


def earnings(ticker: str) -> dict:
    """Next earnings date (if known) and past report dates, cached for a day."""
    t = norm(ticker)

    def load():
        CACHE.mkdir(parents=True, exist_ok=True)
        path = CACHE / f"earn_{t}.json"
        if path.exists() and time.time() - path.stat().st_mtime < 86400:
            return json.loads(path.read_text())
        out = {"next": None, "past": []}
        tk = _yf().Ticker(t)
        try:
            ed = tk.get_earnings_dates(limit=24)
            if ed is not None and not ed.empty:
                today = pd.Timestamp.now(tz=ed.index.tz).normalize()
                future = []
                for ts in ed.index:
                    if ts.normalize() >= today:
                        future.append(ts.strftime("%Y-%m-%d"))
                    else:
                        # First session that trades on the news: after-close reports hit the next day.
                        session = ts.normalize() + (pd.Timedelta(days=1) if ts.hour >= 12 else pd.Timedelta(0))
                        out["past"].append(session.strftime("%Y-%m-%d"))
                out["next"] = min(future) if future else None
        except Exception as e:
            log.info("earnings dates %s: %s", t, e)
        if not out["next"]:
            try:
                cal = tk.calendar or {}
                d = cal.get("Earnings Date") or []
                if d:
                    out["next"] = str(d[0])
            except Exception:
                pass
        path.write_text(json.dumps(out))
        return out

    return _memo(("earn", t), 3600, load)


def exchange_tz(ticker: str) -> tuple[ZoneInfo, dt.time, dt.time]:
    t = norm(ticker)
    if t.endswith(".ST") or t.endswith(".HE") or t.endswith(".CO") or t.endswith(".OL"):
        return ZoneInfo("Europe/Stockholm"), dt.time(9, 0), dt.time(17, 30)
    if t.endswith(".L"):
        return ZoneInfo("Europe/London"), dt.time(8, 0), dt.time(16, 30)
    if t.endswith(".DE"):
        return ZoneInfo("Europe/Berlin"), dt.time(9, 0), dt.time(17, 30)
    return ZoneInfo("America/New_York"), dt.time(9, 30), dt.time(16, 0)


def completed(df: pd.DataFrame, ticker: str, at: dt.datetime | None = None) -> pd.DataFrame:
    """Drop today's bar if that session hasn't closed yet (yfinance includes the live, partial day)."""
    tz, _, close = exchange_tz(ticker)
    now = (at or dt.datetime.now(dt.timezone.utc)).astimezone(tz)
    if len(df) and df.index[-1].date() >= now.date() and now.time() < close:
        return df.iloc[:-1]
    return df


def market_open(ticker: str = "SPY", at: dt.datetime | None = None) -> bool:
    """Regular session check (weekends excluded; exchange holidays are not)."""
    tz, o, c = exchange_tz(ticker)
    now = (at or dt.datetime.now(dt.timezone.utc)).astimezone(tz)
    return now.weekday() < 5 and o <= now.time() < c
