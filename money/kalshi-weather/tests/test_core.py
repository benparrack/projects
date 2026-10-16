from datetime import date, datetime, timezone

import numpy as np
import pandas as pd

from kwx import backtest, dataset, live, stations
from kwx.model import TempModel, edges_f

NY = {"tz": "America/New_York", "standard_time": True, "unit": "F"}
LON = {"tz": "Europe/London", "standard_time": False, "unit": "C"}


def test_bracket_semantics():
    # "greater than 92" wins at 93+, "less than 85" at 84-, "between 86-87" at 86 and 87
    assert dataset.bracket("greater", 92, None) == (93, np.inf)
    assert dataset.bracket("less", None, 85) == (-np.inf, 84)
    assert dataset.bracket("between", 86, 87) == (86, 87)


def test_normalize_recovers_ticker_brackets():
    m = pd.DataFrame({"ticker": ["KXHIGHNY-25JAN16-B30.5", "HIGHNY-21AUG06-T86"], "strike_type": [None, None],
                      "floor": [np.nan, np.nan], "cap": [np.nan, np.nan]})
    n = dataset.normalize(m)
    assert len(n) == 1 and (n.iloc[0]["floor"], n.iloc[0]["cap"]) == (30.0, 31.0)


def test_fee_matches_kalshi_formula():
    # 10 contracts at 50c: ceil(0.07*10*0.25*100) = 18c -> 1.8c each; at 99c: ceil(0.0693) = 1c -> 0.1c each
    assert np.isclose(backtest.fee(0.5), 0.018)
    assert np.isclose(backtest.fee(0.99), 0.001)


def test_us_day_is_standard_time_all_year():
    # July: EDT is UTC-4 but the climate day starts at 00:00 EST = 05:00 UTC
    assert stations.day_start_utc(NY, date(2025, 7, 10)) == datetime(2025, 7, 10, 5, tzinfo=timezone.utc)
    assert stations.day_start_utc(LON, date(2025, 7, 10)) == datetime(2025, 7, 9, 23, tzinfo=timezone.utc)


def test_decisions_come_before_the_day_ends():
    d = date(2025, 7, 10)
    for dec in dataset.DECISIONS.values():
        t = stations.local_time_utc(NY, d, dec["hour"], dec["days_before"])
        assert t < stations.day_start_utc(NY, d) + pd.Timedelta(hours=10)


def test_quote_at_uses_only_past_candles():
    c = [[1000, 0.1, 0.2, None, 0], [4600, 0.3, 0.4, None, 0], [8200, 0.5, 0.6, None, 0]]
    assert dataset.quote_at(c, 5000) == (0.3, 0.4)
    assert dataset.quote_at(c, 999) is None


def test_bracket_probabilities_sum_to_one():
    m = TempModel()
    m.nu = 6
    q = pd.DataFrame({"lo": [-np.inf, 80, 82, 84, 86], "hi": [79, 81, 83, 85, np.inf], "unit": "F"})
    lo, hi = edges_f(q)
    p = m.prob(np.full(5, 83.2), np.full(5, 2.0), lo, hi)
    assert np.isclose(p.sum(), 1.0)
    qc = pd.DataFrame({"lo": [-np.inf, 26], "hi": [25, np.inf], "unit": "C"})
    lo, hi = edges_f(qc)
    assert np.isclose(m.prob(np.full(2, 78.0), np.full(2, 2.0), lo, hi).sum(), 1.0)


def test_trades_pick_best_side_and_net_fees():
    q = pd.DataFrame({"series": "S", "date": "2025-01-01", "decision": "day-of", "t": [1, 1],
                      "bid": [0.30, 0.60], "ask": [0.32, 0.62], "yes": [1, 0]})
    t = backtest.trades(q, np.array([0.50, 0.40]), 0.0)
    assert len(t) == 1  # one per event
    r = t.iloc[0]
    assert r["side"] == "NO" and np.isclose(r["price"], 0.40)  # NO at 1 - 0.60 is worth 0.60 - 0.40 = 0.20 > 0.18
    assert np.isclose(r["pnl"], 1 - 0.40 - backtest.fee(0.40))


def test_kelly_sizing_caps_and_zero():
    assert live.size(0.5, 0.6, 100) == 0
    assert live.size(0.99, 0.5, 100) == int(10 // 0.5)  # capped at 10% of bankroll


def test_obs_attach_uses_hours_before_the_decision():
    from kwx import obs, weather
    st = {"S": {**NY, "icao": "KNYC"}}
    d = date(2025, 7, 10)
    times = weather.now_times(st["S"], d, 1)  # 05:00-07:00 EDT = 09:00-11:00 UTC
    assert [t.hour for t in times] == [9, 10, 11]
    o = pd.DataFrame({"valid": pd.to_datetime(["2025-07-10 08:51", "2025-07-10 09:51", "2025-07-10 10:51",
                                               "2025-07-10 12:00"], utc=True), "tmpf": [70.0, 72.0, 74.0, 99.0]})
    ev = pd.DataFrame({"series": ["S"], "date": [d.isoformat()], "lead": [1]})
    got = obs.attach(ev, st, lambda icao: o)["obsnow"].iloc[0]
    assert np.isclose(got, 72.0)  # 08:51->09, 09:51->10, 10:51->11; the 12:00 reading is after the decision


def test_drop_outliers():
    f = pd.DataFrame({"a_max": [29.0, 50], "b_max": [27.0, 51], "c_max": [72.5, 49], "a_min": [20.0, 30], "fcnow": [30.0, 40]})
    g = dataset.drop_outliers(f)
    assert np.isnan(g.loc[0, "c_max"]) and g.loc[1, "c_max"] == 49 and g.loc[0, "a_min"] == 20


def test_live_windows_match_backtest_times():
    d = date(2026, 7, 10)
    at = lambda day, h: stations.local_time_utc(NY, day, h)
    assert live.decision_for(NY, "high", d, at(d, 8)) == "day-of"
    assert live.decision_for(NY, "high", d, at(d, 10)) is None  # market has seen the morning by now
    assert live.decision_for(NY, "low", d, at(d, 8)) is None
    assert live.decision_for(NY, "low", d, at(date(2026, 7, 9), 17)) is None
    assert live.decision_for(NY, "low", d, at(date(2026, 7, 9), 19)) == "evening-before"


def test_verdict_needs_recent_period_not_losing():
    good = {"n": 1000, "roi": 0.02, "p": 0.01}
    assert backtest.judge(good, {"n": 500, "roi": 0.01}) == "EDGE"
    assert backtest.judge(good, {"n": 500, "roi": -0.01}) == "MAYBE"
    assert backtest.judge(good, {"n": 20, "roi": -0.05}) == "EDGE"  # too few recent trades to judge
    assert backtest.judge({"n": 1000, "roi": -0.01, "p": 0.7}, {"n": 0, "roi": float("nan")}) == "NO EDGE"
