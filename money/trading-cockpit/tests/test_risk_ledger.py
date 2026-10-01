import numpy as np
import pytest

from cockpit import ledger, risk
from conftest import make_df


def test_size_by_risk_and_caps():
    s = risk.size_position(10_000, 10_000, entry=100, stop=95, fx=1, risk_pct=0.01, max_pos_pct=1, fractional=False)
    assert s["shares"] == 20 and s["limited_by"] == "risk" and s["risk_usd"] == pytest.approx(100)
    s = risk.size_position(10_000, 10_000, entry=100, stop=99, fx=1, risk_pct=0.01, max_pos_pct=0.25, fractional=False)
    assert s["shares"] == 25 and s["limited_by"] == "max position size"
    s = risk.size_position(10_000, 500, entry=100, stop=95, fx=1, risk_pct=0.01, max_pos_pct=1, fractional=True)
    assert s["cost_usd"] <= 500 + 1e-9
    # Foreign currency: a SEK stock at 0.1 USD/SEK risks 10x less per share in USD.
    s = risk.size_position(10_000, 10_000, entry=1000, stop=950, fx=0.1, risk_pct=0.01, max_pos_pct=1, fractional=False)
    assert s["risk_usd"] == pytest.approx(100)


def test_first_touch_counts_stop_when_both_hit_same_day():
    df = make_df([100] * 120, spread=0.2)  # every day spans -20%..+20%
    ft = risk.first_touch(df, stop_pct=0.05, target_pct=0.05, hold_days=5, lookback=100)
    assert ft["stop_first"] == 1.0 and ft["target_first"] == 0.0


def T(id, side, qty, price, ts, ticker="AAA", fx=1.0, fees=0.0, plan_id=1):
    return {"id": id, "side": side, "qty": qty, "price": price, "ts": ts, "ticker": ticker, "fx": fx, "fees": fees,
            "currency": "USD", "plan_id": plan_id}


def test_fifo_terms_and_oversell():
    tr = [T(1, "buy", 10, 10, "2024-01-01T00:00:00"), T(2, "buy", 10, 20, "2025-06-01T00:00:00"),
          T(3, "sell", 15, 30, "2025-06-10T00:00:00")]
    lots, real = ledger.fifo(tr)
    assert [r["term"] for r in real] == ["long", "short"]
    assert real[0]["gain"] == pytest.approx(200) and real[1]["gain"] == pytest.approx(50)
    assert lots["AAA"][0]["qty"] == pytest.approx(5)
    with pytest.raises(ValueError):
        ledger.fifo(tr + [T(4, "sell", 6, 30, "2025-06-11T00:00:00")])


def test_wash_sale_flags_rebuy_but_not_lots_sold_together():
    tr = [T(1, "buy", 10, 50, "2025-01-01T00:00:00"), T(2, "sell", 10, 40, "2025-02-01T00:00:00"),
          T(3, "buy", 10, 41, "2025-02-15T00:00:00")]
    _, real = ledger.fifo(tr)
    real = ledger.flag_wash_sales(tr, real)
    assert real[0]["wash_sale"] and real[0]["wash_disallowed"] == pytest.approx(100)
    tr2 = [T(1, "buy", 5, 50, "2025-01-01T00:00:00"), T(2, "buy", 5, 50, "2025-01-20T00:00:00"),
           T(3, "sell", 10, 40, "2025-02-01T00:00:00")]
    _, real2 = ledger.fifo(tr2)
    assert not any(r["wash_sale"] for r in ledger.flag_wash_sales(tr2, real2))


def test_tax_netting_and_carryover():
    real = [{"close_ts": "2025-03-01T00:00:00", "gain": -5000, "term": "short", "wash_disallowed": 0},
            {"close_ts": "2025-04-01T00:00:00", "gain": 1000, "term": "long", "wash_disallowed": 0}]
    y = ledger.tax_summary(real, 0.22, 0.15)[0]
    assert y["net"] == -4000 and y["est_tax"] == 0 and y["deductible_loss"] == 3000 and y["carryover"] == 1000


def test_plan_results_r_multiple():
    plans = [{"id": 1, "ticker": "AAA", "stop": 90, "status": "closed", "hold_days": 10}]
    tr = [T(1, "buy", 10, 100, "2025-01-01T00:00:00"), T(2, "sell", 10, 120, "2025-01-11T00:00:00")]
    r = ledger.plan_results(plans, tr, {})[0]
    assert r["realized"] == pytest.approx(200) and r["r_multiple"] == pytest.approx(2.0)
    assert r["hold_days"] == 10 and r["hold_days_plan"] == 10
