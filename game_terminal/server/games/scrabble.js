// Scrabble — 2-4 players (ordered seats, turn order = seat index, bots allowed). Standard 15x15
// board with premium squares, the 100-tile English set (2 blanks), hidden 7-tile racks, full
// scoring (letter/word premiums only on newly placed squares, every cross-word scored, 50-point
// bingo for using all 7), exchange (needs >= 7 tiles in the bag), pass, and the standard ending:
// a player goes out with the bag empty (they gain everyone else's rack values, the others lose
// their own), or six scoreless turns in a row (everyone loses their own rack value).
//
// Words are checked against server/games/words.js, minus SHORT_JUNK below: the shared dictionary
// also contains the system word list, whose 2-3 letter entries include abbreviations and Roman
// numerals (CM, XX, ETC, MPH, ...) that would make Scrabble silly — especially for bots, which
// find every legal play.
//
// Bots: an Appel-Jacobson move generator (anchors + cross-checks over a compact trie of the
// dictionary) runs in this same file as a worker thread, started lazily on the first bot turn so
// the trie (~2 MB of typed arrays) is only built if someone plays a bot and the main event loop
// never blocks. Easy plays a weak move, Medium a middling one, Hard the top-scoring move, Expert
// the best score + rack-leave value (and exchanges a bad rack when nothing scores well).

'use strict';

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { isWord } = require('./words');

const SIZE = 15;
const CENTER = 7;
const RACK_SIZE = 7;
const MAX_SEATS = 4;
const MIN_SEATS = 2;
const BINGO = 50;
const SCORELESS_LIMIT = 6;

const VALUES = {
  a: 1, b: 3, c: 3, d: 2, e: 1, f: 4, g: 2, h: 4, i: 1, j: 8, k: 5, l: 1, m: 3,
  n: 1, o: 1, p: 3, q: 10, r: 1, s: 1, t: 1, u: 1, v: 4, w: 4, x: 8, y: 4, z: 10, '?': 0,
};
const COUNTS = {
  a: 9, b: 2, c: 2, d: 4, e: 12, f: 2, g: 3, h: 2, i: 9, j: 1, k: 1, l: 4, m: 2,
  n: 6, o: 8, p: 2, q: 1, r: 6, s: 4, t: 6, u: 4, v: 2, w: 2, x: 1, y: 2, z: 1, '?': 2,
};

const SHORT_JUNK = new Set((
  'ca cc cf ch cm cs ct cu dd dz ea fl fr ft gm gr gs hp hr ht ii iv ix kc kg km ks lb ls mg ml ms ' +
  'oz pd pg pl pp pt qt rm rs sq ts vi vs wk wt xv xx yd yr ' +
  'adj adv amt avg bpm cal dds doz dpi dds eds esp est etc foo ftp fum fwd gov hgt hoc hos hrs hwy ' +
  'iii inc ind int lbs lii lix lvi lxi meg mes mfg mfr min mpg mph neg non obj pct pkg pwn rpm rps ' +
  'rte tbs tsp vii viz vol xci xii xiv xix xor xvi xxi xxv xxx yrs'
).split(/\s+/).filter(Boolean));

function isScrabbleWord(w) {
  return w.length >= 2 && !SHORT_JUNK.has(w) && isWord(w);
}

// Premium layout. 'TW' | 'DW' | 'TL' | 'DL' | null; the centre is a DW (the star).
const PREMIUM = (() => {
  const g = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  const set = (type, cells) => {
    for (const [r, c] of cells) {
      // Every premium pattern is symmetric under both mirrors.
      for (const [rr, cc] of [[r, c], [c, r], [SIZE - 1 - r, c], [r, SIZE - 1 - c], [SIZE - 1 - r, SIZE - 1 - c],
        [c, SIZE - 1 - r], [SIZE - 1 - c, r], [SIZE - 1 - c, SIZE - 1 - r]]) g[rr][cc] = type;
    }
  };
  set('TW', [[0, 0], [0, 7]]);
  set('DW', [[1, 1], [2, 2], [3, 3], [4, 4], [7, 7]]);
  set('TL', [[1, 5], [5, 5]]);
  set('DL', [[0, 3], [2, 6], [3, 7], [6, 6]]);
  return g;
})();

function emptyBoard() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
}

const boardIsEmpty = (board) => board.every((row) => row.every((c) => !c));

