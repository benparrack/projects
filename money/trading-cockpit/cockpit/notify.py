"""Phone push notifications through ntfy.sh (same approach as flip-bot)."""
from __future__ import annotations

import json
import logging
import secrets

import requests

NTFY = "https://ntfy.sh"
log = logging.getLogger("notify")


def new_topic() -> str:
    return "cockpit-" + secrets.token_urlsafe(12).replace("_", "").replace("-", "")


def send(topic: str, title: str, message: str, tags=(), priority: int = 3, click: str | None = None) -> bool:
    """Returns True if ntfy accepted it. No topic means log-only."""
    payload = {"topic": topic, "title": title, "message": message, "tags": list(tags), "priority": priority}
    if click:
        payload["click"] = click
    if not topic:
        log.info("ALERT (no ntfy topic set): %s | %s", title, message)
        return False
    try:
        requests.post(NTFY, data=json.dumps(payload).encode(), timeout=15).raise_for_status()
        return True
    except requests.RequestException as e:
        log.warning("ntfy send failed: %s", e)
        return False
