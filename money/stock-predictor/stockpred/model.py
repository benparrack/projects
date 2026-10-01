"""Pooled walk-forward training: never trains on anything a real trader wouldn't have known yet."""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier

from .features import feature_cols


def make_model(seed: int = 0) -> HistGradientBoostingClassifier:
    # Heavily regularized on purpose: daily stock data is mostly noise, and a
    # flexible model will happily memorize it.
    return HistGradientBoostingClassifier(
        max_iter=150, learning_rate=0.04, max_leaf_nodes=15, min_samples_leaf=300,
        l2_regularization=2.0, max_features=0.6, random_state=seed,
    )


def make_panel(frames: dict[str, pd.DataFrame]) -> pd.DataFrame:
    parts = []
    for t, f in frames.items():
        p = f.copy()
        p["ticker"] = t
        p.index.name = "date"
        parts.append(p.reset_index())
    panel = pd.concat(parts, ignore_index=True).sort_values(["date", "ticker"]).reset_index(drop=True)
    panel["target"] = np.where(panel["fwd_ret"].notna(), (panel["fwd_ret"] > 0).astype(float), np.nan)
    return panel


def walk_forward(panel: pd.DataFrame, horizon: int, retrain_every: int = 63,
                 min_train_days: int = 504, model_fn=make_model, log=print) -> pd.DataFrame:
    """Out-of-sample probabilities for every row after the first `min_train_days` dates.

    The model for test block starting at date index i is trained only on rows
    whose label was fully known by then: date index <= i - horizon.
    """
    cols = feature_cols(panel)
    dates = np.array(sorted(panel["date"].unique()))
    didx = pd.Series(np.arange(len(dates)), index=dates)
    row_di = panel["date"].map(didx).to_numpy()
    probs = np.full(len(panel), np.nan)
    starts = list(range(min_train_days, len(dates), retrain_every))
    for k, s in enumerate(starts):
        e = min(s + retrain_every, len(dates))
        train = (row_di <= s - horizon) & panel["target"].notna().to_numpy()
        test = (row_di >= s) & (row_di < e)
        if train.sum() < 1000 or test.sum() == 0:
            continue
        m = model_fn(k)
        m.fit(panel.loc[train, cols], panel.loc[train, "target"].astype(int))
        probs[test] = m.predict_proba(panel.loc[test, cols])[:, 1]
        if log and (k % 8 == 0 or k == len(starts) - 1):
            log(f"  walk-forward block {k + 1}/{len(starts)}: trained on {train.sum():,} rows "
                f"up to {pd.Timestamp(dates[s - horizon]).date()}")
    out = panel[["date", "ticker", "fwd_ret", "next_ret", "close", "target"]].copy()
    out["prob"] = probs
    return out.dropna(subset=["prob"]).reset_index(drop=True)


def fit_final(panel: pd.DataFrame, model_fn=make_model):
    cols = feature_cols(panel)
    lab = panel["target"].notna()
    m = model_fn(999)
    m.fit(panel.loc[lab, cols], panel.loc[lab, "target"].astype(int))
    return m, cols


def latest_probs(panel: pd.DataFrame, model, cols) -> pd.DataFrame:
    last = panel.sort_values("date").groupby("ticker").tail(1).copy()
    last["prob"] = model.predict_proba(last[cols])[:, 1]
    return last.set_index("ticker")
