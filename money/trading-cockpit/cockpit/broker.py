"""Broker links: live Alpaca sync (fills, cash, positions, bracket orders) and CSV import for
Avanza, Nordnet, Interactive Brokers or any simple trade list. Fills land on plans via service.attach_fill."""
from __future__ import annotations

import csv
import hashlib
import io
import json
import logging
import math
import re
from datetime import datetime, timedelta, timezone

import requests
from flask import jsonify, request

from . import db, market, service
from .service import UserError

log = logging.getLogger("broker")

ALPACA = {True: "https://paper-api.alpaca.markets", False: "https://api.alpaca.markets"}
CASH_TYPES = "CSD,CSW,DIV,DIVCGL,DIVCGS,DIVNRA,DIVROC,DIVTXEX,FEE,INT,JNLC,MA,PTC,REORG"


def cfg(account_id: int) -> dict:
    a = db.one("SELECT broker_cfg FROM accounts WHERE id = ?", (account_id,))
    if not a:
        raise UserError("No such account")
    return json.loads(a["broker_cfg"] or "{}")


def _save_cfg(account_id: int, c: dict) -> None:
    db.execute("UPDATE accounts SET broker_cfg = ? WHERE id = ?", (json.dumps(c), account_id))


def _status(account_id: int, msg: str) -> None:
    db.execute("UPDATE accounts SET synced_at = ?, sync_status = ? WHERE id = ?", (db.now(), msg, account_id))


# ---------- Alpaca ----------
def _alpaca(c: dict, method: str, path: str, **kw):
    try:
        r = requests.request(method, ALPACA[bool(c.get("paper", True))] + path, timeout=20,
                             headers={"APCA-API-KEY-ID": c["key_id"], "APCA-API-SECRET-KEY": c["secret"]}, **kw)
    except requests.RequestException as e:
        raise UserError(f"Couldn't reach Alpaca: {e}")
    if r.status_code in (401, 403):
        raise UserError("Alpaca rejected the keys (check paper vs live, and that they're not revoked)")
    if r.status_code >= 400:
        try:
            msg = r.json().get("message")
        except ValueError:
            msg = r.text[:200]
        raise UserError(f"Alpaca: {msg or r.status_code}")
    return r.json() if r.content else None


def yf_symbol(sym: str) -> str:
    return sym.replace(".", "-").replace("/", "-")   # BRK.B → BRK-B


def link_alpaca(account_id: int, key_id: str, secret: str, paper: bool, allow_orders: bool) -> dict:
    a = service.account(account_id)
    if a["mode"] != "real":
        raise UserError("Link Alpaca to a real account (Alpaca's own paper trading counts as real here: "
                        "its fills come from the broker)")
    c = cfg(account_id)
    secret = secret or (c.get("secret") if c.get("key_id") == key_id.strip() else "")
    if not key_id.strip() or not secret.strip():
        raise UserError("Enter both the key id and the secret")
    c.update(key_id=key_id.strip(), secret=secret.strip(), paper=bool(paper), allow_orders=bool(allow_orders))
    info = _alpaca(c, "GET", "/v2/account")  # validates the keys
    db.execute("UPDATE accounts SET broker = 'alpaca' WHERE id = ?", (account_id,))
    _save_cfg(account_id, c)
    return {"status": info.get("status"), "cash": float(info.get("cash", 0)), "equity": float(info.get("equity", 0))}


def unlink(account_id: int) -> None:
    db.execute("UPDATE accounts SET broker = NULL, broker_cfg = NULL, sync_status = NULL WHERE id = ?", (account_id,))


def _pages(c: dict, path: str, params: dict):
    params = dict(params, direction="asc", page_size=100)
    while True:
        page = _alpaca(c, "GET", path, params=params) or []
        yield from page
        if len(page) < 100:
            return
        params["page_token"] = page[-1]["id"]


