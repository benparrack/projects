#!/usr/bin/env python3
"""grocery-deals: match this week's store offers against your shopping list.

  grocery.py stores QUERY   find stores (ICA, Willys, Hemköp) by name/street/town, e.g. `stores kungsholmen`
  grocery.py deals          print matches for your list at your stores (no push)
  grocery.py push           same, and send it to your phone via ntfy (the weekly timer runs this)
  grocery.py browse [WORD]  every offer at your stores, optionally filtered by WORD

The desktop app (server.py + web/) uses the same functions; settings live in settings.json.
"""
import json
import re
import sqlite3
import sys
import time
from datetime import date
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
SETTINGS = HERE / "settings.json"
TRIP = HERE / "trip.json"  # this week's picked deals + free-text items, shared by the app and `grocery.py trip`
CACHE = HERE / "cache"
HISTORY = HERE / "history.db"  # every offer seen, per ISO week: answers "is this deal actually good?"
CACHE_TTL = 3 * 3600  # offers change weekly; 3 h keeps the app snappy without going stale
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0"}
# Willys and Hemköp are both Axfood and share the same public site API.
AXFOOD = {"willys": "https://www.willys.se", "hemkop": "https://www.hemkop.se"}
CHAINS = [*AXFOOD, "ica"]
MEMBER = {"willys": "Willys Plus", "hemkop": "Hemköp Klubb", "ica": "ICA Stammis"}


def get(url):
    r = requests.get(url, headers=UA, timeout=30)
    r.raise_for_status()
    return r


def num(s):
    """'Spara 15,00-17,32 kr' -> 15.0 (lower end of a range); None if no number."""
    m = re.search(r"\d+(?:[,.]\d+)?", str(s or ""))
    return float(m[0].replace(",", ".")) if m else None


# ---------- stores ----------

def ica_stores():
    """All ICA stores, from the JSON embedded in ica.se/butiker. id = the store page slug (the URL needs it)."""
    html = get("https://www.ica.se/butiker/").text
    pat = (r'"accountNumber":"(\d+)","storeName":"([^"]+)".{0,200}?"address":\{"street":"([^"]*)","city":"([^"]*)"'
           r'.{0,400}?"bhsUrl":"([^"]+)"')
    for acc, name, street, city, url in re.findall(pat, html):
        slug = url.replace("\\u002F", "/").rstrip("/").rsplit("/", 1)[-1]
        yield {"chain": "ica", "id": slug, "name": name, "where": f"{street}, {city}"}


def all_stores(chain):
    if chain == "ica":
        return list(ica_stores())
    out = []
    for s in get(f"{AXFOOD[chain]}/axfood/rest/store?online=false").json():
        a = s.get("address") or {}
        out.append({"chain": chain, "id": s["storeId"], "name": s["name"],
                    "where": f"{a.get('line1', '')}, {a.get('town', '')}"})
    return out


def find_stores(query):
    q = query.lower()
    return [s for c in CHAINS for s in all_stores(c) if q in f"{s['name']} {s['where']}".lower()]


# ---------- offers ----------
# Every source returns the same offer dict: name, brand, size, deal, was (regular price text), save (kr or None),
# pct (save as a fraction of the regular cost, or None), member, until (YYYY-MM-DD), image, category.

def axfood_offers(chain, store_id):
    d = get(f"{AXFOOD[chain]}/search/campaigns/offline?q={store_id}&type=PERSONAL_GENERAL&page=0&size=1000").json()
    out = []
    for r in d["results"]:
        for p in r.get("potentialPromotions") or []:
            save, reg = num(p.get("savePrice")), num(r.get("price"))
            qty = p.get("qualifyingCount") or 1
            day, month, year = (re.findall(r"\d+", p.get("endDate") or "") + ["", "", ""])[:3]
            out.append({
                "name": r["name"], "brand": r.get("manufacturer") or "", "size": r.get("displayVolume") or "",
                "deal": " ".join(x for x in (p.get("conditionLabel"), p.get("rewardLabel")) if x),
                "was": r.get("price") or "", "save": save,
                "pct": save / (qty * reg) if save and reg else None,
                "member": p.get("campaignType") == "LOYALTY",
                "until": f"{year}-{month.zfill(2)}-{day.zfill(2)}" if year else "",
                "image": (r.get("image") or {}).get("url") or "", "category": r.get("googleAnalyticsCategory") or "",
            })
    return out


