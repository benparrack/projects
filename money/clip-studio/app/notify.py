"""Optional phone notifications through ntfy.sh (set a topic on the Autopilot
page, then subscribe to it in the ntfy app)."""

import threading

import requests

from . import store


def send(title, message, url=None, tags=()):
    topic = (store.read_json(f"{store.DATA}/autopilot.json", {}) or {}).get("ntfy", "").strip()
    if not topic:
        return

    def go():
        try:
            payload = {"topic": topic, "title": title, "message": message, "tags": list(tags)}
            if url:
                payload["click"] = url
            requests.post("https://ntfy.sh", json=payload, timeout=15)
        except Exception as e:  # noqa: BLE001
            print("ntfy failed:", e)
    threading.Thread(target=go, daemon=True).start()
