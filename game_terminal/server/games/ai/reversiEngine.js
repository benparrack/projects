// Reversi engine: iterative-deepening negamax with alpha-beta, a positional + mobility + corner
// evaluation, and (Expert) an exact endgame solve over the last empties, all time-boxed. Board
// format matches server/games/reversi.js: board[r][c] is null | 'black' | 'white', r = 0 is top.

'use strict';

const N = 8;
const DIRS = [-9, -8, -7, -1, 1, 7, 8, 9];
// Column deltas for each direction, to stop walks wrapping across the board edge.
const DCOL = [-1, 0, 1, -1, 1, -1, 0, 1];

// Classic square weights: corners great, X/C squares next to an empty corner bad.
const W = [
  100, -20, 10, 5, 5, 10, -20, 100,
  -20, -50, -2, -2, -2, -2, -50, -20,
  10, -2, 1, 1, 1, 1, -2, 10,
  5, -2, 1, 0, 0, 1, -2, 5,
  5, -2, 1, 0, 0, 1, -2, 5,
  10, -2, 1, 1, 1, 1, -2, 10,
  -20, -50, -2, -2, -2, -2, -50, -20,
  100, -20, 10, 5, 5, 10, -20, 100,
];
const CORNERS = [0, 7, 56, 63];
// For each corner, its X square and two C squares (only bad while the corner is empty).
const CORNER_NEIGH = { 0: [9, 1, 8], 7: [14, 6, 15], 56: [49, 57, 48], 63: [54, 62, 55] };

// Search order: corners, then edges/inner by weight, X squares last.
const ORDER = Array.from({ length: 64 }, (_, i) => i).sort((a, b) => W[b] - W[a]);

const LEVELS = {
  easy: { kind: 'random' },
  medium: { kind: 'greedy' },
  hard: { kind: 'search', maxDepth: 4, timeMs: 400, solve: 0, noise: 6 },
  expert: { kind: 'search', maxDepth: 14, timeMs: 1400, solve: 12, noise: 0 },
};

function toFlat(board, color) {
  const b = new Int8Array(64);
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const v = board[r][c];
      b[r * N + c] = v == null ? 0 : v === color ? 1 : -1;
    }
  }
  return b;
}

// Flips for player p placing at sq (pushes flipped squares to `out`, returns count).
function flipsAt(b, sq, p, out) {
  if (b[sq] !== 0) return 0;
  let total = 0;
  for (let d = 0; d < 8; d++) {
    const step = DIRS[d];
    const dc = DCOL[d];
    let s = sq;
    let col = sq & 7;
    let n = 0;
    for (;;) {
      col += dc;
      s += step;
      if (col < 0 || col > 7 || s < 0 || s > 63) { n = 0; break; }
      const v = b[s];
      if (v === -p) { n++; continue; }
      if (v !== p) n = 0;
      break;
    }
    if (n > 0) {
      total += n;
      if (out) for (let k = 1, t = sq + step; k <= n; k++, t += step) out.push(t);
    }
  }
  return total;
}

function legalMoves(b, p) {
  const moves = [];
  for (const sq of ORDER) if (b[sq] === 0 && flipsAt(b, sq, p, null) > 0) moves.push(sq);
  return moves;
}

function mobility(b, p) {
  let n = 0;
  for (let sq = 0; sq < 64; sq++) if (b[sq] === 0 && flipsAt(b, sq, p, null) > 0) n++;
  return n;
}

function evaluate(b) {
  let pos = 0;
  let mine = 0;
  let theirs = 0;
  let empties = 0;
  for (let sq = 0; sq < 64; sq++) {
    const v = b[sq];
    if (v === 0) { empties++; continue; }
    if (v === 1) mine++; else theirs++;
    pos += v * W[sq];
  }
  // X/C squares only hurt while their corner is empty; once it's taken, undo the penalty.
  for (const c of CORNERS) {
    if (b[c] === 0) continue;
    for (const s of CORNER_NEIGH[c]) if (b[s] !== 0) pos -= b[s] * W[s] * 0.7;
  }
  const m1 = mobility(b, 1);
  const m2 = mobility(b, -1);
  const mob = m1 + m2 === 0 ? 0 : (100 * (m1 - m2)) / (m1 + m2 + 2);
  let corner = 0;
  for (const c of CORNERS) corner += b[c] * 25;
  // Disc count matters only near the end.
  const disc = empties < 14 ? ((mine - theirs) * (14 - empties)) / 2 : 0;
  return pos + mob * (empties > 20 ? 1.4 : 0.8) + corner + disc;
}

class Timeout extends Error {}

