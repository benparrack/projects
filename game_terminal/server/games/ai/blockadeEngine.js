// Blockade (Lakeside, 1975) rules + bot. 11x14 board; each side has two pawns starting on its
// two home squares, which are the OTHER side's goals. A turn = move one pawn 1 or 2 orthogonal
// steps (can pass over pawns, can't cross walls, can't end on a pawn unless it's a goal = win),
// then place one 2-long wall (9 horizontal + 9 vertical each) if you have any left. A wall may
// never cross/overlap another or cut any pawn off from both of its goals.
// Walls live in two flag arrays indexed by groove corner k = r*(COLS-1)+c: H[k] blocks between
// rows r/r+1 over cols c..c+1; V[k] blocks between cols c/c+1 over rows r..r+1.

'use strict';

const COLS = 11;
const ROWS = 14;
const N = COLS * ROWS;
const WC = COLS - 1;
const WN = (ROWS - 1) * WC;
const WALLS_EACH = 9;
const at = (r, c) => r * COLS + c;
const START = { p1: [at(10, 3), at(10, 7)], p2: [at(3, 3), at(3, 7)] };
const GOALS = { p1: START.p2, p2: START.p1 };
const other = (s) => (s === 'p1' ? 'p2' : 'p1');

function emptyWalls() {
  return { H: new Array(WN).fill(0), V: new Array(WN).fill(0) };
}

// Neighbours of cell i reachable in one step given walls.
function steps(W, i) {
  const r = Math.floor(i / COLS);
  const c = i % COLS;
  const out = [];
  const h = (rr, cc) => cc >= 0 && cc < WC && W.H[rr * WC + cc];
  const v = (rr, cc) => rr >= 0 && rr < ROWS - 1 && W.V[rr * WC + cc];
  if (r > 0 && !h(r - 1, c) && !h(r - 1, c - 1)) out.push(i - COLS);
  if (r < ROWS - 1 && !h(r, c) && !h(r, c - 1)) out.push(i + COLS);
  if (c > 0 && !v(r, c - 1) && !v(r - 1, c - 1)) out.push(i - 1);
  if (c < COLS - 1 && !v(r, c) && !v(r - 1, c)) out.push(i + 1);
  return out;
}

// Step distance from every cell to the nearest of `goals` (Infinity if walled off).
function distMap(W, goals) {
  const d = new Array(N).fill(Infinity);
  const q = [];
  for (const g of goals) { d[g] = 0; q.push(g); }
  for (let h = 0; h < q.length; h++) {
    for (const j of steps(W, q[h])) if (d[j] === Infinity) { d[j] = d[q[h]] + 1; q.push(j); }
  }
  return d;
}

function wallFits(W, o, r, c) {
  if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= ROWS - 1 || c < 0 || c >= WC) return false;
  const k = r * WC + c;
  if (W.H[k] || W.V[k]) return false;
  if (o === 'h') return !(c > 0 && W.H[k - 1]) && !(c < WC - 1 && W.H[k + 1]);
  if (o === 'v') return !(r > 0 && W.V[k - WC]) && !(r < ROWS - 2 && W.V[k + WC]);
  return false;
}

const withWall = (W, o, r, c) => {
  const n = { H: W.H.slice(), V: W.V.slice() };
  n[o === 'h' ? 'H' : 'V'][r * WC + c] = 1;
  return n;
};

// Both sides' distance maps if every pawn still has a way home, else null.
function mapsIfOpen(W, pawns) {
  const d1 = distMap(W, GOALS.p1);
  if (pawns.p1.some((p) => d1[p] === Infinity)) return null;
  const d2 = distMap(W, GOALS.p2);
  if (pawns.p2.some((p) => d2[p] === Infinity)) return null;
  return { p1: d1, p2: d2 };
}

function wallLegal(W, pawns, o, r, c) {
  return wallFits(W, o, r, c) && !!mapsIfOpen(withWall(W, o, r, c), pawns);
}

// Cells pawn `idx` of `seat` can end on: 1 or 2 steps, not on a pawn unless it's a goal.
function pawnTargets(W, pawns, seat, idx) {
  const from = pawns[seat][idx];
  const occupied = new Set([...pawns.p1, ...pawns.p2]);
  const out = new Set();
  for (const a of steps(W, from)) {
    out.add(a);
    for (const b of steps(W, a)) if (b !== from) out.add(b);
  }
  return [...out].filter((t) => !occupied.has(t) || GOALS[seat].includes(t));
}

const isGoal = (seat, cell) => GOALS[seat].includes(cell);
const wallsTotal = (left) => left.h + left.v;

// ---- bot ----

const LEVEL = {
  easy: { noise: 6, randomWall: 1, reply: 0 },
  medium: { noise: 2, randomWall: 0.5, reply: 0 },
  hard: { noise: 0.8, randomWall: 0, reply: 0 },
  expert: { noise: 0.3, randomWall: 0, reply: 8, wide: true, minimax: true },
};
const GREEDY = { noise: 0, randomWall: 0, reply: 0 };

// From `seat`'s view right after its turn (opponent moves next). Moves cover up to 2 steps.
function evalFor(seat, maps, pawns, left, wide) {
  const opp = other(seat);
  if (wide) {
    // Also value the backup pawn: cutting a lone runner is worth less if the other is close.
    const spare = (s) => Math.max(...pawns[s].map((p) => maps[s][p]));
    return evalFor(seat, maps, pawns, left) + 0.25 * (Math.min(spare(opp), 40) - Math.min(spare(seat), 40));
  }
  const myD = Math.min(...pawns[seat].map((p) => maps[seat][p]));
  if (myD === 0) return 1e6;
  const oppD = Math.min(...pawns[opp].map((p) => maps[opp][p]));
  const myT = Math.ceil(myD / 2);
  const oppT = Math.ceil(oppD / 2);
  return (oppT - myT) * 10 + (oppD - myD) + (oppT <= myT ? -15 : 0) + 0.4 * (wallsTotal(left[seat]) - wallsTotal(left[opp]));
}

