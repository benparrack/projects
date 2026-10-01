import datetime as dt

import numpy as np
import pandas as pd
import pytest

from cockpit import lab, market
from cockpit.service import UserError
from conftest import make_df


@pytest.mark.parametrize("rule", ["__import__('os').system('x')", "close.__class__", "open('f')", "[c for c in close]",
                                  "lambda: 1", "sma(close, 99999) > 1", "close > 'a'", "x > 1", "sma(close, n=5) > 1"])
def test_dsl_rejects_unsafe_or_invalid(rule):
    df = make_df(np.linspace(100, 200, 300))
    with pytest.raises(UserError):
        lab.evaluate(rule, df)


def test_dsl_basic_and_no_lookahead():
    df = make_df(np.r_[np.full(50, 100.0), np.full(10, 120.0)])
    sig = lab.evaluate("close > highest(high, 20)", df)
    assert sig.iloc[50] and not sig.iloc[49]
    # Changing the future must not change past signals.
    df2 = df.copy()
    df2.iloc[55:, df2.columns.get_loc("Close")] = 1.0
    assert lab.evaluate("rsi(2) < 30 or close > sma(close, 5)", df2).iloc[:55].equals(
        lab.evaluate("rsi(2) < 30 or close > sma(close, 5)", df).iloc[:55])


def test_outcomes_stop_gap_fills_at_open():
    df = make_df([100, 100, 100, 100], spread=0.0)
    df.loc[df.index[2], ["Open", "High", "Low", "Close"]] = [80, 82, 79, 81]  # gap far below the stop
    spec = {"stop_type": "pct", "stop_value": 5, "target_r": None, "max_hold": 10, "cost_bps": 0}
    oc = lab.outcomes(df, spec, None)
    assert oc["why"].iat[1] == "stop" and oc["ret"].iat[1] == pytest.approx(-0.20)


def test_backtest_runs_offline(fake_market, fresh_db):
    r = lab.backtest({"entry": "rsi(2) < 20", "exit": "close > sma(close, 5)", "stop_type": "atr", "stop_value": 2,
                      "max_hold": 10, "tickers": "AAA BBB"}, n_random=50)
    assert r["verdict"] in ("EDGE", "NO EDGE", "TOO FEW TRADES")
    assert r["all"]["trades"] == r["in_sample"]["trades"] + r["out_of_sample"]["trades"]
    for t in r["trades"]:
        assert t["entry_date"] <= t["exit_date"]


def test_completed_drops_live_bar():
    df = make_df([1, 2, 3], start="2026-09-29")  # Tue, Wed, Thu 2026-10-01
    during = dt.datetime(2026, 10, 1, 15, 0, tzinfo=dt.timezone.utc)  # 11:00 New York
    after = dt.datetime(2026, 10, 1, 21, 0, tzinfo=dt.timezone.utc)
    assert len(market.completed(df, "TSLA", during)) == 2
    assert len(market.completed(df, "TSLA", after)) == 3


def test_alert_dedupe_and_paper_auto_exit(fake_market, fresh_db, monkeypatch):
    from cockpit import alerts, notify, service
    sent = []
    monkeypatch.setattr(notify, "send", lambda *a, **k: sent.append(a) or True)
    assert alerts.fire("k1", "AAA", "x", "t", "m")
    assert not alerts.fire("k1", "AAA", "x", "t", "m")
    assert len(sent) == 1
    fake_market["prices"]["AAA"] = 100.0
    pid = service.save_plan(1, {"ticker": "AAA", "entry": 100, "stop": 95, "target": 110, "hold_days": 10})
    service.record_trade(pid, "buy")
    fake_market["prices"]["AAA"] = 94.0
    alerts.check_plans()
    p = service.plan(pid)
    assert p["status"] == "closed" and p["exit_reason"] == "hit stop"
    alerts.check_plans()  # no second sell, no second alert
    assert len([s for s in sent if "stop" in s[1]]) == 1


def test_form4_parser():
    xml = """<ownershipDocument><reportingOwner><reportingOwnerId><rptOwnerName>DOE JANE</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship><isDirector>1</isDirector></reportingOwnerRelationship></reportingOwner>
    <nonDerivativeTable>
     <nonDerivativeTransaction><transactionDate><value>2026-09-01</value></transactionDate>
      <transactionCoding><transactionCode>P</transactionCode></transactionCoding>
      <transactionAmounts><transactionShares><value>1000</value></transactionShares>
      <transactionPricePerShare><value>12.5</value></transactionPricePerShare></transactionAmounts></nonDerivativeTransaction>
     <nonDerivativeTransaction><transactionCoding><transactionCode>S</transactionCode></transactionCoding>
      <transactionAmounts><transactionShares><value>5</value></transactionShares></transactionAmounts></nonDerivativeTransaction>
    </nonDerivativeTable></ownershipDocument>"""
    from cockpit import alerts
    b = alerts.parse_form4(xml)
    assert len(b) == 1 and b[0]["value"] == 12500 and b[0]["owner"] == "Doe Jane" and b[0]["role"] == "Director"
