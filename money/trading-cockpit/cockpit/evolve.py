"""Natural selection for trading strategies.

A population of strategies (strategies.py: batch 1 = 308 incl. 24 placebos, batch 2 = ~1,000 new incl. 84 placebos —
published rules, variants, and labeled made-up combinations) plus coin-flip placebos is backtested on the last
year of daily data for ~600 US stocks (S&P 500 + well-known small/mid caps). The stocks are dealt into cohorts;
each generation, the surviving strategies face a NEW cohort they have never traded, and die if they:

  1. starve      too few trades to judge,
  2. lose money  negative average trade, pooled over every cohort so far,
  3. trail luck  cumulative edge over random entries (same exits, same stocks, same days) is not positive,
  4. are outcompeted  bottom share by cumulative edge score (t-stat of the edge).

Survivors then sit a final exam (positive edge with z >= EXAM_Z) on a holdout cohort no strategy was ever selected on, plus a check on the PRIOR
year (a different market regime). Finalists go on to a live paper trial: from the promotion day on, every signal
is traded at the next real open, and strategies are eliminated or "graduated" by the same edge test.

The placebos are the control group. They go through exactly the same selection, so the share of placebos that
survive is the share of real strategies you should expect to survive by luck alone.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import logging
import multiprocessing as mp
import os
import random
import threading
import time
import traceback
from pathlib import Path

import numpy as np
import pandas as pd
from flask import jsonify, request

from . import db, lab, market, strategies
from .service import UserError

log = logging.getLogger("evolve")
DIR = db.ROOT / "data" / "evolution"
YEARS = 3          # history to download: ~200 days of indicator warm-up + the prior year + the test year
WINDOW = 252       # trading days in "the last year"
WARMUP = 260       # bars an indicator may need (52-week high = 252) before a trade can count
COST_BPS = 10      # per side
DEFAULTS = {"generations": 5, "cull": 0.35, "min_trades": 8, "seed": 2026, "batch": 2}
BATCHES = {1: "Batch 1 · 308 strategies (Oct 2026)", 2: "Batch 2 · ~1,000 new strategies (Oct 2026)"}
EXAM_Z = 1.0      # final exam: the holdout edge must be at least one standard error above random entries
# Live trial gates: judged only on trades made after promotion.
LIVE_ELIM = {"days": 10, "trades": 15, "z": -1.0}  # early exit: clearly worse than random entries
LIVE_GRAD = {"days": 20, "trades": 25, "z": 1.65}

_UNI = Path(__file__).parent / "universes"
_job = {"state": "idle"}
_job_lock = threading.Lock()


# ---------- universe ----------
def universe() -> list[tuple[str, str]]:
    """(ticker, segment): 'large' for the S&P 500, 'small' for well-known small/mid caps and volatile names."""
    out, seen = [], set()
    for name, seg in (("sp500", "large"), ("volatile", "small"), ("smallcap", "small")):
        with open(_UNI / f"{name}.csv", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                t = market.norm(r["ticker"]).replace(".", "-")  # Yahoo spells BRK.B as BRK-B
                if t and t not in seen:
                    seen.add(t)
                    out.append((t, seg))
    return out


def _exit_key(s: dict) -> str:
    return json.dumps([s["exit"], s["stop_type"], s["stop_value"], s["target_r"], s["max_hold"]])


# ---------- per-ticker scan (runs in worker processes) ----------
def scan_ticker(tk: str, specs: list[dict], since: str | None = None) -> dict | None:
    """Every strategy's trades on one stock, plus the random-entry baseline for each exit setup.

    Without `since`: two windows, 'cur' = entries in the last WINDOW bars, 'prior' = the WINDOW bars before that.
    With `since` (live trial): one window, entries after that date. Trades still open are marked at the last close.
    """
    try:
        df = market.completed(market.history(tk, years=YEARS), tk)
    except Exception as e:
        return {"ticker": tk, "error": str(e)}
    n = len(df)
    if since:
        start = int(df.index.searchsorted(pd.Timestamp(since), side="right"))
        bounds = {"live": (max(start, WARMUP), n)}
    else:
        if n < WARMUP + 60:
            return {"ticker": tk, "error": "not enough history"}
        cs = max(WARMUP, n - WINDOW)
        bounds = {"cur": (cs, n), "prior": (max(WARMUP, cs - WINDOW), cs)}
    first = min(a for a, _ in bounds.values())
    dates = df.index.strftime("%Y-%m-%d")
    sigs, exits, ocs = {}, {}, {}
    trades, base = [], {}
    signals = []
    for si, s in enumerate(specs):
        try:
            if s["entry"] not in sigs:
                sigs[s["entry"]] = lab.evaluate(s["entry"], df).to_numpy(bool)
            if s["exit"] and s["exit"] not in exits:
                exits[s["exit"]] = lab.evaluate(s["exit"], df)
        except Exception as e:  # a rule that can't run on this stock just doesn't trade it
            log.info("%s %s: %s", tk, s["id"], e)
            continue
        key = _exit_key(s)
        if key not in ocs:
            spec = {"stop_type": s["stop_type"], "stop_value": s["stop_value"], "target_r": s["target_r"],
                    "max_hold": s["max_hold"], "cost_bps": COST_BPS}
            oc = lab.outcomes(df, spec, exits.get(s["exit"]) if s["exit"] else None, start=first, mark_open=True)
            ocs[key] = (oc["ret"].to_numpy(float), oc["exit_i"].to_numpy(int), oc["why"].to_numpy(object))
            ret = ocs[key][0]
            base[key] = {w: [float(np.nansum(ret[a:b])), int(np.isfinite(ret[a:b]).sum())] for w, (a, b) in bounds.items()}
        ret, ex_i, why = ocs[key]
        sig = sigs[s["entry"]]
        if sig[-1]:
            signals.append(si)
        busy = -1
        for i in np.flatnonzero(sig[first - 1:n - 1]) + first - 1:
            d0 = i + 1
            if d0 <= busy or not np.isfinite(ret[d0]):
                continue
            w = next((w for w, (a, b) in bounds.items() if a <= d0 < b), None)
            if w is None:
                continue
            j = int(ex_i[d0])
            trades.append((si, w, dates[d0], dates[j], round(float(ret[d0]), 6), int(j - d0 + 1), str(why[d0])))
            busy = j
    return {"ticker": tk, "trades": trades, "base": base, "signals": signals, "last": dates[-1], "bars": n,
            "close": float(df["Close"].iat[-1])}


def _scan_job(args):
    tk, specs, since = args
    try:
        return scan_ticker(tk, specs, since)
    except Exception as e:
        return {"ticker": tk, "error": f"{type(e).__name__}: {e}"}


def scan_all(tickers: list[str], specs: list[dict], since: str | None = None, progress=None) -> list[dict]:
    jobs = [(t, specs, since) for t in tickers]
    out = []
    procs = max(1, min(20, (os.cpu_count() or 2) - 2))
    with mp.get_context("fork").Pool(procs) as pool:
        for k, r in enumerate(pool.imap_unordered(_scan_job, jobs, chunksize=2)):
            out.append(r)
            if progress:
                progress(k + 1, len(jobs))
    return out


# ---------- statistics ----------
def _stats(rets: list[float], base: tuple[float, int], days: list[str] | None = None) -> dict:
    """Average trade vs the random-entry baseline. z is the t-stat of the difference.

    Trades entered on the same day move together (one market), so the standard error is clustered by entry
    day: 1,000 turn-of-the-month trades spread over 12 days count as roughly 12 observations, not 1,000.
    """
    n = len(rets)
    b = base[0] / base[1] if base[1] else 0.0
    if not n:
        return {"n": 0, "mean": None, "base": b, "excess": None, "z": None, "win": None, "days": 0}
    a = np.asarray(rets)
    m = float(a.mean())
    if days is None:
        days = list(range(n))
    cl = pd.Series(a - m).groupby(np.asarray(days)).sum().to_numpy()
    k = len(cl)
    se = float(np.sqrt((cl ** 2).sum() * k / max(k - 1, 1))) / n if k > 1 else np.nan
    z = float((m - b) / se) if np.isfinite(se) and se > 0 else 0.0
    return {"n": n, "mean": m, "base": b, "excess": m - b, "z": z, "win": float((a > 0).mean()),
            "total": float(a.sum()), "days": k}


def _gather(scans: list[dict], specs: list[dict], tickers: set[str], window: str):
    """Per strategy: trade returns, their entry days, the trades, and the pooled baseline (sum, count) for its exit setup."""
    rets = [[] for _ in specs]
    days = [[] for _ in specs]
    trades = [[] for _ in specs]
    base = {}
    for sc in scans:
        if sc.get("error") or sc["ticker"] not in tickers:
            continue
        for t in sc["trades"]:
            if t[1] == window:
                rets[t[0]].append(t[4])
                days[t[0]].append(t[2])
                trades[t[0]].append((sc["ticker"], *t[2:]))
        for k, v in sc["base"].items():
            s, c = v.get(window, [0, 0])
            acc = base.setdefault(k, [0.0, 0])
            acc[0] += s
            acc[1] += c
    return rets, days, trades, base


def _deal(tickers: list[tuple[str, str]], k: int, seed: int) -> list[list[str]]:
    """Shuffle each segment and deal round-robin, so every cohort has the same mix of large and small caps."""
    rng = random.Random(seed)
    cohorts = [[] for _ in range(k)]
    i = 0
    for seg in ("large", "small"):
        part = sorted(t for t, s in tickers if s == seg)
        rng.shuffle(part)
        for t in part:
            cohorts[i % k].append(t)
            i += 1
    return cohorts


def select(scans: list[dict], specs: list[dict], segs: dict[str, str], cfg: dict) -> dict:
    """The natural-selection rounds, final exam and prior-year check. Pure: works on finished scans."""
    ok = [(sc["ticker"], segs[sc["ticker"]]) for sc in scans if not sc.get("error")]
    G = cfg["generations"]
    cohorts = _deal(ok, G + 1, cfg["seed"])
    holdout = cohorts[-1]
    keys = [_exit_key(s) for s in specs]
    alive = set(range(len(specs)))
    fate = {i: {"status": "alive"} for i in alive}
    hist = {i: [] for i in alive}
    cum_rets = [[] for _ in specs]
    cum_days = [[] for _ in specs]
    cum_base = [[0.0, 0] for _ in specs]
    gens = []
    for g in range(G):
        rets, days, _, base = _gather(scans, specs, set(cohorts[g]), "cur")
        before = len(alive)
        deaths = {"starved": 0, "lost money": 0, "trailed luck": 0, "outcompeted": 0}
        scores = {}
        for i in sorted(alive):
            b = base.get(keys[i], [0.0, 0])
            st = _stats(rets[i], b, days[i])
            cum_rets[i] += rets[i]
            cum_days[i] += days[i]
            cum_base[i][0] += b[0]
            cum_base[i][1] += b[1]
            cs = _stats(cum_rets[i], cum_base[i], cum_days[i])
            hist[i].append({"g": g + 1, **{k: st[k] for k in ("n", "mean", "base", "excess", "z", "win")},
                            "cum_excess": cs["excess"], "cum_z": cs["z"], "cum_n": cs["n"]})
            cause = None
            if cs["n"] < cfg["min_trades"] * (g + 1):
                cause = "starved"
            elif cs["mean"] <= 0:
                cause = "lost money"
            elif cs["excess"] is None or cs["excess"] <= 0:
                cause = "trailed luck"
            if cause:
                deaths[cause] += 1
                fate[i] = {"status": "dead", "gen": g + 1, "cause": cause}
            else:
                scores[i] = cs["z"]
        survivors = sorted(scores, key=scores.get)
        cut = int(len(survivors) * cfg["cull"]) if len(survivors) > 3 else 0
        for i in survivors[:cut]:
            deaths["outcompeted"] += 1
            fate[i] = {"status": "dead", "gen": g + 1, "cause": "outcompeted"}
        alive = set(survivors[cut:])
        placebo = sum(1 for i in alive if specs[i]["family"] == "placebo")
        gens.append({"g": g + 1, "tickers": len(cohorts[g]), "alive_before": before, "alive": len(alive),
                     "placebo_alive": placebo, "deaths": deaths})

    # Final exam on the untouched holdout cohort, and the same strategy on the prior year (all stocks).
    h_rets, h_days, h_trades, h_base = _gather(scans, specs, set(holdout), "cur")
    sel = set(t for c in cohorts[:-1] for t in c)
    p_rets, p_days, _, p_base = _gather(scans, specs, set(t for t, _ in ok), "prior")
    a_rets, a_days, a_trades, a_base = _gather(scans, specs, set(t for t, _ in ok), "cur")
    out = []
    for i, s in enumerate(specs):
        ho = _stats(h_rets[i], h_base.get(keys[i], [0, 0]), h_days[i])
        pr = _stats(p_rets[i], p_base.get(keys[i], [0, 0]), p_days[i])
        al = _stats(a_rets[i], a_base.get(keys[i], [0, 0]), a_days[i])
        f = fate[i]
        if f["status"] == "alive":
            cause = ("starved" if ho["n"] < cfg["min_trades"] else "lost money" if ho["mean"] <= 0 else
                     "trailed luck" if ho["excess"] <= 0 else "weak edge" if ho["z"] < EXAM_Z else None)
            f = {"status": "failed exam" if cause else "finalist", "gen": G + 1 if cause else None, "cause": cause,
                 "prior_ok": bool(pr["n"] >= cfg["min_trades"] and pr["excess"] > 0)}
        row = {**s, "source": strategies.FAMILIES[s["family"]][2], "kind": strategies.FAMILIES[s["family"]][1],
               "exit_text": strategies.describe(s), "fate": f, "gens": hist[i], "holdout": ho, "prior": pr, "all": al}
        if f["status"] in ("finalist", "failed exam"):
            row["sim"] = _sim([t for t in a_trades[i] if t[0] in sel])
            row["sim_holdout"] = _sim(h_trades[i])
            row["recent"] = sorted(a_trades[i], key=lambda t: t[1], reverse=True)[:60]
        out.append(row)
    real = [r for r in out if r["family"] != "placebo"]
    plac = [r for r in out if r["family"] == "placebo"]
    surv = lambda rs: sum(r["fate"]["status"] in ("finalist", "failed exam") for r in rs)
    fin = lambda rs: sum(r["fate"]["status"] == "finalist" for r in rs)
    return {"generations": gens, "strategies": out, "cohorts": cohorts, "holdout": holdout,
            "summary": {"strategies": len(real), "placebos": len(plac), "tickers": len(ok),
                        "large": sum(1 for _, s in ok if s == "large"), "small": sum(1 for _, s in ok if s == "small"),
                        "survived": surv(real), "finalists": fin(real),
                        "placebo_survived": surv(plac), "placebo_finalists": fin(plac),
                        "real_rate": fin(real) / max(1, len(real)), "placebo_rate": fin(plac) / max(1, len(plac))}}


def _sim(trades: list[tuple], draws: int = 25) -> dict:
    """$10k account, 10 slots of 10% each, using the Lab's account simulator.

    Most days have more signals than free slots, and which ones the account takes changes the result a lot.
    So it's run `draws` times with the day's signals in random order; the median run is shown, with the spread.
    """
    if not trades:
        return {"trades": 0}
    rng = random.Random(len(trades))
    runs = []
    for _ in range(draws):
        tt = [{"ticker": f"{rng.random():.12f}", "entry_date": t[1], "exit_date": t[2], "ret": t[3], "risk_frac": None}
              for t in trades]  # the sim breaks same-day ties by ticker, so a random key = random pick order
        runs.append(lab.portfolio_sim(tt, max_positions=10, max_pos_pct=0.10))
    runs.sort(key=lambda r: r["total_return"])
    r = runs[len(runs) // 2]
    r["p10"], r["p90"] = runs[len(runs) // 10]["total_return"], runs[-1 - len(runs) // 10]["total_return"]
    r["draws"] = draws
    curve = r.get("curve") or []
    step = max(1, len(curve) // 120)
    r["curve"] = curve[::step] + curve[-1:] if curve else []
    return r


# ---------- runs ----------
def _write(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj, default=_json_default, separators=(",", ":")))
    tmp.replace(path)


def _json_default(o):
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return None if not np.isfinite(o) else float(o)
    return str(o)


def _clean_nan(o):
    if isinstance(o, float):
        return o if np.isfinite(o) else None
    if isinstance(o, dict):
        return {k: _clean_nan(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean_nan(v) for v in o]
    return o


def _set_job(**kw):
    with _job_lock:
        _job.update(kw)


def run(cfg: dict | None = None, promote: bool = True) -> dict:
    cfg = {**DEFAULTS, **(cfg or {})}
    t0 = time.time()
    specs = strategies.library(cfg.get("batch", 1))
    uni = universe()
    segs = dict(uni)
    tickers = [t for t, _ in uni]
    _set_job(state="running", phase="Downloading 3 years of prices", done=0, total=len(tickers), started=db.now())
    market.prefetch(tickers + ["SPY"], years=YEARS)
    _set_job(phase=f"Backtesting {len(specs)} strategies on {len(tickers)} stocks", done=0)
    scans = scan_all(tickers, specs, progress=lambda k, n: _set_job(done=k, total=n))
    _set_job(phase="Natural selection")
    res = select(scans, specs, segs, cfg)
    last = max((sc["last"] for sc in scans if not sc.get("error")), default=None)
    rid = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    res.update(id=rid, created_at=db.now(), config=cfg, data_end=last, seconds=round(time.time() - t0, 1),
               skipped=[f"{sc['ticker']}: {sc['error']}" for sc in scans if sc.get("error")],
               sources={k: {"title": v[0], "url": v[1]} for k, v in strategies.SOURCES.items()},
               families={k: {"name": v[0], "kind": v[1], "source": v[2]} for k, v in strategies.FAMILIES.items()})
    res = _clean_nan(res)
    _write(DIR / "runs" / f"{rid}.json", res)
    if promote:
        promote_finalists(res)
    return res


def runs() -> list[dict]:
    out = []
    for p in sorted((DIR / "runs").glob("*.json"), reverse=True):
        try:
            r = json.loads(p.read_text())
        except Exception:
            continue
        out.append({"id": r["id"], "created_at": r["created_at"], "summary": r["summary"], "data_end": r.get("data_end")})
    return out


def load_run(rid: str | None = None) -> dict | None:
    paths = sorted((DIR / "runs").glob("*.json"), reverse=True)
    if rid:
        paths = [p for p in paths if p.stem == rid]
    return json.loads(paths[0].read_text()) if paths else None


# ---------- live trial ----------
LIVE = DIR / "live.json"


def live_state() -> dict:
    try:
        return json.loads(LIVE.read_text())
    except Exception:
        return {"strategies": {}, "updated_at": None}


def promote_finalists(res: dict) -> list[str]:
    """Finalists start a paper trial from the run's last data day. A strategy already on trial keeps its record."""
    st = live_state()
    added = []
    for r in res["strategies"]:
        if r["fate"]["status"] != "finalist" or r["family"] == "placebo" or r["id"] in st["strategies"]:
            continue
        spec = {k: r[k] for k in ("id", "family", "name", "entry", "exit", "stop_type", "stop_value", "target_r",
                                  "max_hold", "source", "kind", "exit_text")}
        st["strategies"][r["id"]] = {"spec": spec, "since": res["data_end"], "run_id": res["id"], "status": "on trial",
                                     "backtest": {"all": r["all"], "holdout": r["holdout"], "prior": r["prior"]},
                                     "history": [], "promoted_at": db.now()}
        added.append(r["id"])
    _write(LIVE, st)
    return added


