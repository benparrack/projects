#!/usr/bin/env python3
"""Local server for the grocery-deals app: serves web/ and a small JSON API over grocery.py.

  GET  /api/deals[?refresh=1]   settings + every offer at every store, tagged with the matching list item
  POST /api/settings            replace settings.json (validated in grocery.save_settings)
  GET  /api/stores?q=WORD       store search across ICA, Willys, Hemköp

Binds to 127.0.0.1 only. Exits after IDLE_EXIT seconds without requests so it doesn't sit around draining battery;
the launcher starts it again on demand.
"""
import json
import os
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import grocery

PORT = int(os.environ.get("PORT", 5077))
WEB = Path(__file__).resolve().parent / "web"
IDLE_EXIT = 2 * 3600
last_hit = time.time()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(WEB), **kw)

    def log_message(self, *a):
        pass

    def send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        global last_hit
        last_hit = time.time()
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path == "/api/deals":
            cfg = grocery.load_settings()
            stores = [{"store": s, "offers": os_, "error": err}
                      for s, os_, err in grocery.tag(cfg, refresh="refresh" in q)]
            return self.send_json({"settings": cfg, "stores": stores, "member_names": grocery.MEMBER,
                                   "fetched": time.time()})
        if u.path == "/api/stores":
            word = (q.get("q") or [""])[0].strip()
            if len(word) < 2:
                return self.send_json([])
            try:
                return self.send_json(grocery.find_stores(word)[:40])
            except Exception as e:
                return self.send_json({"error": str(e)[:200]}, 502)
        return super().do_GET()

    def do_POST(self):
        global last_hit
        last_hit = time.time()
        if urlparse(self.path).path != "/api/settings":
            return self.send_json({"error": "not found"}, 404)
        # only the app's own page may write settings (blocks other sites POSTing to localhost)
        if self.headers.get("Origin") not in (None, f"http://127.0.0.1:{PORT}", f"http://localhost:{PORT}"):
            return self.send_json({"error": "forbidden"}, 403)
        try:
            n = int(self.headers.get("Content-Length", 0))
            if n > 200_000:
                raise ValueError("too large")
            return self.send_json(grocery.save_settings(json.loads(self.rfile.read(n))))
        except (ValueError, KeyError, TypeError) as e:
            return self.send_json({"error": f"bad settings: {e}"}, 400)


def idle_watch(server):
    while time.time() - last_hit < IDLE_EXIT:
        time.sleep(60)
    server.shutdown()


if __name__ == "__main__":
    try:
        srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    except OSError:
        sys.exit(f"port {PORT} busy (already running?)")
    threading.Thread(target=idle_watch, args=(srv,), daemon=True).start()
    print(f"grocery-deals on http://127.0.0.1:{PORT}")
    srv.serve_forever()
