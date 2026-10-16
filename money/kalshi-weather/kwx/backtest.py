"""Walk-forward backtest and the edge verdict.

Every month is predicted by models trained only on days settled before it, and the blend layer is
trained only on earlier months' out-of-sample predictions. The trading threshold is chosen on the
first half of those months; the second half (the holdout) is never used for any choice and decides
the verdict.
"""
import numpy as np
import pandas as pd

from .model import Blend, MarketCal, TempModel, bracket_probs, mid

CONTRACTS = 10           # order size the fee is computed for (Kalshi rounds fees up per order)
MARGINS = (0.0, 0.02, 0.04, 0.06, 0.08, 0.10, 0.15)
MIN_TRAIN_DAYS = 90
MIN_MODEL_ROWS = 150
MIN_BLEND_ROWS = 1500
SOURCE_SWITCH = "2026-08-15"  # Kalshi settles on The Weather Company instead of the NWS climate report from about here
SETTLE_LAG = pd.Timedelta(days=2)  # a day's value is known the next morning; the earliest decision is 18:00 the day before


def fee(price):
    """Kalshi taker fee per contract for a CONTRACTS-lot order."""
    price = np.asarray(price, dtype=float)
    return np.ceil(np.round(7 * CONTRACTS * price * (1 - price), 9)) / 100 / CONTRACTS


def fit_models(events):
    ev = events[np.isfinite(events["value_f"])]
    models = {}
    for (kind, lead), g in ev.groupby(["kind", "lead"]):
        if len(g) >= MIN_MODEL_ROWS:
            models[(kind, lead)] = TempModel().fit(g, kind)
    return models


def walk_forward(events, quotes, progress=None):
    quotes = quotes.sort_values("t").reset_index(drop=True)
    quotes["month"] = quotes["date"].str[:7]
    settled = events[np.isfinite(events["value_f"])]
    first = pd.Timestamp(settled["date"].min())
    out = []
    for m in sorted(quotes["month"].unique()):
        cut = (pd.Timestamp(m + "-01") - SETTLE_LAG).date().isoformat()
        if (pd.Timestamp(cut) - first).days < MIN_TRAIN_DAYS:
            continue
        models = fit_models(events[events["date"] < cut])
        q = quotes[quotes["month"] == m].copy()
        q["p_model"] = bracket_probs(models, events, q)
        q = q[np.isfinite(q["p_model"])]
        q["p_blend"] = q["p_mcal"] = np.nan
        prior = pd.concat(out) if out else None
        for dec, g in q.groupby("decision"):
            if prior is None:
                continue
            hist = prior[(prior["decision"] == dec) & (prior["date"] < cut)]
            if len(hist) >= MIN_BLEND_ROWS:
                b = Blend().fit(hist["p_model"].to_numpy(), hist)
                q.loc[g.index, "p_blend"] = b.predict(g["p_model"].to_numpy(), g)
                q.loc[g.index, "p_mcal"] = MarketCal().fit(hist).predict(g)
        out.append(q)
        if progress:
            progress(m, len(q))
    return pd.concat(out, ignore_index=True)


def trades(df, p, margin, one_per_event=True, slip=0.0):
    """The trade we'd have taken on each quote row: buy YES at the ask or NO at (1 - bid), taker fees,
    when expected value per contract beats `margin`. Keeps the best one per event and decision."""
    ask, bid = df["ask"].to_numpy(), df["bid"].to_numpy()
    ok_yes = (ask > 0) & (ask < 1)
    ok_no = (bid > 0) & (bid < 1)
    ev_yes = np.where(ok_yes, p - ask - fee(ask), -np.inf)
    ev_no = np.where(ok_no, bid - p - fee(1 - bid), -np.inf)
    buy_yes = ev_yes >= ev_no
    ev = np.where(buy_yes, ev_yes, ev_no)
    price = np.where(buy_yes, ask, 1 - bid) + slip  # slip: fill this much worse than the quote
    won = np.where(buy_yes, df["yes"].to_numpy(), 1 - df["yes"].to_numpy())
    t = df.assign(side=np.where(buy_yes, "YES", "NO"), ev=ev, price=price, p_used=p,
                  cost=price + fee(price), won=won)
    t["pnl"] = t["won"] - t["cost"]
    t = t[t["ev"] > margin]
    if one_per_event and len(t):
        t = t.loc[t.groupby(["series", "date", "decision"])["ev"].idxmax()]
    return t.sort_values("t")


