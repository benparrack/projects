"""Daily summary to the phone via ntfy.sh (same topic as flip-bot's alerts, NTFY_ALERT_TOPIC in .env)."""
import json
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

import requests

from . import db
from .report import runs

log = logging.getLogger("notify")


def send(cfg, title, message, tags=("chart_with_upwards_trend",)):
    topic = cfg["env"].get("NTFY_ALERT_TOPIC")
    if not topic:
        log.info("NTFY (no topic set): %s\n%s", title, message)
        return False
    requests.post("https://ntfy.sh", data=json.dumps({"topic": topic, "title": title, "message": message,
                                                     "tags": list(tags)}).encode(), timeout=15).raise_for_status()
    return True


def summary(con):
    rs = runs(con, "live")
    if not rs:
        return "No live results yet."
    lines = []
    for sid, (_, m) in sorted(rs.items(), key=lambda x: -x[1][1]["total_return"]):
        b = m["benchmark"]
        lines.append(f"{sid}: ${m['final']:,.0f} ({m['total_return'] * 100:+.1f}% vs {b['symbol']} "
                     f"{b['total_return'] * 100:+.1f}%)")
    beat = sum(1 for _, m in rs.values() if m["beat_benchmark"])
    return f"{beat}/{len(rs)} beating their benchmark since live start.\n" + "\n".join(lines)


def maybe_daily(con, cfg):
    """Send once per local day, after the configured time."""
    ncfg = cfg["notify"]
    now = datetime.now(ZoneInfo(ncfg["timezone"]))
    today = now.date().isoformat()
    if now.strftime("%H:%M") < ncfg["summary_after_local"] or db.kv_get(con, "last_summary") == today:
        return False
    last = db.kv_get(con, "last_tick", {})
    msg = summary(con)
    if last.get("errors"):
        msg += "\nLast tick had errors: " + "; ".join(last["errors"])[:300]
    send(cfg, "Copy-trader daily (paper)", msg)
    db.kv_set(con, "last_summary", today)
    return True
