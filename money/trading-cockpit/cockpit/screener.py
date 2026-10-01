"""Daily screener: run a Lab rule plus simple liquidity/volatility filters over a universe of stocks."""
from __future__ import annotations

import csv
import logging
from pathlib import Path

import numpy as np
from flask import jsonify, request

from . import db, lab, market
from .service import UserError, _f

log = logging.getLogger("screener")
UNIVERSES = {"sp500": "S&P 500", "omxs": "Stockholm large/mid cap", "volatile": "Volatile US names (60)",
             "watchlist": "My watchlist"}
_DIR = Path(__file__).parent / "universes"


def universe(name: str) -> list[dict]:
    if name == "watchlist":
        return [{"ticker": w["ticker"], "name": w["note"] or "", "sector": ""}
                for w in db.rows("SELECT * FROM watchlist ORDER BY ticker")]
    if name not in UNIVERSES:
        raise UserError("Unknown universe")
    with open(_DIR / f"{name}.csv", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _clean_screen(d: dict) -> dict:
    rule = (d.get("rule") or "").strip()
    if not rule:
        raise UserError("Write a rule (e.g. close > highest(high, 20))")
    lab.parse(rule)
    u = d.get("universe") or "sp500"
    universe(u)
    num = lambda k: _f(d[k], k.replace("_", " "), positive=False) if d.get(k) not in (None, "") else None
    return {"name": (d.get("name") or "").strip()[:80], "rule": rule, "universe": u, "min_price": num("min_price"),
            "min_dollar_vol": num("min_dollar_vol"), "min_atr_pct": num("min_atr_pct"), "alert": int(bool(d.get("alert")))}


def run(d: dict) -> dict:
    """Evaluate on each stock's last COMPLETED session. min_dollar_vol is in $ millions/day, min_atr_pct in %."""
    sc = _clean_screen(d)
    uni = universe(sc["universe"])
    tickers = [u["ticker"] for u in uni]
    names = {u["ticker"]: u for u in uni}
    market.prefetch(tickers, years=2)
    hits, errors = [], 0
    fx_cache = {}
    for tk in tickers:
        try:
            df = market.completed(market.history(tk, years=2), tk)
        except Exception:
            errors += 1
            continue
        if len(df) < 60:
            continue
        c = float(df["Close"].iat[-1])
        ccy = "SEK" if tk.endswith(".ST") else "USD"
        if ccy not in fx_cache:
            fx_cache[ccy] = market.fx(ccy)
        dvol = float((df["Close"] * df["Volume"]).iloc[-20:].mean()) * fx_cache[ccy]
        atr_pct = float(lab._atr(df, 14).iat[-1] / c * 100)
        if sc["min_price"] is not None and c < sc["min_price"]:
            continue
        if sc["min_dollar_vol"] is not None and dvol < sc["min_dollar_vol"] * 1e6:
            continue
        if sc["min_atr_pct"] is not None and atr_pct < sc["min_atr_pct"]:
            continue
        try:
            if not bool(lab.evaluate(sc["rule"], df).iat[-1]):
                continue
        except UserError:
            raise
        except Exception:
            errors += 1
            continue
        hits.append({"ticker": tk, "name": names[tk].get("name", ""), "sector": names[tk].get("sector", ""),
                     "day": df.index[-1].strftime("%Y-%m-%d"), "close": c, "atr_pct": atr_pct,
                     "dollar_vol": dvol, "change_pct": c / float(df["Close"].iat[-2]) - 1,
                     "currency": ccy})
    hits.sort(key=lambda h: -h["dollar_vol"])
    return {"screen": sc, "hits": hits, "scanned": len(tickers), "errors": errors}


def run_saved(screen_id: int, fire=None) -> dict:
    s = db.one("SELECT * FROM screens WHERE id = ?", (screen_id,))
    if not s:
        raise UserError("No such screen")
    res = run(s)
    for h in res["hits"]:
        db.execute("INSERT OR IGNORE INTO screen_hits(screen_id, day, ticker, close, atr_pct, dollar_vol, change_pct,"
                   " created_at) VALUES (?,?,?,?,?,?,?,?)",
                   (screen_id, h["day"], h["ticker"], h["close"], h["atr_pct"], h["dollar_vol"], h["change_pct"], db.now()))
    if fire and s["alert"] and res["hits"]:
        day = res["hits"][0]["day"]
        names = ", ".join(h["ticker"] for h in res["hits"][:15]) + ("…" if len(res["hits"]) > 15 else "")
        fire(f"screen:{screen_id}:{day}", None, "screen", f"Screen '{s['name']}': {len(res['hits'])} hit(s)",
             names, ["mag"])
    return res


def run_all(fire=None) -> list[str]:
    out = []
    for s in db.rows("SELECT id, name FROM screens ORDER BY id"):
        try:
            out.append(f"{s['name']}: {len(run_saved(s['id'], fire)['hits'])} hits")
        except Exception as e:
            log.warning("screen %s failed: %s", s["id"], e)
    return out


def register(app) -> None:
    @app.get("/api/screener")
    def api_screens():
        screens = db.rows("SELECT * FROM screens ORDER BY id DESC")
        for s in screens:
            last = db.one("SELECT MAX(day) AS d FROM screen_hits WHERE screen_id = ?", (s["id"],))["d"]
            s["last_day"] = last
            s["hits"] = db.rows("SELECT * FROM screen_hits WHERE screen_id = ? AND day = ? ORDER BY dollar_vol DESC",
                                (s["id"], last)) if last else []
        return jsonify({"screens": screens, "universes": UNIVERSES,
                        "time": db.settings()["screener_time"]})

    @app.post("/api/screener/run")
    def api_screen_run():
        return jsonify(run(request.get_json(silent=True) or {}))

    @app.post("/api/screener")
    def api_screen_save():
        sc = _clean_screen(request.get_json(silent=True) or {})
        if not sc["name"]:
            raise UserError("Give the screen a name")
        sid = db.execute("INSERT INTO screens(name, rule, universe, min_price, min_dollar_vol, min_atr_pct, alert,"
                         " created_at) VALUES (?,?,?,?,?,?,?,?)",
                         (sc["name"], sc["rule"], sc["universe"], sc["min_price"], sc["min_dollar_vol"],
                          sc["min_atr_pct"], sc["alert"], db.now()))
        return jsonify({"id": sid})

    @app.post("/api/screener/<int:sid>/run")
    def api_screen_run_saved(sid):
        return jsonify(run_saved(sid))

    @app.patch("/api/screener/<int:sid>")
    def api_screen_patch(sid):
        d = request.get_json(silent=True) or {}
        if "alert" in d:
            db.execute("UPDATE screens SET alert = ? WHERE id = ?", (int(bool(d["alert"])), sid))
        return jsonify({"ok": True})

    @app.delete("/api/screener/<int:sid>")
    def api_screen_del(sid):
        db.execute("DELETE FROM screen_hits WHERE screen_id = ?", (sid,))
        db.execute("DELETE FROM screens WHERE id = ?", (sid,))
        return jsonify({"ok": True})
