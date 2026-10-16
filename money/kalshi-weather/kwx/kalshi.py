"""Kalshi public market data (no account needed): weather series, settled markets, hourly candles."""
import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone

BASE = "https://api.elections.kalshi.com/trade-api/v2"
MIN_GAP = 0.21  # ~4.8 req/s: the unauthenticated tier starts returning 429s at about 5/s
_lock = threading.Lock()
_last = [0.0]
MONTHS = {m: i for i, m in enumerate("JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split(), 1)}


def get(path, **params):
    q = urllib.parse.urlencode({k: v for k, v in params.items() if v not in (None, "")})
    url = f"{BASE}{path}" + (f"?{q}" if q else "")
    for attempt in range(8):
        with _lock:
            wait = _last[0] + MIN_GAP - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            _last[0] = time.monotonic()
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code not in (429, 500, 502, 503, 504):
                raise
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            pass
        time.sleep(min(60, 2 ** attempt))
    raise RuntimeError(f"Kalshi API kept failing: {url}")


def paged(path, key, **params):
    cursor = None
    while True:
        d = get(path, limit=1000, cursor=cursor, **params) or {}
        yield from d.get(key, [])
        cursor = d.get("cursor")
        if not cursor or not d.get(key):
            return


def weather_series():
    """Daily high/low temperature series with a single station, e.g. KXHIGHNY, KXLOWTSEA."""
    out = []
    for s in (get("/series", category="Climate and Weather") or {}).get("series", []):
        t = s["ticker"]
        if re.fullmatch(r"KX(HIGH|LOW)T?[A-Z]+", t) and t not in ("KXHIGHUS", "KXHIGHNYD"):
            out.append(t)
    return sorted(out)


def event_date(ticker):
    """KXHIGHNY-26OCT15-T71 -> date(2026, 10, 15)."""
    m = re.search(r"-(\d\d)([A-Z]{3})(\d\d)", ticker)
    return date(2000 + int(m[1]), MONTHS[m[2]], int(m[3])) if m else None


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def market_row(series, m):
    """Flatten a market. value = settled temperature (only reported on the winning bracket)."""
    return {
        "series": series, "ticker": m["ticker"], "event": m["event_ticker"],
        "date": event_date(m["ticker"]).isoformat(),
        "strike_type": m.get("strike_type"), "floor": num(m.get("floor_strike")), "cap": num(m.get("cap_strike")),
        "result": m.get("result"), "value": num(m.get("expiration_value")),
        "volume": num(m.get("volume_fp") or m.get("volume")),
        "open_time": m.get("open_time"), "close_time": m.get("close_time"),
        "rules": m.get("rules_primary", ""),
    }


def settled_markets(series):
    """All settled markets for a series, from both the live and historical partitions.
    Before 2025 the NY/CHI/MIA/AUS series traded without the KX prefix (HIGHNY-...)."""
    rows = {}
    names = [series, series[2:]]
    for name in names:
        for m in paged("/historical/markets", "markets", series_ticker=name):
            rows[m["ticker"]] = market_row(series, m)
        for m in paged("/markets", "markets", series_ticker=name, status="settled"):
            rows[m["ticker"]] = market_row(series, m)
    return [r for r in rows.values() if r["result"] in ("yes", "no")]


def open_markets(series):
    return [dict(market_row(series, m), yes_bid=num(m.get("yes_bid_dollars")), yes_ask=num(m.get("yes_ask_dollars")))
            for m in paged("/markets", "markets", series_ticker=series, status="open")]


def ts(iso):
    return int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp())


def _p(d, key):
    if not d:
        return None
    return num(d.get(key + "_dollars", d.get(key)))


def candles(series, ticker, start, end, historical):
    """Hourly [end_ts, yes_bid, yes_ask, last, volume] candles; bid/ask are the hour's closing quotes."""
    path = (f"/historical/markets/{ticker}/candlesticks" if historical
            else f"/series/{series}/markets/{ticker}/candlesticks")
    d = get(path, start_ts=start, end_ts=end, period_interval=60) or {}
    return _parse(d.get("candlesticks", []))


def _parse(cs):
    return [[c["end_period_ts"], _p(c.get("yes_bid"), "close"), _p(c.get("yes_ask"), "close"),
             _p(c.get("price") or {}, "close"), num(c.get("volume_fp", c.get("volume"))) or 0.0] for c in cs]


def candles_batch(tickers, start, end):
    """{ticker: candles} in one request. Only serves markets settled after the historical cutoff."""
    d = get("/markets/candlesticks", market_tickers=",".join(tickers), start_ts=start, end_ts=end,
            period_interval=60) or {}
    got = {m["market_ticker"]: _parse(m.get("candlesticks", [])) for m in d.get("markets", [])}
    return {t: got.get(t, []) for t in tickers}


def historical_cutoff():
    d = get("/historical/cutoff") or {}
    return ts(d["market_settled_ts"]) if d.get("market_settled_ts") else 0


def taker_fee(price, contracts=10, multiplier=1.0):
    """Kalshi taker fee in $ per contract: ceil(0.07 * C * P * (1-P)) cents per order, spread over C."""
    import math
    cents = math.ceil(round(7 * multiplier * contracts * price * (1 - price), 9))
    return cents / 100 / contracts
