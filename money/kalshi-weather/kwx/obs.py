"""Observed station temperatures (Iowa Environmental Mesonet's ASOS/METAR archive, ~15 min behind real time).

Used for one feature: how far the weather models were off in the hours just before the decision.
"""
import http.client
import io
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pandas as pd

from .stations import DATA
from .weather import ARCHIVE_START, now_times

URL = "https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py"
OBS = DATA / "obs"
TOLERANCE = pd.Timedelta(minutes=40)


def fetch(icao, start, end):
    """[valid (UTC), tmpf] for start..end (dates, inclusive)."""
    end = end + timedelta(days=1)
    q = [("station", icao), ("data", "tmpf"), ("tz", "Etc/UTC"), ("format", "onlycomma"), ("latlon", "no"),
         ("missing", "empty"), ("trace", "empty"), ("report_type", "3"), ("report_type", "4"),
         ("year1", start.year), ("month1", start.month), ("day1", start.day),
         ("year2", end.year), ("month2", end.month), ("day2", end.day)]
    url = URL + "?" + urllib.parse.urlencode(q)
    for attempt in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "kalshi-weather"}),
                                        timeout=120) as r:
                df = pd.read_csv(io.StringIO(r.read().decode()))
            break
        except (urllib.error.URLError, TimeoutError, http.client.HTTPException, ConnectionError) as e:
            if attempt == 5:
                raise RuntimeError(f"IEM failed: {e}") from e
            time.sleep(2 ** attempt * 5)
    df = df.dropna(subset=["tmpf"])
    return pd.DataFrame({"valid": pd.to_datetime(df["valid"], utc=True), "tmpf": df["tmpf"].astype(float)})


def load(icao):
    f = OBS / f"{icao}.csv"
    if not f.exists():
        return pd.DataFrame({"valid": pd.Series(dtype="datetime64[ns, UTC]"), "tmpf": pd.Series(dtype=float)})
    df = pd.read_csv(f)
    df["valid"] = pd.to_datetime(df["valid"], utc=True)
    return df


def update(icao):
    """Extend data/obs/<icao>.csv up to yesterday."""
    OBS.mkdir(parents=True, exist_ok=True)
    have = load(icao)
    start = (have["valid"].max().date() if len(have) else ARCHIVE_START - timedelta(days=3))
    end = datetime.now(timezone.utc).date() - timedelta(days=1)
    n = 0
    while start < end:  # half a year per request; IEM drops very large responses
        stop = min(start + timedelta(days=180), end)
        new = fetch(icao, start, stop)
        have = pd.concat([have, new]).drop_duplicates("valid").sort_values("valid")
        have.to_csv(OBS / f"{icao}.csv", index=False)
        n, start = n + len(new), stop
    return n


def recent(icao):
    """Cached history plus the last two days fetched fresh (for live use)."""
    today = datetime.now(timezone.utc).date()
    return pd.concat([load(icao), fetch(icao, today - timedelta(days=2), today)]).drop_duplicates("valid").sort_values("valid")


def attach(ev, st, source=load):
    """Adds `obsnow` (°F): mean observed temperature at the NOW_HOURS before each row's decision time."""
    ev = ev.copy()
    ev["obsnow"] = np.nan
    for s, g in ev.groupby("series"):
        info = st[s]
        o = source(info["icao"])
        if o.empty:
            continue
        times = [(i, t) for i, d, lead in zip(g.index, g["date"], g["lead"])
                 for t in now_times(info, date.fromisoformat(d), int(lead))]
        q = pd.DataFrame(times, columns=["i", "valid"]).sort_values("valid")
        q["valid"] = q["valid"].astype(o["valid"].dtype)
        m = pd.merge_asof(q, o.sort_values("valid"), on="valid", direction="nearest", tolerance=TOLERANCE)
        got = m.groupby("i")["tmpf"].agg(["mean", "count"])
        got = got[got["count"] >= 2]
        ev.loc[got.index, "obsnow"] = got["mean"]
    return ev