def ica_offers(slug):
    """ICA has no public offers API, but each store's offers page embeds them as JS data (weeklyOffers)."""
    html = get(f"https://www.ica.se/erbjudanden/{slug}/").text
    start = html.index('"weeklyOffers":') + len('"weeklyOffers":')
    raw = re.sub(r"\bundefined\b", "null", html[start:start + 2_000_000])  # JS literal -> JSON
    offers, _ = json.JSONDecoder().raw_decode(raw)
    out = []
    for o in offers:
        d, m = o["details"], o["parsedMechanics"]
        st = (o.get("stores") or [{}])[0]
        reg, price, qty = num(st.get("regularPrice")), num(m.get("value2")), max(m.get("quantity") or 1, 1)
        # ICA lists the regular price but not the saving: "2 för 40" at 23,50 each saves 2*23,50-40
        save = round(qty * reg - price, 2) if reg and price and qty * reg > price else None
        pic = o.get("picture") or {}
        out.append({
            "name": d["name"], "brand": d.get("brand") or "", "size": d.get("packageInformation") or "",
            "deal": d.get("mechanicInfo") or "", "was": (st.get("referencePriceText") or "").replace("Ord.pris ", ""),
            "save": save, "pct": save / (qty * reg) if save else None,
            "member": "Stammis" in (o.get("traits") or []), "until": (o.get("validTo") or "")[:10],
            "image": f"https://assets.icanet.se/q_auto,f_auto,c_lpad,h_300,w_300/{pic['fileName']}" if pic.get("fileName") else "",
            "category": (o.get("category") or {}).get("articleGroupName") or "",
        })
    return out


def fetch_offers(chain, store_id):
    return ica_offers(store_id) if chain == "ica" else axfood_offers(chain, store_id)


def offers(chain, store_id, refresh=False):
    """fetch_offers with a small disk cache, deduped (the Axfood API lists some offers twice)."""
    CACHE.mkdir(exist_ok=True)
    f = CACHE / f"{chain}-{store_id}.json"
    if not refresh and f.exists() and time.time() - f.stat().st_mtime < CACHE_TTL:
        return json.loads(f.read_text())
    seen, out = set(), []
    for o in fetch_offers(chain, store_id):
        key = (o["name"], o["brand"], o["size"], o["deal"])
        if key not in seen:
            seen.add(key)
            out.append(o)
    f.write_text(json.dumps(out, ensure_ascii=False))
    record(chain, store_id, out)
    return out


# ---------- price history ----------

def unit_price(deal):
    """'2 för 40 kr' -> (20.0, 'st'), '179 kr/kg' -> (179.0, 'kg'), '29,95 kr' -> (29.95, 'st'); None if no price."""
    deal = str(deal or "").lower()
    if m := re.search(r"(\d+)\s*för\s*(\d+(?:[,.]\d+)?)", deal):
        return round(float(m[2].replace(",", ".")) / int(m[1]), 2), "st"
    if m := re.search(r"(\d+(?:[,.]\d+)?)\s*(?:kr)?\s*/\s*(kg|st|l)\b", deal):
        return float(m[1].replace(",", ".")), m[2]
    p = num(deal)
    return (p, "st") if p is not None else None


def db():
    con = sqlite3.connect(HISTORY, timeout=10)
    con.execute("""CREATE TABLE IF NOT EXISTS seen (week TEXT, chain TEXT, store TEXT, name TEXT, brand TEXT, size TEXT,
                   deal TEXT, price REAL, unit TEXT, PRIMARY KEY (week, chain, store, name, brand, size))""")
    return con