def live_status(stats: dict, days: int) -> tuple[str, str]:
    """Trial verdict from trades made since promotion (closed and open, marked to market)."""
    n = stats["n"]
    # One bad day can bring 50 losing trades, so both exits wait for enough days, not just enough trades.
    early = days >= LIVE_ELIM["days"] and n >= LIVE_ELIM["trades"] and (stats["z"] or 0) <= LIVE_ELIM["z"]
    full = days >= LIVE_GRAD["days"] and n >= LIVE_GRAD["trades"] and (stats["mean"] <= 0 or stats["excess"] <= 0)
    if early or full:
        return "eliminated", (f"After {n} live trades over {days} trading days it averaged {stats['mean']:+.2%} per trade "
                              f"vs {stats['base']:+.2%} for random entries (z={stats['z']:.2f}).")
    if days >= LIVE_GRAD["days"] and n >= LIVE_GRAD["trades"] and stats["z"] >= LIVE_GRAD["z"] and stats["mean"] > 0:
        return "graduated", (f"{n} live trades over {days} trading days: {stats['mean']:+.2%} per trade, beating random "
                             f"entries by {stats['excess']:+.2%} (z={stats['z']:.2f}). Candidate for real money.")
    need = []
    if n < LIVE_GRAD["trades"]:
        need.append(f"{LIVE_GRAD['trades'] - n} more trades")
    if days < LIVE_GRAD["days"]:
        need.append(f"{LIVE_GRAD['days'] - days} more trading days")
    if n and stats["z"] is not None and stats["z"] < LIVE_GRAD["z"]:
        need.append(f"an edge of z ≥ {LIVE_GRAD['z']} (now {stats['z']:.2f})")
    return "on trial", "Needs " + ", ".join(need) + "." if need else "On trial."


