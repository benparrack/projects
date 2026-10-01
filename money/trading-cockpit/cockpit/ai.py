"""News headlines, Claude-written summaries, and the weekly journal coach.

Everything AI is optional: without an Anthropic API key the cockpit shows plain headlines and skips the coach."""
from __future__ import annotations

import hashlib
import json
import logging
import os
from datetime import datetime, timedelta, timezone

import requests

from . import db, ledger, market, service
from .service import UserError

log = logging.getLogger("ai")
API = "https://api.anthropic.com/v1/messages"


def api_key() -> str:
    return (db.settings().get("anthropic_api_key") or os.environ.get("ANTHROPIC_API_KEY") or "").strip()


def ask(system: str, prompt: str, model: str | None = None, max_tokens: int = 1200) -> str:
    key = api_key()
    if not key:
        raise UserError("Add an Anthropic API key in Settings (or set ANTHROPIC_API_KEY) to use AI features")
    s = db.settings()
    try:
        r = requests.post(API, timeout=120, headers={"x-api-key": key, "anthropic-version": "2023-06-01",
                                                     "content-type": "application/json"},
                          json={"model": model or s["ai_model"], "max_tokens": max_tokens, "system": system,
                                "messages": [{"role": "user", "content": prompt}]})
    except requests.RequestException as e:
        raise UserError(f"Couldn't reach the Anthropic API: {e}")
    if r.status_code >= 400:
        try:
            msg = r.json()["error"]["message"]
        except Exception:
            msg = r.text[:200]
        raise UserError(f"Anthropic API: {msg}")
    return "".join(b.get("text", "") for b in r.json().get("content", []) if b.get("type") == "text").strip()


def _cache_get(key: str, max_age: timedelta | None = None):
    hit = db.one("SELECT ts, value FROM ai_cache WHERE key = ?", (key,))
    if not hit:
        return None
    if max_age and datetime.fromisoformat(hit["ts"]) < datetime.now(timezone.utc) - max_age:
        return None
    return json.loads(hit["value"])


def _cache_put(key: str, value) -> None:
    db.execute("INSERT OR REPLACE INTO ai_cache(key, ts, value) VALUES (?,?,?)", (key, db.now(), json.dumps(value)))


# ---------- news ----------
def _item(n: dict) -> dict | None:
    c = n.get("content") or n  # yfinance ≥0.2.50 nests everything under "content"
    title = c.get("title")
    if not title:
        return None
    ts = c.get("pubDate") or c.get("displayTime")
    if not ts and n.get("providerPublishTime"):
        ts = datetime.fromtimestamp(n["providerPublishTime"], timezone.utc).isoformat()
    ts = (ts or "").replace("Z", "")
    link = ((c.get("clickThroughUrl") or {}).get("url") or (c.get("canonicalUrl") or {}).get("url")
            or n.get("link"))
    pub = (c.get("provider") or {}).get("displayName") or n.get("publisher") or ""
    return {"title": title, "publisher": pub, "time": (ts or "")[:16].replace("T", " "), "link": link,
            "summary": (c.get("summary") or "")[:400]}


def news(ticker: str, limit: int = 10) -> list[dict]:
    tk = market.norm(ticker)

    def load():
        raw = []
        def by_name():
            inf = market.info(tk)
            name = (inf.get("shortName") or inf.get("longName") or "").replace("(publ)", "").strip()
            return market._yf().Search(name, news_count=limit).news if name else []
        for get in (lambda: market._yf().Ticker(tk).news, lambda: market._yf().Search(tk, news_count=limit).news,
                    by_name):
            try:
                raw = get() or []
            except Exception as e:
                log.info("news %s failed: %s", tk, e)
            if raw:
                break
        seen, items = set(), []
        for x in (_item(n) for n in raw):
            if x and x["title"] not in seen:
                seen.add(x["title"])
                items.append(x)
        return sorted(items, key=lambda x: x["time"], reverse=True)[:limit]

    return market._memo(("news", tk), 900, load)


SUMMARY_SYSTEM = (
    "You summarise recent news about one stock for a retail trader. Use ONLY the headlines and snippets given; "
    "don't add outside facts or predictions. Write 2-4 short bullet points (start each with '- '): what happened, "
    "anything scheduled (earnings, rulings, launches), and whether the coverage is mostly about the company or "
    "just market noise. If the headlines are thin or irrelevant, say so in one bullet. No advice, no price targets.")


