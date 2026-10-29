// Filler (GamePigeon-style) rules + engine, shared by the plugin (server/games/filler.js) and,
// optionally, the AI worker. Board: COLS x ROWS cells (index = r * COLS + c) of NCOLORS colours.
// Seat 1 starts in the bottom-left corner, seat 2 in the top-right. A turn picks a colour that is
// neither player's current colour: your whole region turns that colour and absorbs every
// unowned cell of it that touches the region (repeatedly). The game ends once someone owns more
// than half the board (the rest can't change the result), the board is full, or after a move cap.
// Engine: negamax alpha-beta over the 4 legal colours, iterative deepening against a deadline.

'use strict';

const COLS = 8;
const ROWS = 7;
const CELLS = COLS * ROWS;
const NCOLORS = 6;
const HALF = CELLS / 2;
const MAX_MOVES = 300; // safety valve; real games end long before
const START = { 1: (ROWS - 1) * COLS, 2: COLS - 1 }; // bottom-left, top-right

const NEIGHBORS = [];
for (let i = 0; i < CELLS; i++) {
  const r = Math.floor(i / COLS);
  const c = i % COLS;
  const n = [];
  if (r > 0) n.push(i - COLS);
  if (r < ROWS - 1) n.push(i + COLS);
  if (c > 0) n.push(i - 1);
  if (c < COLS - 1) n.push(i + 1);
  NEIGHBORS.push(n);
}

// Random board with no two orthogonally adjacent cells sharing a colour (like GamePigeon's), and
// the two start corners different. `rand` defaults to Math.random.
function randomBoard(rand = Math.random) {
  for (;;) {
    const colors = new Array(CELLS);
    for (let i = 0; i < CELLS; i++) {
      const banned = new Set();
      if (i % COLS > 0) banned.add(colors[i - 1]);
      if (i >= COLS) banned.add(colors[i - COLS]);
      const opts = [];
      for (let k = 0; k < NCOLORS; k++) if (!banned.has(k)) opts.push(k);
      colors[i] = opts[Math.floor(rand() * opts.length)];
    }
    if (colors[START[1]] !== colors[START[2]]) return colors;
  }
}

function initialOwner() {
  const o = new Array(CELLS).fill(0);
  o[START[1]] = 1;
  o[START[2]] = 2;
  return o;
}

const colorOf = (colors, p) => colors[START[p]];
const other = (p) => (p === 1 ? 2 : 1);

function legalColors(colors, p) {
  const mine = colorOf(colors, p);
  const theirs = colorOf(colors, other(p));
  const out = [];
  for (let k = 0; k < NCOLORS; k++) if (k !== mine && k !== theirs) out.push(k);
  return out;
}

function counts(owner) {
  const n = { 1: 0, 2: 0 };
  for (let i = 0; i < CELLS; i++) if (owner[i]) n[owner[i]]++;
  return n;
}

// Plays `color` for player p in place. Returns the newly absorbed cells in BFS order with their
// wave distance ([{ i, d }]) so the client can ripple them in.
function applyColor(colors, owner, p, color) {
  const queue = [];
  const dist = new Map();
  for (let i = 0; i < CELLS; i++) {
    if (owner[i] === p) {
      colors[i] = color;
      queue.push(i);
      dist.set(i, 0);
    }
  }
  const gained = [];
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    for (const j of NEIGHBORS[i]) {
      if (owner[j] === 0 && colors[j] === color) {
        owner[j] = p;
        const d = dist.get(i) + 1;
        dist.set(j, d);
        gained.push({ i: j, d });
        queue.push(j);
      }
    }
  }
  return gained;
}

// Number of cells `color` would gain for p, without mutating anything.
function gainFor(colors, owner, p, color) {
  const o = owner.slice();
  const c = colors.slice();
  return applyColor(c, o, p, color).length;
}

function isOver(owner, moveCount = 0) {
  const n = counts(owner);
  return n[1] > HALF || n[2] > HALF || n[1] + n[2] === CELLS || moveCount >= MAX_MOVES;
}

function winnerOf(owner) {
  const n = counts(owner);
  return n[1] > n[2] ? 1 : n[2] > n[1] ? 2 : 0;
}

// ---- Search ------------------------------------------------------------------------------------

const LEVELS = {
  easy: { kind: 'random' },
  medium: { kind: 'greedy' },
  hard: { kind: 'search', depth: 4, time: 400, noise: 0.3 },
  expert: { kind: 'search', depth: 14, time: 900, noise: 0 },
};

class Timeout extends Error {}
const WIN = 100000;