def sync_alpaca(account_id: int) -> dict:
    """Pull new fills and cash activity, then compare cash and positions with Alpaca's own numbers."""
    c = cfg(account_id)
    if not c.get("key_id"):
        raise UserError("This account isn't linked to Alpaca")
    since = c.get("since")
    params = {"after": since} if since else {}
    added = dup = 0
    notes = []
    newest = since
    for f in _pages(c, "/v2/account/activities/FILL", params):
        newest = max(newest or "", f["transaction_time"])
        if f.get("side") not in ("buy", "sell"):
            notes.append(f"ignored {f.get('side')} {f.get('symbol')} (the cockpit is long-only)")
            continue
        res = service.attach_fill(account_id, ticker=yf_symbol(f["symbol"]), side=f["side"], qty=float(f["qty"]),
                                  price=float(f["price"]), currency="USD", fx=1.0, fees=0.0,
                                  ts=f["transaction_time"][:19], ext_id=f"alpaca:{f['id']}", source="alpaca",
                                  note=f"Alpaca order {f.get('order_id', '')[:8]}")
        added += res == "added"
        dup += res == "duplicate"
        if res.startswith("skipped"):
            notes.append(res)
    moves = 0
    for m in _pages(c, "/v2/account/activities", dict(params, activity_types=CASH_TYPES)):
        amt = float(m.get("net_amount") or 0)
        if not amt:
            continue
        newest = max(newest or "", m.get("date", "") + "T00:00:00")
        cur = db.changed("INSERT OR IGNORE INTO cash_moves(account_id, ts, amount, note, ext_id) VALUES (?,?,?,?,?)",
                         (account_id, (m.get("date") or db.now())[:10] + "T00:00:00", amt,
                          f"{m['activity_type']} {m.get('symbol') or ''} {m.get('description') or ''}".strip()[:120],
                          f"alpaca:{m['id']}"))
        moves += bool(cur)
    # Re-read from a day before the newest activity next time; ext_id dedupe absorbs the overlap.
    if newest:
        c["since"] = (datetime.fromisoformat(newest[:19]) - timedelta(days=1)).strftime("%Y-%m-%d")
    acc = _alpaca(c, "GET", "/v2/account")
    st = service.state(account_id)
    cash_diff = float(acc["cash"]) - st["cash"]
    if not c.get("opened") and abs(cash_diff) > 0.01:
        # Alpaca paper accounts (and accounts funded before the activity history starts) have no deposit
        # record for their opening balance. Add it once so the cockpit's cash matches.
        service.cash_move(account_id, cash_diff, "opening balance (from Alpaca)")
        cash_diff = 0.0
    c["opened"] = True
    _save_cfg(account_id, c)
    pos = {yf_symbol(p["symbol"]): float(p["qty"]) for p in _alpaca(c, "GET", "/v2/positions") or []}
    mine = {p["ticker"]: p["qty"] for p in service.state(account_id)["positions"]}
    mismatch = {t: {"alpaca": pos.get(t, 0.0), "cockpit": mine.get(t, 0.0)}
                for t in set(pos) | set(mine) if abs(pos.get(t, 0.0) - mine.get(t, 0.0)) > 1e-6}
    msg = f"{added} new fill(s), {moves} cash item(s)"
    if abs(cash_diff) > 0.01:
        msg += f"; cash differs by ${cash_diff:,.2f}"
    if mismatch:
        msg += "; positions differ: " + ", ".join(f"{t} {v['alpaca']:g} vs {v['cockpit']:g}" for t, v in mismatch.items())
    _status(account_id, msg)
    return {"added": added, "duplicates": dup, "cash_moves": moves, "cash_diff": cash_diff, "mismatch": mismatch,
            "notes": notes[:20], "status": msg, "alpaca_equity": float(acc.get("equity", 0))}


def sync_all() -> list[str]:
    out = []
    for a in db.rows("SELECT id, name FROM accounts WHERE broker = 'alpaca'"):
        try:
            out.append(f"{a['name']}: {sync_alpaca(a['id'])['status']}")
        except Exception as e:
            _status(a["id"], f"sync failed: {e}")
            out.append(f"{a['name']}: failed: {e}")
    return out


