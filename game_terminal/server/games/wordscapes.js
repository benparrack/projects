// Wordscapes-style word game. A wheel of 5-7 letters (a shuffled everyday "base" word) sits under
// a small crossword of target words — every common word (3+ letters) spellable from the wheel
// that the layout generator could fit, 5-12 of them. Swipe letters to make words; targets fill
// the crossword, any other real word (words.js `isWord`) is a bonus word.
//
// Modes (room-wide, switchable):
//   coop — everyone shares ONE crossword; a found word fills for all and is credited (coloured)
//          to its finder; per-player score. Level completes when the crossword is full.
//   race — every player solves their OWN copy of the same puzzle; first to fill it wins.
// Either way the room moves through levels together (NEXT LEVEL), the wheel growing 5→6→7.
//
// Hidden info: the target words never leave the server until the level is over — clients get
// slot geometry plus the letters they have actually revealed (found words + hints), per viewer
// (race progress is private), via a per-client sendTo loop like hangman.js.
//
// Bots (tickBots.js ids) find a target (shortest first, mostly) or a bonus word every few
// seconds, faster per level; they play in both modes. Timers re-validate puzzleId/phase/player
// on fire, so a reset room or removed bot just stops the chain.

'use strict';

const { COMMON, DICT_LIST, isWord, letterCounts, canSpell } = require('./words');
const { isBotId, newBot, humanCount, dropBotsIfAlone } = require('./tickBots');
const { reportRanked } = require('./wordResults');

const TYPE = 'wordscapes';
const COLOR_PALETTE = ['#00eaff', '#ff2fb0', '#39ff14', '#ffb000', '#8c52ff', '#ff4d4d', '#ffee58', '#00ffa2'];
const MIN_TARGETS = 5;
const MAX_TARGETS = 12;
const MAX_COLS = 12;
const MAX_ROWS = 10;
const HINTS_PER_LEVEL = 3;
const HINT_COST = 2;
const BONUS_PER_HINT = 5; // every 5 bonus words earns another hint (a Wordscapes nod)
const RACE_COUNTDOWN_MS = 3000;
const BOT_CFG = { leadMs: 1500, countdownMs: RACE_COUNTDOWN_MS }; // tests shrink these

const BOT_SPEED = {
  easy: { ms: [9000, 14000], bonus: 0.1 },
  medium: { ms: [6000, 9000], bonus: 0.2 },
  hard: { ms: [4000, 6500], bonus: 0.25 },
  expert: { ms: [2200, 3600], bonus: 0.3 },
};

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

const wheelSizeFor = (level) => (level <= 3 ? 5 : level <= 9 ? 6 : 7);

// --- Crossword layout ---------------------------------------------------------------------------
// Places words one at a time, each crossing at least one already-placed letter at right angles.
// A placement is legal when every cell is empty or already holds the same letter (and that letter
// was laid in the OTHER direction), the cells just before/after the word are empty, and every NEW
// cell has empty neighbours on both sides perpendicular to the word — so no unintended 2+ letter
// runs ever appear. The bounding box stays within MAX_COLS x MAX_ROWS.

