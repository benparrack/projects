#!/usr/bin/env bash
# Usage: ./run.sh scan | ./run.sh run TSLA COIN --explain
cd "$(dirname "$0")"
[ -d .venv ] || { python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt; }
exec .venv/bin/python -m stockpred "$@"
