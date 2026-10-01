// Spatial queries over static level + dynamic state. Pure functions, integer math.
import { SUB, toTile, idiv, dist } from './fixed.js';
import { T, tileAt } from './level.js';
import { ACTOR_HALF } from './constants.js';

export function doorAtTile(L, S, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= L.w || ty >= L.h) return null;
  const i = L.doorIndex[ty * L.w + tx];
  return i < 0 ? null : S.doors[i];
}

export function solidTile(L, S, tx, ty) {
  const t = tileAt(L, tx, ty);
  if (t === T.WALL || t === T.WINDOW || t === T.VOID || t === T.PROP) return true;
  const d = doorAtTile(L, S, tx, ty);
  return !!(d && !d.open);
}

export function opaqueTile(L, S, tx, ty) {
  const t = tileAt(L, tx, ty);
  if (t === T.WALL || t === T.VOID || t === T.PROP) return true;
  const d = doorAtTile(L, S, tx, ty);
  return !!(d && !d.open);
}

// Does an axis-aligned box of half-size `half` centred at (x,y) overlap a solid tile?
export function boxBlocked(L, S, x, y, half = ACTOR_HALF) {
  const x0 = toTile(x - half), x1 = toTile(x + half);
  const y0 = toTile(y - half), y1 = toTile(y + half);
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++)
      if (solidTile(L, S, tx, ty)) return true;
  return false;
}

export function boxOverlapsTile(x, y, tx, ty, half = ACTOR_HALF) {
  return toTile(x - half) <= tx && tx <= toTile(x + half) &&
         toTile(y - half) <= ty && ty <= toTile(y + half);
}

// Move a box by (dx,dy) with axis-separated collision; returns new [x, y].
export function moveBox(L, S, x, y, dx, dy, half = ACTOR_HALF) {
  if (dx) {
    let nx = x + dx;
    if (boxBlocked(L, S, nx, y, half)) {
      if (dx > 0) nx = toTile(nx + half) * SUB - half - 1;
      else nx = (toTile(nx - half) + 1) * SUB + half;
      // Never move backwards because of a clamp (can happen when already overlapping).
      if ((dx > 0 && nx < x) || (dx < 0 && nx > x) || boxBlocked(L, S, nx, y, half)) nx = x;
    }
    x = nx;
  }
  if (dy) {
    let ny = y + dy;
    if (boxBlocked(L, S, x, ny, half)) {
      if (dy > 0) ny = toTile(ny + half) * SUB - half - 1;
      else ny = (toTile(ny - half) + 1) * SUB + half;
      if ((dy > 0 && ny < y) || (dy < 0 && ny > y) || boxBlocked(L, S, x, ny, half)) ny = y;
    }
    y = ny;
  }
  return [x, y];
}

// Line of sight between two points (sub-units), sampled every 1/8 tile.
export function losClear(L, S, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  const n = Math.max(1, idiv(dist(dx, dy), 32));
  const ex = toTile(x1), ey = toTile(y1);
  for (let i = 1; i < n; i++) {
    const tx = toTile(x0 + idiv(dx * i, n)), ty = toTile(y0 + idiv(dy * i, n));
    if (tx === ex && ty === ey) break;
    if (opaqueTile(L, S, tx, ty)) return false;
  }
  return true;
}

export function onExit(L, x, y) {
  return tileAt(L, toTile(x), toTile(y)) === T.EXIT;
}