def week(d=None):
    y, w, _ = (d or date.today()).isocalendar()
    return f"{y}-W{w:02d}"


def record(chain, store_id, offers_, when=None):
    rows = [(week(when), chain, str(store_id), o["name"], o["brand"], o["size"], o["deal"], *(unit_price(o["deal"]) or (None, None)))
            for o in offers_]
    with db() as con:
        con.executemany("INSERT OR REPLACE INTO seen VALUES (?,?,?,?,?,?,?,?,?)", rows)


def annotate(chain, store_id, offers_):
    """Add o['hist'] = {weeks: weeks on offer, of: weeks recorded, low/low_week: best unit price seen, now, unit}."""
    with db() as con:
        rows = con.execute("SELECT week, name, brand, size, price, unit FROM seen WHERE chain=? AND store=?",
                           (chain, str(store_id))).fetchall()
    of = len({r[0] for r in rows})
    by = {}
    for w, *k, price, unit in rows:
        by.setdefault(tuple(k), []).append((w, price, unit))
    for o in offers_:
        past = by.get((o["name"], o["brand"], o["size"]), [])
        now = unit_price(o["deal"])
        same = sorted((p, w) for w, p, u in past if now and p is not None and u == now[1])
        o["hist"] = {"weeks": len({w for w, _, _ in past}), "of": of, "now": now[0] if now else None,
                     "unit": now[1] if now else None, "low": same[0][0] if same else None,
                     "low_week": same[0][1] if same else None}


# ---------- matching ----------

def matches(item, offer):
    """'havredryck|oatly -barista' matches if any alternative starts or ends a word of the offer's name/brand,
    and no -excluded word appears anywhere. Start-or-end fits Swedish compounds: 'kyckling' hits
    'Kycklingbröstfilé', 'bröd' hits 'Lantbröd', but 'ris' doesn't hit 'Krispiga'."""
    hay = f"{offer['name']} {offer['brand']}".lower()
    words = item.lower().split()
    if any(w[1:] in hay for w in words if w.startswith("-") and len(w) > 1):
        return False
    alts = " ".join(w for w in words if not w.startswith("-")).split("|")
    return any(re.search(rf"\b{re.escape(a.strip())}|{re.escape(a.strip())}\b", hay) for a in alts if a.strip())


def load_settings():
    return json.loads(SETTINGS.read_text())


def save_settings(cfg):
    """Validate at the boundary (the app POSTs this) before it replaces the file."""
    stores = [{"chain": s["chain"], "id": str(s["id"]), "name": str(s["name"])} for s in cfg["stores"]]
    if any(s["chain"] not in CHAINS for s in stores):
        raise ValueError("unknown chain")
    clean = {"stores": stores, "member": bool(cfg.get("member", True)), "extras": int(cfg.get("extras", 6)),
             "items": [str(i).strip() for i in cfg["items"] if str(i).strip()],
             "skip": [str(i).strip() for i in cfg.get("skip", []) if str(i).strip()]}
    return write_json(SETTINGS, clean)


def write_json(path, obj):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=2))
    tmp.replace(path)  # atomic, so a crash mid-write can't eat the list
    return obj


def load_trip():
    return json.loads(TRIP.read_text()) if TRIP.exists() else []


def save_trip(trip):
    """Trip entries are snapshots of offers (so they survive the weekly offer change) or free text (no chain)."""
    if not isinstance(trip, list) or len(trip) > 500:
        raise ValueError("trip must be a list of at most 500 entries")
    s = lambda v: str(v or "")[:300]
    return write_json(TRIP, [{
        "key": s(e["key"]), "chain": s(e.get("chain")), "store": s(e.get("store")), "name": s(e["name"]),
        "brand": s(e.get("brand")), "size": s(e.get("size")), "deal": s(e.get("deal")),
        "save": float(e["save"]) if e.get("save") is not None else None, "until": s(e.get("until"))[:10],
        "image": s(e.get("image")), "done": bool(e.get("done")),
    } for e in trip])