// Walls that cut an edge on some shortest path of `seat`'s closest pawn(s).
function attackWalls(W, map, pawns, seat, wide) {
  const best = Math.min(...pawns[seat].map((p) => map[p]));
  const seen = new Set();
  const out = [];
  const add = (o, r, c) => {
    const key = `${o}${r},${c}`;
    if (seen.has(key) || !wallFits(W, o, r, c)) return;
    seen.add(key);
    out.push({ o, r, c });
  };
  const q = pawns[seat].filter((p) => wide || map[p] === best);
  const vis = new Set(q);
  for (let h = 0; h < q.length; h++) {
    const u = q[h];
    for (const v of steps(W, u)) {
      if (map[v] !== map[u] - 1) continue;
      const ur = Math.floor(u / COLS);
      const uc = u % COLS;
      const vr = Math.floor(v / COLS);
      const vc = v % COLS;
      if (ur !== vr) { const r = Math.min(ur, vr); add('h', r, uc); add('h', r, uc - 1); }
      else { const c = Math.min(uc, vc); add('v', ur, c); add('v', ur - 1, c); }
      if (!vis.has(v)) { vis.add(v); q.push(v); }
    }
  }
  return out;
}

function allFittingWalls(W) {
  const out = [];
  for (const o of ['h', 'v']) for (let r = 0; r < ROWS - 1; r++) for (let c = 0; c < WC; c++) if (wallFits(W, o, r, c)) out.push({ o, r, c });
  return out;
}

// Every (pawn move, wall) combo worth considering for `seat`, scored 1-ply.
function scoredTurns(g, seat, cfg, rng) {
  const opp = other(seat);
  const res = [];
  for (let idx = 0; idx < 2; idx++) {
    for (const to of pawnTargets(g.walls, g.pawns, seat, idx)) {
      const pawns = { ...g.pawns, [seat]: g.pawns[seat].map((p, j) => (j === idx ? to : p)) };
      const move = { pawn: idx, to };
      if (isGoal(seat, to)) return [{ move, wall: null, score: 1e9 }];
      const base = mapsIfOpen(g.walls, pawns);
      const left = g.left[seat];
      if (!wallsTotal(left)) {
        res.push({ move, wall: null, score: evalFor(seat, base, pawns, g.left) + (cfg.noise ? rng() * cfg.noise : 0) });
        continue;
      }
      let walls = attackWalls(g.walls, base[opp], pawns, opp, cfg.wide).filter((w) => left[w.o] > 0);
      if (!walls.length || (cfg.randomWall && rng() < cfg.randomWall)) {
        const all = allFittingWalls(g.walls).filter((w) => left[w.o] > 0);
        walls = cfg.randomWall ? [all[Math.floor(rng() * all.length)]].filter(Boolean) : walls.length ? walls : all;
      }
      const before = res.length;
      for (const w of walls) {
        const W2 = withWall(g.walls, w.o, w.r, w.c);
        const maps = mapsIfOpen(W2, pawns);
        if (!maps) continue;
        const newLeft = { ...g.left, [seat]: { ...left, [w.o]: left[w.o] - 1 } };
        res.push({ move, wall: w, score: evalFor(seat, maps, pawns, newLeft, cfg.wide) + (cfg.noise ? rng() * cfg.noise : 0) });
      }
      // No usable candidate wall: keep the move; the server falls back to any legal wall.
      if (res.length === before) res.push({ move, wall: null, score: evalFor(seat, base, pawns, g.left) - 1 + (cfg.noise ? rng() * cfg.noise : 0) });
    }
  }
  return res;
}

const applyTurn = (g, seat, t) => {
  const pawns = { ...g.pawns, [seat]: g.pawns[seat].map((p, j) => (j === t.move.pawn ? t.move.to : p)) };
  if (!t.wall) return { ...g, pawns };
  return { pawns, walls: withWall(g.walls, t.wall.o, t.wall.r, t.wall.c), left: { ...g.left, [seat]: { ...g.left[seat], [t.wall.o]: g.left[seat][t.wall.o] - 1 } } };
};

// g = { pawns, walls, left }. Returns { move: {pawn, to}|null, wall: {o,r,c}|null }.
function bestTurn(g, seat, level, rng = Math.random) {
  const cfg = LEVEL[level] || LEVEL.hard;
  let turns = scoredTurns(g, seat, cfg, rng);
  if (!turns.length) return { move: null, wall: null };
  turns.sort((a, b) => b.score - a.score);
  if (cfg.reply && turns[0].score < 1e9) {
    // Re-rank the top few by the opponent's best 1-ply answer.
    const opp = other(seat);
    turns = turns.slice(0, cfg.reply).map((t) => {
      const g2 = applyTurn(g, seat, t);
      const replies = scoredTurns(g2, opp, GREEDY, rng);
      const worst = replies.length ? Math.max(...replies.map((x) => x.score)) : -1e9;
      return { ...t, score: worst >= 1e9 ? -1e9 + t.score : cfg.minimax ? -worst + t.score * 0.01 : t.score - worst * 0.5 };
    });
    turns.sort((a, b) => b.score - a.score);
  }
  return { move: turns[0].move, wall: turns[0].wall };
}

module.exports = {
  COLS, ROWS, N, WC, WN, WALLS_EACH, START, GOALS, other,
  emptyWalls, steps, distMap, wallFits, withWall, mapsIfOpen, wallLegal, pawnTargets, isGoal, bestTurn, LEVEL,
};
