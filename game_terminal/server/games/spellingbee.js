// Spelling Bee: hear a word (or read its clues), then spell it. Three formats share one engine:
//
//   race       Everyone gets the same 10 words at once. A correct spelling scores the word's tier
//              (100/200/300/400) plus up to 50% for speed; a hint (first letter + length) halves
//              it. Highest total wins. Solo, with bots, daily and ranked all use this format.
//   bee        A real spelling bee: players take turns, each with their own word, and one miss
//              knocks you out at the end of the round (if everyone in a round misses, they all
//              stay in). Last speller standing wins. Alone it's survival: one miss ends the run.
//   pronounce  People take turns as the pronouncer: they pick a suggested word (or any dictionary
//              word), say it into the mic or out loud on voice chat, and everyone else spells it.
//
// The word itself never reaches a speller's client before the reveal. Spoken clues are pre-made
// clips (scripts/spellingbee-audio.py) named by random IDs, and the word -> ID map stays here.
// Clients send their in-progress spelling as a draft so a timeout still counts what was typed,
// and in bee format the speller's draft is shown live to the room.

'use strict';

const { isWord } = require('./words');
const { isBotId, newBot, dropBotsIfAlone } = require('./tickBots');
const { reportRanked } = require('./wordResults');
const { mulberry32, shuffle } = require('../daily');
const WORDS = require('./data/spellingbee_words.json');
const AUDIO = require('./data/spellingbee_audio.json');

const TYPE = 'spellingbee';
const TIERS = ['easy', 'medium', 'hard', 'expert'];
const LEVELS = [...TIERS, 'mix'];
const FORMATS = ['race', 'bee', 'pronounce'];
const CLUES = ['spoken', 'written'];
const BASE_POINTS = { easy: 100, medium: 200, hard: 300, expert: 400 };
const SPELL_MS = { easy: 30000, medium: 40000, hard: 50000, expert: 60000 };
const RACE_WORDS = 10;
const RACE_MIX = ['easy', 'easy', 'easy', 'medium', 'medium', 'medium', 'hard', 'hard', 'expert', 'expert'];
const COUNTDOWN_MS = 3000;
const LEAD_MS = 1200; // pause before each later word so its clip can start
const REVEAL_MS = 6000;
const BEE_REVEAL_MS = 4000;
const PICK_MS = 60000;
const MAX_BEE_ROUNDS = 30;
const MAX_LEN = 30;
const MAX_CLIP_CHARS = 48000; // base64; ~6s of 24 kbps opus fits easily, under the 64 KB frame cap
const CLIP_TYPES = new Set(['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac']);
const COLOR_PALETTE = ['#00eaff', '#ff2fb0', '#39ff14', '#ffb000', '#8c52ff', '#ff4d4d', '#ffee58', '#00ffa2'];

// Chance a bot spells a word right, by bot level then word tier.
const BOT_ACCURACY = {
  easy: { easy: 0.8, medium: 0.55, hard: 0.3, expert: 0.12 },
  medium: { easy: 0.92, medium: 0.75, hard: 0.5, expert: 0.25 },
  hard: { easy: 0.97, medium: 0.88, hard: 0.72, expert: 0.45 },
  expert: { easy: 0.99, medium: 0.95, hard: 0.88, expert: 0.7 },
};
const BOT_SPEED = { easy: { think: 6000, key: 320 }, medium: { think: 4500, key: 240 }, hard: { think: 3200, key: 180 }, expert: { think: 2200, key: 130 } };

const norm = (s) => (typeof s === 'string' ? s.toLowerCase().replace(/[^a-z]/g, '').slice(0, MAX_LEN) : '');
const accepts = (entry, attempt) => !!attempt && (attempt === entry.w || (entry.a || []).includes(attempt));
const tierByLength = (w) => (w.length <= 5 ? 'easy' : w.length <= 8 ? 'medium' : w.length <= 11 ? 'hard' : 'expert');
const blank = (sentence, word) => sentence.replace(new RegExp(`\\b${word}\\b`, 'gi'), '_____');

