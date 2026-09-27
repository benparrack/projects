#!/usr/bin/env bash
# Encodes the CrazyGames preview videos from frames recorded by preview_recorder.js.
# Cover still (1.2s) -> 0.5s crossfades into segments A, B, C. 19.8s, silent H.264.
# Landscape = frames scaled to 1920x1080; portrait = native 1080x1620 crop of the centre column.
set -euo pipefail
cd "$(dirname "$0")"
F=../../.playwright-mcp/frames
enc() {
  ffmpeg -y -loglevel error \
    -loop 1 -framerate 30 -t 1.7 -i "$1" \
    -framerate 30 -i $F/A/%05d.jpg -framerate 30 -i $F/B/%05d.jpg -framerate 30 -i $F/C/%05d.jpg \
    -filter_complex "[0]format=yuv420p,setsar=1[c];[1]$2,format=yuv420p,setsar=1[a];[2]$2,format=yuv420p,setsar=1[b];[3]$2,format=yuv420p,setsar=1[d];\
[c][a]xfade=transition=fade:duration=0.5:offset=1.2[x1];[x1][b]xfade=transition=fade:duration=0.5:offset=7.233[x2];[x2][d]xfade=transition=fade:duration=0.5:offset=13.266,format=yuv420p[v]" \
    -map "[v]" -an -c:v libx264 -preset slow -crf 18 -r 30 -movflags +faststart "$3"
}
enc cover_1920x1080.png "scale=1920:1080:flags=lanczos" preview_landscape_1920x1080.mp4
enc cover_portrait_1080x1620.png "crop=1080:1620:645:0" preview_portrait_1080x1620.mp4
