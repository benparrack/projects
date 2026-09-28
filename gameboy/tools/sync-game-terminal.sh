#!/usr/bin/env bash
# Copies the emulator core + web player into game_terminal (which has no build step, so it
# serves its own copy). Re-run after any change under src/ or web/{player,storage,netstate}.js.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
dest="$here/../game_terminal/public/games/gameboy"
mkdir -p "$dest/emu/src" "$dest/emu/web" "$dest/roms"
cp "$here"/src/*.js "$dest/emu/src/"
cp "$here"/web/{player,storage,netstate}.js "$dest/emu/web/"
for r in ucity.gbc libbet.gb big2small.gb tobudx.gb porklike.gb shocklobster.gb geometrix.gbc adjustris.gb 2048.gb linktron.gb; do
  [ -f "$here/roms/homebrew/$r" ] || { echo "missing roms/homebrew/$r — run roms/fetch.sh" >&2; exit 1; }
  cp "$here/roms/homebrew/$r" "$dest/roms/"
done
cp "$here/homebrew/linktron/LICENSE" "$dest/roms/LICENSE-linktron.txt"
echo "synced → $dest"
