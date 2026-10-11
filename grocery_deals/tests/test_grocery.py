"""Run: python3 tests/test_grocery.py"""
import sys
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
grocery.offers = lambda chain, sid: offers[sid]
cfg = {"items": ["kaffe", "ost"], "stores": [{"chain": "willys", "id": "1", "name": "A"},
                                             {"chain": "hemkop", "id": "2", "name": "B"}]}
res = grocery.find_deals(cfg)
assert [x["name"] for _, x in res[0][1]] == ["Hushållsost", "Kaffe"], res
text = grocery.report(res)
assert text.startswith("Best this week: A (~46 kr saved)"), text
res = grocery.find_deals({**cfg, "member": False})
assert [x["name"] for _, x in res[0][1]] == ["Kaffe"]
assert "Best this week: B" in grocery.report(res)
assert "No offers match" in grocery.report([(cfg["stores"][0], [])])
print("ok")
