// Guard AI: patrol routes, vision cones, hearing, suspicion, investigation,
// door use, restoring cut power and radio check-ins.
//
// Guards are fully deterministic, so a change made by a later crew member
// (a whistle, an opened door, a cut circuit) ripples into what every guard
// does, and so into what earlier clones run into.
import { SUB, tileCenter, toTile, dist, idiv, angleTo, turnToward, inCone } from './fixed.js';
import { T, tileAt } from './level.js';
import { losClear, doorAtTile, boxOverlapsTile } from './world.js';
import { HOLD } from './constants.js';
import { dirAngle } from './security.js';

export const G_RANGE = SUB * 7;
export const G_HALF = 30;            // ~42 degrees each side
export const G_CLOSE = SUB + 96;     // notices anyone this close, any direction
export const SUS_ALARM = 22;
export const SUS_INVESTIGATE = 6;
const PATROL_SPEED = 20;
const ALERT_SPEED = 30;
const TURN = 14;

export function initGuards(L, S) {
  S.guards = L.guards.map((g) => {
    const route = g.route?.length ? g.route : [[g.x, g.y, 0, g.facing]];
    return {
      id: g.id,
      x: tileCenter(g.x), y: tileCenter(g.y),
      facing: dirAngle(g.facing ?? route[0][3] ?? 'e'),
      state: 'patrol', wp: 0, wait: 0, path: [], goal: -1,
      sus: 0, seeing: -1, lastX: 0, lastY: 0, look: 0, hold: 0, task: -1,
      carriedBy: -1, koAt: -1, opened: [],
    };
  });
  S.radioMissed = false;
}

const walkable = (L, tx, ty) => {
  const t = tileAt(L, tx, ty);
  return t === T.FLOOR || t === T.EXIT;
};

// BFS over tiles (4-way). Returns tile indices from the step after `from` up to `to`.
export function findPath(L, fromIdx, toIdx) {
  if (fromIdx === toIdx) return [];
  const n = L.w * L.h;
  const prev = new Int32Array(n).fill(-1);
  prev[fromIdx] = fromIdx;
  const q = [fromIdx];
  for (let h = 0; h < q.length; h++) {
    const c = q[h];
    if (c === toIdx) break;
    const cx = c % L.w, cy = (c / L.w) | 0;
    const nb = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
    for (const [nx, ny] of nb) {
      if (nx < 0 || ny < 0 || nx >= L.w || ny >= L.h) continue;
      const ni = ny * L.w + nx;
      if (prev[ni] !== -1 || !walkable(L, nx, ny)) continue;
      prev[ni] = c;
      q.push(ni);
    }
  }
  if (prev[toIdx] === -1) return null;
  const path = [];
  for (let c = toIdx; c !== fromIdx; c = prev[c]) path.push(c);
  return path.reverse();
}

const tileIdx = (L, x, y) => toTile(y) * L.w + toTile(x);

// Nearest walkable tile to (x,y) in sub-units (the spot itself if walkable).
function walkableNear(L, x, y) {
  const tx = toTile(x), ty = toTile(y);
  if (walkable(L, tx, ty)) return ty * L.w + tx;
  for (let r = 1; r < 4; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++)
        if (walkable(L, tx + dx, ty + dy)) return (ty + dy) * L.w + tx + dx;
  return ty * L.w + tx;
}

function setGoal(sim, g, goalIdx) {
  if (g.goal === goalIdx && g.path.length) return;
  g.goal = goalIdx;
  g.path = findPath(sim.L, tileIdx(sim.L, g.x, g.y), goalIdx) ?? [];
}

// Advance along the path; returns true once at the goal tile centre.
function walk(sim, g, speed) {
  const { L, S } = sim;
  if (!g.path.length) {
    const gx = tileCenter(g.goal % L.w), gy = tileCenter((g.goal / L.w) | 0);
    return moveToward(g, gx, gy, speed);
  }
  const next = g.path[0];
  const nx = next % L.w, ny = (next / L.w) | 0;
  const door = doorAtTile(L, S, nx, ny);
  if (door && !door.open) {
    door.open = true; // guards carry keys; they open and later re-close
    g.opened.push(L.doors.findIndex((d) => d.id === door.id));
    sim.S.log.push({ t: S.tick, k: 'guard-door', a: -1, id: `${g.id}:${door.id}` });
  }
  if (moveToward(g, tileCenter(nx), tileCenter(ny), speed)) g.path.shift();
  return false;
}

