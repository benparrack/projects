// Checkers engine (American rules as in server/games/checkers.js: mandatory capture, men move and
// capture forward only, a multi-jump must be finished, promotion ends the turn). Iterative-
// deepening negamax with alpha-beta, a Zobrist transposition table, capture extension (forced
// captures are never cut off at the horizon) and an eval covering material, advancement, back-row
// guard, centre control and endgame "trade down / hunt the last pieces" terms.
// Moves are whole turns: { path: [sq, ...], caps: [sq, ...] } on a 64-square board.

'use strict';

const WIN = 1000000;
const MAX_PLY = 64;

// Piece codes: 1 black man, 2 black king, -1 red man, -2 red king. Black moves down (+row).
let seed = 0x2545f491;
function rnd32() {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  return seed | 0;
}
const ZLO = new Int32Array(64 * 5);
const ZHI = new Int32Array(64 * 5);
for (let i = 0; i < ZLO.length; i++) { ZLO[i] = rnd32(); ZHI[i] = rnd32(); }
const SIDE_LO = rnd32();
const SIDE_HI = rnd32();

const TT_SIZE = 1 << 19;
const TT_MASK = TT_SIZE - 1;
const ttKey = new Int32Array(TT_SIZE);
const ttScore = new Int32Array(TT_SIZE);
const ttDepth = new Int8Array(TT_SIZE);
const ttFlag = new Int8Array(TT_SIZE);
const ttMove = new Int16Array(TT_SIZE); // from * 64 + first landing square

const LEVELS = {
  easy: { depth: 2, noise: 60, time: 300 },
  medium: { depth: 4, noise: 20, time: 500 },
  hard: { depth: 9, noise: 0, time: 900 },
  expert: { depth: 60, noise: 0, time: 1800 },
};

const ALL = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const CENTER = new Int8Array(64);
for (let r = 2; r <= 5; r++) for (let c = 2; c <= 5; c++) CENTER[r * 8 + c] = (r === 3 || r === 4) && (c >= 2 && c <= 5) ? 6 : 3;

