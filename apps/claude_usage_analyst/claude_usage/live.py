"""Exact plan usage from the same endpoint Claude Code's /usage calls.

The OAuth access token is read from ~/.claude/.credentials.json on every fetch and is
never stored, logged or refreshed (refreshing rotates the token and could log Claude
Code out). If it has expired we just report that and the dashboard falls back to the
estimate until Claude Code renews it.
"""

import json
import os
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

URL = "https://api.anthropic.com/api/oauth/usage"
TTL = 60  # seconds between fetches


def credentials_path():
    base = Path(os.environ.get("CLAUDE_CONFIG_DIR", Path.home() / ".claude"))
    return base / ".credentials.json"


def _iso(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def parse(data, fetched_at=None):
    """Endpoint JSON -> {"five_hour": {"pct", "resets_at"}, "seven_day": {...}}."""
    out = {"ok": True, "fetched_at": fetched_at or time.time()}
    for key in ("five_hour", "seven_day", "seven_day_opus", "seven_day_sonnet"):
        w = data.get(key)
        if isinstance(w, dict) and w.get("utilization") is not None:
            out[key] = {"pct": float(w["utilization"]), "resets_at": _iso(w.get("resets_at"))}
    if "five_hour" not in out:
        return {"ok": False, "error": "response had no five_hour window", "fetched_at": out["fetched_at"]}
    return out


def fetch(timeout=6):
    now = time.time()
    try:
        oauth = json.loads(credentials_path().read_text())["claudeAiOauth"]
        token = oauth["accessToken"]
    except (OSError, ValueError, KeyError, TypeError):
        return {"ok": False, "error": "no Claude Code login found", "fetched_at": now}
    exp = oauth.get("expiresAt")
    if exp and exp / 1000 < now:
        return {"ok": False, "error": "login token expired (Claude Code renews it next time it runs)",
                "fetched_at": now}
    req = urllib.request.Request(URL, headers={
        "Authorization": "Bearer " + token,
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": "claude-usage (local dashboard)",
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return parse(json.loads(r.read()), now)
    except urllib.error.HTTPError as e:
        return {"ok": False, "error": f"HTTP {e.code} from usage endpoint", "fetched_at": now}
    except (urllib.error.URLError, OSError, ValueError) as e:
        return {"ok": False, "error": f"couldn't reach usage endpoint ({type(e).__name__})", "fetched_at": now}


class LiveUsage:
    """Rate-limited, thread-safe wrapper around fetch()."""

    def __init__(self, fetcher=fetch, ttl=TTL):
        self.fetcher = fetcher
        self.ttl = ttl
        self.lock = threading.Lock()
        self.last = None
        self.last_ok = None

    def get(self, force=False):
        with self.lock:
            now = time.time()
            if force or self.last is None or now - self.last["fetched_at"] >= self.ttl:
                self.last = self.fetcher()
                if self.last.get("ok"):
                    self.last_ok = self.last
            # a transient failure keeps showing the last good numbers for a few minutes
            if not self.last.get("ok") and self.last_ok and now - self.last_ok["fetched_at"] < 300:
                return dict(self.last_ok, stale=True)
            return self.last