function newBag() {
  const bag = [];
  for (const [l, n] of Object.entries(COUNTS)) for (let i = 0; i < n; i++) bag.push(l);
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

const rackValue = (rack) => rack.reduce((s, l) => s + VALUES[l], 0);

// ---- Move validation + scoring (shared by humans, bots and the live preview) ----------------
// tiles: [{ r, c, letter: 'a'..'z', blank: bool }]. Returns
//   { ok: true, score, words: [{ word, score }], bingo, dir }  or  { ok: false, reason, words? }
// where reason is one of the REASONS keys the client knows how to show.
function evaluateMove(board, tiles) {
  if (!Array.isArray(tiles) || tiles.length === 0) return { ok: false, reason: 'no_tiles' };
  if (tiles.length > RACK_SIZE) return { ok: false, reason: 'bad_tiles' };
  const placed = new Map();
  for (const t of tiles) {
    if (!t || !Number.isInteger(t.r) || !Number.isInteger(t.c) || t.r < 0 || t.r >= SIZE || t.c < 0 || t.c >= SIZE) {
      return { ok: false, reason: 'bad_tiles' };
    }
    if (typeof t.letter !== 'string' || !/^[a-z]$/.test(t.letter)) return { ok: false, reason: 'bad_tiles' };
    if (board[t.r][t.c]) return { ok: false, reason: 'occupied' };
    const k = t.r * SIZE + t.c;
    if (placed.has(k)) return { ok: false, reason: 'bad_tiles' };
    placed.set(k, t);
  }
  const rows = new Set(tiles.map((t) => t.r));
  const cols = new Set(tiles.map((t) => t.c));
  if (rows.size > 1 && cols.size > 1) return { ok: false, reason: 'not_line' };

  const at = (r, c) => {
    if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return null;
    const p = placed.get(r * SIZE + c);
    if (p) return { l: p.letter, b: !!p.blank, fresh: true };
    const b = board[r][c];
    return b ? { l: b.l, b: b.b, fresh: false } : null;
  };

  // Direction of the main word: the line the tiles share; a single tile picks whichever axis
  // actually forms a word (horizontal preferred when both do — both get scored either way).
  let dir;
  if (rows.size === 1 && cols.size === 1) {
    const t = tiles[0];
    dir = (at(t.r, t.c - 1) || at(t.r, t.c + 1)) ? 'h' : 'v';
  } else dir = rows.size === 1 ? 'h' : 'v';
  const [dr, dc] = dir === 'h' ? [0, 1] : [1, 0];

  // Contiguity: no gaps between the first and last placed tile.
  const sorted = tiles.slice().sort((a, b) => (a.r - b.r) || (a.c - b.c));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  for (let r = first.r, c = first.c; r <= last.r && c <= last.c; r += dr, c += dc) {
    if (!at(r, c)) return { ok: false, reason: 'gap' };
  }

  const empty = boardIsEmpty(board);
  if (empty) {
    if (!placed.has(CENTER * SIZE + CENTER)) return { ok: false, reason: 'center' };
    if (tiles.length < 2) return { ok: false, reason: 'too_short' };
  }

  const scoreCells = (cellsWithPos) => {
    let sum = 0;
    let mult = 1;
    for (const { cell, r, c } of cellsWithPos) {
      let v = cell.b ? 0 : VALUES[cell.l];
      if (cell.fresh) {
        const p = PREMIUM[r][c];
        if (p === 'DL') v *= 2;
        else if (p === 'TL') v *= 3;
        else if (p === 'DW') mult *= 2;
        else if (p === 'TW') mult *= 3;
      }
      sum += v;
    }
    return sum * mult;
  };
  const wordWithPos = (r, c, wr, wc) => {
    while (at(r - wr, c - wc)) { r -= wr; c -= wc; }
    const out = [];
    while (at(r, c)) { out.push({ cell: at(r, c), r, c }); r += wr; c += wc; }
    return out.length >= 2 ? out : null;
  };

  const words = [];
  const main = wordWithPos(first.r, first.c, dr, dc);
  if (main) words.push(main);
  for (const t of tiles) {
    const cross = wordWithPos(t.r, t.c, dc, dr);
    if (cross) words.push(cross);
  }
  if (!words.length) return { ok: false, reason: 'too_short' };

  // Connected to the existing tiles: some word must include an old tile.
  if (!empty && !words.some((w) => w.some((x) => !x.cell.fresh))) return { ok: false, reason: 'not_connected' };

  const out = words.map((w) => ({ word: w.map((x) => x.cell.l).join(''), score: scoreCells(w) }));
  const bad = out.filter((w) => !isScrabbleWord(w.word));
  if (bad.length) return { ok: false, reason: 'not_word', words: out.map((w) => ({ ...w, valid: isScrabbleWord(w.word) })), bad: bad.map((w) => w.word) };
  const bingo = tiles.length === RACK_SIZE;
  const score = out.reduce((s, w) => s + w.score, 0) + (bingo ? BINGO : 0);
  return { ok: true, score, words: out, bingo, dir };
}

// ---- Bot leave evaluation (Expert) ---------------------------------------------------------
// Rough single-tile leave values (in points) in the spirit of published Scrabble leave tables,
// plus penalties for duplicates, vowel/consonant imbalance and a Q without a U.
const LEAVE = {
  a: 1, b: -2, c: -0.8, d: -0.5, e: 1.5, f: -2.2, g: -2.8, h: 1.1, i: -0.5, j: -1.5, k: -0.5,
  l: -0.2, m: -0.6, n: 0.2, o: -2.5, p: -0.5, q: -6.8, r: 1.1, s: 7.5, t: -0.1, u: -3.5,
  v: -5.5, w: -3.8, x: 3.3, y: -0.6, z: 5.1, '?': 24.6,
};
function leaveValue(letters) {
  if (!letters.length) return 0;
  let v = 0;
  const seen = {};
  let vowels = 0;
  for (const l of letters) {
    v += LEAVE[l];
    seen[l] = (seen[l] || 0) + 1;
    if (seen[l] > 1 && l !== '?') v -= 3 * (seen[l] - 1);
    if ('aeiou'.includes(l)) vowels++;
  }
  const consonants = letters.filter((l) => l !== '?' && !'aeiou'.includes(l)).length;
  v -= 2 * Math.max(0, Math.abs(vowels - consonants) - 1);
  if (seen.q && !seen.u && !seen['?']) v -= 5;
  return v;
}

// ---- Trie + move generator (runs inside the worker) ----------------------------------------
function buildTrie(words) {
  // First-child / next-sibling arrays; sorted input lets each new child be appended as the last
  // sibling. Node 0 is the root.
  const cap = 1 << 20;
  let letter = new Uint8Array(cap);
  let child = new Int32Array(cap).fill(-1);
  let sib = new Int32Array(cap).fill(-1);
  let lastChild = new Int32Array(cap).fill(-1);
  let term = new Uint8Array(cap);
  let n = 1;
  const grow = () => {
    const c2 = letter.length * 2;
    const g8 = (a) => { const b = new Uint8Array(c2); b.set(a); return b; };
    const g32 = (a) => { const b = new Int32Array(c2).fill(-1); b.set(a); return b; };
    letter = g8(letter); term = g8(term); child = g32(child); sib = g32(sib); lastChild = g32(lastChild);
  };
  const path = [0];
  let prev = '';
  for (const w of words) {
    let p = 0;
    while (p < w.length && p < prev.length && w[p] === prev[p]) p++;
    path.length = p + 1;
    for (let i = p; i < w.length; i++) {
      if (n >= letter.length) grow();
      const parent = path[i];
      const node = n++;
      letter[node] = w.charCodeAt(i) - 97;
      if (lastChild[parent] === -1) child[parent] = node;
      else sib[lastChild[parent]] = node;
      lastChild[parent] = node;
      path.push(node);
    }
    term[path[w.length]] = 1;
    prev = w;
  }
  return { letter, child, sib, term, n };
}

function childOf(trie, node, l) {
  for (let k = trie.child[node]; k !== -1; k = trie.sib[k]) if (trie.letter[k] === l) return k;
  return -1;
}

// grid: 15x15 of null | { l, b }. rack: array of 'a'..'z' | '?'. Returns candidate tile lists
// (horizontal + vertical, de-duplicated); callers score them with evaluateMove.
function generateMoves(trie, grid, rack) {
  const results = new Map();
  const counts = new Array(27).fill(0);
  for (const l of rack) counts[l === '?' ? 26 : l.charCodeAt(0) - 97]++;
  const empty = boardIsEmpty(grid);

  for (const transposed of [false, true]) {
    const g = (r, c) => (transposed ? grid[c][r] : grid[r][c]);
    for (let r = 0; r < SIZE; r++) {
      // Cross-check mask per column for this row (bit i = letter i may go here).
      const cross = new Int32Array(SIZE);
      const anchor = new Uint8Array(SIZE);
      for (let c = 0; c < SIZE; c++) {
        if (g(r, c)) continue;
        let up = '';
        for (let rr = r - 1; rr >= 0 && g(rr, c); rr--) up = g(rr, c).l + up;
        let down = '';
        for (let rr = r + 1; rr < SIZE && g(rr, c); rr++) down += g(rr, c).l;
        if (!up && !down) cross[c] = (1 << 26) - 1;
        else {
          let m = 0;
          for (let i = 0; i < 26; i++) if (isScrabbleWord(up + String.fromCharCode(97 + i) + down)) m |= 1 << i;
          cross[c] = m;
        }
        const adj = (up || down) || (c > 0 && g(r, c - 1)) || (c < SIZE - 1 && g(r, c + 1));
        if (adj || (empty && r === CENTER && c === CENTER)) anchor[c] = 1;
      }

      const placed = []; // { c, letter, blank }
      const record = () => {
        const tiles = placed.map((p) => (transposed
          ? { r: p.c, c: r, letter: p.letter, blank: p.blank }
          : { r, c: p.c, letter: p.letter, blank: p.blank }));
        const key = tiles.map((t) => `${t.r},${t.c},${t.letter},${t.blank ? 1 : 0}`).sort().join('|');
        if (!results.has(key)) results.set(key, tiles);
      };
      const tryTile = (li, c, fn) => {
        if (counts[li] > 0) { counts[li]--; placed.push({ c, letter: String.fromCharCode(97 + li), blank: false }); fn(); placed.pop(); counts[li]++; }
        if (counts[26] > 0) { counts[26]--; placed.push({ c, letter: String.fromCharCode(97 + li), blank: true }); fn(); placed.pop(); counts[26]++; }
      };

      // wordLen counts every letter in the current word (placed + existing).
      const extendRight = (node, c, anchorC, wordLen) => {
        if (c < SIZE && g(r, c)) {
          const k = childOf(trie, node, g(r, c).l.charCodeAt(0) - 97);
          if (k !== -1) extendRight(k, c + 1, anchorC, wordLen + 1);
          return;
        }
        if (c > anchorC && trie.term[node] && wordLen >= 2 && placed.length) record();
        if (c >= SIZE) return;
        for (let k = trie.child[node]; k !== -1; k = trie.sib[k]) {
          const li = trie.letter[k];
          if (!(cross[c] & (1 << li))) continue;
          tryTile(li, c, () => extendRight(k, c + 1, anchorC, wordLen + 1));
        }
      };
      // Left parts are laid out right-to-left from the anchor once they're complete: build the
      // prefix letters, then place them at anchorC - len .. anchorC - 1.
      const leftPart = (node, prefix, limit, anchorC) => {
        // Place prefix tiles, then extend.
        const base = placed.length;
        for (let i = 0; i < prefix.length; i++) placed.push({ c: anchorC - prefix.length + i, letter: prefix[i].letter, blank: prefix[i].blank });
        extendRight(node, anchorC, anchorC, prefix.length);
        placed.length = base;
        if (limit <= 0) return;
        for (let k = trie.child[node]; k !== -1; k = trie.sib[k]) {
          const li = trie.letter[k];
          const L = String.fromCharCode(97 + li);
          if (counts[li] > 0) { counts[li]--; prefix.push({ letter: L, blank: false }); leftPart(k, prefix, limit - 1, anchorC); prefix.pop(); counts[li]++; }
          if (counts[26] > 0) { counts[26]--; prefix.push({ letter: L, blank: true }); leftPart(k, prefix, limit - 1, anchorC); prefix.pop(); counts[26]++; }
        }
      };

      for (let a = 0; a < SIZE; a++) {
        if (!anchor[a]) continue;
        if (a > 0 && g(r, a - 1)) {
          // Existing tiles directly left of the anchor are the fixed left part.
          let s = a - 1;
          while (s > 0 && g(r, s - 1)) s--;
          let node = 0;
          for (let c = s; c < a && node !== -1; c++) node = childOf(trie, node, g(r, c).l.charCodeAt(0) - 97);
          if (node !== -1) extendRight(node, a, a - 1, a - s);
        } else {
          let limit = 0;
          for (let c = a - 1; c >= 0 && !g(r, c) && !anchor[c]; c--) limit++;
          leftPart(0, [], Math.min(limit, rack.length - 1), a);
        }
      }
    }
  }
  return [...results.values()];
}

// Chooses the bot's action. Returns { kind: 'play', tiles } | { kind: 'exchange', letters } | { kind: 'pass' }.
function chooseBotAction(trie, grid, rack, level, bagCount) {
  const scored = [];
  for (const tiles of generateMoves(trie, grid, rack)) {
    const ev = evaluateMove(grid, tiles);
    if (!ev.ok) continue;
    const left = rack.slice();
    for (const t of tiles) left.splice(left.indexOf(t.blank ? '?' : t.letter), 1);
    scored.push({ tiles, score: ev.score, left });
  }
  const exchangeBad = () => {
    // Keep the tiles worth keeping (unique letters with a positive leave value), throw the rest.
    const keep = [];
    for (const l of rack) if (LEAVE[l] > 0 && !keep.includes(l)) keep.push(l);
    const throwAway = rack.slice();
    for (const l of keep) throwAway.splice(throwAway.indexOf(l), 1);
    return throwAway.length ? { kind: 'exchange', letters: throwAway } : { kind: 'exchange', letters: rack.slice() };
  };
  if (!scored.length) return bagCount >= RACK_SIZE ? exchangeBad() : { kind: 'pass' };
  scored.sort((a, b) => b.score - a.score);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  let choice;
  if (level === 'easy') {
    // Short, low-scoring plays: from the bottom half by score, preferring 2-3 tile moves.
    const low = scored.slice(Math.floor(scored.length / 2));
    const short = low.filter((m) => m.tiles.length <= 3);
    choice = pick(short.length ? short : low);
  } else if (level === 'medium') {
    const max = scored[0].score;
    const mid = scored.filter((m) => m.score >= max * 0.45 && m.score <= max * 0.8);
    choice = mid.length ? pick(mid) : scored[Math.min(scored.length - 1, Math.floor(scored.length / 4))];
  } else if (level === 'expert') {
    const withLeave = scored.map((m) => ({ ...m, total: m.score + (bagCount > 0 ? leaveValue(m.left) : -2 * rackValue(m.left)) }));
    withLeave.sort((a, b) => b.total - a.total);
    choice = withLeave[0];
    if (bagCount >= RACK_SIZE && choice.score < 12 && leaveValue(rack) < -8) {
      const ex = exchangeBad();
      const kept = rack.slice();
      for (const l of ex.letters) kept.splice(kept.indexOf(l), 1);
      if (leaveValue(kept) > choice.total) return ex;
    }
  } else {
    choice = scored[0];
  }
  return { kind: 'play', tiles: choice.tiles };
}

// ---- Worker side ---------------------------------------------------------------------------
if (!isMainThread && workerData && workerData.scrabbleWorker) {
  const { DICT_LIST } = require('./words');
  const words = DICT_LIST.filter((w) => w.length >= 2 && w.length <= SIZE && !SHORT_JUNK.has(w)).sort();
  const trie = buildTrie(words);
  parentPort.on('message', ({ id, grid, rack, level, bagCount }) => {
    try {
      parentPort.postMessage({ id, result: chooseBotAction(trie, grid, rack, level, bagCount) });
    } catch (err) {
      parentPort.postMessage({ id, error: String((err && err.stack) || err) });
    }
  });
}

let worker = null;
let nextReq = 1;
const pendingReq = new Map();
function botThink(input) {
  return new Promise((resolve, reject) => {
    if (!worker) {
      worker = new Worker(__filename, { workerData: { scrabbleWorker: true } });
      worker.unref();
      worker.on('message', ({ id, result, error }) => {
        const p = pendingReq.get(id);
        if (!p) return;
        pendingReq.delete(id);
        if (error) p.reject(new Error(error)); else p.resolve(result);
      });
      const fail = (err) => {
        worker = null;
        for (const p of pendingReq.values()) p.reject(err || new Error('scrabble worker exited'));
        pendingReq.clear();
      };
      worker.on('error', fail);
      worker.on('exit', () => fail());
    }
    const id = nextReq++;
    pendingReq.set(id, { resolve, reject });
    worker.postMessage({ id, ...input });
  });
}

// ---- Room plugin ---------------------------------------------------------------------------
const { normLevel } = require('./ai/levels');

const { reportRanked } = require('./wordResults');

const BOT_NAMES = ['Ace', 'Byte', 'Chip', 'Dot'];
const LEVEL_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert' };
const isBot = (id) => typeof id === 'string' && id.startsWith('bot-');
const BOT_DELAY_MIN = 900;
const BOT_DELAY_MAX = 1700;

function nameOf(room, id) {
  const st = room.state;
  if (isBot(id)) return `🤖 ${id.slice(4)} (${LEVEL_LABEL[st.botLevels[id]] || 'Hard'})`;
  const c = room.clients.get(id);
  if (c) return c.nickname;
  return st.names[id] || 'someone';
}

// Board on the wire: 15 strings of 15 chars — '.' empty, lowercase tile, UPPERCASE = blank.
const encodeBoard = (board) => board.map((row) => row.map((c) => (c ? (c.b ? c.l.toUpperCase() : c.l) : '.')).join(''));

function buildView(room, forId) {
  const st = room.state;
  const mySeat = st.seats.indexOf(forId);
  return {
    phase: st.phase,
    gameId: st.gameId,
    seats: st.seats.map((id, i) => ({
      id,
      name: nameOf(room, id),
      bot: isBot(id),
      level: isBot(id) ? st.botLevels[id] : null,
      score: st.scores[i] || 0,
      rackCount: st.racks[i] ? st.racks[i].length : 0,
    })),
    mySeat,
    myRack: mySeat !== -1 && st.racks[mySeat] ? st.racks[mySeat] : [],
    board: encodeBoard(st.board),
    bagCount: st.bag.length,
    turnIdx: st.turnIdx,
    log: st.log.slice(-40),
    lastMove: st.lastMove,
    scorelessStreak: st.scorelessStreak,
    endInfo: st.endInfo,
  };
}

function broadcastState(room) {
  if (room.state.pendingResult) {
    reportRanked(room, room.state.pendingResult);
    room.state.pendingResult = null;
  }
  for (const id of room.clients.keys()) {
    room.sendTo(id, { v: 1, type: 'game.event', payload: { gameType: 'scrabble', data: { kind: 'state', ...buildView(room, id) } } });
  }
}

function sendEvent(room, id, data) {
  room.sendTo(id, { v: 1, type: 'game.event', payload: { gameType: 'scrabble', data } });
}

function draw(st, rack) {
  while (rack.length < RACK_SIZE && st.bag.length) rack.push(st.bag.pop());
}

function startGame(st) {
  st.gameId++;
  st.board = emptyBoard();
  st.bag = newBag();
  st.racks = st.seats.map(() => []);
  for (const r of st.racks) draw(st, r);
  st.scores = st.seats.map(() => 0);
  st.turnIdx = Math.floor(Math.random() * st.seats.length);
  st.scorelessStreak = 0;
  st.log = [];
  st.lastMove = null;
  st.endInfo = null;
  st.dropped = []; // resigned / left mid-game, in order
  st.phase = 'playing';
}

function rememberNames(room) {
  for (const id of room.state.seats) room.state.names[id] = nameOf(room, id);
}

function finishGame(st, reason, outIdx) {
  const deltas = st.seats.map(() => 0);
  if (reason === 'out') {
    let gain = 0;
    st.racks.forEach((rack, i) => {
      if (i === outIdx) return;
      const v = rackValue(rack);
      deltas[i] -= v;
      gain += v;
    });
    deltas[outIdx] += gain;
  } else if (reason === 'scoreless') {
    st.racks.forEach((rack, i) => { deltas[i] -= rackValue(rack); });
  }
  deltas.forEach((d, i) => { st.scores[i] += d; });
  setFinal(st, reason, reason === 'out' ? outIdx : null, deltas);
}

// Frozen final standings, so the results stay readable even if seats change afterwards.
function setFinal(st, reason, outSeat, deltas, room) {
  const best = st.scores.length ? Math.max(...st.scores) : 0;
  st.endInfo = {
    reason,
    final: st.seats.map((id, i) => ({
      id,
      name: st.names[id] || (room ? nameOf(room, id) : null),
      score: st.scores[i],
      delta: deltas ? deltas[i] : 0,
      rack: st.racks[i] ? st.racks[i].slice() : [],
      out: i === outSeat,
      winner: st.scores[i] === best,
    })),
  };
  st.phase = 'game_over';
  // Result (sent by the next broadcastState, which has the room): seats by final score, then anyone
  // who resigned or left mid-game as a forfeit, the latest leaver ranked highest.
  st.pendingResult = st.seats.map((id, i) => ({ id, rank: st.scores[i], score: st.scores[i], level: st.botLevels[id] }))
    .concat(st.dropped.map((id, k) => ({ id, rank: -1e9 + k })));
}

function advance(st) {
  st.turnIdx = (st.turnIdx + 1) % st.seats.length;
}

function afterScoreless(st) {
  st.scorelessStreak++;
  if (st.scorelessStreak >= SCORELESS_LIMIT) finishGame(st, 'scoreless');
  else advance(st);
}

// Applies a play for seat i. tiles: [{ r, c, letter, blank }] already mapped from rack letters.
function applyPlay(st, i, tiles, ev) {
  const rack = st.racks[i];
  for (const t of tiles) {
    rack.splice(rack.indexOf(t.blank ? '?' : t.letter), 1);
    st.board[t.r][t.c] = { l: t.letter, b: !!t.blank };
  }
  st.scores[i] += ev.score;
  st.log.push({ seat: i, name: st.names[st.seats[i]], type: 'play', words: ev.words.map((w) => ({ word: w.word, score: w.score })), score: ev.score, bingo: ev.bingo, n: st.log.length + 1 });
  st.lastMove = { tiles: tiles.map((t) => ({ r: t.r, c: t.c })), seat: i, score: ev.score };
  if (ev.score > 0) st.scorelessStreak = 0; else st.scorelessStreak++;
  draw(st, rack);
  if (rack.length === 0 && st.bag.length === 0) finishGame(st, 'out', i);
  else if (st.scorelessStreak >= SCORELESS_LIMIT) finishGame(st, 'scoreless');
  else advance(st);
}

function applyExchange(st, i, letters) {
  const rack = st.racks[i];
  for (const l of letters) rack.splice(rack.indexOf(l), 1);
  const fresh = [];
  for (let k = 0; k < letters.length; k++) fresh.push(st.bag.pop());
  rack.push(...fresh);
  // Returned tiles go back into the bag at random positions.
  for (const l of letters) st.bag.splice(Math.floor(Math.random() * (st.bag.length + 1)), 0, l);
  st.log.push({ seat: i, name: st.names[st.seats[i]], type: 'exchange', count: letters.length, score: 0, n: st.log.length + 1 });
  st.lastMove = null;
  afterScoreless(st);
}

function applyPass(st, i) {
  st.log.push({ seat: i, name: st.names[st.seats[i]], type: 'pass', score: 0, n: st.log.length + 1 });
  afterScoreless(st);
}

// Rack-index based tiles from a client -> letter tiles; null if inconsistent with the rack.
function tilesFromClient(rack, raw) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > RACK_SIZE) return null;
  const used = new Set();
  const out = [];
  for (const t of raw) {
    if (!t || typeof t !== 'object') return null;
    const i = Number(t.i);
    if (!Number.isInteger(i) || i < 0 || i >= rack.length || used.has(i)) return null;
    used.add(i);
    const r = Number(t.r);
    const c = Number(t.c);
    if (!Number.isInteger(r) || !Number.isInteger(c)) return null;
    const tile = rack[i];
    if (tile === '?') {
      if (typeof t.letter !== 'string' || !/^[a-zA-Z]$/.test(t.letter)) return null;
      out.push({ r, c, letter: t.letter.toLowerCase(), blank: true });
    } else out.push({ r, c, letter: tile, blank: false });
  }
  return out;
}

