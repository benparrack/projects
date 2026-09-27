import os
import pathlib
import tempfile
import unittest

import catalog
import flip
import store
from sources import blocket

FIX = pathlib.Path(__file__).parent / "fixtures"
CFG = {"mode": "dry_run", "bankroll_sek": 1000, "max_open_flips": 3, "daily_spend_cap_sek": 600,
       "auto_buy_max_sek": 300, "min_profit_sek": 100, "max_km": 1000, "home": [59.3313, 18.0598],
       "tradera_sell_fee_pct": 0.10, "buy_shipping_sek": 70, "sell_packaging_sek": 15}


class E2ETest(unittest.TestCase):
    def test_once_against_fixture(self):
        listings = blocket.parse((FIX / "blocket_switch.html").read_text(encoding="utf-8"))
        # Plant one obvious deal so the test doesn't depend on the fixture's live prices.
        planted = blocket.Listing("blocket", "999", "Zelda Breath of the Wild Nintendo Switch", 120,
                                  "Stockholm", 59.33, 18.06, 0, "https://www.blocket.se/x")
        st = store.Store(os.path.join(tempfile.mkdtemp(), "t.sqlite"))
        os.environ.pop("NTFY_ALERT_TOPIC", None)
        bot = flip.Bot(CFG, st, catalog.load(), fetch=lambda q: listings + [planted])
        deals = bot.once()
        self.assertIn("999", [d.listing.id for d in deals])
        self.assertTrue(any("Hej! Är den kvar?" in p["message"] for p in bot.sent))
        self.assertEqual(bot.once(), [])  # dedupe: nothing new on the second pass
        fid = st.by_state("found")[0]["id"]
        self.assertIn("bought", bot.handle("bought", [str(fid), "110"]))
        self.assertEqual(st.get(fid)["cost_sek"], 110)


if __name__ == "__main__":
    unittest.main()
