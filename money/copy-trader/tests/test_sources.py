import os
import unittest

from ct.sources import congress, edgar

FIX = os.path.join(os.path.dirname(__file__), "fixtures")


def fixture(name):
    with open(os.path.join(FIX, name)) as f:
        return f.read()


INFOTABLE = """<?xml version="1.0"?><informationTable xmlns="http://www.sec.gov/edgar/document/thirteenf/informationtable">
<infoTable><nameOfIssuer>APPLE INC</nameOfIssuer><cusip>037833100</cusip><value>1000</value>
 <shrsOrPrnAmt><sshPrnamt>10</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt></infoTable>
<infoTable><nameOfIssuer>APPLE INC</nameOfIssuer><cusip>037833100</cusip><value>500</value>
 <shrsOrPrnAmt><sshPrnamt>5</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt></infoTable>
<infoTable><nameOfIssuer>APPLE INC</nameOfIssuer><cusip>037833100</cusip><value>900</value><putCall>Put</putCall>
 <shrsOrPrnAmt><sshPrnamt>9</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt></infoTable>
<infoTable><nameOfIssuer>SOME BOND</nameOfIssuer><cusip>123456AB1</cusip><value>700</value>
 <shrsOrPrnAmt><sshPrnamt>700</sshPrnamt><sshPrnamtType>PRN</sshPrnamtType></shrsOrPrnAmt></infoTable>
</informationTable>"""


class TestEdgar(unittest.TestCase):
    def test_infotable_aggregates_and_skips_options_and_bonds(self):
        holdings, names = edgar.parse_infotable(INFOTABLE)
        self.assertEqual(holdings, {"037833100": 1500.0})
        self.assertEqual(names["037833100"], "APPLE INC")


class TestHouse(unittest.TestCase):
    def test_small_ptr(self):
        txns = congress.parse_house_ptr(fixture("house_ptr_20034473.txt"))
        self.assertEqual([t["ticker"] for t in txns], ["ABT", "AMP", "INTU", "PG", "SPGI"])
        self.assertEqual(txns[0]["side"], "sell_full")
        self.assertEqual(txns[0]["txn_date"], "2026-04-16")
        self.assertAlmostEqual(txns[0]["amount"], 32500.5)

    def test_large_ptr_mostly_parsed(self):
        txns = congress.parse_house_ptr(fixture("house_ptr_20033619.txt"))
        self.assertGreaterEqual(len(txns), 170)               # 176 stock rows; a few split over page breaks
        self.assertTrue(all(t["side"] in ("buy", "sell_full", "sell_partial") for t in txns))

    def test_ptr_without_stocks(self):
        self.assertEqual(congress.parse_house_ptr(fixture("house_ptr_20032191.txt")), [])

    def test_amount_range(self):
        self.assertEqual(congress.amount_range("$1,001 - $15,000"), (1001, 15000))


class TestSenate(unittest.TestCase):
    def test_ptr(self):
        txns = congress.parse_senate_ptr(fixture("senate_ptr.html"))
        self.assertEqual([(t["ticker"], t["side"]) for t in txns], [("META", "buy"), ("CEG", "buy")])
        self.assertEqual(txns[0]["txn_date"], "2025-03-26")


if __name__ == "__main__":
    unittest.main()
