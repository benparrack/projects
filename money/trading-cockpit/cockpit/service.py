"""Glue between storage, market data and the pure risk/ledger logic."""
from __future__ import annotations

import json
import math

import pandas as pd

from . import db, ledger, market, risk


class UserError(ValueError):
    """Shown to the user as-is."""


def _f(x, name, positive=True):
    try:
        v = float(x)
    except (TypeError, ValueError):
        raise UserError(f"{name} must be a number")
    if not math.isfinite(v) or (positive and v <= 0):
        raise UserError(f"{name} must be a positive number")
    return v


def accounts() -> list[dict]:
    return db.rows("SELECT * FROM accounts ORDER BY id")


def account(account_id: int) -> dict:
    a = db.one("SELECT * FROM accounts WHERE id = ?", (account_id,))
    if not a:
        raise UserError("No such account")
    return a


def _trades(account_id):
    return db.rows("SELECT * FROM trades WHERE account_id = ? ORDER BY ts, id", (account_id,))


def _moves(account_id):
    return db.rows("SELECT * FROM cash_moves WHERE account_id = ? ORDER BY ts, id", (account_id,))


def price_usd(ticker: str) -> tuple[float, float, dict]:
    q = market.quote(ticker)
    f = market.fx(q["currency"])
    return q["price"] * f, f, q


def state(account_id: int) -> dict:
    """Cash, positions at live prices, equity, open plans and total open risk."""
    acct = account(account_id)
    trades, moves = _trades(account_id), _moves(account_id)
    lots, realized = ledger.fifo(trades)
    prices, quotes = {}, {}
    for tk in lots:
        try:
            prices[tk], _, quotes[tk] = price_usd(tk)
        except Exception:
            prices[tk] = None
    cash = ledger.cash_balance(trades, moves)
    pos = ledger.positions(lots, prices)
    for p in pos:
        q = quotes.get(p["ticker"])
        p["price"] = q["price"] if q else None
        p["day_change_pct"] = q["change_pct"] if q else None
    invested = sum(p["value"] or p["cost"] for p in pos)
    equity = cash + invested
    plans = db.rows("SELECT * FROM plans WHERE account_id = ? AND status IN ('planned','open') ORDER BY created_at DESC",
                    (account_id,))
    results = {r["id"]: r for r in ledger.plan_results(plans, trades, prices)}
    heat = 0.0
    open_plans = []
    for p in plans:
        r = results[p["id"]]
        q = quotes.get(p["ticker"])
        r["price"] = q["price"] if q else None
        if p["status"] == "open" and r["qty_open"] > 0 and q and p["stop"]:
            f = prices[p["ticker"]] / q["price"] if q["price"] else 1
            r["open_risk"] = max(0.0, r["qty_open"] * (q["price"] - p["stop"]) * f)
            heat += r["open_risk"]
            r["to_stop_pct"] = p["stop"] / q["price"] - 1
            r["to_target_pct"] = p["target"] / q["price"] - 1 if p["target"] else None
        open_plans.append(r)
    deposits = sum(m["amount"] for m in moves)
    return {"account": acct, "cash": cash, "equity": equity, "invested": invested, "deposits": deposits,
            "total_pnl": equity - deposits, "positions": pos, "plans": open_plans, "heat": heat,
            "heat_pct": heat / equity if equity > 0 else 0.0,
            "realized_total": sum(r["gain"] for r in realized)}