function pointsFor(tier, hinted, leftFrac) {
  const raw = BASE_POINTS[tier] * (hinted ? 0.5 : 1) * (1 + 0.5 * Math.max(0, Math.min(1, leftFrac)));
  return Math.round(raw / 10) * 10;
}

// A believable wrong spelling for bots: the classic slips (doubling, ie/ei, a vowel, a swap).
function misspell(word, alts = [], rand = Math.random) {
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const ops = [
    (w) => w.replace(/([bcdfglmnprstz])\1/, '$1'),
    (w) => { const m = [...w.matchAll(/[bcdfglmnprst](?=[aeiouy])/g)].filter((x) => x.index > 0); if (!m.length) return w; const x = pick(m); return w.slice(0, x.index) + x[0] + w.slice(x.index); },
    (w) => (w.includes('ie') ? w.replace('ie', 'ei') : w.replace('ei', 'ie')),
    (w) => { const m = [...w.matchAll(/[aeio]/g)].filter((x) => x.index > 0 && x.index < w.length - 1); if (!m.length) return w; const x = pick(m); return w.slice(0, x.index) + pick('aeio'.replace(x[0], '').split('')) + w.slice(x.index + 1); },
    (w) => { if (w.length < 4) return w; const i = 1 + Math.floor(rand() * (w.length - 3)); return w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2); },
    (w) => w.replace(/([^aeiou])h/, '$1'),
    (w) => w.replace(/ck/, 'k').replace(/ph/, 'f'),
  ];
  for (let i = 0; i < 40; i++) {
    const out = pick(ops)(word);
    if (out !== word && out.length >= 2 && !alts.includes(out)) return out;
  }
  return word.endsWith('e') ? word.slice(0, -1) : `${word}e`;
}

// --- word decks: each tier is shuffled once and dealt without repeats until it runs out.
function draw(st, tier) {
  if (!st.decks[tier] || !st.decks[tier].length) st.decks[tier] = shuffle(WORDS[tier].map((_, i) => i), st.rand);
  return { ...WORDS[tier][st.decks[tier].pop()], tier };
}

function freshPlayer(clientId, nickname, colorIdx) {
  return { clientId, nickname, color: COLOR_PALETTE[colorIdx % COLOR_PALETTE.length], bot: null, score: 0, correct: 0, wins: 0, inRound: false, out: false, outRound: null, review: [] };
}

const humans = (st) => [...st.players.values()].filter((p) => !p.bot);

// --- timers: one stage timer (guarded by a token) plus per-bot timers, all cleared on change.
function arm(room, ms, fn) {
  const st = room.state;
  clearTimeout(st.timer);
  const tok = ++st.tok;
  st.timer = setTimeout(() => {
    if (st.tok !== tok) return;
    st.timer = null;
    fn();
    broadcastState(room);
  }, Math.max(0, ms));
}
function clearBots(st) { for (const t of st.botTimers) clearTimeout(t); st.botTimers = []; }
function disarm(st) { clearTimeout(st.timer); st.timer = null; st.tok++; clearBots(st); }

function laterBot(room, ms, fn) {
  const st = room.state;
  const tok = st.tok;
  st.botTimers.push(setTimeout(() => { if (st.tok === tok && st.phase === 'playing') { fn(); broadcastState(room); } }, Math.max(0, ms)));
}

// Who has to spell the current word.
function spellers(st) {
  const t = st.turn;
  if (!t) return [];
  if (st.game.format === 'bee') return st.players.has(t.spellerId) ? [st.players.get(t.spellerId)] : [];
  return [...st.players.values()].filter((p) => p.inRound && p.clientId !== t.pronouncerId);
}

function tierFor(st) {
  const g = st.game;
  if (g.level !== 'mix') return g.level;
  if (g.format === 'race') return RACE_MIX[g.index] || 'expert';
  if (g.format === 'bee') {
    const n = g.solo ? Math.floor(g.spelled / 5) : Math.floor((g.round - 1) / 2);
    return TIERS[Math.min(3, n)];
  }
  return TIERS[Math.min(3, Math.floor((g.index / g.total) * 4))];
}

