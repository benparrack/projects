// Integer-only math helpers. The simulation never touches floats, Math.sin/cos
// or Math.random, so the same inputs give bit-identical state on any engine.
import { COS } from './trigtable.js';

export const SUB = 256;          // sub-units per tile
export const HALF_TILE = 128;
export const ANGLES = 256;       // a full turn
export const TRIG_ONE = 1024;    // COS/SIN are scaled by this

export const cos = (a) => COS[a & 255];
export const sin = (a) => COS[(a - 64) & 255];

export const tileCenter = (t) => t * SUB + HALF_TILE;
export const toTile = (v) => Math.floor(v / SUB);

// Integer division truncating toward zero (C semantics).
export const idiv = (a, b) => Math.trunc(a / b);

export function isqrt(n) {
  if (n <= 0) return 0;
  let x = Math.floor(Math.sqrt(n)); // only a starting guess; corrected below
  while (x * x > n) x--;
  while ((x + 1) * (x + 1) <= n) x++;
  return x;
}

export const dist = (dx, dy) => isqrt(dx * dx + dy * dy);

// Angle (0..255) pointing along (dx, dy): the table entry with the largest dot product.
export function angleTo(dx, dy) {
  if (dx === 0 && dy === 0) return 0;
  let best = 0, bestDot = -Infinity;
  for (let a = 0; a < ANGLES; a++) {
    const d = dx * COS[a] + dy * COS[(a - 64) & 255];
    if (d > bestDot) { bestDot = d; best = a; }
  }
  return best;
}

// Signed shortest difference b - a in (-128, 128].
export function angleDiff(a, b) {
  let d = (b - a) & 255;
  if (d > 128) d -= 256;
  return d;
}

// Step angle a toward b by at most `step`.
export function turnToward(a, b, step) {
  const d = angleDiff(a, b);
  if (Math.abs(d) <= step) return b & 255;
  return (a + (d > 0 ? step : -step)) & 255;
}

// Is (dx,dy) inside a cone of half-angle `half` (angle units) around `facing`, within `range`?
export function inCone(facing, half, range, dx, dy) {
  const d = dist(dx, dy);
  if (d > range) return false;
  if (d === 0) return true;
  const dot = dx * cos(facing) + dy * sin(facing);
  // dot = |v| * 1024 * cos(theta); inside when cos(theta) >= cos(half).
  return dot >= cos(half) * d;
}
