// Procedural heists: a seeded building generator plus a solvability check.
//
// generateHeist(seed, tier) lays out a grid of rooms joined by archways, puts the
// van in the left column and the target in the dead-end room furthest from it
// (behind a door: plain at tier 1, locked with a keycard / terminal / lockpick
// option from tier 2), then adds patrolling guards and sweeping cameras.
//
// makeJob(seed, tier) keeps generating until planSolo() (planner.js) finds a
// solo Ghost plan that the real simulation confirms. Every job it hands out is
// therefore beatable by one sneaking crew member; more crew just makes it easier.
import { planSolo } from './planner.js';

function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PLACES = ['Harbour Exchange', 'Meridian Bank', 'Vantablack Gallery', 'Old Mint', 'Kessler Auction House', 'Orchid Hotel', 'Ninth Street Jeweller', 'Aurum Depository', 'Cobalt Museum', 'Halcyon Casino', 'Lantern Pawn & Loan', 'Ivory Tower Offices'];
const LOOT = [['diamonds', 18000], ['gold bars', 22000], ['a Vermeer', 40000], ['bearer bonds', 30000], ['the ledger', 25000], ['a Fabergé egg', 50000], ['ruby necklace', 28000], ['prototype chip', 35000]];
const GUARDS = ['Ada', 'Bo', 'Cy', 'Dee', 'Eli', 'Flo', 'Gus', 'Hank', 'Iris', 'Jo', 'Kit', 'Lou', 'Max', 'Ned', 'Ola', 'Pip'];
const FACINGS = ['n', 'e', 's', 'w'];

export const TIERS = [
  null,
  { name: 'Easy', cols: [3, 4], rows: 2, guards: [1, 2], cameras: [0, 0], locked: false },
  { name: 'Medium', cols: [4, 4], rows: 2, guards: [2, 3], cameras: [0, 1], locked: true },
  { name: 'Hard', cols: [4, 5], rows: [2, 3], guards: [2, 4], cameras: [1, 2], locked: true },
];

