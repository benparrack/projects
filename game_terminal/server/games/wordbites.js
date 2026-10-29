// Word Bites (GamePigeon-style). Everyone gets the SAME set of letter pieces on an 8-wide x 9-tall
// board: single letters, horizontal pairs (read left-to-right) and vertical pairs (read
// top-to-bottom). Pieces can't be rotated. Each player drags the pieces around on their OWN copy
// of the board for 80 seconds; whenever a drop leaves a complete run of 3+ letters (left-to-right
// or top-to-bottom, bounded by empty cells / the edge) that is a real word they haven't scored
// yet, it scores: 3=100, 4=400, 5=800, 6=1400, 7=1800, 8+=2200. Highest total wins.
//
// The server is authoritative: it keeps every player's arrangement, applies each 'move' (one
// piece to a new top-left cell), and scores the runs through the moved piece. Nobody sees anyone
// else's board or words until the round is over. Event-driven (setTimeout, no tick loop).
//
// Bots don't move pieces; they "find" words from the precomputed list of words the piece set can
// form, at a level-dependent pace and with a level-dependent taste for long words.

'use strict';

const { DICT_LIST, COMMON_SET, isWord } = require('./words');
const { isBotId, newBot, dropBotsIfAlone } = require('./tickBots');
const { reportRanked } = require('./wordResults');
const { mulberry32 } = require('../daily');

const TYPE = 'wordbites';
const COLS = 8;
const ROWS = 9;
const ROUND_MS = 80 * 1000;
const COUNTDOWN_MS = 3000;
const MIN_LEN = 3;
const COLOR_PALETTE = ['#00eaff', '#ff2fb0', '#39ff14', '#ffb000', '#8c52ff', '#ff4d4d', '#ffee58', '#00ffa2'];
const PIECE_MIX = { s: 7, h: 4, v: 4 };

const pointsFor = (len) => (len <= 2 ? 0 : len === 3 ? 100 : len === 4 ? 400 : len === 5 ? 800 : len === 6 ? 1400 : len === 7 ? 1800 : 2200);

// The shared dictionary also holds the system word list, whose short entries include
// abbreviations — not fun as Word Bites answers.
const SHORT_JUNK = new Set((
  'adj adv amt avg bpm cal dds doz dpi eds esp est etc foo ftp fum fwd gov hgt hoc hos hrs hwy ' +
  'iii inc ind int lbs lii lix lvi lxi meg mes mfg mfr min mpg mph neg non obj pct pkg pwn rpm rps ' +
  'rte tbs tsp vii viz vol xci xii xiv xix xor xvi xxi xxv xxx yrs'
).split(/\s+/));
const isValid = (w) => w.length >= MIN_LEN && !SHORT_JUNK.has(w) && isWord(w);

// Candidate words for the solver (built lazily, once): valid words that could fit the board.
let CANDS = null;
function candidates() {
  if (!CANDS) {
    CANDS = DICT_LIST.filter((w) => w.length >= MIN_LEN && w.length <= ROWS && isValid(w))
      .map((w) => ({ w, counts: countsOf(w), common: COMMON_SET.has(w) }));
  }
  return CANDS;
}

function countsOf(s) {
  const c = new Array(26).fill(0);
  for (const ch of s) c[ch.charCodeAt(0) - 97]++;
  return c;
}

// --- piece generation ---------------------------------------------------------------------------
const SINGLE_FREQ = 'eeeeeeeeeeaaaaaaaiiiiiiooooooutttttttnnnnnnssssssrrrrrrllllldddddcccmmmpppgghhbbyyfwkv';
const PAIRS = ['th', 'he', 'in', 'er', 'an', 're', 'on', 'at', 'en', 'nd', 'ti', 'es', 'or', 'te', 'ed', 'is',
  'it', 'al', 'ar', 'st', 'to', 'nt', 'ng', 'se', 'ha', 'as', 'ou', 'le', 've', 'co', 'me', 'de', 'hi', 'ri',
  'ro', 'ic', 'ne', 'ea', 'ra', 'ce', 'li', 'ch', 'll', 'be', 'ma', 'si', 'om', 'ur', 'ow', 'ai', 'qu', 'sh',
  'ck', 'ee', 'oo', 'pl', 'tr', 'ly', 'ss', 'ab', 'ac', 'el', 'il', 'ol', 'un', 'us', 'ut', 'id', 'ad', 'ap'];
