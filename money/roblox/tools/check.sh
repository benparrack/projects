#!/bin/sh
# Type-check, lint, test and build one game:  tools/check.sh jump-tower
# The built place is also copied into Studio's Documents folder (Vinegar prefix) so
# File > Open in Studio finds it.
set -e
GAME=${1:?usage: tools/check.sh <game>}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
export PATH="$HOME/.rokit/bin:$PATH"
cd "$ROOT/games/$GAME"
rojo sourcemap default.project.json -o sourcemap.json
echo "== luau-lsp"
OUT=$(luau-lsp analyze --definitions="$ROOT/tools/globalTypes.d.luau" --sourcemap=sourcemap.json src "$ROOT/lib" 2>&1 | grep -v '^\[' || true)
if [ -n "$OUT" ]; then echo "$OUT"; exit 1; fi
echo "== selene"
(cd "$ROOT" && selene "games/$GAME/src" lib)
echo "== tests"
if [ -f tests/run.luau ]; then lune run tests/run 2>&1 | grep -v -E '^\[WARN\]|no handler for product'; fi
echo "== build"
mkdir -p build
rojo build default.project.json -o "build/$GAME.rbxl"
DOCS="$HOME/.var/app/org.vinegarhq.Vinegar/data/vinegar/prefixes/studio/drive_c/users/$USER/Documents"
if [ -d "$DOCS" ]; then cp "build/$GAME.rbxl" "$DOCS/$GAME.rbxl" && echo "copied to Studio Documents/$GAME.rbxl"; fi
