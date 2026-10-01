"""Honest scoring: AUC vs coin flip, calibration, and a cost-aware backtest vs buy-and-hold."""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score


def auc_with_p(y: np.ndarray, p: np.ndarray) -> tuple[float, float]:
    """AUC and one-sided p-value (Mann-Whitney normal approx) that AUC > 0.5."""
    y = np.asarray(y).astype(int)
    n1, n0 = int(y.sum()), int(len(y) - y.sum())
    if n1 == 0 or n0 == 0:
        return float("nan"), float("nan")
    auc = roc_auc_score(y, p)
    se = math.sqrt((n1 + n0 + 1) / (12 * n1 * n0))
    z = (auc - 0.5) / se
    return float(auc), float(0.5 * math.erfc(z / math.sqrt(2)))


def non_overlapping(oos: pd.DataFrame, horizon: int) -> pd.DataFrame:
    """Keep every `horizon`-th date so forward-return labels don't overlap (fair significance tests)."""
    dates = np.array(sorted(oos["date"].unique()))
    keep = set(dates[::horizon])
    return oos[oos["date"].isin(keep) & oos["target"].notna()]


def quintile_returns(fair: pd.DataFrame) -> pd.Series:
    """Average simple forward return for each fifth of predictions, lowest P(up) first."""
    q = pd.qcut(fair["prob"], 5, labels=False, duplicates="drop")
    return fair.groupby(q)["fwd_ret"].mean().map(np.expm1)


def calibration(oos: pd.DataFrame, bins: int = 8) -> pd.DataFrame:
    d = oos.dropna(subset=["target"]).copy()
    d["bin"] = pd.qcut(d["prob"], bins, duplicates="drop")
    g = d.groupby("bin", observed=True)
    cal = pd.DataFrame({
        "p_lo": g["prob"].min(), "p_hi": g["prob"].max(), "p_mean": g["prob"].mean(),
        "hit_rate": g["target"].mean(), "avg_fwd_ret": g["fwd_ret"].mean().map(np.expm1),
        "n": g.size(),
    }).reset_index(drop=True)
    return cal


def expected_from_calibration(cal: pd.DataFrame, prob: float) -> tuple[float, float]:
    """(historical hit rate, avg forward return) for the calibration bin `prob` falls in."""
    i = int(np.clip(np.searchsorted(cal["p_hi"].to_numpy(), prob), 0, len(cal) - 1))
    return float(cal["hit_rate"].iloc[i]), float(cal["avg_fwd_ret"].iloc[i])


def positions(prob: pd.Series, enter: float, exit_: float) -> pd.Series:
    """Long/flat with hysteresis: go long when prob >= enter, go flat when prob < exit_."""
    pos, cur = np.zeros(len(prob)), 0.0
    for i, p in enumerate(prob.to_numpy()):
        if cur == 0 and p >= enter:
            cur = 1.0
        elif cur == 1 and p < exit_:
            cur = 0.0
        pos[i] = cur
    return pd.Series(pos, index=prob.index)


def _stats(daily: pd.Series) -> dict:
    eq = (1 + daily).cumprod()
    yrs = len(daily) / 252
    total = float(eq.iloc[-1] - 1) if len(eq) else 0.0
    sd = daily.std()
    return {
        "total_ret": total,
        "cagr": float(eq.iloc[-1] ** (1 / yrs) - 1) if yrs > 0 and eq.iloc[-1] > 0 else float("nan"),
        "sharpe": float(daily.mean() / sd * np.sqrt(252)) if sd > 0 else 0.0,
        "max_dd": float((eq / eq.cummax() - 1).min()) if len(eq) else 0.0,
    }


def backtest(t_oos: pd.DataFrame, enter: float, exit_: float, cost_bps: float = 10,
             n_perm: int = 500, seed: int = 0) -> dict:
    """Decision at close t, held over t -> t+1. `cost_bps` charged per side on every position change."""
    d = t_oos.sort_values("date").dropna(subset=["next_ret"]).reset_index(drop=True)
    asset = np.expm1(d["next_ret"])
    pos = positions(d["prob"], enter, exit_)
    turns = pos.diff().abs().fillna(pos.iloc[0] if len(pos) else 0)
    cost = cost_bps / 1e4
    strat = pos * asset - turns * cost
    bh = asset.copy()
    if len(bh):
        bh.iloc[0] -= cost
    s, b = _stats(strat), _stats(bh)

    # Permutation check: is the timing better than the same position pattern
    # slid to a random point in time? Circular shifts keep trade count and exposure.
    rng = np.random.default_rng(seed)
    beat = 0
    pa = pos.to_numpy()
    if len(pa) > 20 and 0 < pa.mean() < 1:
        a = asset.to_numpy()
        actual = np.sum(np.log1p(pa * a))
        for _ in range(n_perm):
            k = rng.integers(10, len(pa) - 10)
            if np.sum(np.log1p(np.roll(pa, k) * a)) >= actual:
                beat += 1
        perm_p = (beat + 1) / (n_perm + 1)
    else:
        perm_p = float("nan")

    entries = np.flatnonzero((pos.diff().fillna(pos.iloc[0]) == 1).to_numpy()) if len(pos) else []
    return {
        "start": d["date"].iloc[0] if len(d) else None, "end": d["date"].iloc[-1] if len(d) else None,
        "strategy": s, "buy_hold": b, "exposure": float(pos.mean()) if len(pos) else 0.0,
        "trades": int(len(entries)), "perm_p": perm_p,
        "equity": pd.DataFrame({"date": d["date"], "strategy": (1 + strat).cumprod(),
                                "buy_hold": (1 + bh).cumprod(), "pos": pos}),
    }
