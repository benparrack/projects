// Crossword: generated freeform crosswords with real clues (data/crossword_clues.json, ~2.2k
// everyday 3-7 letter words with two clues each). Three sizes (MINI / MEDIUM / LARGE) and two
// room-wide modes:
//   coop — everyone fills ONE shared grid; finishing a word (last correct letter) credits it to
//          whoever completed it (their colour, +1 point per letter). Done when the grid is full.
//   race — everyone solves their OWN copy of the same puzzle; first to finish wins. Opponents'
//          progress is shown as counts only.
// Players type letters into cells (`fill`); a word locks once all its cells hold the right
// letters. A fully filled but wrong word is reported back to the typer only (`wrong`), never which
// letter is wrong. Up to 3 hints per player per puzzle reveal one letter (cost 1 point each).
//
// Hidden info: answers never leave the server until the round is over. Clients get the grid
// geometry, clue text and the letters actually entered on the board they are looking at.
//
// Generation: greedy crossing placement (a word may only touch the grid where it crosses), many
// attempts, best layout kept. Every maximal run of 2+ letters in the grid is exactly one placed
// word (checked by validateLayout, also in the tests), so numbering works like a real crossword.
//
// Bots (tickBots.js ids) "work on" a clue — shown as their cursor in co-op — and fill it after a
// level-dependent delay; weaker bots sometimes stall. Event-driven: no tick loop, timers
// re-validate roundId/phase/player on fire.

'use strict';

const CLUES = require('./data/crossword_clues.json');
const { isBotId, newBot, dropBotsIfAlone } = require('./tickBots');
const { reportRanked } = require('./wordResults');

const TYPE = 'crossword';
const COLOR_PALETTE = ['#00eaff', '#ff2fb0', '#ffb000', '#8c52ff', '#00ffa2', '#ff4d4d', '#ffee58', '#39ff14'];
const SIZES = {
  mini: { label: 'MINI', words: [5, 7], maxDim: 7, len: [3, 5], attempts: 24 },
  medium: { label: 'MEDIUM', words: [9, 12], maxDim: 10, len: [3, 6], attempts: 14 },
  large: { label: 'LARGE', words: [14, 18], maxDim: 13, len: [3, 7], attempts: 8 },
};
const DEFAULT_SIZE = 'medium';
const MODES = ['coop', 'race'];
const HINTS_PER_ROUND = 3;
const HINT_COST = 1;
const COUNTDOWN_MS = 3000;
const BOT_CFG = { countdownMs: COUNTDOWN_MS, speedK: 1 }; // tests shrink these

// Per-word delay (ms, scaled by word length / 5) and the chance a cycle is a stall (no fill).
const BOT_SPEED = {
  easy: { ms: [16000, 24000], stall: 0.35 },
  medium: { ms: [10000, 15000], stall: 0.2 },
  hard: { ms: [6000, 9000], stall: 0.08 },
  expert: { ms: [3200, 5200], stall: 0 },
};

const WORDS = Object.keys(CLUES).filter((w) => /^[a-z]{3,7}$/.test(w) && CLUES[w].length);

// ---- generation ------------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const key = (r, c) => `${r},${c}`;
const DIR = { across: [0, 1], down: [1, 0] };

// Layout under construction: cells Map "r,c" -> { l, a: across word idx?, d: down word idx? }.
function newLayout() {
  return { cells: new Map(), byLetter: new Map(), words: [], minR: 0, maxR: 0, minC: 0, maxC: 0, crossings: 0 };
}

