"""Stock strategies: 13F funds and congressional traders -> target weights over time (no lookahead).

Every target event carries a decision time = when the information was public (+ configured delay).
The simulator only acts on it at the next market open after that time."""
import json
from collections import defaultdict
from datetime import date, datetime, timedelta

import numpy as np

from .sources.figi import cusip_map
from .timeutil import ET, day_t

DAY = 86400
CLOSE_LAG = 21 * 3600          # a daily bar keyed at 00:00 UTC is final by 21:00 UTC (16:00 ET + margin)
STALE_FUND_DAYS = 200          # a fund that hasn't filed for this long has stopped filing


class PriceMatrix:
    """Forward-filled daily closes on the SPY trading calendar, for leader books and ranking indices."""

    def __init__(self, con, syms, start):
        self.cal = np.array([t for (t,) in con.execute(
            "SELECT t FROM bars WHERE sym='SPY' AND iv='1d' AND t>=? ORDER BY t", (day_t(start),))], dtype=np.int64)
        self.close_t = self.cal + CLOSE_LAG
        pos = {int(t): i for i, t in enumerate(self.cal)}
        self.col = {}
        cols = []
        for s in sorted(syms):
            a = np.full(len(self.cal), np.nan)
            for t, c in con.execute("SELECT t, c FROM bars WHERE sym=? AND iv='1d' AND t>=?", (s, int(self.cal[0]))):
                j = pos.get(t)
                if j is not None:
                    a[j] = c
            if np.isfinite(a).any():
                self.col[s] = len(cols)
                cols.append(a)
        C = np.array(cols).T if cols else np.zeros((len(self.cal), 0))
        # forward fill
        for j in range(C.shape[1]):
            v = C[:, j]
            mask = np.isfinite(v)
            idx = np.where(mask, np.arange(len(v)), 0)
            np.maximum.accumulate(idx, out=idx)
            filled = v[idx]
            filled[:np.argmax(mask)] = np.nan
            C[:, j] = filled
        self.C = C

    def k(self, t):
        """Index of the last daily close that was final at time t (-1 if none)."""
        return int(np.searchsorted(self.close_t, t, "right")) - 1

    def px(self, sym, k):
        j = self.col.get(sym)
        if j is None or k < 0:
            return None
        v = self.C[k, j]
        return v if np.isfinite(v) else None


def normalize(w):
    tot = sum(v for v in w.values() if v > 0)
    return {s: v / tot for s, v in w.items() if v > 0} if tot > 0 else {}


# ------------------------------------------------------------------ 13F
def fund_events(con, pm):
    """{fund: [(decision_t, weights, info)]}. Weights = share of reported value per ticker, over the
    holdings we can price (unmapped CUSIPs and delisted names are dropped and the rest renormalized)."""
    cmap = cusip_map(con)
    out = defaultdict(list)
    for doc, fund, t, payload in con.execute(
            "SELECT doc_id, leader, public_time, payload FROM filings WHERE src='13f' ORDER BY public_time"):
        p = json.loads(payload)
        total = sum(p["holdings"].values()) or 1
        w = defaultdict(float)
        k = pm.k(t)
        for cusip, v in p["holdings"].items():
            tk = cmap.get(cusip)
            if tk and pm.px(tk, k) is not None:
                w[tk] += v
        priced = sum(w.values()) / total
        out[fund].append((t, normalize(w), {"period": p["period"], "priced_frac": priced}))
    return dict(out)


# ------------------------------------------------------------------ congress
class Books:
    """Each member's disclosed stock book in shares, rebuilt from their purchases/sales.
    Disclosures give $ ranges: we use the midpoint. A purchase adds midpoint / price-on-trade-date shares;
    a full sale removes the position; a partial sale removes midpoint / price shares (capped).
    A position not added to for `max_age_days` is assumed gone (members leave office, sales get missed)."""

    def __init__(self, con, pm, max_age_days=730):
        self.pm, self.max_age = pm, max_age_days * DAY
        self.filings = []
        for src, leader, t, payload in con.execute(
                "SELECT src, leader, public_time, payload FROM filings WHERE src IN ('house','senate') "
                "ORDER BY public_time"):
            txns = json.loads(payload).get("txns", [])
            if txns:
                self.filings.append((t, leader, txns))

    def run(self):
        """Yields (decision_t, leader, member_values, n_txns) per filing, in time order, where member_values
        is {ticker: $ value} of that member's book at that time. self.books holds the live state."""
        self.books = books = defaultdict(dict)          # leader -> ticker -> [shares, last_buy_t]
        pm = self.pm
        for t, leader, txns in self.filings:
            book = books[leader]
            n = 0
            for x in sorted(txns, key=lambda x: x["txn_date"]):
                tk = x["ticker"]
                d = date.fromisoformat(x["txn_date"])
                p = pm.px(tk, pm.k(day_t(d) + DAY - 1))
                if not p:
                    continue
                n += 1
                if x["side"] == "buy":
                    book[tk] = [book.get(tk, [0.0, 0])[0] + x["amount"] / p, t]
                elif tk in book:
                    if x["side"] == "sell_full":
                        del book[tk]
                    else:
                        book[tk][0] -= min(x["amount"] / p, book[tk][0])
                        if book[tk][0] <= 1e-9:
                            del book[tk]
            yield t, leader, self.values(book, t), n

    def values(self, book, t):
        k = self.pm.k(t)
        out = {}
        for tk, (sh, last) in list(book.items()):
            if t - last > self.max_age:
                del book[tk]
                continue
            p = self.pm.px(tk, k)
            if p:
                out[tk] = sh * p
        return out


