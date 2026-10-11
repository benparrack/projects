// Word Hunt (GamePigeon-style): everyone gets the SAME 4x4 letter grid and 80 seconds. Swipe
// through touching letters (8 directions, each tile once per word) to spell words of 3+ letters.
// Unlike Word Search this isn't a claim race — every player keeps their own list, scored by
// length (3=100, 4=400, 5=800, 6=1400, 7=1800, 8+=2200), and the scores are compared at the end.
// Event-driven (no tick loop): one round timer plus a timer per bot.
//
// Grids are rolled from Boggle-style dice and re-rolled until they hold plenty of words (checked
// by a DFS over the grid with prefix pruning against the sorted shared dictionary). Nobody sees
// anyone else's words, or the list of all words in the grid, until the round is over.

'use strict';

const { DICT_LIST, COMMON_SET, isWord } = require('./words');
const { isBotId, newBot, dropBotsIfAlone } = require('./tickBots');
const { reportRanked } = require('./wordResults');

const TYPE = 'wordhunt';
const N = 4;
const ROUND_MS = 80 * 1000;
const COUNTDOWN_MS = 3000;
const MIN_LEN = 3;
const COLOR_PALETTE = ['#00eaff', '#ff2fb0', '#39ff14', '#ffb000', '#8c52ff', '#ff4d4d', '#ffee58', '#00ffa2'];

// The 16 "new" Boggle dice, with the Qu face swapped for plain letters (GamePigeon has no Qu tile
// and a lone Q makes a dead corner).
const DICE = [
  'aaeegn', 'abbjoo', 'achops', 'affkps', 'aoottw', 'cimotu', 'deilrx', 'delrvy',
  'distty', 'eeghnw', 'eeinsu', 'ehrtvw', 'eiosst', 'elrtty', 'himnru', 'hlnnrz',
];

// The shared dictionary includes the system word list, whose short entries include
// abbreviations (ETC, MPH, ...) — not words anyone would accept in a word game.
const JUNK = new Set((
  'adj adv amt avg bpm cal dds doz dpi eds esp est etc foo ftp fum fwd gov hgt hoc hos hrs hwy ' +
  'iii inc ind int lbs lii lix lvi lxi meg mes mfg mfr min mpg mph neg non obj pct pkg pwn rpm rps ' +
  'rte tbs tsp vii viz vol xci xii xiv xix xor xvi xxi xxv xxx yrs fag cum'
).split(/\s+/).filter(Boolean));

const isValid = (w) => typeof w === 'string' && w.length >= MIN_LEN && w.length <= N * N && !JUNK.has(w) && isWord(w);

// Sorted list for prefix checks: a prefix exists iff the first entry >= it starts with it.
const SORTED = DICT_LIST.filter((w) => w.length >= MIN_LEN && w.length <= N * N).sort();
function hasPrefix(p) {
  let lo = 0;
  let hi = SORTED.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (SORTED[mid] < p) lo = mid + 1; else hi = mid;
  }
  return lo < SORTED.length && SORTED[lo].startsWith(p);
}

const pointsFor = (len) => (len < 3 ? 0 : len === 3 ? 100 : len === 4 ? 400 : len === 5 ? 800 : len === 6 ? 1400 : len === 7 ? 1800 : 2200);

function shuffle(arr, rand = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const NEIGHBORS = (() => {
  const out = [];
  for (let i = 0; i < N * N; i++) {
    const r = Math.floor(i / N);
    const c = i % N;
    const list = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr;
        const cc = c + dc;
        if (rr >= 0 && rr < N && cc >= 0 && cc < N) list.push(rr * N + cc);
      }
    }
    out.push(list);
  }
  return out;
})();

// Every valid word in the grid (grid = string of N*N letters, row-major) -> Map word -> path.
function solve(grid) {
  const found = new Map();
  const used = new Array(N * N).fill(false);
  const path = [];
  const prefixOk = new Map();
  const ok = (p) => {
    let v = prefixOk.get(p);
    if (v === undefined) { v = hasPrefix(p); prefixOk.set(p, v); }
    return v;
  };
  function dfs(i, word) {
    used[i] = true;
    path.push(i);
    if (word.length >= MIN_LEN && !found.has(word) && isValid(word)) found.set(word, path.slice());
    for (const j of NEIGHBORS[i]) {
      if (used[j]) continue;
      const next = word + grid[j];
      if (ok(next)) dfs(j, next);
    }
    path.pop();
    used[i] = false;
  }
  for (let i = 0; i < N * N; i++) if (ok(grid[i])) dfs(i, grid[i]);
  return found;
}