function tryLayout(words, rand) {
  const cells = new Map(); // "r,c" -> { ch, h: bool, v: bool }
  const placed = [];
  const key = (r, c) => `${r},${c}`;
  let minR = 0; let maxR = 0; let minC = 0; let maxC = 0;

  function put(word, r, c, dir) {
    for (let i = 0; i < word.length; i++) {
      const rr = dir === 'v' ? r + i : r;
      const cc = dir === 'h' ? c + i : c;
      const k = key(rr, cc);
      const cell = cells.get(k) || { ch: word[i], h: false, v: false };
      cell[dir] = true;
      cells.set(k, cell);
      minR = Math.min(minR, rr); maxR = Math.max(maxR, rr);
      minC = Math.min(minC, cc); maxC = Math.max(maxC, cc);
    }
    placed.push({ word, r, c, dir });
  }

  function legal(word, r, c, dir) {
    const dr = dir === 'v' ? 1 : 0;
    const dc = dir === 'h' ? 1 : 0;
    if (cells.has(key(r - dr, c - dc)) || cells.has(key(r + dr * word.length, c + dc * word.length))) return -1;
    let crossings = 0;
    let lo = { r: Math.min(minR, r), c: Math.min(minC, c) };
    let hi = { r: Math.max(maxR, r + dr * (word.length - 1)), c: Math.max(maxC, c + dc * (word.length - 1)) };
    if (hi.r - lo.r + 1 > MAX_ROWS || hi.c - lo.c + 1 > MAX_COLS) return -1;
    for (let i = 0; i < word.length; i++) {
      const rr = r + dr * i;
      const cc = c + dc * i;
      const cell = cells.get(key(rr, cc));
      if (cell) {
        if (cell.ch !== word[i] || cell[dir]) return -1;
        crossings++;
      } else {
        // Perpendicular neighbours of a new cell must be empty.
        if (cells.has(key(rr + dc, cc + dr)) || cells.has(key(rr - dc, cc - dr))) return -1;
      }
    }
    return crossings;
  }

  const [first, ...rest] = words;
  put(first, 0, 0, rand() < 0.7 ? 'h' : 'v');
  for (const word of rest) {
    if (placed.length >= MAX_TARGETS) break;
    const options = [];
    for (const [k, cell] of cells) {
      const [cr, cc] = k.split(',').map(Number);
      for (let i = 0; i < word.length; i++) {
        if (word[i] !== cell.ch) continue;
        for (const dir of ['h', 'v']) {
          if (cell[dir]) continue;
          const r = dir === 'v' ? cr - i : cr;
          const c = dir === 'h' ? cc - i : cc;
          const x = legal(word, r, c, dir);
          if (x > 0) options.push({ r, c, dir, score: x * 3 + rand() * 2 });
        }
      }
    }
    if (!options.length) continue;
    options.sort((a, b) => b.score - a.score);
    const pick = options[Math.floor(rand() * Math.min(3, options.length))];
    put(word, pick.r, pick.c, pick.dir);
  }

  return {
    placed: placed.map((p) => ({ ...p, r: p.r - minR, c: p.c - minC })),
    rows: maxR - minR + 1,
    cols: maxC - minC + 1,
  };
}

// Best of several randomized attempts: most words, then most compact.
function layoutWords(base, candidates, rand) {
  let best = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    // Base word first; the rest longest-first with a shuffle inside each length.
    const others = shuffle(candidates.filter((w) => w !== base), rand).sort((a, b) => b.length - a.length);
    const lay = tryLayout([base, ...others], rand);
    const score = lay.placed.length * 1000 - lay.rows * lay.cols;
    if (!best || score > best.score) best = { ...lay, score };
    if (best.placed.length >= MAX_TARGETS) break;
  }
  return best;
}