function moveToward(g, tx, ty, speed) {
  const dx = tx - g.x, dy = ty - g.y;
  const d = dist(dx, dy);
  if (d <= speed) { g.x = tx; g.y = ty; return true; }
  g.x += idiv(dx * speed, d);
  g.y += idiv(dy * speed, d);
  g.facing = turnToward(g.facing, angleTo(dx, dy), TURN);
  return false;
}

function closeOpenedDoors(sim, g) {
  const { L, S } = sim;
  g.opened = g.opened.filter((di) => {
    const def = L.doors[di];
    const near = Math.abs(toTile(g.x) - def.x) + Math.abs(toTile(g.y) - def.y) <= 1;
    if (near) return true;
    const busy = S.actors.some((a) => !a.escaped && boxOverlapsTile(a.x, a.y, def.x, def.y)) ||
      S.guards.some((o) => o.carriedBy < 0 && boxOverlapsTile(o.x, o.y, def.x, def.y));
    if (busy) return true;
    S.doors[di].open = false;
    return false;
  });
}

// Can guard g see point (x,y)?
export function guardSees(sim, g, x, y) {
  const dx = x - g.x, dy = y - g.y;
  const d = dist(dx, dy);
  if (d > G_RANGE) return false;
  if (d > G_CLOSE && !inCone(g.facing, G_HALF, G_RANGE, dx, dy)) return false;
  return losClear(sim.L, sim.S, g.x, g.y, x, y);
}

function investigate(sim, g, x, y, urgent) {
  g.state = 'investigate';
  g.urgent = urgent;
  g.lastX = x; g.lastY = y;
  g.goal = -1;
  setGoal(sim, g, walkableNear(sim.L, x, y));
}

export function updateGuards(sim) {
  const { L, S } = sim;

  // Hand out repair jobs for cut circuits to the closest free guard.
  S.powerboxes.forEach((pb, bi) => {
    if (!pb.needsFix || pb.assigned) return;
    const def = L.powerboxes[bi];
    let best = -1, bestD = Infinity;
    S.guards.forEach((g, gi) => {
      if (g.state === 'ko' || g.state === 'restore') return;
      const d = Math.abs(toTile(g.x) - def.x) + Math.abs(toTile(g.y) - def.y);
      if (d < bestD) { bestD = d; best = gi; }
    });
    if (best >= 0) {
      const g = S.guards[best];
      pb.assigned = true;
      g.state = 'restore'; g.task = bi; g.hold = 0; g.goal = -1;
      setGoal(sim, g, walkableNear(L, tileCenter(def.x), tileCenter(def.y)));
    }
  });

  for (const g of S.guards) {
    if (g.state === 'ko') {
      if (g.carriedBy >= 0) { const a = S.actors[g.carriedBy]; g.x = a.x; g.y = a.y; }
      continue;
    }
    perceive(sim, g);
    if (S.alarm) return;
    act(sim, g);
    closeOpenedDoors(sim, g);
  }

  // Radio check-ins: a guard who's out cold misses theirs.
  if (L.radioInterval > 0 && S.tick > 0 && S.tick % L.radioInterval === 0) {
    const out = S.guards.find((g) => g.state === 'ko');
    if (out) sim.raiseAlarm(`${out.id} missed a radio check-in`, out.x, out.y, out.id);
  }
}

