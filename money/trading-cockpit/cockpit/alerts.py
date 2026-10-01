"""Watchlist + alert rules, a background watcher, and phone pushes.

Every alert has a dedupe key (e.g. "stop:12" or "vol:TSLA:2026-10-01"), so each one fires once.
Run standalone with `python -m cockpit.alerts --once` (or `--loop`); the server also runs the loop
in a thread while it's up.
"""
from __future__ import annotations

import argparse
import datetime as dt
import logging
import os
import threading
import time
import xml.etree.ElementTree as ET

import numpy as np
import requests
from flask import jsonify, request

from . import db, market, notify, service
from .service import UserError

log = logging.getLogger("alerts")

RULE_KINDS = {"price_above": "Price rises above", "price_below": "Price falls below",
              "move_pct": "Moves more than ±% in a day"}


# ---------- storage ----------
def ensure_topic() -> None:
    if not db.settings().get("ntfy_topic"):
        db.set_setting("ntfy_topic", notify.new_topic())


def fire(key: str, ticker: str | None, kind: str, title: str, message: str, tags=(), priority: int = 3) -> bool:
    """Log + push once per key. Returns True if this was new."""
    cur_id = None
    with db.connect() as con:
        cur = con.execute("INSERT OR IGNORE INTO alert_log(key, ts, ticker, kind, title, message, sent)"
                          " VALUES (?,?,?,?,?,?,0)", (key, db.now(), ticker, kind, title, message))
        if cur.rowcount:
            cur_id = cur.lastrowid
    if cur_id is None:
        return False
    sent = notify.send(db.settings().get("ntfy_topic", ""), title, message, tags, priority)
    if sent:
        db.execute("UPDATE alert_log SET sent = 1 WHERE id = ?", (cur_id,))
    return True


def watched_tickers() -> list[str]:
    ts = {r["ticker"] for r in db.rows("SELECT ticker FROM watchlist")}
    ts |= {r["ticker"] for r in db.rows("SELECT ticker FROM plans WHERE status IN ('planned','open')")}
    ts |= {r["ticker"] for r in db.rows("SELECT ticker FROM alert_rules WHERE active = 1")}
    return sorted(ts)


# ---------- checks ----------
def _today(ticker: str) -> str:
    tz, _, _ = market.exchange_tz(ticker)
    return dt.datetime.now(tz).strftime("%Y-%m-%d")


def check_plans() -> None:
    s = db.settings()
    plans = db.rows("SELECT p.*, a.mode FROM plans p JOIN accounts a ON a.id = p.account_id"
                    " WHERE p.status IN ('planned','open')")
    for p in plans:
        tk = p["ticker"]
        try:
            q = market.quote(tk)
        except Exception as e:
            log.info("quote %s failed: %s", tk, e)
            continue
        px, live = q["price"], q["open"]
        if p["status"] == "planned":
            if p["entry"] and abs(px / p["entry"] - 1) <= 0.005 and live:
                fire(f"entry:{p['id']}:{_today(tk)}", tk, "entry",
                     f"{tk} is at your planned entry",
                     f"Now {px:.2f}, plan #{p['id']} entry {p['entry']:.2f}. Re-run the check before buying.", ["eyes"])
            continue
        hit = None
        if p["stop"] and px <= p["stop"]:
            hit = ("stop", "hit stop", f"{tk} hit your stop", ["rotating_light"], 5)
        elif p["target"] and px >= p["target"]:
            hit = ("target", "hit target", f"{tk} reached your target", ["dart"], 4)
        if hit:
            kind, reason, title, tags, prio = hit
            level = p["stop"] if kind == "stop" else p["target"]
            if p["mode"] == "paper" and s.get("paper_auto_exit") and live:
                try:
                    service.record_trade(p["id"], "sell", note=f"auto exit: {reason}")
                    service.update_plan(p["id"], {"exit_reason": reason, "followed_plan": 1})
                    fire(f"{kind}:{p['id']}", tk, kind, title + " (paper: sold)",
                         f"Level {level:.2f}, sold near {px:.2f}. Review it in the journal.", tags, prio)
                except Exception as e:
                    log.warning("auto exit plan %s failed: %s", p["id"], e)
            else:
                fire(f"{kind}:{p['id']}", tk, kind, title,
                     f"Now {px:.2f}, your {kind} was {level:.2f}. "
                     + ("Sell at your broker, then record the sell in the cockpit." if p["mode"] == "real"
                        else "Sell it in the cockpit (auto-exit is off or the market is closed)."), tags, prio)
            continue
        # Time stop: held longer than planned.
        first = db.one("SELECT MIN(ts) AS ts FROM trades WHERE plan_id = ? AND side = 'buy'", (p["id"],))
        if first and first["ts"] and p["hold_days"]:
            start = dt.datetime.fromisoformat(first["ts"]).date()
            held = int(np.busday_count(start, dt.date.today()))
            if held >= p["hold_days"]:
                fire(f"time:{p['id']}", tk, "time", f"{tk}: planned hold time is up",
                     f"Held {held} trading days (plan said {p['hold_days']}). Neither stop nor target hit. "
                     "Decide on purpose: sell, or write down why you're extending it.", ["hourglass"])


