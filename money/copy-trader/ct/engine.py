"""Paper portfolio, broker interface, cost model, FIFO tax lots, and the bar-by-bar simulator.

The same `simulate()` runs the backtest and the live paper account, so their numbers are comparable.
Rules it enforces:
- A target only becomes tradable at the first bar whose open time is at/after the target's decision time
  (decision time = when the leader's trade became public, plus a delay). No same-bar or earlier fills.
- Fills are at that bar's open, worsened by slippage, plus fees/commission.
"""
import math
from abc import ABC, abstractmethod
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone

import numpy as np

YEAR = 365 * 86400


@dataclass
class Costs:
    fee_rate: float = 0.0          # proportional (crypto taker fee)
    commission: float = 0.0        # USD per order
    slippage_bps: float = 0.0      # applied against us on every fill
    min_trade: float = 1.0         # USD
    threshold: float = 0.005       # fraction of equity below which a rebalance trade is skipped

    @classmethod
    def from_cfg(cls, c):
        return cls(fee_rate=c.get("taker_fee", 0.0), commission=c.get("commission_usd", 0.0),
                   slippage_bps=c.get("slippage_bps", 0.0), min_trade=c.get("min_trade_usd", 1.0),
                   threshold=c.get("rebalance_threshold", 0.005))


class Portfolio:
    """Cash + signed positions. Shorts/perps use the same cash accounting (selling credits cash), so
    equity = cash + sum(qty * price) is right for both. Lots are FIFO for tax."""

    def __init__(self, cash):
        self.initial = cash
        self.cash = cash
        self.pos = {}
        self.lots = {}
        self.realized = []         # (t, gain, is_long_term)
        self.fees = 0.0
        self.funding = 0.0
        self.trades = []           # (t, sym, qty, price, fee, reason)

    def value(self, px):
        return self.cash + sum(q * px[s] for s, q in self.pos.items())

    def apply_fill(self, t, sym, qty, price, fee, reason=""):
        if qty == 0:
            return
        self.cash -= qty * price + fee
        self.fees += fee
        unit_fee = fee / abs(qty)
        lots = self.lots.setdefault(sym, deque())
        rem = qty
        while abs(rem) > 1e-12 and lots and (lots[0][0] > 0) != (rem > 0):
            lq, basis, t0 = lots[0]
            n = min(abs(lq), abs(rem))
            if lq > 0:     # sell closes a long
                gain = (price - unit_fee - basis) * n
            else:          # buy closes a short (short gains are always short-term)
                gain = (basis - price - unit_fee) * n
            self.realized.append((t, gain, lq > 0 and t - t0 > YEAR))
            lq -= math.copysign(n, lq)
            rem -= math.copysign(n, rem)
            if abs(lq) < 1e-12:
                lots.popleft()
            else:
                lots[0][0] = lq
        if abs(rem) > 1e-12:
            lots.append([rem, price + unit_fee if rem > 0 else price - unit_fee, t])
        q = self.pos.get(sym, 0.0) + qty
        if abs(q) < 1e-12:
            self.pos.pop(sym, None)
            self.lots.pop(sym, None)
        else:
            self.pos[sym] = q
        self.trades.append((t, sym, qty, price, fee, reason))

    def charge_funding(self, t, amount):
        """amount > 0 = we pay. Treated as ordinary (short-term) income/expense for tax."""
        self.cash -= amount
        self.funding += amount
        self.realized.append((t, -amount, False))

    def liquidation_gains(self, t, px):
        """Gains that would be realized by closing everything at px (for after-tax 'cash-out' value)."""
        out = []
        for sym, lots in self.lots.items():
            p = px.get(sym)
            if p is None or not np.isfinite(p):
                continue
            for lq, basis, t0 in lots:
                gain = (p - basis) * lq if lq > 0 else (basis - p) * -lq
                out.append((t, gain, lq > 0 and t - t0 > YEAR))
        return out


