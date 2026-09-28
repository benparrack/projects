# Webslinger

A Spider-Man-style web-swinging game set in a procedural Manhattan-like city. It is
pure three.js (r186, vendored) with no build step.

```
./serve.sh            # → http://localhost:8084   (optional port arg)
```

**Use Google Chrome.** The game uses pointer-lock mouselook, and Firefox on X11 has
a bug where the cursor sticks at the screen edge (see IDEAS.md "0. 3D-Rendered
Games").

## Controls

| Input | Action |
|---|---|
| Mouse | Look / steer the swing |
| WASD / arrows | Run, and lean into the swing |
| Hold LMB or Shift | Web-swing. Keep holding to chain swings automatically |
| Release (or Space on the rope) | Let go. Releasing near the bottom or on the upswing flings you the furthest |
| Space | Jump. Hold it on the ground for a super jump |
| RMB / E | Web-zip to the point you're looking at |
| Q | Air dash |
| Ctrl / C | Dive |
| T | Cycle time of day (golden hour, sunset, blue hour, night, dawn, morning, midday) |
| V | Cycle look: Cinematic, Realistic (AgX, SSAO, eye adaptation), Comic book |
| P | Photo mode |
| R | Respawn |
| H | Help |
| F3 | Stats |
| Esc | Menu (quality and settings) |

## How it works

- **Swing physics** (`src/player.js`, 240 Hz): the web is an inextensible rope.
  - A constraint removes outward radial velocity and keeps tangential velocity.
  - For the first `P.CATCH` seconds a fresh rope is springy: it stretches a little
    and swings most of your fall speed forward instead of stopping you dead.
  - Rendering uses `player.rp`, which is interpolated between substeps, so display
    rates that aren't a divisor of 240 don't stutter.
  - You keep your momentum through the arc and pick up speed on the downswing by
    reeling in a little ("pumping").
  - The anchor finder picks building edges ahead of and above you. It is biased by
    velocity, camera direction and the stick.
  - There is also wall-running, zipping, dashing and landing rolls.
- **City** (`src/city.js`, `cityMesh.js`, `collide.js`): a seeded Manhattan grid with
  a park and a waterfront. Collision uses swept AABBs against a spatial hash.
- **Look** (`src/materials.js`, `sky.js`, `post.js`):
  - Buildings use a patched MeshStandardMaterial with interior-mapped windows and
    metallic curtain-wall glass. The glass reflects a fake skyline, fades by
    Fresnel, and lights up at night.
  - The sky is a Nishita atmosphere LUT, which also feeds the PMREM environment and
    the height fog.
  - Shadows are CSM cascades.
  - Post-processing is an HDR pipeline: SSAO (half-res), eye adaptation, bloom,
    god rays, ACES or AgX, FXAA, and dynamic resolution to hold the frame rate.
    SSAO is off on Low quality.
  - Cornice boxes (`rim` in `city.js`) emit only their overhanging top rim, to
    avoid z-fighting with the roof below.

**Vendored patch:** `vendor/three/addons/csm/CSMShader.js` has a
`[webslinger patch]` block. It adds r186's `material.dfg` and multi-scatter setup,
which upstream's CSM chunk is missing. Without it, IBL specular is zero, so glass
renders black. Keep the patch if you update three.

## Debugging

Open `?debug` to get `window.WS`:

- `WS.shot(w)` returns a JPEG data URL.
- `WS.tick(n)` advances n frames deterministically.
- `WS.play()` skips the title screen.
- `WS.fake = {mz:1, swing:true, swingP:true}` injects input.
- `WS.setTimePreset(i)` sets the time of day.
- `WS.view = [px,py,pz, lx,ly,lz, fov]` sets the title camera.
- `player`, `chase`, `sky`, `post`, `renderer`, `csm`, `world` and `city` are also
  exposed.

Tests: `node tests/city.test.mjs`, `node tests/swing.test.mjs`. The swing test runs
a headless bot through the city and reports swings, maximum speed and distance.