const VOWELS = new Set('aeiou');

function rollPieces(rand) {
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const pieces = [];
  let id = 0;
  const singles = [];
  while (singles.length < PIECE_MIX.s) singles.push(pick(SINGLE_FREQ));
  // At least 3 single vowels, and singles don't repeat a letter more than twice.
  for (let i = 0, v = singles.filter((l) => VOWELS.has(l)).length; v < 3 && i < singles.length; i++) {
    if (!VOWELS.has(singles[i])) { singles[i] = pick('aeiou'); v++; }
  }
  for (const l of singles) pieces.push({ id: id++, kind: 's', letters: l });
  const used = new Set();
  for (const kind of ['h', 'v']) {
    for (let k = 0; k < PIECE_MIX[kind]; k++) {
      let p;
      do p = pick(PAIRS); while (used.has(p));
      used.add(p);
      pieces.push({ id: id++, kind, letters: p });
    }
  }
  return pieces;
}

// Can `word` be laid out as one run in direction `dir` ('h' across, 'v' down) from the pieces?
// A run uses, at each position, a single, a pair lying along the run (both letters), or a pair
// lying across the run (one of its two letters, the other sticking out).
function formable(word, pieces, dir) {
  const used = new Array(pieces.length).fill(false);
  const go = (i) => {
    if (i === word.length) return true;
    for (let p = 0; p < pieces.length; p++) {
      if (used[p]) continue;
      const pc = pieces[p];
      if (pc.kind === 's') {
        if (pc.letters !== word[i]) continue;
        used[p] = true; if (go(i + 1)) return true; used[p] = false;
      } else if (pc.kind === dir) {
        if (pc.letters[0] !== word[i] || pc.letters[1] !== word[i + 1]) continue;
        used[p] = true; if (go(i + 2)) return true; used[p] = false;
      } else if (pc.letters[0] === word[i] || pc.letters[1] === word[i]) {
        used[p] = true; if (go(i + 1)) return true; used[p] = false;
      }
    }
    return false;
  };
  return go(0);
}

// Every valid word the piece set can make (as one complete run on the board).
function solve(pieces) {
  const total = countsOf(pieces.map((p) => p.letters).join(''));
  const out = [];
  for (const c of candidates()) {
    let ok = true;
    for (let k = 0; k < 26 && ok; k++) if (c.counts[k] > total[k]) ok = false;
    if (!ok) continue;
    const h = c.w.length <= COLS && formable(c.w, pieces, 'h');
    if (h || formable(c.w, pieces, 'v')) out.push({ word: c.w, common: c.common });
  }
  return out;
}

// Starting arrangement (identical for every player): pieces scattered so no two touch, so the
// board starts with no words on it.
function scatter(pieces, rand) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const occ = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
    const pos = {};
    let ok = true;
    const order = pieces.slice().sort((a, b) => (b.kind !== 's') - (a.kind !== 's'));
    for (const pc of order) {
      const spots = [];
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const cells = cellsOf(pc, r, c);
          if (!cells) continue;
          // the cells and their 4-neighbours must be free
          const clear = cells.every(([cr, cc]) => [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].every(([dr, dc]) => {
            const rr = cr + dr; const c2 = cc + dc;
            return rr < 0 || rr >= ROWS || c2 < 0 || c2 >= COLS || !occ[rr][c2];
          }));
          if (clear) spots.push([r, c]);
        }
      }
      if (!spots.length) { ok = false; break; }
      const [r, c] = spots[Math.floor(rand() * spots.length)];
      for (const [cr, cc] of cellsOf(pc, r, c)) occ[cr][cc] = true;
      pos[pc.id] = [r, c];
    }
    if (ok) return pos;
  }
  // Fallback (never expected): pack them row by row with gaps.
  const pos = {};
  let r = 0; let c = 0;
  for (const pc of pieces) {
    const w = pc.kind === 'h' ? 2 : 1;
    if (c + w > COLS) { c = 0; r += 3; }
    pos[pc.id] = [r, c];
    c += w + 1;
  }
  return pos;
}