def place_bracket(plan_id: int, limit: float | None = None) -> dict:
    """Send a planned trade to Alpaca as one bracket order: entry + stop-loss + take-profit."""
    p = service.plan(plan_id)
    c = cfg(p["account_id"])
    if not c.get("key_id"):
        raise UserError("This account isn't linked to Alpaca")
    if not c.get("allow_orders"):
        raise UserError("Order placement is off for this account (turn it on in Settings → Accounts)")
    if p["status"] != "planned":
        raise UserError("Only a planned (not yet bought) trade can be sent")
    if p["ticker"].endswith(".ST") or "." in p["ticker"]:
        raise UserError("Alpaca only trades US stocks")
    if not p["stop"] or not p["target"]:
        raise UserError("A bracket order needs both a stop and a target")
    qty = math.floor(p["shares"] or 0)
    if qty < 1:
        raise UserError("Bracket orders need whole shares and this plan sizes to less than 1. Buy fractional "
                        "shares in Alpaca's app instead; the fill will sync here.")
    order = {"symbol": p["ticker"].replace("-", "."), "qty": str(qty), "side": "buy", "time_in_force": "gtc",
             "order_class": "bracket", "client_order_id": f"cockpit-{plan_id}-{int(datetime.now().timestamp())}",
             "take_profit": {"limit_price": round(p["target"], 2)},
             "stop_loss": {"stop_price": round(p["stop"], 2)}}
    if limit:
        order.update(type="limit", limit_price=round(float(limit), 2))
    else:
        order["type"] = "market"
        order["time_in_force"] = "day"
    o = _alpaca(c, "POST", "/v2/orders", json=order)
    db.execute("UPDATE plans SET broker_order_id = ? WHERE id = ?", (o["id"], plan_id))
    return {"id": o["id"], "status": o.get("status"), "qty": qty}


def move_broker_stop(plan_id: int, new_stop: float) -> bool:
    """When a trailing rule raises the stop, move the stop leg of the plan's Alpaca bracket too."""
    p = service.plan(plan_id)
    if not p.get("broker_order_id"):
        return False
    c = cfg(p["account_id"])
    if not (c.get("key_id") and c.get("allow_orders")):
        return False
    o = _alpaca(c, "GET", f"/v2/orders/{p['broker_order_id']}", params={"nested": "true"})
    for leg in o.get("legs") or []:
        if leg.get("type") in ("stop", "stop_limit") and leg.get("status") in ("new", "accepted", "held"):
            _alpaca(c, "PATCH", f"/v2/orders/{leg['id']}", json={"stop_price": round(new_stop, 2)})
            return True
    return False


