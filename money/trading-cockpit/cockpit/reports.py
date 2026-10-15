"""Morning briefing, Friday weekly report, and the clock that runs them (plus the nightly screener and coach)."""
from __future__ import annotations

import html
import logging
import threading
from datetime import datetime, timedelta, timezone

from flask import Response, abort, jsonify, request

from . import db, ledger, manage, market, service
from .service import UserError

log = logging.getLogger("reports")


def _fire(*a, **kw):
    from . import alerts
    return alerts.fire(*a, **kw)


def _link(path: str) -> str | None:
    base = (db.settings().get("public_url") or "").rstrip("/")
    return base + path if base else None


# ---------- morning briefing ----------
def briefing() -> dict:
    """What needs attention today, across all accounts. Facts only: levels, dates, rules."""
    items = []
    for a in service.accounts():
        try:
            st = service.state(a["id"])
        except Exception as e:
            log.warning("briefing state %s: %s", a["id"], e)
            continue
        g = manage.guardrails(a["id"], st["equity"])
        for b in g["blocks"]:
            items.append({"level": "bad", "account": a["name"], "text": b["text"]})
        for p in st["plans"]:
            tk, px = p["ticker"], p.get("price")
            if p["status"] == "open" and px and p.get("stop"):
                gap = px / p["stop"] - 1
                if gap < 0.03:
                    items.append({"level": "warn", "account": a["name"], "ticker": tk, "plan": p["id"],
                                  "text": f"{tk} is {gap:.1%} above its stop {p['stop']:.2f} (now {px:.2f})."})
                if p.get("target") and px >= p["target"] * 0.98:
                    items.append({"level": "info", "account": a["name"], "ticker": tk, "plan": p["id"],
                                  "text": f"{tk} is within 2% of its target {p['target']:.2f}."})
                if p.get("hold_days") and p.get("first_buy"):
                    held = (datetime.now(timezone.utc).replace(tzinfo=None) - datetime.fromisoformat(p["first_buy"][:19])).days
                    if held >= p["hold_days"]:
                        items.append({"level": "info", "account": a["name"], "ticker": tk, "plan": p["id"],
                                      "text": f"{tk}: held {held} days vs a {p['hold_days']}-day plan. Exit or re-plan."})
            if p["status"] == "planned" and px and p.get("entry"):
                d = px / p["entry"] - 1
                if abs(d) <= 0.02:
                    items.append({"level": "info", "account": a["name"], "ticker": tk, "plan": p["id"],
                                  "text": f"{tk} is {d:+.1%} from your planned entry {p['entry']:.2f}."})
                elif px < p["stop"]:
                    items.append({"level": "warn", "account": a["name"], "ticker": tk, "plan": p["id"],
                                  "text": f"{tk} is below your planned stop. The setup is broken; cancel the plan?"})
            try:
                e = market.earnings(tk)
                if e.get("next"):
                    days = (datetime.fromisoformat(e["next"][:10]).date() - datetime.now().date()).days
                    if 0 <= days <= 2:
                        items.append({"level": "warn", "account": a["name"], "ticker": tk, "plan": p["id"],
                                      "text": f"{tk} reports earnings in {days} day(s) ({e['next'][:10]})."})
            except Exception:
                pass
        if st["heat_pct"] > db.settings()["max_heat_pct"]:
            items.append({"level": "warn", "account": a["name"],
                          "text": f"Open risk is {st['heat_pct']:.1%} of equity, above your {db.settings()['max_heat_pct']:.0%} cap."})
    since = (datetime.now(timezone.utc) - timedelta(hours=18)).isoformat()
    sig = db.rows("SELECT ticker, title FROM alert_log WHERE kind = 'strategy' AND ts >= ? ORDER BY ts DESC", (since,))
    hits = db.rows("SELECT s.name, h.ticker FROM screen_hits h JOIN screens s ON s.id = h.screen_id"
                   " WHERE h.created_at >= ? ORDER BY s.name, h.dollar_vol DESC", (since,))
    by_screen = {}
    for h in hits:
        by_screen.setdefault(h["name"], []).append(h["ticker"])
    return {"ts": db.now(), "items": items, "signals": sig, "screens": by_screen}