def _day_rets(t: tuple, df: pd.DataFrame) -> pd.Series:
    """One trade's daily returns (open→close on day one, then close→close), with the last day set so they compound
    to the trade's net return. Exits at a stop or the open are thereby booked on the exit day."""
    d = df.loc[t[1]:t[2]]
    if d.empty:
        return pd.Series(dtype=float)
    c = d["Close"].to_numpy(float)
    f = np.r_[c[0] / float(d["Open"].iat[0]), c[1:] / c[:-1]]
    f[-1] = (1 + t[3]) / np.prod(f[:-1])
    return pd.Series(f - 1, index=d.index.strftime("%Y-%m-%d"))


def _book(trades: list[tuple], frames: dict, days: list[str]) -> list[dict]:
    """Equal-weight book: each day the money is split evenly across every open position (cash when there are none)."""
    per_day: dict[str, list[float]] = {}
    for t in trades:
        if t[0] in frames:
            for d, r in _day_rets(t, frames[t[0]]).items():
                per_day.setdefault(d, []).append(r)
    v, out = 1.0, []
    for d in days:
        v *= 1 + (float(np.mean(per_day[d])) if d in per_day else 0.0)
        out.append({"d": d, "v": round(v, 6), "n": len(per_day.get(d, ()))})
    return out