def check_rules() -> None:
    for r in db.rows("SELECT * FROM alert_rules WHERE active = 1"):
        try:
            q = market.quote(r["ticker"])
        except Exception:
            continue
        px, tk, v = q["price"], r["ticker"], r["value"]
        note = f" ({r['note']})" if r["note"] else ""
        if r["kind"] == "price_above" and px >= v:
            if fire(f"rule:{r['id']}", tk, "price", f"{tk} above {v:g}", f"Now {px:.2f}{note}.", ["chart_with_upwards_trend"]):
                db.execute("UPDATE alert_rules SET active = 0 WHERE id = ?", (r["id"],))
        elif r["kind"] == "price_below" and px <= v:
            if fire(f"rule:{r['id']}", tk, "price", f"{tk} below {v:g}", f"Now {px:.2f}{note}.", ["chart_with_downwards_trend"]):
                db.execute("UPDATE alert_rules SET active = 0 WHERE id = ?", (r["id"],))
        elif r["kind"] == "move_pct" and abs(q["change_pct"]) * 100 >= v:
            fire(f"rule:{r['id']}:{_today(tk)}", tk, "move", f"{tk} {q['change_pct']:+.1%} today",
                 f"Now {px:.2f}{note}.", ["zap"])


def check_market(ticker: str) -> None:
    """Earnings soon, volume spike, 52-week high/low, unusually big move."""
    s = db.settings()
    try:
        h = market.history(ticker)
        q = market.quote(ticker)
    except Exception as e:
        log.info("market check %s: %s", ticker, e)
        return
    today = _today(ticker)
    done = market.completed(h, ticker)
    c, vol = h["Close"], done["Volume"]
    # Earnings
    try:
        nxt = market.earnings(ticker).get("next")
        if nxt:
            days = (dt.date.fromisoformat(nxt[:10]) - dt.date.today()).days
            if 0 <= days <= s["alert_earnings_days"]:
                fire(f"earn:{ticker}:{nxt[:10]}", ticker, "earnings", f"{ticker} reports earnings in {days} day(s)",
                     f"Earnings {nxt[:10]}. Overnight gaps can jump past a stop; decide whether to hold through it.",
                     ["calendar"])
    except Exception:
        pass
    # Volume on the last completed session
    if len(vol) > 60 and vol.iloc[-51:-1].mean() > 0:
        mult = float(vol.iloc[-1] / vol.iloc[-51:-1].mean())
        if mult >= s["alert_volume_mult"]:
            d = done.index[-1].strftime("%Y-%m-%d")
            fire(f"vol:{ticker}:{d}", ticker, "volume", f"{ticker}: {mult:.1f}× normal volume",
                 f"{d} traded {mult:.1f}× its 50-day average volume (close {done['Close'].iloc[-1]:.2f}). Something happened; check the news.",
                 ["loudspeaker"])
    # 52-week high/low vs the prior year (excluding today's bar)
    prior = c[c.index < today][-252:]
    if len(prior) > 200:
        if q["price"] > prior.max():
            fire(f"hi52:{ticker}:{today}", ticker, "52w", f"{ticker} new 52-week high",
                 f"Now {q['price']:.2f}, previous 1-year high {prior.max():.2f}.", ["rocket"])
        elif q["price"] < prior.min():
            fire(f"lo52:{ticker}:{today}", ticker, "52w", f"{ticker} new 52-week low",
                 f"Now {q['price']:.2f}, previous 1-year low {prior.min():.2f}.", ["small_red_triangle_down"])
    # Unusual move for this particular stock
    sd = float(np.log(c).diff().iloc[-61:-1].std())
    if sd > 0 and abs(np.log1p(q["change_pct"])) >= s["alert_move_sigma"] * sd:
        fire(f"move:{ticker}:{today}", ticker, "move", f"{ticker} {q['change_pct']:+.1%} today",
             f"That's {abs(np.log1p(q['change_pct'])) / sd:.1f}× its normal daily swing ({sd:.1%}).", ["zap"])