// Renders a layout to a grid and checks it the way a solver sees it: every maximal horizontal or
// vertical run of 2+ letters is exactly one placed word, and all words form one connected piece.
// Exported for tests (and used as a final safety check in makePuzzle).
function validateLayout(lay) {
  const grid = Array.from({ length: lay.rows }, () => Array(lay.cols).fill(null));
  for (const p of lay.placed) {
    for (let i = 0; i < p.word.length; i++) {
      const r = p.dir === 'v' ? p.r + i : p.r;
      const c = p.dir === 'h' ? p.c + i : p.c;
      if (r < 0 || c < 0 || r >= lay.rows || c >= lay.cols) return 'out of bounds';
      if (grid[r][c] && grid[r][c] !== p.word[i]) return 'letter clash';
      grid[r][c] = p.word[i];
    }
  }
  const want = new Set(lay.placed.map((p) => `${p.dir}${p.r},${p.c}:${p.word}`));
  const runs = [];
  for (const dir of ['h', 'v']) {
    const outer = dir === 'h' ? lay.rows : lay.cols;
    const inner = dir === 'h' ? lay.cols : lay.rows;
    for (let o = 0; o < outer; o++) {
      let i = 0;
      while (i < inner) {
        const at = (k) => (dir === 'h' ? grid[o][k] : grid[k][o]);
        if (!at(i)) { i++; continue; }
        let j = i;
        let s = '';
        while (j < inner && at(j)) { s += at(j); j++; }
        if (s.length >= 2) runs.push(dir === 'h' ? `h${o},${i}:${s}` : `v${i},${o}:${s}`);
        i = j;
      }
    }
  }
  for (const run of runs) if (!want.has(run)) return `stray run ${run}`;
  if (runs.length !== want.size) return 'missing word';
  // Connectivity over letter cells.
  const letters = [];
  for (let r = 0; r < lay.rows; r++) for (let c = 0; c < lay.cols; c++) if (grid[r][c]) letters.push([r, c]);
  const seen = new Set([`${letters[0][0]},${letters[0][1]}`]);
  const stack = [letters[0]];
  while (stack.length) {
    const [r, c] = stack.pop();
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = `${r + dr},${c + dc}`;
      if (!seen.has(k) && grid[r + dr] && grid[r + dr][c + dc]) { seen.add(k); stack.push([r + dr, c + dc]); }
    }
  }
  if (seen.size !== letters.length) return 'disconnected';
  return null;
}

// Common words make the targets (people know them). COMMON comes from web frequency data, so its
// short end carries abbreviations/names (tel, mon, doc, res...) — those stay valid bonus words but
// never become grid targets.
const COMMON_RANK = new Map(COMMON.map((w, i) => [w, i]));
const NOT_TARGET = new Set(('web per mar pro jun mon sat wed tel mac max las tom sub led dev lee bob sec mid del joe '
  + 'lab ave pic spa con ups var doc mom rom don gnu ben lib cam ram pub ref vat res bio med jay biz rob asp '
  + 'par ken reg mod rep inn ads fax gay zip pat oct nov dec feb apr aug sep thu tue fri sun est etc vol '
  + 'ide nat min app abs aka amp arc avg ceo des dis eds ent geo hon ion ira ivy lan led len les los mag '
  + 'mic mil mis mix moe neo nos ole ops ore ort pac pas pci pod pre psi rad rec ron ros sim tad ted tim '
  + 'tri van vid wan yen zen info demo intro promo admin').split(' '));
const okTarget = (w) => !NOT_TARGET.has(w) && (w.length >= 4 || COMMON_RANK.get(w) < 6000);

const basesByLen = new Map();
function basesOfLen(n) {
  if (!basesByLen.has(n)) basesByLen.set(n, COMMON.filter((w) => w.length === n && COMMON_RANK.get(w) < 7000));
  return basesByLen.get(n);
}

function spellable(letters, src, minLen) {
  const counts = letterCounts(letters);
  return src.filter((w) => w.length >= minLen && w.length <= letters.length && canSpell(w, counts));
}


function makePuzzle(level, seed) {
  const rand = mulberry32(seed);
  const n = wheelSizeFor(level);
  const bases = basesOfLen(n);
  for (let tries = 0; tries < 400; tries++) {
    const base = bases[Math.floor(rand() * bases.length)];
    const cands = spellable(base, COMMON, 3).filter(okTarget);
    if (cands.length < MIN_TARGETS + 1) continue;
    const lay = layoutWords(base, cands, rand);
    if (lay.placed.length < MIN_TARGETS || validateLayout(lay)) continue;
    const targets = new Set(lay.placed.map((p) => p.word));
    const bonusList = spellable(base, DICT_LIST, 3).filter((w) => !targets.has(w));
    // The wheel order is sent to clients, so it must not spell the base or any other target
    // (e.g. base "board" shuffled to "broad") — that would give the answer away.
    let letters = base.split('');
    for (let k = 0; k < 50 && (letters.join('') === base || targets.has(letters.join(''))); k++) letters = shuffle(letters, rand);
    return { seed, level, base, letters: letters.join(''), rows: lay.rows, cols: lay.cols, slots: lay.placed, bonusList };
  }
  throw new Error('wordscapes: could not build a puzzle');
}

