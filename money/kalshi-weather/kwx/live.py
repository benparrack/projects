"""Today's picks from live quotes, sizing, and the paper-trading ledger."""
import pickle
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from . import dataset, kalshi, nbs, obs, stations, weather
from .backtest import trades
from .model import bracket_probs

STATE = stations.DATA / "state.pkl"
LEDGER = stations.DATA / "paper.csv"
DAYOF_LAST_HOUR = 9       # tested on the ~08:00 quote; later the market has seen the morning's weather and the model hasn't
EVENING_FIRST_HOUR = 18   # tested at 18:00; before that its 15-17h observation feature isn't observed yet
KELLY = 0.25
MAX_BET = 0.10            # never more than this share of the bankroll on one market


def save_state(state):
    STATE.write_bytes(pickle.dumps(state))


def load_state():
    if not STATE.exists():
        raise SystemExit("No trained model yet: run `./run.sh backtest` first.")
    return pickle.loads(STATE.read_bytes())


def decision_for(info, kind, d, now):
    """Which tested decision a market for day d matches right now, if any."""
    local = now.astimezone(ZoneInfo(info["tz"]))
    if d == local.date() and kind == "high" and 7 <= local.hour < DAYOF_LAST_HOUR:
        return "day-of"
    if d == local.date() + timedelta(days=1) and EVENING_FIRST_HOUR <= local.hour:
        return "evening-before"
    return None


def candidates(state, now=None):
    """Live quote rows (same columns as dataset.build's quotes) for every market we have a tested decision for."""
    now = now or datetime.now(timezone.utc)
    st = stations.load()
    rows = []
    for s, info in sorted(st.items()):
        kind = dataset.kind_of(s)
        for m in kalshi.open_markets(s):
            if not m["strike_type"] in ("greater", "less", "between"):
                continue
            d = date.fromisoformat(m["date"])
            dec = decision_for(info, kind, d, now)
            if dec is None or m["yes_bid"] is None or m["yes_ask"] is None:
                continue
            lo, hi = dataset.bracket(m["strike_type"], m["floor"], m["cap"])
            rows.append({"series": s, "date": m["date"], "ticker": m["ticker"], "decision": dec,
                         "lead": dataset.DECISIONS[dec]["lead"], "lo": lo, "hi": hi, "unit": info["unit"],
                         "bid": m["yes_bid"], "ask": m["yes_ask"], "yes": 0, "volume": m["volume"],
                         "t": int(now.timestamp()), "label": m.get("yes_sub_title") or ""})
    return pd.DataFrame(rows)


def live_events(quotes):
    """Forecast rows for the stations/days in `quotes`, built exactly like the training data."""
    st = stations.load()
    out = []
    for s, g in quotes.groupby("series"):
        info = st[s]
        f = weather.forecast_days(info, {date.fromisoformat(d) for d in g["date"]})
        if f.empty:
            continue
        cols = dataset.temp_cols(f)
        f[cols] = dataset.to_f(f[cols], info["unit"])
        f["series"], f["kind"], f["unit"] = s, dataset.kind_of(s), info["unit"]
        out.append(dataset.drop_outliers(f))
    if not out:
        return pd.DataFrame()
    return nbs.attach(obs.attach(pd.concat(out, ignore_index=True), st, obs.recent), st, nbs.recent)


def size(p, price, bankroll):
    """Quarter-Kelly stake for a binary contract bought at `price` (fee included) with win probability p."""
    f = max(0.0, (p - price) / (1 - price)) * KELLY
    stake = min(f, MAX_BET) * bankroll
    return int(stake // price)


def picks(state, bankroll, now=None):
    q = candidates(state, now)
    if q.empty:
        return q
    ev = live_events(q)
    if ev.empty:
        return pd.DataFrame()
    q["p_model"] = bracket_probs(state["models"], ev, q)
    q = q[np.isfinite(q["p_model"])].copy()
    q["p_blend"] = np.nan
    for dec, g in q.groupby("decision"):
        b = state["blends"].get(dec)
        if b is not None:
            q.loc[g.index, "p_blend"] = b.predict(g["p_model"].to_numpy(), g)
    q = q[np.isfinite(q["p_blend"])]
    t = trades(q, q["p_blend"].to_numpy(), state["margin"])
    if t.empty:
        return t
    t["p_side"] = np.where(t["side"] == "YES", t["p_blend"], 1 - t["p_blend"])
    t["contracts"] = [size(p, c, bankroll) for p, c in zip(t["p_side"], t["cost"])]
    t["mode"] = "LIVE" if state["verdict"] == "EDGE" else "PAPER"
    return t[t["contracts"] > 0].sort_values("ev", ascending=False)  # too small an edge to size means no pick


def log_paper(t):
    """Record picks once per (ticker, decision) so repeated scans don't double count."""
    cols = ["logged", "ticker", "series", "date", "decision", "side", "price", "cost", "p_side", "ev", "contracts",
            "label", "result", "pnl"]
    old = pd.read_csv(LEDGER) if LEDGER.exists() else pd.DataFrame(columns=cols)
    new = t.assign(logged=datetime.now(timezone.utc).isoformat(timespec="minutes"), result="", pnl=np.nan)
    new["contracts"] = new["contracts"].clip(lower=1)  # paper-trade at least one contract so every pick counts
    new = new[cols]
    seen = set(zip(old["ticker"], old["decision"]))
    new = new[[(a, b) not in seen for a, b in zip(new["ticker"], new["decision"])]]
    if len(new):
        pd.concat([old, new], ignore_index=True).to_csv(LEDGER, index=False)
    return len(new)


def settle():
    """Fill in results for paper trades whose markets have settled. Returns the ledger."""
    if not LEDGER.exists():
        return pd.DataFrame()
    led = pd.read_csv(LEDGER, dtype={"result": str})
    for i, r in led[led["result"].isna() | (led["result"] == "")].iterrows():
        m = (kalshi.get(f"/markets/{r['ticker']}") or {}).get("market") or \
            (kalshi.get(f"/historical/markets/{r['ticker']}") or {}).get("market") or {}
        if m.get("result") in ("yes", "no"):
            won = (m["result"] == "yes") == (r["side"] == "YES")
            led.loc[i, "result"] = m["result"]
            led.loc[i, "pnl"] = round((float(won) - r["cost"]) * r["contracts"], 4)
    led.to_csv(LEDGER, index=False)
    return led


def ledger_summary(led):
    done = led[led["pnl"].notna()] if len(led) else led
    if done.empty:
        return {"n": len(led), "settled": 0}
    cost = float((done["cost"] * done["contracts"]).sum())
    return {"n": len(led), "settled": len(done), "pnl": float(done["pnl"].sum()), "cost": cost,
            "roi": float(done["pnl"].sum() / cost) if cost else float("nan"),
            "win": float((done["pnl"] > 0).mean())}
