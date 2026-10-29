#!/usr/bin/env bash
# Builds the upload files from ../index.html into release/dist/ (git-ignored).
# Re-run after any game change, before uploading.
#   dist/crazygames/index.html  - same game + CrazyGames SDK v3 tag (Full Launch: ads, gameplay events)
#   dist/cosmic_forge_itch.zip  - plain index.html at the zip root (itch.io "HTML" project)
set -euo pipefail
cd "$(dirname "$0")"
src=../index.html
sdk='<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>'

rm -rf dist && mkdir -p dist/crazygames dist/itch
# Insert the SDK tag right before the first (game) <script> tag.
awk -v sdk="$sdk" '!done && /^<script>/ { print sdk; done = 1 } { print }' "$src" > dist/crazygames/index.html
grep -q 'crazygames-sdk-v3' dist/crazygames/index.html || { echo "SDK tag not inserted" >&2; exit 1; }

cp "$src" dist/itch/index.html
(cd dist/itch && zip -q ../cosmic_forge_itch.zip index.html)
rm -r dist/itch
(cd dist/crazygames && zip -q ../cosmic_forge_crazygames.zip index.html)

ls -l dist dist/crazygames
