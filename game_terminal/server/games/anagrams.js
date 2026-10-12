// Anagrams (GamePigeon-style): everyone in the room gets the same six letters and 60 seconds to
// make as many 3-6 letter words from them as they can. Each player builds their own list (two
// players can both score the same word); points grow steeply with length — 3 letters = 100,
// 4 = 400, 5 = 1200, 6 = 2000 — and the highest total when the clock runs out wins.
// Event-driven (setTimeout for the round end and the bots), like Word Search.
//
// The letters always come from a shuffled everyday six-letter word, so there is at least one
// 6-letter answer. Other players' words and the full answer list stay server-side until the
// round is over — during play clients only see everyone's score and word count.

'use strict';

const { COMMON, isWord, letterCounts, canSpell, wordsFromLetters } = require('./words');
const { isBotId, newBot, dropBotsIfAlone } = require('./tickBots');
const { reportRanked } = require('./wordResults');
const { mulberry32 } = require('../daily');

const TYPE = 'anagrams';
const LETTERS = 6;
const MIN_LEN = 3;
const ROUND_MS = 60 * 1000;
const COUNTDOWN_MS = 3000;
const MIN_COMMON_WORDS = 10; // a letter set must hide at least this many everyday words
const POINTS = { 3: 100, 4: 400, 5: 1200, 6: 2000 };
const COLOR_PALETTE = ['#00eaff', '#ff2fb0', '#39ff14', '#ffb000', '#8c52ff', '#ff4d4d', '#ffee58', '#00ffa2'];

// The shared dictionary also holds the system word list, whose short entries include
// abbreviations that shouldn't count as words here.
const JUNK = new Set((
  'adj adv amt avg bpm cal dds doz dpi eds esp est etc foo ftp fum fwd gov hgt hoc hos hrs hwy ' +
  'iii inc ind int lbs lii lix lvi lxi meg mes mfg mfr min mpg mph neg non obj pct pkg pwn rpm rps ' +
  'rte tbs tsp vii viz vol xci xii xiv xix xor xvi xxi xxv xxx yrs natl intl dept govt assn ' +
  'corp mgmt mgr mfrs sept octo nov dec jan feb mar apr aug oct'
).split(/\s+/).filter(Boolean));

const isAnagramWord = (w) => w.length >= MIN_LEN && w.length <= LETTERS && !JUNK.has(w) && isWord(w);
const pointsFor = (word) => POINTS[word.length] || 0;

const BASES = COMMON.filter((w) => w.length === LETTERS && /^[a-z]+$/.test(w));