def congress_events(con, pm, max_age_days=730):
    """Per-member events, combined all-members events (dollar-weighted, i.e. bigger disclosed trades weigh
    more), and per-member txn times (for the min-activity rule)."""
    per, txn_times, combined = defaultdict(list), defaultdict(list), []
    books = Books(con, pm, max_age_days)
    pending = None

    def emit(t):
        k = pm.k(t)
        agg = defaultdict(float)
        for lb in books.books.values():
            for tk, (sh, last) in lb.items():
                if t - last <= books.max_age:
                    p = pm.px(tk, k)
                    if p:
                        agg[tk] += sh * p
        combined.append((t, normalize(agg), "disclosure"))

    for t, leader, vals, n in books.run():
        if pending is not None and t != pending:
            emit(pending)
            pending = None
        per[leader].append((t, normalize(vals), {"n": n}))
        txn_times[leader] += [t] * n
        if n:
            pending = t
    if pending is not None:
        emit(pending)
    return dict(per), combined, dict(txn_times)


# ------------------------------------------------------------------ ranking + composites
def leader_index(events, pm):
    """Frictionless value index of holding a leader's latest disclosed weights (close to close).
    Only uses each event from the first close after it was public. Returns array over pm.cal (NaN before)."""
    n = len(pm.cal)
    idx = np.full(n, np.nan)
    if not events:
        return idx
    ks = [max(pm.k(t), 0) for t, _, _ in events]
    val, cols, sh = 1.0, None, None
    for i, (t, w, _) in enumerate(events):
        k0 = ks[i] if pm.k(t) >= 0 else 0
        k1 = ks[i + 1] if i + 1 < len(events) else n
        if k1 <= k0 and i + 1 < len(events):
            continue                                   # superseded before the next close
        if cols is not None and k0 > 0:
            val = float(pm.C[k0, cols] @ sh) if len(cols) else val
        ww = {s: x for s, x in w.items() if s in pm.col and np.isfinite(pm.C[k0, pm.col[s]])}
        ww = normalize(ww)
        cols = np.array([pm.col[s] for s in ww], dtype=int)
        sh = np.array([ww[s] * val / pm.C[k0, pm.col[s]] for s in ww]) if ww else np.zeros(0)
        seg = pm.C[k0:k1, cols] @ sh if len(cols) else np.full(k1 - k0, val)
        idx[k0:k1] = seg
    return idx


def trailing_return(idx, pm, t, lookback_days):
    k, kb = pm.k(t), pm.k(t - lookback_days * DAY)
    if k < 0 or kb < 0 or not np.isfinite(idx[kb]) or not np.isfinite(idx[k]) or idx[kb] <= 0:
        return None
    return idx[k] / idx[kb] - 1


def quarter_starts(start, end, month_offset_days=0):
    """Reselection times: 00:00 ET on Jan/Apr/Jul/Oct 1 (+offset days), plus `start` itself."""
    out = [datetime.combine(start, datetime.min.time(), ET).timestamp()]
    y = start.year
    while True:
        for m in (1, 4, 7, 10):
            d = date(y, m, 1) + timedelta(days=month_offset_days)
            if d > end:
                return sorted(set(out))
            if d > start:
                out.append(datetime.combine(d, datetime.min.time(), ET).timestamp())
        y += 1


def latest(events, t):
    """Latest event with decision time <= t, or None."""
    lo = None
    for e in events:
        if e[0] <= t:
            lo = e
        else:
            break
    return lo


def average_weights(ws):
    agg = defaultdict(float)
    for w in ws:
        for s, x in w.items():
            agg[s] += x / len(ws)
    return dict(agg)


def basket_events(fund_ev, since_t):
    """Equal-weight blend of every fund's latest 13F, re-emitted whenever any fund files."""
    times = sorted({e[0] for ev in fund_ev.values() for e in ev})
    out = []
    for t in times:
        cur = [latest(ev, t) for ev in fund_ev.values()]
        cur = [e[1] for e in cur if e and t - e[0] < STALE_FUND_DAYS * DAY and e[1]]
        if cur:
            out.append((t, average_weights(cur), "13F filed"))
    return out


def trailing_events(leader_ev, pm, start, end, n, lookback_days, eligible, offset_days=0):
    """Reselect the top-n leaders by trailing index return each quarter; target = equal-weight blend of
    their latest weights. eligible(leader, t) filters candidates using only information known at t."""
    idx = {l: leader_index(ev, pm) for l, ev in leader_ev.items()}
    resel = quarter_starts(start, end, offset_days)
    times = sorted(set(resel) | {e[0] for ev in leader_ev.values() for e in ev if e[0] >= resel[0]})
    out, chosen, picks = [], [], []
    rs = set(resel)
    for t in times:
        changed = False
        if t in rs:
            scored = []
            for l in leader_ev:
                if not eligible(l, t):
                    continue
                r = trailing_return(idx[l], pm, t, lookback_days)
                if r is not None:
                    scored.append((r, l))
            scored.sort(reverse=True)
            new = [l for _, l in scored[:n]]
            picks.append({"t": t, "leaders": [(l, round(r, 4)) for r, l in scored[:n]]})
            changed = new != chosen
            chosen = new
        elif not any(e[0] == t for l in chosen for e in leader_ev[l]):
            continue
        cur = [latest(leader_ev[l], t) for l in chosen]
        cur = [e[1] for e in cur if e and e[1]]
        if cur:
            out.append((t, average_weights(cur), "reselect" if changed else "leader filed"))
        elif changed:
            out.append((t, {}, "no eligible leaders"))
    return out, picks
