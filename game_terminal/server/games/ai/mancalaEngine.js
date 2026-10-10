// Mancala (Kalah) rules + engine, shared by the plugin (server/games/mancala.js) and the AI worker.
// Board: pits[0..13]. Side 0 (gold) owns pits 0-5 and its store 6; side 1 (jade) owns pits 7-12 and
// store 13. Sowing runs 0 → 13 (counter-clockwise on screen), skipping the opponent's store.
// Modes: 'capture' (standard Kalah: last stone in your own empty pit takes it plus the opposite pit)
// and 'avalanche' (last stone in a non-empty pit picks that pit up and keeps sowing; no captures).
// Engine: negamax alpha-beta with extra turns kept on the same side, move ordering, and iterative
// deepening against a deadline on the stronger levels.

'use strict';

const PITS = 6;
const SIZE = 14;
const STONES = 4;
const MAX_RELAYS = 200; // avalanche safety valve; real games end a relay chain long before this

const storeOf = (side) => (side === 0 ? 6 : 13);
const firstPit = (side) => (side === 0 ? 0 : 7);
const sideOfPit = (i) => (i >= 0 && i <= 5 ? 0 : i >= 7 && i <= 12 ? 1 : -1);
const opposite = (i) => 12 - i;

function initialPits() {
  const p = new Array(SIZE).fill(STONES);
  p[6] = 0;
  p[13] = 0;
  return p;
}

function sideEmpty(p, side) {
  const f = firstPit(side);
  for (let k = 0; k < PITS; k++) if (p[f + k]) return false;
  return true;
}

function legalMoves(p, side) {
  const out = [];
  const f = firstPit(side);
  for (let k = 0; k < PITS; k++) if (p[f + k] > 0) out.push(f + k);
  return out;
}

// Plays `pit` for `side`, mutating `p`. With `rec` (an array) every step is recorded for the
// client's animation: {t:'pick',pit,n} {t:'drop',pit} {t:'capture',pits:[a,b],store,n}
// {t:'sweep',side,pits,store,n}. Returns { extra, captured, over }.
function sow(p, side, pit, mode, rec) {
  const myStore = storeOf(side);
  const oppStore = storeOf(1 - side);
  let i = pit;
  let hand = p[i];
  p[i] = 0;
  if (rec) rec.push({ t: 'pick', pit: i, n: hand });
  let extra = false;
  let captured = 0;
  let relays = 0;
  for (;;) {
    while (hand > 0) {
      i = (i + 1) % SIZE;
      if (i === oppStore) continue;
      p[i]++;
      hand--;
      if (rec) rec.push({ t: 'drop', pit: i });
    }
    if (i === myStore) { extra = true; break; }
    if (mode === 'avalanche') {
      if (p[i] > 1 && relays++ < MAX_RELAYS) {
        hand = p[i];
        p[i] = 0;
        if (rec) rec.push({ t: 'pick', pit: i, n: hand });
        continue;
      }
      break;
    }
    if (sideOfPit(i) === side && p[i] === 1) {
      const o = opposite(i);
      if (p[o] > 0) {
        captured = p[o] + 1;
        p[myStore] += captured;
        p[o] = 0;
        p[i] = 0;
        if (rec) rec.push({ t: 'capture', pits: [i, o], store: myStore, n: captured });
      }
    }
    break;
  }
  let over = false;
  if (sideEmpty(p, 0) || sideEmpty(p, 1)) {
    over = true;
    for (const s of [0, 1]) {
      const f = firstPit(s);
      const pits = [];
      let n = 0;
      for (let k = 0; k < PITS; k++) {
        if (p[f + k]) { pits.push(f + k); n += p[f + k]; p[f + k] = 0; }
      }
      if (n) {
        p[storeOf(s)] += n;
        if (rec) rec.push({ t: 'sweep', side: s, pits, store: storeOf(s), n });
      }
    }
    extra = false;
  }
  return { extra, captured, over };
}

// ---------------------------------------------------------------- search

