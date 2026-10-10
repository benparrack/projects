import json
import unittest
from datetime import date, timedelta

import numpy as np

from ct import crypto, db, stocks
from ct.timeutil import day_t, end_of_day_et

DAY = 86400
D0 = date(2024, 1, 1)


def make_db(series):
    """series: {sym: [close per day from D0]} on a 7-day calendar (fine for tests)."""
    con = db.connect(":memory:")
    n = len(next(iter(series.values())))
    for sym, cl in {"SPY": [100.0] * n, **series}.items():
        con.executemany("INSERT INTO bars VALUES(?,?,?,?,?,?,?)",
                        [(sym, "1d", day_t(D0 + timedelta(days=i)), c, c, c, c) for i, c in enumerate(cl)])
    return con


def add_filing(con, src, doc, leader, d, txns):
    con.execute("INSERT INTO filings VALUES(?,?,?,?,?)",
                (src, doc, leader, end_of_day_et(d), json.dumps({"txns": txns})))


def txn(tk, side, amount, d):
    return {"ticker": tk, "side": side, "amount": amount, "txn_date": d.isoformat(), "asset": tk}


class TestStocks(unittest.TestCase):
    def setUp(self):
        self.con = make_db({"A": [10.0] * 10 + [20.0] * 10, "B": [50.0] * 20})
        self.pm = stocks.PriceMatrix(self.con, {"SPY", "A", "B"}, D0)

    def test_price_matrix_no_lookahead(self):
        t = end_of_day_et(D0 + timedelta(days=9))   # after day 9's close: day 9 is the latest final close
        self.assertEqual(self.pm.k(t), 9)
        self.assertEqual(self.pm.k(day_t(D0 + timedelta(days=10)) + 3600), 9)   # day 10 not closed yet

    def test_member_book(self):
        d = D0 + timedelta(days=1)
        add_filing(self.con, "house", "1", "H:X", d, [txn("A", "buy", 1000, d), txn("B", "buy", 1000, d)])
        d2 = D0 + timedelta(days=12)
        add_filing(self.con, "house", "2", "H:X", d2, [txn("A", "sell_partial", 1000, d2)])   # 50 shares at $20
        add_filing(self.con, "house", "3", "H:X", d2 + timedelta(days=1), [txn("B", "sell_full", 1, d2)])
        per, combined, times = stocks.congress_events(self.con, self.pm)
        ev = per["H:X"]
        self.assertAlmostEqual(ev[0][1]["A"], 0.5)
        self.assertAlmostEqual(ev[1][1]["A"], 1000 / 2000)     # 100->50 shares at $20 = $1000, B $1000
        self.assertEqual(set(ev[2][1]), {"A"})
        self.assertEqual(len(combined), 3)
        self.assertEqual(len(times["H:X"]), 4)

    def test_leader_index_and_trailing_pick(self):
        events = {"winner": [(end_of_day_et(D0), {"A": 1.0}, {})], "loser": [(end_of_day_et(D0), {"B": 1.0}, {})]}
        idx = stocks.leader_index(events["winner"], self.pm)
        self.assertAlmostEqual(idx[-1] / idx[1], 2.0)
        ev, picks = stocks.trailing_events(events, self.pm, D0 + timedelta(days=15), D0 + timedelta(days=19), 1, 14,
                                           lambda l, t: True)
        self.assertEqual(picks[0]["leaders"][0][0], "winner")
        self.assertEqual(ev[0][1], {"A": 1.0})

    def test_basket_averages_latest(self):
        f = {"f1": [(1, {"A": 1.0}, {})], "f2": [(2, {"B": 1.0}, {}), (3, {"A": 0.5, "B": 0.5}, {})]}
        ev = stocks.basket_events(f, 0)
        self.assertEqual(ev[-1][1], {"A": 0.75, "B": 0.25})


class TestCrypto(unittest.TestCase):
    def leader(self):
        port = {"allTime": {"av": [(0, 100000), (100 * DAY, 150000)], "pnl": [(0, 0), (100 * DAY, 50000)]}}
        fills = [(10 * DAY, "BTC", 1.0), (20 * DAY, "BTC", -0.5), (30 * DAY, "ETH", -2.0)]
        return crypto.HistLeader("u", 100 * DAY, {"BTC": 0.5, "ETH": -2.0}, fills, 5 * DAY, port)

    def test_reconstruct_positions_backwards(self):
        l = self.leader()
        self.assertEqual(l.positions(5 * DAY), {})
        self.assertEqual(l.positions(15 * DAY), {"BTC": 1.0})
        self.assertEqual(l.positions(25 * DAY), {"BTC": 0.5})
        self.assertEqual(l.positions(40 * DAY), {"BTC": 0.5, "ETH": -2.0})
        self.assertAlmostEqual(l.av(50 * DAY), 125000)
        self.assertFalse(l.covered(1 * DAY))

    def test_select_rules(self):
        hcfg = {"min_account_value": 100000, "max_fills_30d": 2000}
        l = self.leader()
        self.assertEqual([u for u, _ in crypto.select({"u": l}, 40 * DAY, "roi30", 5, hcfg)], ["u"])
        self.assertEqual(crypto.select({"u": l}, 80 * DAY, "roi30", 5, hcfg), [])     # no fills in last 30d

    def test_copy_target_sizing_and_gross_cap(self):
        times = np.array([40 * DAY])
        bars = {"BTC": np.full((4, 1), 100000.0), "ETH": np.full((4, 1), 5000.0)}
        l = self.leader()
        av = l.av(40 * DAY - 60)
        w, _ = crypto.CopyTarget(times, bars, [(0, ["u"])], {"u": l}, 60, 10)(0)
        self.assertAlmostEqual(w["BTC"], 0.5 * 100000 / av)
        self.assertAlmostEqual(w["ETH"], -2 * 5000 / av)
        w, _ = crypto.CopyTarget(times, bars, [(0, ["u"])], {"u": l}, 60, 0.2)(0)
        self.assertAlmostEqual(sum(abs(x) for x in w.values()), 0.2)


if __name__ == "__main__":
    unittest.main()
