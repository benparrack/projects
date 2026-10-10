"""Runs strategies through the simulator for a mode ('backtest' or 'live') and stores the results."""
import json
import logging
import time
from datetime import date, datetime, timedelta, timezone

import numpy as np

from . import crypto, db, ingest, prices, stocks
from .engine import Costs, metrics, simulate
from .timeutil import ET, day_t, market_open_ts, t_day

log = logging.getLogger("runner")
DAY = 86400


# ------------------------------------------------------------------ stocks
class StockContext:
    def __init__(self, con, cfg):
        hs = ingest.history_start(cfg)
        self.pm = stocks.PriceMatrix(con, ingest.stock_tickers(con), hs - timedelta(days=200))
        self.funds = stocks.fund_events(con, self.pm)
        self.members, self.congress_all, self.txn_times = stocks.congress_events(
            con, self.pm, cfg["backtest"].get("congress_book_max_age_days", 730))


def stock_events(sdef, ctx, start, end):
    """[(decision_t, weights, reason)] sorted, plus extra info for the report."""
    k = sdef["kind"]
    if k == "13f_fund":
        return [(t, w, "13F " + info["period"]) for t, w, info in ctx.funds.get(sdef["fund"], [])], {}
    if k == "13f_basket":
        return stocks.basket_events(ctx.funds, 0), {}
    if k == "13f_trailing":
        def ok(fund, t):
            e = stocks.latest(ctx.funds[fund], t)
            return e is not None and t - e[0] < stocks.STALE_FUND_DAYS * DAY
        ev, picks = stocks.trailing_events(ctx.funds, ctx.pm, start, end, sdef["n"], sdef["lookback_days"], ok,
                                           offset_days=46)      # ~2 days after the 13F deadline
        return ev, {"picks": picks}
    if k == "congress_all":
        return ctx.congress_all, {}
    if k == "congress_trailing":
        def ok(member, t):
            ts = ctx.txn_times.get(member, [])
            return sum(1 for x in ts if t - sdef["lookback_days"] * DAY < x <= t) >= sdef["min_trades"]
        ev, picks = stocks.trailing_events(ctx.members, ctx.pm, start, end, sdef["n"], sdef["lookback_days"], ok)
        return ev, {"picks": picks}
    raise ValueError(k)


class EventTarget:
    """Hands the simulator the newest event that became public since the previous bar opened."""

    def __init__(self, times, events, bars):
        self.times, self.ev, self.bars = times, sorted(events, key=lambda e: e[0]), bars
        self.j = 0

    def __call__(self, i):
        new = None
        while self.j < len(self.ev) and self.ev[self.j][0] <= self.times[i]:
            new = self.ev[self.j]
            self.j += 1
        if new is None:
            return None
        w = {s: x for s, x in new[1].items() if s in self.bars}
        return stocks.normalize(w), new[2]


def run_stock(con, cfg, sdef, ctx, start, end=None):
    end = end or date.today()
    events, extra = stock_events(sdef, ctx, start, end)
    cal = prices.calendar(con, "SPY", start, end)
    if len(cal) == 0:
        return None
    times = np.array([market_open_ts(t_day(int(k))) for k in cal])
    first = max([e[0] for e in events if e[0] <= times[0]], default=0)
    syms = {s for t, w, _ in events if t >= first for s in w} | {"SPY"}
    bars = prices.load_bars(con, syms, "1d", cal)
    costs = Costs.from_cfg(cfg["costs"]["stocks"])
    cap = cfg["start_capital"]
    pf, eq = simulate(times, bars, EventTarget(times, events, bars), costs, cap)
    bpf, beq = simulate(times, {"SPY": bars["SPY"]}, lambda i: ({"SPY": 1.0}, "benchmark") if i == 0 else None,
                        costs, cap)
    return finish(cfg, sdef, times, cal, pf, eq, bpf, beq, "SPY", extra)


