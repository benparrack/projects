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