function hasHumanSeated(st) {
  return st.seats.some((id) => !isBot(id));
}

function maybeScheduleBot(room) {
  const st = room.state;
  if (st.phase !== 'playing') return;
  const id = st.seats[st.turnIdx];
  if (!isBot(id)) return;
  const gameId = st.gameId;
  const turnKey = st.log.length;
  const stillValid = () => room.state === st && st.phase === 'playing' && st.gameId === gameId
    && st.log.length === turnKey && st.seats[st.turnIdx] === id;
  const delay = BOT_DELAY_MIN + Math.random() * (BOT_DELAY_MAX - BOT_DELAY_MIN);
  setTimeout(() => {
    if (!stillValid()) return;
    const i = st.turnIdx;
    const rack = st.racks[i].slice();
    botThink({ grid: st.board, rack, level: st.botLevels[id] || 'hard', bagCount: st.bag.length })
      .then((action) => {
        if (!stillValid()) return;
        runBotAction(st, i, action);
        broadcastState(room);
        maybeScheduleBot(room);
      })
      .catch(() => {
        if (!stillValid()) return;
        applyPass(st, i);
        broadcastState(room);
        maybeScheduleBot(room);
      });
  }, delay);
}

function runBotAction(st, i, action) {
  if (action && action.kind === 'play') {
    const ev = evaluateMove(st.board, action.tiles);
    if (ev.ok && canSupply(st.racks[i], action.tiles)) return applyPlay(st, i, action.tiles, ev);
  } else if (action && action.kind === 'exchange' && st.bag.length >= RACK_SIZE && canSupplyLetters(st.racks[i], action.letters)) {
    return applyExchange(st, i, action.letters);
  }
  return applyPass(st, i);
}