def _position(t: tuple, df: pd.DataFrame, max_hold: int) -> dict:
    """An open trade as a position: entry price, last close, today's move and the closes since entry."""
    d = df.loc[t[1]:]
    c = d["Close"].to_numpy(float)
    prev = df["Close"].loc[:d.index[-1]].iloc[-2] if len(df.loc[:d.index[-1]]) > 1 else c[-1]
    return {"t": t[0], "d": t[1], "px0": round(float(d["Open"].iat[0]), 4), "px": round(float(c[-1]), 4),
            "ret": t[3], "chg": float(c[-1] / prev - 1), "held": len(d), "max": max_hold,
            "path": [round(float(x), 4) for x in c[-60:]]}


def refresh_live(progress=None) -> dict:
    st = live_state()
    active = {sid: v for sid, v in st["strategies"].items() if v["status"] != "eliminated"}
    if not active:
        st["updated_at"] = db.now()
        _write(LIVE, st)
        return st
    tickers = [t for t, _ in universe()]
    market.prefetch(tickers + ["SPY"], years=YEARS, max_age_s=3600)
    # Group by start date so each scan computes one window.
    by_since: dict[str, list[str]] = {}
    for sid, v in active.items():
        by_since.setdefault(v["since"], []).append(sid)
    for since, sids in by_since.items():
        specs = [active[s]["spec"] for s in sids]
        scans = scan_all(tickers, specs, since=since, progress=progress)
        good = [sc for sc in scans if not sc.get("error")]
        last = max((sc["last"] for sc in good), default=since)
        closes = {sc["ticker"]: sc["close"] for sc in good}
        rets, ldays, trades, base = _gather(scans, specs, set(closes), "live")
        spy = market.history("SPY", years=YEARS)["Close"]
        days = int(((spy.index > pd.Timestamp(since)) & (spy.index <= pd.Timestamp(last))).sum())
        spy_ret = float(spy.asof(pd.Timestamp(last)) / spy.asof(pd.Timestamp(since)) - 1) if days else 0.0
        spy_w = spy[(spy.index > pd.Timestamp(since)) & (spy.index <= pd.Timestamp(last))]
        book_days = list(spy_w.index.strftime("%Y-%m-%d"))
        spy_curve = [round(float(x), 6) for x in spy_w / spy.asof(pd.Timestamp(since))]
        held = {t[0] for k in range(len(sids)) for t in trades[k]}
        frames = {tk: market.completed(market.history(tk, years=YEARS), tk) for tk in held}
        for k, sid in enumerate(sids):
            v = active[sid]
            s = _stats(rets[k], base.get(_exit_key(specs[k]), [0, 0]), ldays[k])
            tt = sorted(trades[k], key=lambda t: t[1], reverse=True)
            status, why = live_status(s, days)
            if v["status"] == "graduated" and status == "on trial":
                status = "graduated"  # a graduate keeps its badge unless it fails the elimination test
            book = _book(trades[k], frames, book_days)
            for b, sv in zip(book, spy_curve):
                b["spy"] = sv
            v.update(stats=s, days=days, last=last, spy=spy_ret, why=why, sim=_sim(trades[k]), book=book,
                     open=[t for t in tt if t[5] == "open"], closed=[t for t in tt if t[5] != "open"][:80],
                     positions=[_position(t, frames[t[0]], specs[k]["max_hold"]) for t in tt if t[5] == "open"],
                     signals=sorted(sc["ticker"] for sc in good if k in sc["signals"]))
            if status != v["status"]:
                v.setdefault("events", []).append({"ts": db.now(), "from": v["status"], "to": status, "why": why})
                v["status"] = status
            h = [x for x in v["history"] if x["d"] != last]
            h.append({"d": last, "n": s["n"], "total": s.get("total", 0.0), "excess": s["excess"]})
            v["history"] = h[-400:]
    st["updated_at"] = db.now()
    st = _clean_nan(st)
    _write(LIVE, st)
    return st


