# Drift

A single-file WebGL2 ambient piece. Up to a million glowing particles trace strange
attractors and flow fields, including a gravitationally lensed black hole. Each scene holds for 75 s, then dissolves into stardust and
re-forms as the next one. There's optional generative ambient sound.

## Run

```
cd drift && python3 -m http.server 8000   # then open http://localhost:8000
```

Opening `index.html` directly also works, since it has no build step and no dependencies
(only Google Fonts). It needs a browser with WebGL2 and float render targets (`EXT_color_buffer_float`).

## Controls

| | |
|---|---|
| drag / wheel / pinch | orbit and zoom (it eases back into a slow auto-orbit) |
| move the mouse | stir the particles |
| click / tap | send a ripple |
| press and hold | a gravity well gathers the dust (drag to move it); let go to burst it |
| Space / → / ← | next / previous scene |
| G / 1–9, 0 | scene gallery / jump to a scene |
| B | breathe along (~5.5 breaths a minute, with the form swelling and a soft bell at each turn) |
| L | lock the current scene |
| P | pause the simulation |
| M | sound on/off (off by default; the choice is remembered) |
| H | zen mode (hide all UI) |
| F | fullscreen |
| S | save a PNG |
| ? | help |

## Scenes

Thomas · Halvorsen · Event Horizon · Lorenz · Maelstrom · Halo · Dadras · Plume · Silk ·
Rössler · Chen–Lee. The play
order is shuffled each cycle.

## How it works

- **Simulation:** GPGPU in a 1024² RGBA32F texture holding position and age, plus a velocity
  MRT. It integrates with RK2 at 60 Hz. Attractors are mapped into a unit-sized world. The
  `C`/`S`/`K` constants in the shader come from `tools/fit.mjs` (`node tools/fit.mjs`), which
  fits each attractor's centre, scale and speed, then self-checks the world-space field for
  escapes.
- **Maelstrom and Plume:** flow fields rather than attractors. Maelstrom is a differentially
  rotating disc with a 2D divergence-free noise swirl (3D curl flattened into a plane gathers
  dust into threads, so it isn't used there). Plume is rising curl-noise smoke.
- **Event Horizon, Halo, Silk:** Event Horizon is a Keplerian accretion disc whose infall
  leaves up helical polar jets. The compositor adds a screen-space point-mass lens (an
  Einstein ring plus a shadow). Halo is poloidal circulation pulled onto a torus shell. Silk
  is low-frequency curl around a wandering centre.
- **Light waves:** every chime (bells, ripples, breaths, and bursts released from the well)
  sends a shell of light outward through the particles. They ring even with the sound off.
- **Starfield:** two hashed shells of stars at infinity, which parallax against the form as
  the camera orbits.
- **Rendering:** each particle is drawn as a motion-blurred capsule with energy-normalised
  brightness and depth of field. Trails accumulate in an HDR buffer. Post-processing is a
  7-mip dual-filter bloom, chromatic aberration, vignette, ACES tone mapping, and grain with
  dither.
- **Adaptive quality:** the particle count and resolution scale step through 7 tiers based on
  measured frame time.
- **Sound:** WebAudio pad chords, bass, wind and pentatonic bells through a generated reverb.
  Stirring and ripples chime.

Debug hook: `window.drift.{go(i), state(), setTier(t), ripple()}`.
