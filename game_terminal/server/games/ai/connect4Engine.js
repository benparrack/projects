// Connect 4 engine: iterative-deepening negamax with alpha-beta, a transposition table, forced-
// move detection (take a win, block a single threat, resign to a double threat) and a window-
// counting evaluation that prefers threats on the rows the Zugzwang/parity rule favours. Reaches
// 12+ plies in the midgame within the time budget and solves most endgames outright.
// Board format matches server/games/connect4.js: board[r][c], r = 0 is the TOP row.

'use strict';

const COLS = 7;
const ROWS = 6;
const CELLS = COLS * ROWS;
const WIN = 1000000;
const ORDER = [3, 2, 4, 1, 5, 0, 6];

const WINDOWS = [];
for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const er = r + dr * 3;
      const ec = c + dc * 3;
      if (er < 0 || er >= ROWS || ec < 0 || ec >= COLS) continue;
      WINDOWS.push([0, 1, 2, 3].map((k) => (r + dr * k) * COLS + (c + dc * k)));
    }
  }
}

let seed = 0x9e3779b9;
function rnd32() {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  return seed | 0;
}
const ZLO = new Int32Array(CELLS * 3);
const ZHI = new Int32Array(CELLS * 3);
for (let i = 0; i < ZLO.length; i++) { ZLO[i] = rnd32(); ZHI[i] = rnd32(); }

const TT_BITS = 20;
const TT_SIZE = 1 << TT_BITS;
const TT_MASK = TT_SIZE - 1;
const ttKey = new Int32Array(TT_SIZE);
const ttScore = new Int32Array(TT_SIZE);
const ttDepth = new Int8Array(TT_SIZE);
const ttFlag = new Int8Array(TT_SIZE); // 0 empty, 1 exact, 2 lower, 3 upper
const ttMove = new Int8Array(TT_SIZE);