const WIN = 100000;
const LEVELS = {
  easy: { depth: 1, noise: 14, random: 0.45, time: 50 },
  medium: { depth: 2, noise: 4, random: 0.08, time: 100 },
  hard: { depth: 6, noise: 0, random: 0, time: 400 },
  expert: { depth: 40, noise: 0, random: 0, time: 900 },
};

class Timeout extends Error {}

function evaluate(p, side) {
  const me = storeOf(side);
  const op = storeOf(1 - side);
  let mine = 0;
  let theirs = 0;
  const f = firstPit(side);
  const g = firstPit(1 - side);
  for (let k = 0; k < PITS; k++) { mine += p[f + k]; theirs += p[g + k]; }
  return (p[me] - p[op]) * 8 + (mine - theirs);
}

function terminalScore(p, side, ply) {
  const d = p[storeOf(side)] - p[storeOf(1 - side)];
  if (d === 0) return 0;
  return d > 0 ? WIN + d * 10 - ply : -WIN + d * 10 + ply;
}

function makeSearch(mode, deadline) {
  let nodes = 0;
  function orderMoves(p, side) {
    const moves = legalMoves(p, side);
    const store = storeOf(side);
    // Moves whose last stone lands in our store first (extra turn), then the rest right-to-left.
    const score = (m) => (((m + p[m]) % 13) === (store % 13) && p[m] < 13 ? 100 : 0) + m;
    return moves.sort((a, b) => score(b) - score(a));
  }
  function negamax(p, side, depth, alpha, beta, ply) {
    if ((++nodes & 1023) === 0 && Date.now() > deadline) throw new Timeout();
    if (depth <= 0) return evaluate(p, side);
    let best = -Infinity;
    for (const m of orderMoves(p, side)) {
      const q = p.slice();
      const r = sow(q, side, m, mode, null);
      let v;
      if (r.over) v = terminalScore(q, side, ply);
      else if (r.extra) v = negamax(q, side, depth - 1, alpha, beta, ply + 1);
      else v = -negamax(q, 1 - side, depth - 1, -beta, -alpha, ply + 1);
      if (v > best) best = v;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }
  function root(p, side, depth) {
    const scores = [];
    for (const m of orderMoves(p, side)) {
      const q = p.slice();
      const r = sow(q, side, m, mode, null);
      let v;
      if (r.over) v = terminalScore(q, side, 0);
      else if (r.extra) v = negamax(q, side, depth - 1, -Infinity, Infinity, 1);
      else v = -negamax(q, 1 - side, depth - 1, -Infinity, Infinity, 1);
      scores.push({ m, v });
    }
    return scores;
  }
  return { root };
}

// input: { pits, side, mode, level } -> { pit, depth }
function bestMove({ pits, side, mode = 'capture', level = 'hard', timeMs }) {
  const lv = LEVELS[level] || LEVELS.hard;
  const moves = legalMoves(pits, side);
  if (!moves.length) return { pit: null, depth: 0 };
  if (moves.length === 1) return { pit: moves[0], depth: 0 };
  if (Math.random() < lv.random) return { pit: moves[Math.floor(Math.random() * moves.length)], depth: 0 };
  const budget = Math.min(lv.time, timeMs || lv.time);
  const deadline = Date.now() + budget;
  const search = makeSearch(mode, deadline);
  let scores = null;
  let reached = 0;
  for (let d = 1; d <= lv.depth; d++) {
    try {
      scores = search.root(pits, side, d);
      reached = d;
    } catch (e) {
      if (!(e instanceof Timeout)) throw e;
      break;
    }
    // A proven result at this depth won't change with deeper search.
    if (scores.every((s) => Math.abs(s.v) >= WIN - 1000)) break;
  }
  if (!scores) scores = moves.map((m) => ({ m, v: 0 }));
  let best = null;
  let bestV = -Infinity;
  for (const s of scores) {
    const v = s.v + (lv.noise ? (Math.random() * 2 - 1) * lv.noise : 0);
    if (v > bestV) { bestV = v; best = s.m; }
  }
  return { pit: best, depth: reached };
}

module.exports = {
  PITS, SIZE, STONES, storeOf, firstPit, sideOfPit, opposite, initialPits, sideEmpty, legalMoves, sow, bestMove, LEVELS,
};
