#!/usr/bin/env bash
# Serve the viewer at http://localhost:8083 (needs a real HTTP server for ES modules + fetch).
cd "$(dirname "$0")/web" && exec python3 -m http.server "${PORT:-8083}" --bind 127.0.0.1