# ---------- SEC Form 4 insider purchases ----------
_SEC = {"map": None, "map_ts": 0.0}


def _sec_get(url: str, ua: str):
    r = requests.get(url, headers={"User-Agent": ua, "Accept-Encoding": "gzip, deflate"}, timeout=20)
    r.raise_for_status()
    return r


def cik_for(ticker: str, ua: str) -> int | None:
    if _SEC["map"] is None or time.time() - _SEC["map_ts"] > 7 * 86400:
        data = _sec_get("https://www.sec.gov/files/company_tickers.json", ua).json()
        _SEC["map"] = {v["ticker"].upper(): int(v["cik_str"]) for v in data.values()}
        _SEC["map_ts"] = time.time()
    return _SEC["map"].get(ticker.upper().replace(".", "-"))


def parse_form4(xml_text: str) -> list[dict]:
    """Open-market purchases (transaction code P) in a Form 4."""
    root = ET.fromstring(xml_text)
    owner = root.findtext("reportingOwner/reportingOwnerId/rptOwnerName") or "?"
    rel = root.find("reportingOwner/reportingOwnerRelationship")
    role = ""
    if rel is not None:
        role = rel.findtext("officerTitle") or ("Director" if rel.findtext("isDirector") in ("1", "true") else
                                                "10% owner" if rel.findtext("isTenPercentOwner") in ("1", "true") else "")
    out = []
    for t in root.findall("nonDerivativeTable/nonDerivativeTransaction"):
        if (t.findtext("transactionCoding/transactionCode") or "").strip() != "P":
            continue
        try:
            sh = float(t.findtext("transactionAmounts/transactionShares/value") or 0)
            px = float(t.findtext("transactionAmounts/transactionPricePerShare/value") or 0)
        except ValueError:
            continue
        out.append({"owner": owner.title(), "role": role, "shares": sh, "price": px, "value": sh * px,
                    "date": t.findtext("transactionDate/value")})
    return out


def check_insiders(ticker: str, days: int = 5) -> None:
    ua = (db.settings().get("sec_user_agent") or "").strip()
    if not ua or "." in ticker:  # SEC only covers US listings
        return
    try:
        cik = cik_for(ticker, ua)
        if not cik:
            return
        sub = market._memo(("sec_sub", cik), 1800, lambda: _sec_get(
            f"https://data.sec.gov/submissions/CIK{cik:010d}.json", ua).json())
        r = sub["filings"]["recent"]
        cutoff = (dt.date.today() - dt.timedelta(days=days)).isoformat()
        for form, acc, fdate, doc in zip(r["form"], r["accessionNumber"], r["filingDate"], r["primaryDocument"]):
            if fdate < cutoff:
                break
            if form != "4":
                continue
            key = f"insider:{acc}"
            if db.one("SELECT 1 FROM alert_log WHERE key = ?", (key,)):
                continue
            raw = doc.split("/")[-1]
            url = f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc.replace('-', '')}/{raw}"
            buys = parse_form4(_sec_get(url, ua).text)
            time.sleep(0.15)  # SEC asks for <10 requests/second
            if not buys:
                continue
            tot = sum(b["value"] for b in buys)
            b = buys[0]
            fire(key, ticker, "insider", f"{ticker}: insider bought ${tot:,.0f}",
                 f"{b['owner']}{' (' + b['role'] + ')' if b['role'] else ''} bought {sum(x['shares'] for x in buys):,.0f} "
                 f"shares around ${b['price']:.2f} on {b['date']} with their own money (filed {fdate}).",
                 ["moneybag"], 4)
    except Exception as e:
        log.info("insider check %s: %s", ticker, e)


# ---------- runner ----------
def run_once() -> dict:
    t0 = time.time()
    before = db.one("SELECT COUNT(*) AS n FROM alert_log")["n"]
    check_plans()
    check_rules()
    tickers = watched_tickers()
    for tk in tickers:
        check_market(tk)
        check_insiders(tk)
    try:
        from . import lab
        lab.check_signals(fire)
    except ImportError:
        pass
    except Exception as e:
        log.warning("strategy signals failed: %s", e)
    new = db.one("SELECT COUNT(*) AS n FROM alert_log")["n"] - before
    _status.update(last_run=db.now(), last_new=new, last_secs=round(time.time() - t0, 1), tickers=len(tickers))
    log.info("alert scan: %d tickers, %d new alerts, %.1fs", len(tickers), new, time.time() - t0)
    return dict(_status)


