"""Hyperliquid public info API: leaderboard, positions, fills, account history, candles, funding.
No keys: it is all public on-chain data."""
import json
import logging
import time

from ..net import Client

log = logging.getLogger("hyperliquid")
INFO = "https://api.hyperliquid.xyz/info"
LEADERBOARD = "https://stats-data.hyperliquid.xyz/Mainnet/leaderboard"
FILL_CAP = 10000          # the API only exposes a user's 10k most recent fills
HOUR_MS = 3600 * 1000

_client = None


def client():
    global _client
    if _client is None:
        _client = Client(min_interval=0.35, timeout=60, retries=8)   # weight limit is 1200/min; stay far under
    return _client


def info(payload):
    return client().post(INFO, json=payload).json()


def is_perp(coin):
    """Main-dex perps only: spot pairs look like '@107' or 'PURR/USDC', builder (HIP-3) perps like 'xyz:TSLA',
    outcome markets like '#1030'."""
    return not (coin.startswith(("@", "#")) or "/" in coin or ":" in coin)


def window(row, name):
    return {k: v for k, v in row["windowPerformances"]}.get(name, {})


def leaderboard():
    rows = client().get(LEADERBOARD).json()["leaderboardRows"]
    out = []
    for r in rows:
        m, a = window(r, "month"), window(r, "allTime")
        out.append({"user": r["ethAddress"].lower(), "account_value": float(r["accountValue"]),
                    "month_pnl": float(m.get("pnl", 0)), "month_vlm": float(m.get("vlm", 0)),
                    "all_pnl": float(a.get("pnl", 0)), "all_vlm": float(a.get("vlm", 0))})
    return out


def pool_filter(rows, hcfg):
    """Candidates that look like copyable directional traders (not market makers / vaults / dust)."""
    out = []
    for r in rows:
        av = r["account_value"]
        if av < hcfg["min_account_value"] or r["month_vlm"] < hcfg["min_month_volume"]:
            continue
        if r["month_vlm"] / av > hcfg["max_monthly_turnover"]:
            continue
        out.append(r)
    return sorted(out, key=lambda r: -r["all_vlm"])


def clearinghouse(user):
    """(account_value, {coin: signed size}) right now."""
    j = info({"type": "clearinghouseState", "user": user})
    av = float(j["marginSummary"]["accountValue"])
    pos = {}
    for p in j.get("assetPositions", []):
        p = p["position"]
        if is_perp(p["coin"]) and float(p["szi"]) != 0:
            pos[p["coin"]] = float(p["szi"])
    return av, pos


def portfolio(user):
    """{'av': [(t_s, value)], 'pnl': [(t_s, cumulative pnl)]} from the 'allTime' window, plus 'month' detail."""
    j = dict((k, v) for k, v in info({"type": "portfolio", "user": user}))
    out = {}
    for w in ("allTime", "month"):
        if w in j:
            out[w] = {"av": [(t / 1000, float(v)) for t, v in j[w]["accountValueHistory"]],
                      "pnl": [(t / 1000, float(v)) for t, v in j[w]["pnlHistory"]]}
    return out


def fills_since(user, start_ms):
    """All perp fills since start_ms (oldest first), paging forward. Returns (fills, truncated, oldest_t).
    truncated=True when the 10k cap means fills older than the first one returned are missing."""
    seen, out, cursor = set(), [], start_ms
    while True:
        batch = info({"type": "userFillsByTime", "user": user, "startTime": cursor, "aggregateByTime": False})
        if not batch:
            break
        fresh = [f for f in batch if f["tid"] not in seen]
        for f in fresh:
            seen.add(f["tid"])
        out += fresh
        if len(batch) < 2000 or not fresh:
            break
        cursor = max(f["time"] for f in batch)
    out.sort(key=lambda f: f["time"])
    truncated = len(out) >= FILL_CAP - 50
    rows = [(f["tid"], f["time"] // 1000, f["coin"], float(f["sz"]) * (1 if f["side"] == "B" else -1),
             float(f["px"])) for f in out if is_perp(f["coin"])]
    # coverage starts at the oldest fill we got of any kind (spot fills count toward the cap too)
    return rows, truncated, (out[0]["time"] // 1000 if out else None)


def fetch_user(con, user, start_s):
    """Fetch fills + anchor snapshot + account history for one user into the DB."""
    av, pos = clearinghouse(user)
    ref_t = int(time.time())
    fills, truncated, first_t = fills_since(user, int(start_s * 1000))
    port = portfolio(user)
    con.execute("DELETE FROM hl_fills WHERE user=?", (user,))
    con.executemany("INSERT OR REPLACE INTO hl_fills VALUES(?,?,?,?,?,?)", [(user, *f) for f in fills])
    fills_from = first_t if (truncated and first_t) else int(start_s)
    con.execute("INSERT OR REPLACE INTO hl_users VALUES(?,?,?,?,?,?,?,?)",
                (user, time.time(), fills_from, int(truncated), ref_t, av, json.dumps(pos), json.dumps(port)))
    con.commit()
    return len(fills), truncated


def meta():
    j = info({"type": "meta"})
    return {u["name"]: u.get("maxLeverage", 3) for u in j["universe"]}


def candles(coin, start_s, end_s, interval="1h"):
    out, cursor = [], int(start_s * 1000)
    end_ms = int(end_s * 1000)
    while cursor < end_ms:
        b = info({"type": "candleSnapshot", "req": {"coin": coin, "interval": interval,
                                                     "startTime": cursor, "endTime": end_ms}})
        if not b:
            break
        out += [(c["t"] // 1000, float(c["o"]), float(c["h"]), float(c["l"]), float(c["c"])) for c in b]
        if len(b) < 4999:
            break
        cursor = b[-1]["t"] + 1
    return out


def funding(coin, start_s, end_s):
    out, cursor = [], int(start_s * 1000)
    while cursor < end_s * 1000:
        b = info({"type": "fundingHistory", "coin": coin, "startTime": cursor, "endTime": int(end_s * 1000)})
        if not b:
            break
        out += [(f["time"] // 1000, float(f["fundingRate"])) for f in b]
        if len(b) < 500:
            break
        cursor = b[-1]["time"] + 1
    return out