def news_summary(ticker: str, refresh: bool = False) -> dict:
    items = news(ticker)
    if not items:
        return {"text": "No recent headlines found.", "items": []}
    key = "news:" + hashlib.sha1(json.dumps([i["title"] for i in items]).encode()).hexdigest()[:20]
    hit = None if refresh else _cache_get(key)
    if hit:
        return {"text": hit, "items": items, "cached": True}
    try:
        q = market.quote(ticker)
        move = f"Today's move: {q['change_pct']:+.1%}. "
    except Exception:
        move = ""
    body = move + "Headlines (newest first):\n" + "\n".join(
        f"- [{i['time']}] {i['publisher']}: {i['title']}" + (f" | {i['summary']}" if i["summary"] else "") for i in items)
    text = ask(SUMMARY_SYSTEM, f"Stock: {market.norm(ticker)}\n{body}", model=db.settings()["ai_fast_model"],
               max_tokens=400)
    _cache_put(key, text)
    return {"text": text, "items": items}


# ---------- journal coach ----------
COACH_SYSTEM = (
    "You are a blunt but kind trading coach reviewing a retail trader's journal. You coach PROCESS (planning, "
    "sizing, exits, discipline, emotions), never stock picks or market predictions. Use the data given and quote "
    "numbers and plan ids (#12). Structure:\n"
    "## Headline\nOne or two sentences on the most important thing.\n"
    "## Patterns\n3-5 bullets, each a concrete pattern with numbers (e.g. setups that lose, exits that come too "
    "early per the after-exit data, broken plans, guardrail overrides, unplanned trades, hold times vs plan).\n"
    "## What went well\n1-3 bullets.\n"
    "## Rule to try next week\nExactly one specific, checkable rule.\n"
    "If there are fewer than 10 closed trades, say the sample is too small for firm conclusions and keep "
    "patterns tentative. Keep it under 350 words. Plain markdown, no tables.")


def journal_digest(account_id: int, days: int = 120) -> dict:
    j = service.journal(account_id)
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    closed = [p for p in j["plans"] if p["status"] == "closed" and (p.get("closed_at") or "") >= cutoff
              and p["qty_bought"]][:60]
    ae = {r["id"]: r for r in j["after_exit"].get("rows", [])}
    rows = []
    for p in closed:
        chk = json.loads(db.one("SELECT check_json FROM plans WHERE id = ?", (p["id"],))["check_json"] or "{}")
        rows.append({
            "id": p["id"], "ticker": p["ticker"], "setup": p.get("setup"), "opened": (p.get("first_buy") or "")[:10],
            "closed": (p.get("closed_at") or "")[:10], "r": round(p["r_multiple"], 2) if p.get("r_multiple") is not None else None,
            "return_pct": round((p.get("return_pct") or 0) * 100, 1), "held_days": p.get("hold_days"),
            "planned_days": p.get("hold_days_plan"), "exit_reason": p.get("exit_reason"),
            "followed_plan": p.get("followed_plan"), "thesis": (p.get("thesis") or "")[:200],
            "lesson": (p.get("lesson") or "")[:200], "guardrail_override": p.get("override_reason"),
            "unplanned_broker_fill": p.get("source") == "broker", "check_verdict_at_plan": chk.get("verdict"),
            "check_flags": [f["text"][:90] for f in chk.get("flags", []) if f["level"] in ("bad", "warn")][:4],
            "price_10d_after_exit_in_r": round(ae[p["id"]]["close10_r"], 2) if p["id"] in ae else None})
    st = {k: v for k, v in j["stats"].items() if not isinstance(v, dict)}
    open_ = [{"id": p["id"], "ticker": p["ticker"], "status": p["status"], "setup": p.get("setup")}
             for p in j["plans"] if p["status"] in ("open", "planned")]
    return {"stats": st, "by_setup": j["stats"].get("by_setup"), "by_exit": j["stats"].get("by_exit"),
            "after_exit": {k: v for k, v in j["after_exit"].items() if k != "rows"}, "closed_trades": rows,
            "open_or_planned": open_, "guardrails_now": j["guardrails"]}


def coach(account_id: int) -> dict:
    a = service.account(account_id)
    dig = journal_digest(account_id)
    if not dig["closed_trades"]:
        raise UserError("No closed trades in the last 120 days to review yet")
    text = ask(COACH_SYSTEM, f"Account: {a['name']} ({a['mode']}). Journal data (JSON):\n"
                             + json.dumps(dig, default=str, ensure_ascii=False))
    first = next((l.strip() for l in text.splitlines() if l.strip() and not l.startswith("#")), "")[:300]
    rid = db.execute("INSERT INTO reports(kind, account_id, ts, title, summary, body) VALUES ('coach',?,?,?,?,?)",
                     (account_id, db.now(), f"Coach: {a['name']}", first, text))
    return {"id": rid, "text": text, "summary": first}
