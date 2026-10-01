"""Pre-trade check: position sizing plus historical facts about the stock. No predictions.

Everything here is a pure function of price history and the trade you describe, so
it can be unit-tested with synthetic data.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd


def atr(df: pd.DataFrame, n: int = 14) -> pd.Series:
    pc = df["Close"].shift()
    tr = pd.concat([df["High"] - df["Low"], (df["High"] - pc).abs(), (df["Low"] - pc).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / n, adjust=False).mean()


def size_position(equity: float, cash: float, entry: float, stop: float, fx: float, risk_pct: float,
                  max_pos_pct: float, fractional: bool) -> dict:
    """Shares so that a stop-out loses `risk_pct` of equity, capped by position size and cash."""
    per_share_risk = (entry - stop) * fx
    if per_share_risk <= 0 or entry <= 0:
        return {"shares": 0.0, "limited_by": "invalid stop", "risk_usd": 0.0, "cost_usd": 0.0}
    want = equity * risk_pct / per_share_risk
    caps = {"risk": want, "max position size": equity * max_pos_pct / (entry * fx),
            "available cash": max(cash, 0) / (entry * fx)}
    limited_by = min(caps, key=caps.get)
    shares = caps[limited_by]
    shares = math.floor(shares * 10000) / 10000 if fractional else math.floor(shares)
    return {"shares": shares, "limited_by": limited_by, "risk_usd": shares * per_share_risk,
            "cost_usd": shares * entry * fx, "wanted_shares": want}


def first_touch(df: pd.DataFrame, stop_pct: float, target_pct: float, hold_days: int,
                lookback: int = 756) -> dict:
    """Base rates: starting from every past day, did price hit -stop_pct or +target_pct first?

    Uses daily highs/lows; if both are hit on the same day we count the stop (the
    conservative assumption). Returns fractions plus the average R when neither was hit.
    """
    d = df.iloc[-(lookback + hold_days + 1):]
    c, h, low = d["Close"].to_numpy(), d["High"].to_numpy(), d["Low"].to_numpy()
    n = len(d) - hold_days - 1
    if n < 50 or stop_pct <= 0 or target_pct <= 0:
        return {}
    stop_first = target_first = 0
    neither_r = []
    for i in range(n):
        e = c[i]
        s_lvl, t_lvl = e * (1 - stop_pct), e * (1 + target_pct)
        lo, hi = low[i + 1:i + 1 + hold_days], h[i + 1:i + 1 + hold_days]
        s_hit = np.flatnonzero(lo <= s_lvl)
        t_hit = np.flatnonzero(hi >= t_lvl)
        s_day = s_hit[0] if len(s_hit) else None
        t_day = t_hit[0] if len(t_hit) else None
        if s_day is not None and (t_day is None or s_day <= t_day):
            stop_first += 1
        elif t_day is not None:
            target_first += 1
        else:
            neither_r.append((c[i + hold_days] / e - 1) / stop_pct)
    rr = target_pct / stop_pct
    p_s, p_t = stop_first / n, target_first / n
    p_n = 1 - p_s - p_t
    avg_n = float(np.mean(neither_r)) if neither_r else 0.0
    return {"samples": n, "stop_first": p_s, "target_first": p_t, "neither": p_n,
            "neither_avg_r": avg_n, "expected_r": p_t * rr - p_s + p_n * avg_n}


def earnings_moves(df: pd.DataFrame, past_sessions: list[str]) -> list[dict]:
    """Close-to-close move on each past earnings reaction session."""
    out = []
    idx = df.index
    for s in past_sessions:
        i = idx.searchsorted(pd.Timestamp(s))
        if 0 < i < len(idx):
            out.append({"date": idx[i].strftime("%Y-%m-%d"),
                        "move": float(df["Close"].iloc[i] / df["Close"].iloc[i - 1] - 1)})
    return out


def max_drawdown(close: pd.Series) -> float:
    return float((close / close.cummax() - 1).min()) if len(close) else 0.0


def analyze(*, hist: pd.DataFrame, spy: pd.DataFrame | None, entry: float, stop: float, target: float | None,
            hold_days: int, fx: float, equity: float, cash: float, risk_pct: float, max_pos_pct: float,
            max_heat_pct: float, open_heat_usd: float, holdings: list[dict], sector: str | None,
            next_earnings: str | None, past_earnings: list[str], thesis: str = "", fractional: bool = True,
            today: pd.Timestamp | None = None) -> dict:
    today = today or pd.Timestamp.today().normalize()
    flags: list[dict] = []

    def flag(level, text):
        flags.append({"level": level, "text": text})

    c = hist["Close"]
    lr = np.log(c).diff().dropna()
    a = float(atr(hist).iloc[-1])
    last = float(c.iloc[-1])
    daily_sd = float(lr.iloc[-60:].std())
    m = {
        "last_close": last, "atr": a, "atr_pct": a / last,
        "typical_move_hold": daily_sd * math.sqrt(max(hold_days, 1)),
        "ann_vol": daily_sd * math.sqrt(252),
        "worst_day_1y": float(lr.iloc[-252:].min()) if len(lr) else 0.0,
        "max_dd_5y": max_drawdown(c),
        "from_52w_high": last / float(c.iloc[-252:].max()) - 1,
        "vs_sma200": last / float(c.iloc[-200:].mean()) - 1 if len(c) >= 200 else None,
        "dollar_vol_usd": float((hist["Close"] * hist["Volume"]).iloc[-60:].median() * fx),
        "beta": None,
    }
    if spy is not None and len(spy) > 60:
        r = pd.concat([lr.iloc[-252:], np.log(spy["Close"]).diff()], axis=1, join="inner").dropna()
        if len(r) > 60:
            m["beta"] = float(r.cov().iloc[0, 1] / r.iloc[:, 1].var())

    # --- the trade itself ---------------------------------------------------
    valid = entry > 0 and 0 < stop < entry
    if not valid:
        flag("bad", "Stop must be below your entry price (this cockpit only does long trades).")
    if target is not None and target <= entry:
        flag("bad", "Target must be above your entry price.")
        target = None
    stop_pct = (entry - stop) / entry if valid else 0.0
    m["stop_pct"] = stop_pct
    m["stop_atr"] = (entry - stop) / a if valid and a > 0 else None
    m["rr"] = (target - entry) / (entry - stop) if valid and target else None
    sz = size_position(equity, cash, entry, stop, fx, risk_pct, max_pos_pct, fractional) if valid else \
        {"shares": 0.0, "limited_by": "invalid stop", "risk_usd": 0.0, "cost_usd": 0.0}

    if valid:
        if m["rr"] is None:
            flag("warn", "No target set. Decide in advance where you'd take profit.")
        elif m["rr"] < 1:
            flag("bad", f"Reward:risk is {m['rr']:.1f}:1. You'd risk more than you could make.")
        elif m["rr"] < 1.5:
            flag("warn", f"Reward:risk is only {m['rr']:.1f}:1. Aim for 2:1 or better.")
        else:
            flag("ok", f"Reward:risk is {m['rr']:.1f}:1.")
        if m["stop_atr"] is not None and m["stop_atr"] < 1:
            flag("warn", f"Your stop is {m['stop_atr']:.1f}× the average daily range (ATR {a:.2f}). "
                         "Normal noise could stop you out; consider 1.5–3× ATR.")
        elif m["stop_atr"] is not None and m["stop_atr"] > 5:
            flag("warn", f"Your stop is {m['stop_atr']:.1f}× ATR away, so the position has to be small.")
        if abs(entry / last - 1) > 0.15:
            flag("warn", f"Entry {entry:.2f} is {entry / last - 1:+.0%} from the last price {last:.2f}.")
        gaps = (hist["Open"] / c.shift() - 1).iloc[-504:]
        n_gap = int((gaps <= -stop_pct).sum())
        m["gaps_through_stop_2y"] = n_gap
        if n_gap:
            flag("warn" if n_gap < 12 else "bad",
                 f"In the last 2 years it opened {stop_pct:.0%}+ lower overnight {n_gap} times. A stop "
                 "can't protect you from a gap; you'd be filled lower.")
        if target:
            ft = first_touch(hist, stop_pct, (target - entry) / entry, hold_days)
            m["base_rates"] = ft
            if ft:
                lvl = "ok" if ft["expected_r"] > 0.1 else "warn"
                flag(lvl, f"History check: from a random day in the past 3 years, this stop/target hit the "
                          f"target first {ft['target_first']:.0%} and the stop first {ft['stop_first']:.0%} "
                          f"within {hold_days} days (avg {ft['expected_r']:+.2f}R). That's the base rate your "
                          "reason for buying has to beat.")

    # --- sizing / portfolio --------------------------------------------------
    if valid:
        if sz["shares"] <= 0:
            flag("bad", "Not enough cash for even a small position.")
        elif sz["limited_by"] != "risk":
            flag("warn", f"Size was cut by your {sz['limited_by']} limit, so you're risking "
                         f"${sz['risk_usd']:.2f} instead of ${equity * risk_pct:.2f}.")
        heat = (open_heat_usd + sz["risk_usd"]) / equity if equity > 0 else 0
        m["heat_after"] = heat
        if heat > max_heat_pct:
            flag("warn", f"Total risk across open trades would be {heat:.1%} of the account (limit "
                         f"{max_heat_pct:.0%}). A bad week could hit several stops at once.")
        pos_val = sz["cost_usd"]
        same = [h for h in holdings if h.get("sector") and h["sector"] == sector]
        if sector and equity > 0:
            sec_pct = (sum(h["value_usd"] for h in same) + pos_val) / equity
            m["sector_pct_after"] = sec_pct
            if sec_pct > 0.5:
                flag("warn", f"{sec_pct:.0%} of the account would be in {sector}.")
        corr_hits = []
        for h in holdings:
            hc = h.get("close")
            if hc is None or len(hc) < 60:
                continue
            r = pd.concat([lr.iloc[-120:], np.log(hc).diff()], axis=1, join="inner").dropna()
            if len(r) > 40:
                cc = float(r.corr().iloc[0, 1])
                if cc > 0.7:
                    corr_hits.append(f"{h['ticker']} ({cc:.2f})")
        if corr_hits:
            flag("warn", "Moves closely with what you already hold: " + ", ".join(corr_hits)
                 + ". That's closer to doubling one bet than diversifying.")

    # --- calendar / stock facts ---------------------------------------------
    em = earnings_moves(hist, past_earnings)
    m["earnings_moves"] = em
    m["next_earnings"] = next_earnings
    avg_em = float(np.mean([abs(x["move"]) for x in em])) if em else None
    m["avg_earnings_move"] = avg_em
    if next_earnings:
        days = int(np.busday_count(today.date(), pd.Timestamp(next_earnings).date()))
        m["earnings_in_days"] = days
        if 0 <= days <= hold_days:
            if avg_em and avg_em >= stop_pct and valid:
                flag("bad", f"Earnings on {next_earnings} (in {days} trading days), inside your holding window. "
                            f"This stock moves {avg_em:.0%} on average on earnings, more than your {stop_pct:.0%} "
                            "stop. That's a coin-flip gamble, not a planned trade.")
            else:
                flag("warn", f"Earnings on {next_earnings} (in {days} trading days), inside your holding "
                             "window" + (f"; average earnings move {avg_em:.0%}." if avg_em else "."))
    if last * fx < 5:
        flag("warn", f"Low-priced stock (${last * fx:.2f}): wider spreads and bigger percentage swings.")
    if m["dollar_vol_usd"] < 5e6:
        flag("warn", f"Thinly traded (about ${m['dollar_vol_usd'] / 1e6:.1f}M a day); you may get bad fills.")
    if m["vs_sma200"] is not None and m["vs_sma200"] < 0:
        flag("info", f"Below its 200-day average ({m['vs_sma200']:+.0%}); it's in a longer-term downtrend.")
    if not thesis or len(thesis.strip()) < 15:
        flag("warn", "Write down why you're buying, and what would prove you wrong.")

    levels = [f["level"] for f in flags]
    if "bad" in levels:
        verdict = "STOP"
        why = "Fix the red items before trading."
    elif levels.count("warn") >= 3:
        verdict = "CAUTION"
        why = "Several yellow flags. Consider a smaller size or a better setup."
    else:
        verdict = "GO"
        why = "The risk side checks out. This says nothing about whether the stock goes up."
    order = {"bad": 0, "warn": 1, "info": 2, "ok": 3}
    flags.sort(key=lambda f: order[f["level"]])
    return {"verdict": verdict, "verdict_text": why, "flags": flags, "metrics": m, "sizing": sz}
