"""Strategy lab: write a buy rule in plain-ish math, backtest it honestly.

Rules are parsed with Python's `ast` and only a small whitelist of nodes is allowed, so nothing typed
into the box can run code. Signals are computed on a day's close and traded at the NEXT day's open,
so a rule can never peek at the bar it trades on.

Honesty checks:
  * the last 30% of the history is held out (out-of-sample) and reported separately;
  * the same exits are applied to random entry days, many times over, to get the baseline any rule
    has to beat (a stock that went up 5x makes every long rule look good);
  * EDGE is only claimed when out-of-sample results beat at least 95% of random baselines with
    enough trades to mean something.
"""
from __future__ import annotations

import ast
import json
import logging

import numpy as np
import pandas as pd
from flask import jsonify, request

from . import db, market
from .service import UserError

log = logging.getLogger("lab")

# ---------- the rule language ----------
SERIES = ("open", "high", "low", "close", "volume")
MAX_WINDOW = 400


def _win(n) -> int:
    if not isinstance(n, (int, float)) or n != int(n) or not 1 <= n <= MAX_WINDOW:
        raise UserError(f"Window lengths must be whole numbers from 1 to {MAX_WINDOW}")
    return int(n)


def _s(x, df):
    return x if isinstance(x, pd.Series) else pd.Series(float(x), index=df.index)


def _rsi(c: pd.Series, n: int) -> pd.Series:
    d = c.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    return 100 - 100 / (1 + up / dn.replace(0, np.nan))


def _atr(df: pd.DataFrame, n: int) -> pd.Series:
    pc = df["Close"].shift(1)
    tr = pd.concat([df["High"] - df["Low"], (df["High"] - pc).abs(), (df["Low"] - pc).abs()], axis=1).max(axis=1)
    return tr.rolling(n).mean()


def _funcs(df: pd.DataFrame) -> dict:
    c = df["Close"]
    return {
        "sma": (lambda x, n: _s(x, df).rolling(_win(n)).mean(), "sma(close, 50): average of the last n days"),
        "ema": (lambda x, n: _s(x, df).ewm(span=_win(n), adjust=False).mean(), "ema(close, 20): exponential average"),
        "rsi": (lambda n=14: _rsi(c, _win(n)), "rsi(14): 0–100 momentum; under 30 = oversold"),
        "atr": (lambda n=14: _atr(df, _win(n)), "atr(14): average daily range in price"),
        "highest": (lambda x, n: _s(x, df).shift(1).rolling(_win(n)).max(),
                    "highest(high, 20): highest of the PREVIOUS n days (excludes today)"),
        "lowest": (lambda x, n: _s(x, df).shift(1).rolling(_win(n)).min(),
                   "lowest(low, 20): lowest of the previous n days"),
        "prev": (lambda x, n=1: _s(x, df).shift(_win(n)), "prev(close, 1): value n days ago"),
        "ret": (lambda n: c / c.shift(_win(n)) - 1, "ret(5): return over the last n days (0.05 = 5%)"),
        "vol": (lambda n=20: np.log(c).diff().rolling(_win(n)).std(), "vol(20): daily volatility"),
        "volume_avg": (lambda n=20: df["Volume"].shift(1).rolling(_win(n)).mean(),
                       "volume_avg(20): average volume of the previous n days"),
        "crosses_above": (lambda a, b: (_s(a, df) > _s(b, df)) & (_s(a, df).shift(1) <= _s(b, df).shift(1)),
                          "crosses_above(sma(close,50), sma(close,200))"),
        "crosses_below": (lambda a, b: (_s(a, df) < _s(b, df)) & (_s(a, df).shift(1) >= _s(b, df).shift(1)),
                          "crosses_below(close, sma(close, 20))"),
    }


HELP = {k: v[1] for k, v in _funcs(pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])).items()}

_CMP = {ast.Gt: lambda a, b: a > b, ast.GtE: lambda a, b: a >= b, ast.Lt: lambda a, b: a < b,
        ast.LtE: lambda a, b: a <= b, ast.Eq: lambda a, b: a == b, ast.NotEq: lambda a, b: a != b}
