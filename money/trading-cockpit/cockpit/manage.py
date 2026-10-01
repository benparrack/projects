"""Trade management: trailing stops and scale-outs, discipline guardrails, and the after-exit tracker."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from . import db, ledger, market, risk, service
from .service import UserError

log = logging.getLogger("manage")


def _local_now() -> datetime:
    return datetime.now(ZoneInfo(db.settings().get("timezone") or "Europe/Stockholm"))


def _local(ts: str) -> datetime:
    d = datetime.fromisoformat(ts)
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(_local_now().tzinfo)


# ---------- guardrails ----------
def guardrails(account_id: int, equity: float | None = None, now: datetime | None = None) -> dict:
    """Rules that block new buys: daily/weekly realized-loss limits and a cooldown after a losing streak."""
    s = db.settings()
    now = now or _local_now()
    trades = db.rows("SELECT * FROM trades WHERE account_id = ? ORDER BY ts, id", (account_id,))
    if equity is None:
        equity = service.state(account_id)["equity"]
    _, realized = ledger.fifo(trades)
    today = now.date()
    week0 = today - timedelta(days=today.weekday())
    day_pnl = sum(r["gain"] for r in realized if _local(r["close_ts"]).date() == today)
    week_pnl = sum(r["gain"] for r in realized if _local(r["close_ts"]).date() >= week0)
    blocks = []
    if equity > 0 and s["daily_loss_limit_pct"] and -day_pnl >= s["daily_loss_limit_pct"] * equity:
        blocks.append({"rule": "daily loss limit", "until": (today + timedelta(days=1)).isoformat(),
                       "text": f"You've lost ${-day_pnl:,.2f} today, past your {s['daily_loss_limit_pct']:.0%} daily "
                               "limit. No new trades until tomorrow."})
    if equity > 0 and s["weekly_loss_limit_pct"] and -week_pnl >= s["weekly_loss_limit_pct"] * equity:
        blocks.append({"rule": "weekly loss limit", "until": (week0 + timedelta(days=7)).isoformat(),
                       "text": f"You've lost ${-week_pnl:,.2f} this week, past your {s['weekly_loss_limit_pct']:.0%} "
                               "weekly limit. No new trades until Monday."})
    plans = db.rows("SELECT * FROM plans WHERE account_id = ? AND status = 'closed' AND closed_at IS NOT NULL"
                    " ORDER BY closed_at", (account_id,))
    res = [r for r in ledger.plan_results(plans, trades, {}) if r["qty_bought"]]
    streak = 0
    for r in reversed(res):
        if (r["realized"] or 0) >= 0:
            break
        streak += 1
    if s["max_loss_streak"] and streak >= s["max_loss_streak"]:
        until = _local(res[-1]["closed_at"]) + timedelta(days=s["cooldown_days"])
        if now < until:
            blocks.append({"rule": "losing streak cooldown", "until": until.isoformat(timespec="minutes"),
                           "text": f"{streak} losing trades in a row. Cool down until "
                                   f"{until.strftime('%a %H:%M')}: losses in a row are when people revenge-trade."})
    return {"blocks": blocks, "day_pnl": day_pnl, "week_pnl": week_pnl, "streak": streak}


def enforce_buy(plan: dict, override: str | None) -> str | None:
    """Raise if a guardrail blocks this buy and no reason was given. Returns the override reason to store."""
    s = db.settings()
    reasons = [b["text"] for b in guardrails(plan["account_id"])["blocks"]]
    if s["block_avg_down"] and plan["status"] == "open":
        mine = [t for t in db.rows("SELECT * FROM trades WHERE plan_id = ? AND side = 'buy'", (plan["id"],))]
        if mine:
            avg = sum(t["qty"] * t["price"] for t in mine) / sum(t["qty"] for t in mine)
            px = market.quote(plan["ticker"])["price"]
            if px < avg:
                reasons.append(f"Adding to a loser: price {px:.2f} is below your average entry {avg:.2f}.")
    if not reasons:
        return None
    if not (override or "").strip() or len(override.strip()) < 10:
        raise UserError("GUARDRAIL: " + " ".join(reasons) + " To override anyway, write why (it goes in the journal).")
    return override.strip()


# ---------- trailing stops and scale-outs ----------
def trail_levels(p: dict, hist: pd.DataFrame, price: float, avg_entry: float) -> dict:
    """New stop from the plan's rules (never lower than the current stop), and whether a scale-out is due."""
    rules = json.loads(p.get("trail_json") or "null") or {}
    stop0 = p.get("initial_stop") or p.get("stop")
    out = {"stop": p.get("stop"), "why": None, "scale": False}
    if not rules or not stop0 or avg_entry <= stop0:
        return out
    rps = avg_entry - stop0
    since = pd.Timestamp(p["first_buy"][:10])
    h = hist[hist.index >= since]
    high = max([price] + ([float(h["High"].max())] if len(h) else []))
    cands = []
    if rules.get("breakeven_r") and high >= avg_entry + rules["breakeven_r"] * rps:
        cands.append((avg_entry, f"price reached +{rules['breakeven_r']:g}R, stop to breakeven"))
    if rules.get("trail_atr") and len(hist) > 20:
        a = float(risk.atr(hist).iloc[-1])
        cands.append((high - rules["trail_atr"] * a, f"trailing {rules['trail_atr']:g}× ATR below the high {high:.2f}"))
    if rules.get("trail_pct"):
        cands.append((high * (1 - rules["trail_pct"]), f"trailing {rules['trail_pct']:.0%} below the high {high:.2f}"))
    cands = [c for c in cands if c[0] < price]  # a stop above the price would just be an exit
    if cands:
        lvl, why = max(cands)
        if lvl > (p.get("stop") or 0) * 1.001:
            out.update(stop=round(lvl, 4), why=why)
    if rules.get("scale_r") and not p.get("scaled") and price >= avg_entry + rules["scale_r"] * rps:
        out["scale"] = rules.get("scale_frac", 0.5)
    return out


