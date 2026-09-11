# Generative Art Gallery

A page that generates a new, unique flow-field piece every time — just
open `index.html`, no build step or server needed.

Particles drift through a noise-driven vector field, leaving faint
colored trails that build up over time into flowing lines. Each piece
randomizes:

- **Field shape** — `curl` (pure Perlin-noise turbulence), `swirl`
  (noise plus a rotational pull toward a random center point), or
  `waves` (sinusoidal ripples).
- **Color assignment** — random per particle, by noise value (color
  regions aligned with the flow), or by angle from center (radial color
  bands).
- Particle count, step size, line width/opacity, noise scale, and a
  light- or dark-background variant.

Plus a random seed and one of several curated color palettes each time,
so no two pieces look alike.

There's also a second, distinct piece type: **black hole** — an accretion
disk of particles spiraling into a solid event horizon (angular speed and
inward drift both ramp up near the center), colored hot white/blue close
in and by the current palette further out, with a warm photon-ring glow
and a sparse starfield backdrop.

## Controls

| Action | How |
|---|---|
| New piece | "Regenerate" button, or `space` |
| Save current piece as PNG | "Save PNG" button, or `s` |
| Dark mode only | checkbox — forces a dark background instead of the ~30% chance of a light one |
| Black hole | checkbox — replaces the flow field with the black hole renderer |
| Animation | checkbox — keeps the current piece animating forever instead of settling once its normal run finishes; unchecking (or reloading) stops it |

## Notes

- Fully self-contained: a hand-rolled seeded PRNG (mulberry32) and 2D
  Perlin noise implementation, no external libraries.
- Palettes are hand-picked (`PALETTES` in `index.html`) rather than random
  RGB — curated color matters as much as the algorithm for this kind of
  piece.
- An earlier version also had a recursive branching-fractal renderer; it
  was dropped for looking worse than the flow field, not for being slow
  or buggy.