_BIN = {ast.Add: lambda a, b: a + b, ast.Sub: lambda a, b: a - b, ast.Mult: lambda a, b: a * b,
        ast.Div: lambda a, b: a / b}


def parse(rule: str) -> ast.Expression:
    rule = (rule or "").strip()
    if not rule:
        raise UserError("Write a rule, e.g. close > sma(close, 200) and rsi(2) < 10")
    if len(rule) > 500:
        raise UserError("Rule is too long")
    try:
        tree = ast.parse(rule.replace("\n", " "), mode="eval")
    except SyntaxError as e:
        raise UserError(f"Can't read that rule: {e.msg}")
    allowed = (ast.Expression, ast.BoolOp, ast.And, ast.Or, ast.UnaryOp, ast.Not, ast.USub, ast.Compare,
               ast.BinOp, ast.Call, ast.Name, ast.Constant, ast.Load, *_CMP, *_BIN)
    names = set(HELP)
    for node in ast.walk(tree):
        if not isinstance(node, allowed):
            raise UserError(f"'{type(node).__name__}' isn't allowed in rules")
        if isinstance(node, ast.Constant) and not isinstance(node.value, (int, float)):
            raise UserError("Only numbers are allowed as constants")
        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name) or node.func.id not in names or node.keywords:
                raise UserError(f"Unknown function. Available: {', '.join(sorted(names))}")
        if isinstance(node, ast.Name) and node.id not in SERIES and node.id not in names:
            raise UserError(f"Unknown name '{node.id}'. Use open, high, low, close, volume or a function.")
    return tree


def evaluate(rule: str, df: pd.DataFrame) -> pd.Series:
    """Boolean Series: True on days whose CLOSE satisfies the rule."""
    tree = parse(rule)
    fns = {k: v[0] for k, v in _funcs(df).items()}
    cols = {k: df[k.title()] for k in SERIES}

    def ev(n):
        if isinstance(n, ast.Expression):
            return ev(n.body)
        if isinstance(n, ast.Constant):
            return float(n.value)
        if isinstance(n, ast.Name):
            if n.id in cols:
                return cols[n.id]
            raise UserError(f"'{n.id}' is a function; call it like {n.id}(...)")
        if isinstance(n, ast.BoolOp):
            vals = [_s(ev(v), df).fillna(False).astype(bool) for v in n.values]
            out = vals[0]
            for v in vals[1:]:
                out = (out & v) if isinstance(n.op, ast.And) else (out | v)
            return out
        if isinstance(n, ast.UnaryOp):
            v = ev(n.operand)
            return ~_s(v, df).fillna(False).astype(bool) if isinstance(n.op, ast.Not) else -v
        if isinstance(n, ast.BinOp):
            return _BIN[type(n.op)](ev(n.left), ev(n.right))
        if isinstance(n, ast.Compare):
            left, out = ev(n.left), None
            for op, comp in zip(n.ops, n.comparators):
                right = ev(comp)
                r = _CMP[type(op)](_s(left, df), _s(right, df))
                out = r if out is None else out & r
                left = right
            return out
        if isinstance(n, ast.Call):
            try:
                return fns[n.func.id](*[ev(a) for a in n.args])
            except TypeError:
                raise UserError(f"Wrong number of arguments for {n.func.id}(): {HELP[n.func.id]}")
        raise UserError("Unsupported rule")

    res = ev(tree)
    if not isinstance(res, pd.Series):
        raise UserError("The rule must compare something, e.g. rsi(2) < 10")
    return res.fillna(False).astype(bool)