function cellsOf(pc, r, c) {
  const cells = pc.kind === 'h' ? [[r, c], [r, c + 1]] : pc.kind === 'v' ? [[r, c], [r + 1, c]] : [[r, c]];
  return cells.every(([a, b]) => a >= 0 && a < ROWS && b >= 0 && b < COLS) ? cells : null;
}

function generatePuzzle(rand = Math.random) {
  let best = null;
  for (let tries = 0; tries < 30; tries++) {
    const pieces = rollPieces(rand);
    const words = solve(pieces);
    const common = words.filter((w) => w.common);
    const long = common.filter((w) => w.word.length >= 6).length;
    const score = Math.min(common.length, 120) + long * 8;
    if (!best || score > best.score) best = { pieces, words, score };
    if (common.length >= 60 && long >= 4) break;
  }
  return { pieces: best.pieces, start: scatter(best.pieces, rand), words: best.words };
}

// Board letters for one arrangement: grid[r][c] = { ch, id } | null.
function gridOf(pieces, pos) {
  const g = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  for (const pc of pieces) {
    const p = pos[pc.id];
    cellsOf(pc, p[0], p[1]).forEach(([r, c], k) => { g[r][c] = { ch: pc.letters[k], id: pc.id }; });
  }
  return g;
}

// Complete runs (bounded by empty cells / edges) of length >= 3 through the given cells.
function runsThrough(g, cells) {
  const out = [];
  const seen = new Set();
  for (const [r, c] of cells) {
    for (const [dr, dc, dir] of [[0, 1, 'h'], [1, 0, 'v']]) {
      let r0 = r; let c0 = c;
      while (r0 - dr >= 0 && c0 - dc >= 0 && g[r0 - dr][c0 - dc]) { r0 -= dr; c0 -= dc; }
      const key = `${dir}${r0},${c0}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let word = '';
      let rr = r0; let cc = c0;
      while (rr < ROWS && cc < COLS && g[rr][cc]) { word += g[rr][cc].ch; rr += dr; cc += dc; }
      if (word.length >= MIN_LEN) out.push({ word, r: r0, c: c0, dir });
    }
  }
  return out;
}

// --- room state -----------------------------------------------------------------------------------
function freshPlayer(clientId, nickname, colorIdx) {
  return { clientId, nickname, color: COLOR_PALETTE[colorIdx % COLOR_PALETTE.length], bot: null,
    score: 0, words: [], found: new Set(), pos: null, wins: 0, inRound: false, botTimer: null };
}

function joinRound(st, p) {
  p.score = 0;
  p.words = [];
  p.found = new Set();
  p.pos = st.puzzle ? JSON.parse(JSON.stringify(st.puzzle.start)) : null;
  p.inRound = true;
}

// Mean ms between finds, the longest word the bot will "see", whether it sticks to everyday
// words, and how strongly it goes after long words (weight = length^pow). Tuned so Easy/Medium
// trail a casual player and Expert (~25 mostly-long words a round) beats all but the best humans.
const BOT = {
  easy: { gap: 9000, maxLen: 4, commonOnly: true, pow: 0 },
  medium: { gap: 6000, maxLen: 5, commonOnly: true, pow: 0 },
  hard: { gap: 4300, maxLen: 6, commonOnly: true, pow: 1 },
  expert: { gap: 3500, maxLen: 9, commonOnly: false, pow: 2 },
};

function scheduleBot(room, p) {
  const st = room.state;
  if (!p.bot || st.phase !== 'playing') return;
  const lv = BOT[p.bot] || BOT.hard;
  const roundId = st.roundId;
  const wait = Math.max(0, st.startedAt - Date.now()) + lv.gap * (0.55 + Math.random() * 0.9);
  clearTimeout(p.botTimer);
  p.botTimer = setTimeout(() => {
    p.botTimer = null;
    if (st.roundId !== roundId || st.phase !== 'playing' || st.players.get(p.clientId) !== p) return;
    const pool = st.puzzle.words.filter((w) => !p.found.has(w.word) && w.word.length <= lv.maxLen && (!lv.commonOnly || w.common));
    if (pool.length) {
      const wt = (w) => w.word.length ** lv.pow;
      let t = pool.reduce((s, w) => s + wt(w), 0) * Math.random();
      let pick = pool[0];
      for (const w of pool) { t -= wt(w); if (t <= 0) { pick = w; break; } }
      award(p, pick.word);
      broadcastState(room);
    }
    scheduleBot(room, p);
  }, wait);
}

function award(p, word) {
  p.found.add(word);
  const pts = pointsFor(word.length);
  p.score += pts;
  p.words.push({ word, pts });
  return pts;
}

function clearTimers(st) {
  clearTimeout(st.roundTimer);
  st.roundTimer = null;
  for (const p of st.players.values()) { clearTimeout(p.botTimer); p.botTimer = null; }
}

function startRound(room) {
  const st = room.state;
  clearTimers(st);
  st.seed = (Math.random() * 2 ** 32) >>> 0;
  st.puzzle = generatePuzzle(mulberry32(st.seed));
  st.roundId += 1;
  st.phase = 'playing';
  st.startedAt = Date.now() + COUNTDOWN_MS;
  st.endsAt = st.startedAt + ROUND_MS;
  for (const p of st.players.values()) joinRound(st, p);
  const roundId = st.roundId;
  st.roundTimer = setTimeout(() => {
    if (st.roundId !== roundId) return;
    endRound(room);
    broadcastState(room);
  }, st.endsAt - Date.now());
  for (const p of st.players.values()) scheduleBot(room, p);
}

function endRound(room) {
  const st = room.state;
  if (st.phase !== 'playing') return;
  st.phase = 'results';
  clearTimers(st);
  const ranked = [...st.players.values()].filter((p) => p.inRound).sort((a, b) => b.score - a.score);
  if (ranked.length) reportRanked(room, ranked.map((p) => ({ id: p.clientId, rank: p.score, score: p.score, level: p.bot })));
  if (ranked.length > 1 && ranked[0].score > 0) for (const p of ranked) if (p.score === ranked[0].score) p.wins += 1;
}

function buildView(room, forId) {
  const st = room.state;
  const over = st.phase === 'results';
  const me = st.players.get(forId);
  const pz = st.puzzle;
  return {
    kind: 'state',
    phase: st.phase,
    roundId: st.roundId,
    cols: COLS,
    rows: ROWS,
    roundMs: ROUND_MS,
    startedAt: st.startedAt,
    endsAt: st.endsAt,
    serverNow: Date.now(),
    pieces: pz ? pz.pieces : [],
    myPos: me && me.pos ? me.pos : (pz ? pz.start : null),
    myWords: me ? me.words : [],
    totalWords: pz ? pz.words.length : 0,
    // Only revealed after the round: a sample of the best words that were possible.
    bestWords: over && pz ? pz.words.filter((w) => w.common).sort((a, b) => b.word.length - a.word.length || a.word.localeCompare(b.word)).slice(0, 12).map((w) => w.word) : null,
    players: [...st.players.values()].map((p) => ({
      clientId: p.clientId, nickname: p.nickname, color: p.color, bot: p.bot || undefined,
      score: p.score, count: p.words.length, wins: p.wins, inRound: p.inRound,
      words: over || p.clientId === forId ? p.words : undefined,
    })),
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

module.exports = {
  type: TYPE,
  stats: { rated: true, score: { label: 'Points', better: 'high', format: 'pts' } },

  createInitialState() {
    return { phase: 'waiting', roundId: 0, seed: 0, puzzle: null, startedAt: null, endsAt: null,
      roundTimer: null, nextColorIdx: 0, players: new Map() };
  },

  serializeSnapshot(room, client) {
    return buildView(room, client ? client.clientId : null);
  },

  onJoin(room, client) {
    const st = room.state;
    const p = freshPlayer(client.clientId, client.nickname, st.nextColorIdx++);
    p.bot = client.bot || null;
    st.players.set(client.clientId, p);
    // Joining mid-round: you get the starting board and the remaining time.
    if (st.phase === 'playing') { joinRound(st, p); scheduleBot(room, p); }
    broadcastState(room);
  },

  onLeave(room, client) {
    const st = room.state;
    const p = st.players.get(client.clientId);
    if (p) clearTimeout(p.botTimer);
    st.players.delete(client.clientId);
    dropBotsIfAlone(st.players);
    if (![...st.players.keys()].some((id) => !isBotId(id))) {
      clearTimers(st);
      if (st.phase === 'playing') { st.phase = 'waiting'; st.roundId += 1; }
      return;
    }
    broadcastState(room);
  },

  onMessage(room, client, data, ctx) {
    if (!data || typeof data.kind !== 'string') return;
    const st = room.state;
    const me = st.players.get(ctx.senderId);
    if (!me) return;

    if (data.kind === 'start') {
      if (st.phase === 'playing') return;
      startRound(room);
      broadcastState(room);
      return;
    }
    if (data.kind === 'addBot') {
      const b = newBot(st.players, data.level);
      if (!b) return;
      module.exports.onJoin(room, { clientId: b.clientId, nickname: b.nickname, bot: b.level });
      return;
    }
    if (data.kind === 'removeBot') {
      const b = isBotId(data.clientId) && st.players.get(data.clientId);
      if (!b) return;
      clearTimeout(b.botTimer);
      st.players.delete(data.clientId);
      broadcastState(room);
      return;
    }

    if (data.kind === 'move') {
      const { id, r, c, seq } = data;
      const deny = (reason) => reply(ctx, { kind: 'moveRejected', reason, seq, pos: me.pos });
      if (st.phase !== 'playing' || !me.pos) return deny('not_playing');
      if (Date.now() < st.startedAt) return deny('countdown');
      if (Date.now() > st.endsAt) return deny('time');
      if (![id, r, c].every(Number.isInteger)) return deny('bad');
      const pc = st.puzzle.pieces.find((x) => x.id === id);
      if (!pc) return deny('bad');
      const cells = cellsOf(pc, r, c);
      if (!cells) return deny('out_of_bounds');
      const g = gridOf(st.puzzle.pieces, me.pos);
      if (cells.some(([a, b]) => g[a][b] && g[a][b].id !== id)) return deny('occupied');
      me.pos[id] = [r, c];
      me.inRound = true;
      const after = gridOf(st.puzzle.pieces, me.pos);
      const scored = [];
      for (const run of runsThrough(after, cells)) {
        if (me.found.has(run.word) || !isValid(run.word)) continue;
        scored.push({ ...run, pts: award(me, run.word) });
      }
      reply(ctx, { kind: 'moved', seq, id, r, c, scored });
      // Only scores changed for everyone else; my own view gets the new words too.
      if (scored.length) broadcastState(room);
    }
  },

  _internals: { endRound, scheduleBot, generatePuzzle, solve, formable, runsThrough, gridOf, cellsOf, scatter, pointsFor, isValid,
    mulberry32, BOT, COLS, ROWS, ROUND_MS },
};