function slotCells(slot) {
  const out = [];
  for (let i = 0; i < slot.word.length; i++) {
    out.push(slot.dir === 'v' ? [slot.r + i, slot.c] : [slot.r, slot.c + i]);
  }
  return out;
}

// --- State helpers ------------------------------------------------------------------------------

const freshProg = () => ({ found: new Map(), hinted: new Set() }); // slotIdx -> finderId|null

function progOf(st, p) {
  return st.mode === 'race' ? p.prog : st.coop;
}

function revealedSet(st, prog) {
  const set = new Set(prog.hinted);
  for (const idx of prog.found.keys()) for (const [r, c] of slotCells(st.puzzle.slots[idx])) set.add(`${r},${c}`);
  return set;
}

// Any slot whose letters are all showing (crossings + hints) counts as found, credited to no one.
function autoComplete(st, prog) {
  let changed = true;
  while (changed) {
    changed = false;
    const rev = revealedSet(st, prog);
    st.puzzle.slots.forEach((slot, i) => {
      if (prog.found.has(i)) return;
      if (slotCells(slot).every(([r, c]) => rev.has(`${r},${c}`))) { prog.found.set(i, null); changed = true; }
    });
  }
}

const progDone = (st, prog) => prog.found.size === st.puzzle.slots.length;

function resetPlayerForLevel(p) {
  p.prog = freshProg();
  p.bonus = new Set();
  p.hintsLeft = HINTS_PER_LEVEL;
  p.levelWords = 0;
  p.finishMs = null;
}

function newLevel(st, level, room) {
  st.level = level;
  st.puzzleId++;
  st.puzzle = makePuzzle(level, (Math.random() * 0xffffffff) >>> 0);
  st.coop = freshProg();
  st.phase = 'playing';
  st.winnerId = null;
  st.startAt = Date.now() + (st.mode === 'race' ? BOT_CFG.countdownMs : 0);
  for (const p of st.players.values()) { stopBot(p); resetPlayerForLevel(p); }
  if (room) for (const p of st.players.values()) if (p.bot) scheduleBot(room, p.clientId, true);
}

// Core move, shared by humans and bots. Returns { outcome, slot? }.
function applyWord(st, p, raw) {
  if (st.phase !== 'playing') return { outcome: 'closed' };
  if (Date.now() < st.startAt) return { outcome: 'early' };
  const word = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!/^[a-z]+$/.test(word) || word.length > st.puzzle.letters.length) return { outcome: 'invalid' };
  if (word.length < 3) return { outcome: 'short' };
  if (!canSpell(word, letterCounts(st.puzzle.letters))) return { outcome: 'invalid' };
  const prog = progOf(st, p);
  const idx = st.puzzle.slots.findIndex((s) => s.word === word);
  if (idx !== -1) {
    if (prog.found.has(idx)) return { outcome: 'already', slot: idx };
    prog.found.set(idx, p.clientId);
    p.score += word.length;
    p.words++;
    p.levelWords++;
    autoComplete(st, prog);
    checkComplete(st, p, prog);
    return { outcome: 'found', slot: idx };
  }
  if (!isWord(word)) return { outcome: 'invalid' };
  if (p.bonus.has(word)) return { outcome: 'alreadyBonus' };
  p.bonus.add(word);
  p.score += 1;
  p.bonusTotal++;
  if (p.bonus.size % BONUS_PER_HINT === 0) p.hintsLeft++;
  return { outcome: 'bonus' };
}

