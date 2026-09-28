# Stockholm 3D

A browser 3D explorer of central Stockholm built from open data. It shows every OSM
building extruded to its real height, terrain from the Copernicus DEM, water,
bridges and trees, and lights the scene with the real sun for Stockholm's latitude
at any date and time.

```
./build.sh     # one-time: downloads OSM + DEM, preprocesses into web/data/ (~40 MB)
./serve.sh     # http://localhost:8083
```

## Features

- **Buildings.** About 0.56M triangles in 500 m tiles. Heights come from
  `height`/`building:levels`, roof shapes from OSM where they are tagged, and
  facade colours from OSM tags or the building type. Facades are procedural
  (a shader): framed windows with sills, mullions, curtains and blinds, a taller
  ground floor with shop windows and doors, weathering streaks, and a contact
  shadow at the base. Sloped roofs get standing seams. A random share of windows
  and most shop fronts light up after dark. Detail fades out and is skipped once
  it is smaller than a pixel.
- **Hand-tuned landmarks.** These include Stadshuset, Storkyrkan,
  Riddarholmskyrkan, Kaknästornet, Avicii Arena, Vasamuseet and Hötorgsskraporna.
  Each one sits in the landmark dropdown with a framed camera view.
- **Terrain and ground.** A 5 m heightmap and a ground texture per tile: 1024 px,
  plus a 2048 px (~25 cm/px) version streamed in for tiles near the camera.
  The texture draws land cover, roads with curbs, lane markings and zebra
  crossings, rail, the shoreline and soft contact shadows around buildings; its
  alpha channel is a street-light mask that glows at night. Up close a shader
  adds procedural detail by surface type (asphalt grain and patches, paving
  slabs, gravel, grass). The terrain mesh has four index LODs with skirts, and
  the shadow map re-renders only when the sun, the view or the loaded tiles
  change.
- **Water.** Water polygons are built from coastline and lake ways plus DEM
  sampling, and carved against land evidence (buildings, roads, land cover).
  The water surface has animated normals and reflects the sky.
- **Bridges and piers.** Decks follow a smooth profile over water, with
  parapets and columns.
- **Trees.** There are about 90k: OSM trees plus density scatter in
  woods, parks and grass. Leaves change with the season.
- **Sun and sky.** The sun position uses the NOAA algorithm, and sunrise and
  sunset use the Swedish DST rule. The sky is Rayleigh/Mie scattering, and image-based
  lighting is rebaked as the sun moves. There are real shadows, and stars turn
  around the celestial pole with sidereal time.
- **Time controls.** A date and time-of-day slider, play speeds of 1×, 5 min/s
  and 1 h/s, and a Now button. Season is either derived from the date (snow
  from mid-December to mid-March, autumn colours in October) or forced.
- **Camera modes.**
  - **Map:** left-drag pans, right-drag rotates, the wheel zooms.
  - **Fly:** WASD to move, E/Q for up and down, drag to look, the wheel sets
    speed, and Shift goes fast.
  - **Walk:** eye height, collision with building walls, Shift to run.
- **Search and info.** Search matches building names, places and districts,
  ignoring accents. Clicking a building shows its name, type, height, levels,
  build year and description, with Wikipedia and OSM links.
- **Shareable views.** The URL hash stores the camera, time, mode and season.

## Pipeline (`scripts/`)

| stage | output |
|---|---|
| `extract.py` | OSM PBF → projected shapely features (`data/work/features.pkl`) |
| `terrain.py` | bare-earth heightmap from the Copernicus GLO-30 DSM: building footprints and woods masked out, narrow DSM bumps (ships, roof smear) rejected by a grey opening, holes refilled, quays ramped to ~1.5 m |
| `ground.py` | per-tile ground textures `web/data/ground/{g,h}_i_j.webp` (1024/2048 px, RGB + night-light alpha), plus `terrain.bin.gz` |
| `buildings.py` | building mesh tiles `web/data/tiles/b_i_j.bin.gz` + per-building info JSON |
| `structures.py` | bridges and piers `s_i_j.bin.gz` |
| `trees.py` | `web/data/trees.bin.gz` |
| `manifest.py` | `web/data/manifest.json`: grid, landmarks, labels, search index |

Coordinates are local metres around (59.325 N, 18.0708 E): x points east,
z points south and y is up. Mesh tiles use a small binary format, `SB3D`.
It stores f32 positions, i8 normals whose 4th byte holds flags (roof, windows,
glass, plain), u8 colours whose alpha holds a per-building seed, and a
per-triangle owner index for picking.

`web/` is plain ES modules, with three.js r186 vendored under `web/vendor/`. It
has no build step.

Data © OpenStreetMap contributors (ODbL). The DEM is Copernicus GLO-30
(© DLR/Airbus, provided under COPERNICUS by the EU and ESA).

## Notes

- Firefox's `createImageBitmap` corrupts alpha when it resizes with `"medium"` or
  `"high"` quality and `premultiplyAlpha: "none"`. Ground LODs therefore resize
  with `"low"` quality, and the native 1024 px size is not resized at all.
- GLO-30 is pixel-is-point (pixel centres on whole arc-seconds). Treating it as
  pixel-is-area shifts the whole DEM by ~7 m east and ~17 m south, which slides
  roof heights into the streets.
- In walk mode, landmark labels hidden behind buildings are occlusion-tested
  with a few raycasts per frame.
- The walk and fly modes use drag-to-look rather than pointer lock, which
  misbehaves on Firefox+X11.
