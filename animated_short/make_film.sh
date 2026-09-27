#!/usr/bin/env bash
# Re-render LANTERN from scratch: score -> every shot -> output/film.mp4
#   ./make_film.sh            final 1920x1080 @ 60 fps, 6 sub-frames (slow)
#   ./make_film.sh preview    640x360 @ 30 fps, 1 sub-frame (fast check)
set -euo pipefail
cd "$(dirname "$0")"
PROFILE="${1:-final}"
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
  .venv/bin/pip install -q moderngl numpy scipy pillow
fi
.venv/bin/python src/audio.py
.venv/bin/python src/render.py film --profile "$PROFILE" --force