def check(account_id: int, ticker: str, entry, stop, target, hold_days, thesis: str = "",
          risk_pct=None) -> dict:
    tk = market.norm(ticker)
    if not tk:
        raise UserError("Enter a ticker")
    s = db.settings()
    st = state(account_id)
    try:
        hist = market.history(tk)
    except LookupError as e:
        raise UserError(str(e))
    q = market.quote(tk)
    fx = market.fx(q["currency"])
    entry = _f(entry, "Entry") if entry not in (None, "") else q["price"]
    stop = _f(stop, "Stop") if stop not in (None, "") else None
    target = _f(target, "Target") if target not in (None, "") else None
    hold_days = int(_f(hold_days or 10, "Hold days"))
    rp = _f(risk_pct, "Risk %") / 100 if risk_pct not in (None, "") else s["risk_pct"]
    a = float(risk.atr(hist).iloc[-1])
    suggested = {"stop": round(entry - 2 * a, 2), "target": round(entry + 4 * a, 2)}
    if stop is None:
        stop = suggested["stop"]
    holdings = []
    for p in st["positions"]:
        try:
            holdings.append({"ticker": p["ticker"], "value_usd": p["value"] or p["cost"],
                             "sector": market.info(p["ticker"]).get("sector"),
                             "close": market.history(p["ticker"])["Close"]})
        except Exception:
            pass
    inf = market.info(tk)
    earn = market.earnings(tk)
    try:
        spy = market.history("SPY")
    except LookupError:
        spy = None
    res = risk.analyze(hist=hist, spy=spy, entry=entry, stop=stop, target=target, hold_days=hold_days, fx=fx,
                       equity=st["equity"], cash=st["cash"], risk_pct=rp, max_pos_pct=s["max_position_pct"],
                       max_heat_pct=s["max_heat_pct"], open_heat_usd=st["heat"], holdings=holdings,
                       sector=inf.get("sector"), next_earnings=earn.get("next"), past_earnings=earn.get("past", []),
                       thesis=thesis, fractional=bool(s["fractional"]))
    res.update({"ticker": tk, "quote": q, "fx": fx, "info": inf, "entry": entry, "stop": stop, "target": target,
                "hold_days": hold_days, "risk_pct": rp, "suggested": suggested, "equity": st["equity"],
                "cash": st["cash"],
                "chart": [{"t": d.strftime("%Y-%m-%d"), "c": round(float(v), 4)}
                          for d, v in hist["Close"].iloc[-260:].items()]})
    return res


def save_plan(account_id: int, d: dict) -> int:
    res = check(account_id, d["ticker"], d.get("entry"), d.get("stop"), d.get("target"), d.get("hold_days"),
                d.get("thesis", ""), d.get("risk_pct"))
    shares = float(d["shares"]) if d.get("shares") not in (None, "") else res["sizing"]["shares"]
    snapshot = {k: res[k] for k in ("verdict", "verdict_text", "flags", "sizing")}
    snapshot["metrics"] = {k: v for k, v in res["metrics"].items() if k != "earnings_moves"}
    return db.execute(
        "INSERT INTO plans(account_id, ticker, created_at, thesis, setup, entry, stop, target, hold_days, risk_pct,"
        " shares, confidence, check_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (account_id, res["ticker"], db.now(), d.get("thesis", ""), (d.get("setup") or "").strip() or None,
         res["entry"], res["stop"], res["target"], res["hold_days"], res["risk_pct"], shares,
         int(d["confidence"]) if d.get("confidence") else None, json.dumps(snapshot, default=float)))


def plan(plan_id: int) -> dict:
    p = db.one("SELECT * FROM plans WHERE id = ?", (plan_id,))
    if not p:
        raise UserError("No such plan")
    return p


def _paper_fill(ticker: str, side: str) -> tuple[float, str]:
    s = db.settings()
    q = market.quote(ticker)
    slip = s["paper_slippage_bps"] / 1e4
    px = q["price"] * (1 + slip if side == "buy" else 1 - slip)
    note = "paper fill" + ("" if q["open"] else " at last price (market closed)")
    return px, note


