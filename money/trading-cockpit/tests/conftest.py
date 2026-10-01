import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture
def fresh_db(tmp_path, monkeypatch):
    from cockpit import db
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "t.sqlite")
    db.init()
    return db


def make_df(closes, start="2024-01-01", spread=0.01):
    idx = pd.bdate_range(start, periods=len(closes))
    c = pd.Series(closes, index=idx, dtype=float)
    o = c.shift(1).fillna(c.iloc[0])
    return pd.DataFrame({"Open": o, "High": np.maximum(o, c) * (1 + spread), "Low": np.minimum(o, c) * (1 - spread),
                         "Close": c, "Volume": 1_000_000.0})


@pytest.fixture
def fake_market(monkeypatch):
    """Offline market: random-walk history, quotes you can set per ticker."""
    from cockpit import market
    rng = np.random.default_rng(0)
    hists, prices = {}, {}

    def history(t, years=5, max_age_s=0):
        t = t.upper()
        if t not in hists:
            hists[t] = make_df(100 * np.exp(np.cumsum(rng.normal(0, 0.02, 800))), start="2023-06-01")
        return hists[t]

    def quote(t):
        t = t.upper()
        p = prices.get(t, float(history(t)["Close"].iloc[-1]))
        return {"ticker": t, "price": p, "prev_close": p, "currency": "USD", "change_pct": 0.0, "open": True, "ts": ""}

    monkeypatch.setattr(market, "history", history)
    monkeypatch.setattr(market, "quote", quote)
    monkeypatch.setattr(market, "fx", lambda c: 1.0)
    monkeypatch.setattr(market, "info", lambda t: {"sector": "Tech"})
    monkeypatch.setattr(market, "earnings", lambda t: {"next": None, "past": []})
    return {"hists": hists, "prices": prices}