function newTurn(st, fields) {
  st.turnId += 1;
  st.turn = { id: st.turnId, stage: 'spell', entry: null, tier: null, startedAt: null, endsAt: null, revealEndsAt: null, spellerId: null, pronouncerId: null, clip: null, clipSent: false, attempts: new Map(), drafts: new Map(), hinted: new Set(), ready: new Set(), suggest: null, pickEndsAt: null, aloud: false, ...fields };
  return st.turn;
}

// Opens the spelling window for the turn's word and sets the bots going.
function beginSpelling(room, lead) {
  const st = room.state;
  const t = st.turn;
  t.stage = 'spell';
  t.startedAt = Date.now() + lead;
  t.endsAt = t.startedAt + SPELL_MS[t.tier];
  arm(room, t.endsAt - Date.now(), () => closeTurn(room));
  for (const p of spellers(st)) if (p.bot) scheduleBot(room, p);
}

function startTurn(room, lead) {
  const st = room.state;
  const g = st.game;
  if (g.format === 'pronounce') {
    const order = g.pronouncers.filter((id) => st.players.has(id));
    if (order.length < 2 || g.index >= g.total) { endGame(room); return; }
    const pronouncerId = g.pronouncers[g.index % g.pronouncers.length];
    if (!st.players.has(pronouncerId)) { g.index += 1; startTurn(room, lead); return; }
    const tier = tierFor(st);
    const t = newTurn(st, { stage: 'pick', pronouncerId, tier, suggest: draw(st, tier), pickEndsAt: Date.now() + PICK_MS });
    arm(room, PICK_MS, () => pronounce(room, t, { aloud: false }));
    return;
  }
  const tier = tierFor(st);
  newTurn(st, { tier, entry: draw(st, tier), spellerId: g.format === 'bee' ? g.order[g.pos] : null });
  beginSpelling(room, lead);
}

// The pronouncer sends the word: the suggestion (optionally with their recording) or their own
// dictionary word, which needs a recording or a promise they said it aloud.
function pronounce(room, t, data) {
  const st = room.state;
  if (st.turn !== t || t.stage !== 'pick') return { error: 'closed' };
  let clip = null;
  if (data.clip) {
    const c = data.clip;
    const mime = typeof c.mime === 'string' ? c.mime.slice(0, 80) : '';
    if (!CLIP_TYPES.has(mime.split(';')[0].trim()) || typeof c.data !== 'string' || c.data.length > MAX_CLIP_CHARS || !/^[A-Za-z0-9+/=]+$/.test(c.data)) return { error: 'That recording could not be used.' };
    clip = { mime, data: c.data };
  }
  const custom = norm(data.word);
  if (custom) {
    if (custom.length < 2 || !isWord(custom)) return { error: 'That word is not in the dictionary.' };
    if (!clip && !data.aloud) return { error: 'Record the word, or say it out loud and tick the box.' };
    const clue = typeof data.clue === 'string' ? data.clue.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
    if (clue && norm(clue).includes(custom)) return { error: 'The clue gives the word away.' };
    t.entry = { w: custom, custom: true, clue: clue || null, aloud: !!data.aloud };
    t.tier = tierByLength(custom);
  } else {
    t.entry = t.suggest;
  }
  t.clip = clip;
  t.aloud = !!data.aloud;
  beginSpelling(room, LEAD_MS);
  return { ok: true };
}

function judgeAttempt(st, p, raw, now = Date.now()) {
  const t = st.turn;
  const attempt = norm(raw);
  const correct = accepts(t.entry, attempt);
  const points = correct ? pointsFor(t.tier, t.hinted.has(p.clientId), (t.endsAt - now) / SPELL_MS[t.tier]) : 0;
  t.attempts.set(p.clientId, { attempt, correct, points });
  if (correct) { p.score += points; p.correct += 1; }
  p.review.push({ word: t.entry.w, attempt, correct, points, tier: t.tier });
  return { attempt, correct, points };
}