function perceive(sim, g) {
  const { S } = sim;
  // Crew in view?
  let seen = -1, seenD = Infinity;
  for (const a of S.actors) {
    if (a.escaped) continue;
    if (guardSees(sim, g, a.x, a.y)) {
      const d = dist(a.x - g.x, a.y - g.y);
      if (d < seenD) { seenD = d; seen = a.i; }
    }
  }
  g.seeing = seen;
  if (seen >= 0) {
    const a = S.actors[seen];
    const gain = 1 + idiv(3 * (G_RANGE - seenD), G_RANGE) + (seenD <= G_CLOSE ? 4 : 0) + (a.carrying >= 0 || a.body >= 0 ? 1 : 0);
    g.sus += gain;
    g.lastX = a.x; g.lastY = a.y;
    g.facing = turnToward(g.facing, angleTo(a.x - g.x, a.y - g.y), TURN);
    if (g.sus >= SUS_ALARM) {
      sim.raiseAlarm(`${g.id} spotted the ${a.role}`, a.x, a.y, g.id);
      return;
    }
    if (g.sus >= SUS_INVESTIGATE && g.state !== 'investigate' && g.state !== 'restore') investigate(sim, g, a.x, a.y, true);
  } else if (g.sus > 0 && (S.tick & 1)) g.sus--;

  // Bodies.
  for (const o of S.guards) {
    if (o === g || o.state !== 'ko' || o.carriedBy >= 0) continue;
    if (guardSees(sim, g, o.x, o.y)) {
      sim.raiseAlarm(`${g.id} found ${o.id} knocked out`, o.x, o.y, g.id);
      return;
    }
  }

  // Noises made this tick.
  if (g.state === 'restore') return;
  for (const n of S.noises) {
    const d = dist(n.x - g.x, n.y - g.y);
    const r = losClear(sim.L, S, g.x, g.y, n.x, n.y) ? n.r : n.r >> 1;
    if (d <= r) {
      if (g.state !== 'investigate' || n.kind !== 'step') investigate(sim, g, n.x, n.y, n.kind !== 'step');
      break;
    }
  }
}

function act(sim, g) {
  const { L, S } = sim;
  const route = L.guards[S.guards.indexOf(g)].route;
  const pts = route?.length ? route : null;
  switch (g.state) {
    case 'patrol': {
      if (!pts) { // stationary post
        const def = L.guards[S.guards.indexOf(g)];
        const home = toTile(g.y) === def.y && toTile(g.x) === def.x;
        if (!home) { setGoal(sim, g, def.y * L.w + def.x); walk(sim, g, PATROL_SPEED); return; }
        g.x = tileCenter(def.x); g.y = tileCenter(def.y);
        const base = dirAngle(def.facing ?? 'e');
        if (def.scan) {
          const p = S.tick % (def.scanPeriod ?? 120), h = (def.scanPeriod ?? 120) >> 1;
          const u = p < h ? p : (def.scanPeriod ?? 120) - p;
          g.facing = turnToward(g.facing, (base - def.scan + idiv(2 * def.scan * u, h)) & 255, TURN);
        } else g.facing = turnToward(g.facing, base, TURN);
        return;
      }
      const [wx, wy] = pts[g.wp];
      setGoal(sim, g, wy * L.w + wx);
      if (walk(sim, g, PATROL_SPEED)) {
        g.state = 'wait';
        g.wait = pts[g.wp][2] ?? 0;
      }
      return;
    }
    case 'wait': {
      const f = pts?.[g.wp]?.[3];
      if (f != null) g.facing = turnToward(g.facing, dirAngle(f), TURN);
      if (g.wait-- <= 0) {
        g.wp = (g.wp + 1) % pts.length;
        g.state = 'patrol';
      }
      return;
    }
    case 'investigate': {
      if (walk(sim, g, g.urgent ? ALERT_SPEED : PATROL_SPEED)) {
        g.state = 'search';
        g.look = 70;
      }
      return;
    }
    case 'search': {
      g.facing = (g.facing + (((S.tick / 35) | 0) % 2 ? -5 : 5)) & 255;
      if (--g.look <= 0) { g.state = 'patrol'; g.goal = -1; g.urgent = false; }
      return;
    }
    case 'restore': {
      if (!walk(sim, g, ALERT_SPEED)) return;
      const def = L.powerboxes[g.task];
      g.facing = turnToward(g.facing, angleTo(tileCenter(def.x) - g.x, tileCenter(def.y) - g.y), TURN);
      if (++g.hold >= HOLD.restorePower) {
        S.circuits[def.circuit] = true;
        const pb = S.powerboxes[g.task];
        pb.cutAt = -1; pb.dispatched = false; pb.needsFix = false; pb.assigned = false;
        S.log.push({ t: S.tick, k: 'power-restored', a: -1, id: `${g.id}:${pb.id}` });
        g.state = 'patrol'; g.goal = -1; g.task = -1;
      }
      return;
    }
  }
}
