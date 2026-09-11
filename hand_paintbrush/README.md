# Hand Paintbrush

Turn your hand into a watercolor brush. Tracks your index fingertip via
webcam (MediaPipe HandLandmarker) and leaves a flowing watercolor-style
stroke behind it: a crisp core line, a soft slow-spreading color wash
underneath, and little droplets of color that break off and drift as
the stroke "dries".

Pinch your thumb and index finger together to lift the brush (move
without drawing), same as lifting a pen off paper.

## Setup

```
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python main.py
```

The hand-tracking model (~8MB) downloads automatically to `models/` on
first run.

## Controls

| Key | Action |
|-----|--------|
| `c` | Clear the canvas |
| `b` | Toggle trail-over-camera vs. trail-on-black |
| `f` | Toggle the on-screen FPS counter |
| `s` | Save a snapshot to `snapshots/` |
| `q` / `Esc` | Quit |

## Notes

- Camera capture and hand detection each run on their own background
  thread, decoupled from rendering — detection (the slow part, ~20-30ms)
  no longer blocks the render loop, so the picture stays smooth (~60fps)
  even though the hand position itself only updates as fast as detection
  can keep up.
- Two hands are tracked independently with different hues.
- Stroke color cycles through hue over time.
- Stroke width responds to finger speed: slow moves lay down a thick,
  "wet" line; fast moves thin out, like a real brush.
- Moving fast spawns extra color droplets that drift outward and fade,
  giving the branching/bleeding watercolor look.
- All of the above is tunable via the constants near the top of
  `main.py` (`CORE_*`, `WASH_*`, `PARTICLE_*`).
