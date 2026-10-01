#!/usr/bin/env bash
# Starts Clip Studio at http://localhost:5055 (set PORT to change).
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
fi
exec .venv/bin/python -m app.server
