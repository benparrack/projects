"""Local HTTP server: JSON API + static dashboard. Stdlib only."""

import json
import os
import shutil
import subprocess
import threading
import time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, unquote

from .analysis import Analysis, DEFAULTS
from .live import LiveUsage
from .parser import Scanner

WEB_DIR = Path(__file__).resolve().parent.parent / "web"
MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png"}


def settings_path():
    base = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    return base / "claude-usage" / "settings.json"


def load_settings():
    try:
        data = json.loads(settings_path().read_text())
        return {k: data.get(k, v) for k, v in DEFAULTS.items()}
    except (OSError, ValueError):
        return dict(DEFAULTS)


def add_usage_reading(pct, ts=None):
    """Record a /usage '% of current session' reading for calibration."""
    pct = float(pct)
    if not 0 < pct <= 100:
        raise ValueError("percentage must be between 0 and 100")
    readings = list(load_settings().get("usage_readings") or [])
    readings.append({"ts": ts or time.time(), "pct": pct})
    return save_settings({"usage_readings": readings})


def save_settings(new):
    cur = load_settings()
    for k in DEFAULTS:
        if k in new:
            v = new[k]
            if k in ("block_limit_units", "weekly_limit_units", "compact_threshold"):
                v = float(v) if v not in (None, "", 0, "0") else None
                if k == "compact_threshold" and v is None:
                    v = DEFAULTS[k]
            elif k in ("notify", "live_usage"):
                v = bool(v)
            elif k == "usage_readings":
                v = [dict({"ts": float(r["ts"]), "pct": float(r["pct"])},
                          **({"auto": True, "resets_at": r.get("resets_at")} if r.get("auto") else {}))
                     for r in (v or [])][-50:]
            cur[k] = v
    p = settings_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(cur, indent=2))
    return cur