function bestMove({ board, color, timeMs = 800 }) {
  const cells = new Int8Array(CELLS);
  const heights = new Int8Array(COLS);
  let count = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const v = board[r][c];
      if (!v) continue;
      cells[r * COLS + c] = v === 'red' ? 1 : 2;
      heights[c]++;
      count++;
    }
  }
  const me = color === 'red' ? 1 : 2;
  const firstMover = count % 2 === 0 ? me : 3 - me;
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < CELLS; i++) if (cells[i]) { lo ^= ZLO[i * 3 + cells[i]]; hi ^= ZHI[i * 3 + cells[i]]; }
  ttFlag.fill(0);

  const deadline = Date.now() + timeMs;
  let nodes = 0;
  let aborted = false;

  function idxFor(c) { return (ROWS - 1 - heights[c]) * COLS + c; }

  function winsAt(idx, p) {
    const r = (idx / COLS) | 0;
    const c = idx % COLS;
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      let n = 1;
      let rr = r + dr; let cc = c + dc;
      while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && cells[rr * COLS + cc] === p) { n++; rr += dr; cc += dc; }
      rr = r - dr; cc = c - dc;
      while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && cells[rr * COLS + cc] === p) { n++; rr -= dr; cc -= dc; }
      if (n >= 4) return true;
    }
    return false;
  }

  function evaluate(p) {
    let s = 0;
    for (const w of WINDOWS) {
      let a = 0; let b = 0; let empty = -1;
      for (let k = 0; k < 4; k++) {
        const v = cells[w[k]];
        if (v === 1) a++; else if (v === 2) b++; else empty = w[k];
      }
      if (a && b) continue;
      const n = a || b;
      const q = a ? 1 : 2;
      let v = 0;
      if (n === 3) {
        const fromBottom = ROWS - ((empty / COLS) | 0);
        v = 50 + (((fromBottom % 2 === 1) === (q === firstMover)) ? 60 : 0);
      } else if (n === 2) v = 6;
      else if (n === 1) v = 1;
      s += q === 1 ? v : -v;
    }
    for (let r = 0; r < ROWS; r++) {
      const v = cells[r * COLS + 3];
      if (v) s += v === 1 ? 4 : -4;
    }
    return p === 1 ? s : -s;
  }

  function play(c, p) {
    const idx = idxFor(c);
    cells[idx] = p; heights[c]++; count++;
    lo ^= ZLO[idx * 3 + p]; hi ^= ZHI[idx * 3 + p];
  }
  function unplay(c, p) {
    heights[c]--; count--;
    const idx = idxFor(c);
    cells[idx] = 0;
    lo ^= ZLO[idx * 3 + p]; hi ^= ZHI[idx * 3 + p];
  }

  function negamax(depth, alpha, beta, p) {
    if ((++nodes & 4095) === 0 && Date.now() > deadline) aborted = true;
    if (aborted) return 0;
    if (count === CELLS) return 0;
    const o = 3 - p;

    for (let c = 0; c < COLS; c++) {
      if (heights[c] < ROWS && winsAt(idxFor(c), p)) return WIN - (count + 1);
    }
    let forced = -1;
    let threats = 0;
    for (let c = 0; c < COLS; c++) {
      if (heights[c] < ROWS && winsAt(idxFor(c), o)) { threats++; forced = c; }
    }
    if (threats >= 2) return -(WIN - (count + 2));
    if (depth <= 0) return evaluate(p);

    const slot = lo & TT_MASK;
    let ttBest = -1;
    if (ttFlag[slot] && ttKey[slot] === hi) {
      ttBest = ttMove[slot];
      if (ttDepth[slot] >= depth) {
        const s = ttScore[slot];
        const f = ttFlag[slot];
        if (f === 1) return s;
        if (f === 2 && s >= beta) return s;
        if (f === 3 && s <= alpha) return s;
      }
    }

    const moves = [];
    if (forced >= 0) moves.push(forced);
    else {
      if (ttBest >= 0 && heights[ttBest] < ROWS) moves.push(ttBest);
      for (const c of ORDER) if (c !== ttBest && heights[c] < ROWS) moves.push(c);
    }

    const alpha0 = alpha;
    let best = -Infinity;
    let bestC = moves[0];
    for (const c of moves) {
      play(c, p);
      // Playing directly under an opponent's winning square hands them the game.
      let score;
      if (heights[c] < ROWS && winsAt(idxFor(c), o)) score = -(WIN - (count + 1));
      else score = -negamax(depth - 1, -beta, -alpha, o);
      unplay(c, p);
      if (aborted) return 0;
      if (score > best) { best = score; bestC = c; }
      if (score > alpha) alpha = score;
      if (alpha >= beta) break;
    }

    ttKey[slot] = hi;
    ttScore[slot] = best;
    ttDepth[slot] = depth;
    ttMove[slot] = bestC;
    ttFlag[slot] = best <= alpha0 ? 3 : best >= beta ? 2 : 1;
    return best;
  }

  const legal = ORDER.filter((c) => heights[c] < ROWS);
  if (legal.length === 0) return null;
  let bestCol = legal[0];
  const maxDepth = CELLS - count;
  for (let depth = 1; depth <= maxDepth; depth++) {
    let alpha = -Infinity;
    let iterBest = -1;
    const rootMoves = [bestCol, ...legal.filter((c) => c !== bestCol)];
    for (const c of rootMoves) {
      play(c, me);
      const score = winsAt(idxFor(c) + COLS, me) ? WIN : -negamax(depth - 1, -Infinity, -alpha, 3 - me);
      unplay(c, me);
      if (aborted) break;
      if (score > alpha) { alpha = score; iterBest = c; }
    }
    if (aborted) break;
    if (iterBest >= 0) bestCol = iterBest;
    if (Math.abs(alpha) > WIN - 100) break; // solved: forced win or loss
    if (Date.now() > deadline - timeMs * 0.6) break; // next ply wouldn't finish
  }
  return { col: bestCol, nodes };
}

module.exports = { bestMove };
