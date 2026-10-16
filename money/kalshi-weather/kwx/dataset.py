"""Join markets, settled temperatures, forecasts and quotes into the tables the model and backtest use."""
from datetime import date

import numpy as np
import pandas as pd

from . import data, nbs, obs, stations, weather

# When we'd trade, and which forecast lead was fully public by then (see weather.py).
DECISIONS = {
    "day-of": {"lead": 1, "hour": 8, "days_before": 0, "kinds": ("high",)},
    # Lows usually happen around dawn, so by 08:00 on the day they're mostly known: evening-before only.
    "evening-before": {"lead": 2, "hour": 18, "days_before": 1, "kinds": ("high", "low")},
}
assert all(weather.DECISION_TIME[d["lead"]] == (d["hour"], d["days_before"]) for d in DECISIONS.values())


def temp_cols(f):
    """Forecast temperature columns (native unit until converted)."""
    return [c for c in f.columns if c.endswith(("_max", "_min")) or c == "fcnow"]


OUTLIER_F = 12  # NBM's Nov 2024 archive has 72°F highs on 29°F Chicago days


def drop_outliers(f):
    """NaN any model's high/low more than OUTLIER_F °F from the median of all models (needs ≥3 models)."""
    f = f.copy()
    for stat in ("_max", "_min"):
        cols = [c for c in f.columns if c.endswith(stat)]
        v = f[cols]
        med = v.median(axis=1)
        bad = v.sub(med, axis=0).abs().gt(OUTLIER_F) & (v.notna().sum(axis=1) >= 3).to_numpy()[:, None]
        f[cols] = v.mask(bad)
    return f


def kind_of(series):
    return "low" if series.startswith("KXLOW") else "high"


def to_f(x, unit):
    """°C -> °F where unit is "C"; unit may be one string or a per-row Series."""
    return np.where(unit == "C", x * 1.8 + 32, x) if isinstance(unit, pd.Series) else (x * 1.8 + 32 if unit == "C" else x)


def bracket(strike_type, floor, cap):
    """Settlement values (integers, native unit) that make YES win, as an inclusive [lo, hi] range."""
    if strike_type == "greater":
        return floor + 1, np.inf
    if strike_type == "less":
        return -np.inf, cap - 1
    if strike_type == "between":
        return floor, cap
    raise ValueError(strike_type)


def normalize(markets):
    """Recover brackets for markets listed without strike fields (some early 2025 ones) from the
    ticker (…-B30.5 = 30° to 31°); drop the rest (old 2021-23 single-threshold markets)."""
    m = markets.copy()
    b = m["ticker"].str.extract(r"-B(\d+(?:\.\d+)?)$")[0].astype(float)
    fix = m["strike_type"].isna() & b.notna()
    m.loc[fix, "strike_type"] = "between"
    m.loc[fix, "floor"] = b[fix] - 0.5
    m.loc[fix, "cap"] = b[fix] + 0.5
    return m[m["strike_type"].isin(["greater", "less", "between"])]


def event_values(markets):
    """Settled temperature per (series, date): Kalshi's reported value, else the midpoint of the winning bracket."""
    rows = []
    for (s, d), g in markets.groupby(["series", "date"]):
        v = g["value"].dropna()
        exact = len(v) > 0
        if exact:
            val = float(v.iloc[0])
        else:
            yes = g[g["result"] == "yes"]
            if len(yes) != 1:
                continue
            lo, hi = bracket(yes.iloc[0]["strike_type"], yes.iloc[0]["floor"], yes.iloc[0]["cap"])
            if not (np.isfinite(lo) and np.isfinite(hi)):
                continue
            val = (lo + hi) / 2
        rows.append({"series": s, "date": d, "value": val, "exact": exact})
    return pd.DataFrame(rows)


def check_brackets(markets, values):
    """Share of markets whose recorded result disagrees with bracket(strike) applied to the settled value.
    Should be ~0; anything else means the strike semantics or values are misread."""
    m = markets.drop(columns="value").merge(values[values["exact"]], on=["series", "date"])
    lo_hi = [bracket(*r) for r in m[["strike_type", "floor", "cap"]].itertuples(index=False)]
    v = np.round(m["value"].to_numpy())
    implied = np.array([lo <= x <= hi for (lo, hi), x in zip(lo_hi, v)])
    return float(np.mean(implied != (m["result"] == "yes").to_numpy())), len(m)


def forecasts(st):
    """All cached forecasts, tagged with series, in °F."""
    out = []
    for s, info in st.items():
        f = weather.load(info["icao"])
        if f.empty:
            continue
        f = f.copy()
        f["series"] = s
        cols = temp_cols(f)
        f[cols] = to_f(f[cols], info["unit"])
        out.append(drop_outliers(f))
    return pd.concat(out, ignore_index=True)


def quote_at(candles, t):
    """Closing (bid, ask) of the last hourly candle ending at or before t (within 2h), else None."""
    best = None
    for end, bid, ask, last, vol in candles:
        if t - 7200 < end <= t and (best is None or end > best[0]):
            best = (end, bid, ask)
    if best is None or best[1] is None or best[2] is None:
        return None
    return best[1], best[2]


def build(series=None):
    """Returns (events, quotes).
    events: one row per (series, date, lead) with forecasts and the settled value (°F), for the temperature model.
    quotes: one row per (market, decision) with the bid/ask we could have traded at and the result."""
    st = stations.load()
    markets = normalize(data.load_markets(series))
    markets = markets[markets["series"].isin(st)]
    markets["kind"] = markets["series"].map(kind_of)
    values = event_values(markets)

    fc = forecasts({s: st[s] for s in markets["series"].unique()})
    events = nbs.attach(obs.attach(fc.merge(values, on=["series", "date"], how="left"), st), st)
    events["kind"] = events["series"].map(kind_of)
    events["unit"] = events["series"].map(lambda s: st[s]["unit"])
    events["value_f"] = to_f(events["value"], events["unit"])

    candles = data.load_candles(markets["series"].unique())
    rows = []
    for r in markets[markets["date"] >= weather.ARCHIVE_START.isoformat()].itertuples():
        c = candles.get(r.ticker)
        if not c:
            continue
        info = st[r.series]
        d = date.fromisoformat(r.date)
        lo, hi = bracket(r.strike_type, r.floor, r.cap)
        for name, dec in DECISIONS.items():
            if r.kind not in dec["kinds"]:
                continue
            t = int(stations.local_time_utc(info, d, dec["hour"], dec["days_before"]).timestamp())
            q = quote_at(c, t)
            if q is None:
                continue
            rows.append({"series": r.series, "date": r.date, "ticker": r.ticker, "decision": name, "lead": dec["lead"],
                         "lo": lo, "hi": hi, "unit": info["unit"], "bid": q[0], "ask": q[1],
                         "yes": int(r.result == "yes"), "volume": r.volume, "t": t})
    return events, pd.DataFrame(rows)
