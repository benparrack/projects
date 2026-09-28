# LANTERN

A wordless 2:56 sci-fi animated short. Every frame and every sound is generated
in code: raymarched GLSL on the GPU for the picture, and numpy/scipy synthesis
for the score and SFX. No downloaded art or audio is used; the only external
asset is the system Ubuntu Sans font for the title and credits.

A small failing probe calls out into deep space with no reply. It finds a dead
ring-gate 6,000 km across orbiting a gas giant. Its call wakes the gate, and the
gate opens onto the place where every other lantern went. See `SCRIPT.md`.

## One command

```bash
./make_film.sh            # final: output/film.mp4 (1920×1080, 60 fps, H.264 + AAC)
./make_film.sh preview    # quick check: output/preview.mp4 (1/3 res, 30 fps, 1 sample)
```

The script creates `.venv` (moderngl, numpy, scipy, pillow) if it's missing,
renders the score to `output/audio/score.wav`, then renders every shot, joins
them and muxes the audio.

| Profile | Resolution / fps | Samples per frame | Time on an RTX 4060 |
|---|---|---|---|
| preview | 640×360 / 30 | 1 | ~40 s + ~85 s audio |
| final | 1920×1080 / 60 | 6 (AA + motion blur) | 7 m 56 s total (~85 s audio + 396 s shots/encode), ~1 GB file |

## Requirements

- Linux with a GPU that supports headless EGL (moderngl standalone context), Python 3, and `ffmpeg`/`ffprobe`.
- The font `/usr/share/fonts/truetype/ubuntu/UbuntuSans[wdth,wght].ttf`. Change `FONT` in `src/text.py` to use a different one.

## Layout

| Path | What |
|---|---|
| `SCRIPT.md` | Logline, beat sheet and 15-shot list with timings and sound cues |
| `DECISIONS.md` | Every creative and technical decision, with the reasoning behind it |
| `REVIEW.md` | Three full self-review passes (contact sheets, stills, waveform/spectrogram, sync) |
| `PROGRESS.md` | Resume-safe status and commands |
| `src/timeline.py` | Shot boundaries and cue times: the single source of truth for picture and sound |
| `src/scene.py` | Per-shot camera/object staging: `render(t)` → shader uniforms |
| `src/shaders/scene.frag` | The raymarched world: probe, gas giant, ring-gate, portal, swarm, sky |
| `src/shaders/{down,up,composite}.frag` | Bloom mip chain, ACES tonemap, grade, grain, letterbox |
| `src/render.py` | Deterministic offline renderer. Pipes frames to ffmpeg. Subcommands `film`, `shot`, `still`, `sheet` |
| `src/text.py` | Title card and credits overlay |
| `src/audio.py` | Score and SFX synthesis, reverbs and master. Also writes the review PNGs |
| `output/` | Renders (git-ignored) |

## Useful subcommands

```bash
.venv/bin/python src/render.py still 40 80 125 --scale 1 --samples 6   # stills → output/stills/
.venv/bin/python src/render.py sheet --start 0 --end 176 --every 4     # contact sheet → output/sheets/
.venv/bin/python src/render.py shot flyover --profile preview          # re-render one shot
.venv/bin/python src/audio.py                                           # score only
```

Rendering is deterministic: the same code gives the same frames. Each finished
shot is cached, so an interrupted final render resumes from the shot where it
stopped. Run without `--force` to resume.