def notify_live(st: dict, before: dict, fire) -> None:
    """Phone pushes: status changes, and tomorrow's buys for strategies on trial."""
    from .reports import _link
    click = _link("/#evolution")
    for sid, v in st["strategies"].items():
        old = before.get(sid)
        if old and old != v["status"]:
            fire(f"evo:{sid}:{v['status']}", None, "evolution", f"Strategy {v['status']}: {v['spec']['name']}",
                 v.get("why", ""), ["dna"], priority=4 if v["status"] == "graduated" else 3, click=click)
    sig = {sid: v["signals"] for sid, v in st["strategies"].items() if v["status"] != "eliminated" and v.get("signals")}
    if sig:
        day = max(v.get("last") or "" for v in st["strategies"].values())
        lines = [f"{st['strategies'][s]['spec']['name']}: {', '.join(tks[:8])}"
                 + (f" +{len(tks) - 8}" if len(tks) > 8 else "") for s, tks in sig.items()]
        fire(f"evo:signals:{day}", None, "evolution", f"Live trial: {sum(map(len, sig.values()))} paper buys at the next open",
             "\n".join(lines), ["dna"], click=click)


def daily(fire) -> None:
    """Scheduler hook: refresh the live trial after the US close and push what changed."""
    before = {sid: v["status"] for sid, v in live_state()["strategies"].items()}
    if not before:
        return
    st = refresh_live()
    notify_live(st, before, fire)


