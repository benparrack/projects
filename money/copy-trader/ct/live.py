"""One live tick (run every 15 min by the systemd timer). Each step is throttled and isolated: a failing
source is logged and retried next tick, never stops the others, and the replay always runs."""
import json
import logging
import os
import time
import traceback
from datetime import date, datetime, timedelta

from . import crypto, db, ingest, notify, prices, report, runner
from .config import ROOT
from .sources import hyperliquid as hl
from .timeutil import ET

log = logging.getLogger("live")
DAY = 86400
HOUR = 3600


def due(con, key, every_s):
    return time.time() - (db.kv_get(con, key) or 0) >= every_s


def mark(con, key):
    db.kv_set(con, key, time.time())


def price_refresh_due(con):
    """Daily stock bars matter twice a day: after the open (execution price) and after the close (marks)."""
    now = datetime.now(ET)
    marks = [now.replace(hour=9, minute=50, second=0, microsecond=0), now.replace(hour=16, minute=40, second=0, microsecond=0)]
    passed = [m.timestamp() for m in marks if m <= now] or [(marks[1] - timedelta(days=1)).timestamp()]
    return (db.kv_get(con, "src_prices") or 0) < max(passed)


def ensure_live_start(con):
    if db.kv_get(con, "live_start") is None:
        db.kv_set(con, "live_start", time.time())
        log.info("live paper trading starts now")


def hl_select_if_due(con, cfg):
    """Monthly re-pick (1st of the month UTC), plus once right at live start."""
    hdefs = [s for s in cfg["strategies"] if s["kind"] == "hl"]
    now = time.time()
    month_t = crypto.month_starts(now - 32 * DAY, now)[-1]
    need = [s for s in hdefs if not con.execute(
        "SELECT 1 FROM hl_selections WHERE strategy=? AND t>=?", (s["id"], min(month_t, db.kv_get(con, "live_start")))
    ).fetchone()]
    if not need:
        return False
    cands = crypto.live_candidates(con, cfg["hyperliquid"], max(s["n"] for s in need))
    for s in need:
        picks = crypto.select(cands, now, s["rank"], s["n"], cfg["hyperliquid"], need_coverage=False)
        con.execute("INSERT OR REPLACE INTO hl_selections VALUES(?,?,?,?)",
                    (s["id"], int(now), json.dumps(picks), json.dumps({"candidates": len(cands)})))
        log.info("HL %s now following %s", s["id"], [u[:10] for u, _ in picks])
    con.commit()
    return True


def hl_snapshots(con, cfg):
    users = set()
    for (l,) in con.execute("SELECT leaders FROM hl_selections h WHERE t=(SELECT max(t) FROM hl_selections "
                            "WHERE strategy=h.strategy)"):
        users |= {u for u, _ in json.loads(l)}
    now = int(time.time())
    coins = {"BTC"}
    for u in users:
        try:
            av, pos = hl.clearinghouse(u)
            con.execute("INSERT OR REPLACE INTO hl_snapshots VALUES(?,?,?,?)", (u, now, av, json.dumps(pos)))
            coins |= set(pos)
        except Exception as e:
            log.warning("snapshot %s failed: %s", u, e)
    con.commit()
    for (p,) in con.execute("SELECT positions FROM hl_snapshots WHERE t >= ?", (db.kv_get(con, "live_start") - DAY,)):
        coins |= set(json.loads(p))
    if due(con, "hl_meta_t", DAY):
        db.kv_set(con, "hl_meta", hl.meta())
        mark(con, "hl_meta_t")
    prices.fetch_crypto(con, coins, db.kv_get(con, "live_start") - 2 * DAY)


def tick(con, cfg, force_replay=False):
    if os.path.exists(os.path.join(ROOT, "STOP")):
        log.info("STOP file present: skipping")
        return
    ensure_live_start(con)
    errors, dirty = [], force_replay
    today = date.today()

    def step(name, fn, every=None, key=None):
        nonlocal dirty
        key = key or "src_" + name
        if every is not None and not due(con, key, every):
            return
        try:
            r = fn()
            mark(con, key)
            if r:
                dirty = True
        except Exception as e:
            errors.append(f"{name}: {e}"[:160])
            log.error("step %s failed:\n%s", name, traceback.format_exc())

    step("edgar", lambda: ingest.run_13f(con, cfg, since=today - timedelta(days=150)), every=4 * HOUR)
    step("house", lambda: ingest.run_house(con, cfg, years=sorted({today.year, (today - timedelta(days=45)).year})),
         every=4 * HOUR)
    step("senate", lambda: ingest.run_senate(con, cfg, since=today - timedelta(days=20)), every=4 * HOUR)
    # brand-new tickers get full history; known ones a short refresh twice a day
    step("newsyms", lambda: ingest.run_stock_prices(con, cfg), key="src_newsyms")
    if price_refresh_due(con):
        step("prices", lambda: prices.fetch_stocks(con, ingest.stock_tickers(con), today - timedelta(days=10),
                                                   refresh_after_s=0) or True)
    step("hl_select", lambda: hl_select_if_due(con, cfg))
    step("hl", lambda: hl_snapshots(con, cfg) or True)

    kinds = ["crypto"]
    if dirty or due(con, "replay_stocks", 6 * HOUR):
        kinds.append("stocks")
    try:
        runner.run_mode(con, cfg, "live", kinds=kinds)
        if "stocks" in kinds:
            mark(con, "replay_stocks")
    except Exception as e:
        errors.append(f"replay: {e}"[:160])
        log.error("replay failed:\n%s", traceback.format_exc())
    try:
        report.write_html(con, cfg)
    except Exception as e:
        errors.append(f"report: {e}"[:160])
        log.error("report failed:\n%s", traceback.format_exc())
    db.kv_set(con, "last_tick", {"t": time.time(), "errors": errors})
    try:
        notify.maybe_daily(con, cfg)
    except Exception as e:
        log.error("notify failed: %s", e)
    return errors