function checkComplete(st, p, prog) {
  if (!progDone(st, prog) || st.phase !== 'playing') return;
  if (st.mode === 'race') {
    p.finishMs = Date.now() - st.startAt;
    st.winnerId = p.clientId;
    p.raceWins++;
  }
  st.phase = 'complete';
  st.solvedMs = Date.now() - st.startAt;
}

// Reveals the first hidden letter of the shortest unfinished word (that's what Wordscapes does).
function applyHint(st, p) {
  if (st.phase !== 'playing' || Date.now() < st.startAt) return null;
  if (p.hintsLeft <= 0) return null;
  const prog = progOf(st, p);
  const rev = revealedSet(st, prog);
  const order = st.puzzle.slots.map((s, i) => i).filter((i) => !prog.found.has(i))
    .sort((a, b) => st.puzzle.slots[a].word.length - st.puzzle.slots[b].word.length);
  for (const i of order) {
    const cell = slotCells(st.puzzle.slots[i]).find(([r, c]) => !rev.has(`${r},${c}`));
    if (!cell) continue;
    prog.hinted.add(`${cell[0]},${cell[1]}`);
    p.hintsLeft--;
    p.score = Math.max(0, p.score - HINT_COST);
    autoComplete(st, prog);
    checkComplete(st, p, prog);
    return cell;
  }
  return null;
}

// --- Bots ---------------------------------------------------------------------------------------

function scheduleBot(room, botId, fresh) {
  const st = room.state;
  const p = st.players.get(botId);
  if (!p || !p.bot) return;
  const sp = BOT_SPEED[p.bot] || BOT_SPEED.hard;
  const puzzleId = st.puzzleId;
  const lead = fresh ? Math.max(0, st.startAt - Date.now()) + BOT_CFG.leadMs : 0;
  const delay = lead + sp.ms[0] + Math.random() * (sp.ms[1] - sp.ms[0]);
  clearTimeout(p.timer);
  p.timer = setTimeout(() => botAct(room, p, puzzleId), delay);
}

function stopBot(p) {
  if (p && p.timer) { clearTimeout(p.timer); p.timer = null; }
}

function botAct(room, p, puzzleId) {
  const st = room.state;
  p.timer = null;
  // Same bot object (not a removed-then-re-added namesake), same puzzle, still playing.
  if (st.players.get(p.clientId) !== p || st.puzzleId !== puzzleId || st.phase !== 'playing') return;
  const botId = p.clientId;
  const sp = BOT_SPEED[p.bot] || BOT_SPEED.hard;
  const prog = progOf(st, p);
  let word = null;
  const bonusLeft = st.puzzle.bonusList.filter((w) => !p.bonus.has(w));
  if (bonusLeft.length && Math.random() < sp.bonus) {
    word = bonusLeft[Math.floor(Math.random() * bonusLeft.length)];
  } else {
    const open = st.puzzle.slots.map((s, i) => i).filter((i) => !prog.found.has(i))
      .sort((a, b) => st.puzzle.slots[a].word.length - st.puzzle.slots[b].word.length);
    if (open.length) word = st.puzzle.slots[open[Math.floor(Math.random() * Math.min(2, open.length))]].word;
  }
  if (word) {
    const res = applyWord(st, p, word);
    if (res.outcome === 'found' || res.outcome === 'bonus') {
      sendEventAll(room, { kind: 'found', clientId: p.clientId, word: res.outcome === 'found' ? word : null, slot: res.slot, bonus: res.outcome === 'bonus' });
    }
    broadcastState(room);
  }
  if (st.phase === 'playing' && st.puzzleId === puzzleId) scheduleBot(room, botId, false);
}

// --- Views --------------------------------------------------------------------------------------

