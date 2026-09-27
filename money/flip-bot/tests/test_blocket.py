import pathlib
import unittest

from sources import blocket

FIX = pathlib.Path(__file__).parent / "fixtures"


class BlocketParseTest(unittest.TestCase):
    def test_parses_real_page(self):
        items = blocket.parse((FIX / "blocket_switch.html").read_text(encoding="utf-8"))
        self.assertGreater(len(items), 20)
        first = items[0]
        self.assertTrue(first.url.startswith("https://www.blocket.se/"))
        self.assertIsInstance(first.price_sek, int)
        self.assertTrue(all(i.source == "blocket" and i.title for i in items))

    def test_layout_change_raises(self):
        with self.assertRaises(ValueError):
            blocket.parse("<html></html>")


if __name__ == "__main__":
    unittest.main()
