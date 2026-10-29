# Decisions log

Every call I made without asking, and why.

## D1 — Concept: "LANTERN"
There's a lonely probe calling into the dark, a dead megastructure that
answers, a gate, and a crowd of others on the far side. Awe needs scale, so
there's a 1 m character against a 6,000 km gate against a gas giant. A wordless
story needs one readable action, and here that's the call and the reply. The
ping is both the plot device and the musical motif, so sound and picture share
one idea, and a first-time viewer can follow "it calls, nobody answers → it
calls, something answers → it goes through → everyone answers". Scope: one
character (the probe), one focal object (the gate), two settings (the gas
giant's orbit and the other side).

## D2 — Visual style: stylised-realistic "space photography", raymarched in GLSL
I chose a cinematic, NASA-render-meets-Interstellar look over flat or toon
styles. The reasons:
- Signed-distance raymarching and analytic shading are what I can execute to a
  polished standard in pure code. Gas giants, atmospheric limbs, stars,
  nebulae, glow, bloom and machined megastructures are all shader-native, and
  nothing needs modelling.
- Awe comes from light and scale. HDR emission plus bloom plus a proper
  tonemap is what sells scale in space, and that's easy to control
  procedurally.
- It's letterboxed 2.39:1 for a cinematic frame. That also costs 25% fewer
  pixels per frame.

## D3 — Tech: Python + moderngl on headless EGL (NVIDIA), not a browser
I checked that `moderngl.create_context(backend='egl')` gives
`NVIDIA GeForce RTX 4060 Laptop GPU`, which means real GPU GL with no software
fallback and no browser needed. That makes the pipeline simpler and more
deterministic than headless Chromium plus canvas readback. Each frame is
`render(t)`: Python computes every uniform in float64 as a pure function of
`t`, the GPU renders, and raw RGB frames are piped to ffmpeg.

## D4 — Precision strategy: camera-relative, per-object scaled frames
Scales run from a 1 m probe to a 60,000 km planet. Python (float64) computes
each object's ray origin in that object's own local units: the planet in
planet radii, the probe in metres, and the ring in km in an *anchored* frame
that is rotated so the camera sits near angle 0, with the ring's radius
subtracted. This keeps float32 in the shader precise near the camera. World
depth for compositing is in km.

## D5 — Anti-aliasing and motion blur: accumulated jittered sub-frames
The final render uses N passes per frame. Each pass has a sub-pixel jitter and
a time offset inside a 180° shutter, and the passes are averaged in a float
buffer. That gives both AA and true motion blur while staying deterministic.
Previews use 1 pass.

## D6 — Sound exists in space
It's a stylistic, film-tradition choice. Wordless storytelling needs sound
effects for the ping, the answer, the impact and the whoosh.

## D7 — Audio: numpy/scipy offline synth
It's an additive/subtractive synth with FM bells, filtered noise and a
generated convolution reverb, rendered to a 48 kHz stereo WAV. It reads the
same `timeline.py` event list as the renderer, so sync can't drift.

## D8 — Rendering in per-shot segments
Each shot is encoded to `output/shots/NN.mp4` and then concatenated. That makes
the render resume-safe (finished shots are skipped) and lets me re-render one
shot after a fix.

## D9 — Fonts
Ubuntu Sans (a system font, free under the Ubuntu Font Licence), rendered
with PIL into textures. It's clean and thin, and it's already installed, so
nothing is downloaded.

## D10 — Cheats in service of the picture (logged so they're not mistaken for bugs)
- **Sunrise in the reveal:** the sun direction is rotated during shot 4 about
  `cross(toPlanet, sun)` so it crosses the limb exactly on `SUNRISE` (41 s).
  Real orbital motion would take hours; the audience needs it on the beat.
- **Probe distance:** the probe was moved to 120 000 km from the planet (was
  230 000) so the planet fills ~60° of sky in the reveal, which reads as huge.
- **Probe size vs. glow:** the probe is metres across, which is sub-pixel in wide
  shots. A minimum on-screen glow size (`glow_min_px`) keeps the hero findable,
  like a lamp seen from far away.
- **Swarm lanterns** get the same minimum-pixel treatment. They're the payoff and
  must read as distinct lights, not noise.

## D11 — Ping shells are drawn limb-bright
A physically "correct" glowing shell seen from inside, or face-on, lights the
whole frame evenly and reads as a wash. The shell is drawn mostly at its limb,
so every call and answer reads as a *ring of light*, and it fades once it has
swept past the camera.

## D12 — Approach and cascade share one viewpoint
Both use the camera direction on the anti-sun side, looking sunward, found by a
numeric search for "the planet point behind the ring is lit" × "ring is
open". The ring silhouettes against the bright crescent in both shots, so the
cascade (shot 9) rhymes with the discovery (shot 5): the same dark hoop, now
lit.

## D13 — Mix: normalise to −1 dBFS with a soft knee, and keep the loudest moment for the climax
The shock hit at 125.2 s is the peak of the film. The beacon's answer is kept
*below* the sunrise swell, because the turn is carried by the silence before it,
not by its volume. No window except the first/last second drops below −50 dBFS.
The planned near-silence after the shock (125.8–129.2) is a tinnitus tone plus
a rumble, which is intentional rather than dead air.

## D14 — One command
`./make_film.sh` creates the venv if needed, renders the score, renders every
shot with `--force`, and muxes. `./make_film.sh preview` does the fast pass.
