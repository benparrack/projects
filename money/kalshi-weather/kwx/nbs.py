"""NWS National Blend of Models text guidance (NBS), archived by run at Iowa Environmental Mesonet. US stations only.

NBS runs four times a day and is what US forecasters lean on, so it is much fresher than Open-Meteo's
day-old runs. `txn` is the daytime max at forecast hour 00Z and the overnight min at 12Z.
For each decision we take the newest run issued at least LAG before it, so nothing is used before it was public.
"""
import io
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pandas as pd

from .stations import DATA, local_time_utc
from .weather import ARCHIVE_START, DECISION_TIME

URL = "https://mesonet.agron.iastate.edu/cgi-bin/request/mos.py"
NBS = DATA / "nbs"
LAG = pd.Timedelta(hours=3)  # runs are published ~1.5h after their nominal time
CHUNK = 90  # days per request


def covered(icao):
    return icao.startswith("K")


def fetch(icao, start, end):
    """[runtime, ftime, txn] for runs issued start..end (UTC datetimes); only rows that carry a max/min."""
    q = {"station": icao, "model": "NBS", "format": "csv",
         "sts": start.strftime("%Y-%m-%dT%H:%MZ"), "ets": end.strftime("%Y-%m-%dT%H:%MZ")}
    url = URL + "?" + urllib.parse.urlencode(q)
    for attempt in range(6):
        try:
            time.sleep(1)  # IEM answers "Too many requests" to back-to-back calls
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "kalshi-weather"}),
                                        timeout=120) as r:
                text = r.read().decode()
            if text.startswith("runtime"):
                break
            raise urllib.error.URLError(text[:80])
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            if attempt == 5:
                raise RuntimeError(f"IEM NBS failed: {e}") from e
            time.sleep(2 ** attempt * 5)
    df = pd.read_csv(io.StringIO(text), usecols=["runtime", "ftime", "txn"]).dropna(subset=["txn"])
    for c in ("runtime", "ftime"):
        df[c] = pd.to_datetime(df[c], utc=True)
    return df


def load(icao):
    f = NBS / f"{icao}.csv"
    if not f.exists():
        return pd.DataFrame({c: pd.Series(dtype="datetime64[ns, UTC]") for c in ("runtime", "ftime")} | {"txn": pd.Series(dtype=float)})
    df = pd.read_csv(f)
    for c in ("runtime", "ftime"):
        df[c] = pd.to_datetime(df[c], utc=True)
    return df


def update(icao):
    """Extend data/nbs/<icao>.csv up to now."""
    if not covered(icao):
        return 0
    NBS.mkdir(parents=True, exist_ok=True)
    have = load(icao)
    start = have["runtime"].max().to_pydatetime() if len(have) else datetime.combine(ARCHIVE_START - timedelta(days=3), datetime.min.time(), timezone.utc)
    end = datetime.now(timezone.utc)
    n = 0
    while start < end:
        stop = min(start + timedelta(days=CHUNK), end)
        new = fetch(icao, start, stop)
        have = pd.concat([have, new]).drop_duplicates(["runtime", "ftime"]).sort_values(["runtime", "ftime"])
        have.to_csv(NBS / f"{icao}.csv", index=False)
        n, start = n + len(new), stop
    return n


def recent(icao):
    """Cached runs plus the last two days fetched fresh (for live use)."""
    if not covered(icao):
        return load(icao)
    now = datetime.now(timezone.utc)
    return pd.concat([load(icao), fetch(icao, now - timedelta(days=2), now)]).drop_duplicates(["runtime", "ftime"])


def target(d, kind):
    """Forecast hour whose txn matches the settlement day's high (00Z after day d) or low (12Z on day d)."""
    return pd.Timestamp(d + timedelta(days=1), tz="UTC") if kind == "high" else pd.Timestamp(d, tz="UTC") + pd.Timedelta(hours=12)


def attach(ev, st, source=load):
    """Adds `nbs` (°F): the newest NBS max/min for the row's day issued at least LAG before its decision."""
    ev = ev.copy()
    ev["nbs"] = np.nan
    for s, g in ev.groupby("series"):
        info = st[s]
        o = source(info["icao"])
        if o.empty:
            continue
        kind = "low" if s.startswith("KXLOW") else "high"
        runs = {ft: r.sort_values("runtime") for ft, r in o.groupby("ftime")}
        for i, d, lead in zip(g.index, g["date"], g["lead"]):
            d = date.fromisoformat(d)
            r = runs.get(target(d, kind))
            if r is None:
                continue
            hour, before = DECISION_TIME[int(lead)]
            cut = pd.Timestamp(local_time_utc(info, d, hour, before)) - LAG
            r = r[r["runtime"] <= cut]
            if len(r) and cut - r["runtime"].iloc[-1] < pd.Timedelta(hours=12):  # stale runs don't count
                ev.at[i, "nbs"] = r["txn"].iloc[-1]
    return ev
