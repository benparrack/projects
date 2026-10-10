"""Hyperliquid copy strategies: pick leaders by rules using only data available at selection time,
then mirror their positions as a fraction of their account value, scaled to our max leverage."""
import json
import logging
import time
from collections import defaultdict
from datetime import datetime, timezone

import numpy as np

from .sources import hyperliquid as hl

log = logging.getLogger("crypto")
DAY = 86400


class HistLeader:
    """Backtest view of a trader: positions rebuilt backwards from a snapshot using every fill since,
    account value / PnL from their portfolio history."""

    def __init__(self, user, ref_t, ref_pos, fills, fills_from, portfolio):
        self.user, self.ref_t, self.fills_from = user, ref_t, fills_from
        self.ref_pos = ref_pos
        by = defaultdict(list)
        for t, coin, sz in fills:
            by[coin].append((t, sz))
        self.coin_t, self.coin_suffix = {}, {}
        for coin, xs in by.items():
            ts = np.array([x[0] for x in xs], dtype=float)
            sz = np.array([x[1] for x in xs])
            self.coin_t[coin] = ts
            self.coin_suffix[coin] = np.concatenate([np.cumsum(sz[::-1])[::-1], [0.0]])   # sum of fills at index>=j
        self.fill_t = np.sort(np.array([f[0] for f in fills], dtype=float))
        a = portfolio.get("allTime", {})
        self.av_hist = np.array(a.get("av") or [(0, np.nan)], dtype=float)
        self.pnl_hist = np.array(a.get("pnl") or [(0, np.nan)], dtype=float)

    def coins(self):
        return set(self.coin_t) | set(self.ref_pos)

    def positions(self, t):
        out = {}
        for coin in self.coins():
            p = self.ref_pos.get(coin, 0.0)
            ts = self.coin_t.get(coin)
            if ts is not None:
                j = int(np.searchsorted(ts, t, "right"))
                p -= self.coin_suffix[coin][j]
            if abs(p) > 1e-12:
                out[coin] = p
        return out

    def _interp(self, h, t):
        if not len(h) or t < h[0, 0] or not np.isfinite(h[0, 1]):
            return np.nan
        return float(np.interp(t, h[:, 0], h[:, 1]))

    def av(self, t):
        return self._interp(self.av_hist, t)

    def pnl(self, t):
        return self._interp(self.pnl_hist, t)

    def fills_between(self, a, b):
        return int(np.searchsorted(self.fill_t, b, "right") - np.searchsorted(self.fill_t, a, "left"))

    def covered(self, t):
        return t >= self.fills_from


class SnapshotLeader:
    """Live view: whatever the latest stored clearinghouse snapshot at/before t says."""

    def __init__(self, user, snaps):
        self.user = user
        self.snaps = sorted(snaps)                  # [(t, av, positions)]
        self.ts = np.array([s[0] for s in self.snaps], dtype=float)

    def _at(self, t):
        j = int(np.searchsorted(self.ts, t, "right")) - 1
        return self.snaps[j] if j >= 0 else None

    def positions(self, t):
        s = self._at(t)
        return dict(s[2]) if s else {}

    def av(self, t):
        s = self._at(t)
        return s[1] if s else np.nan

    def coins(self):
        return {c for s in self.snaps for c in s[2]}


def load_hist_leaders(con):
    out = {}
    fills = defaultdict(list)
    for user, t, coin, sz in con.execute("SELECT user, t, coin, sz FROM hl_fills ORDER BY t"):
        fills[user].append((t, coin, sz))
    for user, fetched, ff, trunc, ref_t, av, pos, port in con.execute("SELECT * FROM hl_users"):
        out[user] = HistLeader(user, ref_t, json.loads(pos), fills.get(user, []), ff, json.loads(port))
    return out


def load_snapshot_leaders(con, users):
    out = {}
    for u in users:
        snaps = [(t, av, json.loads(p)) for t, av, p in
                 con.execute("SELECT t, account_value, positions FROM hl_snapshots WHERE user=?", (u,))]
        out[u] = SnapshotLeader(u, snaps)
    return out