_status: dict = {"last_run": None, "last_new": 0, "running": False}


def interval_s() -> int:
    s = db.settings()
    tickers = watched_tickers() + ["SPY"]
    fast = any(market.market_open(t) for t in tickers)
    return int((s["alert_fast_min"] if fast else s["alert_slow_min"]) * 60)


def loop(stop: threading.Event | None = None) -> None:
    stop = stop or threading.Event()
    _status["running"] = True
    nxt = 0.0
    while not stop.is_set():
        if time.time() >= nxt:
            if db.settings().get("alerts_enabled"):
                try:
                    run_once()
                except Exception:
                    log.exception("alert scan failed")
            nxt = time.time() + interval_s()
            _status["next_run"] = dt.datetime.fromtimestamp(nxt, dt.timezone.utc).isoformat(timespec="seconds")
        stop.wait(30)


# ---------- HTTP ----------
def register(app) -> None:
    ensure_topic()

    @app.get("/api/alerts")
    def api_alerts():
        return jsonify({
            "watchlist": db.rows("SELECT * FROM watchlist ORDER BY ticker"),
            "rules": db.rows("SELECT * FROM alert_rules ORDER BY active DESC, id DESC"),
            "log": db.rows("SELECT * FROM alert_log ORDER BY id DESC LIMIT 200"),
            "watched": watched_tickers(), "status": _status, "kinds": RULE_KINDS,
            "topic": db.settings().get("ntfy_topic"),
        })

    @app.post("/api/watchlist")
    def api_watch_add():
        d = request.get_json(silent=True) or {}
        tk = market.norm(d.get("ticker", ""))
        if not tk:
            raise UserError("Enter a ticker")
        try:
            market.history(tk)
        except LookupError as e:
            raise UserError(str(e))
        db.execute("INSERT OR REPLACE INTO watchlist(ticker, note, added_at) VALUES (?,?,?)",
                   (tk, d.get("note", ""), db.now()))
        return jsonify({"ok": True})

    @app.delete("/api/watchlist/<ticker>")
    def api_watch_del(ticker):
        db.execute("DELETE FROM watchlist WHERE ticker = ?", (market.norm(ticker),))
        return jsonify({"ok": True})

    @app.get("/api/watchlist/quotes")
    def api_watch_quotes():
        out = []
        for w in db.rows("SELECT * FROM watchlist ORDER BY ticker"):
            row = dict(w)
            try:
                q = market.quote(w["ticker"])
                e = market.earnings(w["ticker"]).get("next")
                row.update(price=q["price"], change_pct=q["change_pct"], currency=q["currency"], earnings=e)
            except Exception as ex:
                row["error"] = str(ex)
            out.append(row)
        return jsonify(out)

    @app.post("/api/alert_rules")
    def api_rule_add():
        d = request.get_json(silent=True) or {}
        tk = market.norm(d.get("ticker", ""))
        if not tk:
            raise UserError("Enter a ticker")
        if d.get("kind") not in RULE_KINDS:
            raise UserError("Unknown alert type")
        v = service._f(d.get("value"), "Value")
        rid = db.execute("INSERT INTO alert_rules(ticker, kind, value, note, active, created_at) VALUES (?,?,?,?,1,?)",
                         (tk, d["kind"], v, d.get("note", ""), db.now()))
        return jsonify({"id": rid})

    @app.delete("/api/alert_rules/<int:rid>")
    def api_rule_del(rid):
        db.execute("DELETE FROM alert_rules WHERE id = ?", (rid,))
        return jsonify({"ok": True})

    @app.post("/api/alerts/run")
    def api_alerts_run():
        return jsonify(run_once())

    @app.post("/api/alerts/test")
    def api_alerts_test():
        topic = db.settings().get("ntfy_topic")
        if not topic:
            raise UserError("Set an ntfy topic first")
        if not notify.send(topic, "Trading Cockpit test", "Alerts reach your phone.", ["white_check_mark"]):
            raise UserError("ntfy didn't accept the message; check your internet connection")
        return jsonify({"ok": True})

    if os.environ.get("COCKPIT_NO_WATCHER") != "1":
        threading.Thread(target=loop, name="alert-watcher", daemon=True).start()


def main():
    ap = argparse.ArgumentParser(description="Run the alert scan without the web UI.")
    ap.add_argument("--once", action="store_true", help="scan once and exit")
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    db.init()
    ensure_topic()
    if a.once:
        print(run_once())
    else:
        loop()


if __name__ == "__main__":
    main()