function canSpell(st, p) {
  const t = st.turn;
  const now = Date.now();
  return st.phase === 'playing' && t && t.stage === 'spell' && now >= t.startedAt && now < t.endsAt && !t.attempts.has(p.clientId) && spellers(st).includes(p);
}

// Time's up (or everyone has answered): judge leftover drafts and show the answer.
function closeTurn(room) {
  const st = room.state;
  const t = st.turn;
  if (!t || t.stage !== 'spell') return;
  clearBots(st);
  for (const p of spellers(st)) if (!t.attempts.has(p.clientId)) judgeAttempt(st, p, t.drafts.get(p.clientId) || '', t.endsAt);
  if (st.game.format === 'bee') {
    const att = t.attempts.get(t.spellerId);
    st.game.spelled += att && att.correct ? 1 : 0;
    if (att && !att.correct) st.game.misses.add(t.spellerId);
  }
  t.stage = 'reveal';
  const ms = st.game.format === 'bee' ? BEE_REVEAL_MS : REVEAL_MS;
  t.revealEndsAt = Date.now() + ms;
  arm(room, ms, () => advance(room));
}

function maybeClose(room) {
  const st = room.state;
  const t = st.turn;
  if (t && t.stage === 'spell' && spellers(st).every((p) => t.attempts.has(p.clientId))) {
    closeTurn(room);
    return true;
  }
  return false;
}

function advance(room) {
  const st = room.state;
  const g = st.game;
  if (st.phase !== 'playing') return;
  if (g.format !== 'bee') {
    g.index += 1;
    if (g.index >= g.total) endGame(room);
    else startTurn(room, LEAD_MS);
    return;
  }
  if (g.solo) {
    if (g.misses.size || !st.players.has(g.order[0])) endGame(room);
    else startTurn(room, LEAD_MS);
    return;
  }
  g.pos += 1;
  while (g.pos < g.order.length && !st.players.has(g.order[g.pos])) g.pos += 1;
  if (g.pos < g.order.length) { startTurn(room, LEAD_MS); return; }
  // End of a round: misses go out, unless nobody got theirs right.
  const present = g.order.filter((id) => st.players.has(id));
  const missed = present.filter((id) => g.misses.has(id));
  g.notice = null;
  if (missed.length && missed.length === present.length) g.notice = 'allMissed';
  else for (const id of missed) { const p = st.players.get(id); p.out = true; p.outRound = g.round; }
  const left = present.filter((id) => !st.players.get(id).out);
  if (left.length <= 1 || g.round >= MAX_BEE_ROUNDS) { endGame(room); return; }
  g.round += 1;
  g.order = left;
  g.pos = 0;
  g.misses = new Set();
  startTurn(room, LEAD_MS);
}

function endGame(room) {
  const st = room.state;
  const g = st.game;
  if (st.phase !== 'playing') return;
  disarm(st);
  st.phase = 'results';
  st.endedAt = Date.now();
  if (st.turn && st.turn.stage !== 'reveal') st.turn = null;
  const players = [...st.players.values()].filter((p) => p.inRound);
  if (!players.length) return;
  // rank: higher is better. Bee: survivors beat anyone out, later exits beat earlier ones.
  const rankOf = g.format === 'bee' ? (p) => (g.solo ? p.correct : p.out ? p.outRound : MAX_BEE_ROUNDS + 1) : (p) => p.score;
  const entries = players.map((p) => ({ id: p.clientId, rank: rankOf(p), level: p.bot, score: g.format === 'race' ? p.score : undefined }));
  if (players.some((p) => !p.bot)) reportRanked(room, entries);
  const top = Math.max(...entries.map((e) => e.rank));
  if (players.length > 1 && top > 0) for (const p of players) if (rankOf(p) === top) p.wins += 1;
}