export function generateHeist(seed, tier = 2) {
  const rnd = mulberry(seed * 7919 + tier);
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const span = (v) => (Array.isArray(v) ? ri(v[0], v[1]) : v);
  const T = TIERS[tier];

  const cols = span(T.cols), rows = span(T.rows);
  const colW = Array.from({ length: cols }, () => ri(5, 7));
  const rowH = Array.from({ length: rows }, () => ri(3, 4));
  const x0 = [], y0 = [];
  let acc = 1;
  for (let c = 0; c < cols; c++) { x0.push(acc); acc += colW[c] + 1; }
  const W = acc;
  acc = 1;
  for (let r = 0; r < rows; r++) { y0.push(acc); acc += rowH[r] + 1; }
  const H = acc;

  const grid = Array.from({ length: H }, () => Array(W).fill('#'));
  const cells = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    cells.push({ c, r, x: x0[c], y: y0[r], w: colW[c], h: rowH[r] });
    for (let y = 0; y < rowH[r]; y++) for (let x = 0; x < colW[c]; x++) grid[y0[r] + y][x0[c] + x] = '.';
  }
  const cellAt = (c, r) => cells[r * cols + c];
  const nbrs = (k) => {
    const { c, r } = cells[k], out = [];
    if (c > 0) out.push(k - 1);
    if (c < cols - 1) out.push(k + 1);
    if (r > 0) out.push(k - cols);
    if (r < rows - 1) out.push(k + cols);
    return out;
  };

  // Van in the left column; target in the room furthest away.
  const van = cellAt(0, ri(0, rows - 1)), vanK = cells.indexOf(van);
  const hop = new Array(cells.length).fill(-1);
  hop[vanK] = 0;
  const q = [vanK];
  while (q.length) { const k = q.shift(); for (const n of nbrs(k)) if (hop[n] < 0) { hop[n] = hop[k] + 1; q.push(n); } }
  const far = Math.max(...hop);
  const lootK = pick(cells.map((_, k) => k).filter((k) => hop[k] === far));

  // Random spanning tree over every other room, then a few loops for alternate routes.
  const edges = new Set();
  const key = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const inTree = new Set([vanK]);
  const frontier = () => [...inTree].flatMap((k) => nbrs(k).filter((n) => n !== lootK && !inTree.has(n)).map((n) => [k, n]));
  for (let f = frontier(); f.length; f = frontier()) {
    const [a, b] = pick(f);
    edges.add(key(a, b));
    inTree.add(b);
  }
  for (let k = 0; k < cells.length; k++) for (const n of nbrs(k)) {
    if (k < n && k !== lootK && n !== lootK && rnd() < 0.3) edges.add(key(k, n));
  }
  const lootParent = pick(nbrs(lootK).filter((n) => hop[n] === far - 1));

  const opening = (a, b) => {
    const A = cells[Math.min(a, b)], B = cells[Math.max(a, b)];
    if (A.r === B.r) return [A.x + A.w, A.y + ri(0, A.h - 1)];
    return [A.x + ri(0, Math.min(A.w, B.w) - 1), A.y + A.h];
  };
  const gaps = [];
  for (const e of edges) {
    const [a, b] = e.split('-').map(Number);
    const [x, y] = opening(a, b);
    grid[y][x] = '.';
    gaps.push([x, y]);
  }
  const [dx, dy] = opening(lootK, lootParent);
  grid[dy][dx] = '.';
  gaps.push([dx, dy]);
  const nearGap = (x, y) => gaps.some(([gx, gy]) => Math.abs(gx - x) + Math.abs(gy - y) <= 1);

  // Van and spawn.
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) grid[van.y + y][van.x + x] = 'E';
  grid[van.y + 2][van.x] = 'S';
  grid[van.y + 2][van.x + 1] = 'S';

  const used = new Set();
  const freeTile = (cell, clearOfGaps = false) => {
    for (let tries = 0; tries < 50; tries++) {
      const x = cell.x + ri(0, cell.w - 1);
      const y = cell.y + ri(0, cell.h - 1);
      if (clearOfGaps && nearGap(x, y)) continue;
      if (grid[y][x] === '.' && !used.has(`${x},${y}`)) { used.add(`${x},${y}`); return [x, y]; }
    }
    return null;
  };

  const lootCell = cells[lootK];
  const [lootName, lootValue] = pick(LOOT);
  const place = pick(PLACES);
  const ents = [];
  const lock = T.locked;
  ents.push({ type: 'door', id: 'vault door', x: dx, y: dy, ...(lock ? { locked: 'red' } : {}) });
  const [lx, ly] = freeTile(lootCell);
  ents.push({ type: 'loot', id: lootName, x: lx, y: ly, value: lootValue, required: true });

  const middle = cells.map((_, k) => k).filter((k) => k !== vanK && k !== lootK);
  if (lock) {
    const [kx, ky] = freeTile(cells[pick(middle)]);
    ents.push({ type: 'key', id: 'red keycard', color: 'red', x: kx, y: ky });
    if (rnd() < 0.6) {
      const [tx, ty] = freeTile(cells[pick(middle)]);
      ents.push({ type: 'terminal', id: 'office pc', x: tx, y: ty, actions: [{ do: 'unlock', door: 'vault door' }] });
    }
  }

  // Guards patrol between spots in the middle rooms.
  const names = [...GUARDS];
  const nGuards = span(T.guards);
  const linked = (a, b) => edges.has(key(a, b));
  for (let g = 0; g < nGuards; g++) {
    // A beat: the guard's home room plus, sometimes, one room joined to it.
    const home = pick(middle);
    const beat = [home, ...middle.filter((k) => k !== home && linked(home, k))].slice(0, 1 + (rnd() < 0.6 ? 1 : 0));
    if (beat.length > 1) beat[1] = pick(middle.filter((k) => k !== home && linked(home, k)));
    const route = [];
    const stops = rnd() < 0.15 ? 1 : ri(2, 3);
    for (let s = 0; s < stops; s++) {
      const p = freeTile(cells[beat[s % beat.length]], true);
      if (p) route.push([p[0], p[1], stops === 1 ? 9999 : ri(30, 140), pick(FACINGS)]);
    }
    if (!route.length) continue;
    const name = names.splice(Math.floor(rnd() * names.length), 1)[0];
    ents.push({ type: 'guard', id: name, x: route[0][0], y: route[0][1], facing: route[0][3], route });
  }

  // Cameras on a wall of a middle room, looking into it.
  const nCams = span(T.cameras);
  for (let i = 0; i < nCams; i++) {
    const cell = cells[pick(middle)];
    const top = rnd() < 0.5;
    const x = cell.x + ri(1, cell.w - 2), y = top ? cell.y : cell.y + cell.h - 1;
    if (used.has(`${x},${y}`)) continue;
    used.add(`${x},${y}`);
    ents.push({ type: 'camera', id: `C${i + 1}`, x, y, facing: top ? 's' : 'n', sweep: ri(28, 44), period: ri(100, 170), range: 6 });
  }

  return {
    id: `job-${tier}-${seed}`,
    name: place,
    brief: `${place}. The ${lootName} ${lock ? 'sit behind a keycard door' : 'sit in the back room'}. ${nGuards} guard${nGuards > 1 ? 's' : ''} on shift${nCams ? `, ${nCams} camera${nCams > 1 ? 's' : ''}` : ''}.`,
    tips: lock ? ['The keycard opens the vault door. A Hacker can unlock it from a terminal if there is one; a Cracker can pick it.'] : [],
    loopSeconds: 120,
    maxCrew: 3,
    roles: ['ghost', 'hacker', 'cracker', 'muscle'],
    procedural: { seed, tier },
    map: grid.map((row) => row.join('')),
    entities: ents,
  };
}

// A guaranteed-solvable job. Deterministic for a given (seed, tier).
export function makeJob(seed, tier = 2, maxAttempts = 120) {
  for (let i = 0; i < maxAttempts; i++) {
    const def = generateHeist(seed * 64 + i, tier);
    const plan = planSolo(def);
    if (plan) {
      def.id = `job-${tier}-${seed}`;
      def.par = { crew: 1, seconds: Math.ceil(plan.ticks / 20) + 5 };
      def.solution = [{ role: 'ghost', cmds: plan.cmds }];
      return def;
    }
  }
  return null;
}
