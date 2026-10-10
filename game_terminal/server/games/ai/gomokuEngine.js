// Gomoku engine (15x15 freestyle: five or more in a row wins). Board format matches
// server/games/gomoku.js: board[r][c] = 'black' | 'white' | null.
//
// Shape detection is exact and table-driven: for a stone on a line we read the 4 cells on each side
// (own / empty / blocked) and look the 8-cell code up in SHAPE, precomputed once by actually
// trying placements — FIVE, OPEN4 (2+ distinct five-points), FOUR (exactly one), OPEN3 (one more
// stone makes an OPEN4), THREE, OPEN2, TWO. A cell's attack score for a side combines its four
// directional shapes (double-fours, four-three and double-three are recognised as winning combos).
//
// Search: forced-move rules (take a five; block a lone five-point; two five-points = lost; making
// an open four / 4-4 / 4-3 = won; vs an opponent's open-three-or-better threat, only blocking
// points and own fours are considered), a VCF solver (victory by continuous fours) and
// iterative-deepening negamax with alpha-beta over the top-K pattern-ordered candidates.

'use strict';

const N = 15;
const CELLS = N * N;
const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

const S_NONE = 0, S_TWO = 1, S_OPEN2 = 2, S_THREE = 3, S_OPEN3 = 4, S_FOUR = 5, S_OPEN4 = 6, S_FIVE = 7;

// ---- shape table -------------------------------------------------------------------------------
// arr: 9 cells along a line, index 4 = the stone in question (own). 0 empty, 1 own, 2 blocked.
function hasFive(arr) {
  for (let s = 0; s <= 4; s++) {
    let ok = true;
    for (let k = s; k < s + 5; k++) if (arr[k] !== 1) { ok = false; break; }
    if (ok) return true;
  }
  return false;
}
const shapeMemo = new Map();
function shapeOfArr(arr) {
  const key = arr.join('');
  if (shapeMemo.has(key)) return shapeMemo.get(key);
  let res;
  if (hasFive(arr)) res = S_FIVE;
  else {
    let w = 0;
    let best = S_NONE;
    for (let e = 0; e < 9; e++) {
      if (arr[e] !== 0) continue;
      arr[e] = 1;
      if (hasFive(arr)) w++;
      else {
        const sh = shapeOfArr(arr);
        if (sh > best) best = sh;
      }
      arr[e] = 0;
    }
    if (w >= 2) res = S_OPEN4;
    else if (w === 1) res = S_FOUR;
    else if (best === S_OPEN4) res = S_OPEN3;
    else if (best === S_FOUR) res = S_THREE;
    else if (best === S_OPEN3) res = S_OPEN2;
    else if (best === S_THREE) res = S_TWO;
    else res = S_NONE;
  }
  shapeMemo.set(key, res);
  return res;
}
const POW3 = [1, 3, 9, 27, 81, 243, 729, 2187];
const SHAPE = new Int8Array(6561);
for (let code = 0; code < 6561; code++) {
  const arr = new Array(9);
  let x = code;
  for (let k = 0, j = 0; k < 9; k++) {
    if (k === 4) { arr[k] = 1; continue; }
    arr[k] = x % 3; x = Math.floor(x / 3); j++;
  }
  SHAPE[code] = shapeOfArr(arr);
}
shapeMemo.clear();

// Neighbour offsets for each cell/direction (−1 = off board), so line reads are cheap.
const LINE = new Int16Array(CELLS * 4 * 8);
for (let i = 0; i < CELLS; i++) {
  const r = Math.floor(i / N), c = i % N;
  for (let d = 0; d < 4; d++) {
    const [dr, dc] = DIRS[d];
    let j = 0;
    for (let k = -4; k <= 4; k++) {
      if (k === 0) continue;
      const rr = r + dr * k, cc = c + dc * k;
      LINE[(i * 4 + d) * 8 + j++] = rr >= 0 && rr < N && cc >= 0 && cc < N ? rr * N + cc : -1;
    }
  }
}
const NEAR = []; // cells within Chebyshev distance 2
for (let i = 0; i < CELLS; i++) {
  const r = Math.floor(i / N), c = i % N;
  const list = [];
  for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
    if (!dr && !dc) continue;
    const rr = r + dr, cc = c + dc;
    if (rr >= 0 && rr < N && cc >= 0 && cc < N) list.push(rr * N + cc);
  }
  NEAR.push(list);
}

