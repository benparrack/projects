"""Small endpoints behind the dashboard UI: market clocks, ticker search, the ticker quick-view and upcoming earnings."""
from __future__ import annotations

import datetime as dt
import logging
from concurrent.futures import ThreadPoolExecutor

from flask import jsonify, request

from . import db, market, screener

log = logging.getLogger("dash")

MARKETS = [("US", "SPY"), ("Stockholm", "VOLV-B.ST")]


def market_clock(ticker: str, at: dt.datetime | None = None) -> dict:
    """Open/closed now and when that next changes (weekends skipped; exchange holidays are not known)."""
    tz, o, c = market.exchange_tz(ticker)
    now = (at or dt.datetime.now(dt.timezone.utc)).astimezone(tz)
    is_open = market.market_open(ticker, now)
    if is_open:
        nxt = dt.datetime.combine(now.date(), c, tz)
    else:
        day = now.date()
        if now.weekday() < 5 and now.time() < o:
            nxt_day = day
        else:
            nxt_day = day + dt.timedelta(days=1)
            while nxt_day.weekday() >= 5:
                nxt_day += dt.timedelta(days=1)
        nxt = dt.datetime.combine(nxt_day, o, tz)
    return {"open": is_open, "next": nxt.astimezone(dt.timezone.utc).isoformat(timespec="seconds"),
            "local_time": now.strftime("%H:%M"), "tz": str(tz)}


_UNI: list[dict] | None = None


def _universe_index() -> list[dict]:
    global _UNI
    if _UNI is None:
        seen, out = set(), []
        for u in ("sp500", "omxs", "volatile"):
            for r in screener.universe(u):
                if r["ticker"] not in seen:
                    seen.add(r["ticker"])
                    out.append({"ticker": r["ticker"], "name": r.get("name") or "", "sector": r.get("sector") or ""})
        _UNI = out
    return _UNI


def search(q: str, limit: int = 12) -> list[dict]:
    """Rank tickers you hold/plan/watch first, then exact, prefix and name matches from the bundled universes."""
    q = (q or "").strip().upper()
    mine = {r["ticker"]: "watching" for r in db.rows("SELECT ticker FROM watchlist")}
    for r in db.rows("SELECT DISTINCT ticker, status FROM plans WHERE status IN ('open','planned')"):
        mine[r["ticker"]] = "holding" if r["status"] == "open" else "planned"
    names = {r["ticker"]: r for r in _universe_index()}
    if not q:
        return [{"ticker": t, "name": names.get(t, {}).get("name", ""), "tag": tag} for t, tag in mine.items()][:limit]
    scored = []
    for t in set(names) | set(mine):
        n = names.get(t, {}).get("name", "")
        base = t.split(".")[0]
        if t == q or base == q:
            s = 0
        elif t.startswith(q):
            s = 1
        elif q in n.upper():
            s = 2 + (0 if n.upper().startswith(q) else 1)
        elif q in t:
            s = 4
        else:
            continue
        if t in mine:
            s -= 0.5
        scored.append((s, len(t), t, n))
    scored.sort()
    out = [{"ticker": t, "name": n, "tag": mine.get(t, "")} for _, _, t, n in scored[:limit]]
    # Anything that looks like a ticker can still be opened even if it isn't in the bundled lists.
    if q and not any(r["ticker"] == q for r in out) and len(q) <= 12 and all(ch.isalnum() or ch in ".-^=" for ch in q):
        out.append({"ticker": q, "name": "Look up this ticker", "tag": ""})
    return out


def quick(ticker: str) -> dict:
    t = market.norm(ticker)
    q = market.quote(t)
    inf = {}
    try:
        inf = market.info(t)
    except Exception:
        pass
    df = market.history(t, years=1)
    closes = [{"t": d.strftime("%Y-%m-%d"), "c": round(float(c), 4)} for d, c in df["Close"].tail(130).items()]
    hi, lo = float(df["High"].max()), float(df["Low"].min())
    try:
        nxt = market.earnings(t).get("next")
    except Exception:
        nxt = None
    plans = db.rows("SELECT p.id, p.account_id, a.name AS account, p.status, p.entry, p.stop, p.target, p.setup "
                    "FROM plans p JOIN accounts a ON a.id = p.account_id "
                    "WHERE p.ticker = ? AND p.status IN ('open','planned') ORDER BY p.id DESC", (t,))
    w = db.one("SELECT note FROM watchlist WHERE ticker = ?", (t,))
    return {"ticker": t, "name": inf.get("shortName") or inf.get("longName") or "", "sector": inf.get("sector") or "",
            "quote": q, "closes": closes, "high_52w": hi, "low_52w": lo,
            "from_high": q["price"] / hi - 1 if hi else None, "earnings": nxt, "plans": plans,
            "watched": w is not None, "watch_note": w["note"] if w else ""}


def upcoming(account_id: int, days: int = 30) -> list[dict]:
    """Next earnings for what this account holds or plans, plus the watchlist, within `days`."""
    why: dict[str, str] = {}
    for r in db.rows("SELECT ticker FROM watchlist"):
        why[r["ticker"]] = "watching"
    for r in db.rows("SELECT DISTINCT ticker, status FROM plans WHERE account_id = ? AND status IN ('open','planned')",
                     (account_id,)):
        if why.get(r["ticker"]) != "holding":
            why[r["ticker"]] = "holding" if r["status"] == "open" else "planned"

    def one(t):
        try:
            return t, market.earnings(t).get("next")
        except Exception as e:
            log.info("earnings %s: %s", t, e)
            return t, None

    today = dt.date.today()
    out = []
    with ThreadPoolExecutor(6) as ex:
        for t, nxt in ex.map(one, list(why)[:60]):
            if not nxt:
                continue
            try:
                d = dt.date.fromisoformat(str(nxt)[:10])
            except ValueError:
                continue
            n = (d - today).days
            if 0 <= n <= days:
                out.append({"ticker": t, "date": d.isoformat(), "days": n, "why": why[t]})
    return sorted(out, key=lambda r: (r["days"], r["ticker"]))


def register(app) -> None:
    @app.get("/api/markets")
    def api_markets():
        return jsonify([dict(market_clock(t), name=n) for n, t in MARKETS])

    @app.get("/api/search")
    def api_search():
        return jsonify(search(request.args.get("q", "")))

    @app.get("/api/quick/<ticker>")
    def api_quick(ticker):
        return jsonify(quick(ticker))

    @app.get("/api/accounts/<int:aid>/upcoming")
    def api_upcoming(aid):
        return jsonify(upcoming(aid, int(request.args.get("days", 30))))