# ---------- backtest ----------
PRESETS = [
    {"name": "Dip in an uptrend (RSI-2)", "entry": "close > sma(close, 200) and rsi(2) < 10",
     "exit": "close > sma(close, 5)", "stop_type": "atr", "stop_value": 3, "target_r": None, "max_hold": 10,
     "why": "Buy short, sharp pullbacks in stocks that are above their 200-day average; sell on the bounce."},
    {"name": "20-day breakout on volume", "entry": "close > highest(high, 20) and volume > 1.5 * volume_avg(20)",
     "exit": "close < lowest(low, 10)", "stop_type": "atr", "stop_value": 2, "target_r": None, "max_hold": 40,
     "why": "Buy a new 20-day high on heavy volume, ride it until it makes a 10-day low."},
    {"name": "Golden cross", "entry": "crosses_above(sma(close, 50), sma(close, 200))",
     "exit": "crosses_below(sma(close, 50), sma(close, 200))", "stop_type": "pct", "stop_value": 15,
     "target_r": None, "max_hold": 250, "why": "Classic slow trend signal: the 50-day average crosses above the 200-day."},
    {"name": "Gap-down reversal", "entry": "open < prev(low) * 0.97 and close > open",
     "exit": "", "stop_type": "atr", "stop_value": 2, "target_r": 2, "max_hold": 5,
     "why": "Stock gaps down 3%+ below yesterday's low but closes green; bet on the rebound continuing."},
]
DEFAULT_TICKERS = ["TSLA", "NVDA", "AMD", "PLTR", "COIN", "SHOP", "MARA", "SOFI", "RIVN", "SNAP"]


def _spec(d: dict) -> dict:
    tickers = d.get("tickers") or DEFAULT_TICKERS
    if isinstance(tickers, str):
        tickers = [t for t in tickers.replace(",", " ").split() if t]
    tickers = [market.norm(t) for t in tickers][:25]
    st = d.get("stop_type") or "atr"
    if st not in ("atr", "pct", "none"):
        raise UserError("Stop type must be atr, pct or none")
    sv = float(d.get("stop_value") or 0)
    if st != "none" and sv <= 0:
        raise UserError("Stop size must be positive")
    tr = d.get("target_r")
    tr = float(tr) if tr not in (None, "", 0, "0") else None
    mh = int(float(d.get("max_hold") or 20))
    if not 1 <= mh <= 500:
        raise UserError("Max hold must be 1–500 days")
    if st == "none" and tr:
        raise UserError("A target in R needs a stop to measure R from")
    spec = {"name": (d.get("name") or "").strip()[:80], "tickers": tickers, "entry": d.get("entry", ""),
            "exit": (d.get("exit") or "").strip(), "stop_type": st, "stop_value": sv, "target_r": tr,
            "max_hold": mh, "cost_bps": float(d.get("cost_bps") if d.get("cost_bps") not in (None, "") else 10)}
    parse(spec["entry"])
    if spec["exit"]:
        parse(spec["exit"])
    return spec


def outcomes(df: pd.DataFrame, spec: dict, exit_sig: pd.Series | None) -> pd.DataFrame:
    """For EVERY possible entry day d (buy at d's open), where and why the trade would end.

    Precomputing this lets the strategy and thousands of random baselines share one exit engine.
    Stop/target are checked against each day's low/high; if both are touched on the same day the stop
    is assumed to have hit first. Gaps through a level fill at the open.
    """
    o, h, l, c = (df[k].to_numpy(float) for k in ("Open", "High", "Low", "Close"))
    atr = _atr(df, 14).shift(1).to_numpy(float)  # known before day d opens
    ex = exit_sig.to_numpy(bool) if exit_sig is not None else np.zeros(len(df), bool)
    n, mh, cost = len(df), spec["max_hold"], spec["cost_bps"] / 1e4
    ret = np.full(n, np.nan)
    rmul = np.full(n, np.nan)
    exit_i = np.full(n, -1)
    rfrac = np.full(n, np.nan)
    why = np.empty(n, dtype=object)
    for d in range(1, n):
        e = o[d]
        if not np.isfinite(e) or e <= 0:
            continue
        if spec["stop_type"] == "atr":
            if not np.isfinite(atr[d]):
                continue
            stop = e - spec["stop_value"] * atr[d]
        elif spec["stop_type"] == "pct":
            stop = e * (1 - spec["stop_value"] / 100)
        else:
            stop = None
        risk = e - stop if stop is not None else None
        target = e + spec["target_r"] * risk if spec["target_r"] and risk else None
        px, reason, j = None, None, d
        while j < n:
            if stop is not None and l[j] <= stop:
                px, reason = (min(o[j], stop) if j > d else stop), "stop"
                break
            if target is not None and h[j] >= target:
                px, reason = (max(o[j], target) if j > d else target), "target"
                break
            if j - d + 1 >= mh:
                px, reason = c[j], "time"
                break
            if ex[j] and j + 1 < n:  # exit rule seen at the close, sell next open
                j += 1
                px, reason = o[j], "rule"
                break
            j += 1
        if px is None:
            continue  # still open at the end of the data
        r = px / e - 1 - 2 * cost
        ret[d], exit_i[d], why[d] = r, j, reason
        if risk:
            rmul[d] = r * e / risk
            rfrac[d] = risk / e
    return pd.DataFrame({"ret": ret, "r": rmul, "exit_i": exit_i, "why": why, "risk_frac": rfrac}, index=df.index)