# ---------- background job ----------
def start(job: str, cfg: dict | None = None) -> None:
    with _job_lock:
        if _job.get("state") == "running":
            raise UserError("A run is already in progress")
        _job.clear()
        _job.update(state="running", job=job, phase="Starting", done=0, total=0, started=db.now())

    def work():
        try:
            if job == "run":
                r = run(cfg)
                _set_job(state="done", result=r["id"], finished=db.now())
            else:
                refresh_live(progress=lambda k, n: _set_job(done=k, total=n, phase="Scanning live signals"))
                _set_job(state="done", finished=db.now())
        except Exception as e:
            log.exception("evolution job failed")
            _set_job(state="error", error=f"{type(e).__name__}: {e}", trace=traceback.format_exc()[-2000:])

    threading.Thread(target=work, name=f"evolve-{job}", daemon=True).start()


def _cfg(d: dict) -> dict:
    try:
        cfg = {"generations": int(d.get("generations") or DEFAULTS["generations"]),
               "cull": float(d.get("cull") if d.get("cull") not in (None, "") else DEFAULTS["cull"]),
               "min_trades": int(d.get("min_trades") or DEFAULTS["min_trades"]),
               "seed": int(d.get("seed") or DEFAULTS["seed"]),
               "batch": int(d.get("batch") or DEFAULTS["batch"])}
    except (TypeError, ValueError):
        raise UserError("Settings must be numbers")
    if not 2 <= cfg["generations"] <= 10:
        raise UserError("Generations must be 2–10")
    if not 0 <= cfg["cull"] <= 0.6:
        raise UserError("Cull share must be 0–0.6")
    if cfg["batch"] not in BATCHES:
        raise UserError("Unknown strategy batch")
    if not 3 <= cfg["min_trades"] <= 50:
        raise UserError("Minimum trades must be 3–50")
    return cfg


