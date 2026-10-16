#!/usr/bin/env bash
# Usage: ./run.sh pull | ./run.sh backtest | ./run.sh scan | ./run.sh settle
cd "$(dirname "$0")"
[ -d .venv ] || { python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt; }
exec .venv/bin/python -m kwx "$@"
