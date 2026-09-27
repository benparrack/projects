# REVIEW — director's notes

Running log of full review passes. Each pass = contact sheets over the whole
film (`python src/render.py sheet ...`, images in `output/sheets/`) plus
hi-res stills of problem frames; from pass 2 on also the audio waveform /
spectrogram (`output/audio/score_*.png`). Findings → fixes → re-check.

## Pass 1 — picture only, first look at every shot (quarter-res sheets)

| Shot | Finding | Fix | Status |
|---|---|---|---|
| all | Starfield read as TV static — too dense and too bright per pixel. | Fewer/sparser layers, energy-conserving star width. | fixed |
| all | Composite flipped the picture twice (text upside down / image mirrored in tests). | Single flip in composite (`sv = suv`). | fixed |
| 01 drift | Probe invisible — a single dim pixel against the nebula for 12 s. The film's hero is missing from its own opening. | Probe now approaches on an exponential distance curve (2.4 km → 7.5 m) so it grows from a spark into the frame; far-only glow boost + wide lantern halo; drift nebula dimmed to 0.55. | fixed |
| 02 closeup | Frame washed tan: core glow tail + each ping shell (camera inside it) filled the whole frame; cage looked sun-lit on the night side. | Glow boost only for distant shots; ping shells fade once they sweep past the camera; exposure 0.8; outer-cage core spill cut ×4. | fixed |
| 03 reveal | Sun *sank* behind the limb instead of rising (wrong rotation axis). Planet read small. | Sun rotated about `cross(toPlanet, sun)` — crosses the limb at 40–41 s exactly on the SUNRISE cue; probe moved to 120 000 km (planet ~60° wide). | fixed |
| 03 reveal | Night side glowed tan everywhere; lightning were blue squares. | Sharper forward-scatter + rim terms; lightning as Gaussian blobs, rarer. | fixed |
| 04 approach | Camera on the planet's night side: ring was a thin grey outline against black. | Camera moved to the anti-sun side looking sunward — the 6 000 km ring now silhouettes against the lit crescent (searched numerically for lit-behind-ring + ring openness). Wow moment #1. | fixed |
| 05 ringreveal | Ring face was a flat grey ribbon with shimmering stripes. Cause: panel lookup used `p.y`, constant on the flat side faces. | Radial coordinate on side faces; distance-filtered panels; 40 km segment tones and 120 km ribs readable from afar. | fixed |
| 06 flyover | Reads fairly static because the distant geometry dominates; left rim wall is a black triangle. | Accepted for now — floor greebles do rush past at full res/motion blur. Revisit in pass 2 with motion. | open |
| 07 contact | Probe lamp washed the floor orange; ping shells rendered as solid filled domes covering the frame. | Tighter lamp falloff; pings drawn as limb-bright rings (face ×0.15). Now reads as call (amber rings) and response (blue domes). Probe glow min 7 px so the hero is findable. | fixed |
| 08 cascade | Crane ended face-on to the ring in empty black — no planet, no scale. | Crane now ends at the approach viewpoint: whole lit ring against the planet's crescent. Wow moment #2. | fixed |
| 09 powerup | Probe cut off at the top of frame. | Aim tilted up. Filaments look good. | fixed |
| 10–11 gate/dive | Portal swirl garish pink/cyan with a white fog over the disc; a hard vertical seam at the top (atan wrap). | Desaturated vista nebula; vortex = sparse spiral streaks; all angular noise via cos/sin (seam-free). Now a dark window full of stars. Wow moment #3 (with the shock-wave whiteout at 125 s). | fixed |
| 12 tunnel | Fine. | — | ok |
| 13 arrival | Far-lantern layer (55% of cells lit) became noise; swarm lanterns sub-pixel — only their answer bubbles showed; galaxy disc a beige blanket. | Far layer 10%/5% + energy-conserving; lanterns ≥3.5 px; galaxy disc tightened. The final pull-back now shows a cluster of lanterns answering with bubbles of light. | fixed |
| 14 credits | Only checked at a black frame so far. | Check text in pass 2. | open |