// A grid worth playing: lots of words, a healthy number of everyday ones, and some long ones.
function generateGrid(rand = Math.random) {
  let best = null;
  for (let attempt = 0; attempt < 400; attempt++) {
    const dice = shuffle(DICE.slice(), rand);
    const grid = dice.map((d) => d[Math.floor(rand() * 6)]).join('');
    const words = solve(grid);
    const all = [...words.keys()];
    const common = all.filter((w) => COMMON_SET.has(w)).length;
    const long = all.filter((w) => w.length >= 5).length;
    const score = all.length + common * 2 + long;
    if (!best || score > best.score) best = { grid, words, score };
    if (all.length >= 70 && common >= 22 && long >= 8) return { grid, words };
  }
  return { grid: best.grid, words: best.words };
}

// --- CPU players. Each level finds a share of the grid's words from a level-appropriate pool,
// spread over the round (short words early, long words later, like a person scanning).
const BOT = {
  easy: { share: 0.12, maxLen: 4, commonOnly: true, cap: 9 },
  medium: { share: 0.25, maxLen: 5, commonOnly: true, cap: 18 },
  hard: { share: 0.4, maxLen: 7, commonOnly: false, cap: 32 },
  expert: { share: 0.62, maxLen: 16, commonOnly: false, cap: 60 },
};

function planBot(words, level, rand = Math.random) {
  const cfg = BOT[level] || BOT.hard;
  const pool = [...words.keys()].filter((w) => w.length <= cfg.maxLen && (!cfg.commonOnly || COMMON_SET.has(w)
    || (level === 'medium' && w.length <= 4 && rand() < 0.15)));
  // Everyday words are spotted first; experts also favour long words.
  const weight = (w) => (COMMON_SET.has(w) ? 3 : 1) * (level === 'expert' ? w.length : 1) * (0.5 + rand());
  const ranked = pool.map((w) => ({ w, k: weight(w) })).sort((a, b) => b.k - a.k).map((x) => x.w);
  const count = Math.min(cfg.cap, ranked.length, Math.max(1, Math.round(words.size * cfg.share)));
  const picks = ranked.slice(0, count);
  // Times: spread across the round with jitter; longer words land a bit later.
  return picks.map((w) => ({ word: w, at: Math.min(ROUND_MS - 400, (0.04 + 0.92 * rand() * (0.55 + 0.1 * Math.min(4, w.length - 3))) * ROUND_MS) }))
    .sort((a, b) => a.at - b.at);
}

function freshPlayer(clientId, nickname, colorIdx) {
  return { clientId, nickname, color: COLOR_PALETTE[colorIdx % COLOR_PALETTE.length], score: 0, words: [], wins: 0, bot: null, inRound: false, botTimer: null };
}

function scheduleBot(room, p) {
  const st = room.state;
  if (!p.bot || st.phase !== 'playing') return;
  if (!p.plan || p.planRound !== st.roundId) {
    p.plan = planBot(st.solutions, p.bot);
    p.planRound = st.roundId;
    // Joined mid-round: drop what would already have been found.
    const elapsed = Date.now() - st.startedAt;
    if (elapsed > 0) p.plan = p.plan.filter((x) => x.at > elapsed);
  }
  const next = p.plan[0];
  if (!next) return;
  const roundId = st.roundId;
  if (p.botTimer) clearTimeout(p.botTimer);
  p.botTimer = setTimeout(() => {
    p.botTimer = null;
    if (st.roundId !== roundId || st.phase !== 'playing' || !st.players.has(p.clientId)) return;
    p.plan.shift();
    if (!p.words.includes(next.word)) addWord(p, next.word);
    broadcastState(room);
    scheduleBot(room, p);
  }, Math.max(0, st.startedAt + next.at - Date.now()));
}

function clearBotTimers(st) {
  for (const p of st.players.values()) {
    if (p.botTimer) { clearTimeout(p.botTimer); p.botTimer = null; }
  }
}

function addWord(p, word) {
  p.words.push(word);
  p.score += pointsFor(word.length);
}

function endRound(room) {
  const st = room.state;
  if (st.phase !== 'playing') return;
  st.phase = 'results';
  st.endedAt = Date.now();
  clearTimeout(st.roundTimer);
  st.roundTimer = null;
  clearBotTimers(st);
  const ranked = [...st.players.values()].filter((p) => p.inRound).sort((a, b) => b.score - a.score);
  if (ranked.length) reportRanked(room, ranked.map((p) => ({ id: p.clientId, rank: p.score, score: p.score, level: p.bot })));
  if (ranked.length && ranked[0].score > 0) {
    for (const p of ranked) if (p.score === ranked[0].score) p.wins += 1;
  }
}