def record_trade(plan_id: int, side: str, qty=None, price=None, fees=None, ts=None, note: str = "") -> int:
    """Buy or sell against a plan. Paper accounts fill at the live price; real accounts take your broker fill."""
    p = plan(plan_id)
    acct = account(p["account_id"])
    if side not in ("buy", "sell"):
        raise UserError("side must be buy or sell")
    if p["status"] in ("closed", "cancelled"):
        raise UserError(f"Plan is {p['status']}")
    q = market.quote(p["ticker"])
    fx = market.fx(q["currency"])
    st = state(acct["id"])
    res = next((r for r in st["plans"] if r["id"] == plan_id), None)
    open_qty = res["qty_open"] if res else 0.0
    if qty in (None, ""):
        qty = p["shares"] if side == "buy" else open_qty
    qty = _f(qty, "Quantity")
    if acct["mode"] == "paper":
        px, auto_note = _paper_fill(p["ticker"], side)
        if price not in (None, ""):
            px = _f(price, "Price")  # used by automatic stop/target exits
        fee = db.settings()["paper_fee"]
        note = (note + " · " if note else "") + auto_note
    else:
        if price in (None, ""):
            raise UserError("Enter the price your broker filled you at")
        px = _f(price, "Price")
        fee = float(fees or 0)
    if side == "sell" and qty > open_qty + 1e-9:
        raise UserError(f"This plan only holds {open_qty:g} shares")
    if side == "buy" and qty * px * fx + fee > st["cash"] + 1e-6:
        raise UserError(f"Not enough cash: this costs ${qty * px * fx + fee:,.2f}, you have ${st['cash']:,.2f}"
                        + (". Add a deposit on the Portfolio tab." if acct["mode"] == "real" else ""))
    tid = db.execute("INSERT INTO trades(account_id, plan_id, ticker, side, qty, price, currency, fx, fees, ts, note)"
                     " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                     (acct["id"], plan_id, p["ticker"], side, qty, px, q["currency"], fx, fee, ts or db.now(), note))
    if side == "buy" and p["status"] == "planned":
        db.execute("UPDATE plans SET status = 'open' WHERE id = ?", (plan_id,))
    if side == "sell" and qty >= open_qty - 1e-9:
        db.execute("UPDATE plans SET status = 'closed', closed_at = ? WHERE id = ?", (db.now(), plan_id))
    return tid


def update_plan(plan_id: int, d: dict) -> None:
    p = plan(plan_id)
    fields = {}
    for k in ("stop", "target"):
        if k in d and d[k] not in (None, ""):
            fields[k] = _f(d[k], k.title())
    for k in ("thesis", "setup", "exit_reason", "lesson"):
        if k in d:
            fields[k] = d[k]
    if "followed_plan" in d:
        fields["followed_plan"] = None if d["followed_plan"] in (None, "") else int(bool(int(d["followed_plan"])))
    if d.get("status") == "cancelled":
        if p["status"] != "planned":
            raise UserError("Only plans you haven't bought yet can be cancelled; sell instead")
        fields["status"] = "cancelled"
    if fields:
        db.execute(f"UPDATE plans SET {', '.join(f'{k} = ?' for k in fields)} WHERE id = ?",
                   (*fields.values(), plan_id))


def cash_move(account_id: int, amount, note: str = "") -> None:
    amt = _f(amount, "Amount", positive=False)
    if amt == 0:
        raise UserError("Amount can't be zero")
    db.execute("INSERT INTO cash_moves(account_id, ts, amount, note) VALUES (?,?,?,?)",
               (account_id, db.now(), amt, note))


def journal(account_id: int) -> dict:
    s = db.settings()
    trades = _trades(account_id)
    plans = db.rows("SELECT * FROM plans WHERE account_id = ? ORDER BY created_at DESC", (account_id,))
    prices = {}
    for tk in {p["ticker"] for p in plans if p["status"] == "open"}:
        try:
            prices[tk] = price_usd(tk)[0]
        except Exception:
            pass
    results = ledger.plan_results(plans, trades, prices)
    for r in results:
        r.pop("check_json", None)
    lots, realized = ledger.fifo(trades)
    realized = ledger.flag_wash_sales(trades, realized)
    return {"plans": results, "stats": ledger.journal_stats(results), "trades": trades[::-1],
            "realized": realized[::-1], "taxes": ledger.tax_summary(realized, s["st_tax_rate"], s["lt_tax_rate"]),
            "cash_moves": _moves(account_id)[::-1]}


def plan_detail(plan_id: int) -> dict:
    p = plan(plan_id)
    p["check"] = json.loads(p.pop("check_json") or "{}")
    p["trades"] = db.rows("SELECT * FROM trades WHERE plan_id = ? ORDER BY ts", (plan_id,))
    return p


def curve(account_id: int) -> dict:
    trades, moves = _trades(account_id), _moves(account_id)
    if not moves:
        return {"points": []}
    closes, fxh = {}, {}
    for tk in {t["ticker"] for t in trades}:
        try:
            closes[tk] = market.history(tk)["Close"]
        except Exception:
            pass
    for cur in {t["currency"] for t in trades} - {"USD"}:
        try:
            fxh[cur] = market.fx_history(cur)
        except Exception:
            pass
    spy = market.history("SPY")["Close"]
    eq = ledger.equity_curve(trades, moves, closes, fxh, spy)
    if eq.empty:
        return {"points": []}
    # The last point uses live prices so it matches the portfolio header.
    st = state(account_id)
    eq.iloc[-1, eq.columns.get_loc("value")] = st["equity"]
    try:
        spy_now = market.quote("SPY")["price"]
        last_close = float(spy.iloc[-1])
        if eq.index[-1] > spy.index[-1]:
            eq.iloc[-1, eq.columns.get_loc("spy")] = eq["spy"].iloc[-1] / last_close * spy_now
    except Exception:
        pass
    pts = [{"t": d.strftime("%Y-%m-%d"), "value": round(r.value, 2), "spy": round(r.spy, 2),
            "deposits": round(r.deposits, 2)} for d, r in eq.iterrows()]
    return {"points": pts, "max_drawdown": float(eq["drawdown"].min()),
            "value": float(eq["value"].iloc[-1]), "spy": float(eq["spy"].iloc[-1]),
            "deposits": float(eq["deposits"].iloc[-1])}