function startGame(room) {
  const st = room.state;
  const s = st.settings;
  disarm(st);
  st.rand = room.daily ? mulberry32(room.daily.seed) : Math.random;
  st.decks = {};
  st.phase = 'playing';
  st.endedAt = null;
  st.gameId += 1;
  for (const p of st.players.values()) Object.assign(p, { score: 0, correct: 0, inRound: true, out: false, outRound: null, review: [] });
  const ids = [...st.players.keys()];
  st.game = { format: s.format, level: s.level, clues: s.clues, index: 0, total: RACE_WORDS, round: 1, pos: 0, order: ids, solo: ids.length === 1, spelled: 0, misses: new Set(), notice: null, pronouncers: [] };
  if (s.format === 'pronounce') {
    const hs = humans(st).map((p) => p.clientId);
    st.game.pronouncers = hs;
    st.game.total = hs.length * Math.max(1, Math.ceil(6 / hs.length));
    startTurn(room, 0);
  } else {
    startTurn(room, COUNTDOWN_MS);
  }
}

// --- bots
function scheduleBot(room, p) {
  const st = room.state;
  const t = st.turn;
  const speed = BOT_SPEED[p.bot] || BOT_SPEED.hard;
  const right = Math.random() < ((BOT_ACCURACY[p.bot] || BOT_ACCURACY.hard)[t.tier] || 0.5);
  const word = right ? t.entry.w : misspell(t.entry.w, t.entry.a || []);
  const think = speed.think * (0.6 + Math.random() * 0.8) + t.entry.w.length * 120;
  const start = Math.max(0, t.startedAt - Date.now()) + think;
  const typeMs = word.length * speed.key;
  const done = Math.min(start + typeMs, t.endsAt - Date.now() - 400);
  if (st.game.format === 'bee') {
    // Type it out letter by letter so the room can watch.
    for (let i = 1; i <= word.length; i++) {
      laterBot(room, Math.min(start + i * speed.key, done - 50), () => { if (t.stage === 'spell') t.drafts.set(p.clientId, word.slice(0, i)); });
    }
  }
  laterBot(room, done, () => {
    if (st.turn !== t || !canSpell(st, p)) return;
    judgeAttempt(st, p, word);
    maybeClose(room);
  });
}

// --- views
function clueFor(st, t) {
  const e = t.entry;
  if (!e) return null;
  if (e.custom) return { custom: true, len: e.w.length, text: e.clue, aloud: e.aloud };
  const c = { pos: e.p, def: e.d, sentence: blank(e.s, e.w) };
  if (st.game.format === 'pronounce') {
    c.len = e.w.length;
    if (!t.clip && !t.aloud) c.audio = AUDIO[e.w] || null; // nobody said it: fall back to the computer voice
  } else if (st.game.clues === 'spoken') c.audio = AUDIO[e.w] || null;
  else { c.len = e.w.length; c.resp = e.r || null; }
  return c;
}

function turnView(st, forId, withClip) {
  const t = st.turn;
  if (!t) return null;
  const e = t.entry;
  const reveal = t.stage === 'reveal';
  const isPron = forId && forId === t.pronouncerId;
  const v = {
    id: t.id, stage: t.stage, tier: t.tier, startedAt: t.startedAt, endsAt: t.endsAt, revealEndsAt: t.revealEndsAt,
    spellMs: SPELL_MS[t.tier], spellerId: t.spellerId, pronouncerId: t.pronouncerId, pickEndsAt: t.pickEndsAt,
    clue: t.stage === 'pick' ? null : clueFor(st, t),
    hasClip: !!t.clip,
    clip: withClip && t.clip ? t.clip : undefined,
    answer: reveal || (isPron && e) ? e.w : null,
    alts: reveal && e && e.a ? e.a : undefined,
    answerResp: reveal && e && e.r ? e.r : undefined,
    answerAudio: reveal && e && AUDIO[e.w] ? AUDIO[e.w].w : undefined,
    hint: e && t.hinted.has(forId) && !reveal ? { first: e.w[0], len: e.w.length } : null,
    live: st.game.format === 'bee' && t.stage === 'spell' ? t.drafts.get(t.spellerId) || '' : undefined,
    mine: t.attempts.get(forId) || null,
    attempts: reveal ? Object.fromEntries(t.attempts) : undefined,
    ready: [...t.ready],
  };
  if (isPron && t.stage === 'pick') {
    const s = t.suggest;
    v.suggest = { word: s.w, tier: s.tier, pos: s.p, def: s.d, sentence: s.s, resp: s.r || null, audio: AUDIO[s.w] || null };
  }
  return v;
}

