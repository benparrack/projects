"""Download and cache everything the backtest needs: settled markets, their hourly quotes, and archived forecasts.
Every step is resumable: rerunning only fetches what's missing."""
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

import pandas as pd

from . import kalshi, nbs, obs, stations, weather

DATA = stations.DATA
MARKETS = DATA / "markets"
CANDLES = DATA / "candles"


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def pull_markets(series_list):
    MARKETS.mkdir(parents=True, exist_ok=True)
    rules = {}
    for s in series_list:
        rows = kalshi.settled_markets(s)
        if not rows:
            continue
        df = pd.DataFrame(rows).sort_values(["date", "ticker"])
        rules[s] = df["rules"].iloc[-1]
        df.drop(columns="rules").to_csv(MARKETS / f"{s}.csv", index=False)
        log(f"  {s}: {len(df)} settled markets, {df['date'].nunique()} days since {df['date'].min()}")
    return rules


def load_markets(series=None):
    files = [MARKETS / f"{s}.csv" for s in series] if series else sorted(MARKETS.glob("*.csv"))
    return pd.concat([pd.read_csv(f) for f in files if f.exists()], ignore_index=True)


def read_jsonl(path):
    """Rows of a candle file, skipping a line cut short by an interrupted pull."""
    if not path.exists():
        return
    for line in path.open():
        try:
            yield json.loads(line)
        except json.JSONDecodeError:
            continue


def done_tickers(path):
    return {d["t"] for d in read_jsonl(path)}


BATCH = 40  # markets per batched candle request (recent markets only)


def pull_candles(series_list):
    CANDLES.mkdir(parents=True, exist_ok=True)
    cutoff = kalshi.historical_cutoff()
    for s in series_list:
        f = MARKETS / f"{s}.csv"
        if not f.exists():
            continue
        path = CANDLES / f"{s}.jsonl"
        have = done_tickers(path)
        todo = pd.read_csv(f)
        # Quotes are only useful where archived forecasts exist to compare them with.
        todo = todo[~todo["ticker"].isin(have) & (todo["date"] >= weather.ARCHIVE_START.isoformat())]
        if todo.empty:
            continue
        log(f"  {s}: fetching quotes for {len(todo)} markets")
        todo = todo.assign(start=todo["open_time"].map(kalshi.ts) - 3600, end=todo["close_time"].map(kalshi.ts) + 3600)
        recent, old = todo[todo["end"] - 3600 >= cutoff].sort_values("end"), todo[todo["end"] - 3600 < cutoff]

        def one(r):
            # markets settling right around the cutoff can sit on either endpoint
            return {r.ticker: kalshi.candles(s, r.ticker, r.start, r.end, historical=True)
                    or kalshi.candles(s, r.ticker, r.start, r.end, historical=False)}

        def batch(g):
            return kalshi.candles_batch(list(g["ticker"]), int(g["start"].min()), int(g["end"].max()))

        jobs = [(one, r) for r in old.itertuples()] + \
               [(batch, recent.iloc[i:i + BATCH]) for i in range(0, len(recent), BATCH)]
        with path.open("a") as out, ThreadPoolExecutor(16) as pool:  # ~2s per historical response; kalshi.get still throttles to ~5 req/s overall
            for i, got in enumerate(pool.map(lambda j: j[0](j[1]), jobs)):
                for t, c in got.items():
                    out.write(json.dumps({"t": t, "c": c}) + "\n")
                if i % 500 == 499:
                    out.flush()
                    log(f"    {i + 1}/{len(jobs)} requests")


def load_candles(series_list):
    out = {}
    for s in series_list:
        for d in read_jsonl(CANDLES / f"{s}.jsonl"):
            out[d["t"]] = d["c"]
    return out


def pull_forecasts(st, markets):
    """Archived forecasts for every station-day that has a market (plus the next two days for live use)."""
    by_station = {}
    for s, g in markets.groupby("series"):
        if s in st:
            by_station.setdefault(st[s]["icao"], (st[s], set()))[1].update(date.fromisoformat(d) for d in g["date"])
    for icao, (station, days) in sorted(by_station.items()):
        days = {d for d in days if d >= weather.ARCHIVE_START}
        n = weather.update(icao, station, days)
        if n:
            log(f"  {icao}: {n} new forecast days")


def pull_obs(st):
    for icao in sorted({i["icao"] for i in st.values()}):
        n = obs.update(icao)
        if n:
            log(f"  {icao}: {n} new observations")


def pull_nbs(st):
    for icao in sorted({i["icao"] for i in st.values()}):
        n = nbs.update(icao)
        if n:
            log(f"  {icao}: {n} new NBS forecasts")


def pull(series=None):
    series = series or kalshi.weather_series()
    log(f"Markets ({len(series)} series)...")
    rules = pull_markets(series)
    st = stations.update(rules)
    missing = sorted(set(rules) - set(st))
    if missing:
        log(f"  no station found for {missing}; skipped")
    log("Archived forecasts (Open-Meteo)...")
    pull_forecasts(st, load_markets(list(rules)))
    log("Observed temperatures (IEM)...")
    pull_obs({s: st[s] for s in rules if s in st})
    log("NWS blend guidance (IEM)...")
    pull_nbs({s: st[s] for s in rules if s in st})
    log("Hourly quotes (one request per market; the first run takes a while)...")
    pull_candles([s for s in rules if s in st])
    log("Done.")