def briefing_text(b: dict) -> str:
    lines = []
    for it in b["items"][:12]:
        lines.append(("⛔ " if it["level"] == "bad" else "⚠️ " if it["level"] == "warn" else "• ") + it["text"])
    if b["signals"]:
        lines.append("🧪 Lab signals: " + ", ".join(sorted({s["ticker"] for s in b["signals"]})))
    for name, tks in b["screens"].items():
        lines.append(f"🔎 {name}: " + ", ".join(tks[:10]) + ("…" if len(tks) > 10 else ""))
    return "\n".join(lines) or "Nothing needs attention. Stick to the plan."


def send_briefing(day: str) -> None:
    b = briefing()
    _fire(f"briefing:{day}", None, "briefing", f"Morning briefing: {len(b['items'])} item(s)", briefing_text(b),
          ["sunrise"], click=_link("/#today"))


# ---------- weekly report ----------
def _fmt_money(v):
    return "–" if v is None else f"{'-' if v < 0 else ''}${abs(v):,.2f}"


def weekly_report(account_id: int, end: datetime | None = None) -> dict:
    end = end or datetime.now(timezone.utc)
    start = end - timedelta(days=7)
    a = service.account(account_id)
    st = service.state(account_id)
    j = service.journal(account_id)
    s0, s1 = start.isoformat(), end.isoformat()
    week = [p for p in j["plans"] if p["status"] == "closed" and s0 <= (p.get("closed_at") or "") <= s1]
    opened = [p for p in j["plans"] if p.get("first_buy") and s0 <= p["first_buy"] <= s1]
    realized = sum(r["gain"] for r in j["realized"] if s0 <= r["close_ts"] <= s1)
    rs = [p["r_multiple"] for p in week if p.get("r_multiple") is not None]
    followed = [p for p in week if p.get("followed_plan") is not None]
    overrides = [p for p in j["plans"] if p.get("override_reason") and s0 <= (p.get("first_buy") or "") <= s1]
    unplanned = [p for p in opened if p.get("source") == "broker"]
    cur = service.curve(account_id)
    pts = cur.get("points", [])
    eq_then = next((p for p in reversed(pts) if p["t"] <= start.strftime("%Y-%m-%d")), None)
    spy_then = eq_then["spy"] if eq_then else None
    wk_ret = (st["equity"] - eq_then["value"] - (st["deposits"] - eq_then["deposits"])) / eq_then["value"] \
        if eq_then and eq_then["value"] else None
    spy_ret = (cur["spy"] / spy_then - 1) if spy_then else None
    ae = {r["id"]: r for r in j["after_exit"].get("rows", [])}
    summary = (f"Realized {_fmt_money(realized)} on {len(week)} closed trade(s)"
               + (f", avg {sum(rs) / len(rs):+.2f}R" if rs else "")
               + (f". Account {wk_ret:+.1%} vs SPY {spy_ret:+.1%}" if wk_ret is not None and spy_ret is not None else "")
               + f". Equity {_fmt_money(st['equity'])}.")
    esc = html.escape
    def r_cell(v):
        return "" if v is None else f"{v:+.2f}R"

    def row(p):
        fp = p.get("followed_plan")
        return (f"<tr><td>#{p['id']}</td><td>{esc(p['ticker'])}</td><td>{esc(p.get('setup') or '')}</td>"
                f"<td class=n>{_fmt_money(p['realized'])}</td><td class=n>{r_cell(p.get('r_multiple'))}</td>"
                f"<td>{esc(p.get('exit_reason') or '')}</td><td>{'' if fp is None else ('yes' if fp else 'no')}</td>"
                f"<td class=n>{r_cell(ae[p['id']]['close10_r'] if p['id'] in ae else None)}</td></tr>")

    rows = "".join(row(p) for p in week) or "<tr><td colspan=8 class=muted>No trades closed this week.</td></tr>"
    pos = "".join(f"<tr><td>{esc(p['ticker'])}</td><td class=n>{p['qty']:g}</td><td class=n>{_fmt_money(p.get('value') or p['cost'])}</td>"
                  f"<td class=n>{_fmt_money(p.get('unrealized'))}</td></tr>" for p in st["positions"]) \
        or "<tr><td colspan=4 class=muted>No open positions.</td></tr>"
    discipline = []
    if followed:
        discipline.append(f"Followed the plan on {sum(1 for p in followed if p['followed_plan'])} of {len(followed)} closed trades.")
    if overrides:
        discipline.append(f"Overrode a guardrail {len(overrides)} time(s): " + "; ".join(esc(p["override_reason"][:80]) for p in overrides))
    if unplanned:
        discipline.append(f"{len(unplanned)} trade(s) at the broker had no plan: " + ", ".join(esc(p["ticker"]) for p in unplanned))
    g = j["guardrails"]
    discipline.append(f"Losing streak now: {g['streak']}.")
    coach = db.one("SELECT id, ts, summary FROM reports WHERE kind = 'coach' AND account_id = ? ORDER BY id DESC LIMIT 1",
                   (account_id,))
    body = f"""<h1>Week ending {end.astimezone().strftime('%a %d %b %Y')} · {esc(a['name'])}</h1>
<p class=lead>{esc(summary)}</p>
<div class=kpis><div><b>{_fmt_money(st['equity'])}</b><span>equity</span></div>
<div><b>{'' if wk_ret is None else f'{wk_ret:+.1%}'}</b><span>account this week</span></div>
<div><b>{'' if spy_ret is None else f'{spy_ret:+.1%}'}</b><span>SPY this week</span></div>
<div><b>{_fmt_money(realized)}</b><span>realized</span></div>
<div><b>{len(opened)}</b><span>new positions</span></div>
<div><b>{st['heat_pct']:.1%}</b><span>open risk</span></div></div>
<h2>Closed this week</h2><table><tr><th>Plan</th><th>Ticker</th><th>Setup</th><th>P/L</th><th>R</th><th>Exit</th><th>Followed plan</th><th>10 days after exit</th></tr>{rows}</table>
<h2>Discipline</h2><ul>{''.join(f'<li>{d}</li>' for d in discipline)}</ul>
<h2>Open positions</h2><table><tr><th>Ticker</th><th>Qty</th><th>Value</th><th>Unrealized</th></tr>{pos}</table>
{f'<h2>Latest coach note</h2><p>{esc(coach["summary"])} <a href="/#today">read it</a></p>' if coach else ''}
<p class=muted>"10 days after exit" is where the price went after you sold, in R. Positive means it kept rising.
Past results don't predict future ones.</p>"""
    rid = db.execute("INSERT INTO reports(kind, account_id, ts, title, summary, body) VALUES ('weekly',?,?,?,?,?)",
                     (account_id, db.now(), f"Weekly: {a['name']} {end.strftime('%Y-%m-%d')}", summary, body))
    return {"id": rid, "summary": summary}


