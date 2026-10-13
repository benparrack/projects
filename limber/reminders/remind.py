#!/usr/bin/env python3
"""Limber evening reminders. Run every 15 min (systemd timer).

Learns which days you've stretched from the "<topic>-done" ntfy topic (the app posts there when you finish
a session), then at each reminder time pings "<topic>" on your phone, only if today isn't done yet.
Standard library only. Config: config.json next to this file (see README.md).
"""
import json
import subprocess
import sys
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
NTFY = "https://ntfy.sh"
DEFAULTS = {"times": ["19:30", "22:00"], "desktop": True, "app_url": ""}


def load(name, default):
    try:
        return json.loads((HERE / name).read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def due(now, times, sent, done_today):
    """The reminder slot to send now, or None. Only the latest passed slot fires; earlier missed ones are skipped."""
    if done_today:
        return None
    passed = [t for t in sorted(times) if t <= now.strftime("%H:%M")]
    return passed[-1] if passed and passed[-1] not in sent else None


def streak(done, today):
    """Days in a row up to yesterday (today isn't done, or we wouldn't be reminding)."""
    n, d = 0, today - timedelta(days=1)
    while d.isoformat() in done:
        n, d = n + 1, d - timedelta(days=1)
    return n


def message(slot, times, n):
    last = slot == sorted(times)[-1] and len(times) > 1
    if last:
        title = "Last call for today"
        body = f"Your {n}-day streak ends at midnight. " if n else ""
        return title, body + "Ten minutes of couch mode in bed counts. Go on."
    title = f"Keep your {n}-day streak going" if n > 1 else "Time to stretch"
    return title, "Hips and hamstrings are waiting. Pick mat, couch or a 5-minute quick reset."


def poll_done(topic, since):
    """Days marked done on the done topic since `since`. ntfy.sh keeps messages ~12h, hence polling often."""
    url = f"{NTFY}/{topic}-done/json?poll=1&since={since}"
    with urllib.request.urlopen(url, timeout=20) as r:
        text = r.read().decode()
    days = set()
    for line in text.splitlines():
        ev = json.loads(line) if line.strip() else {}
        if ev.get("event") == "message":
            since = ev["id"]
            parts = ev.get("message", "").split()
            if len(parts) >= 2 and parts[0] == "done":
                days.add(parts[1])
    return days, since


def send(topic, title, body, app_url="", tags="person_in_lotus_position"):
    payload = {"topic": topic, "title": title, "message": body, "tags": [tags], "priority": 4}
    if app_url:
        payload["click"] = app_url
    req = urllib.request.Request(NTFY, data=json.dumps(payload).encode(), method="POST")
    urllib.request.urlopen(req, timeout=20).close()


def main():
    cfg = {**DEFAULTS, **load("config.json", {})}
    if not cfg.get("topic"):
        sys.exit("No topic. Create reminders/config.json with {\"topic\": \"limber-...\"} (see README.md).")
    if "--test" in sys.argv:
        send(cfg["topic"], "Limber test", "Reminders will arrive here.", cfg["app_url"])
        return print("sent test to", cfg["topic"])
    st = load("state.json", {"since": "24h", "done": [], "sent": {}})
    days, st["since"] = poll_done(cfg["topic"], st["since"])
    today = date.today()
    done = set(st["done"]) | days
    st["done"] = sorted(d for d in done if d >= (today - timedelta(days=120)).isoformat())
    sent = st["sent"].get(today.isoformat(), [])
    slot = due(datetime.now(), cfg["times"], sent, today.isoformat() in done)
    if slot:
        title, body = message(slot, cfg["times"], streak(done, today))
        send(cfg["topic"], title, body, cfg["app_url"])
        if cfg["desktop"]:
            subprocess.run(["notify-send", "-a", "Limber", title, body], check=False)
        sent = [t for t in cfg["times"] if t <= slot]
    st["sent"] = {today.isoformat(): sent}
    (HERE / "state.json").write_text(json.dumps(st, indent=1))


if __name__ == "__main__":
    main()