function canSupplyLetters(rack, letters) {
  if (!Array.isArray(letters) || !letters.length || letters.length > rack.length) return false;
  const r = rack.slice();
  for (const l of letters) {
    const k = r.indexOf(l);
    if (k === -1) return false;
    r.splice(k, 1);
  }
  return true;
}
const canSupply = (rack, tiles) => canSupplyLetters(rack, tiles.map((t) => (t.blank ? '?' : t.letter)));

// A seat is vacated (leave / disconnect / remove bot). Mid-game the game carries on if at least
// two seats and one human remain (their tiles go back in the bag); otherwise it ends.
function removeSeat(room, id) {
  const st = room.state;
  const idx = st.seats.indexOf(id);
  if (idx === -1) return false;
  if (st.phase === 'playing') {
    st.names[id] = nameOf(room, id);
    st.dropped.push(id);
    for (const l of st.racks[idx]) st.bag.splice(Math.floor(Math.random() * (st.bag.length + 1)), 0, l);
    st.seats.splice(idx, 1);
    st.racks.splice(idx, 1);
    st.scores.splice(idx, 1);
    for (const e of st.log) if (e.seat === idx) e.seat = -1; else if (e.seat > idx) e.seat--;
    if (st.lastMove) {
      if (st.lastMove.seat === idx) st.lastMove.seat = -1; else if (st.lastMove.seat > idx) st.lastMove.seat--;
    }
    if (st.seats.length < MIN_SEATS || !hasHumanSeated(st)) {
      setFinal(st, 'left', null, null, room);
    } else {
      if (idx < st.turnIdx) st.turnIdx--;
      if (st.turnIdx >= st.seats.length) st.turnIdx = 0;
      st.gameId++; // invalidate any pending bot timer keyed to the old turn
    }
  } else {
    // Waiting / game over: endInfo.final keeps the last game's standings intact.
    st.seats.splice(idx, 1);
    if (st.racks.length > idx) st.racks.splice(idx, 1);
    if (st.scores.length > idx) st.scores.splice(idx, 1);
  }
  if (isBot(id)) delete st.botLevels[id];
  if (!hasHumanSeated(st) && st.phase !== 'playing') {
    // No humans seated: drop bots so an empty table doesn't hold seats.
    for (const b of st.seats.filter(isBot)) delete st.botLevels[b];
    st.seats = st.seats.filter((s) => !isBot(s));
  }
  return true;
}