function startRound(room) {
  const st = room.state;
  const { grid, words } = generateGrid();
  st.grid = grid;
  st.solutions = words;
  st.roundId += 1;
  st.phase = 'playing';
  st.startedAt = Date.now() + COUNTDOWN_MS;
  st.endsAt = st.startedAt + ROUND_MS;
  st.endedAt = null;
  for (const p of st.players.values()) {
    p.score = 0;
    p.words = [];
    p.inRound = true;
    p.plan = null;
  }
  clearTimeout(st.roundTimer);
  const roundId = st.roundId;
  st.roundTimer = setTimeout(() => {
    if (st.roundId !== roundId || st.phase !== 'playing') return;
    endRound(room);
    broadcastState(room);
  }, st.endsAt - Date.now());
  for (const p of st.players.values()) if (p.bot) scheduleBot(room, p);
}

// Per-viewer: your own words always; everyone else's words (and the full solution list) only
// once the round is over.
function buildView(room, viewerId) {
  const st = room.state;
  const over = st.phase === 'results';
  const counting = st.phase === 'playing' && Date.now() < st.startedAt;
  let allWords = null;
  if (over && st.solutions) {
    allWords = [...st.solutions.entries()]
      .map(([word, path]) => ({ word, path, common: COMMON_SET.has(word) }))
      .sort((a, b) => b.word.length - a.word.length || (b.common - a.common) || a.word.localeCompare(b.word));
  }
  return {
    kind: 'state',
    phase: st.phase,
    roundId: st.roundId,
    // The letters are sent during the countdown too; the client scrambles them until GO.
    grid: st.grid,
    startedAt: st.startedAt,
    endsAt: st.endsAt,
    endedAt: st.endedAt,
    serverNow: Date.now(),
    totalWords: over && st.solutions ? st.solutions.size : null,
    allWords,
    counting,
    players: [...st.players.values()].map((p) => ({
      clientId: p.clientId,
      nickname: p.nickname,
      color: p.color,
      bot: p.bot || undefined,
      score: p.score,
      count: p.words.length,
      wins: p.wins,
      inRound: !!p.inRound,
      words: over || p.clientId === viewerId ? p.words.slice() : undefined,
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

// Validates a swiped path (array of cell indices): in range, distinct, each step touching the last.
function wordFromPath(grid, path) {
  if (!Array.isArray(path) || path.length < 1 || path.length > N * N) return null;
  const seen = new Set();
  let word = '';
  for (let k = 0; k < path.length; k++) {
    const i = path[k];
    if (!Number.isInteger(i) || i < 0 || i >= N * N || seen.has(i)) return null;
    if (k > 0 && !NEIGHBORS[path[k - 1]].includes(i)) return null;
    seen.add(i);
    word += grid[i];
  }
  return word;
}

module.exports = {
  type: TYPE,
  stats: { rated: true, score: { label: 'Points', better: 'high', format: 'pts' } },

  createInitialState() {
    return {
      phase: 'waiting', // 'waiting' | 'playing' | 'results'
      grid: null,
      solutions: null,
      roundId: 0,
      startedAt: null,
      endsAt: null,
      endedAt: null,
      roundTimer: null,
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
    // Joining mid-round: you can start swiping straight away with whatever time is left.
    p.inRound = st.phase === 'playing';
    st.players.set(client.clientId, p);
    if (p.bot && st.phase === 'playing') scheduleBot(room, p);
    if (!p.bot) broadcastState(room);
  },

  onLeave(room, client) {
    const st = room.state;
    const p = st.players.get(client.clientId);
    if (p && p.botTimer) clearTimeout(p.botTimer);
    st.players.delete(client.clientId);
    if (![...st.players.keys()].some((id) => !isBotId(id))) {
      // Nobody human left: stop the round so no timers keep running for an empty room
      // (clear bot timers before the bots themselves are dropped).
      clearBotTimers(st);
      dropBotsIfAlone(st.players);
      clearTimeout(st.roundTimer);
      st.roundTimer = null;
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

    if (data.kind === 'submit') {
      const seq = Number.isInteger(data.seq) ? data.seq : 0;
      if (st.phase !== 'playing' || Date.now() < st.startedAt) return reply(ctx, { kind: 'result', seq, outcome: 'closed' });
      const word = wordFromPath(st.grid, data.path);
      if (word === null) return reply(ctx, { kind: 'result', seq, outcome: 'bad_path' });
      if (word.length < MIN_LEN) return reply(ctx, { kind: 'result', seq, outcome: 'short', word });
      if (me.words.includes(word)) return reply(ctx, { kind: 'result', seq, outcome: 'already', word });
      if (!isValid(word)) return reply(ctx, { kind: 'result', seq, outcome: 'invalid', word });
      me.inRound = true;
      addWord(me, word);
      reply(ctx, { kind: 'result', seq, outcome: 'found', word, points: pointsFor(word.length) });
      broadcastState(room);
    }
  },

  // Exposed for tests.
  _internals: { endRound, scheduleBot, solve, generateGrid, planBot, pointsFor, wordFromPath, isValid, NEIGHBORS, BOT, N, ROUND_MS, COUNTDOWN_MS },
};
