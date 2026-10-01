#!/usr/bin/env bash
# Starts the trading cockpit at http://localhost:5070 (set PORT to change).
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
fi
exec .venv/bin/python -m cockpit.server "$@"