// Returns the number of crossings if `word` fits at (r, c) going `dir`, else -1.
function fit(lay, word, r, c, dir, maxDim) {
  const [dr, dc] = DIR[dir];
  const len = word.length;
  const er = r + dr * (len - 1);
  const ec = c + dc * (len - 1);
  if (lay.words.length) {
    if (Math.max(lay.maxR, er) - Math.min(lay.minR, r) + 1 > maxDim) return -1;
    if (Math.max(lay.maxC, ec) - Math.min(lay.minC, c) + 1 > maxDim) return -1;
  }
  // The cells just before and after the word must be empty.
  if (lay.cells.has(key(r - dr, c - dc)) || lay.cells.has(key(er + dr, ec + dc))) return -1;
  let crossings = 0;
  for (let i = 0; i < len; i++) {
    const rr = r + dr * i;
    const cc = c + dc * i;
    const cell = lay.cells.get(key(rr, cc));
    if (cell) {
      if (cell.l !== word[i]) return -1;
      if (dir === 'across' ? cell.a != null : cell.d != null) return -1; // overlapping same direction
      crossings++;
    } else {
      // An empty cell may not touch anything sideways (that would form an unclued 2-letter run).
      if (lay.cells.has(key(rr + dc, cc + dr)) || lay.cells.has(key(rr - dc, cc - dr))) return -1;
    }
  }
  return crossings;
}

function place(lay, word, r, c, dir, crossings) {
  const [dr, dc] = DIR[dir];
  const idx = lay.words.length;
  lay.words.push({ word, r, c, dir });
  for (let i = 0; i < word.length; i++) {
    const k = key(r + dr * i, c + dc * i);
    let cell = lay.cells.get(k);
    if (!cell) {
      const [rr, cc] = [r + dr * i, c + dc * i];
      cell = { l: word[i], r: rr, c: cc };
      if (!lay.byLetter.has(cell.l)) lay.byLetter.set(cell.l, []);
      lay.byLetter.get(cell.l).push(cell);
    }
    if (dir === 'across') cell.a = idx; else cell.d = idx;
    lay.cells.set(k, cell);
  }
  const er = r + dr * (word.length - 1);
  const ec = c + dc * (word.length - 1);
  if (idx === 0) { lay.minR = r; lay.maxR = er; lay.minC = c; lay.maxC = ec; } else {
    lay.minR = Math.min(lay.minR, r); lay.maxR = Math.max(lay.maxR, er);
    lay.minC = Math.min(lay.minC, c); lay.maxC = Math.max(lay.maxC, ec);
  }
  lay.crossings += crossings;
}