PAGE = """<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>{title}</title><style>
body{{font:15px/1.5 system-ui,sans-serif;max-width:860px;margin:0 auto;padding:16px;background:#0f1419;color:#e6e6e6}}
h1{{font-size:22px}}h2{{font-size:17px;margin-top:28px;border-bottom:1px solid #2a323c;padding-bottom:4px}}
table{{width:100%;border-collapse:collapse;font-size:14px;display:block;overflow-x:auto}}th,td{{padding:5px 8px;border-bottom:1px solid #222a33;text-align:left}}
.n{{text-align:right;font-variant-numeric:tabular-nums}}.muted{{color:#8a95a3}}.lead{{font-size:17px}}a{{color:#6cb6ff}}
.kpis{{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px}}.kpis div{{background:#182029;padding:10px;border-radius:8px}}
.kpis b{{display:block;font-size:18px}}.kpis span{{color:#8a95a3;font-size:12px}}
pre{{white-space:pre-wrap;font:inherit}}
</style></head><body><p><a href="/">← cockpit</a></p>{body}</body></html>"""


def send_weekly(day: str) -> None:
    s = db.settings()
    for a in service.accounts():
        if not db.one("SELECT 1 FROM trades WHERE account_id = ? LIMIT 1", (a["id"],)):
            continue
        if s.get("coach_weekly"):
            try:
                from . import ai
                if ai.api_key():
                    ai.coach(a["id"])
            except UserError as e:
                log.info("coach skipped for %s: %s", a["name"], e)
            except Exception as e:
                log.warning("coach failed for %s: %s", a["name"], e)
        r = weekly_report(a["id"])
        _fire(f"weekly:{a['id']}:{day}", None, "weekly", f"Weekly report: {a['name']}", r["summary"],
              ["bar_chart"], click=_link(f"/reports/{r['id']}"))


