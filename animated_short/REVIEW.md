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
| 06 flyover | Reads fairly static because the distant geometry dominates; left rim wall is a black triangle. | Deferred to pass 2 (see below). | → pass 2 |
| 07 contact | Probe lamp washed the floor orange; ping shells rendered as solid filled domes covering the frame. | Tighter lamp falloff; pings drawn as limb-bright rings (face ×0.15). Now reads as call (amber rings) and response (blue domes). Probe glow min 7 px so the hero is findable. | fixed |
| 08 cascade | Crane ended face-on to the ring in empty black — no planet, no scale. | Crane now ends at the approach viewpoint: whole lit ring against the planet's crescent. Wow moment #2. | fixed |
| 09 powerup | Probe cut off at the top of frame. | Aim tilted up. Filaments look good. | fixed |
| 10–11 gate/dive | Portal swirl garish pink/cyan with a white fog over the disc; a hard vertical seam at the top (atan wrap). | Desaturated vista nebula; vortex = sparse spiral streaks; all angular noise via cos/sin (seam-free). Now a dark window full of stars. Wow moment #3 (with the shock-wave whiteout at 125 s). | fixed |
| 12 tunnel | Fine. | — | ok |
| 13 arrival | Far-lantern layer (55% of cells lit) became noise; swarm lanterns sub-pixel — only their answer bubbles showed; galaxy disc a beige blanket. | Far layer 10%/5% + energy-conserving; lanterns ≥3.5 px; galaxy disc tightened. The final pull-back now shows a cluster of lanterns answering with bubbles of light. | fixed |
| 14 credits | Only checked at a black frame so far. | Checked in pass 3 (see below). | → pass 3 |

## Pass 2 — first full preview film (picture in motion + audio + sync)

Material: 8×11 contact sheet of `output/preview.mp4` (every 2 s), the
waveform/spectrogram PNGs, and an onset-detection script that compares the
muxed audio against the cue times in `timeline.py`.

**Picture**

| Shot | Finding | Fix | Status |
|---|---|---|---|
| arc | The story reads without words: lonely call → sunrise → dead ring → answer → cascade → gate → arrival among many lanterns. | — | ok |
| 01 drift | ~6 s of near-empty frame before the probe is findable. | Probe starts at 1.3 km instead of 2.4 km and the aim settles earlier, so the spark is visible after the title fades. | fixed |
| 06 flyover | Confirmed static in motion: the camera sat low while the far geometry barely moved. | Restaged as a high three-quarter chase: the camera drops from 7.5 to 1.6 units above the floor and closes from 9 to 2.2 units behind the probe; fov 50; glow floor 9 px. The floor now streams past and the probe leads the eye. | fixed |
| 08 cascade | The crane end matches the approach shot and the callback reads. | — | ok |
| 13 arrival | Swarm answers are visible as bubbles; the ending is legible. | — | ok |

**Audio** (`score_wave.png`, `score_spec.png`, level printout)

| Finding | Fix | Status |
|---|---|---|
| The beacon answers (low bells, 67–75 s) were the loudest events, so the -1 dBFS normaliser pulled the *sunrise swell* down. The emotional peak was quieter than a side cue. | Beacon answers 0.30/0.34; pings 3–4 at 0.30; sunrise chord up to 0.62; ring chord 0.50. The sunrise and the 125 s shock hit are now the two tallest envelopes on the waveform. | fixed |
| Two unintended near-silences (below -50 dBFS for >0.5 s) at about 33 s and 62 s, between pad chords. | Chords extended to overlap. The remaining sub -50 dBFS windows are only the first and last second (fade in and out, intended). | fixed |
| Spectrogram: no energy above ~16 kHz except the transients; the tinnitus line at 3.7 kHz after the shock is clearly visible and ends on cue. | — | ok |
| Master: peak -1.00 dBFS, RMS -21.6 dBFS, no samples clipped. | — | ok |

**Sync** (onset detection vs. `timeline.py` cues, muxed file)

- All pings, beacon answers, cascade ticks, the shock hit and the swarm answers: within ±5 ms of their cue.
- Ping 4: measured -130 ms. This is a detector artefact: the reverb tail of the preceding answer crosses the onset threshold first. The ping is placed by the same cue time as the others in `audio.py`, so its own attack is on the cue.
- Sunrise: +75 ms. The boom has a soft attack by design, and its peak lands on the limb crossing. Accepted.
- Audio and video streams both start at 0.000; duration 176.000 s.

## Pass 3 — final quality stills (1920×1080, 6 samples) + final verdict

Stills at 4 s (title), 80 s (flyover), 127.5 s (dive) and 170 s (credits),
checked at 100%.

| Frame | Finding | Status |
|---|---|---|
| 4 s title | "LANTERN" is crisp and evenly tracked over the nebula. Stars are points, not static. The slight chromatic fringe on stars is the intended lens CA. | ok |
| 80 s flyover | The amber lamp pool on the ring floor reads well; panels and ribs are sharp with no stripe aliasing; the probe is clearly the subject. | ok |
| 127.5 s dive | The gate's vortex reads as a starfield seen through a window; no seam at the top (the atan wrap fix holds); ring edge crisp. The probe's panel is partly cropped at the frame top, which is acceptable in a fast dive with motion blur. | ok |
| 170 s credits | "LANTERN / Written, directed, animated and scored by Claude / Every frame and every sound generated in code" is crisp and centred, inside the letterbox safe area. | ok |

**Verdict:** no visible glitches at final quality in the checked frames or in the
preview in motion. Known and accepted weaknesses:
- The tower greebles are blocky up close.
- The probe is only a few pixels wide in the widest shots (by design, but it takes a moment to find).
- The synth timbres are clean rather than rich.

Approved for the final render.
