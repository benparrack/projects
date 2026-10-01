"""Pure bookkeeping: cash, FIFO tax lots, realized gains, journal stats and the equity curve.

All money is in USD. A trade stores its native price plus the fx rate (USD per
unit) at fill time, so cost basis is fixed in USD on the purchase date, as US tax
rules require.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

LT_DAYS = 365  # held more than one year → long-term


def _dt(s: str) -> datetime:
    d = datetime.fromisoformat(s)
    return d.replace(tzinfo=None)


def cash_balance(trades: list[dict], cash_moves: list[dict]) -> float:
    c = sum(m["amount"] for m in cash_moves)
    for t in trades:
        v = t["qty"] * t["price"] * t["fx"]
        c += -v - t["fees"] if t["side"] == "buy" else v - t["fees"]
    return c


def fifo(trades: list[dict]) -> tuple[dict, list[dict]]:
    """Returns (open lots per ticker, realized sale records). Raises on overselling."""
    lots: dict[str, list[dict]] = defaultdict(list)
    realized = []
    for t in sorted(trades, key=lambda x: (x["ts"], x["id"])):
        if t["side"] == "buy":
            lots[t["ticker"]].append({"trade_id": t["id"], "plan_id": t.get("plan_id"), "ts": t["ts"],
                                      "qty": t["qty"], "price": t["price"], "currency": t["currency"],
                                      "cost_per": (t["qty"] * t["price"] * t["fx"] + t["fees"]) / t["qty"]})
            continue
        remaining = t["qty"]
        fee_per = t["fees"] / t["qty"]
        held = sum(l["qty"] for l in lots[t["ticker"]])
        if remaining > held + 1e-9:
            raise ValueError(f"Selling {remaining:g} {t['ticker']} but only {held:g} held")
        while remaining > 1e-9:
            lot = lots[t["ticker"]][0]
            q = min(lot["qty"], remaining)
            proceeds = q * (t["price"] * t["fx"] - fee_per)
            cost = q * lot["cost_per"]
            days = (_dt(t["ts"]) - _dt(lot["ts"])).days
            realized.append({"ticker": t["ticker"], "qty": q, "open_ts": lot["ts"], "close_ts": t["ts"],
                             "buy_trade_id": lot["trade_id"], "sell_trade_id": t["id"],
                             "plan_id": t.get("plan_id") or lot["plan_id"],
                             "cost": cost, "proceeds": proceeds, "gain": proceeds - cost, "days": days,
                             "term": "long" if days > LT_DAYS else "short"})
            lot["qty"] -= q
            remaining -= q
            if lot["qty"] <= 1e-9:
                lots[t["ticker"]].pop(0)
    return {k: v for k, v in lots.items() if v}, realized


def flag_wash_sales(trades: list[dict], realized: list[dict]) -> list[dict]:
    """Flag losses where the same ticker was bought within 30 days before/after the sale.

    The IRS then disallows the loss now and adds it to the new shares' basis. We flag
    and estimate the disallowed part rather than rewriting basis (your broker's 1099
    is the final word).
    """
    buys = [t for t in trades if t["side"] == "buy"]
    for r in realized:
        r["wash_sale"] = False
        r["wash_disallowed"] = 0.0
        if r["gain"] >= 0:
            continue
        sale = _dt(r["close_ts"])
        # Shares sold in this same sale can't be the replacement shares.
        sold_here = {x["buy_trade_id"] for x in realized if x["sell_trade_id"] == r["sell_trade_id"]}
        repl = [b for b in buys if b["ticker"] == r["ticker"] and b["id"] not in sold_here
                and abs((_dt(b["ts"]) - sale).days) <= 30]
        if repl:
            q = min(1.0, sum(b["qty"] for b in repl) / r["qty"])
            r["wash_sale"] = True
            r["wash_disallowed"] = -r["gain"] * q
    return realized


def positions(lots: dict, prices_usd: dict[str, float], now: datetime | None = None) -> list[dict]:
    now = now or datetime.now(timezone.utc).replace(tzinfo=None)
    out = []
    for tk, ls in lots.items():
        qty = sum(l["qty"] for l in ls)
        cost = sum(l["qty"] * l["cost_per"] for l in ls)
        px = prices_usd.get(tk)
        mv = qty * px if px is not None else None
        first_lt = min((_dt(l["ts"]) + timedelta(days=LT_DAYS + 1) for l in ls), default=None)
        out.append({"ticker": tk, "qty": qty, "cost": cost, "avg_cost_native": sum(l["qty"] * l["price"] for l in ls) / qty,
                    "currency": ls[0]["currency"], "value": mv, "unrealized": mv - cost if mv is not None else None,
                    "unrealized_pct": (mv / cost - 1) if mv is not None and cost else None,
                    "days_to_long_term": max(0, (first_lt - now).days) if first_lt else None})
    return sorted(out, key=lambda p: -(p["value"] or 0))


def tax_summary(realized: list[dict], st_rate: float, lt_rate: float) -> list[dict]:
    """Per tax year: net short/long-term gains and a simplified federal estimate."""
    years = defaultdict(lambda: {"short": 0.0, "long": 0.0, "wash_disallowed": 0.0, "sales": 0})
    for r in realized:
        y = years[_dt(r["close_ts"]).year]
        y[r["term"]] += r["gain"] + r.get("wash_disallowed", 0.0)
        y["wash_disallowed"] += r.get("wash_disallowed", 0.0)
        y["sales"] += 1
    out = []
    for year, y in sorted(years.items()):
        st, lt = y["short"], y["long"]
        # Net losses in one bucket offset gains in the other.
        if st < 0 < lt:
            lt, st = max(0.0, lt + st), min(0.0, lt + st)
        elif lt < 0 < st:
            st, lt = max(0.0, st + lt), min(0.0, st + lt)
        net = st + lt
        tax = max(st, 0) * st_rate + max(lt, 0) * lt_rate
        out.append({"year": year, "short_term": y["short"], "long_term": y["long"], "net": net,
                    "est_tax": tax, "deductible_loss": min(3000.0, -net) if net < 0 else 0.0,
                    "carryover": max(0.0, -net - 3000.0), "wash_disallowed": y["wash_disallowed"],
                    "sales": y["sales"]})
    return out


def plan_results(plans: list[dict], trades: list[dict], prices_usd: dict[str, float]) -> list[dict]:
    """Per-plan P&L in USD (average cost within the plan), R-multiple and hold time."""
    by_plan = defaultdict(list)
    for t in trades:
        if t.get("plan_id"):
            by_plan[t["plan_id"]].append(t)
    out = []
    for p in plans:
        ts = sorted(by_plan.get(p["id"], []), key=lambda x: (x["ts"], x["id"]))
        buys = [t for t in ts if t["side"] == "buy"]
        sells = [t for t in ts if t["side"] == "sell"]
        bq = sum(t["qty"] for t in buys)
        sq = sum(t["qty"] for t in sells)
        bcost = sum(t["qty"] * t["price"] * t["fx"] + t["fees"] for t in buys)
        sproc = sum(t["qty"] * t["price"] * t["fx"] - t["fees"] for t in sells)
        avg_in = sum(t["qty"] * t["price"] for t in buys) / bq if bq else None
        avg_out = sum(t["qty"] * t["price"] for t in sells) / sq if sq else None
        fx_in = sum(t["qty"] * t["fx"] for t in buys) / bq if bq else 1.0
        open_qty = bq - sq
        r = dict(p)
        r["hold_days_plan"] = p.get("hold_days")
        r.update({"qty_bought": bq, "qty_open": open_qty, "avg_entry": avg_in, "avg_exit": avg_out,
                  "cost": bcost, "proceeds": sproc, "realized": None, "unrealized": None, "r_multiple": None,
                  "return_pct": None, "first_buy": buys[0]["ts"] if buys else None,
                  "last_sell": sells[-1]["ts"] if sells else None, "hold_days": None,
                  "initial_risk": None})
        if bq and p.get("stop") and avg_in and avg_in > p["stop"]:
            r["initial_risk"] = bq * (avg_in - p["stop"]) * fx_in
        if bq:
            sold_cost = bcost * (sq / bq)
            r["realized"] = sproc - sold_cost if sq else 0.0
            px = prices_usd.get(p["ticker"])
            if open_qty > 1e-9 and px is not None:
                r["unrealized"] = open_qty * px - bcost * (open_qty / bq)
            end = _dt(sells[-1]["ts"]) if open_qty <= 1e-9 and sells else datetime.now(timezone.utc).replace(tzinfo=None)
            r["hold_days"] = (end - _dt(buys[0]["ts"])).days
            total = r["realized"] + (r["unrealized"] or 0.0)
            r["return_pct"] = total / bcost if bcost else None
            if r["initial_risk"]:
                r["r_multiple"] = total / r["initial_risk"]
        out.append(r)
    return out


def journal_stats(results: list[dict]) -> dict:
    closed = [r for r in results if r["status"] == "closed" and r["qty_bought"]]
    if not closed:
        return {"closed": 0}
    pnl = np.array([r["realized"] for r in closed])
    rets = np.array([r["return_pct"] or 0 for r in closed])
    rs = np.array([r["r_multiple"] for r in closed if r["r_multiple"] is not None])
    wins, losses = pnl[pnl > 0], pnl[pnl <= 0]
    s = {
        "closed": len(closed), "win_rate": float((pnl > 0).mean()), "total_pnl": float(pnl.sum()),
        "avg_win_pct": float(rets[pnl > 0].mean()) if len(wins) else None,
        "avg_loss_pct": float(rets[pnl <= 0].mean()) if len(losses) else None,
        "avg_win": float(wins.mean()) if len(wins) else None,
        "avg_loss": float(losses.mean()) if len(losses) else None,
        "profit_factor": float(wins.sum() / -losses.sum()) if len(losses) and losses.sum() < 0 else None,
        "avg_r": float(rs.mean()) if len(rs) else None,
        "best": float(pnl.max()), "worst": float(pnl.min()),
        "avg_hold_days": float(np.mean([r["hold_days"] or 0 for r in closed])),
    }

    def group(key):
        g = defaultdict(list)
        for r in closed:
            g[key(r)].append(r)
        return {k: {"n": len(v), "win_rate": float(np.mean([x["realized"] > 0 for x in v])),
                    "pnl": float(sum(x["realized"] for x in v)),
                    "avg_r": float(np.mean([x["r_multiple"] for x in v if x["r_multiple"] is not None]))
                    if any(x["r_multiple"] is not None for x in v) else None}
                for k, v in g.items()}

    s["by_setup"] = group(lambda r: r.get("setup") or "(none)")
    s["by_followed"] = group(lambda r: {1: "followed plan", 0: "broke plan"}.get(r.get("followed_plan"), "not reviewed"))
    s["by_exit"] = group(lambda r: r.get("exit_reason") or "(none)")
    return s


def equity_curve(trades: list[dict], cash_moves: list[dict], closes: dict[str, pd.Series],
                 fx_hist: dict[str, pd.Series], spy: pd.Series) -> pd.DataFrame:
    """Daily account value vs. putting the same deposits into SPY on the same days."""
    if not cash_moves:
        return pd.DataFrame()
    start = pd.Timestamp(min(_dt(m["ts"]) for m in cash_moves)).normalize()
    days = spy.index[spy.index >= start]
    today = pd.Timestamp.today().normalize()
    if len(days) == 0 or days[-1] < today:
        days = days.append(pd.DatetimeIndex([today]))
    spy_px = spy.reindex(days).ffill().bfill()

    def day(ts):
        return pd.Timestamp(_dt(ts)).normalize()

    tickers = sorted({t["ticker"] for t in trades})
    qty = pd.DataFrame(0.0, index=days, columns=tickers)
    cash = pd.Series(0.0, index=days)
    bench_sh = pd.Series(0.0, index=days)
    for mv in cash_moves:
        d = day(mv["ts"])
        cash[cash.index >= d] += mv["amount"]
        px = spy_px[spy_px.index >= d]
        if len(px):
            bench_sh[bench_sh.index >= d] += mv["amount"] / px.iloc[0]
    for t in trades:
        d = day(t["ts"])
        sgn = 1 if t["side"] == "buy" else -1
        qty.loc[qty.index >= d, t["ticker"]] += sgn * t["qty"]
        v = t["qty"] * t["price"] * t["fx"]
        cash[cash.index >= d] += -v - t["fees"] if sgn == 1 else v - t["fees"]
    value = cash.copy()
    cur_by_tk = {t["ticker"]: t["currency"] for t in trades}
    for tk in tickers:
        px = closes.get(tk)
        if px is None or px.empty:
            continue
        px = px.reindex(days.union(px.index)).ffill().reindex(days).bfill()
        f = fx_hist.get(cur_by_tk[tk])
        if f is not None and not f.empty:
            f = f.reindex(days.union(f.index)).ffill().reindex(days).bfill()
            px = px * f
        value += qty[tk] * px
    out = pd.DataFrame({"value": value, "spy": bench_sh * spy_px, "cash": cash})
    out["deposits"] = pd.Series(0.0, index=days)
    for mv in cash_moves:
        out.loc[out.index >= day(mv["ts"]), "deposits"] += mv["amount"]
    peak = out["value"].cummax()
    out["drawdown"] = out["value"] / peak - 1
    return out
