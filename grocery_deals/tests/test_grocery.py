"""Run: python3 tests/test_grocery.py"""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import grocery


def o(name, brand="", save=None, member=False, deal="10/st"):
    return {"name": name, "brand": brand, "size": "", "deal": deal, "was": "12 kr", "save": save,
            "member": member, "until": ""}


m = grocery.matches
assert m("kyckling", o("Kycklingbröstfilé"))           # compound, word start
assert m("bröd", o("Lantbröd, potatisbröd"))            # compound, word end
assert m("havredryck|oatly", o("Ikaffe", "OATLY"))      # alternative via brand
assert not m("ris", o("Krispiga cornichons"))           # mid-word doesn't count
assert not m("ris", o("Kattfoder", "FRISKIES"))
assert m("ägg", o("Skivat delipålägg"))                 # ...but word-end does, hence exclusions:
assert not m("ägg -lägg", o("Skivat delipålägg"))
assert m("ägg -lägg", o("Ägg 12-pack"))
assert m("Kaffe", o("kaffe"))                           # case-insensitive

assert grocery.num("Spara 15,00-17,32 kr") == 15.0 and grocery.num(None) is None

# dedupe, member filter, sort by savings, best store
offers = {"1": [o("Kaffe", save=7), o("Kaffe", save=7), o("Hushållsost", save=39, member=True), o("Lakrits")],
          "2": [o("Kaffe", save=20)]}
grocery.CACHE, grocery.CACHE_TTL = Path(tempfile.mkdtemp()), 0  # always refetch from the fake below
grocery.HISTORY = grocery.CACHE / "h.db"
grocery.fetch_offers = lambda chain, sid: offers[sid]
cfg = {"items": ["kaffe", "ost"], "stores": [{"chain": "willys", "id": "1", "name": "A"},
                                             {"chain": "hemkop", "id": "2", "name": "B"}]}
res = grocery.find_deals(cfg)
assert [x["name"] for _, x in res[0][1]] == ["Hushållsost", "Kaffe"], res
assert [x["name"] for _, x in res[0][2]] == []  # Lakrits has no saving, so not an extra
text = grocery.report(res)
assert text.startswith("Best for your list: A (~46 kr off)"), text
assert "- Kaffe: 10/st, -7 kr" in text
res = grocery.find_deals({**cfg, "member": False})
assert [x["name"] for _, x in res[0][1]] == ["Kaffe"]
assert "Best for your list: B" in grocery.report(res)
assert "No offers match" in grocery.report([(cfg["stores"][0], [], [])])
print("ok")

# a second store of the same chain only lists offers the first didn't
offers["3"] = [o("Kaffe", save=7), o("Hushållsost", save=39, member=True), o("Kaffebröd", save=3)]
cfg["stores"].append({"chain": "willys", "id": "3", "name": "C"})
text = grocery.report(grocery.find_deals({**cfg, "items": ["kaffe", "ost", "bröd"]}))
c = text.split("## C")[1]
assert "(same as A, plus:)" in c and "Kaffebröd" in c and "Hushållsost" not in c, text
# exclusions at the end of a line
assert not m("pålägg|skinka -vegansk", o("Veganskt pålägg"))
assert m("pålägg|skinka -vegansk", o("Rökt skinka"))
print("ok 2")

# ICA: offers parsed out of the page's embedded JS data, saving computed from the regular price
page = """<script>window.__INITIAL_DATA__={"x":undefined,"weeklyOffers":[
 {"details":{"name":"Kycklingfilé","brand":"Kronfågel","packageInformation":"900 g","mechanicInfo":"2 för 40 kr"},
  "parsedMechanics":{"quantity":2,"value2":"40"},"stores":[{"regularPrice":"23,50-24","referencePriceText":"Ord.pris 23:50 kr"}],
  "traits":["Stammis"],"validTo":"2026-10-18T00:00:00","picture":undefined,"category":{"articleGroupName":"Kött"}}
],"more":1}</script>"""
grocery.get = lambda url: type("R", (), {"text": page})()
(ica,) = grocery.ica_offers("ica-x-1")
assert ica["save"] == 7.0 and abs(ica["pct"] - 7 / 47) < 1e-9 and ica["member"] and ica["image"] == "", ica
assert ica["until"] == "2026-10-18" and ica["was"] == "23:50 kr" and m("kyckling", ica)

# settings: validated and written atomically
grocery.SETTINGS = Path(tempfile.mkdtemp()) / "settings.json"
saved = grocery.save_settings({"stores": [{"chain": "ica", "id": 5, "name": "K"}], "items": [" mjölk ", ""]})
assert saved["items"] == ["mjölk"] and saved["stores"][0]["id"] == "5" and grocery.load_settings() == saved
try:
    grocery.save_settings({"stores": [{"chain": "evil", "id": 1, "name": "x"}], "items": []})
    raise AssertionError("bad chain accepted")
except ValueError:
    pass
print("ok 3")

# trip: offer snapshots and free-text entries, validated
grocery.TRIP = Path(tempfile.mkdtemp()) / "trip.json"
assert grocery.load_trip() == []
t = grocery.save_trip([{"key": "ica|Kaffe", "chain": "ica", "store": "K", "name": "Kaffe", "save": "7.5"},
                       {"key": "free|1", "name": "Mjölk", "done": 1}])
assert t[0]["save"] == 7.5 and t[1]["save"] is None and t[1]["done"] is True and grocery.load_trip() == t
for bad in ({"key": "x"}, [{"name": "no key"}], [{}] * 501):
    try:
        grocery.save_trip(bad)
        raise AssertionError(f"accepted {bad!r:.40}")
    except (ValueError, KeyError, TypeError):
        pass
print("ok 4")

# price history: unit prices, weekly records, "is this a good price"
up = grocery.unit_price
assert up("2 för 40 kr") == (20.0, "st") and up("179 kr/kg") == (179.0, "kg") and up("349/kg") == (349.0, "kg")
assert up("Handla för 300 kr 10/st") == (10.0, "st") and up("29,95 kr") == (29.95, "st") and up("") is None
from datetime import date
grocery.HISTORY = Path(tempfile.mkdtemp()) / "h.db"
kaffe = lambda deal: {"name": "Kaffe", "brand": "Zoégas", "size": "450g", "deal": deal}
grocery.record("ica", "1", [kaffe("2 för 80 kr")], date(2026, 9, 28))
grocery.record("ica", "1", [kaffe("45 kr"), o("Ost")], date(2026, 10, 5))
now = [kaffe("2 för 100 kr"), o("Ost"), o("Te")]
grocery.record("ica", "1", now, date(2026, 10, 12))
grocery.annotate("ica", "1", now)
h = now[0]["hist"]
assert (h["weeks"], h["of"], h["low"], h["low_week"], h["now"]) == (3, 3, 40.0, "2026-W40", 50.0), h
assert now[1]["hist"]["weeks"] == 2 and now[2]["hist"]["weeks"] == 1
grocery.annotate("ica", "2", now)  # another store: no history of its own
assert now[0]["hist"]["of"] == 0
print("ok 5")

# trip as phone text
txt = grocery.trip_text([{"name": "Kaffe", "brand": "Zoégas", "store": "K", "deal": "45 kr", "save": 10},
                         {"name": "Mjölk"}, {"name": "Ost", "store": "K", "done": True}])
assert txt == "K\n☐ Kaffe Zoégas: 45 kr (-10 kr)\n\nAnywhere\n☐ Mjölk\n\nSaving ~10 kr", txt
assert grocery.trip_text([]) == "Trip is empty."
print("ok 6")
