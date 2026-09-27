"""Phone I/O via ntfy.sh: alerts with action buttons out, text commands back in on a reply topic."""
import json
import logging
import secrets

import requests

NTFY = "https://ntfy.sh"
log = logging.getLogger("notify")
COMMANDS = {"approve", "skip", "bought", "arrived", "shipped", "status", "stop", "resume"}


def new_topic():
    return "flipbot-" + secrets.token_urlsafe(12).replace("_", "").replace("-", "")


def reply_button(label, reply_topic, body):
    return {"action": "http", "label": label, "url": f"{NTFY}/{reply_topic}", "method": "POST",
            "body": body, "clear": True}


def build(title, message, url=None, actions=(), tags=()):
    p = {"title": title, "message": message, "tags": list(tags)}
    if url:
        p["click"] = url
    if actions:
        p["actions"] = list(actions)[:3]  # ntfy allows max 3
    return p


def send(topic, payload, dry_run=False):
    payload = {"topic": topic, **payload}
    if dry_run or not topic:
        log.info("NTFY (not sent): %s", json.dumps(payload, ensure_ascii=False))
        return payload
    requests.post(NTFY, data=json.dumps(payload).encode(), timeout=15).raise_for_status()
    return payload


def parse_command(text):
    """'approve 12' -> ('approve', ['12']); unknown -> None."""
    parts = (text or "").strip().lower().split()
    return (parts[0], parts[1:]) if parts and parts[0] in COMMANDS else None


def poll_replies(topic, since):
    """Fetch messages on the reply topic since `since` (ntfy id or unix time). Returns (commands, new_since)."""
    r = requests.get(f"{NTFY}/{topic}/json", params={"poll": 1, "since": since}, timeout=20)
    r.raise_for_status()
    return parse_stream(r.text, since)


def parse_stream(text, since):
    cmds = []
    for line in text.splitlines():
        if not line.strip():
            continue
        ev = json.loads(line)
        if ev.get("event") == "message":
            since = ev["id"]
            c = parse_command(ev.get("message"))
            if c:
                cmds.append(c)
    return cmds, since
