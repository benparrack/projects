#!/usr/bin/env bash
# Builds linktron.gb with RGBDS (tested with 1.0.4). The built ROM is committed here (so nothing
# else needs RGBDS) and copied to ../../roms/homebrew/.
set -euo pipefail
cd "$(dirname "$0")"
python3 gfx.py
rgbasm -o main.o main.asm
rgblink -n linktron.sym -o linktron.gb main.o
rgbfix -v -p 0xFF -t LINKTRON linktron.gb
rm -f main.o
cp linktron.gb ../../roms/homebrew/linktron.gb
echo "built linktron.gb"