# ------------------------------------------------------------------ selection
def leader_stats(l, t):
    av_t, av30, av90 = l.av(t), l.av(t - 30 * DAY), l.av(t - 90 * DAY)
    p_t, p30, p90 = l.pnl(t), l.pnl(t - 30 * DAY), l.pnl(t - 90 * DAY)
    return {"av": av_t, "pnl30": p_t - p30, "pnl90": p_t - p90,
            # deposits inflate the end balance, withdrawals the start one: dividing by the larger of the two
            # keeps a fresh deposit from looking like a 10,000% month
            "roi30": (p_t - p30) / max(av30, av_t) if np.isfinite(av30) and max(av30, av_t) > 0 else np.nan,
            "roi90": (p_t - p90) / max(av90, av_t) if np.isfinite(av90) and max(av90, av_t) > 0 else np.nan,
            "fills30": l.fills_between(t - 30 * DAY, t)}


def select(leaders, t, rank, n, hcfg, need_coverage=True):
    """Rules (all evaluated with data up to t): account value >= min, profitable over the last 30 days
    (and 90 for roi90), 3..max_fills fills in the last 30 days (active but not HFT), and for backtests
    a complete fill history from t on. Rank by 30- or 90-day return on account value."""
    scored = []
    for u, l in leaders.items():
        if need_coverage and not l.covered(t):
            continue
        s = leader_stats(l, t)
        if not (np.isfinite(s["av"]) and s["av"] >= hcfg["min_account_value"]):
            continue
        if not (3 <= s["fills30"] <= hcfg["max_fills_30d"]) or not s["pnl30"] > 0:
            continue
        if rank == "roi90" and not s["pnl90"] > 0:
            continue
        score = s[rank]
        if np.isfinite(score):
            scored.append((score, u, s))
    scored.sort(key=lambda x: -x[0])
    return [(u, round(sc, 4)) for sc, u, _ in scored[:n]]


def month_starts(start_t, end_t):
    d = datetime.fromtimestamp(start_t, timezone.utc)
    out = [start_t]
    y, m = d.year, d.month
    while True:
        m += 1
        if m > 12:
            y, m = y + 1, 1
        t = datetime(y, m, 1, tzinfo=timezone.utc).timestamp()
        if t > end_t:
            return out
        out.append(t)


class CopyTarget:
    """target_fn for the simulator: at each bar, the average of the selected leaders' exposures
    (position notional / leader account value, sampled `delay` seconds before the bar opens),
    scaled down so gross exposure <= max_leverage."""

    def __init__(self, times, bars, selections, leaders, delay, max_leverage):
        self.times, self.bars, self.sel, self.leaders = times, bars, selections, leaders
        self.delay, self.max_lev = delay, max_leverage
        self.sel_t = [s[0] for s in selections]

    def __call__(self, i):
        t = self.times[i]
        j = int(np.searchsorted(self.sel_t, t, "right")) - 1
        chosen = self.sel[j][1] if j >= 0 else []
        tq = t - self.delay
        w = defaultdict(float)
        for u in chosen:
            l = self.leaders.get(u)
            if l is None:
                continue
            av = l.av(tq)
            if not np.isfinite(av) or av <= 0:
                continue
            for coin, q in l.positions(tq).items():
                b = self.bars.get(coin)
                if b is None or not np.isfinite(b[0, i]):
                    continue
                w[coin] += q * b[0, i] / av / len(chosen)
        gross = sum(abs(x) for x in w.values())
        if gross > self.max_lev:
            w = {c: x * self.max_lev / gross for c, x in w.items()}
        return dict(w), "copy"


# ------------------------------------------------------------------ live helpers
def live_candidates(con, hcfg, n_wanted):
    """Selection inputs for live mode, fetched now: leaderboard pool -> portfolio history + recent fill
    count for the plausible ones. Returns {user: leader-like object with av/pnl/fills_between}."""
    rows = hl.pool_filter(hl.leaderboard(), hcfg)[:hcfg["pool_size"]]
    rows = [r for r in rows if r["month_pnl"] > 0]
    rows.sort(key=lambda r: -r["month_pnl"] / r["account_value"])
    out = {}
    now = time.time()
    for r in rows[:max(40, 8 * n_wanted)]:
        try:
            port = hl.portfolio(r["user"])
            batch = hl.info({"type": "userFillsByTime", "user": r["user"], "startTime": int((now - 30 * DAY) * 1000)})
            fl = HistLeader(r["user"], int(now), {}, [], 0, port)
            fl.fill_t = np.array(sorted(f["time"] / 1000 for f in batch))
            if len(batch) >= 2000:          # more than one page: certainly above any sane max_fills
                fl.fill_t = np.full(hcfg["max_fills_30d"] + 1, now - DAY)
            out[r["user"]] = fl
        except Exception as e:
            log.warning("candidate %s failed: %s", r["user"], e)
    return out