// Directional shape of a stone of side `p` at cell i (cell treated as p's, whatever is there).
function dirShape(cells, i, d, p) {
  const base = (i * 4 + d) * 8;
  let code = 0;
  for (let j = 0; j < 8; j++) {
    const n = LINE[base + j];
    const v = n < 0 ? 2 : cells[n] === 0 ? 0 : cells[n] === p ? 1 : 2;
    code += v * POW3[j];
  }
  return SHAPE[code];
}

const W_SHAPE = [0, 8, 45, 110, 1100, 1400, 0, 0];
const SC_FIVE = 1e8, SC_44 = 2e6, SC_OPEN4 = 3e6, SC_43 = 1e6, SC_33 = 1.5e5;

// Attack score of side p playing empty cell i, and the shapes it makes.
function attack(cells, i, p) {
  let fours = 0, open4 = 0, open3 = 0, five = 0, sum = 0;
  for (let d = 0; d < 4; d++) {
    const s = dirShape(cells, i, d, p);
    if (s === S_FIVE) five++;
    else if (s === S_OPEN4) open4++;
    else if (s === S_FOUR) fours++;
    else if (s === S_OPEN3) open3++;
    sum += W_SHAPE[s];
  }
  if (five) return SC_FIVE;
  if (open4) return SC_OPEN4;
  if (fours >= 2) return SC_44;
  if (fours && open3) return SC_43;
  if (open3 >= 2) return SC_33;
  return sum;
}
// Bit flags: 1 = makes five, 2 = makes a (single) four.
function fourFlags(cells, i, p) {
  let f = 0;
  for (let d = 0; d < 4; d++) {
    const s = dirShape(cells, i, d, p);
    if (s === S_FIVE) return 1;
    if (s === S_FOUR || s === S_OPEN4) f = 2;
  }
  return f;
}

const LEVELS = {
  easy: { search: false, noise: 0.9, random: 0.25, top: 6, missThree: 0.6, time: 100 },
  medium: { search: false, noise: 0.12, random: 0, top: 3, missThree: 0, time: 150 },
  hard: { search: true, depth: 4, k: 9, vcf: 10, time: 500 },
  expert: { search: true, depth: 10, k: 12, vcf: 16, defendVcf: true, time: 900 },
};

const WIN = 1e9;