function buildView(room, forId, withClip = true) {
  const st = room.state;
  const g = st.game;
  const t = st.turn;
  const me = st.players.get(forId);
  return {
    kind: 'state',
    phase: st.phase,
    gameId: st.gameId,
    serverNow: Date.now(),
    settings: st.settings,
    locked: !!(room.daily || room.ranked),
    game: g ? { format: g.format, level: g.level, clues: g.clues, index: g.index, total: g.format === 'bee' ? null : g.total, round: g.round, solo: g.solo, notice: g.notice, order: g.format === 'bee' ? g.order : undefined, pronouncers: g.format === 'pronounce' ? g.pronouncers : undefined } : null,
    turn: st.phase === 'waiting' ? null : turnView(st, forId, withClip),
    review: st.phase === 'results' && me ? me.review.map((r) => ({ ...r, audio: AUDIO[r.word] ? AUDIO[r.word].w : null })) : undefined,
    players: [...st.players.values()].map((p) => ({
      clientId: p.clientId, nickname: p.nickname, color: p.color, bot: p.bot || undefined,
      score: p.score, correct: p.correct, wins: p.wins, inRound: p.inRound, out: p.out, outRound: p.outRound,
      submitted: !!(t && t.attempts.has(p.clientId)),
    })),
  };
}

function broadcastState(room) {
  const t = room.state.turn;
  const withClip = !!(t && t.clip && !t.clipSent && t.stage === 'spell');
  for (const id of room.clients.keys()) {
    room.sendTo(id, { v: 1, type: 'game.event', payload: { gameType: TYPE, data: buildView(room, id, withClip) } });
  }
  if (withClip) t.clipSent = true;
}

function reply(ctx, data) {
  ctx.sendTo(ctx.senderId, { v: 1, type: 'game.event', payload: { gameType: TYPE, data } });
}

function lockedSettings(room) {
  return room.daily || room.ranked ? { level: 'mix', format: 'race', clues: 'spoken' } : null;
}

