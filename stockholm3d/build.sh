#!/usr/bin/env bash
# Rebuild everything in web/data/ from raw open data. ~10 min on a laptop.
#   ./build.sh            download raw data if missing, then run every stage
#   ./build.sh ground     run a single stage (extract|terrain|ground|buildings|structures|trees|manifest)
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
  .venv/bin/pip install -q osmium shapely numpy scipy pillow tifffile imagecodecs mapbox_earcut requests
fi
PY=.venv/bin/python

mkdir -p data/raw data/work web/data
fetch() { [ -s "$2" ] || { echo "downloading $(basename "$2")"; curl -fL --retry 3 -o "$2.part" "$1" && mv "$2.part" "$2"; }; }
fetch https://download.bbbike.org/osm/bbbike/Stockholm/Stockholm.osm.pbf data/raw/Stockholm.osm.pbf
for lon in 017 018; do
  fetch "https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N59_00_E${lon}_00_DEM/Copernicus_DSM_COG_10_N59_00_E${lon}_00_DEM.tif" \
    "data/raw/cop30_N59_E${lon}.tif"
done

stages=(extract terrain ground buildings structures trees manifest)
[ $# -gt 0 ] && stages=("$@")
for s in "${stages[@]}"; do
  echo "== $s"
  [ "$s" = extract ] && rm -f data/work/water.pkl  # water polygons derive from the extract
  $PY "scripts/$s.py"
done
du -sh web/data
