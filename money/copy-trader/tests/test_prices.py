import unittest
from unittest import mock

from ct import db, prices


class TestCryptoBackfill(unittest.TestCase):
    def test_backfills_when_history_starts_late(self):
        con = db.connect(":memory:")
        con.execute("INSERT INTO bars VALUES('BTC','1h',?,1,1,1,1)", (100 * 3600,))   # only a recent bar cached
        calls = []
        with mock.patch.object(prices.hl, "candles", side_effect=lambda c, a, b: calls.append(a) or []), \
             mock.patch.object(prices.hl, "funding", return_value=[]):
            prices.fetch_crypto(con, ["BTC"], 0, 200 * 3600)
            self.assertEqual(calls[-1], 0)                     # refetched from the requested start
            con.execute("INSERT INTO bars VALUES('BTC','1h',0,1,1,1,1)")
            prices.fetch_crypto(con, ["BTC"], 0, 200 * 3600)
            self.assertEqual(calls[-1], 99 * 3600)             # complete history: incremental only


if __name__ == "__main__":
    unittest.main()
