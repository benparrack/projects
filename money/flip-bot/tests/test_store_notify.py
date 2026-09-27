import os
import tempfile
import unittest

import notify
import store
from scorer import Deal
from sources.blocket import Listing

CFG = {"bankroll_sek": 1000, "max_open_flips": 3, "daily_spend_cap_sek": 600, "auto_buy_max_sek": 300}


class M:
    name = "X"


def deal(price):
    return Deal(Listing("tradera", str(price), "t", price, "", None, None, 0, "u"), M(), 400, "s", 150, False, None)


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.s = store.Store(os.path.join(self.dir, "t.sqlite"))

    def test_seen_dedupe(self):
        self.assertTrue(self.s.first_seen("blocket", "1"))
        self.assertFalse(self.s.first_seen("blocket", "1"))

    def test_money_controls(self):
        self.assertEqual(store.can_spend(self.s, 200, CFG, self.dir), (True, "ok"))
        self.assertFalse(store.can_spend(self.s, 700, CFG, self.dir)[0])  # daily cap
        f = self.s.add_flip(deal(500))
        self.s.set_state(f, "bought", cost_sek=500)
        ok, why = store.can_spend(self.s, 600, CFG, self.dir)
        self.assertFalse(ok)
        self.assertIn("bankroll", why)
        self.assertIn("daily", store.can_spend(self.s, 150, CFG, self.dir)[1])
        self.s.set_state(f, "closed", sold_sek=700)
        self.assertEqual(self.s.realized_profit(), 200)
        open(os.path.join(self.dir, "STOP"), "w").close()
        self.assertEqual(store.can_spend(self.s, 10, CFG, self.dir)[1], "paused (STOP)")

    def test_max_open_and_approval(self):
        for p in (50, 60, 70):
            self.s.set_state(self.s.add_flip(deal(p)), "approved")
        self.assertIn("max open", store.can_spend(self.s, 10, CFG, self.dir)[1])
        self.assertTrue(store.needs_approval(301, CFG))
        self.assertFalse(store.needs_approval(300, CFG))


class NotifyTest(unittest.TestCase):
    def test_commands_and_stream(self):
        self.assertEqual(notify.parse_command("Approve 12"), ("approve", ["12"]))
        self.assertIsNone(notify.parse_command("hello"))
        stream = ('{"id":"a1","event":"open"}\n{"id":"b2","event":"message","message":"bought 3 250"}\n'
                  '{"id":"c3","event":"message","message":"nonsense"}\n')
        self.assertEqual(notify.parse_stream(stream, "all"), ([("bought", ["3", "250"])], "c3"))

    def test_payload_caps_actions(self):
        acts = [notify.reply_button(str(i), "r", "x") for i in range(5)]
        self.assertEqual(len(notify.build("t", "m", actions=acts)["actions"]), 3)
        self.assertEqual(notify.send("", {"title": "t"})["title"], "t")  # no topic → logged only


if __name__ == "__main__":
    unittest.main()