# ------------------------------------------------------------------ crypto
def hourly(start_t, end_t):
    s = int(start_t // 3600 * 3600)
    if s < start_t:
        s += 3600
    return np.arange(s, int(end_t // 3600 * 3600) + 1, 3600, dtype=np.int64)


def crypto_backtest_start(cfg, now=None):
    now = now or time.time()
    d = datetime.fromtimestamp(now - cfg["backtest"]["crypto_days"] * DAY, timezone.utc)
    m = datetime(d.year, d.month, 1, tzinfo=timezone.utc)
    if m.timestamp() < now - cfg["backtest"]["crypto_days"] * DAY:
        m = datetime(d.year + (d.month == 12), d.month % 12 + 1, 1, tzinfo=timezone.utc)
    return m.timestamp()


def run_crypto(con, cfg, sdef, mode, start_t, end_t=None, leaders=None):
    end_t = end_t or time.time()
    hcfg = cfg["hyperliquid"]
    if mode == "backtest":
        leaders = leaders or crypto.load_hist_leaders(con)
        selections = [(T, [u for u, _ in crypto.select(leaders, T, sdef["rank"], sdef["n"], hcfg)])
                      for T in crypto.month_starts(start_t, end_t)]
        picks = [{"t": T, "leaders": crypto.select(leaders, T, sdef["rank"], sdef["n"], hcfg)}
                 for T, _ in selections]
    else:
        rows = con.execute("SELECT t, leaders FROM hl_selections WHERE strategy=? ORDER BY t", (sdef["id"],)).fetchall()
        selections = [(t, [u for u, _ in json.loads(l)]) for t, l in rows]
        picks = [{"t": t, "leaders": json.loads(l)} for t, l in rows]
        leaders = crypto.load_snapshot_leaders(con, {u for _, us in selections for u in us})
    times = hourly(start_t, end_t)
    if len(times) == 0 or not selections:
        return None
    coins = {c for _, us in selections for u in us if u in leaders for c in leaders[u].coins()} | {"BTC"}
    bars = prices.load_bars(con, coins, "1h", times)
    fund = prices.load_funding(con, bars.keys(), times)
    maxlev = db.kv_get(con, "hl_meta", {})
    maint = {c: 0.5 / maxlev.get(c, 3) for c in bars}
    ccfg = cfg["costs"]["crypto"]
    costs = Costs.from_cfg(ccfg)
    target = crypto.CopyTarget(times, bars, selections, leaders, cfg["delays"]["crypto_seconds"], ccfg["max_leverage"])
    cap = cfg["start_capital"]
    pf, eq = simulate(times, bars, target, costs, cap, funding=fund, maint=maint, cash_only=False)
    if "BTC" not in bars:
        return None
    bpf, beq = simulate(times, {"BTC": bars["BTC"]}, lambda i: ({"BTC": 1.0}, "benchmark") if i == 0 else None,
                        costs, cap, cash_only=False)
    return finish(cfg, sdef, times, times, pf, eq, bpf, beq, "BTC", {"picks": picks})


# ------------------------------------------------------------------ results
def finish(cfg, sdef, times, keys, pf, eq, bpf, beq, bench, extra):
    m = metrics(times, eq, cfg["start_capital"], pf, cfg["tax"])
    b = metrics(times, beq, cfg["start_capital"], bpf, cfg["tax"])
    m["benchmark"] = {"symbol": bench, **b}
    m["beat_benchmark"] = m["total_return"] > b["total_return"]
    m["beat_benchmark_after_tax"] = m.get("after_tax_return", 0) > b.get("after_tax_return", 0)
    m["holdings"] = {s: q for s, q in pf.pos.items()}
    m.update(extra)
    # daily samples for charts (last bar of each UTC day)
    days = np.array([int(k) // DAY for k in keys])
    last = np.r_[days[1:] != days[:-1], True]
    if last.sum() < 60:                     # short (live) runs: keep every bar so the chart has a shape
        last[:] = True
    series = [(int(keys[i]), float(eq[i]), float(beq[i])) for i in np.where(last)[0]]
    return {"id": sdef["id"], "summary": m, "trades": pf.trades, "series": series}


def save(con, mode, res):
    sid = res["id"]
    con.execute("DELETE FROM trades WHERE mode=? AND strategy=?", (mode, sid))
    con.execute("DELETE FROM equity WHERE mode=? AND strategy=?", (mode, sid))
    con.executemany("INSERT INTO trades VALUES(?,?,?,?,?,?,?,?,?)",
                    [(mode, sid, int(t), s, q, p, f, q * p, r) for t, s, q, p, f, r in res["trades"]])
    con.executemany("INSERT INTO equity VALUES(?,?,?,?,?)", [(mode, sid, *x) for x in res["series"]])
    con.execute("INSERT OR REPLACE INTO runs VALUES(?,?,?,?)",
                (mode, sid, time.time(), json.dumps(res["summary"], default=float)))
    con.commit()


def run_mode(con, cfg, mode, kinds=("stocks", "crypto"), only=None):
    out = []
    sdefs = [s for s in cfg["strategies"] if not only or s["id"] in only]
    stock_defs = [s for s in sdefs if s["kind"] != "hl"]
    hl_defs = [s for s in sdefs if s["kind"] == "hl"]
    if mode == "backtest":
        s_start = date.fromisoformat(str(cfg["backtest"]["stocks_start"]))
        c_start = crypto_backtest_start(cfg)
    else:
        lt = db.kv_get(con, "live_start")
        # first full session after going live: never fill at an open that happened before we started
        s_start = datetime.fromtimestamp(lt, ET).date() + timedelta(days=1)
        c_start = lt
    if "stocks" in kinds and stock_defs:
        t0 = time.time()
        ctx = StockContext(con, cfg)
        log.info("stock context built in %.0fs", time.time() - t0)
        for s in stock_defs:
            try:
                r = run_stock(con, cfg, s, ctx, s_start)
                if r:
                    save(con, mode, r)
                    out.append(r)
            except Exception:
                log.exception("strategy %s failed", s["id"])
    if "crypto" in kinds and hl_defs:
        leaders = crypto.load_hist_leaders(con) if mode == "backtest" else None
        for s in hl_defs:
            try:
                r = run_crypto(con, cfg, s, mode, c_start, leaders=leaders)
                if r:
                    save(con, mode, r)
                    out.append(r)
            except Exception:
                log.exception("strategy %s failed", s["id"])
    return out