class Broker(ABC):
    """Order interface. Only PaperBroker exists. A real broker adapter would implement submit() by placing
    an order and blocking until filled, then record the actual fill in the same Portfolio; nothing else in
    the engine would change. Deliberately not built: this project must never hold keys or trade real money."""

    @abstractmethod
    def submit(self, t, sym, qty, ref_price, reason=""):
        ...


class PaperBroker(Broker):
    def __init__(self, portfolio, costs):
        self.pf, self.costs = portfolio, costs

    def fill_price(self, qty, ref):
        s = self.costs.slippage_bps / 1e4
        return ref * (1 + s) if qty > 0 else ref * (1 - s)

    def submit(self, t, sym, qty, ref_price, reason=""):
        px = self.fill_price(qty, ref_price)
        fee = abs(qty) * px * self.costs.fee_rate + self.costs.commission
        self.pf.apply_fill(t, sym, qty, px, fee, reason)
        return px, fee


def rebalance(broker, pf, t, targets, px, costs, reason, cash_only=True, value_px=None):
    """Trade toward target weights (signed fraction of equity per symbol) at prices px.
    Symbols without a price this bar are left alone. With cash_only, buys are scaled to available cash."""
    vp = value_px or px
    eq = pf.value({s: vp.get(s, px.get(s, 0.0)) for s in pf.pos})
    if eq <= 0:
        return
    floor = max(costs.min_trade, costs.threshold * eq)
    orders = []
    for sym in set(targets) | set(pf.pos):
        p = px.get(sym)
        if p is None or not np.isfinite(p) or p <= 0:
            continue
        w = targets.get(sym, 0.0)
        cur = pf.pos.get(sym, 0.0)
        if w == 0 and cur != 0:
            orders.append((sym, -cur, p))                 # exits always execute in full
            continue
        diff = w * eq / p - cur
        if abs(diff * p) >= floor:
            orders.append((sym, diff, p))
    # reduce/close first, then add, so freed cash funds buys
    reducing = [o for o in orders if o[1] * pf.pos.get(o[0], 0) < 0 and abs(o[1]) <= abs(pf.pos.get(o[0], 0)) + 1e-12]
    adding = [o for o in orders if o not in reducing]
    for sym, q, p in reducing:
        broker.submit(t, sym, q, p, reason)
    scale = 1.0
    if cash_only:
        s = costs.slippage_bps / 1e4
        need = sum(q * p * (1 + s) * (1 + costs.fee_rate) + costs.commission for _, q, p in adding if q > 0)
        if need > pf.cash > 0:
            scale = pf.cash / need * 0.9999
        elif need > 0 and pf.cash <= 0:
            scale = 0.0
    for sym, q, p in adding:
        q = q * scale if q > 0 else q
        if abs(q * p) >= costs.min_trade or (q < 0):
            broker.submit(t, sym, q, p, reason)


def simulate(times, bars, target_fn, costs, initial, funding=None, maint=None, cash_only=True):
    """Run one strategy over bars.
    times: bar open times (unix s). bars: {sym: array(4, N) of o,h,l,c}.
    target_fn(i) -> (weights dict, reason) to rebalance at bar i's open, or None for no change.
    funding: {sym: per-bar rate} (perps; longs pay positive rates). maint: {sym: maintenance margin fraction};
    when given, the account is liquidated if the bar's adverse extremes would breach maintenance margin."""
    pf = Portfolio(initial)
    broker = PaperBroker(pf, costs)
    last = {}
    eq = np.zeros(len(times))
    liquidations = 0
    for i, t in enumerate(times):
        tg = target_fn(i)
        if tg is not None:
            weights, reason = tg
            tradable = {}
            for s in set(weights) | set(pf.pos):
                b = bars.get(s)
                if b is not None and np.isfinite(b[0, i]):
                    tradable[s] = b[0, i]
            # held symbols with no open this bar keep their size and are valued at their last close
            rebalance(broker, pf, t, weights, tradable, costs, reason, cash_only, value_px={**last, **tradable})
        for s in list(pf.pos):
            b = bars.get(s)
            if b is not None and np.isfinite(b[3, i]):
                last[s] = b[3, i]
            elif s not in last and b is not None and np.isfinite(b[0, i]):
                last[s] = b[0, i]
        if funding:
            for s, q in list(pf.pos.items()):
                f = funding.get(s)
                if f is not None and f[i] and s in last:
                    pf.charge_funding(t + 3599, q * last[s] * f[i])
        if maint and pf.pos:
            worst = {}
            for s, q in pf.pos.items():
                b = bars.get(s)
                if b is not None and np.isfinite(b[1, i]):
                    worst[s] = b[2, i] if q > 0 else b[1, i]
                else:
                    worst[s] = last.get(s, 0)
            w_eq = pf.value(worst)
            mm = sum(abs(q) * worst[s] * maint.get(s, 0.05) for s, q in pf.pos.items())
            if w_eq < mm:
                liquidations += 1
                for s, q in list(pf.pos.items()):
                    broker.submit(t + 1800, s, -q, worst[s], "liquidation")
        eq[i] = pf.value({s: last.get(s, 0.0) for s in pf.pos})
    pf.liquidations = liquidations
    pf.last_prices = last
    return pf, eq


