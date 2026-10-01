// Solvability check for generated heists: plans a solo, sneaking Ghost run
// (keycard → vault door → loot → van) and confirms it in the real simulation.
//
// 1. Dry run: play the loop with nobody inside and record, for every time slice,
//    which tiles a guard (with the sneaking close-sense) or a camera can see.
//    The ghost is silent while sneaking, so guards behave the same as long as
//    she stays unseen.
// 2. Time-expanded BFS over (phase, tile, time slice): stay, step to a
//    neighbour, or use the thing here. Earliest arrival wins, so the plan
//    hides, doubles back and waits out patrols as needed.
// 3. Turn the route into Bot commands keyed to absolute ticks and replay it.
import { parseLevel, T, tileAt } from '../sim/level.js';
import { Sim } from '../sim/sim.js';
import { Bot, runBot } from '../sim/bot.js';
import { SUB, tileCenter, inCone } from '../sim/fixed.js';
import { guardSees, G_RANGE } from '../sim/guards.js';
import { losClear } from '../sim/world.js';
import { CAM_HALF } from '../sim/security.js';

const U = 5;              // ticks per time slice
const STEP = 2;           // slices per tile, sneaking (ghost: ~9.9 ticks)
const STEP_CARRY = 3;     // slices per tile while carrying (~13.1 ticks)
const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

const passable = (L, x, y) => { const t = tileAt(L, x, y); return t === T.FLOOR || t === T.EXIT; };

// watched[u][tile] = 1 if the tile is seen at any tick in slice u (± one slice).
export function watchMap(L) {
  const sim = new Sim(L, [{ role: 'ghost', rec: null }]);
  const n = L.w * L.h, slices = Math.ceil(L.loopTicks / U) + 4;
  const raw = Array.from({ length: slices }, () => new Uint8Array(n));
  const tiles = [];
  for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) if (passable(L, x, y)) tiles.push([x, y, y * L.w + x]);
  for (let t = 0; t < L.loopTicks; t++) {
    const row = raw[Math.floor(t / U)];
    const S = sim.S;
    for (const [x, y, k] of tiles) {
      if (row[k]) continue;
      const px = tileCenter(x), py = tileCenter(y);
      for (const g of S.guards) {
        if (g.state === 'ko' || Math.abs(px - g.x) > G_RANGE || Math.abs(py - g.y) > G_RANGE) continue;
        if (guardSees(sim, g, px, py, true)) { row[k] = 1; break; }
      }
      if (row[k]) continue;
      S.cameras.forEach((c, i) => {
        const def = L.cameras[i];
        if (!row[k] && inCone(c.facing, def.half ?? CAM_HALF, (def.range ?? 6) * SUB, px - c.x, py - c.y) && losClear(L, S, c.x, c.y, px, py)) row[k] = 1;
      });
    }
    sim.step(0);
  }
  return raw.map((row, u) => {
    const out = row.slice();
    for (const v of [raw[u - 1], raw[u + 1]]) if (v) for (let k = 0; k < n; k++) out[k] |= v[k];
    return out;
  });
}

export function planSolo(def) {
  const L = parseLevel(def);
  const door = L.doors.find((d) => d.id === 'vault door');
  const loot = L.items.find((it) => it.type === 'loot');
  const key = L.items.find((it) => it.type === 'key');
  const W = L.w, n = W * L.h;
  const doorK = door.y * W + door.x, lootK = loot.y * W + loot.x, keyK = key ? key.y * W + key.x : -1;
  const watched = watchMap(L);
  const slices = watched.length - 2;

  // Phases: 0 fetch keycard, 1 open the door, 2 take the loot, 3 get out.
  const P = 4;
  const idx = (p, k, u) => (u * P + p) * n + k;
  const parent = new Int32Array(P * n * (slices + 1)).fill(-2);
  const buckets = Array.from({ length: slices + 1 }, () => []);
  const [sx, sy] = L.spawns[0];
  const start = idx(key ? 0 : 1, sy * W + sx, 0);
  parent[start] = -1;
  buckets[0].push(start);
  const safe = (k, u0, u1) => { if (u1 > slices) return false; for (let u = u0; u <= u1; u++) if (watched[u][k]) return false; return true; };
  const visit = (from, p, k, u) => {
    if (u > slices) return;
    const s = idx(p, k, u);
    if (parent[s] !== -2) return;
    parent[s] = from;
    buckets[u].push(s);
  };

  let goal = -1;
  for (let u = 0; u < slices && goal < 0; u++) {
    for (const s of buckets[u]) {
      const k = s % n, p = Math.floor(s / n) % P;
      const x = k % W, y = Math.floor(k / W);
      if (p === 3 && tileAt(L, x, y) === T.EXIT) { goal = s; break; }
      // use the thing here
      if (p === 0 && k === keyK && safe(k, u, u + 1)) visit(s, 1, k, u + 1);
      if (p === 1 && Math.abs(x - door.x) + Math.abs(y - door.y) === 1 && safe(k, u, u + 1)) visit(s, 2, k, u + 1);
      if (p === 2 && k === lootK && safe(k, u, u + 1)) visit(s, 3, k, u + 1);
      // stay put
      if (safe(k, u + 1, u + 1)) visit(s, p, k, u + 1);
      // step to a neighbour
      const d = p === 3 ? STEP_CARRY : STEP;
      for (const [dx, dy] of DIRS4) {
        const nx = x + dx, ny = y + dy, nk = ny * W + nx;
        if (!passable(L, nx, ny)) continue;
        if (nk === doorK && p < 2) continue;
        if (safe(k, u, u + d - 1) && safe(nk, u + 1, u + d)) visit(s, p, nk, u + d);
      }
    }
  }
  if (goal < 0) return null;

  // Unwind into commands keyed to absolute ticks.
  const chain = [];
  for (let s = goal; s >= 0; s = parent[s]) chain.push(s);
  chain.reverse();
  const cmds = [];
  for (let i = 1; i < chain.length; i++) {
    const a = chain[i - 1], b = chain[i];
    const ua = Math.floor(a / (n * P)), ka = a % n, pa = Math.floor(a / n) % P;
    const kb = b % n, pb = Math.floor(b / n) % P;
    if (pb !== pa) cmds.push({ until: ua * U }, { use: true });
    else if (kb !== ka) cmds.push({ until: ua * U }, { to: [kb % W, Math.floor(kb / W)], sneak: true });
  }
  cmds.push({ use: true });

  const check = new Sim(L, [{ role: 'ghost', rec: null }]);
  runBot(check, new Bot(cmds), L.loopTicks + 10);
  if (check.S.over?.kind !== 'success') return null;
  return { cmds, ticks: check.S.tick };
}