// All placements of `word` that cross the existing grid, as [r, c, dir, crossings].
function placementsFor(lay, word, maxDim) {
  const out = [];
  const seen = new Set();
  for (let i = 0; i < word.length; i++) {
    for (const cell of lay.byLetter.get(word[i]) || []) {
      const r0 = cell.r;
      const c0 = cell.c;
      for (const dir of ['across', 'down']) {
        if (dir === 'across' ? cell.a != null : cell.d != null) continue;
        const [dr, dc] = DIR[dir];
        const r = r0 - dr * i;
        const c = c0 - dc * i;
        const id = `${r},${c},${dir}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const x = fit(lay, word, r, c, dir, maxDim);
        if (x > 0) out.push([r, c, dir, x]);
      }
    }
  }
  return out;
}

function tryLayout(cfg, rand) {
  const [minLen, maxLen] = cfg.len;
  const pool = shuffle(WORDS.filter((w) => w.length >= minLen && w.length <= maxLen), rand);
  const lay = newLayout();
  const used = new Set();
  const first = pool.find((w) => w.length >= Math.min(maxLen, 5));
  place(lay, first, 0, 0, rand() < 0.5 ? 'across' : 'down', 0);
  used.add(first);
  const target = cfg.words[0] + Math.floor(rand() * (cfg.words[1] - cfg.words[0] + 1));
  let cursor = 0;
  while (lay.words.length < target) {
    // Look at a window of candidates and take the placement with the most crossings (ties: longer
    // word, then random), which keeps grids dense and interlocked.
    let best = null;
    let looked = 0;
    for (let k = 0; k < pool.length && looked < 140; k++) {
      const w = pool[(cursor + k) % pool.length];
      if (used.has(w)) continue;
      looked++;
      for (const [r, c, dir, x] of placementsFor(lay, w, cfg.maxDim)) {
        const score = x * 10 + w.length + rand() * 3;
        if (!best || score > best.score) best = { w, r, c, dir, x, score };
      }
    }
    cursor = (cursor + 140) % pool.length;
    if (!best) break;
    place(lay, best.w, best.r, best.c, best.dir, best.x);
    used.add(best.w);
  }
  return lay;
}

// Normalise to a 0-based grid, number it, and attach clues.
function finalize(lay, rand) {
  const rows = lay.maxR - lay.minR + 1;
  const cols = lay.maxC - lay.minC + 1;
  const words = lay.words.map((w) => ({ answer: w.word, r: w.r - lay.minR, c: w.c - lay.minC, dir: w.dir }));
  const starts = [...new Set(words.map((w) => w.r * 100 + w.c))].sort((a, b) => a - b);
  const numOf = new Map(starts.map((s, i) => [s, i + 1]));
  for (const w of words) {
    w.num = numOf.get(w.r * 100 + w.c);
    const clues = CLUES[w.answer];
    w.clue = clues[Math.floor(rand() * clues.length)];
    w.len = w.answer.length;
  }
  words.sort((a, b) => (a.dir === b.dir ? a.num - b.num : a.dir === 'across' ? -1 : 1));
  words.forEach((w, i) => { w.id = i; });
  const solution = Array.from({ length: rows }, () => Array(cols).fill(null));
  for (const w of words) {
    const [dr, dc] = DIR[w.dir];
    for (let i = 0; i < w.len; i++) solution[w.r + dr * i][w.c + dc * i] = w.answer[i];
  }
  return { rows, cols, words, solution };
}

// '' if every maximal run of 2+ letters is exactly one word and the grid is connected.
function validateLayout(pz) {
  const { rows, cols, solution, words } = pz;
  const expect = new Set(words.map((w) => `${w.dir}:${w.r},${w.c}:${w.len}`));
  const runs = new Set();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!solution[r][c]) continue;
      if ((c === 0 || !solution[r][c - 1]) && c + 1 < cols && solution[r][c + 1]) {
        let n = 0; while (c + n < cols && solution[r][c + n]) n++;
        runs.add(`across:${r},${c}:${n}`);
      }
      if ((r === 0 || !solution[r - 1][c]) && r + 1 < rows && solution[r + 1][c]) {
        let n = 0; while (r + n < rows && solution[r + n][c]) n++;
        runs.add(`down:${r},${c}:${n}`);
      }
    }
  }
  if (runs.size !== expect.size || [...runs].some((x) => !expect.has(x))) return 'stray_run';
  for (const w of words) {
    const [dr, dc] = DIR[w.dir];
    for (let i = 0; i < w.len; i++) if (solution[w.r + dr * i][w.c + dc * i] !== w.answer[i]) return 'mismatch';
  }
  const cells = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (solution[r][c]) cells.push([r, c]);
  const seen = new Set([key(...cells[0])]);
  const stack = [cells[0]];
  while (stack.length) {
    const [r, c] = stack.pop();
    for (const [nr, nc] of [[r + 1, c], [r - 1, c], [r, c + 1], [r, c - 1]]) {
      if (nr < 0 || nc < 0 || nr >= rows || nc >= cols || !solution[nr][nc] || seen.has(key(nr, nc))) continue;
      seen.add(key(nr, nc));
      stack.push([nr, nc]);
    }
  }
  return seen.size === cells.length ? '' : 'disconnected';
}

function makePuzzle(size, seed) {
  const cfg = SIZES[size] || SIZES[DEFAULT_SIZE];
  const rand = mulberry32(seed);
  let best = null;
  for (let attempt = 0; attempt < cfg.attempts; attempt++) {
    const lay = tryLayout(cfg, rand);
    const area = (lay.maxR - lay.minR + 1) * (lay.maxC - lay.minC + 1);
    const score = lay.words.length * 100 + lay.crossings * 12 - area * 0.5;
    if (!best || score > best.score) best = { lay, score };
    if (lay.words.length >= cfg.words[1] && lay.crossings >= lay.words.length) break;
  }
  return { size, seed, ...finalize(best.lay, rand) };
}

// ---- boards ----------------------------------------------------------------------------------

// A board is what one grid looks like: letters typed so far plus which words are done.
// entries: Map "r,c" -> { l, by, lock: 0 | 1 (solved) | 2 (hint) }; solved: Map wordId -> clientId.
const newBoard = () => ({ entries: new Map(), solved: new Map() });

function wordCells(w) {
  const [dr, dc] = DIR[w.dir];
  return Array.from({ length: w.len }, (_, i) => [w.r + dr * i, w.c + dc * i]);
}

const wordsAt = (pz, r, c) => pz.words.filter((w) => wordCells(w).some(([rr, cc]) => rr === r && cc === c));

const boardOf = (st, p) => (st.mode === 'coop' ? st.board : p.board);

function freshPlayer(clientId, nickname, colorIdx) {
  return {
    clientId, nickname, color: COLOR_PALETTE[colorIdx % COLOR_PALETTE.length], bot: null,
    score: 0, solved: 0, wins: 0, hintsLeft: HINTS_PER_ROUND, inRound: false, finishedAt: null,
    board: newBoard(), cursor: null, botTimer: null,
  };
}

// After cells change on `board`, lock any word that is now fully correct (credited to `p`) and
// report words that are fully filled but wrong. Returns { solvedIds, wrongIds }.
function settle(st, board, p, changed) {
  const pz = st.puzzle;
  const solvedIds = [];
  const wrongIds = [];
  const ids = new Set();
  for (const [r, c] of changed) for (const w of wordsAt(pz, r, c)) ids.add(w.id);
  for (const id of ids) {
    if (board.solved.has(id)) continue;
    const w = pz.words[id];
    const cells = wordCells(w);
    const letters = cells.map(([r, c]) => (board.entries.get(key(r, c)) || {}).l || '');
    if (letters.some((l) => !l)) continue;
    if (letters.join('') !== w.answer) { wrongIds.push(id); continue; }
    board.solved.set(id, p.clientId);
    for (const [r, c] of cells) board.entries.get(key(r, c)).lock ||= 1;
    p.solved += 1;
    p.score += w.len;
    solvedIds.push(id);
  }
  return { solvedIds, wrongIds };
}

const boardDone = (st, board) => board.solved.size === st.puzzle.words.length;

// ---- round flow ------------------------------------------------------------------------------

function startRound(room, size, mode) {
  const st = room.state;
  st.size = SIZES[size] ? size : st.size;
  st.mode = MODES.includes(mode) ? mode : st.mode;
  st.puzzle = makePuzzle(st.size, (Math.random() * 2 ** 31) >>> 0);
  st.board = newBoard();
  st.roundId += 1;
  st.phase = 'playing';
  st.startedAt = Date.now() + BOT_CFG.countdownMs;
  st.endedAt = null;
  st.endReason = null;
  st.winner = null;
  st.lastSolve = null;
  for (const p of st.players.values()) {
    p.score = 0; p.solved = 0; p.hintsLeft = HINTS_PER_ROUND; p.inRound = true; p.finishedAt = null;
    p.board = newBoard(); p.cursor = null; p.gaveUp = false;
  }
  clearBotTimers(st);
  for (const p of st.players.values()) if (p.bot) scheduleBot(room, p.clientId);
}

function endRound(room, reason, winnerId = null) {
  const st = room.state;
  if (st.phase !== 'playing') return;
  st.phase = 'results';
  st.endReason = reason;
  st.endedAt = Date.now();
  st.winner = winnerId;
  clearBotTimers(st);
  for (const p of st.players.values()) p.cursor = null;
  if (reason === 'revealed') return;
  // Result: race = the finisher first, then the rest by words solved; co-op = one shared place.
  // The score is the solve time (only the race winner has one).
  const ms = st.endedAt - st.startedAt;
  reportRanked(room, [...st.players.values()].filter((p) => p.inRound).map((p) => (st.mode === 'coop' || p.clientId === winnerId
    ? { id: p.clientId, rank: Infinity, score: ms, level: p.bot }
    : { id: p.clientId, rank: p.solved, level: p.bot })));
  if (st.mode === 'race') {
    const w = st.players.get(winnerId);
    if (w) w.wins += 1;
  } else {
    const ranked = [...st.players.values()].filter((p) => p.inRound);
    const top = Math.max(0, ...ranked.map((p) => p.score));
    if (top > 0) for (const p of ranked) if (p.score === top) p.wins += 1;
  }
}

// Apply letter changes for player p (already validated); handles solving and round end.
// Returns the settle result.
function applyChanges(room, p, changes) {
  const st = room.state;
  const board = boardOf(st, p);
  for (const { r, c, l, lock } of changes) {
    const k = key(r, c);
    const cur = board.entries.get(k);
    if (cur && cur.lock) continue;
    if (!l) board.entries.delete(k);
    else board.entries.set(k, { l, by: p.clientId, lock: lock || 0 });
  }
  const res = settle(st, board, p, changes.map(({ r, c }) => [r, c]));
  if (res.solvedIds.length) {
    const w = st.puzzle.words[res.solvedIds[res.solvedIds.length - 1]];
    st.lastSolve = { seq: (st.lastSolve ? st.lastSolve.seq : 0) + 1, clientId: p.clientId, num: w.num, dir: w.dir, mode: st.mode };
  }
  if (boardDone(st, board)) {
    if (st.mode === 'coop') endRound(room, 'complete');
    else { p.finishedAt = Date.now(); endRound(room, 'finished', p.clientId); }
  }
  return res;
}

// ---- bots ------------------------------------------------------------------------------------

function pickBotWord(st, board) {
  const open = st.puzzle.words.filter((w) => !board.solved.has(w.id));
  if (!open.length) return null;
  // Prefer clues with more letters already showing, then shorter words; a little randomness.
  let best = null;
  for (const w of open) {
    const known = wordCells(w).filter(([r, c]) => { const e = board.entries.get(key(r, c)); return e && e.lock; }).length;
    const s = known / w.len * 3 - w.len * 0.25 + Math.random() * 1.5;
    if (!best || s > best.s) best = { w, s };
  }
  return best.w;
}

function scheduleBot(room, clientId, quick = false) {
  const st = room.state;
  const p = st.players.get(clientId);
  if (!p || !p.bot || st.phase !== 'playing') return;
  const board = boardOf(st, p);
  const target = pickBotWord(st, board);
  if (!target) return;
  p.cursor = target.id;
  const lv = BOT_SPEED[p.bot] || BOT_SPEED.hard;
  const base = lv.ms[0] + Math.random() * (lv.ms[1] - lv.ms[0]);
  const delay = (quick ? 600 : base * (0.6 + target.len / 12.5)) * BOT_CFG.speedK;
  const wait = Math.max(0, st.startedAt - Date.now()) + delay;
  const roundId = st.roundId;
  if (p.botTimer) clearTimeout(p.botTimer);
  p.botTimer = setTimeout(() => {
    p.botTimer = null;
    if (st.roundId !== roundId || st.phase !== 'playing' || st.players.get(clientId) !== p) return;
    const b = boardOf(st, p);
    if (b.solved.has(target.id)) { scheduleBot(room, clientId, true); broadcastState(room); return; }
    if (Math.random() < lv.stall) { scheduleBot(room, clientId); broadcastState(room); return; }
    const changes = wordCells(target).map(([r, c], i) => ({ r, c, l: target.answer[i] }));
    applyChanges(room, p, changes);
    if (st.phase === 'playing') scheduleBot(room, clientId);
    broadcastState(room);
  }, wait);
}

function clearBotTimers(st) {
  for (const p of st.players.values()) if (p.botTimer) { clearTimeout(p.botTimer); p.botTimer = null; }
}

// ---- views -----------------------------------------------------------------------------------

function boardView(board) {
  return {
    entries: [...board.entries].map(([k, e]) => { const [r, c] = k.split(',').map(Number); return [r, c, e.l, e.by, e.lock]; }),
    solved: Object.fromEntries(board.solved),
  };
}

function buildView(room, forId) {
  const st = room.state;
  const pz = st.puzzle;
  const over = st.phase === 'results';
  const me = st.players.get(forId);
  let board = null;
  if (pz) board = st.mode === 'coop' ? st.board : (me ? me.board : newBoard());
  const cells = [];
  if (pz) {
    const nums = new Map(pz.words.map((w) => [key(w.r, w.c), w.num]));
    for (let r = 0; r < pz.rows; r++) for (let c = 0; c < pz.cols; c++) if (pz.solution[r][c]) cells.push([r, c, nums.get(key(r, c)) || 0]);
  }
  return {
    kind: 'state',
    phase: st.phase,
    mode: st.mode,
    size: st.size,
    sizes: Object.fromEntries(Object.entries(SIZES).map(([k, v]) => [k, v.label])),
    roundId: st.roundId,
    startedAt: st.startedAt,
    endedAt: st.endedAt,
    endReason: st.endReason,
    winner: st.winner,
    serverNow: Date.now(),
    lastSolve: st.lastSolve,
    hintCost: HINT_COST,
    rows: pz ? pz.rows : 0,
    cols: pz ? pz.cols : 0,
    cells,
    clues: pz ? pz.words.map((w) => ({
      id: w.id, num: w.num, dir: w.dir, r: w.r, c: w.c, len: w.len, clue: w.clue,
      // The answer only once the round is over.
      answer: over ? w.answer : undefined,
    })) : [],
    board: board ? boardView(board) : null,
    players: [...st.players.values()].map((p) => ({
      clientId: p.clientId, nickname: p.nickname, color: p.color, bot: p.bot || undefined,
      score: p.score, solved: p.solved, wins: p.wins, inRound: p.inRound, hintsLeft: p.hintsLeft,
      gaveUp: !!p.gaveUp,
      // Co-op: which clue they're on (shown as an outline). Race: progress only.
      cursor: st.mode === 'coop' && st.phase === 'playing' ? p.cursor : null,
      filled: st.mode === 'race' && pz ? p.board.entries.size : undefined,
    })),
    totalCells: cells.length,
  };
}

function broadcastState(room) {
  for (const id of room.clients.keys()) {
    room.sendTo(id, { v: 1, type: 'game.event', payload: { gameType: TYPE, data: buildView(room, id) } });
  }
}

function reply(ctx, data) {
  ctx.sendTo(ctx.senderId, { v: 1, type: 'game.event', payload: { gameType: TYPE, data } });
}

const isCell = (st, r, c) => Number.isInteger(r) && Number.isInteger(c) && r >= 0 && c >= 0
  && r < st.puzzle.rows && c < st.puzzle.cols && !!st.puzzle.solution[r][c];

// ---- plugin ----------------------------------------------------------------------------------

module.exports = {
  type: TYPE,
  stats: { rated: true, score: { label: 'Solve time', better: 'low', format: 'ms' } },

  createInitialState() {
    return {
      phase: 'waiting', // 'waiting' | 'playing' | 'results'
      mode: 'coop',
      size: DEFAULT_SIZE,
      puzzle: null,
      board: newBoard(),
      roundId: 0,
      startedAt: null,
      endedAt: null,
      endReason: null,
      winner: null,
      lastSolve: null,
      nextColorIdx: 0,
      players: new Map(),
    };
  },

  serializeSnapshot(room, client) {
    return buildView(room, client ? client.clientId : null);
  },

  onJoin(room, client) {
    const st = room.state;
    const p = freshPlayer(client.clientId, client.nickname, st.nextColorIdx++);
    p.bot = client.bot || null;
    p.inRound = st.phase === 'playing';
    st.players.set(client.clientId, p);
    if (p.bot && st.phase === 'playing') scheduleBot(room, p.clientId);
    if (!p.bot) broadcastState(room);
  },

  onLeave(room, client) {
    const st = room.state;
    const p = st.players.get(client.clientId);
    if (p && p.botTimer) clearTimeout(p.botTimer);
    st.players.delete(client.clientId);
    dropBotsIfAlone(st.players);
    if (![...st.players.keys()].some((id) => !isBotId(id))) {
      clearBotTimers(st);
      if (st.phase === 'playing') { st.phase = 'waiting'; st.roundId += 1; }
      return;
    }
    if (st.phase === 'playing' && st.mode === 'race') maybeAllGaveUp(room);
    broadcastState(room);
  },

  onMessage(room, client, data, ctx) {
    if (!data || typeof data.kind !== 'string') return;
    const st = room.state;
    const me = st.players.get(ctx.senderId);
    if (!me) return;

    if (data.kind === 'start') {
      if (st.phase === 'playing') return;
      startRound(room, data.size, data.mode);
      broadcastState(room);
      return;
    }
    if (data.kind === 'addBot') {
      const b = newBot(st.players, data.level);
      if (!b) return;
      module.exports.onJoin(room, { clientId: b.clientId, nickname: b.nickname, bot: b.level });
      broadcastState(room);
      return;
    }
    if (data.kind === 'removeBot') {
      if (!isBotId(data.clientId)) return;
      const b = st.players.get(data.clientId);
      if (!b) return;
      if (b.botTimer) clearTimeout(b.botTimer);
      st.players.delete(data.clientId);
      broadcastState(room);
      return;
    }

    if (st.phase !== 'playing' || !st.puzzle) return;
    if (Date.now() < st.startedAt) return reply(ctx, { kind: 'rejected', reason: 'countdown' });
    if (me.gaveUp) return;
    me.inRound = true;

    if (data.kind === 'cursor') {
      const id = data.id === null ? null : Number(data.id);
      if (id !== null && !st.puzzle.words[id]) return;
      if (me.cursor === id) return;
      me.cursor = id;
      if (st.mode === 'coop') broadcastState(room);
      return;
    }

    if (data.kind === 'fill') {
      const r = data.r;
      const c = data.c;
      if (!isCell(st, r, c)) return;
      const l = typeof data.l === 'string' ? data.l.toLowerCase() : '';
      if (l && !/^[a-z]$/.test(l)) return;
      const board = boardOf(st, me);
      const cur = board.entries.get(key(r, c));
      if (cur && cur.lock) return;
      if ((cur ? cur.l : '') === l) return;
      const res = applyChanges(room, me, [{ r, c, l }]);
      if (res.wrongIds.length) reply(ctx, { kind: 'wrong', ids: res.wrongIds });
      broadcastState(room);
      return;
    }

    if (data.kind === 'hint') {
      const w = st.puzzle.words[Number(data.id)];
      if (!w || me.hintsLeft <= 0) return reply(ctx, { kind: 'rejected', reason: 'no_hints' });
      const board = boardOf(st, me);
      if (board.solved.has(w.id)) return;
      // Reveal the first cell that isn't already right (a wrong letter there gets corrected).
      const cells = wordCells(w);
      const i = cells.findIndex(([r, c], j) => { const e = board.entries.get(key(r, c)); return !e || e.l !== w.answer[j]; });
      if (i === -1) return;
      const [r, c] = cells[i];
      me.hintsLeft -= 1;
      me.score -= HINT_COST;
      applyChanges(room, me, [{ r, c, l: w.answer[i], lock: 2 }]);
      broadcastState(room);
      return;
    }

    if (data.kind === 'giveUp') {
      if (st.mode === 'coop') endRound(room, 'revealed');
      else { me.gaveUp = true; maybeAllGaveUp(room); }
      broadcastState(room);
    }
  },

  _test: {
    makePuzzle, validateLayout, wordCells, BOT_SPEED, BOT_CFG, SIZES, WORDS, mulberry32,
  },
};

// Race: once every human still in the round has given up, reveal the answers.
function maybeAllGaveUp(room) {
  const st = room.state;
  const humans = [...st.players.values()].filter((p) => !p.bot && p.inRound);
  if (humans.length && humans.every((p) => p.gaveUp)) endRound(room, 'revealed');
}