function buildView(room, viewerId) {
  const st = room.state;
  const pz = st.puzzle;
  const me = st.players.get(viewerId) || null;
  const prog = st.mode === 'race' ? (me ? me.prog : freshProg()) : st.coop;
  const over = st.phase === 'complete';
  const rev = revealedSet(st, prog);
  const cells = [];
  const solution = new Map();
  pz.slots.forEach((s) => slotCells(s).forEach(([r, c], i) => solution.set(`${r},${c}`, s.word[i])));
  for (const [k, ch] of solution) {
    const [r, c] = k.split(',').map(Number);
    if (rev.has(k)) cells.push([r, c, ch, prog.hinted.has(k) && !isFoundCell(st, prog, r, c) ? 1 : 0]);
    else if (over) cells.push([r, c, ch, 2]); // 2 = shown only because the level is over
  }
  const total = pz.slots.length;
  return {
    phase: st.phase,
    mode: st.mode,
    level: st.level,
    puzzleId: st.puzzleId,
    letters: pz.letters,
    rows: pz.rows,
    cols: pz.cols,
    slots: pz.slots.map((s, i) => ({
      r: s.r, c: s.c, dir: s.dir, len: s.word.length,
      found: prog.found.has(i), by: prog.found.get(i) || null,
      word: over || prog.found.has(i) ? s.word : undefined,
    })),
    cells,
    total,
    foundCount: prog.found.size,
    bonusTotal: pz.bonusList.length,
    players: [...st.players.values()].map((p) => ({
      clientId: p.clientId,
      nickname: p.nickname,
      color: p.color,
      bot: p.bot || undefined,
      score: p.score,
      words: p.words,
      levelWords: p.levelWords,
      bonusCount: p.bonus.size,
      raceWins: p.raceWins,
      progress: st.mode === 'race' ? p.prog.found.size : null,
      finishMs: p.finishMs,
    })),
    me: me ? { hintsLeft: me.hintsLeft, bonusWords: [...me.bonus].sort() } : null,
    winnerId: st.winnerId,
    startAt: st.startAt,
    solvedMs: st.phase === 'complete' ? st.solvedMs : null,
    serverNow: Date.now(),
    missedBonus: over ? pz.bonusList.filter((w) => !(me && me.bonus.has(w))).slice(0, 40) : undefined,
  };
}

function isFoundCell(st, prog, r, c) {
  for (const idx of prog.found.keys()) {
    if (slotCells(st.puzzle.slots[idx]).some(([rr, cc]) => rr === r && cc === c)) return true;
  }
  return false;
}

const envelope = (data) => ({ v: 1, type: 'game.event', payload: { gameType: TYPE, data } });

// One result per completed level (checked on every broadcast, which follows every move): race =
// the finisher first, then the rest by words found; co-op = one shared place. Score = solve time.
function reportIfComplete(room) {
  const st = room.state;
  if (st.phase !== 'complete' || st.reportedPuzzle === st.puzzleId) return;
  st.reportedPuzzle = st.puzzleId;
  const coopMs = st.solvedMs;
  reportRanked(room, [...st.players.values()].map((p) => (st.mode === 'coop' || p.clientId === st.winnerId
    ? { id: p.clientId, rank: Infinity, score: st.mode === 'coop' ? coopMs : p.finishMs, level: p.bot }
    : { id: p.clientId, rank: p.prog.found.size, level: p.bot })));
}

function broadcastState(room) {
  reportIfComplete(room);
  for (const clientId of room.clients.keys()) {
    room.sendTo(clientId, envelope({ kind: 'state', ...buildView(room, clientId) }));
  }
}

// Co-op finds are interesting to everyone (animate the fill); race finds only to the finder
// (a race rival only sees your progress bar move).
function sendEventAll(room, data) {
  const st = room.state;
  for (const clientId of room.clients.keys()) {
    if (st.mode === 'race' && clientId !== data.clientId) {
      room.sendTo(clientId, envelope({ ...data, word: null, slot: null }));
    } else room.sendTo(clientId, envelope(data));
  }
}

