#!/usr/bin/env bash
# Serve the game locally (ES modules need http://, not file://). Sends no-store so
# edited modules are never served stale from the browser's heuristic cache.
cd "$(dirname "$0")" && exec python3 -c '
import http.server, sys
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()
http.server.ThreadingHTTPServer(("", int(sys.argv[1])), H).serve_forever()
' "${1:-8084}"