function bestMove({ board, color, mustContinueFrom, level, timeMs }) {
  const lv = LEVELS[level] || LEVELS.hard;
  timeMs = Math.min(lv.time, timeMs || lv.time);
  const b = new Int8Array(64);
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p) b[r * 8 + c] = (p.color === 'black' ? 1 : -1) * (p.king ? 2 : 1);
    }
  }
  const me = color === 'black' ? 1 : -1;
  let lo = 0; let hi = 0;
  for (let i = 0; i < 64; i++) if (b[i]) { lo ^= ZLO[i * 5 + b[i] + 2]; hi ^= ZHI[i * 5 + b[i] + 2]; }
  if (me === -1) { lo ^= SIDE_LO; hi ^= SIDE_HI; }
  ttFlag.fill(0);
  const killers = new Int16Array(MAX_PLY + 64).fill(-1);
  const pathHashes = [];
  let deadline = Date.now() + timeMs;
  let nodes = 0;
  let aborted = false;

  function setSq(sq, v) {
    if (b[sq]) { lo ^= ZLO[sq * 5 + b[sq] + 2]; hi ^= ZHI[sq * 5 + b[sq] + 2]; }
    b[sq] = v;
    if (v) { lo ^= ZLO[sq * 5 + v + 2]; hi ^= ZHI[sq * 5 + v + 2]; }
  }

  function jumps(from, p, side, path, caps, out) {
    const r = from >> 3; const c = from & 7;
    const dirs = p === 2 || p === -2 ? ALL : [[side, 1], [side, -1]];
    let any = false;
    for (const [dr, dc] of dirs) {
      const mr = r + dr; const mc = c + dc; const tr = r + 2 * dr; const tc = c + 2 * dc;
      if (tr < 0 || tr > 7 || tc < 0 || tc > 7) continue;
      const mid = mr * 8 + mc; const to = tr * 8 + tc;
      if (b[mid] * side >= 0 || b[to]) continue;
      any = true;
      const victim = b[mid];
      b[mid] = 0; b[from] = 0; b[to] = p;
      const promotes = (p === 1 && tr === 7) || (p === -1 && tr === 0);
      if (promotes) out.push({ path: [...path, to], caps: [...caps, mid] });
      else jumps(to, p, side, [...path, to], [...caps, mid], out);
      b[to] = 0; b[from] = p; b[mid] = victim;
    }
    if (!any && path.length > 1) out.push({ path, caps });
  }

  function gen(side, onlyFrom = -1) {
    const caps = [];
    for (let sq = 0; sq < 64; sq++) {
      if (b[sq] * side <= 0) continue;
      if (onlyFrom >= 0 && sq !== onlyFrom) continue;
      jumps(sq, b[sq], side, [sq], [], caps);
    }
    if (caps.length || onlyFrom >= 0) return caps;
    const quiet = [];
    for (let sq = 0; sq < 64; sq++) {
      const p = b[sq];
      if (p * side <= 0) continue;
      const r = sq >> 3; const c = sq & 7;
      const dirs = p === 2 || p === -2 ? ALL : [[side, 1], [side, -1]];
      for (const [dr, dc] of dirs) {
        const tr = r + dr; const tc = c + dc;
        if (tr < 0 || tr > 7 || tc < 0 || tc > 7 || b[tr * 8 + tc]) continue;
        quiet.push({ path: [sq, tr * 8 + tc], caps: [] });
      }
    }
    return quiet;
  }

  function make(m) {
    const from = m.path[0]; const to = m.path[m.path.length - 1];
    const p = b[from];
    m.piece = p;
    m.victims = m.caps.map((sq) => b[sq]);
    setSq(from, 0);
    for (const sq of m.caps) setSq(sq, 0);
    const row = to >> 3;
    setSq(to, (p === 1 && row === 7) || (p === -1 && row === 0) ? p * 2 : p);
    lo ^= SIDE_LO; hi ^= SIDE_HI;
  }
  function unmake(m) {
    const from = m.path[0]; const to = m.path[m.path.length - 1];
    setSq(to, 0);
    m.caps.forEach((sq, i) => setSq(sq, m.victims[i]));
    setSq(from, m.piece);
    lo ^= SIDE_LO; hi ^= SIDE_HI;
  }

  // Score from `side`'s point of view.
  function evaluate(side) {
    let men = [0, 0]; let kings = [0, 0]; let pos = 0;
    const pieces = [[], []];
    for (let sq = 0; sq < 64; sq++) {
      const p = b[sq];
      if (!p) continue;
      const s = p > 0 ? 1 : -1; const k = p > 0 ? 0 : 1;
      const r = sq >> 3;
      pieces[k].push(sq);
      if (p === 1 || p === -1) {
        men[k]++;
        const adv = s === 1 ? r : 7 - r;
        pos += s * (adv * adv * 0.6 + CENTER[sq]);
        if (adv === 0) pos += s * 8; // back-row guard stops cheap kings
      } else {
        kings[k]++;
        pos += s * CENTER[sq] * 2;
      }
    }
    const matB = men[0] * 100 + kings[0] * 170;
    const matR = men[1] * 100 + kings[1] * 170;
    if (!matB) return side === 1 ? -WIN + 100 : WIN - 100;
    if (!matR) return side === 1 ? WIN - 100 : -WIN + 100;
    let s = matB - matR + pos;
    // Ahead: trading down helps; the fewer pieces left, the bigger each unit of advantage.
    const total = matB + matR;
    s += ((matB - matR) * 600) / total;
    // Endgame hunt: the stronger side's kings close in on the weaker side's pieces.
    if (men[0] + men[1] + kings[0] + kings[1] <= 8 && matB !== matR) {
      const strong = matB > matR ? 0 : 1;
      let dist = 0;
      for (const a of pieces[strong]) {
        if (Math.abs(b[a]) !== 2) continue;
        for (const t of pieces[1 - strong]) dist += Math.max(Math.abs((a >> 3) - (t >> 3)), Math.abs((a & 7) - (t & 7)));
      }
      s += (strong === 0 ? -1 : 1) * dist * 2;
    }
    return side === 1 ? s : -s;
  }

  const moveKey = (m) => m.path[0] * 64 + m.path[1];

  function negamax(depth, alpha, beta, side, ply, onlyFrom = -1) {
    if ((++nodes & 2047) === 0 && Date.now() > deadline) aborted = true;
    if (aborted) return 0;
    if (ply > 0) {
      for (let i = pathHashes.length - 3; i >= 0; i -= 2) if (pathHashes[i] === hi) return 0;
    }
    const moves = gen(side, onlyFrom);
    if (!moves.length) return -WIN + ply;
    const forced = moves[0].caps.length > 0;
    if (depth <= 0 && !forced) return evaluate(side);
    if (ply >= MAX_PLY) return evaluate(side);
    if (depth < 0) depth = 0;

    const slot = lo & TT_MASK;
    let ttM = -1;
    if (ttFlag[slot] && ttKey[slot] === hi) {
      ttM = ttMove[slot];
      if (ply > 0 && ttDepth[slot] >= depth) {
        const s = ttScore[slot]; const f = ttFlag[slot];
        if (f === 1 || (f === 2 && s >= beta) || (f === 3 && s <= alpha)) return s;
      }
    }
    for (const m of moves) {
      const k = moveKey(m);
      m.order = k === ttM ? 1e6 : m.caps.length * 1000 + (k === killers[ply] ? 500 : 0) + ((m.path[m.path.length - 1] >> 3) === (side === 1 ? 7 : 0) ? 300 : 0);
    }
    moves.sort((x, y) => y.order - x.order);

    const alpha0 = alpha;
    let best = -Infinity; let bestK = -1;
    for (const m of moves) {
      make(m);
      pathHashes.push(hi);
      // A single forced capture doesn't cost a ply.
      const score = -negamax(depth - (moves.length === 1 ? 0 : 1), -beta, -alpha, -side, ply + 1);
      pathHashes.pop();
      unmake(m);
      if (aborted) return 0;
      if (score > best) { best = score; bestK = moveKey(m); }
      if (score > alpha) alpha = score;
      if (alpha >= beta) { if (!m.caps.length) killers[ply] = moveKey(m); break; }
    }
    ttKey[slot] = hi; ttScore[slot] = best; ttDepth[slot] = depth; ttMove[slot] = bestK;
    ttFlag[slot] = best <= alpha0 ? 3 : best >= beta ? 2 : 1;
    return best;
  }

  const onlyFrom = mustContinueFrom ? mustContinueFrom.r * 8 + mustContinueFrom.c : -1;
  const roots = gen(me, onlyFrom);
  if (!roots.length) return null;
  let best = roots[0];
  let depthDone = 0;
  if (roots.length > 1) {
    for (let depth = 1; depth <= lv.depth; depth++) {
      let alpha = -Infinity; let iterBest = null;
      const ordered = [best, ...roots.filter((m) => m !== best)];
      for (const m of ordered) {
        make(m); pathHashes.push(hi);
        const score = -negamax(depth - 1, -Infinity, -alpha, -me, 1);
        pathHashes.pop(); unmake(m);
        if (aborted) break;
        if (score > alpha) { alpha = score; iterBest = m; }
      }
      if (aborted) break;
      if (iterBest) best = iterBest;
      depthDone = depth;
      if (Math.abs(alpha) > WIN - 1000) break;
      if (Date.now() > deadline - timeMs * 0.6) break;
    }
    if (lv.noise && depthDone) {
      aborted = false;
      deadline = Date.now() + 1000;
      let pickScore = -Infinity;
      for (const m of roots) {
        make(m); pathHashes.push(hi);
        const s = -negamax(depthDone - 1, -Infinity, Infinity, -me, 1);
        pathHashes.pop(); unmake(m);
        const noisy = s + (Math.random() * 2 - 1) * lv.noise;
        if (noisy > pickScore) { pickScore = noisy; best = m; }
      }
    }
  }
  return { path: best.path.map((sq) => ({ r: sq >> 3, c: sq & 7 })), nodes, depth: depthDone };
}

module.exports = { bestMove };