def _stats(rets: np.ndarray, rs: np.ndarray, holds: np.ndarray) -> dict:
    if len(rets) == 0:
        return {"trades": 0}
    w, lo = rets[rets > 0], rets[rets <= 0]
    r_ok = rs[np.isfinite(rs)]
    return {"trades": int(len(rets)), "win_rate": float((rets > 0).mean()), "avg_ret": float(rets.mean()),
            "median_ret": float(np.median(rets)), "avg_r": float(r_ok.mean()) if len(r_ok) else None,
            "profit_factor": float(w.sum() / -lo.sum()) if len(lo) and lo.sum() < 0 else None,
            "avg_hold": float(holds.mean()), "best": float(rets.max()), "worst": float(rets.min()),
            "total_compound": float(np.prod(1 + rets) - 1)}


def backtest(d: dict, n_random: int = 500, seed: int = 7) -> dict:
    spec = _spec(d)
    rng = np.random.default_rng(seed)
    trades, per_ticker, skipped = [], [], []
    pools = {"all": [], "is": [], "oos": []}  # (ret, r, hold) of every possible entry, for the random baseline
    for tk in spec["tickers"]:
        try:
            df = market.completed(market.history(tk), tk)
        except Exception as e:
            skipped.append(f"{tk}: {e}")
            continue
        if len(df) < 260:
            skipped.append(f"{tk}: not enough history")
            continue
        sig = evaluate(spec["entry"], df)
        ex = evaluate(spec["exit"], df) if spec["exit"] else None
        oc = outcomes(df, spec, ex)
        split = int(len(df) * 0.7)
        holds_all = np.where(oc["exit_i"] >= 0, oc["exit_i"] - np.arange(len(df)) + 1, 0)
        valid = oc["ret"].notna().to_numpy() & (np.arange(len(df)) >= 200)  # skip indicator warm-up
        for i in np.flatnonzero(valid):
            pools["all"].append((oc["ret"].iat[i], oc["r"].iat[i], holds_all[i]))
            pools["is" if i < split else "oos"].append((oc["ret"].iat[i], oc["r"].iat[i], holds_all[i]))
        tk_trades = _ticker_trades(tk, df, sig, oc, split, valid)
        trades += tk_trades
        n_tk = len(tk_trades)
        bh = float(df["Close"].iat[-1] / df["Close"].iat[200] - 1)
        per_ticker.append({"ticker": tk, "trades": n_tk, "buy_hold": bh,
                           "split_date": df.index[split].strftime("%Y-%m-%d"),
                           "signal_today": bool(sig.iat[-1])})
    if not per_ticker:
        raise UserError("No usable price history. " + "; ".join(skipped))

    def part(sel):
        t = [x for x in trades if sel(x)]
        return _stats(np.array([x["ret"] for x in t]), np.array([x["r"] if x["r"] is not None else np.nan for x in t]),
                      np.array([x["hold"] for x in t]))

    res = {"spec": spec, "all": part(lambda x: True), "in_sample": part(lambda x: not x["oos"]),
           "out_of_sample": part(lambda x: x["oos"]), "per_ticker": per_ticker, "skipped": skipped}
    # Random-entry baseline: same number of trades, same exits, random days.
    for key, pool_key in (("all", "all"), ("out_of_sample", "oos")):
        st, pool = res[key], np.array(pools[pool_key], float)
        if st["trades"] and len(pool) >= st["trades"]:
            idx = rng.integers(0, len(pool), size=(n_random, st["trades"]))
            means = pool[idx, 0].mean(axis=1)
            st["random_avg_ret"] = float(pool[:, 0].mean())
            st["random_p95"] = float(np.quantile(means, 0.95))
            st["p_value"] = float((np.sum(means >= st["avg_ret"]) + 1) / (n_random + 1))
            st["edge_vs_random"] = st["avg_ret"] - st["random_avg_ret"]
    o, i = res["out_of_sample"], res["in_sample"]
    if o.get("trades", 0) < 30:
        verdict, text = "TOO FEW TRADES", (f"Only {o.get('trades', 0)} out-of-sample trades. That's not enough to tell "
                                           "skill from luck; add more tickers or loosen the rule.")
    elif o.get("p_value", 1) < 0.05 and o["avg_ret"] > 0 and i.get("avg_ret", 0) > 0 and o["edge_vs_random"] > 0:
        verdict, text = "EDGE", (f"On data the rule never saw, it averaged {o['avg_ret']:+.2%} per trade vs "
                                 f"{o['random_avg_ret']:+.2%} for random entries (p={o['p_value']:.3f}). Worth "
                                 "paper-trading. Past edges often fade, so treat it as a hypothesis.")
    else:
        verdict, text = "NO EDGE", (f"Out-of-sample it averaged {o['avg_ret']:+.2%} per trade; random entries with the "
                                    f"same exits averaged {o.get('random_avg_ret', 0):+.2%}. "
                                    f"Not distinguishable from luck (p={o.get('p_value', 1):.2f}).")
    s = db.settings()
    sim = portfolio_sim(trades, risk_pct=float(d.get("sim_risk_pct") or s["risk_pct"] * 100) / 100,
                        max_positions=int(d.get("sim_max_pos") or 5), max_pos_pct=s["max_position_pct"])
    res.update(verdict=verdict, verdict_text=text, sim=sim,
               trades=sorted(trades, key=lambda x: x["entry_date"], reverse=True)[:400],
               curve=_curve(trades))
    return res