function makeSearch(deadline) {
  let nodes = 0;
  function tick() {
    if ((++nodes & 1023) === 0 && Date.now() > deadline) throw new Timeout();
  }

  // Negamax from the point of view of the side to move (b normalised so that's +1 via sign `p`).
  function negamax(b, p, depth, alpha, beta, passed) {
    tick();
    if (depth === 0) return p * evaluate(b);
    const moves = legalMoves(b, p);
    if (moves.length === 0) {
      if (passed) return p * finalScore(b);
      return -negamax(b, -p, depth, -beta, -alpha, true);
    }
    let best = -Infinity;
    const flips = [];
    for (const sq of moves) {
      flips.length = 0;
      flipsAt(b, sq, p, flips);
      b[sq] = p;
      for (const f of flips) b[f] = p;
      const v = -negamax(b, -p, depth - 1, -beta, -alpha, false);
      b[sq] = 0;
      for (const f of flips) b[f] = -p;
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  }

  // Exact solve: score is the final disc difference (scaled so it outranks any heuristic).
  function solve(b, p, alpha, beta, passed) {
    tick();
    const moves = legalMoves(b, p);
    if (moves.length === 0) {
      if (passed) return p * finalScore(b);
      return -solve(b, -p, -beta, -alpha, true);
    }
    // Fastest-first: try moves leaving the opponent the fewest replies.
    if (moves.length > 1) {
      const scored = moves.map((sq) => {
        const fl = [];
        flipsAt(b, sq, p, fl);
        b[sq] = p;
        for (const f of fl) b[f] = p;
        const m = mobility(b, -p);
        b[sq] = 0;
        for (const f of fl) b[f] = -p;
        return [m - (W[sq] > 50 ? 10 : 0), sq];
      });
      scored.sort((x, y) => x[0] - y[0]);
      for (let i = 0; i < moves.length; i++) moves[i] = scored[i][1];
    }
    let best = -Infinity;
    const flips = [];
    for (const sq of moves) {
      flips.length = 0;
      flipsAt(b, sq, p, flips);
      b[sq] = p;
      for (const f of flips) b[f] = p;
      const v = -solve(b, -p, -beta, -alpha, false);
      b[sq] = 0;
      for (const f of flips) b[f] = -p;
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  }

  return { negamax, solve };
}

// Final disc difference from +1's view, scaled; empties go to the winner (standard scoring).
function finalScore(b) {
  let mine = 0;
  let theirs = 0;
  for (let sq = 0; sq < 64; sq++) {
    if (b[sq] === 1) mine++;
    else if (b[sq] === -1) theirs++;
  }
  let diff = mine - theirs;
  const empty = 64 - mine - theirs;
  if (diff > 0) diff += empty;
  else if (diff < 0) diff -= empty;
  return diff * 10000;
}

// Root search at fixed depth: returns [{sq, v}] for every root move (exact scores within window).
function rootSearch(fn, b, moves, depth) {
  const out = [];
  let alpha = -Infinity;
  const flips = [];
  for (const sq of moves) {
    flips.length = 0;
    flipsAt(b, sq, 1, flips);
    b[sq] = 1;
    for (const f of flips) b[f] = 1;
    let v;
    try {
      v = depth == null ? -fn(b, -1, -Infinity, -alpha + 1, false) : -fn(b, -1, depth - 1, -Infinity, -alpha + 1, false);
    } finally {
      b[sq] = 0;
      for (const f of flips) b[f] = -1;
    }
    out.push({ sq, v });
    if (v > alpha) alpha = v;
  }
  return out;
}

function bestMove({ board, color, level, timeMs }) {
  const lv = LEVELS[level] || LEVELS.hard;
  const b = toFlat(board, color);
  const moves = legalMoves(b, 1);
  if (moves.length === 0) return null;
  const pick = (sq) => ({ r: sq >> 3, c: sq & 7 });
  if (moves.length === 1) return pick(moves[0]);

  if (lv.kind === 'random') return pick(moves[Math.floor(Math.random() * moves.length)]);

  if (lv.kind === 'greedy') {
    // Grab corners, avoid X squares next to an empty corner, else most flips (ties random).
    let best = -Infinity;
    let bestSqs = [];
    for (const sq of moves) {
      let s = flipsAt(b, sq, 1, null) + Math.random() * 0.5;
      if (CORNERS.includes(sq)) s += 100;
      for (const c of CORNERS) if (b[c] === 0 && CORNER_NEIGH[c].includes(sq)) s -= CORNER_NEIGH[c][0] === sq ? 30 : 8;
      if (s > best) { best = s; bestSqs = [sq]; } else if (s === best) bestSqs.push(sq);
    }
    return pick(bestSqs[Math.floor(Math.random() * bestSqs.length)]);
  }

  const deadline = Date.now() + (timeMs || lv.timeMs);
  const search = makeSearch(deadline);
  let empties = 0;
  for (let sq = 0; sq < 64; sq++) if (b[sq] === 0) empties++;

  let bestSq = moves[0];
  let scores = null;
  // Iterative deepening; each completed depth reorders the root moves best-first.
  let order = moves.slice();
  for (let d = 1; d <= Math.min(lv.maxDepth, empties); d++) {
    try {
      scores = rootSearch(search.negamax, b, order, d);
    } catch (e) {
      if (e instanceof Timeout) break;
      throw e;
    }
    scores.sort((x, y) => y.v - x.v);
    order = scores.map((s) => s.sq);
    bestSq = order[0];
  }

  if (lv.solve && empties <= lv.solve) {
    try {
      const exact = rootSearch((bb, p, a, be, passed) => search.solve(bb, p, a, be, passed), b, order, null);
      exact.sort((x, y) => y.v - x.v);
      return pick(exact[0].sq);
    } catch (e) {
      if (!(e instanceof Timeout)) throw e;
      // Ran out of time solving: keep the heuristic choice.
    }
  }

  if (lv.noise && scores) {
    // Hard: occasionally prefers a near-best move so it's beatable but not careless.
    const top = scores[0].v;
    const near = scores.filter((s) => s.v >= top - lv.noise * 4 && Math.abs(s.v) < 5000);
    if (near.length > 1 && Math.random() < 0.25) return pick(near[Math.floor(Math.random() * near.length)].sq);
  }
  return pick(bestSq);
}

module.exports = { bestMove, LEVELS, _internal: { toFlat } };
