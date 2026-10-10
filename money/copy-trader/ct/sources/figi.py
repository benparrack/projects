"""CUSIP -> ticker via OpenFIGI (free, no key: 25 requests/min, 10 CUSIPs each)."""
import logging

from ..net import Client

log = logging.getLogger("figi")
URL = "https://api.openfigi.com/v3/mapping"
GOOD_TYPES = ("Common Stock", "ADR", "ETP", "REIT", "Depositary Receipt", "MLP", "Closed-End Fund")


def yahoo_symbol(t):
    return t.replace("/", "-").replace(".", "-").upper()


def pick(data):
    if not data:
        return None
    for d in data:
        if any(g.lower() in (d.get("securityType") or "").lower() for g in GOOD_TYPES):
            return d
    return data[0]


def map_cusips(con, cusips):
    known = {r[0] for r in con.execute("SELECT cusip FROM figi")}
    todo = sorted({c for c in cusips if c not in known})
    if not todo:
        return 0
    c = Client(min_interval=2.6, headers={"Content-Type": "application/json"})
    for i in range(0, len(todo), 10):
        batch = todo[i:i + 10]
        try:
            res = c.post(URL, json=[{"idType": "ID_CUSIP", "idValue": x, "exchCode": "US"} for x in batch]).json()
        except Exception as e:
            log.warning("OpenFIGI batch failed: %s", e)
            continue
        for cusip, r in zip(batch, res):
            d = pick(r.get("data"))
            con.execute("INSERT OR REPLACE INTO figi VALUES(?,?,?)",
                        (cusip, yahoo_symbol(d["ticker"]) if d and d.get("ticker") else "", d and d.get("name")))
        con.commit()
    log.info("OpenFIGI mapped %d CUSIPs", len(todo))
    return len(todo)


def cusip_map(con):
    return {c: t for c, t in con.execute("SELECT cusip, ticker FROM figi") if t}
