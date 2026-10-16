"""Archived weather-model forecasts from Open-Meteo's Previous Runs API, turned into daily highs/lows.

`previous_day1` at hour H is the forecast from the model run made about 24h before H, and
`previous_day2` from about 48h before. So for settlement day D:
  lead 1 is fully published by ~03:00 local on D   -> usable for a decision at 08:00 on D
  lead 2 is fully published by ~03:00 local on D-1 -> usable for a decision at 18:00 on D-1
That keeps the backtest free of look-ahead, and live trading uses exactly the same inputs.
"""
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pandas as pd

from .stations import DATA, day_start_utc, local_time_utc

URL = "https://previous-runs-api.open-meteo.com/v1/forecast"
ARCHIVE_START = date(2024, 2, 1)
# Global models archived since Feb 2024, plus newer ones (NaN before they start; the model fills them in).
MODELS = ["gfs_seamless", "ecmwf_ifs025", "icon_seamless", "gem_seamless", "jma_seamless",
          "meteofrance_seamless", "ukmo_seamless", "ncep_nbm_conus", "ecmwf_aifs025_single"]
LEADS = (1, 2)
CHUNK = 60  # days per request
FORECASTS = DATA / "forecasts"
# Decision moment each lead is used for, as (local hour, days before D); dataset.DECISIONS must agree.
DECISION_TIME = {1: (8, 0), 2: (18, 1)}
NOW_HOURS = (3, 2, 1)  # compare forecast with observations this many hours before the decision


def now_times(station, d, lead):
    hour, before = DECISION_TIME[lead]
    t = pd.Timestamp(local_time_utc(station, d, hour, before))
    return [t - pd.Timedelta(hours=h) for h in NOW_HOURS]


def fetch(station, start, end):
    """Hourly forecasts (UTC) for [start, end] at the station, one column per model x lead."""
    q = {
        "latitude": station["lat"], "longitude": station["lon"], "timezone": "GMT",
        "start_date": start.isoformat(), "end_date": end.isoformat(),
        "hourly": ",".join(f"temperature_2m_previous_day{k}" for k in LEADS),
        "models": ",".join(MODELS),
        "temperature_unit": "fahrenheit" if station["unit"] == "F" else "celsius",
    }
    url = URL + "?" + urllib.parse.urlencode(q)
    for attempt in range(6):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                h = json.load(r)["hourly"]
            break
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt == 5:
                raise RuntimeError(f"Open-Meteo failed: {e}") from e
            time.sleep(2 ** attempt * 5)
    df = pd.DataFrame(h)
    df["time"] = pd.to_datetime(df["time"], utc=True)
    return df.set_index("time")


def daily(station, hourly, days):
    """Per settlement day: each model's forecast high and low over that station's settlement day."""
    rows = []
    for d in days:
        t0 = pd.Timestamp(day_start_utc(station, d))
        win = hourly[(hourly.index >= t0) & (hourly.index < t0 + pd.Timedelta(hours=24))]
        if len(win) < 24:
            continue
        for k in LEADS:
            row = {"date": d.isoformat(), "lead": k}
            # Ensemble-mean forecast for the hours just before the decision; obs.py supplies what was observed.
            now = hourly.reindex(now_times(station, d, k))
            v = now[[c for c in now if c.startswith(f"temperature_2m_previous_day{k}_")]].to_numpy(dtype=float)
            row["fcnow"] = float(np.nanmean(v)) if np.isfinite(v).any() else np.nan
            for m in MODELS:
                col = f"temperature_2m_previous_day{k}_{m}"
                v = win[col].to_numpy(dtype=float) if col in win else np.full(24, np.nan)
                ok = np.isfinite(v).all()
                row[f"{m}_max"] = float(v.max()) if ok else np.nan
                row[f"{m}_min"] = float(v.min()) if ok else np.nan
            rows.append(row)
    return rows


def forecast_days(station, days):
    """Daily forecast rows for arbitrary days (not cached). Days still lacking published runs come back NaN."""
    days = sorted(days)
    rows = []
    for i in range(0, len(days), CHUNK):
        chunk = days[i:i + CHUNK]
        hourly = fetch(station, chunk[0] - timedelta(days=1), chunk[-1] + timedelta(days=1))
        rows += daily(station, hourly, chunk)
    return pd.DataFrame(rows)


def load(icao):
    f = FORECASTS / f"{icao}.csv"
    return pd.read_csv(f) if f.exists() else pd.DataFrame(columns=["date", "lead"])


def update(icao, station, days):
    """Add missing completed days to data/forecasts/<icao>.csv. Returns how many days were added."""
    FORECASTS.mkdir(parents=True, exist_ok=True)
    have = load(icao)
    if "fcnow" not in have:  # cache from before the decision-hour column existed: rebuild it
        have = have.iloc[0:0]
    known = set(have["date"])
    today = datetime.now(timezone.utc).date()
    todo = sorted(d for d in days if d.isoformat() not in known and d < today - timedelta(days=1))
    if not todo:
        return 0
    # Fetch contiguous spans, so gaps between market days don't cost extra requests.
    new = []
    span = [todo[0]]
    for d in todo[1:] + [None]:
        if d is not None and (d - span[0]).days < CHUNK:
            span.append(d)
            continue
        hourly = fetch(station, span[0] - timedelta(days=1), span[-1] + timedelta(days=1))
        new += daily(station, hourly, span)
        if d is not None:
            span = [d]
    if new:
        pd.concat([have, pd.DataFrame(new)], ignore_index=True).sort_values(["date", "lead"]).to_csv(
            FORECASTS / f"{icao}.csv", index=False)
    return len({r["date"] for r in new})
