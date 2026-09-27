# PROGRESS — resume-safe status

If a session dies, read this first, then `REVIEW.md` (latest pass) and `SCRIPT.md`.

## Status
- [x] Concept, logline, beat sheet, 15-shot list → `SCRIPT.md`
- [x] Renderer: moderngl/EGL on the RTX 4060, raymarched scene, bloom, ACES, letterbox, sub-frame AA+motion blur (`src/render.py`, `src/shaders/`)
- [x] All 15 shots staged (`src/scene.py`), timing in `src/timeline.py`
- [x] Review pass 1 (picture) → fixes applied
- [x] Score + SFX (`src/audio.py` → `output/audio/score.wav`)
- [x] First full preview (`output/preview.mp4`, ~40 s render)
- [x] Review pass 2 (preview film: picture + audio sync) → drift/flyover restaged, mix rebalanced
- [x] Review pass 3 (final-quality stills) → approved
- [x] README.md + one-command `./make_film.sh`
- [ ] Final render (running: `./make_film.sh`, log in `output/final_render.log`) `output/film.mp4` (1920×1080, 60 fps, H.264 + AAC), ffprobe check
- [ ] NEW_IDEAS.md N2 → done, TODO_FIRST.md done line

## How to resume
- One shot after a fix: `.venv/bin/python src/render.py shot <name> --profile preview`
  then `.venv/bin/python src/render.py film --profile preview` (skips finished shots; to
  redo everything use `--force`).
- Stills: `.venv/bin/python src/render.py still 91.8 125.2 --scale 0.5`
- Sheet: `.venv/bin/python src/render.py sheet --start 0 --end 176 --every 4 --scale 0.2`
- Audio: `.venv/bin/python src/audio.py` (~1.5 min, prints levels, writes wave/spec PNGs)
- The final render is resume-safe per shot: finished `output/final/shots/NN_*.mp4` files are skipped
  unless `--force` is given. Partial shots are written as `.part.mp4` and renamed on completion.

## Commits so far
- script + renderer WIP; review pass 1 look fixes.
- score + SFX, make_film.sh, first preview.
- pass 2/3 fixes (drift, flyover), README, review docs.