def register(app) -> None:
    @app.get("/api/evo")
    def api_evo():
        rid = request.args.get("run")
        r = load_run(rid)
        if r:  # the page doesn't need every cohort's ticker list
            r["cohort_sizes"] = [len(c) for c in r.pop("cohorts")]
            r["holdout"] = len(r["holdout"])
        with _job_lock:
            job = {k: v for k, v in _job.items() if k != "trace"}
        return jsonify({"run": r, "runs": runs(), "live": live_state(), "job": job, "defaults": DEFAULTS, "batches": BATCHES, "exam_z": EXAM_Z,
                        "gates": {"elim": LIVE_ELIM, **LIVE_GRAD}})

    @app.get("/api/evo/job")
    def api_evo_job():
        with _job_lock:
            return jsonify({k: v for k, v in _job.items() if k != "trace"})

    @app.post("/api/evo/run")
    def api_evo_run():
        start("run", _cfg(request.get_json(silent=True) or {}))
        return jsonify({"ok": True})

    @app.post("/api/evo/live/refresh")
    def api_evo_live():
        start("live")
        return jsonify({"ok": True})

    @app.post("/api/evo/live/<sid>/retire")
    def api_evo_retire(sid):
        st = live_state()
        v = st["strategies"].get(sid)
        if not v:
            raise UserError("Not on trial")
        v.setdefault("events", []).append({"ts": db.now(), "from": v["status"], "to": "eliminated", "why": "Retired by hand."})
        v["status"], v["why"] = "eliminated", "Retired by hand."
        _write(LIVE, st)
        return jsonify({"ok": True})


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    ap = argparse.ArgumentParser(description="Natural selection for trading strategies")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="backtest every strategy and run the selection")
    for k, v in DEFAULTS.items():
        r.add_argument(f"--{k.replace('_', '-')}", type=type(v), default=v)
    r.add_argument("--no-promote", action="store_true")
    sub.add_parser("live", help="refresh the live paper trial")
    a = ap.parse_args()
    if a.cmd == "run":
        res = run({k: getattr(a, k) for k in DEFAULTS}, promote=not a.no_promote)
        s = res["summary"]
        print(f"{s['strategies']} strategies on {s['tickers']} stocks in {res['seconds']}s")
        for g in res["generations"]:
            print(f"  gen {g['g']}: {g['alive_before']} -> {g['alive']} (placebos {g['placebo_alive']})  {g['deaths']}")
        print(f"survived selection: {s['survived']}  finalists: {s['finalists']}  "
              f"placebos survived: {s['placebo_survived']}/{s['placebos']}, finalists {s['placebo_finalists']}")
        for x in sorted(res["strategies"], key=lambda x: -(x["holdout"]["z"] or -9)):
            if x["fate"]["status"] in ("finalist", "failed exam"):
                h, p = x["holdout"], x["prior"]
                print(f"  {x['fate']['status']:12} {x['id']:14} {x['name'][:60]:60} hold n={h['n']} "
                      f"ex={h['excess'] or 0:+.3%} z={h['z'] or 0:.2f} | prior ex={p['excess'] or 0:+.3%}")
    else:
        st = refresh_live()
        for sid, v in st["strategies"].items():
            print(sid, v["status"], v.get("stats", {}).get("n"), v.get("why"))


if __name__ == "__main__":
    main()