def _ticker_trades(tk, df, sig, oc, split, valid) -> list[dict]:
    """Signal at the close of day i -> buy the open of i+1; one position per ticker at a time."""
    out, busy_until = [], -1
    for i in np.flatnonzero(sig.to_numpy()):
        d0 = i + 1
        if d0 >= len(df) or d0 <= busy_until or d0 < 200 or not valid[d0]:
            continue
        j = int(oc["exit_i"].iat[d0])
        rf = oc["risk_frac"].iat[d0]
        out.append({"ticker": tk, "entry_date": df.index[d0].strftime("%Y-%m-%d"),
                    "exit_date": df.index[j].strftime("%Y-%m-%d"), "entry": float(df["Open"].iat[d0]),
                    "ret": float(oc["ret"].iat[d0]), "r": float(oc["r"].iat[d0]) if np.isfinite(oc["r"].iat[d0]) else None,
                    "risk_frac": float(rf) if np.isfinite(rf) else None,
                    "hold": int(j - d0 + 1), "why": oc["why"].iat[d0], "oos": bool(d0 >= split)})
        busy_until = j
    return out


def portfolio_sim(trades: list[dict], start: float = 10_000, risk_pct: float = 0.01, max_positions: int = 5,
                  max_pos_pct: float = 0.25) -> dict:
    """Run the trades as one account: risk a fixed share of equity per trade (sized by the stop), at most
    `max_positions` at once, skipping signals when full or out of cash. Positions are marked at cost while open."""
    if not trades:
        return {"trades": 0}
    cash, open_, curve, taken, skipped = start, [], [], 0, 0
    peak, mdd = start, 0.0

    def close_until(day):
        nonlocal cash, peak, mdd
        for pos in sorted([p for p in open_ if p[0] <= day]):
            open_.remove(pos)
            cash += pos[1] * (1 + pos[2])
            eq = cash + sum(p[1] for p in open_)
            peak = max(peak, eq)
            mdd = min(mdd, eq / peak - 1)
            curve.append({"t": pos[0], "v": round(eq, 2)})

    for t in sorted(trades, key=lambda x: (x["entry_date"], x["ticker"])):
        close_until(t["entry_date"])
        eq = cash + sum(p[1] for p in open_)
        if len(open_) >= max_positions:
            skipped += 1
            continue
        size = eq * risk_pct / t["risk_frac"] if t.get("risk_frac") else eq * max_pos_pct
        size = min(size, eq * max_pos_pct, cash)
        if size < 1:
            skipped += 1
            continue
        cash -= size
        open_.append((t["exit_date"], size, t["ret"]))
        taken += 1
    close_until("9999")
    final = cash
    d0, d1 = pd.Timestamp(min(t["entry_date"] for t in trades)), pd.Timestamp(max(t["exit_date"] for t in trades))
    years = max((d1 - d0).days / 365.25, 0.1)
    out = {"trades": taken, "skipped": skipped, "start": start, "final": final, "total_return": final / start - 1,
           "cagr": (final / start) ** (1 / years) - 1, "max_drawdown": mdd, "years": years, "curve": curve,
           "risk_pct": risk_pct, "max_positions": max_positions}
    try:
        spy = market.history("SPY")["Close"]
        a, b = spy.asof(d0), spy.asof(d1)
        out["spy_return"] = float(b / a - 1)
        out["spy_cagr"] = float((b / a) ** (1 / years) - 1)
    except Exception:
        pass
    return out