def tag(cfg, refresh=False):
    """-> [(store, offers, error)] with each offer tagged: item (matching list entry or None), skipped (bool)."""
    out = []
    for s in cfg["stores"]:
        try:
            os_ = offers(s["chain"], s["id"], refresh)
        except Exception as e:  # one store failing must not hide the others
            out.append((s, [], str(e)[:200]))
            continue
        annotate(s["chain"], s["id"], os_)
        for o in os_:
            o["item"] = next((i for i in cfg["items"] if matches(i, o)), None)
            o["skipped"] = any(matches(x, o) for x in cfg.get("skip", []))
        out.append((s, os_, None))
    return out


def find_deals(cfg, refresh=False):
    """-> [(store, list_matches, extras)] for the text report. Each is [(item, offer)], biggest saving first.
    extras: the best other offers not on the list (cfg 'extras' many, minus anything matching cfg 'skip')."""
    result = []
    by_save = lambda x: -(x[1]["save"] or 0)
    for s, os_, _ in tag(cfg, refresh):
        os_ = [o for o in os_ if cfg.get("member", True) or not o["member"]]
        found = [(o["item"], o) for o in os_ if o["item"]]
        other = [(None, o) for o in os_ if not o["item"] and o["save"] and not o["skipped"]]
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
        lines.append("\n* member price (ICA Stammis / Willys Plus / Hemköp Klubb)")
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
        return False
    msg = message.encode()[:4000].decode(errors="ignore")  # ntfy turns >4 KB into an attachment
    requests.post("https://ntfy.sh", data=json.dumps({"topic": topic, "title": title, "message": msg,
                                                     "tags": ["shopping_cart"]}).encode(), timeout=15).raise_for_status()
    return True


def trip_text(trip):
    """The trip as a phone-readable list, grouped by store; things already in the basket are left out."""
    groups = {}
    for e in trip:
        if not e.get("done"):
            groups.setdefault(e.get("store") or "Anywhere", []).append(e)
    lines = []
    for store, es in groups.items():
        lines.append(f"\n{store}")
        for e in es:
            what = " ".join(x for x in (e["name"], e.get("brand"), e.get("size")) if x)
            deal = f": {e['deal']}" if e.get("deal") else ""
            lines.append(f"☐ {what}{deal}" + (f" (-{e['save']:.0f} kr)" if e.get("save") else ""))
    save = sum(e.get("save") or 0 for es in groups.values() for e in es)
    return ("\n".join(lines).strip() + (f"\n\nSaving ~{save:.0f} kr" if save else "")) or "Trip is empty."


def send_trip(_body=None):
    return {"sent": push("Shopping trip", trip_text(load_trip()))}


def main(argv):
    cmd = argv[1] if len(argv) > 1 else "deals"
    if cmd == "stores":
        for s in find_stores(" ".join(argv[2:])):
            print(json.dumps({k: s[k] for k in ("chain", "id", "name")}, ensure_ascii=False), "  #", s["where"])
        return
    cfg = load_settings()
    if not cfg.get("stores"):
        raise SystemExit("No stores yet. Add them in the app, or find ids with: grocery.py stores <area>")
    if cmd in ("deals", "push"):
        text = report(find_deals(cfg, refresh=cmd == "push"))
        print(text)
        if cmd == "push":
            push("Grocery deals this week", text)
    elif cmd == "browse":
        word = " ".join(argv[2:]).lower()
        for s, os_, err in tag(cfg):
            print(f"## {s['name']}" + (f"  ERROR {err}" if err else ""))
            for o in os_:
                if word in f"{o['name']} {o['brand']}".lower():
                    print(line(o))
    else:
        print(__doc__)


if __name__ == "__main__":
    main(sys.argv)
