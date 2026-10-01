// Cameras, laser grids and power circuits.
import { SUB, tileCenter, inCone, dist } from './fixed.js';
import { losClear, boxOverlapsTile } from './world.js';

export const CAM_RANGE = SUB * 6;
export const CAM_HALF = 22;          // ~31 degrees each side
export const CAM_ALARM = 24;         // suspicion ticks before a camera raises the alarm
export const DIRS = { e: 0, se: 32, s: 64, sw: 96, w: 128, nw: 160, n: 192, ne: 224 };
export const dirAngle = (f) => (typeof f === 'string' ? DIRS[f] : (f ?? 0)) & 255;

export function initSecurity(L, S) {
  S.circuits = {};
  for (const c of L.circuits) S.circuits[c] = true;
  for (const pb of L.powerboxes) S.circuits[pb.circuit] = true;
  for (const c of L.cameras) if (c.circuit) S.circuits[c.circuit] ??= true;
  for (const l of L.lasers) if (l.circuit) S.circuits[l.circuit] ??= true;

  S.powerboxes = L.powerboxes.map((pb) => ({ id: pb.id, cutAt: -1, dispatched: false }));
  S.terminals = L.terminals.map((t) => ({ id: t.id, used: false }));
  S.vaults = L.vaults.map((v) => ({ id: v.id, open: false }));
  S.cameras = L.cameras.map((c) => ({
    id: c.id, x: tileCenter(c.x), y: tileCenter(c.y),
    facing: dirAngle(c.facing), looped: 0, disabled: false, sus: 0, seeing: -1,
  }));
  S.lasers = L.lasers.map((l) => ({ id: l.id, off: false, on: true }));
}

export const cameraActive = (L, S, i) => {
  const c = S.cameras[i], def = L.cameras[i];
  return !c.disabled && c.looped <= 0 && (!def.circuit || S.circuits[def.circuit]);
};

export function laserTiles(def) {
  if (def.tiles) return def.tiles;
  const out = [];
  const [dx, dy] = def.dir === 'v' ? [0, 1] : [1, 0];
  for (let k = 0; k < (def.len ?? 1); k++) out.push([def.x + dx * k, def.y + dy * k]);
  return out;
}

export function laserActive(L, S, i) {
  const l = S.lasers[i], def = L.lasers[i];
  if (l.off || (def.circuit && !S.circuits[def.circuit])) return false;
  if (def.period) return (S.tick + (def.phase ?? 0)) % def.period < (def.onTicks ?? def.period >> 1);
  return true;
}

export function cameraFacing(def, tick) {
  const base = dirAngle(def.facing);
  const sweep = def.sweep ?? 0;
  if (!sweep) return base;
  const period = def.period ?? 160;
  // Triangle wave across [-sweep, +sweep], deterministic from the tick.
  const p = tick % period;
  const half = period >> 1;
  const u = p < half ? p : period - p;            // 0..half..0
  return (base - sweep + Math.trunc((2 * sweep * u) / half)) & 255;
}

export function updateSecurity(sim) {
  const { L, S } = sim;

  // Cameras.
  S.cameras.forEach((c, i) => {
    const def = L.cameras[i];
    if (c.looped > 0) c.looped--;
    if (c.looped <= 0) c.facing = cameraFacing(def, S.tick); // a looped feed freezes in place
    c.seeing = -1;
    if (!cameraActive(L, S, i)) { c.sus = 0; return; }
    const range = (def.range ?? 6) * SUB;
    for (const a of S.actors) {
      if (a.escaped) continue;
      const dx = a.x - c.x, dy = a.y - c.y;
      if (inCone(c.facing, def.half ?? CAM_HALF, range, dx, dy) && losClear(L, S, c.x, c.y, a.x, a.y)) {
        c.seeing = a.i;
        break;
      }
    }
    if (c.seeing >= 0) {
      const a = S.actors[c.seeing];
      c.sus += dist(a.x - c.x, a.y - c.y) < range >> 1 ? 3 : 2;
      if (c.sus >= CAM_ALARM) sim.raiseAlarm(`Camera ${c.id} saw the ${a.role}`, a.x, a.y, c.id);
    } else if (c.sus > 0) c.sus--;
  });

  // Lasers.
  S.lasers.forEach((l, i) => {
    l.on = laserActive(L, S, i);
    if (!l.on) return;
    for (const [tx, ty] of laserTiles(L.lasers[i])) {
      for (const a of S.actors) {
        if (!a.escaped && boxOverlapsTile(a.x, a.y, tx, ty, 40)) {
          sim.raiseAlarm(`The ${a.role} tripped laser ${l.id}`, a.x, a.y, l.id);
          return;
        }
      }
    }
  });

  // A cut circuit gets noticed: after a delay a guard is sent to fix it (see guards.js).
  S.powerboxes.forEach((pb, i) => {
    const def = L.powerboxes[i];
    if (pb.cutAt >= 0 && !pb.dispatched && S.tick - pb.cutAt >= (def.response ?? 240)) {
      pb.dispatched = true;
      pb.needsFix = true;
    }
  });
}
