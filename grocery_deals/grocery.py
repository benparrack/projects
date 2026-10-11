#!/usr/bin/env python3
"""grocery-deals: match this week's store offers against your shopping list.

  grocery.py stores QUERY   find store ids by name/street/town, e.g. `stores södermalm`
  grocery.py deals          print matches for your list at your stores (no push)
  grocery.py push           same, and send it to your phone via ntfy (the weekly timer runs this)
  grocery.py browse [WORD]  every offer at your stores, optionally filtered by WORD
"""
import json
import re
import sys
import tomllib
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
CONFIG = HERE / "list.toml"
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0"}
# Willys and Hemköp are both Axfood and share the same public site API.
CHAINS = {"willys": "https://www.willys.se", "hemkop": "https://www.hemkop.se"}
MEMBER = {"willys": "Willys Plus", "hemkop": "Hemköp Klubb"}


def get(url):
    r = requests.get(url, headers=UA, timeout=30)
    r.raise_for_status()
    return r.json()


def all_stores(chain):
    return get(f"{CHAINS[chain]}/axfood/rest/store?online=false")


def find_stores(query):
    q = query.lower()
    for chain in CHAINS:
        for s in all_stores(chain):
            a = s.get("address") or {}
            where = f"{a.get('line1', '')}, {a.get('town', '')}"
            if q in f"{s['name']} {where}".lower():
                yield chain, s["storeId"], s["name"], where


def num(s):
    """'Spara 15,00-17,32 kr' -> 15.0 (lower end of a range); None if no number."""
    m = re.search(r"\d+(?:[,.]\d+)?", s or "")
    return float(m[0].replace(",", ".")) if m else None


def offers(chain, store_id):
    d = get(f"{CHAINS[chain]}/search/campaigns/offline?q={store_id}&type=PERSONAL_GENERAL&page=0&size=1000")
    out = []
    for r in d["results"]:
        for p in r.get("potentialPromotions") or []:
            deal = " ".join(x for x in (p.get("conditionLabel"), p.get("rewardLabel")) if x)
            out.append({
                "name": r["name"], "brand": r.get("manufacturer") or "", "size": r.get("displayVolume") or "",
                "deal": deal, "was": r.get("price") or "", "save": num(p.get("savePrice")),
                "member": p.get("campaignType") == "LOYALTY", "until": p.get("endDate") or "",
            })
    return out


def matches(item, offer):
    """'havredryck|oatly -barista' matches if any alternative starts or ends a word of the offer's name/brand,
    and no -excluded word appears anywhere. Start-or-end fits Swedish compounds: 'kyckling' hits
    'Kycklingbröstfilé', 'bröd' hits 'Lantbröd', but 'ris' doesn't hit 'Krispiga'."""
    hay = f"{offer['name']} {offer['brand']}".lower()
    words = item.lower().split()
    if any(w[1:] in hay for w in words if w.startswith("-")):
        return False
    alts = " ".join(w for w in words if not w.startswith("-")).split("|")
    return any(re.search(rf"\b{re.escape(a.strip())}|{re.escape(a.strip())}\b", hay) for a in alts if a.strip())


def find_deals(cfg):
    """-> [(store, list_matches, extras), ...] in config order. Each is [(item, offer)], biggest saving first.
    extras: the best other offers not on the list (cfg 'extras' many, minus anything matching cfg 'skip')."""
    result = []
    for s in cfg["stores"]:
        found, other, seen = [], [], set()
        for o in offers(s["chain"], s["id"]):
            key = (o["name"], o["brand"], o["size"], o["deal"])
            if key in seen or (o["member"] and not cfg.get("member", True)):
                continue  # the API lists some offers twice
            seen.add(key)
            item = next((i for i in cfg["items"] if matches(i, o)), None)
            if item:
                found.append((item, o))
            elif o["save"] and not any(matches(x, o) for x in cfg.get("skip", [])):
                other.append((None, o))
        by_save = lambda x: -(x[1]["save"] or 0)
        result.append((s, sorted(found, key=by_save), sorted(other, key=by_save)[:cfg.get("extras", 6)]))
    return result


def line(o):
    saving = f", -{o['save']:.0f} kr" if o["save"] else ""
    what = " ".join(x for x in (o["name"], o["brand"], o["size"]) if x)
    return f"- {what}: {o['deal']}{saving}{' *' if o['member'] else ''}"


def report(result):
    lines, totals, shown = [], [], {}  # shown: chain -> (first store's name, its offer lines)
    for s, found, extras in result:
        save = sum(o["save"] or 0 for _, o in found)
        totals.append((save, s["name"]))
        lines.append(f"\n## {s['name']} (list: {len(found)}, ~{save:.0f} kr off)")
        # stores of one chain mostly share offers: later ones only list what the first didn't
        first, seen = shown.setdefault(s["chain"], (s["name"], set()))
        mine, other = [line(o) for _, o in found], [line(o) for _, o in extras]
        if first != s["name"]:
            lines.append(f"(same as {first}, plus:)")
            mine, other = [l for l in mine if l not in seen], [l for l in other if l not in seen]
        seen.update(mine + other)
        lines += mine or ["- nothing new from your list" if first != s["name"] else "- nothing from your list"]
        if other:
            lines.append("Other good deals:")
            lines += other
    best = max(totals)
    head = f"Best for your list: {best[1]} (~{best[0]:.0f} kr off)" if best[0] else "No offers match your list this week."
    if any(o["member"] for _, f, e in result for _, o in f + e):
        lines.append("\n* member price (Willys Plus / Hemköp Klubb)")
    return head + "\n" + "\n".join(lines)


def push(title, message):
    """Same ntfy topic as the other bots: ./.env, else ../money/flip-bot/.env."""
    topic = None
    for p in (HERE / ".env", HERE.parent / "money/flip-bot/.env"):
        if p.exists() and not topic:
            topic = next((l.split("=", 1)[1].strip().strip("\"'") for l in p.read_text().splitlines()
                          if l.startswith("NTFY_ALERT_TOPIC=")), None)
    if not topic:
        print("NTFY (no topic set), not sent")
        return
    requests.post("https://ntfy.sh", data=json.dumps({"topic": topic, "title": title, "message": message.encode()[:4000].decode(errors="ignore"),  # ntfy turns >4 KB into an attachment
                                                     "tags": ["shopping_cart"]}).encode(), timeout=15).raise_for_status()


def main(argv):
    cmd = argv[1] if len(argv) > 1 else "deals"
    if cmd == "stores":
        for chain, sid, name, where in find_stores(" ".join(argv[2:])):
            print(f'{{ chain = "{chain}", id = "{sid}", name = "{name}" }}   # {where}')
        return
    cfg = tomllib.loads(CONFIG.read_text())
    if not cfg.get("stores"):
        raise SystemExit("No stores in list.toml yet. Find yours with: grocery.py stores <area or street>")
    if cmd in ("deals", "push"):
        text = report(find_deals(cfg))
        print(text)
        if cmd == "push":
            push("Grocery deals this week", text)
    elif cmd == "browse":
        word = " ".join(argv[2:]).lower()
        for s in cfg["stores"]:
            print(f"## {s['name']}")
            for o in offers(s["chain"], s["id"]):
                if word in f"{o['name']} {o['brand']}".lower():
                    print(f"- {o['name']} {o['brand']} {o['size']}: {o['deal']} (was {o['was']}){' *' if o['member'] else ''}")
    else:
        print(__doc__)


if __name__ == "__main__":
    main(sys.argv)
