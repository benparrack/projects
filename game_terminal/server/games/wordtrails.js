// Word Trails: a last-letter word chain. Players take turns adding a word that starts with the
// LAST letter of the previous word (TRAIL → LEMON → NEST → ...). No repeats, every word must be in
// the shared dictionary (server/games/words.js) and at least the room's minimum length. Each turn
// is timed and the clock gets shorter as the trail grows; running out of time costs a life, and
// the last player with lives left wins. A wrong submission (not a word / wrong letter / already
// used / too short) doesn't cost a life — typos happen — but it burns PENALTY_MS off your clock.
// Played solo, it's a survival run: how long a trail can you build before your lives run out?
//
// Real-time: the room tick (TICK_MS) drives the countdown, turn timeouts and bot answers, so every
// timer re-checks its own state each tick and nothing free-runs past a reset or a leave. Clients
// get turnEndsAt + serverNow and animate the clock themselves.
//
// Bots (any number, + ADD BOT) know a vocabulary sized by level, take a level-dependent time to
// "think" (which eventually loses to the shrinking clock for weaker bots), and sometimes blank on
// a letter. Expert plays from the full dictionary and steers the trail onto letters with the
// fewest words left (trap letters like X, Q, Z, J).

'use strict';

const { COMMON, DICT_LIST, isWord } = require('./words');
const { isBotId, newBot, dropBotsIfAlone } = require('./tickBots');
const { reportRanked } = require('./wordResults');

const TYPE = 'wordtrails';
const TICK_MS = 100;
const COUNTDOWN_MS = 3000;
const PENALTY_MS = 2000;
const MIN_TURN_MS = 4000;
const SHRINK_PER_LAP_MS = 750; // each full lap of the table takes this much off the turn clock
const AFTER_LIFE_LOST_MS = 1200; // short beat after a timeout so everyone sees who lost the life
const MAX_WORD_LEN = 24;
const COLOR_PALETTE = ['#00eaff', '#ff2fb0', '#39ff14', '#ffb000', '#8c52ff', '#ff4d4d', '#ffee58', '#00ffa2'];

const OPTIONS = {
  lives: [1, 3, 5],
  turnSecs: [8, 12, 20],
  minLen: [3, 4, 5],
};
const DEFAULTS = { lives: 3, turnSecs: 12, minLen: 3 };

// Opening words: everyday words ending in a friendly letter, so turn one is never a trap.
const FRIENDLY_END = new Set('abcdefghilmnoprstw'.split(''));
const OPENERS = COMMON.filter((w) => w.length >= 4 && w.length <= 7 && FRIENDLY_END.has(w[w.length - 1]));

