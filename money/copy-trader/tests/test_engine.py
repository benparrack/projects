import unittest

import numpy as np

from ct.engine import YEAR, Costs, PaperBroker, Portfolio, metrics, rebalance, simulate, tax_due

DAY = 86400


def bars_from(closes, opens=None):
    c = np.array(closes, dtype=float)
    o = np.array(opens if opens is not None else closes, dtype=float)
    return np.vstack([o, np.maximum(o, c), np.minimum(o, c), c])


class TestPortfolio(unittest.TestCase):
    def test_round_trip_gain_and_fees(self):
        pf = Portfolio(1000)
        pf.apply_fill(0, "X", 10, 50, 1.0)
        pf.apply_fill(DAY, "X", -10, 60, 1.0)
        self.assertAlmostEqual(pf.cash, 1000 - 501 + 599)
        self.assertEqual(len(pf.realized), 1)
        t, gain, lt = pf.realized[0]
        self.assertAlmostEqual(gain, 98.0)          # 100 price gain - 2 fees
        self.assertFalse(lt)
        self.assertEqual(pf.pos, {})

    def test_fifo_and_long_term(self):
        pf = Portfolio(10000)
        pf.apply_fill(0, "X", 10, 10, 0)
        pf.apply_fill(200 * DAY, "X", 10, 20, 0)
        pf.apply_fill(400 * DAY, "X", -15, 30, 0)   # closes lot 1 (LT) fully and 5 of lot 2 (ST)
        (_, g1, lt1), (_, g2, lt2) = pf.realized
        self.assertAlmostEqual(g1, 200)
        self.assertTrue(lt1)
        self.assertAlmostEqual(g2, 50)
        self.assertFalse(lt2)
        self.assertAlmostEqual(pf.pos["X"], 5)

    def test_short_flip(self):
        pf = Portfolio(1000)
        pf.apply_fill(0, "B", -2, 100, 0)            # short 2
        pf.apply_fill(10, "B", 3, 90, 0)             # cover 2 (+20) and go long 1
        self.assertAlmostEqual(pf.realized[0][1], 20)
        self.assertFalse(pf.realized[0][2])
        self.assertAlmostEqual(pf.pos["B"], 1)
        self.assertAlmostEqual(pf.value({"B": 90}), 1000 + 20)

    def test_funding_is_cash_and_taxable(self):
        pf = Portfolio(100)
        pf.charge_funding(5, 1.5)
        self.assertAlmostEqual(pf.cash, 98.5)
        self.assertAlmostEqual(pf.realized[0][1], -1.5)


class TestCosts(unittest.TestCase):
    def test_slippage_and_fee(self):
        pf = Portfolio(1000)
        b = PaperBroker(pf, Costs(fee_rate=0.001, slippage_bps=10))
        px, fee = b.submit(0, "X", 1, 100)
        self.assertAlmostEqual(px, 100.1)
        self.assertAlmostEqual(fee, 0.1001)
        px, _ = b.submit(1, "X", -1, 100)
        self.assertAlmostEqual(px, 99.9)

    def test_rebalance_threshold_and_cash_limit(self):
        pf = Portfolio(1000)
        b = PaperBroker(pf, Costs(slippage_bps=50))
        rebalance(b, pf, 0, {"A": 0.5, "B": 0.5}, {"A": 10, "B": 20}, Costs(slippage_bps=50, threshold=0.01), "x")
        self.assertGreaterEqual(pf.cash, -1e-9)                   # never borrows
        self.assertAlmostEqual(pf.pos["A"] * 10 / 1000, 0.5, places=2)
        n = len(pf.trades)
        rebalance(b, pf, 1, {"A": 0.501, "B": 0.499}, {"A": 10, "B": 20}, Costs(threshold=0.01), "x")
        self.assertEqual(len(pf.trades), n)                       # below threshold: no trades


class TestSimulate(unittest.TestCase):
    def test_no_lookahead_executes_at_next_open(self):
        times = np.array([0, 10, 20, 30])
        bars = {"X": bars_from([100, 200, 300, 300], opens=[100, 150, 250, 300])}
        events = {1: ({"X": 1.0}, "e")}                         # decision known at bar 1's open
        pf, eq = simulate(times, bars, lambda i: events.get(i), Costs(), 1000)
        self.assertEqual(pf.trades[0][0], 10)
        self.assertAlmostEqual(pf.trades[0][3], 150)             # bought at bar 1's open, not bar 0's
        self.assertAlmostEqual(eq[-1], 1000 / 150 * 300)

    def test_proportional_sizing(self):
        times = np.array([0])
        bars = {"A": bars_from([10]), "B": bars_from([40])}
        pf, _ = simulate(times, bars, lambda i: ({"A": 0.25, "B": 0.75}, "e"), Costs(min_trade=0), 1000)
        self.assertAlmostEqual(pf.pos["A"] * 10, 250)
        self.assertAlmostEqual(pf.pos["B"] * 40, 750)

    def test_funding_charged_on_longs(self):
        times = np.array([0, 3600])
        bars = {"X": bars_from([100, 100])}
        fund = {"X": np.array([0.001, 0.001])}
        pf, eq = simulate(times, bars, lambda i: ({"X": 1.0}, "e") if i == 0 else None, Costs(), 1000,
                          funding=fund, cash_only=False)
        self.assertAlmostEqual(pf.funding, 2.0)
        self.assertAlmostEqual(eq[-1], 998.0)

    def test_short_liquidation(self):
        times = np.array([0, 3600])
        b = bars_from([100, 100])
        b[1, 1] = 260                                             # wick far above: a 1x short is wiped out
        pf, eq = simulate(times, {"X": b}, lambda i: ({"X": -1.0}, "e") if i == 0 else None, Costs(), 1000,
                          maint={"X": 0.05}, cash_only=False)
        self.assertEqual(pf.liquidations, 1)
        self.assertEqual(pf.pos, {})
        self.assertLess(eq[-1], 0)

    def test_missing_open_keeps_position(self):
        times = np.array([0, 1, 2])
        b = bars_from([10, 11, 12])
        b[0, 1] = np.nan
        pf, eq = simulate(times, {"X": b}, lambda i: ({"X": 1.0}, "e") if i == 0 else ({}, "exit") if i == 1 else None,
                          Costs(min_trade=0), 100)
        self.assertIn("X", pf.pos)                                # couldn't trade at bar 1 (no open)


class TestTax(unittest.TestCase):
    def test_netting_and_carryforward(self):
        y1, y2 = 0, YEAR + 10 * DAY
        tax, per = tax_due([(y1, 1000, False), (y1, -400, True), (y2, -500, False), (y2, 300, True)], 0.3, 0.15)
        self.assertAlmostEqual(per[1970], 0.3 * 600)
        self.assertAlmostEqual(per[1971], 0.0)                    # -200 carried
        tax, per = tax_due([(y1, -500, False), (y2, 800, True)], 0.3, 0.15)
        self.assertAlmostEqual(per[1971], 0.15 * 300)

    def test_after_tax_metrics(self):
        pf = Portfolio(1000)
        pf.apply_fill(0, "X", 10, 100, 0)
        pf.apply_fill(DAY, "X", -10, 150, 0)
        pf.last_prices = {}
        m = metrics(np.array([0, DAY]), np.array([1000, 1500]), 1000, pf,
                    {"short_term_rate": 0.3, "long_term_rate": 0.15})
        self.assertAlmostEqual(m["tax"], 150)
        self.assertAlmostEqual(m["after_tax_return"], 0.35)
        self.assertAlmostEqual(m["total_return"], 0.5)


if __name__ == "__main__":
    unittest.main()
