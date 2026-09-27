import os
import pathlib
import tempfile
import time
import unittest

import catalog
import flip
import store
from sources.blocket import Listing
from sources.tradera import Tradera

CFG = {"mode": "dry_run", "bankroll_sek": 1000, "max_open_flips": 3, "daily_spend_cap_sek": 600,
       "auto_buy_max_sek": 300, "min_profit_sek": 100, "max_km": 25, "home": [59.33, 18.06],
       "tradera_sell_fee_pct": 0.10, "buy_shipping_sek": 70, "sell_packaging_sek": 15, "approval_timeout_min": 30}

SOAP = """<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
<soap:Body><SearchAdvancedResponse xmlns="http://api.tradera.com"><SearchAdvancedResult>
<TotalNumberOfItems>2</TotalNumberOfItems><TotalNumberOfPages>1</TotalNumberOfPages>
<Items><Id>11</Id><ShortDescription>Zelda Breath of the Wild Switch</ShortDescription><BuyItNowPrice>150</BuyItNowPrice>
<SellerId>1</SellerId><MaxBid>0</MaxBid><SellerDsrAverage>5</SellerDsrAverage><EndDate>2099-01-01T00:00:00</EndDate>
<NextBid>0</NextBid><HasBids>false</HasBids><IsEnded>false</IsEnded><ItemType>PureBuyItNow</ItemType>
<ItemUrl>https://www.tradera.com/item/1/11/x</ItemUrl><CategoryId>344629</CategoryId><BidCount>0</BidCount></Items>
<Items><Id>12</Id><ShortDescription>Zelda BotW auktion</ShortDescription><BuyItNowPrice>0</BuyItNowPrice>
<SellerId>1</SellerId><MaxBid>90</MaxBid><SellerDsrAverage>5</SellerDsrAverage><EndDate>2099-01-01T00:00:00</EndDate>
<NextBid>100</NextBid><HasBids>true</HasBids><IsEnded>false</IsEnded><ItemType>Auction</ItemType>
<CategoryId>344629</CategoryId><BidCount>3</BidCount></Items>
</SearchAdvancedResult></SearchAdvancedResponse></soap:Body></soap:Envelope>"""


class StubTransport:
    """zeep transport: loads local WSDLs, answers every POST with canned XML."""
    def __init__(self, reply):
        from zeep.transports import Transport
        self._t, self.reply, self.sent = Transport(), reply, []

    def load(self, url):
        return self._t.load(url)

    def post_xml(self, address, envelope, headers):
        from lxml import etree
        self.sent.append(etree.tostring(envelope).decode())

        class R:
            status_code, headers, encoding = 200, {"Content-Type": "text/xml"}, "utf-8"
            content = self.reply.encode()
            text = self.reply
        return R()


class ZeepParseTest(unittest.TestCase):
    def test_search_parses_and_sends_auth(self):
        t = StubTransport(SOAP)
        items = Tradera(42, "key", transport=t).search("zelda")
        self.assertEqual([(i.id, i.price_sek, i.extra["bin"]) for i in items], [("11", 150, 150), ("12", 100, 0)])
        self.assertIn("<ns0:AppId>42</ns0:AppId>", t.sent[0].replace("ns1:", "ns0:"))


class FakeTradera:
    can_act = True

    def __init__(self, listings, comps=(400,) * 6):
        self.listings, self.comps, self.bought, self.prices = listings, list(comps), [], []

    def sold_comps(self, q, m):
        return self.comps, 344629

    def search(self, q):
        return self.listings

    def buy(self, item_id, amount):
        self.bought.append((item_id, amount))
        return "Bought"

    def set_price(self, item_id, price):
        self.prices.append((item_id, price))

    def seller_orders(self, since):
        return {}


def TL(id_, price):
    return Listing("tradera", id_, "Zelda Breath of the Wild Nintendo Switch", price, "", None, None, 0,
                   f"https://www.tradera.com/item/{id_}", extra={"bin": price})


class RoutingTest(unittest.TestCase):
    def setUp(self):
        self.st = store.Store(os.path.join(tempfile.mkdtemp(), "t.sqlite"))
        os.environ.pop("NTFY_ALERT_TOPIC", None)
        self.models = catalog.load()

    def bot(self, listings, dry=True):
        self.tr = FakeTradera(listings)
        return flip.Bot(CFG, self.st, self.models, dry_run=dry, fetch=lambda q: [], tradera=self.tr)

    def test_cheap_autobuys_live(self):
        b = self.bot([TL("1", 150)], dry=False)
        b.once()
        self.assertEqual(self.tr.bought, [("1", 150)])
        self.assertEqual(self.st.get(1)["state"], "bought")
        self.assertEqual(self.st.get(1)["cost_sek"], 220)

    def test_dry_run_never_calls_buy(self):
        b = self.bot([TL("1", 150)], dry=True)
        b.once()
        self.assertEqual(self.tr.bought, [])
        self.assertTrue(any("[DRY RUN] would buy" in p["message"] for p in b.sent))

    def test_expensive_needs_approval_then_expires(self):
        self.tr = FakeTradera([TL("2", 320)], comps=[800] * 6)
        b = flip.Bot(CFG, self.st, self.models, dry_run=False, fetch=lambda q: [], tradera=self.tr)
        b.once()
        self.assertEqual(self.tr.bought, [])
        self.assertTrue(any(a["body"] == "approve 1" for p in b.sent for a in p.get("actions", [])))
        self.assertIn("Bought", b.handle("approve", ["1"]))
        self.assertEqual(self.tr.bought, [("2", 320)])
        # a second one left unanswered expires
        self.tr.listings = [TL("3", 330)]
        b.once()
        self.st.db.execute("UPDATE flips SET created=created-99999 WHERE id=2")
        b.expire_approvals()
        self.assertEqual(self.st.get(2)["state"], "skipped")

    def test_stop_file_blocks_buys(self):
        b = self.bot([TL("1", 100)], dry=False)
        stop = pathlib.Path(flip.ROOT, "STOP")
        stop.touch()
        try:
            b.once()
        finally:
            stop.unlink()
        self.assertEqual(self.tr.bought, [])

    def test_reprice_and_list(self):
        b = self.bot([], dry=True)
        from scorer import Deal
        fid = self.st.add_flip(Deal(TL("9", 150), self.models[0], 400, "s", 150, False, None))
        self.st.set_state(fid, "bought", cost_sek=220)
        b.handle("arrived", [str(fid)])
        photo = pathlib.Path(flip.ROOT, "inbox", str(fid), "a.jpg")
        photo.write_bytes(b"x")
        try:
            b.sell_tick()
        finally:
            photo.unlink()
            photo.parent.rmdir()
        self.assertEqual(self.st.get(fid)["state"], "listed")
        self.st.db.execute("UPDATE flips SET updated=? WHERE id=?", (time.time() - 4 * 86400, fid))
        b.sell_tick()
        self.assertEqual(self.st.get(fid)["list_price"], 380)  # 400 * 0.95


if __name__ == "__main__":
    unittest.main()