const REASONS = ['no_tiles', 'bad_tiles', 'occupied', 'not_line', 'gap', 'center', 'too_short', 'not_connected', 'not_word'];

module.exports = {
  type: 'scrabble',
  stats: { rated: true, score: { label: 'Points', better: 'high', format: 'pts' } },

  createInitialState() {
    return {
      phase: 'waiting',
      gameId: 0,
      seats: [],
      botLevels: {},
      names: {},
      board: emptyBoard(),
      bag: [],
      racks: [],
      scores: [],
      turnIdx: 0,
      scorelessStreak: 0,
      log: [],
      lastMove: null,
      endInfo: null,
    };
  },

  isRoomFull(room) {
    // Seats cap at 4; everyone else can still come in and spectate.
    return room.clients.size >= 16;
  },

  serializeSnapshot(room, client) {
    return buildView(room, client ? client.clientId : null);
  },

  onLeave(room, client) {
    if (removeSeat(room, client.clientId)) {
      broadcastState(room);
      maybeScheduleBot(room);
    }
  },

  onMessage(room, client, data, ctx) {
    if (!data || typeof data.kind !== 'string') return;
    const st = room.state;
    const me = ctx.senderId;
    const reject = (reason, extra) => sendEvent(room, me, { kind: 'moveRejected', reason, ...extra });

    if (data.kind === 'sit') {
      if (st.phase === 'playing' || st.seats.length >= MAX_SEATS || st.seats.includes(me)) return;
      st.seats.push(me);
      broadcastState(room);
      return;
    }
    if (data.kind === 'leaveSeat') {
      if (st.phase === 'playing') return; // mid-game: use RESIGN
      if (removeSeat(room, me)) broadcastState(room);
      return;
    }
    if (data.kind === 'resign') {
      if (st.phase !== 'playing' || !st.seats.includes(me)) return;
      removeSeat(room, me);
      broadcastState(room);
      maybeScheduleBot(room);
      return;
    }
    if (data.kind === 'addBot') {
      if (st.phase === 'playing' || st.seats.length >= MAX_SEATS) return;
      const name = BOT_NAMES.find((n) => !st.seats.includes(`bot-${n}`));
      if (!name) return;
      const id = `bot-${name}`;
      st.seats.push(id);
      st.botLevels[id] = normLevel(data.level);
      broadcastState(room);
      return;
    }
    if (data.kind === 'removeBot') {
      if (st.phase === 'playing' || !isBot(data.id) || !st.seats.includes(data.id)) return;
      removeSeat(room, data.id);
      broadcastState(room);
      return;
    }
    if (data.kind === 'setBotLevel') {
      if (!isBot(data.id) || !st.seats.includes(data.id)) return;
      st.botLevels[data.id] = normLevel(data.level);
      broadcastState(room);
      return;
    }
    if (data.kind === 'startGame') {
      if (st.phase === 'playing' || st.seats.length < MIN_SEATS || !st.seats.includes(me)) return;
      rememberNames(room);
      startGame(st);
      broadcastState(room);
      maybeScheduleBot(room);
      return;
    }

    const seat = st.seats.indexOf(me);

    if (data.kind === 'check') {
      // Live preview for the player whose turn it is (validity + score of the pending tiles).
      if (st.phase !== 'playing' || seat === -1 || seat !== st.turnIdx) return;
      const tiles = tilesFromClient(st.racks[seat], data.tiles);
      const key = typeof data.key === 'string' ? data.key.slice(0, 200) : '';
      if (!tiles) return sendEvent(room, me, { kind: 'preview', key, ok: false, reason: 'bad_tiles' });
      const ev = evaluateMove(st.board, tiles);
      sendEvent(room, me, { kind: 'preview', key, ok: ev.ok, reason: ev.reason, score: ev.score, words: ev.words, bad: ev.bad, bingo: ev.bingo });
      return;
    }

    if (st.phase !== 'playing' || seat === -1) return;
    if (seat !== st.turnIdx) return reject('not_your_turn');

    if (data.kind === 'play') {
      const tiles = tilesFromClient(st.racks[seat], data.tiles);
      if (!tiles) return reject('bad_tiles');
      const ev = evaluateMove(st.board, tiles);
      if (!ev.ok) return reject(ev.reason, { bad: ev.bad });
      applyPlay(st, seat, tiles, ev);
      broadcastState(room);
      maybeScheduleBot(room);
      return;
    }
    if (data.kind === 'exchange') {
      if (st.bag.length < RACK_SIZE) return reject('bag_low');
      const idxs = Array.isArray(data.indices) ? data.indices.map(Number) : [];
      const rack = st.racks[seat];
      if (!idxs.length || idxs.length > rack.length || new Set(idxs).size !== idxs.length
        || idxs.some((i) => !Number.isInteger(i) || i < 0 || i >= rack.length)) return reject('bad_tiles');
      applyExchange(st, seat, idxs.map((i) => rack[i]));
      broadcastState(room);
      maybeScheduleBot(room);
      return;
    }
    if (data.kind === 'pass') {
      applyPass(st, seat);
      broadcastState(room);
      maybeScheduleBot(room);
    }
  },

  _test: {
    evaluateMove, buildTrie, generateMoves, chooseBotAction, leaveValue, isScrabbleWord, PREMIUM, VALUES, COUNTS,
    emptyBoard, newBag, encodeBoard, startGame, applyPlay, finishGame, rackValue, REASONS, SHORT_JUNK,
    tilesFromClient,
  },
};