function bestMove({ board, color, level, timeMs, rng = Math.random }) {
  const lv = LEVELS[level] || LEVELS.hard;
  const budget = Math.min(lv.time, timeMs || lv.time);
  const deadline = Date.now() + budget;
  const cells = new Int8Array(CELLS);
  const nb = new Int16Array(CELLS);
  let stones = 0;
  const me = color === 'white' ? 2 : 1;
  const opp = 3 - me;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const v = board[r][c];
    if (!v) continue;
    const i = r * N + c;
    cells[i] = v === 'white' ? 2 : 1;
    stones++;
    for (const j of NEAR[i]) nb[j]++;
  }
  const center = Math.floor(N / 2);
  if (stones === 0) return { r: center, c: center };

  const place = (i, p) => { cells[i] = p; for (const j of NEAR[i]) nb[j]++; };
  const unplace = (i) => { cells[i] = 0; for (const j of NEAR[i]) nb[j]--; };
  const empties = () => {
    const out = [];
    for (let i = 0; i < CELLS; i++) if (cells[i] === 0 && nb[i] > 0) out.push(i);
    return out;
  };
  const toRC = (i) => ({ r: Math.floor(i / N), c: i % N });
  const centerBias = (i) => {
    const r = Math.floor(i / N), c = i % N;
    return -(Math.abs(r - center) + Math.abs(c - center)) * 0.5;
  };

  // Scored candidate list for side p: { i, a: p's attack, d: opponent's attack (= defence) }.
  function gen(p) {
    const q = 3 - p;
    const list = [];
    for (const i of empties()) list.push({ i, a: attack(cells, i, p), d: attack(cells, i, q) });
    return list;
  }

  // VCF: can side p force a five with an unbroken chain of fours? (opponent must have no five
  // threats of its own on entry.) Conservative: a branch fails if the forced block makes a four.
  let vcfNodes = 0;
  function vcf(p, depth) {
    if (depth <= 0 || ++vcfNodes > 20000 || Date.now() > deadline) return -1;
    const q = 3 - p;
    const cand = [];
    for (const i of empties()) {
      const f = fourFlags(cells, i, p);
      if (f === 1) return i;
      if (f === 2) cand.push(i);
    }
    for (const i of cand) {
      place(i, p);
      // The unique five-point the opponent now has to take.
      let block = -1, count = 0;
      // Five-points lie on one of i's four lines, at most 4 cells away.
      for (let k = i * 32; k < i * 32 + 32; k++) {
        const j = LINE[k];
        if (j >= 0 && cells[j] === 0 && j !== block && fourFlags(cells, j, p) === 1) { block = j; count++; }
      }
      let won = false;
      if (count >= 2) won = true;
      else if (count === 1) {
        place(block, q);
        const counter = fourFlags(cells, block, q) !== 0 && dirMakesFiveThreat(block, q);
        if (!counter && vcf(p, depth - 1) >= 0) won = true;
        unplace(block);
      }
      unplace(i);
      if (won) return i;
    }
    return -1;
  }
  // After q's stone at `at`, does q threaten a five anywhere along its lines?
  function dirMakesFiveThreat(at, q) {
    for (let d = 0; d < 4; d++) {
      const s = dirShape(cells, at, d, q);
      if (s === S_FOUR || s === S_OPEN4 || s === S_FIVE) return true;
    }
    return false;
  }

  const rootList = gen(me);
  // 1. Take a five.
  const five = rootList.find((m) => m.a >= SC_FIVE);
  if (five) return toRC(five.i);
  // 2. Block the opponent's five-point(s).
  const oppFives = rootList.filter((m) => m.d >= SC_FIVE);
  if (oppFives.length) return toRC(oppFives[0].i);

  if (!lv.search) {
    // Pattern-scoring levels: attack + defence, with noise / blunders for Easy.
    const scored = rootList.map((m) => {
      let d = m.d;
      if (lv.missThree && d >= W_SHAPE[S_OPEN3] && d < SC_FIVE && rng() < lv.missThree) d *= 0.05;
      const s = Math.max(m.a, d * 0.9) + Math.min(m.a, d) * 0.3 + centerBias(m.i);
      return { i: m.i, s: s * (1 + (rng() * 2 - 1) * lv.noise) };
    }).sort((x, y) => y.s - x.s);
    if (lv.random && rng() < lv.random) return toRC(scored[Math.floor(rng() * Math.min(scored.length, 12))].i);
    return toRC(scored[Math.floor(rng() * Math.min(lv.top, scored.length) * (lv.top > 3 ? 1 : 0.6))].i);
  }

  // 3. An immediately unstoppable shape (open four, double four, four-three), else a forced win by
  // continuous fours.
  const big = rootList.filter((m) => m.a >= SC_43).sort((x, y) => y.a - x.a || y.d - x.d)[0];
  if (big) return toRC(big.i);
  //    Our own forced win by continuous fours.
  vcfNodes = 0;
  const win = vcf(me, lv.vcf);
  if (win >= 0) return toRC(win);

  // 4. Negamax.
  let aborted = false;
  let nodes = 0;
  function moveList(p) {
    const list = gen(p);
    const q = 3 - p;
    // Opponent's open-three-or-better threats: answer them (or counter with a four).
    const oppThreat = list.some((m) => m.d >= SC_33);
    let moves = list;
    if (oppThreat) {
      moves = list.filter((m) => m.d >= W_SHAPE[S_OPEN3] || fourFlags(cells, m.i, p) === 2);
      if (!moves.length) moves = list;
    }
    for (const m of moves) m.s = m.a + m.d * 0.85 + centerBias(m.i);
    moves.sort((x, y) => y.s - x.s);
    void q;
    return { list, moves };
  }
  function evaluate(list) {
    let a1 = 0, a2 = 0, d1 = 0, d2 = 0;
    for (const m of list) {
      if (m.a > a1) { a2 = a1; a1 = m.a; } else if (m.a > a2) a2 = m.a;
      if (m.d > d1) { d2 = d1; d1 = m.d; } else if (m.d > d2) d2 = m.d;
    }
    return (a1 + 0.4 * a2) - 0.75 * (d1 + 0.4 * d2);
  }
  function negamax(p, depth, alpha, beta, ply) {
    if ((++nodes & 255) === 0 && Date.now() > deadline) aborted = true;
    if (aborted) return 0;
    const { list, moves } = moveList(p);
    if (!list.length) return 0;
    let fiveMe = false, oppFive = -1, oppFiveCount = 0, bigMe = false;
    for (const m of list) {
      if (m.a >= SC_FIVE) fiveMe = true;
      if (m.d >= SC_FIVE) { oppFive = m.i; oppFiveCount++; }
      if (m.a >= SC_43) bigMe = true;
    }
    if (fiveMe) return WIN - ply;
    if (oppFiveCount >= 2) return -(WIN - ply - 1);
    let cand;
    if (oppFiveCount === 1) cand = [oppFive];
    else {
      if (bigMe) return WIN - ply - 2;
      if (depth <= 0) return evaluate(list);
      cand = moves.slice(0, lv.k).map((m) => m.i);
    }
    let best = -Infinity;
    for (const i of cand) {
      place(i, p);
      // A forced single reply doesn't consume depth.
      const v = -negamax(3 - p, oppFiveCount === 1 ? depth : depth - 1, -beta, -alpha, ply + 1);
      unplace(i);
      if (aborted) return 0;
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  }

  const { moves: rootMoves } = moveList(me);
  let order = rootMoves.slice(0, Math.max(lv.k, 12)).map((m) => m.i);
  let bestIdx = order[0];
  let bestScores = null;
  for (let depth = 1; depth <= lv.depth; depth++) {
    const scores = [];
    let alpha = -Infinity;
    for (const i of order) {
      place(i, me);
      const v = -negamax(opp, depth - 1, -Infinity, -alpha, 1);
      unplace(i);
      if (aborted) break;
      scores.push({ i, v });
      if (v > alpha) alpha = v;
    }
    if (aborted) break;
    scores.sort((x, y) => y.v - x.v);
    bestScores = scores;
    bestIdx = scores[0].i;
    order = scores.map((s) => s.i);
    if (scores[0].v >= WIN - 100 || scores[0].v <= -(WIN - 100)) break;
  }

  // 5. Expert: don't hand the opponent a VCF — walk down the ranked list until a move is safe.
  if (lv.defendVcf && bestScores) {
    for (const { i, v } of bestScores.slice(0, 6)) {
      if (Date.now() > deadline + 300) break;
      if (v >= WIN - 100) return toRC(i);
      place(i, me);
      vcfNodes = 0;
      const oppWins = gen(opp).some((m) => m.d >= SC_FIVE) ? false : vcf(opp, 12) >= 0;
      unplace(i);
      if (!oppWins) return toRC(i);
    }
  }
  return toRC(bestIdx);
}

module.exports = { bestMove, N, SHAPE_NAMES: ['none', 'two', 'open2', 'three', 'open3', 'four', 'open4', 'five'] };
