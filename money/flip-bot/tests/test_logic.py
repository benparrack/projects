import unittest

import catalog
import pricing
import scorer
from sources.blocket import Listing

CFG = {"buy_shipping_sek": 70, "tradera_sell_fee_pct": 0.10, "sell_packaging_sek": 15, "min_profit_sek": 100}


def L(title, price, source="blocket"):
    return Listing(source, "1", title, price, "Stockholm", None, None, 0, "u")


class LogicTest(unittest.TestCase):
    def setUp(self):
        self.models = catalog.load()

    def test_botw_vs_switch2_edition(self):
        self.assertEqual(catalog.match("Zelda Breath of the Wild - Nintendo Switch", self.models).name,
                         "Zelda Breath of the Wild (Switch 1)")
        self.assertIsNone(catalog.match("Zelda Breath of the Wild Switch 2 Edition", self.models))

    def test_accessories_excluded(self):
        for t in ["Skyddsfodral för Nintendo Switch Joy-Con Controller", "Switch lever joystick joy con 2PCS",
                  "Tears of the kingdom Artbook och Pins", "Pokémon Scarlet & Violet Destined Rivals ETB"]:
            self.assertIsNone(catalog.match(t, self.models), t)

    def test_asking_outliers_ignored(self):
        m = self.models[0]  # seed 399
        fair, src = pricing.fair_value(m, asking_prices=[450] * 8 + [2600] * 6)
        self.assertEqual(fair, round(450 * 0.85))
        self.assertLessEqual(pricing.fair_value(m, asking_prices=[900] * 10)[0], 1.5 * 399)

    def test_bundle_is_ambiguous(self):
        self.assertIsNone(catalog.match("Mario Odyssey + Smash Bros", self.models))

    def test_pricing_fallbacks(self):
        m = self.models[0]
        self.assertEqual(pricing.fair_value(m)[1], "catalog seed")
        self.assertEqual(pricing.fair_value(m, sold_comps=[300, 400, 400, 500, 9999])[0], 400)
        fair, src = pricing.fair_value(m, asking_prices=[500] * 8)
        self.assertEqual((fair, src.startswith("blocket")), (425, True))

    def test_profit_and_flags(self):
        m = self.models[0]
        d = scorer.score(L("Zelda BotW switch", 150), m, 400, "x", CFG)
        self.assertEqual(d.profit_sek, 400 - 150 - 40 - 15)
        self.assertTrue(scorer.is_deal(d, CFG))
        self.assertFalse(d.suspicious)
        self.assertEqual(scorer.score(L("Zelda BotW trasig", 150), m, 400, "x", CFG).red_flag, "trasig")
        self.assertTrue(scorer.score(L("Zelda BotW", 100), m, 400, "x", CFG).suspicious)
        tr = scorer.score(L("Zelda BotW", 150, "tradera"), m, 400, "x", CFG)
        self.assertEqual(tr.profit_sek, 195 - 70)


if __name__ == "__main__":
    unittest.main()