# ---------- clock ----------
_sched = {"last": {}}


def _due(key: str, day: str) -> bool:
    k = f"sched:{key}:{day}"
    if db.one("SELECT 1 FROM ai_cache WHERE key = ?", (k,)):
        return False
    db.execute("INSERT OR IGNORE INTO ai_cache(key, ts, value) VALUES (?,?,?)", (k, db.now(), "1"))
    return True


def tick(now: datetime | None = None) -> list[str]:
    """Run whatever is due. Each job runs at most once per local day; a missed time runs late the same day."""
    s = db.settings()
    now = now or manage._local_now()
    day, hm, wd = now.strftime("%Y-%m-%d"), now.strftime("%H:%M"), now.weekday()
    ran = []
    if wd < 5 and s.get("briefing_enabled") and hm >= (s.get("briefing_time") or "08:30") and _due("briefing", day):
        send_briefing(day)
        ran.append("briefing")
    if wd < 5 and hm >= (s.get("screener_time") or "22:30") and _due("screener", day):
        from . import screener
        screener.run_all(_fire)
        ran.append("screener")
    if wd < 5 and hm >= (s.get("screener_time") or "22:30") and _due("evolution", day):
        from . import evolve
        evolve.daily(_fire)
        ran.append("evolution")
    if wd == 4 and s.get("weekly_report") and hm >= (s.get("screener_time") or "22:30") and _due("weekly", day):
        send_weekly(day)
        ran.append("weekly")
    return ran


def scheduler(stop: threading.Event | None = None) -> None:
    stop = stop or threading.Event()
    while not stop.is_set():
        try:
            ran = tick()
            if ran:
                log.info("scheduled: %s", ", ".join(ran))
                _sched["last"] = {"ts": db.now(), "ran": ran}
        except Exception:
            log.exception("scheduler tick failed")
        stop.wait(60)


# ---------- HTTP ----------
def register(app) -> None:
    @app.get("/api/today")
    def api_today():
        b = briefing()
        reps = db.rows("SELECT id, kind, account_id, ts, title, summary FROM reports ORDER BY id DESC LIMIT 20")
        from . import ai
        return jsonify({"briefing": b, "text": briefing_text(b), "reports": reps, "ai": bool(ai.api_key()),
                        "guardrails": {a["id"]: manage.guardrails(a["id"]) for a in service.accounts()}})

    @app.post("/api/briefing/send")
    def api_briefing_send():
        b = briefing()
        from . import alerts
        alerts.fire(f"briefing:manual:{db.now()}", None, "briefing", f"Briefing: {len(b['items'])} item(s)",
                    briefing_text(b), ["sunrise"], click=_link("/#today"))
        return jsonify({"ok": True})

    @app.post("/api/accounts/<int:aid>/weekly")
    def api_weekly(aid):
        return jsonify(weekly_report(aid))

    @app.get("/api/reports/<int:rid>")
    def api_report(rid):
        r = db.one("SELECT * FROM reports WHERE id = ?", (rid,))
        if not r:
            raise UserError("No such report")
        return jsonify(r)

    @app.delete("/api/reports/<int:rid>")
    def api_report_del(rid):
        db.execute("DELETE FROM reports WHERE id = ?", (rid,))
        return jsonify({"ok": True})

    @app.get("/reports/<int:rid>")
    def report_page(rid):
        r = db.one("SELECT * FROM reports WHERE id = ?", (rid,))
        if not r:
            abort(404)
        body = r["body"] if r["kind"] == "weekly" else f"<h1>{html.escape(r['title'])}</h1><pre>{html.escape(r['body'])}</pre>"
        return Response(PAGE.format(title=html.escape(r["title"]), body=body), mimetype="text/html")

    @app.post("/api/accounts/<int:aid>/coach")
    def api_coach(aid):
        from . import ai
        return jsonify(ai.coach(aid))

    @app.get("/api/news/<ticker>")
    def api_news(ticker):
        from . import ai
        return jsonify({"items": ai.news(ticker), "ai": bool(ai.api_key())})

    @app.post("/api/news/<ticker>/summary")
    def api_news_summary(ticker):
        from . import ai
        return jsonify(ai.news_summary(ticker, refresh=bool((request.get_json(silent=True) or {}).get("refresh"))))