function addPlayer(st, clientId, nickname, bot) {
  if (st.players.has(clientId)) return st.players.get(clientId);
  const p = {
    clientId,
    nickname,
    bot: bot || null,
    color: COLOR_PALETTE[st.nextColorIdx++ % COLOR_PALETTE.length],
    score: 0,
    words: 0,
    bonusTotal: 0,
    raceWins: 0,
  };
  resetPlayerForLevel(p);
  st.players.set(clientId, p);
  return p;
}

module.exports = {
  type: TYPE,
  stats: { rated: true, score: { label: 'Solve time', better: 'low', format: 'ms' } },

  createInitialState() {
    const st = {
      phase: 'playing',
      mode: 'coop',
      level: 1,
      puzzleId: 0,
      puzzle: null,
      coop: null,
      winnerId: null,
      startAt: 0,
      nextColorIdx: 0,
      players: new Map(),
    };
    newLevel(st, 1, null);
    return st;
  },

  serializeSnapshot(room, client) {
    return buildView(room, client && client.clientId);
  },

  onJoin(room, client) {
    addPlayer(room.state, client.clientId, client.nickname, client.bot);
    broadcastState(room);
  },

  onLeave(room, client) {
    const st = room.state;
    stopBot(st.players.get(client.clientId));
    st.players.delete(client.clientId);
    if (!humanCount(st.players)) for (const p of st.players.values()) stopBot(p);
    dropBotsIfAlone(st.players);
    // An empty room starts the next visitor fresh at level 1 instead of mid-way through.
    if (!st.players.size) { st.mode = 'coop'; newLevel(st, 1, null); }
    broadcastState(room);
  },

  onMessage(room, client, data, ctx) {
    if (!data || typeof data.kind !== 'string') return;
    const st = room.state;
    const p = st.players.get(ctx.senderId);
    if (!p) return;

    if (data.kind === 'submit') {
      const res = applyWord(st, p, data.word);
      ctx.sendTo(ctx.senderId, envelope({ kind: 'result', word: typeof data.word === 'string' ? data.word.slice(0, 12).toLowerCase() : '', ...res }));
      if (res.outcome === 'found' || res.outcome === 'bonus') {
        sendEventAll(room, { kind: 'found', clientId: p.clientId, word: res.outcome === 'found' ? st.puzzle.slots[res.slot].word : null, slot: res.slot, bonus: res.outcome === 'bonus' });
        broadcastState(room);
      }
      return;
    }

    if (data.kind === 'hint') {
      const cell = applyHint(st, p);
      ctx.sendTo(ctx.senderId, envelope({ kind: 'hintResult', cell }));
      if (cell) broadcastState(room);
      return;
    }

    if (data.kind === 'nextLevel') {
      if (st.phase !== 'complete') return;
      newLevel(st, Math.min(99, st.level + 1), room);
      broadcastState(room);
      return;
    }

    if (data.kind === 'newPuzzle') {
      newLevel(st, st.level, room);
      broadcastState(room);
      return;
    }

    if (data.kind === 'restart') {
      newLevel(st, 1, room);
      broadcastState(room);
      return;
    }

    if (data.kind === 'setMode') {
      const mode = data.mode === 'race' ? 'race' : data.mode === 'coop' ? 'coop' : null;
      if (!mode || mode === st.mode) return;
      st.mode = mode;
      newLevel(st, st.level, room);
      broadcastState(room);
      return;
    }

    if (data.kind === 'addBot') {
      const b = newBot(st.players, data.level);
      if (!b) return;
      addPlayer(st, b.clientId, b.nickname, b.level);
      if (st.phase === 'playing') scheduleBot(room, b.clientId, true);
      broadcastState(room);
      return;
    }

    if (data.kind === 'removeBot') {
      if (!isBotId(data.clientId) || !st.players.has(data.clientId)) return;
      stopBot(st.players.get(data.clientId));
      st.players.delete(data.clientId);
      broadcastState(room);
    }
  },

  _test: { makePuzzle, validateLayout, tryLayout, layoutWords, applyWord, applyHint, slotCells, wheelSizeFor, mulberry32, BOT_SPEED, BOT_CFG },
};