# ------------------------------------------------------------------ tax + metrics
def year_of(t):
    return datetime.fromtimestamp(t, timezone.utc).year


def tax_due(realized, st_rate, lt_rate, offset_ordinary=False):
    """US federal tax on realized gains, year by year: net short- and long-term separately, net across
    character, carry losses forward with their character. Returns (total_tax, {year: tax})."""
    years = {}
    for t, g, lt in realized:
        y = years.setdefault(year_of(t), [0.0, 0.0])
        y[1 if lt else 0] += g
    cst = clt = 0.0
    total, per = 0.0, {}
    for y in sorted(years):
        st, lt = years[y][0] + cst, years[y][1] + clt
        if st < 0 < lt:
            lt, st = lt + st, 0.0
            if lt < 0:
                st, lt = lt, 0.0
        elif lt < 0 < st:
            st, lt = st + lt, 0.0
            if st < 0:
                lt, st = st, 0.0
        tax = st_rate * max(st, 0) + lt_rate * max(lt, 0)
        if offset_ordinary and (st < 0 or lt < 0):
            use = min(3000.0, -(min(st, 0) + min(lt, 0)))
            tax -= use * st_rate
            take = min(use, -min(st, 0))
            st += take
            lt += use - take
        cst, clt = min(st, 0.0), min(lt, 0.0)
        per[y] = tax
        total += tax
    return total, per


def max_drawdown(eq):
    peak = np.maximum.accumulate(eq)
    dd = (eq - peak) / np.where(peak > 0, peak, 1)
    return float(dd.min()) if len(eq) else 0.0


def metrics(times, eq, initial, pf=None, tax_cfg=None):
    years = (times[-1] - times[0]) / YEAR if len(times) > 1 else 0
    final = float(eq[-1]) if len(eq) else initial
    total = final / initial - 1
    out = {"start": int(times[0]), "end": int(times[-1]), "years": years, "final": final,
           "total_return": total,
           "cagr": (final / initial) ** (1 / years) - 1 if years >= 0.25 and final > 0 else None,
           "max_drawdown": max_drawdown(np.asarray(eq))}
    if pf is not None:
        out.update(trades=len(pf.trades), fees=pf.fees, funding=pf.funding,
                   liquidations=getattr(pf, "liquidations", 0), positions=len(pf.pos))
        if tax_cfg:
            gains = pf.realized + pf.liquidation_gains(int(times[-1]), pf.last_prices)
            tax, per = tax_due(gains, tax_cfg["short_term_rate"], tax_cfg["long_term_rate"],
                               tax_cfg.get("losses_offset_ordinary_income", False))
            at = final - tax
            out.update(tax=tax, after_tax_final=at, after_tax_return=at / initial - 1,
                       after_tax_cagr=(at / initial) ** (1 / years) - 1 if years >= 0.25 and at > 0 else None)
    return out
