# Generative Art Gallery

A page that generates a new, unique piece of algorithmic art every time —
just open `index.html`, no build step or server needed.

Two techniques, picked randomly (or chosen from the dropdown):

- **Flow field** — thousands of particles drift through a Perlin-noise
  vector field, leaving faint colored trails that build up into flowing,
  wind-swept lines.
- **Radial branches** — a symmetric fractal that recursively branches
  outward from the center, tapering and randomizing angle/length at each
  split.

Each piece uses a random seed plus one of several curated color palettes,
so no two look alike.

## Controls

| Action | How |
|---|---|
| New piece | "Regenerate" button, or `space` |
| Switch technique | dropdown (Random / Flow Field / Radial Branches) |
| Save current piece as PNG | "Save PNG" button, or `s` |

## Notes

- Fully self-contained: a hand-rolled seeded PRNG (mulberry32) and 2D
  Perlin noise implementation, no external libraries.
- Palettes are hand-picked (`PALETTES` in `index.html`) rather than random
  RGB — curated color matters as much as the algorithm for this kind of
  piece.