def bootstrap_p(t, reps=2000, seed=0):
    """P(ROI <= 0) from resampling whole dates (same-day trades share weather, so aren't independent)."""
    if len(t) < 10:
        return float("nan")
    g = t.groupby("date")[["pnl", "cost"]].sum().to_numpy()
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(g), size=(reps, len(g)))
    s = g[idx].sum(axis=1)
    return float(np.mean(s[:, 0] / s[:, 1] <= 0))


def summary(t):
    if len(t) == 0:
        return {"n": 0, "cost": 0.0, "pnl": 0.0, "roi": float("nan"), "win": float("nan"), "p": float("nan"), "days": 0}
    return {"n": len(t), "cost": float(t["cost"].sum()), "pnl": float(t["pnl"].sum()),
            "roi": float(t["pnl"].sum() / t["cost"].sum()), "win": float(t["won"].mean()),
            "p": bootstrap_p(t), "days": int(t["date"].nunique())}


def scores(df, p):
    y = df["yes"].to_numpy()
    p = np.clip(p, 1e-3, 1 - 1e-3)
    return {"logloss": float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p))),
            "brier": float(np.mean((p - y) ** 2))}


def judge(res, recent):
    """EDGE / MAYBE / NO EDGE from the holdout summary and its post-settlement-switch slice."""
    if res["n"] >= 100 and res["roi"] > 0 and res["p"] < 0.05 and not (recent["n"] >= 100 and recent["roi"] < 0):
        return "EDGE"
    if res["n"] >= 30 and res["roi"] > 0 and res["p"] < 0.25:
        return "MAYBE"
    return "NO EDGE"


def evaluate(oos):
    """Everything the report shows. Strategy = blend probability; model-only shown for comparison."""
    oos = oos[np.isfinite(oos["p_blend"])].copy()
    months = sorted(oos["month"].unique())
    half = months[len(months) // 2] if len(months) > 1 else months[0]
    val, hold = oos[oos["month"] < half], oos[oos["month"] >= half]

    grid = []
    for mg in MARGINS:
        grid.append({"margin": mg, **{f"val_{k}": v for k, v in summary(trades(val, val["p_blend"].to_numpy(), mg)).items()},
                     **{f"hold_{k}": v for k, v in summary(trades(hold, hold["p_blend"].to_numpy(), mg)).items()}})
    grid = pd.DataFrame(grid)
    margin = float(grid.loc[grid["val_pnl"].idxmax(), "margin"])

    held = trades(hold, hold["p_blend"].to_numpy(), margin)
    res = summary(held)
    model_only = summary(trades(hold, hold["p_model"].to_numpy(), margin))
    market_cal = summary(trades(hold, hold["p_mcal"].to_numpy(), margin))
    slipped = summary(trades(hold, hold["p_blend"].to_numpy(), margin, slip=0.01))
    # Favorite-longshot baseline: buy whichever side the market rates >= 85% (Bürgi/Deng/Whelan's pattern).
    fh = hold[(mid(hold) >= 0.85) | (mid(hold) <= 0.15)]
    fav = summary(trades(fh, np.where(mid(fh) >= 0.85, 1.0, 0.0), 0.0))

    sc = {}
    for dec, g in [("all", oos)] + list(oos.groupby("decision")):
        sc[dec] = {"market": scores(g, mid(g)), "market_cal": scores(g, g["p_mcal"].to_numpy()),
                   "model": scores(g, g["p_model"].to_numpy()),
                   "blend": scores(g, g["p_blend"].to_numpy()), "n": len(g)}

    seg = []
    for (dec, kind), g in held.assign(kind=np.where(held["series"].str.startswith("KXLOW"), "low", "high")).groupby(["decision", "kind"]):
        seg.append({"segment": f"{kind}s, {dec}", **summary(g)})
    by_city = pd.DataFrame([{"series": c, **summary(g)} for c, g in held.groupby("series")])

    recent = summary(held[held["date"] >= SOURCE_SWITCH])
    verdict = judge(res, recent)
    return {"verdict": verdict, "margin": margin, "holdout": res, "model_only": model_only, "favorites": fav,
            "market_cal": market_cal, "slipped": slipped, "recent": recent,
            "grid": grid, "scores": sc, "segments": pd.DataFrame(seg), "by_city": by_city, "trades": held,
            "val_range": (val["date"].min(), val["date"].max()), "hold_range": (hold["date"].min(), hold["date"].max())}


def final_models(events, oos):
    """Models for live use: temperature models on all settled days, blend on all out-of-sample rows."""
    models = fit_models(events)
    blends = {}
    for dec, g in oos.groupby("decision"):
        if len(g) >= MIN_BLEND_ROWS:
            blends[dec] = Blend().fit(g["p_model"].to_numpy(), g)
    return models, blends