def _load(tickers):
    data, skipped = {}, []
    for tk in tickers:
        try:
            df = market.completed(market.history(tk), tk)
        except Exception as e:
            skipped.append(f"{tk}: {e}")
            continue
        if len(df) < 260:
            skipped.append(f"{tk}: not enough history")
            continue
        data[tk] = df
    return data, skipped


def _grid_vals(v, default, cast=float, allow_none=False):
    if v in (None, ""):
        return default
    out = []
    for x in str(v).replace(",", " ").split():
        if allow_none and x.lower() in ("none", "-", "0"):
            out.append(None)
        else:
            out.append(cast(x))
    return out or default


def optimize(d: dict) -> dict:
    """Try every combination of exit settings (and values of $p in the rule) on the OLDER 70% only, pick the best,
    then show how that pick and all others did on the newer 30%. If in-sample rank doesn't predict out-of-sample
    rank, tuning is just fitting noise."""
    base = _spec(dict(d, entry=(d.get("entry") or "").replace("$p", "1")))
    st = base["stop_type"]
    stops = _grid_vals(d.get("grid_stop"), {"atr": [1.5, 2, 3], "pct": [4, 7, 10], "none": [0]}[st])
    holds = _grid_vals(d.get("grid_hold"), [5, 10, 20], int)
    targets = _grid_vals(d.get("grid_target"), [None, 2, 3] if st != "none" else [None], allow_none=True)
    pvals = _grid_vals(d.get("grid_p"), [None]) if "$p" in (d.get("entry") or "") else [None]
    combos = [(sv, mh, tr, pv) for sv in stops for mh in holds for tr in targets for pv in pvals]
    if len(combos) > 81:
        raise UserError(f"{len(combos)} combinations; keep it to 81 or fewer")
    data, skipped = _load(base["tickers"])
    if not data:
        raise UserError("No usable price history. " + "; ".join(skipped))
    sigs, exits = {}, {}
    for pv in pvals:
        rule = (d.get("entry") or "").replace("$p", str(pv)) if pv is not None else base["entry"]
        sigs[pv] = {tk: evaluate(rule, df) for tk, df in data.items()}
    exits = {tk: evaluate(base["exit"], df) if base["exit"] else None for tk, df in data.items()}
    rows = []
    for sv, mh, tr, pv in combos:
        spec = dict(base, stop_value=sv, max_hold=mh, target_r=tr if st != "none" else None)
        tt = []
        for tk, df in data.items():
            oc = outcomes(df, spec, exits[tk])
            split = int(len(df) * 0.7)
            valid = oc["ret"].notna().to_numpy() & (np.arange(len(df)) >= 200)
            tt += _ticker_trades(tk, df, sigs[pv][tk], oc, split, valid)
        is_ = [t["ret"] for t in tt if not t["oos"]]
        oos = [t["ret"] for t in tt if t["oos"]]
        rows.append({"stop_value": sv, "max_hold": mh, "target_r": tr, "p": pv, "is_trades": len(is_),
                     "oos_trades": len(oos), "is_avg": float(np.mean(is_)) if is_ else None,
                     "oos_avg": float(np.mean(oos)) if oos else None})
    ok = [r for r in rows if r["is_avg"] is not None and r["oos_avg"] is not None and r["is_trades"] >= 20]
    if len(ok) < 3:
        raise UserError("Too few trades in most combinations to compare; add tickers or loosen the rule")
    is_rank = pd.Series([r["is_avg"] for r in ok]).rank(ascending=False)
    oos_rank = pd.Series([r["oos_avg"] for r in ok]).rank(ascending=False)
    for r, a, b in zip(ok, is_rank, oos_rank):
        r["is_rank"], r["oos_rank"] = int(a), int(b)
    best = min(ok, key=lambda r: r["is_rank"])
    rho = float(is_rank.corr(oos_rank)) if len(ok) > 2 else None
    median_oos = float(np.median([r["oos_avg"] for r in ok]))
    if rho is not None and rho > 0.5 and best["oos_avg"] > median_oos and best["oos_avg"] > 0:
        verdict = "ROBUST-ISH"
        text = (f"In-sample rank predicted out-of-sample rank fairly well (ρ={rho:.2f}), and the in-sample pick made "
                f"{best['oos_avg']:+.2%}/trade on new data (rank {best['oos_rank']} of {len(ok)}). Still run it through "
                "the backtest's random baseline before trusting it.")
    else:
        verdict = "OVERFIT RISK"
        text = (f"The best in-sample settings ranked {best['oos_rank']} of {len(ok)} on new data "
                f"({best['oos_avg']:+.2%}/trade vs median {median_oos:+.2%}); rank correlation ρ="
                f"{rho if rho is not None else float('nan'):.2f}. Picking the 'best' settings here mostly fits noise. "
                "Prefer simple, round settings.")
    return {"rows": sorted(rows, key=lambda r: (r.get("is_rank") or 999)), "best": best, "rho": rho,
            "median_oos": median_oos, "verdict": verdict, "verdict_text": text, "combos": len(combos),
            "skipped": skipped, "has_p": pvals != [None]}