def manage_open(p: dict, q: dict, fire) -> None:
    """Apply a plan's trailing/scale-out rules. Paper accounts act; real accounts get told what to do."""
    res = ledger.plan_results([p], db.rows("SELECT * FROM trades WHERE plan_id = ?", (p["id"],)), {})[0]
    if not res["qty_open"] or not res["avg_entry"]:
        return
    p = dict(p, first_buy=res["first_buy"])
    try:
        hist = market.completed(market.history(p["ticker"]), p["ticker"])
    except Exception:
        return
    lv = trail_levels(p, hist, q["price"], res["avg_entry"])
    tk, paper = p["ticker"], p["mode"] == "paper"
    if lv["why"]:
        db.execute("UPDATE plans SET stop = ? WHERE id = ?", (lv["stop"], p["id"]))
        moved = False
        if not paper:
            try:
                from . import broker
                moved = broker.move_broker_stop(p["id"], lv["stop"])
            except Exception as e:
                log.warning("moving Alpaca stop for plan %s failed: %s", p["id"], e)
        tail = ("" if paper else " Alpaca's stop order was moved too." if moved
                else " Move your stop order at your broker.")
        fire(f"trail:{p['id']}:{lv['stop']:.2f}", tk, "trail", f"{tk}: stop raised to {lv['stop']:.2f}",
             f"Was {p['stop']:.2f}; {lv['why']}.{tail}", ["arrow_up"])
    if lv["scale"]:
        n = res["qty_open"] * lv["scale"]
        db.execute("UPDATE plans SET scaled = 1 WHERE id = ?", (p["id"],))
        if paper and db.settings().get("paper_auto_exit") and q["open"]:
            try:
                service.record_trade(p["id"], "sell", qty=n, note="auto scale-out")
                fire(f"scale:{p['id']}", tk, "scale", f"{tk}: sold {lv['scale']:.0%} (paper)",
                     f"Scale-out rule hit at {q['price']:.2f}; {n:g} shares sold, the rest rides.", ["moneybag"])
            except Exception as e:
                log.warning("scale-out plan %s failed: %s", p["id"], e)
        else:
            fire(f"scale:{p['id']}", tk, "scale", f"{tk}: time to sell {lv['scale']:.0%}",
                 f"Your scale-out level was hit at {q['price']:.2f}. Sell about {n:g} shares"
                 + (" at your broker" if not paper else "") + ".", ["moneybag"])


# ---------- after-exit tracker ----------
def after_exit(r: dict, hist: pd.DataFrame | None = None) -> dict | None:
    """How the price moved in the 20 trading days after you sold, in R. Positive close_r = it kept rising."""
    if r["status"] != "closed" or not r.get("last_sell") or not r.get("avg_exit") or not r.get("avg_entry"):
        return None
    stop0 = r.get("initial_stop") or r.get("stop")
    rps = (r["avg_entry"] - stop0) if stop0 and r["avg_entry"] > stop0 else r["avg_entry"] * 0.05
    try:
        hist = hist if hist is not None else market.history(r["ticker"])
    except Exception:
        return None
    after = hist[hist.index > pd.Timestamp(r["last_sell"][:10])]
    if after.empty:
        return None
    ex = r["avg_exit"]
    out = {"days": len(after[:20]), "rps": rps}
    for n in (5, 10, 20):
        out[f"close{n}_r"] = (float(after["Close"].iloc[n - 1]) - ex) / rps if len(after) >= n else None
    w = after[:10]
    out["max_r"] = (float(w["High"].max()) - ex) / rps
    out["min_r"] = (float(w["Low"].min()) - ex) / rps
    out["path"] = [{"t": d.strftime("%Y-%m-%d"), "c": round(float(v), 4)} for d, v in after["Close"][:20].items()]
    return out


def after_exit_summary(results: list[dict]) -> dict:
    rows = []
    for r in results:
        a = after_exit(r)
        if a and a["close10_r"] is not None:
            rows.append({"id": r["id"], "ticker": r["ticker"], "exit_reason": r.get("exit_reason") or "(none)",
                         "r_multiple": r.get("r_multiple"), **{k: a[k] for k in ("close5_r", "close10_r", "max_r", "min_r")}})
    if not rows:
        return {"n": 0, "rows": [], "by_exit": {}}
    c10 = np.array([x["close10_r"] for x in rows])
    by = {}
    for x in rows:
        by.setdefault(x["exit_reason"], []).append(x["close10_r"])
    return {"n": len(rows), "avg_close10_r": float(c10.mean()), "median_close10_r": float(np.median(c10)),
            "share_higher": float((c10 > 0).mean()),
            "by_exit": {k: {"n": len(v), "avg_close10_r": float(np.mean(v))} for k, v in by.items()},
            "rows": sorted(rows, key=lambda x: -x["id"])[:50]}
