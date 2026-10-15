import numpy as np
import pandas as pd

from conftest import make_df


def _spec(sid, family="rsi2"):
    return {"id": sid, "family": family, "name": sid, "entry": "close < sma(5)", "exit": "", "stop_type": "none",
            "stop_value": None, "target_r": None, "max_hold": 5}


def test_clustered_z_counts_same_day_trades_once():
    from cockpit.evolve import _stats
    rng = np.random.default_rng(1)
    shock = rng.normal(0, 0.02, 5)                  # the whole market moves on each of 5 days
    days = [i % 5 for i in range(200)]
    rets = [0.01 + shock[d] + rng.normal(0, 0.005) for d in days]
    naive = _stats(rets, (0.0, 1), list(range(200)))
    bunched = _stats(rets, (0.0, 1), days)
    assert naive["z"] > 3 * abs(bunched["z"])      # 5 days of trades is weak evidence however many trades
    assert naive["excess"] == bunched["excess"] and naive["days"] == 200 and bunched["days"] == 5


def test_deal_balances_segments():
    from cockpit.evolve import _deal
    tickers = [(f"L{i}", "large") for i in range(60)] + [(f"S{i}", "small") for i in range(30)]
    cohorts = _deal(tickers, 6, seed=3)
    assert sorted(t for c in cohorts for t in c) == sorted(t for t, _ in tickers)
    assert all(sum(t.startswith("S") for t in c) == 5 for c in cohorts)
    assert _deal(tickers, 6, seed=3) == cohorts


def test_selection_keeps_edge_and_kills_losers_and_starved():
    from cockpit.evolve import select, _exit_key
    specs = [_spec("good-01"), _spec("bad-01"), _spec("rare-01"), _spec("coin-01", "placebo")]
    rng = np.random.default_rng(0)
    scans, segs = [], {}
    days = pd.bdate_range("2025-11-01", periods=200).strftime("%Y-%m-%d")
    for k in range(60):
        tk = f"T{k}"
        segs[tk] = "large" if k % 3 else "small"
        trades = []
        for d in rng.choice(len(days), 12, replace=False):
            trades.append((0, "cur", days[d], days[d], 0.02 + rng.normal(0, 0.01), 3, "time"))
            trades.append((1, "cur", days[d], days[d], -0.01 + rng.normal(0, 0.01), 3, "time"))
            trades.append((3, "cur", days[d], days[d], rng.normal(0, 0.01), 3, "time"))
            trades.append((0, "prior", days[d], days[d], 0.01, 3, "time"))
        if k % 20 == 0:
            trades.append((2, "cur", days[0], days[1], 0.05, 2, "time"))
        scans.append({"ticker": tk, "trades": trades, "signals": [], "last": days[-1], "bars": 700, "close": 1.0,
                      "base": {_exit_key(specs[0]): {"cur": [0.0, 100], "prior": [0.0, 100]}}})
    res = select(scans, specs, segs, {"generations": 3, "cull": 0.0, "min_trades": 5, "seed": 1})
    fate = {r["id"]: r["fate"] for r in res["strategies"]}
    assert fate["good-01"]["status"] == "finalist" and fate["good-01"]["prior_ok"]
    assert fate["bad-01"] == {"status": "dead", "gen": 1, "cause": "lost money"}
    assert fate["rare-01"]["cause"] == "starved"
    assert res["summary"]["strategies"] == 3 and res["summary"]["placebos"] == 1
    good = next(r for r in res["strategies"] if r["id"] == "good-01")
    assert good["sim"]["trades"] > 0 and good["holdout"]["n"] >= 5


def test_scan_ticker_enters_next_open_one_position_at_a_time(fake_market):
    from cockpit import evolve
    spec = {**_spec("t-01"), "entry": "close > 0", "max_hold": 3}  # fires every day
    r = evolve.scan_ticker("AAA", [spec])
    cur = [t for t in r["trades"] if t[1] == "cur"]
    assert cur and all(t[5] <= 3 for t in cur)
    ends = [(t[2], t[3]) for t in sorted(cur, key=lambda t: t[2])]
    assert all(b[0] > a[1] for a, b in zip(ends, ends[1:]))   # never two open at once
    assert r["signals"] == [0]
    live = evolve.scan_ticker("AAA", [spec], since=cur[-5][2])
    assert live["trades"] and all(t[1] == "live" and t[2] > cur[-5][2] for t in live["trades"])


def test_live_gates():
    from cockpit.evolve import live_status
    base = {"n": 30, "mean": 0.01, "base": 0.002, "excess": 0.008, "z": 2.0}
    assert live_status(base, 25)[0] == "graduated"
    assert live_status({**base, "z": 1.0}, 25)[0] == "on trial"
    assert live_status({**base, "mean": -0.001, "excess": -0.003}, 25)[0] == "eliminated"
    assert live_status({**base, "n": 5, "mean": -0.01, "excess": -0.01}, 3)[0] == "on trial"


def test_new_indicators():
    from cockpit import lab
    c = 100 + np.cumsum(np.random.default_rng(2).normal(0, 1, 300))
    df = make_df(c)
    ibs = lab.evaluate("ibs()", df).dropna()
    assert ((ibs >= 0) & (ibs <= 1)).all()
    st = lab._streak(pd.Series([1, 2, 3, 2, 1, 1, 2.0]))
    assert list(st) == [0, 1, 2, -1, -2, 0, 1]
    for rule in ("macd_hist(12, 26, 9) > 0", "adx(14) > 20", "willr(10) < -80", "cci(20) < -100", "mfi(14) < 20",
                 "stoch(14) < 20", "days_left() <= 2", "coin(3)", "obv() > sma(obv(), 20)"):
        lab.evaluate(rule, df)
    assert lab.evaluate("coin(1)", df).equals(lab.evaluate("coin(1)", df))