def _curve(trades):
    """Cumulative R (or % when there's no stop) by exit date, in trade order."""
    pts, tot = [], 0.0
    for t in sorted(trades, key=lambda x: x["exit_date"]):
        tot += t["r"] if t["r"] is not None else t["ret"] * 100
        pts.append({"t": t["exit_date"], "v": round(tot, 3), "oos": t["oos"]})
    return pts


def signals_today(spec: dict) -> list[tuple[str, str]]:
    """(ticker, date) for tickers whose entry rule was true on their last COMPLETED session."""
    hits = []
    for tk in spec["tickers"]:
        try:
            df = market.completed(market.history(tk), tk)
            if evaluate(spec["entry"], df).iat[-1]:
                hits.append((tk, df.index[-1].strftime("%Y-%m-%d")))
        except Exception as e:
            log.info("signal %s: %s", tk, e)
    return hits


def check_signals(fire) -> None:
    for s in db.rows("SELECT * FROM strategies WHERE alert = 1"):
        spec = json.loads(s["spec_json"])
        for tk, day in signals_today(spec):
            fire(f"strat:{s['id']}:{tk}:{day}", tk, "strategy", f"{tk}: '{s['name']}' signal",
                 f"Your saved rule fired on the {day} close: {spec['entry']}. Run a pre-trade check before buying.",
                 ["test_tube"])