module.exports = {
  type: TYPE,
  stats: { rated: true, score: { label: 'Points', better: 'high', format: 'pts' } },

  createInitialState() {
    return {
      phase: 'waiting', // 'waiting' | 'playing' | 'results'
      settings: { level: 'mix', format: 'race', clues: 'spoken' },
      game: null,
      turn: null,
      turnId: 0,
      gameId: 0,
      decks: {},
      rand: Math.random,
      timer: null,
      tok: 0,
      botTimers: [],
      endedAt: null,
      nextColorIdx: 0,
      players: new Map(),
    };
  },

  serializeSnapshot(room, client) {
    const locked = lockedSettings(room);
    if (locked) room.state.settings = locked;
    return buildView(room, client ? client.clientId : null, true);
  },

  onJoin(room, client) {
    const st = room.state;
    const p = freshPlayer(client.clientId, client.nickname, st.nextColorIdx++);
    p.bot = client.bot || null;
    st.players.set(client.clientId, p);
    broadcastState(room);
  },

  onLeave(room, client) {
    const st = room.state;
    st.players.delete(client.clientId);
    dropBotsIfAlone(st.players);
    if (!humans(st).length) {
      disarm(st);
      st.phase = 'waiting';
      st.game = null;
      st.turn = null;
      return;
    }
    if (st.phase === 'playing') {
      const g = st.game;
      const t = st.turn;
      const inGame = [...st.players.values()].filter((p) => p.inRound);
      if (g.format === 'pronounce') {
        if (g.pronouncers.filter((id) => st.players.has(id)).length < 2) endGame(room);
        else if (t && t.stage === 'pick' && t.pronouncerId === client.clientId) { g.index += 1; startTurn(room, LEAD_MS); }
        else maybeClose(room);
      } else if (g.format === 'bee' && !g.solo && inGame.filter((p) => !p.out).length <= 1) {
        endGame(room);
      } else if (g.format === 'bee' && t && t.stage === 'spell' && t.spellerId === client.clientId) {
        disarm(st);
        advance(room);
      } else if (!inGame.length) {
        endGame(room);
      } else {
        maybeClose(room);
      }
    }
    broadcastState(room);
  },

  onMessage(room, client, data, ctx) {
    if (!data || typeof data.kind !== 'string') return;
    const st = room.state;
    const me = st.players.get(ctx.senderId);
    if (!me) return;
    const t = st.turn;

    switch (data.kind) {
      case 'settings': {
        if (st.phase === 'playing' || lockedSettings(room)) return;
        const s = st.settings;
        if (LEVELS.includes(data.level)) s.level = data.level;
        if (FORMATS.includes(data.format)) s.format = data.format;
        if (CLUES.includes(data.clues)) s.clues = data.clues;
        broadcastState(room);
        return;
      }
      case 'start': {
        if (st.phase === 'playing') return;
        const locked = lockedSettings(room);
        if (locked) st.settings = locked;
        if (st.settings.format === 'pronounce' && humans(st).length < 2) { reply(ctx, { kind: 'error', message: 'Pronouncer mode needs at least two people in the room.' }); return; }
        startGame(room);
        broadcastState(room);
        return;
      }
      case 'draft': {
        if (!t || t.stage !== 'spell' || !spellers(st).includes(me) || t.attempts.has(me.clientId)) return;
        const d = norm(data.text);
        if (d === (t.drafts.get(me.clientId) || '')) return;
        t.drafts.set(me.clientId, d);
        if (st.game.format === 'bee') broadcastState(room); // the room watches the speller type
        return;
      }
      case 'submit': {
        if (!canSpell(st, me)) return;
        const res = judgeAttempt(st, me, data.word);
        reply(ctx, { kind: 'judged', turnId: t.id, ...res });
        maybeClose(room);
        broadcastState(room);
        return;
      }
      case 'hint': {
        if (!t || t.stage !== 'spell' || st.game.format === 'bee' || !canSpell(st, me) || t.hinted.has(me.clientId)) return;
        t.hinted.add(me.clientId);
        reply(ctx, { kind: 'state', ...buildView(room, me.clientId, false) });
        return;
      }
      case 'reroll': {
        if (!t || t.stage !== 'pick' || t.pronouncerId !== me.clientId) return;
        t.suggest = draw(st, t.tier);
        reply(ctx, { kind: 'state', ...buildView(room, me.clientId, false) });
        return;
      }
      case 'pronounce': {
        if (!t || t.stage !== 'pick' || t.pronouncerId !== me.clientId) return;
        const res = pronounce(room, t, data);
        if (res.error) { reply(ctx, { kind: 'error', message: res.error }); return; }
        broadcastState(room);
        return;
      }
      case 'next': {
        if (!t || t.stage !== 'reveal' || me.bot) return;
        t.ready.add(me.clientId);
        const waiting = humans(st).filter((p) => p.inRound && !t.ready.has(p.clientId));
        if (!waiting.length) { disarm(st); advance(room); }
        broadcastState(room);
        return;
      }
      case 'addBot': {
        if (st.phase === 'playing') return;
        const b = newBot(st.players, data.level);
        if (!b) return;
        module.exports.onJoin(room, { clientId: b.clientId, nickname: b.nickname, bot: b.level });
        return;
      }
      case 'removeBot': {
        if (st.phase === 'playing' || !isBotId(data.clientId) || !st.players.has(data.clientId)) return;
        st.players.delete(data.clientId);
        broadcastState(room);
        return;
      }
      default:
    }
  },

  _internals: { closeTurn, misspell, pointsFor, blank, norm, accepts, tierByLength, draw, WORDS, AUDIO, SPELL_MS, BASE_POINTS, RACE_MIX, COUNTDOWN_MS, LEAD_MS, REVEAL_MS, BEE_REVEAL_MS, PICK_MS, BOT_ACCURACY, MAX_CLIP_CHARS },
};
