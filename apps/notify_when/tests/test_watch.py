"""Run: python3 tests/test_watch.py"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import watch


class Resp:
    def __init__(self, text):
        self.text = text

    def json(self):
        return json.loads(self.text)


HTML = '<html><body><div class="price">1 299,90 kr</div><p class="stock">Slut i lager</p></body></html>'

# extraction
assert watch.extract({"css": ".price"}, Resp(HTML)) == "1 299,90 kr"
assert watch.extract({"css": ".nope"}, Resp(HTML)) is None
assert watch.extract({"regex": r"(\d+),\d+ kr"}, Resp(HTML)) == "299"
assert watch.extract({"css": ".stock", "regex": "lager"}, Resp(HTML)) == "lager"
assert watch.extract({"json": "items.1.price"}, Resp('{"items":[{"price":1},{"price":2.5}]}')) == 2.5
assert "Slut i lager" in watch.extract({}, Resp(HTML))

# numbers
assert watch.to_number("1 299,90 kr") == 1299.9
assert watch.to_number("abc") is None

# conditions
assert watch.evaluate("< 1300", "1 299,90 kr", None)
assert not watch.evaluate("< 1000", "1 299,90 kr", None)
assert not watch.evaluate("< 1000", None, None)
assert watch.evaluate("!contains slut i lager", "I lager", None)
assert watch.evaluate("contains Slut", "slut i lager", None)
assert not watch.evaluate("changed", "a", None)  # first sighting is not a change
assert watch.evaluate("changed", "b", "a")
assert watch.evaluate("missing", None, None)

# push only on transition, not while the hit stands
w = {"name": "t", "url": "x", "when": "< 100", "css": ".price"}
pages = iter(["<b class=price>150</b>", "<b class=price>90</b>", "<b class=price>80</b>",
              "<b class=price>150</b>", "<b class=price>70</b>"])
watch.fetch = lambda w: Resp(next(pages))
st = {}
got = [watch.step(w, st, 0) for _ in range(5)]
assert got == [None, "t: 90", None, None, "t: 70"], got

# 'changed' pushes on every change
w = {"name": "c", "url": "x", "when": "changed", "css": "b"}
pages = iter(["<b>a</b>", "<b>a</b>", "<b>b</b>"])
st = {}
got = [watch.step(w, st, 0) for _ in range(3)]
assert got == [None, None, "c: b (was a)"], got

assert watch.parse_every("30m") == 1800 and watch.parse_every("2h") == 7200
print("ok")