# ---------- HTTP ----------
def register(app) -> None:
    @app.get("/api/lab/meta")
    def api_lab_meta():
        return jsonify({"presets": PRESETS, "help": HELP, "series": SERIES, "default_tickers": DEFAULT_TICKERS})

    @app.post("/api/lab/backtest")
    def api_lab_backtest():
        return jsonify(backtest(request.get_json(silent=True) or {}))

    @app.post("/api/lab/optimize")
    def api_lab_optimize():
        return jsonify(optimize(request.get_json(silent=True) or {}))

    @app.post("/api/lab/compare")
    def api_lab_compare():
        ids = [int(i) for i in (request.get_json(silent=True) or {}).get("ids", [])][:6]
        out = []
        for sid in ids:
            s = db.one("SELECT * FROM strategies WHERE id = ?", (sid,))
            if not s:
                continue
            r = backtest(json.loads(s["spec_json"]), n_random=200)
            out.append({"id": sid, "name": s["name"], "verdict": r["verdict"], "all": r["all"],
                        "out_of_sample": r["out_of_sample"], "curve": r["curve"],
                        "sim": {k: v for k, v in r["sim"].items() if k != "curve"}, "sim_curve": r["sim"].get("curve")})
        return jsonify(out)

    @app.get("/api/lab/strategies")
    def api_lab_list():
        out = []
        for s in db.rows("SELECT * FROM strategies ORDER BY id DESC"):
            r = json.loads(s["result_json"] or "{}")
            out.append({"id": s["id"], "name": s["name"], "alert": s["alert"], "created_at": s["created_at"],
                        "spec": json.loads(s["spec_json"]), "verdict": r.get("verdict"),
                        "oos": r.get("out_of_sample")})
        return jsonify(out)

    @app.post("/api/lab/strategies")
    def api_lab_save():
        d = request.get_json(silent=True) or {}
        spec = _spec(d)
        if not spec["name"]:
            raise UserError("Give the strategy a name")
        res = d.get("result") or {}
        keep = {k: res.get(k) for k in ("verdict", "verdict_text", "all", "in_sample", "out_of_sample", "curve")}
        if res.get("sim"):
            keep["sim"] = {k: v for k, v in res["sim"].items() if k != "curve"}
        sid = db.execute("INSERT INTO strategies(name, spec_json, result_json, alert, created_at) VALUES (?,?,?,?,?)",
                         (spec["name"], json.dumps(spec), json.dumps(keep, default=float), int(bool(d.get("alert"))),
                          db.now()))
        return jsonify({"id": sid})

    @app.patch("/api/lab/strategies/<int:sid>")
    def api_lab_patch(sid):
        d = request.get_json(silent=True) or {}
        if "alert" in d:
            db.execute("UPDATE strategies SET alert = ? WHERE id = ?", (int(bool(d["alert"])), sid))
        return jsonify({"ok": True})

    @app.delete("/api/lab/strategies/<int:sid>")
    def api_lab_del(sid):
        db.execute("DELETE FROM strategies WHERE id = ?", (sid,))
        return jsonify({"ok": True})

    @app.get("/api/lab/strategies/<int:sid>/signals")
    def api_lab_signals(sid):
        s = db.one("SELECT * FROM strategies WHERE id = ?", (sid,))
        if not s:
            raise UserError("No such strategy")
        return jsonify([t for t, _ in signals_today(json.loads(s["spec_json"]))])