// Typed-array fast path for the search: colours + owner packed into Int8Arrays.
function play(colors, owner, p, color) {
  const queue = [];
  for (let i = 0; i < CELLS; i++) if (owner[i] === p) { colors[i] = color; queue.push(i); }
  let gained = 0;
  for (let q = 0; q < queue.length; q++) {
    const nb = NEIGHBORS[queue[q]];
    for (let k = 0; k < nb.length; k++) {
      const j = nb[k];
      if (owner[j] === 0 && colors[j] === color) { owner[j] = p; queue.push(j); gained++; }
    }
  }
  return gained;
}

// Static evaluation from p's point of view: cell difference, plus a little for how many unowned
// cells border each region (room to grow next turn).
function evaluate(colors, owner, p) {
  let mine = 0;
  let theirs = 0;
  let fMine = 0;
  let fTheirs = 0;
  const q = other(p);
  for (let i = 0; i < CELLS; i++) {
    const o = owner[i];
    if (o === p) mine++;
    else if (o === q) theirs++;
    else {
      const nb = NEIGHBORS[i];
      let a = false;
      let b = false;
      for (let k = 0; k < nb.length; k++) {
        if (owner[nb[k]] === p) a = true;
        else if (owner[nb[k]] === q) b = true;
      }
      if (a) fMine++;
      if (b) fTheirs++;
    }
  }
  if (mine > HALF) return WIN + mine;
  if (theirs > HALF) return -WIN - theirs;
  if (mine + theirs === CELLS) return mine === theirs ? 0 : mine > theirs ? WIN : -WIN;
  return (mine - theirs) * 10 + (fMine - fTheirs) * 2;
}

function makeSearch(deadline) {
  let nodes = 0;
  function negamax(colors, owner, p, depth, alpha, beta) {
    if ((++nodes & 1023) === 0 && Date.now() > deadline) throw new Timeout();
    const v = evaluate(colors, owner, p);
    if (depth === 0 || Math.abs(v) >= WIN) return v;
    const moves = legalColors(colors, p);
    // Move ordering: biggest immediate gain first.
    const children = moves.map((m) => {
      const c = colors.slice();
      const o = owner.slice();
      const g = play(c, o, p, m);
      return { c, o, g };
    }).sort((a, b) => b.g - a.g);
    let best = -Infinity;
    for (const ch of children) {
      const s = -negamax(ch.c, ch.o, other(p), depth - 1, -beta, -alpha);
      if (s > best) best = s;
      if (s > alpha) alpha = s;
      if (alpha >= beta) break;
    }
    return best;
  }
  return {
    root(colors, owner, p, depth) {
      return legalColors(colors, p).map((m) => {
        const c = colors.slice();
        const o = owner.slice();
        play(c, o, p, m);
        return { m, v: -negamax(c, o, other(p), depth - 1, -Infinity, Infinity) };
      });
    },
  };
}

// input: { colors, owner, player (1|2), level, timeMs } -> { color, depth }
function bestMove({ colors, owner, player, level = 'hard', timeMs }) {
  const lv = LEVELS[level] || LEVELS.hard;
  const p = player;
  const moves = legalColors(colors, p);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  if (lv.kind === 'random') {
    // Mostly random, but never a zero-gain colour when something better exists half the time.
    const gains = moves.map((m) => ({ m, g: gainFor(colors, owner, p, m) }));
    const useful = gains.filter((x) => x.g > 0);
    return { color: pick(useful.length && Math.random() < 0.5 ? useful : gains).m, depth: 0 };
  }
  if (lv.kind === 'greedy') {
    const gains = moves.map((m) => ({ m, g: gainFor(colors, owner, p, m) }));
    const top = Math.max(...gains.map((x) => x.g));
    return { color: pick(gains.filter((x) => x.g === top)).m, depth: 1 };
  }
  const c0 = Int8Array.from(colors);
  const o0 = Int8Array.from(owner);
  const deadline = Date.now() + Math.min(lv.time, timeMs || lv.time);
  const search = makeSearch(deadline);
  let scores = null;
  let reached = 0;
  for (let d = 1; d <= lv.depth; d++) {
    try {
      scores = search.root(c0, o0, p, d);
      reached = d;
    } catch (e) {
      if (!(e instanceof Timeout)) throw e;
      break;
    }
    if (scores.every((s) => Math.abs(s.v) >= WIN)) break; // proven
  }
  if (!scores) scores = moves.map((m) => ({ m, v: gainFor(colors, owner, p, m) }));
  let best = moves[0];
  let bestV = -Infinity;
  for (const s of scores) {
    const v = s.v + (lv.noise ? (Math.random() * 2 - 1) * lv.noise * 10 : 0);
    if (v > bestV) { bestV = v; best = s.m; }
  }
  return { color: best, depth: reached };
}

module.exports = {
  COLS, ROWS, CELLS, NCOLORS, HALF, START, NEIGHBORS, LEVELS,
  randomBoard, initialOwner, colorOf, other, legalColors, counts, applyColor, gainFor, isOver, winnerOf,
  evaluate, bestMove,
};