function shuffle(arr, rand = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Picks a base word with enough everyday sub-words and returns the shuffled letter set plus the
// full answer list (longest first). The shuffled order never spells a 6-letter answer.
function makePuzzle(rand = Math.random) {
  for (let tries = 0; tries < 500; tries++) {
    const base = BASES[Math.floor(rand() * BASES.length)];
    const common = wordsFromLetters(base, { minLen: MIN_LEN, common: true }).filter(isAnagramWord);
    if (common.length < MIN_COMMON_WORDS) continue;
    const answers = [...new Set(wordsFromLetters(base, { minLen: MIN_LEN }).filter(isAnagramWord))];
    const sixes = new Set(answers.filter((w) => w.length === LETTERS));
    let letters = base.split('');
    for (let k = 0; k < 50 && sixes.has(letters.join('')); k++) letters = shuffle(letters, rand);
    answers.sort((a, b) => b.length - a.length || a.localeCompare(b));
    return { base, letters: letters.join(''), answers, common };
  }
  throw new Error('anagrams: could not pick a letter set');
}

// --- CPU players: each "thinks of" a word from its pool every few seconds. Weaker bots know fewer,
// shorter, everyday words; Expert goes after the long ones first.
const BOT = {
  easy: { minMs: 6000, maxMs: 10000, maxLen: 4, order: 'short' },
  medium: { minMs: 3500, maxMs: 6000, maxLen: 5, order: 'random' },
  hard: { minMs: 2200, maxMs: 3600, maxLen: 6, order: 'random' },
  expert: { minMs: 1300, maxMs: 2200, maxLen: 6, order: 'long' },
};

function botPool(st, level) {
  const cfg = BOT[level] || BOT.hard;
  const pool = shuffle(st.common.filter((w) => w.length <= cfg.maxLen));
  if (cfg.order === 'short') pool.sort((a, b) => a.length - b.length);
  if (cfg.order === 'long') pool.sort((a, b) => b.length - a.length);
  return pool;
}

function scheduleBot(room, clientId) {
  const st = room.state;
  const p = st.players.get(clientId);
  if (!p || !p.bot || st.phase !== 'playing') return;
  const cfg = BOT[p.bot] || BOT.hard;
  const roundId = st.roundId;
  if (!p.botPool) p.botPool = botPool(st, p.bot);
  const delay = Math.max(0, st.startedAt - Date.now()) + cfg.minMs + Math.random() * (cfg.maxMs - cfg.minMs);
  if (p.botTimer) clearTimeout(p.botTimer);
  p.botTimer = setTimeout(() => {
    p.botTimer = null;
    if (st.roundId !== roundId || st.phase !== 'playing' || !st.players.has(clientId)) return;
    const word = p.botPool.find((w) => !p.found.includes(w));
    if (!word) return;
    scoreWord(st, p, word);
    broadcastState(room);
    scheduleBot(room, clientId);
  }, delay);
}

function clearBotTimers(st) {
  for (const p of st.players.values()) {
    if (p.botTimer) { clearTimeout(p.botTimer); p.botTimer = null; }
  }
}

function freshPlayer(clientId, nickname, colorIdx) {
  return { clientId, nickname, color: COLOR_PALETTE[colorIdx % COLOR_PALETTE.length], score: 0, found: [], wins: 0, bot: null, inRound: false };
}

function scoreWord(st, p, word) {
  const points = pointsFor(word);
  p.found.push(word);
  p.score += points;
  p.inRound = true;
  return points;
}

// Checks a submission against the round's letters and dictionary. Returns { outcome, word, points }.
function judge(st, p, raw) {
  if (st.phase !== 'playing' || Date.now() < st.startedAt || Date.now() >= st.endsAt) return { outcome: 'closed' };
  const word = typeof raw === 'string' ? raw.toLowerCase().trim() : '';
  if (!/^[a-z]+$/.test(word) || word.length > LETTERS || !canSpell(word, letterCounts(st.letters))) return { outcome: 'invalid', word };
  if (word.length < MIN_LEN) return { outcome: 'short', word };
  if (p.found.includes(word)) return { outcome: 'already', word };
  if (!st.answerSet.has(word)) return { outcome: 'not_word', word };
  return { outcome: 'found', word, points: scoreWord(st, p, word) };
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
  const pz = makePuzzle(room.daily ? mulberry32(room.daily.seed) : undefined); // daily: same letters for everyone
  st.base = pz.base;
  st.letters = pz.letters;
  st.answers = pz.answers;
  st.answerSet = new Set(pz.answers);
  st.common = pz.common;
  st.roundId += 1;
  st.phase = 'playing';
  st.startedAt = Date.now() + COUNTDOWN_MS;
  st.endsAt = st.startedAt + ROUND_MS;
  st.endedAt = null;
  for (const p of st.players.values()) { p.score = 0; p.found = []; p.inRound = true; p.botPool = null; }
  clearTimeout(st.roundTimer);
  const roundId = st.roundId;
  st.roundTimer = setTimeout(() => {
    if (st.roundId !== roundId) return;
    endRound(room);
    broadcastState(room);
  }, st.endsAt - Date.now());
  for (const p of st.players.values()) if (p.bot) scheduleBot(room, p.clientId);
}

// Per-viewer view: your own words always; everyone else's (and the answer list) only after the round.
function buildView(room, forId) {
  const st = room.state;
  const over = st.phase === 'results';
  const me = st.players.get(forId);
  return {
    kind: 'state',
    phase: st.phase,
    roundId: st.roundId,
    letters: st.letters,
    startedAt: st.startedAt,
    endsAt: st.endsAt,
    endedAt: st.endedAt,
    serverNow: Date.now(),
    roundMs: ROUND_MS,
    points: POINTS,
    totalWords: st.answers ? st.answers.length : 0,
    answers: over ? st.answers : null,
    base: over ? st.base : null,
    myWords: me ? me.found : [],
    players: [...st.players.values()].map((p) => ({
      clientId: p.clientId, nickname: p.nickname, color: p.color, bot: p.bot || undefined,
      score: p.score, count: p.found.length, wins: p.wins, inRound: !!p.inRound,
      words: over || p.clientId === forId ? p.found : undefined,
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
    return {
      phase: 'waiting', // 'waiting' | 'playing' | 'results'
      roundId: 0,
      base: null,
      letters: null,
      answers: null,
      answerSet: new Set(),
      common: [],
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
    // Joining mid-round: you can play straight away with whatever time is left.
    p.inRound = st.phase === 'playing';
    st.players.set(client.clientId, p);
    if (p.bot && st.phase === 'playing') scheduleBot(room, p.clientId);
  },

  onLeave(room, client) {
    const st = room.state;
    const p = st.players.get(client.clientId);
    if (p && p.botTimer) clearTimeout(p.botTimer);
    st.players.delete(client.clientId);
    dropBotsIfAlone(st.players);
    if (![...st.players.keys()].some((id) => !isBotId(id))) {
      // Nobody human left: stop the round so no timers keep running for an empty room.
      clearBotTimers(st);
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
      const res = judge(st, me, data.word);
      reply(ctx, { kind: 'result', ...res });
      if (res.outcome === 'found') broadcastState(room);
    }
  },

  _internals: { makePuzzle, judge, pointsFor, isAnagramWord, BOT, POINTS, ROUND_MS, COUNTDOWN_MS, JUNK },
};