# ---------- CSV import ----------
def _decode(raw: bytes) -> str:
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return raw.decode("utf-16")
    for enc in ("utf-8-sig", "cp1252"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            pass
    return raw.decode("latin-1")


def _num(s, comma_decimal=True) -> float | None:
    s = str(s or "").strip().replace(" ", "").replace(" ", "")
    if s in ("", "-", "--"):
        return None
    if comma_decimal:
        s = s.replace(".", "").replace(",", ".") if "," in s else s
    else:
        s = s.replace(",", "")
    try:
        return float(s)
    except ValueError:
        return None


def _col(row: dict, *names):
    for n in names:
        for k in row:
            if k and k.strip().lower().startswith(n.lower()):
                return row[k]
    return None


def _date(s: str) -> str:
    s = (s or "").strip().strip('"')
    for fmt in ("%Y-%m-%d", "%Y-%m-%d, %H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y%m%d", "%d/%m/%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%dT%H:%M:%S")
        except ValueError:
            pass
    raise ValueError(f"unrecognised date {s!r}")


def _rid(fmt: str, line) -> str:
    return f"{fmt}:" + hashlib.sha1(json.dumps(line, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]


def _rows(text: str):
    sample = text[:4000]
    delim = max(";\t,", key=lambda d: sample.splitlines()[0].count(d) if sample else 0)
    return list(csv.reader(io.StringIO(text), delimiter=delim))


def parse_csv(raw: bytes) -> dict:
    """Detect the format and return normalised rows: trades {kind:'trade', side, qty, price, currency, fees, fees_ccy}
    and cash {kind:'cash', amount, currency}. Securities are keyed by ISIN or name until mapped to tickers."""
    text = _decode(raw)
    rows = _rows(text)
    if not rows:
        raise UserError("The file is empty")
    if rows[0] and rows[0][0] in ("Statement", "Trades", "Account Information"):
        return _ibkr(rows)
    hdr = [h.strip() for h in rows[0]]
    dicts = [dict(zip(hdr, r)) for r in rows[1:] if any(c.strip() for c in r)]
    low = " ".join(hdr).lower()
    if "typ av transaktion" in low:
        return _avanza(dicts)
    if "transaktionstyp" in low:
        return _nordnet(dicts)
    if any(h.lower() in ("ticker", "symbol") for h in hdr):
        return _generic(dicts)
    raise UserError("Unrecognised CSV. Supported: Avanza and Nordnet transaction exports, an IBKR activity statement, "
                    "or a simple file with columns date,ticker,side,qty,price[,fees,currency]")


def _avanza(dicts) -> dict:
    out = []
    for d in dicts:
        typ = (_col(d, "Typ av transaktion") or "").strip().lower()
        name = (_col(d, "Värdepapper") or "").strip()
        isin = (_col(d, "ISIN") or "").strip()
        ts = _date(_col(d, "Datum") or "")
        ccy = ((_col(d, "Instrumentvaluta") or _col(d, "Valuta") or "SEK").strip() or "SEK").upper()
        acct_ccy = ((_col(d, "Transaktionsvaluta") or "SEK").strip() or "SEK").upper()
        amt = _num(_col(d, "Belopp"))
        if typ in ("köp", "sälj", "köpt", "sålt"):
            q, px = _num(_col(d, "Antal")), _num(_col(d, "Kurs"))
            if not q or not px:
                continue
            out.append({"kind": "trade", "ts": ts, "side": "buy" if typ.startswith("köp") else "sell", "qty": abs(q),
                        "price": px, "currency": ccy, "fees": abs(_num(_col(d, "Courtage")) or 0), "fees_ccy": acct_ccy,
                        "sec": isin or name, "name": name, "isin": isin, "id": _rid("avanza", d)})
        elif typ in ("insättning", "uttag", "utdelning", "utländsk källskatt", "ränta", "skatt") and amt:
            out.append({"kind": "cash", "ts": ts, "amount": amt, "currency": acct_ccy,
                        "note": f"{typ} {name}".strip(), "id": _rid("avanza", d)})
    return {"format": "Avanza", "rows": out}


def _nordnet(dicts) -> dict:
    out = []
    for d in dicts:
        typ = (_col(d, "Transaktionstyp") or "").strip().upper()
        name = (_col(d, "Värdepapper") or "").strip()
        isin = (_col(d, "ISIN") or "").strip()
        ts = _date(_col(d, "Affärsdag", "Bokföringsdag") or "")
        ccy = (_col(d, "Valuta") or "SEK").strip().upper() or "SEK"
        amt = _num(_col(d, "Belopp"))
        if typ in ("KÖPT", "SÅLT"):
            q, px = _num(_col(d, "Antal")), _num(_col(d, "Kurs"))
            if not q or not px:
                continue
            out.append({"kind": "trade", "ts": ts, "side": "buy" if typ == "KÖPT" else "sell", "qty": abs(q),
                        "price": px, "currency": ccy, "fees": abs(_num(_col(d, "Total Avgift", "Courtage")) or 0),
                        "fees_ccy": ccy, "sec": isin or name, "name": name, "isin": isin, "id": _rid("nordnet", d)})
        elif typ in ("INSÄTTNING", "UTTAG", "UTDELNING", "KUPONGSKATT", "RÄNTA") and amt:
            out.append({"kind": "cash", "ts": ts, "amount": amt, "currency": ccy, "note": f"{typ.lower()} {name}".strip(),
                        "id": _rid("nordnet", d)})
    return {"format": "Nordnet", "rows": out}


def _ibkr(rows) -> dict:
    out, hdr = [], {}
    for r in rows:
        if len(r) < 3:
            continue
        sec, kind = r[0], r[1]
        if kind == "Header":
            hdr[sec] = r
            continue
        if kind != "Data" or sec not in hdr:
            continue
        d = dict(zip(hdr[sec], r))
        if sec == "Trades" and d.get("DataDiscriminator", "Order") == "Order" and d.get("Asset Category") == "Stocks":
            q = _num(d.get("Quantity"), False)
            px = _num(d.get("T. Price"), False)
            if not q or not px:
                continue
            sym = d["Symbol"].strip()
            out.append({"kind": "trade", "ts": _date(d["Date/Time"]), "side": "buy" if q > 0 else "sell",
                        "qty": abs(q), "price": px, "currency": d.get("Currency", "USD").upper(),
                        "fees": abs(_num(d.get("Comm/Fee"), False) or 0), "fees_ccy": d.get("Currency", "USD").upper(),
                        "sec": sym, "name": sym, "isin": "", "ticker": sym, "id": _rid("ibkr", d)})
        elif sec == "Deposits & Withdrawals" and not d.get("Currency", "").startswith("Total"):
            amt = _num(d.get("Amount"), False)
            if amt and d.get("Settle Date"):
                out.append({"kind": "cash", "ts": _date(d["Settle Date"]), "amount": amt, "currency": d["Currency"].upper(),
                            "note": d.get("Description", "deposit/withdrawal")[:80], "id": _rid("ibkr", d)})
        elif sec == "Dividends" and d.get("Date"):
            amt = _num(d.get("Amount"), False)
            if amt:
                out.append({"kind": "cash", "ts": _date(d["Date"]), "amount": amt, "currency": d["Currency"].upper(),
                            "note": d.get("Description", "dividend")[:80], "id": _rid("ibkr", d)})
    return {"format": "Interactive Brokers", "rows": out}


def _generic(dicts) -> dict:
    out = []
    for d in dicts:
        side = (_col(d, "side", "action", "type") or "").strip().lower()
        side = "buy" if side in ("buy", "b", "bought", "köp") else "sell" if side in ("sell", "s", "sold", "sälj") else None
        tk = (_col(d, "ticker", "symbol") or "").strip()
        q, px = _num(_col(d, "qty", "quantity", "shares"), False), _num(_col(d, "price"), False)
        if not (side and tk and q and px):
            continue
        ccy = (_col(d, "currency") or "USD").strip().upper() or "USD"
        out.append({"kind": "trade", "ts": _date(_col(d, "date", "time") or ""), "side": side, "qty": abs(q),
                    "price": px, "currency": ccy, "fees": abs(_num(_col(d, "fee", "commission"), False) or 0),
                    "fees_ccy": ccy, "sec": tk, "name": tk, "isin": "", "ticker": tk, "id": _rid("csv", d)})
    return {"format": "Generic CSV", "rows": out}


def resolve_ticker(name: str, isin: str = "") -> str | None:
    """Best-effort Yahoo symbol for a security from a Swedish broker export (ISIN first, then name)."""
    key = f"sym:{isin or name}"
    hit = db.one("SELECT value FROM ai_cache WHERE key = ?", (key,))
    if hit:
        return hit["value"] or None
    sym = None
    try:
        yf = market._yf()
        for q in (isin, name):
            if not q:
                continue
            quotes = [x for x in yf.Search(q, max_results=8).quotes if x.get("quoteType") in ("EQUITY", "ETF")]
            if isin.startswith("SE"):
                quotes.sort(key=lambda x: not str(x.get("symbol", "")).endswith(".ST"))
            if quotes:
                sym = quotes[0]["symbol"]
                break
    except Exception as e:
        log.info("symbol lookup %s failed: %s", name, e)
    db.execute("INSERT OR REPLACE INTO ai_cache(key, ts, value) VALUES (?,?,?)", (key, db.now(), sym or ""))
    return sym


def preview(account_id: int, raw: bytes) -> dict:
    service.account(account_id)
    p = parse_csv(raw)
    secs = {}
    for r in p["rows"]:
        if r["kind"] == "trade" and r["sec"] not in secs:
            secs[r["sec"]] = {"name": r["name"], "isin": r["isin"],
                              "ticker": r.get("ticker") or resolve_ticker(r["name"], r["isin"]) or ""}
    known = {x["ext_id"] for x in db.rows("SELECT ext_id FROM trades WHERE account_id = ? AND ext_id IS NOT NULL"
                                          " UNION SELECT ext_id FROM cash_moves WHERE account_id = ? AND ext_id IS NOT NULL",
                                          (account_id, account_id))}
    for r in p["rows"]:
        r["duplicate"] = r["id"] in known
    p["rows"].sort(key=lambda r: r["ts"])
    p["securities"] = secs
    p["manual_trades"] = db.one("SELECT COUNT(*) AS n FROM trades WHERE account_id = ? AND ext_id IS NULL",
                                (account_id,))["n"]
    return p


def commit(account_id: int, rows: list[dict], mapping: dict) -> dict:
    """Apply previewed rows oldest first. `mapping` maps each security key to a Yahoo ticker ('' = skip)."""
    service.account(account_id)
    counts = {"trades": 0, "cash": 0, "duplicates": 0, "skipped": []}
    for r in sorted(rows, key=lambda r: r["ts"]):
        if r["kind"] == "cash":
            amt = float(r["amount"]) * market.fx_at(r["currency"], r["ts"])
            cur = db.changed("INSERT OR IGNORE INTO cash_moves(account_id, ts, amount, note, ext_id) VALUES (?,?,?,?,?)",
                             (account_id, r["ts"], amt, (r.get("note") or "")[:120], r["id"]))
            counts["cash"] += bool(cur)
            continue
        tk = market.norm(mapping.get(r["sec"], "") or "")
        if not tk:
            counts["skipped"].append(f"{r['ts'][:10]} {r['side']} {r['name']}: no ticker")
            continue
        fx = market.fx_at(r["currency"], r["ts"])
        fees = float(r.get("fees") or 0) * market.fx_at(r.get("fees_ccy") or r["currency"], r["ts"])
        res = service.attach_fill(account_id, ticker=tk, side=r["side"], qty=float(r["qty"]), price=float(r["price"]),
                                  currency=r["currency"], fx=fx, fees=fees, ts=r["ts"], ext_id=r["id"],
                                  source="csv", note="imported")
        if res == "added":
            counts["trades"] += 1
        elif res == "duplicate":
            counts["duplicates"] += 1
        else:
            counts["skipped"].append(f"{r['ts'][:10]} {r['name']}: {res}")
    if db.one("SELECT broker FROM accounts WHERE id = ?", (account_id,))["broker"] is None:
        db.execute("UPDATE accounts SET broker = 'csv' WHERE id = ?", (account_id,))
    _status(account_id, f"CSV import: {counts['trades']} trade(s), {counts['cash']} cash item(s)")
    return counts


# ---------- HTTP ----------
def register(app) -> None:
    @app.post("/api/accounts")
    def api_account_new():
        d = request.get_json(silent=True) or {}
        return jsonify({"id": service.create_account(d.get("name"), d.get("mode", "real"))})

    @app.post("/api/accounts/<int:aid>/alpaca")
    def api_alpaca_link(aid):
        d = request.get_json(silent=True) or {}
        info = link_alpaca(aid, d.get("key_id", ""), d.get("secret", ""), bool(d.get("paper", True)),
                           bool(d.get("allow_orders")))
        return jsonify(dict(info, sync=sync_alpaca(aid)))

    @app.delete("/api/accounts/<int:aid>/broker")
    def api_unlink(aid):
        unlink(aid)
        return jsonify({"ok": True})

    @app.post("/api/accounts/<int:aid>/sync")
    def api_sync(aid):
        return jsonify(sync_alpaca(aid))

    @app.post("/api/accounts/<int:aid>/cash_fix")
    def api_cash_fix(aid):
        d = request.get_json(silent=True) or {}
        service.cash_move(aid, d.get("amount"), "adjustment to match broker")
        return jsonify({"ok": True})

    @app.post("/api/plans/<int:pid>/alpaca_order")
    def api_bracket(pid):
        d = request.get_json(silent=True) or {}
        return jsonify(place_bracket(pid, d.get("limit") or None))

    @app.post("/api/accounts/<int:aid>/import/preview")
    def api_import_preview(aid):
        f = request.files.get("file")
        if not f:
            raise UserError("Choose a CSV file")
        try:
            return jsonify(preview(aid, f.read()))
        except ValueError as e:
            raise UserError(f"Couldn't read the file: {e}")

    @app.post("/api/accounts/<int:aid>/import/commit")
    def api_import_commit(aid):
        d = request.get_json(silent=True) or {}
        return jsonify(commit(aid, d.get("rows", []), d.get("mapping", {})))