class State:
    """Holds the latest Analysis; rebuilds when transcripts or settings change."""

    def __init__(self, root=None, cache_file=None, live=None):
        self.scanner = Scanner(root=root, cache_file=cache_file)
        self.live = live if live is not None else LiveUsage()
        self.lock = threading.Lock()
        self.analysis = None
        self.sig = None
        self.settings = load_settings()
        self.built_at = 0
        self.notified = set()

    def get(self, force=False):
        with self.lock:
            now = time.time()
            # the stat sweep is cheap, but don't do it more than every 3s
            if self.analysis is not None and not force and now - self.built_at < 3:
                return self.analysis
            sig = self.scanner.signature()
            live = self.live.get() if self.settings.get("live_usage") else None
            if live and live.get("ok") and not live.get("stale"):
                self._auto_reading(live)
            if self.analysis is None or force or sig != self.sig:
                records, _ = self.scanner.scan(sig)
                self.analysis = Analysis(records, self.settings, now=now, live=live)
                self.sig = sig
            else:
                self.analysis.now = now
                self.analysis.live = live
            self.built_at = now
            return self.analysis

    def _auto_reading(self, live):
        """Keep one exact reading per 5h window so the fallback estimate stays calibrated.

        Updated at most every 20 minutes, and only from 20% up, since the endpoint
        returns whole percents and small values are too coarse to fit weights from.
        """
        w = live["five_hour"]
        if w["pct"] < 20 or not w["resets_at"]:
            return
        readings = list(self.settings.get("usage_readings") or [])
        prev = next((r for r in reversed(readings) if r.get("auto") and r.get("resets_at") == w["resets_at"]), None)
        if prev and (live["fetched_at"] - prev["ts"] < 20 * 60 or prev["pct"] == w["pct"]):
            return
        if prev:
            readings.remove(prev)
        readings.append({"ts": live["fetched_at"], "pct": w["pct"], "auto": True, "resets_at": w["resets_at"]})
        self.settings = save_settings({"usage_readings": readings})

    def update_settings(self, new):
        self.settings = save_settings(new)
        return self.get(force=True)

    def maybe_notify(self):
        """Desktop notification when the current 5h window crosses 80% / 95%."""
        if not self.settings.get("notify") or not shutil.which("notify-send"):
            return
        try:
            cur = self.get().current_block()
        except Exception:
            return
        if not cur or not cur["active"] or not cur["pct"]:
            return
        for level in (95, 80):
            key = (cur["block"]["start"], level)
            if cur["pct"] >= level and key not in self.notified:
                self.notified.add(key)
                self.notified.add((cur["block"]["start"], 80))
                left = cur["remaining_s"] / 60
                subprocess.Popen(["notify-send", "-a", "Claude Usage", "-i", "dialog-warning",
                                  f"Claude limit ~{cur['pct']:.0f}% used",
                                  f"Current 5-hour window resets in {left // 60:.0f}h {left % 60:.0f}m."],
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                break


def make_handler(state):
    class Handler(BaseHTTPRequestHandler):
        server_version = "ClaudeUsage/1.0"

        def log_message(self, fmt, *args):  # keep the terminal quiet
            pass

        def _json(self, obj, code=200):
            body = json.dumps(obj, default=_json_default).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            path = urlparse(self.path).path
            try:
                if path.startswith("/api/"):
                    return self._api(path[5:])
                return self._static(path)
            except BrokenPipeError:
                pass
            except Exception as e:  # surface errors to the dashboard
                self._json({"error": f"{type(e).__name__}: {e}"}, 500)

        def do_POST(self):
            path = urlparse(self.path).path
            n = int(self.headers.get("Content-Length") or 0)
            try:
                data = json.loads(self.rfile.read(n) or b"{}")
            except ValueError:
                return self._json({"error": "bad json"}, 400)
            if path == "/api/settings":
                state.update_settings(data)
                return self._json({"ok": True, "settings": state.settings})
            if path == "/api/calibrate":
                try:
                    state.settings = add_usage_reading(data.get("pct"))
                except (TypeError, ValueError) as e:
                    return self._json({"error": str(e)}, 400)
                a = state.get(force=True)
                return self._json({"ok": True, "calibration": a.calibration})
            return self._json({"error": "not found"}, 404)

        def _api(self, name):
            a = state.get()
            if name == "data":
                return self._json(a.data_payload())
            if name == "limits":
                return self._json(a.limits_payload())
            if name == "insights":
                return self._json(a.insights())
            if name == "tools":
                return self._json(a.tools_payload())
            if name == "settings":
                return self._json({"settings": state.settings, "defaults": DEFAULTS,
                                   "calibration": a.calibration})
            if name == "live":
                return self._json(state.live.get() if state.settings.get("live_usage") else {"ok": False, "error": "disabled"})
            if name == "ping":
                return self._json({"ok": True, "app": "claude-usage", "generated": a.now})
            if name.startswith("session/"):
                d = a.session_detail(unquote(name[8:]))
                return self._json(d) if d else self._json({"error": "no such session"}, 404)
            return self._json({"error": "not found"}, 404)

        def _static(self, path):
            if path in ("", "/"):
                path = "/index.html"
            f = (WEB_DIR / path.lstrip("/")).resolve()
            if WEB_DIR not in f.parents or not f.is_file():
                f = WEB_DIR / "index.html"
            body = f.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", MIME.get(f.suffix, "application/octet-stream"))
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    return Handler


def _json_default(o):
    if isinstance(o, set):
        return sorted(o)
    return str(o)


def serve(port=8765, host="127.0.0.1", root=None, ready=None):
    state = State(root=root)
    state.get()
    httpd = ThreadingHTTPServer((host, port), make_handler(state))
    httpd.daemon_threads = True

    def notifier():
        while True:
            time.sleep(60)
            state.maybe_notify()

    threading.Thread(target=notifier, daemon=True).start()
    if ready:
        ready(httpd)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