// Bot vocabularies, indexed by first letter. Built lazily (the full dictionary index is ~170k
// entries, only worth building once someone actually adds a bot).
// blank: base chance per turn of drawing a blank (timing out); fatigue: added per lap of the
// table, so long rounds always end; rare: extra blank chance on a trap letter (also thinks 1.6x).
const BOT = {
  easy: { vocab: 'common2k', thinkMs: [3500, 7000], blank: 0.08, fatigue: 0.02, rare: 0.5 },
  medium: { vocab: 'common', thinkMs: [2500, 5000], blank: 0.04, fatigue: 0.015, rare: 0.35 },
  hard: { vocab: 'commonPlus', thinkMs: [1500, 3200], blank: 0.02, fatigue: 0.01, rare: 0.2 },
  expert: { vocab: 'dict', thinkMs: [900, 2000], blank: 0.01, fatigue: 0.006, rare: 0.1, trap: true },
};
const RARE = new Set(['j', 'k', 'q', 'v', 'x', 'y', 'z']);
const vocabCache = {};
function vocab(name) {
  if (vocabCache[name]) return vocabCache[name];
  let list;
  if (name === 'common2k') list = COMMON.slice(0, 2000);
  else if (name === 'common') list = COMMON;
  else if (name === 'commonPlus') {
    // Everyday words plus real -s/-ing/-er forms: a big but human vocabulary.
    list = COMMON.slice();
    for (const w of COMMON) for (const suf of ['s', 'ing', 'er']) if (isWord(w + suf)) list.push(w + suf);
  }
  else list = DICT_LIST;
  const byFirst = {};
  for (const ch of 'abcdefghijklmnopqrstuvwxyz') byFirst[ch] = [];
  const seen = new Set();
  for (const w of list) {
    if (seen.has(w) || w.length > MAX_WORD_LEN || !/^[a-z]+$/.test(w)) continue;
    seen.add(w);
    byFirst[w[0]].push(w);
  }
  vocabCache[name] = byFirst;
  return byFirst;
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rand = (lo, hi) => lo + Math.random() * (hi - lo);

function freshPlayer(clientId, nickname, colorIdx) {
  return {
    clientId,
    nickname: nickname || 'Player',
    color: COLOR_PALETTE[colorIdx % COLOR_PALETTE.length],
    bot: null,
    inRound: false,
    lives: 0,
    words: 0,
    letters: 0,
    out: false,
    outAt: null,
    wins: 0,
    bestTrail: 0,
  };
}

function turnMsFor(st) {
  const laps = Math.floor(st.chain.length / Math.max(1, st.order.length));
  return Math.max(MIN_TURN_MS, st.settings.turnSecs * 1000 - laps * SHRINK_PER_LAP_MS);
}

const required = (st) => {
  const last = st.chain[st.chain.length - 1];
  return last ? last.word[last.word.length - 1] : null;
};
const currentId = (st) => (st.phase === 'playing' ? st.order[st.turnIdx] : null);
const alive = (st) => st.order.filter((id) => {
  const p = st.players.get(id);
  return p && !p.out;
});

function startRound(room, opts) {
  const st = room.state;
  const s = { ...st.settings };
  for (const k of Object.keys(OPTIONS)) {
    const v = Number(opts && opts[k]);
    if (OPTIONS[k].includes(v)) s[k] = v;
  }
  st.settings = s;
  st.roundId += 1;
  // Turn order: everyone in the room, shuffled.
  st.order = [...st.players.keys()].sort(() => Math.random() - 0.5);
  st.solo = st.order.length === 1; // fixed at the start: a duel whose rival leaves is still won
  for (const p of st.players.values()) {
    p.inRound = true;
    p.lives = s.lives;
    p.words = 0;
    p.letters = 0;
    p.out = false;
    p.outAt = null;
    p.botPlan = null;
  }
  const opener = pick(OPENERS);
  st.chain = [{ word: opener, by: null, name: 'TRAIL', color: '#9aa79a' }];
  st.used = new Set([opener]);
  st.turnIdx = 0;
  st.phase = 'countdown';
  st.startsAt = Date.now() + COUNTDOWN_MS;
  st.turnEndsAt = null;
  st.turnMs = null;
  st.pauseUntil = 0;
  st.lastEvent = null;
  st.endedAt = null;
  st.winner = null;
  st.endReason = null;
  st.gone = []; // players who left mid-round, ranked as knocked out when they left
}

function beginTurn(st, now) {
  st.turnMs = turnMsFor(st);
  st.turnEndsAt = now + st.turnMs;
  st.turnSeq += 1;
  const id = st.order[st.turnIdx];
  const p = st.players.get(id);
  if (p && p.bot) planBot(st, p, now);
}

// Advance to the next player who still has lives.
function advance(st, now) {
  const n = st.order.length;
  for (let k = 1; k <= n; k++) {
    const i = (st.turnIdx + k) % n;
    const p = st.players.get(st.order[i]);
    if (p && !p.out) {
      st.turnIdx = i;
      beginTurn(st, now);
      return;
    }
  }
}

function maybeEnd(st, now) {
  const left = alive(st);
  const solo = st.solo;
  if ((solo && left.length === 0) || (!solo && left.length <= 1)) {
    st.phase = 'results';
    st.endedAt = now;
    st.turnEndsAt = null;
    st.winner = solo ? null : (left[0] || null);
    st.endReason = solo ? 'solo_over' : 'last_standing';
    const w = st.winner && st.players.get(st.winner);
    if (w) w.wins += 1;
    const len = st.chain.length - 1;
    for (const id of st.order) {
      const p = st.players.get(id);
      if (p) p.bestTrail = Math.max(p.bestTrail, len);
    }
    return true;
  }
  return false;
}

// Result: the last one standing first, then everyone else in reverse knock-out order (leavers
// count as knocked out when they left). Solo: one place. Score = words this player added.
function reportRound(room) {
  const st = room.state;
  const entries = st.order.map((id) => st.players.get(id)).filter(Boolean)
    .map((p) => ({ id: p.clientId, rank: p.out ? p.outAt : Infinity, score: p.words, level: p.bot }));
  reportRanked(room, entries.concat(st.gone));
}

// The current player loses a life (timeout). Returns true if the round ended.
function loseLife(st, now) {
  const id = st.order[st.turnIdx];
  const p = st.players.get(id);
  if (p) {
    p.lives = Math.max(0, p.lives - 1);
    if (p.lives === 0) { p.out = true; p.outAt = now; }
  }
  st.lastEvent = { kind: 'timeout', clientId: id, name: p ? p.nickname : '?', out: !!(p && p.out), at: now, letter: required(st) };
  if (maybeEnd(st, now)) return true;
  // Same letter carries over to the next player; a short beat so the life loss registers.
  st.pauseUntil = now + AFTER_LIFE_LOST_MS;
  st.turnEndsAt = null;
  return false;
}

// Validate a word for the current turn. Returns null if fine, else a reason string.
function checkWord(st, word) {
  if (typeof word !== 'string') return 'not_word';
  const w = word.trim().toLowerCase();
  if (!/^[a-z]+$/.test(w) || w.length > MAX_WORD_LEN) return 'not_word';
  const need = required(st);
  if (need && w[0] !== need) return 'wrong_letter';
  if (w.length < st.settings.minLen) return 'too_short';
  if (st.used.has(w)) return 'used';
  if (!isWord(w)) return 'not_word';
  return null;
}

function acceptWord(st, p, w, now) {
  st.used.add(w);
  st.chain.push({ word: w, by: p.clientId, name: p.nickname, color: p.color, ms: now - (st.turnEndsAt - st.turnMs) });
  p.words += 1;
  p.letters += w.length;
  st.lastEvent = { kind: 'word', clientId: p.clientId, word: w, at: now };
  advance(st, now);
}

// ---- bots ----------------------------------------------------------------------------------

function trapScore(dict, letter, used) {
  // How many words are left that start with `letter` (fewer = nastier for the next player).
  const list = dict[letter] || [];
  let n = 0;
  for (const w of list) if (!used.has(w)) { n++; if (n > 400) break; }
  return n;
}

function chooseBotWord(st, level) {
  const cfg = BOT[level] || BOT.hard;
  const need = required(st);
  const dict = vocab(cfg.vocab);
  const pool = (need ? dict[need] : []).filter((w) => w.length >= st.settings.minLen && !st.used.has(w));
  if (!pool.length) return null;
  if (!cfg.trap) {
    // Weaker bots lean toward shorter words, like a person under time pressure.
    const sample = [];
    for (let k = 0; k < 12; k++) sample.push(pick(pool));
    sample.sort((a, b) => a.length - b.length);
    return level === 'easy' ? sample[0] : pick(sample.slice(0, 8));
  }
  // Expert: among a sample, pick the word whose last letter leaves the fewest replies.
  const full = vocab('dict');
  const cands = [];
  for (let k = 0; k < 40; k++) cands.push(pick(pool));
  let best = null;
  let bestScore = Infinity;
  for (const w of cands) {
    const s = trapScore(full, w[w.length - 1], st.used) + Math.random() * 5;
    if (s < bestScore) { best = w; bestScore = s; }
  }
  return best;
}

function planBot(st, p, now) {
  const cfg = BOT[p.bot] || BOT.hard;
  const need = required(st);
  const rare = RARE.has(need);
  const laps = Math.floor(st.chain.length / Math.max(1, st.order.length));
  const think = rand(cfg.thinkMs[0], cfg.thinkMs[1]) * (rare ? 1.6 : 1);
  const blank = Math.random() < cfg.blank + laps * cfg.fatigue + (rare ? cfg.rare : 0);
  p.botPlan = { turnSeq: st.turnSeq, at: now + think, word: blank ? null : chooseBotWord(st, p.bot) };
}

// ---- view ----------------------------------------------------------------------------------

function buildPublicState(room) {
  const st = room.state;
  return {
    kind: 'state',
    phase: st.phase,
    roundId: st.roundId,
    settings: st.settings,
    options: OPTIONS,
    penaltyMs: PENALTY_MS,
    chain: st.chain.slice(-60),
    chainLength: Math.max(0, st.chain.length - 1),
    order: st.order,
    turnId: currentId(st),
    required: required(st),
    turnEndsAt: st.turnEndsAt,
    turnMs: st.turnMs,
    startsAt: st.startsAt,
    endedAt: st.endedAt,
    winner: st.winner,
    endReason: st.endReason,
    solo: st.solo,
    lastEvent: st.lastEvent,
    serverNow: Date.now(),
    players: [...st.players.values()].map((p) => ({
      clientId: p.clientId, nickname: p.nickname, color: p.color, bot: p.bot || undefined,
      inRound: p.inRound, lives: p.lives, out: p.out, words: p.words, letters: p.letters,
      wins: p.wins, bestTrail: p.bestTrail,
    })),
  };
}

const envelope = (data) => ({ v: 1, type: 'game.event', payload: { gameType: TYPE, data } });
function broadcastState(room) {
  const env = envelope(buildPublicState(room));
  for (const id of room.clients.keys()) room.sendTo(id, env);
}
function reply(ctx, data) {
  ctx.sendTo(ctx.senderId, envelope(data));
}

function removePlayer(room, id) {
  const st = room.state;
  const p = st.players.get(id);
  if (!p) return false;
  const wasTurn = currentId(st) === id;
  st.players.delete(id);
  const idx = st.order.indexOf(id);
  if (idx !== -1 && (st.phase === 'playing' || st.phase === 'countdown')) {
    st.gone.push({ id, rank: p.out ? p.outAt : Date.now(), score: p.words, level: p.bot });
    st.order.splice(idx, 1);
    if (idx < st.turnIdx) st.turnIdx -= 1;
    if (st.turnIdx >= st.order.length) st.turnIdx = 0;
    const now = Date.now();
    if (st.order.length === 0) return true;
    if (st.phase === 'playing' && maybeEnd(st, now)) { reportRound(room); return true; }
    if (wasTurn) {
      // Hand the turn on: step back one so advance() lands on whoever now sits at this index
      // (also cuts short a post-timeout pause, which would otherwise skip that player).
      st.pauseUntil = 0;
      st.turnIdx = (st.turnIdx - 1 + st.order.length) % st.order.length;
      advance(st, now);
    }
  } else if (idx !== -1) {
    st.order.splice(idx, 1);
  }
  return true;
}

module.exports = {
  type: TYPE,
  stats: { rated: true, score: { label: 'Words chained', better: 'high', format: 'int' } },
  tickIntervalMs: TICK_MS,

  createInitialState() {
    return {
      phase: 'waiting', // 'waiting' | 'countdown' | 'playing' | 'results'
      settings: { ...DEFAULTS },
      roundId: 0,
      solo: false,
      order: [],
      turnIdx: 0,
      turnSeq: 0,
      turnEndsAt: null,
      turnMs: null,
      pauseUntil: 0,
      startsAt: null,
      chain: [],
      used: new Set(),
      lastEvent: null,
      endedAt: null,
      winner: null,
      endReason: null,
      nextColorIdx: 0,
      players: new Map(),
    };
  },

  serializeSnapshot(room) {
    return buildPublicState(room);
  },

  onJoin(room, client) {
    const st = room.state;
    const p = freshPlayer(client.clientId, client.nickname, st.nextColorIdx++);
    p.bot = client.bot || null;
    st.players.set(client.clientId, p);
    // Mid-round joiners watch and play from the next round.
  },

  onLeave(room, client) {
    const st = room.state;
    removePlayer(room, client.clientId);
    dropBotsIfAlone(st.players);
    if (![...st.players.keys()].some((id) => !isBotId(id))) {
      st.phase = 'waiting';
      st.order = [];
      st.turnEndsAt = null;
      return;
    }
    broadcastState(room);
  },

  tick(room) {
    const st = room.state;
    const now = Date.now();
    if (st.phase === 'countdown') {
      if (now < st.startsAt) return;
      st.phase = 'playing';
      st.turnIdx = 0;
      beginTurn(st, now);
      broadcastState(room);
      return;
    }
    if (st.phase !== 'playing') return;
    if (st.pauseUntil) {
      if (now < st.pauseUntil) return;
      st.pauseUntil = 0;
      advance(st, now);
      broadcastState(room);
      return;
    }
    if (st.turnEndsAt && now >= st.turnEndsAt) {
      if (loseLife(st, now)) reportRound(room);
      broadcastState(room);
      return;
    }
    const p = st.players.get(currentId(st));
    if (p && p.bot && p.botPlan && p.botPlan.turnSeq === st.turnSeq && p.botPlan.word && now >= p.botPlan.at) {
      const w = p.botPlan.word;
      p.botPlan = null;
      if (!checkWord(st, w)) {
        acceptWord(st, p, w, now);
        broadcastState(room);
      }
    }
  },

  onMessage(room, client, data, ctx) {
    if (!data || typeof data.kind !== 'string') return;
    const st = room.state;
    const me = st.players.get(ctx.senderId);
    if (!me) return;

    if (data.kind === 'start') {
      if (st.phase === 'playing' || st.phase === 'countdown') return;
      startRound(room, data);
      broadcastState(room);
      return;
    }
    if (data.kind === 'addBot') {
      if (st.phase === 'playing' || st.phase === 'countdown') return;
      const b = newBot(st.players, data.level);
      if (!b) return;
      module.exports.onJoin(room, { clientId: b.clientId, nickname: b.nickname, bot: b.level });
      broadcastState(room);
      return;
    }
    if (data.kind === 'removeBot') {
      if (!isBotId(data.clientId) || !st.players.has(data.clientId)) return;
      removePlayer(room, data.clientId);
      broadcastState(room);
      return;
    }
    if (data.kind === 'typing') {
      // Live preview of the current player's input for everyone else (not stored).
      if (currentId(st) !== ctx.senderId) return;
      const text = typeof data.text === 'string' ? data.text.toLowerCase().replace(/[^a-z]/g, '').slice(0, MAX_WORD_LEN) : '';
      const env = envelope({ kind: 'typing', clientId: ctx.senderId, text, turnSeq: st.turnSeq });
      for (const id of room.clients.keys()) if (id !== ctx.senderId) room.sendTo(id, env);
      return;
    }
    if (data.kind === 'submit') {
      if (st.phase !== 'playing' || st.pauseUntil) return reply(ctx, { kind: 'rejected', reason: 'not_playing' });
      if (currentId(st) !== ctx.senderId) return reply(ctx, { kind: 'rejected', reason: 'not_your_turn' });
      const w = typeof data.word === 'string' ? data.word.trim().toLowerCase() : '';
      const reason = checkWord(st, w);
      const now = Date.now();
      if (reason) {
        st.turnEndsAt = Math.max(now, st.turnEndsAt - PENALTY_MS);
        st.lastEvent = { kind: 'reject', clientId: me.clientId, word: w.slice(0, MAX_WORD_LEN), reason, at: now };
        reply(ctx, { kind: 'rejected', reason, word: w.slice(0, MAX_WORD_LEN) });
        broadcastState(room);
        return;
      }
      acceptWord(st, me, w, now);
      broadcastState(room);
    }
  },

  // Exposed for tests.
  _internals: { planBot, RARE, checkWord, chooseBotWord, turnMsFor, vocab, BOT, OPTIONS, PENALTY_MS, MIN_TURN_MS, AFTER_LIFE_LOST_MS, COUNTDOWN_MS },
};
