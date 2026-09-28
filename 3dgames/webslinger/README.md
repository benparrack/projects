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
| F (+ W/S/A/D) | Air trick: front flip, backflip, corkscrew, or a 360 with no direction. Land before it finishes and you bail |
| Tab / middle mouse (hold) | Slow-mo focus. Drains in about 3.5 s and refills faster while you're comboing |
| G | Drop in at the next ring race. Press again to cancel |
| M | Toggle the minimap |
| T | Cycle time of day (golden hour, sunset, blue hour, night, dawn, morning, midday) |
| V | Cycle look: Cinematic, Realistic (AgX, SSAO, eye adaptation), Comic book |
| P | Photo mode |
| R | Respawn |
| H | Help |
| F3 | Stats |
| Esc | Menu: quality and settings (including the **Swing assist** toggle), the ring race list with bests, and resetting progress |

Gamepad: RT swing · A jump · LT zip · X dash · B dive · Y trick · RB slow-mo · LB time of day · Back race · Start menu.

## Game features

- **Style combos** (`src/style.js`): everything you do off the ground adds points.
  - Moves that score: swings, big flings (over 42 m/s), jump-offs, tricks, near
    misses (grazes), close calls (a wall within 4.5 m beside you at speed), street
    swoops and rooftop skims, top speed, wall runs, launches, tokens and race rings.
  - The multiplier grows by 1 for every 3 moves, up to ×10. The same move repeated
    back to back is worth half each time.
  - The combo banks after 0.6 s on your feet and gets a rank from Nice to Legendary.
  - A bail or respawn loses the combo. The best combo and the lifetime total are
    saved.
- **Ring races** (`src/courses.js` builds them, `src/race.js` runs them): 4
  courses, Avenue Sprint, Crosstown Zigzag, Skyline Dive and Park Loop.
  - Each course is 20–36 rings built from street waypoints. Ring heights are clamped
    under the local skyline and each ring is nudged clear of buildings.
  - Gold light columns mark the start rings. Fly through one to start the clock.
  - An edge-of-screen pointer and the minimap show the next ring. A split delta
    against your best run is shown at each ring.
  - The best run is saved with its splits and a ghost (20 Hz), which you race
    against.
- **Minimap** (`src/minimap.js`): heading-up, and shows tokens, race starts or the
  active route, and the ghost.
- **Slow-mo, speed lines**: slow-mo scales the simulation timestep by 0.3. It also
  desaturates and cools the image in `post.js` and sweeps an audio lowpass. Speed
  lines stream out from the motion-blur centre above about 34 m/s.
- **Progress**: collected tokens persist in localStorage. Reset it from the Esc menu
  with a two-click confirm.

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
    velocity, camera direction and the stick. It also runs a short pendulum preview
    (`simArc`) for each candidate. Arcs that would hit a wall are penalised, and
    arcs that carry you further forward score higher.
  - The rope pivots on a physics point pulled toward your heading (`pivotFor`,
    `P.PIVOT_PULL`), so a web shot to one side doesn't yank you into that building.
    The visible web still ends on the building (`player.anchor`).
  - **Swing assist** (`steerAssist`, on by default, toggle it in Esc settings):
    - When a wall is coming up along your velocity, it bends your path toward the
      freer side. If both sides are blocked, it lifts you instead.
    - When you're flying along an avenue or street and looking down it, it lines
      you up with the road and keeps you centred.
  - A shallow glancing hit on a wall is a *graze*: you keep about 96% of your
    speed and get pushed off it, instead of stopping dead.
  - There is also wall-running, zipping, dashing and landing rolls.
- **City** (`src/city.js`, `cityMesh.js`, `collide.js`): a seeded Manhattan grid with
  a park and a waterfront. Collision uses swept AABBs against a spatial hash.
- **Look** (`src/materials.js`, `sky.js`, `post.js`):
  - Buildings use a patched MeshStandardMaterial with interior-mapped windows and
    metallic curtain-wall glass. The glass reflects a fake skyline, fades by
    Fresnel, and lights up at night.
  - The sky is a Nishita atmosphere LUT, which also feeds the PMREM environment and
    the height fog.
  - Shadows are CSM cascades. The far cascades re-render every 2nd, 3rd or 4th
    frame (`staggerShadows` in `main.js`). All cascades re-render at once when the
    camera jumps or the sun moves.
  - Glass reflections use per-tower tint and roughness variation, and a small
    per-pane normal jitter. The fake-skyline edge is softened by `fwidth`, and the
    reflection is capped relative to the real IBL radiance so it doesn't blow out.
  - Post-processing is an HDR pipeline: SSAO (half-res), eye adaptation, bloom,
    god rays, ACES or AgX, FXAA, and dynamic resolution to hold the frame rate.
    SSAO is off on Low quality.
  - At HiDPI render scale (Ultra), MSAA drops from 4× to 2×. FXAA is skipped
    whenever MSAA is on at full scale. Eye adaptation snaps to the new level after
    a time-of-day change or a respawn instead of fading from white.
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
- `WS.goRace()` drops you at the next race.
- `player`, `chase`, `sky`, `post`, `renderer`, `csm`, `world`, `city`, `style` and
  `races` are also exposed.

Tests: `node tests/city.test.mjs`, `node tests/swing.test.mjs`,
`node tests/flow.test.mjs [assist 0|1]`, `node tests/style.test.mjs`.
- The style test runs a trick bot and a bail, checks that combos bank, and checks ring
  counts and gaps for each race course.
- The swing test runs a headless bot through the city and reports swings, maximum
  speed and distance.
- The flow test runs a player-like bot down avenues, a street and a diagonal. It
  reports wall hits, grazes, average speed and distance.
- Flow results on 2026-09-28:

  | Build | Wall hits | Avg speed | Distance |
  |---|---|---|---|
  | Before | 14 | 21.5 m/s | 2.7 km |
  | Assist on | 2 | 34.4 m/s | 5.9 km |
