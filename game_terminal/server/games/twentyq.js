// 20 Questions (GamePigeon style). Two seats; each round one player is the PICKER (secretly picks
// a word — one of three suggestions from the built-in knowledge base, or their own) and the other
// is the GUESSER, who types free-text yes/no questions that the picker answers YES / NO /
// SOMETIMES / UNKNOWN. A guess can be made at any time and counts as a question; 20 questions max.
// The word's category is shown to the guesser as a hint.
//
// Scoring: solving on question n earns the guesser 21-n points (20 for a first-question guess, 1
// on the last); stumping the guesser earns the picker 10. A match is two rounds (each player picks
// once); a rematch swaps who picks first. `series` tallies matches won while both stay seated.
//
// Bots: as PICKER the bot picks a KB word and answers by keyword-matching the question onto a KB
// attribute (UNKNOWN when nothing matches). As GUESSER it asks the KB's attribute questions,
// keeping a soft posterior over the category's words; Expert asks the max-information question
// and guesses once a word is likely, Easy asks random questions and makes wild guesses.
//
// Guards: every message is validated (seat, phase, types, lengths); bad input gets `moveRejected`.
// Bot moves and the between-rounds pause are timers guarded by `st.seq`, which bumps on every
// state change, so a stale timer can never act twice or act after a reset.

'use strict';

const kb = require('./twentyq_kb');
const { setBotLevel, botLevelOf } = require('./ai/levels');

const TYPE = 'twentyq';
const BOT = 'BOT';
const SEATS = ['p1', 'p2'];
const MAX_Q = 20;
const ROUNDS = 2;
const STUMP_POINTS = 10;
const MAX_Q_LEN = 100;
const MAX_WORD_LEN = 30;
const ANSWERS = ['yes', 'no', 'sometimes', 'unknown'];
// Human-ish bot pacing and the pause between rounds (tests shrink these via _internal.timing).
const timing = { pickMin: 900, pickMax: 1600, askMin: 1200, askMax: 2300, answerMin: 700, answerMax: 1400, roundPause: 8000 };

const other = (s) => (s === 'p1' ? 'p2' : 'p1');
const randIn = (min, max) => min + Math.random() * (max - min);

// ---------------------------------------------------------------------------------------------
// Text helpers
function cleanText(s, max) {
  if (typeof s !== 'string') return null;
  // Strip control / zero-width / bidi characters, collapse whitespace.
  const t = s.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length > max ? null : t;
}

// Edit distance counting an adjacent swap as one edit ("elephnat" -> "elephant").
function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// The thing a question names, for "is it a dog?" style questions (null if not that shape).
function questionTarget(text) {
  const q = kb.normText(text);
  const m = q.match(/^(?:(?:is|was) (?:it|this|that|your word|the word|the answer)|it s|its|could it be|maybe|are you thinking of|is the answer|the answer is)\s+(?:(?:a|an|the|some)\s+)?(.+)$/);
  return m ? m[1] : null;
}

// Builds the secret from what the picker chose. `keys` are the guess spellings that count as
// correct: the word itself, plus the KB noun's name and synonyms when the word is one of those.
function makeSecret(word, category) {
  const noun = kb.findNoun(word);
  const key = kb.wordKey(word);
  const keys = new Set([key]);
  if (noun) {
    const syn = [noun.name, ...noun.aliases].map(kb.wordKey);
    if (syn.includes(key)) for (const k of syn) keys.add(k);
  }
  return {
    word,
    category: noun ? noun.category : kb.CATEGORIES.includes(category) ? category : 'any',
    nounId: noun ? noun.id : null,
    keys: [...keys],
  };
}

function guessMatches(guess, secret) {
  const g = kb.wordKey(guess);
  if (!g || !secret) return false;
  for (const k of secret.keys) {
    if (g === k) return true;
    if (k.length >= 5 && editDistance(g, k) <= 1) return true; // forgive one typo on longer words
  }
  return false;
}

const article = (w) => (/^[aeiou]/i.test(w) ? 'an' : 'a');

// ---------------------------------------------------------------------------------------------
// Bot as picker: answer a free-text question about KB noun `noun`.
function botAnswer(noun, text) {
  if (!noun) return 'unknown';
  const named = kb.namedNoun(text);
  if (named) return named.id === noun.id ? 'yes' : 'no';
  const m = kb.matchAttribute(text);
  if (!m) return 'unknown';
  const v = noun.values[m.attr];
  if (v === 'S') return 'sometimes';
  const yes = (v === 'Y') !== m.invert;
  return yes ? 'yes' : 'no';
}

// Bot as guesser. P(answer | KB value): forgiving, since humans disagree with the KB sometimes.
const LIK = {
  Y: { yes: 0.88, no: 0.04, sometimes: 0.08 },
  N: { yes: 0.04, no: 0.88, sometimes: 0.08 },
  S: { yes: 0.36, no: 0.28, sometimes: 0.36 },
};
const BOT_ANS = ['yes', 'no', 'sometimes'];

const LEVEL_CFG = {
  easy: { best: 0, informative: 0.55, attrShare: 1, guessAt: 0.85, wild: 0.3, wildFrom: 3, wildPool: 15 },
  medium: { best: 0.5, informative: 1, attrShare: 1, guessAt: 0.65, wild: 0.1, wildFrom: 5, wildPool: 5 },
  hard: { best: 0.85, informative: 1, attrShare: 0.75, guessAt: 0.55, wild: 0, wildFrom: 99, wildPool: 1 },
  expert: { best: 1, informative: 1, attrShare: 1, guessAt: 0.5, wild: 0, wildFrom: 99, wildPool: 1 },
};

function entropy(ws) {
  let tot = 0;
  for (const w of ws) tot += w;
  if (tot <= 0) return 0;
  let h = 0;
  for (const w of ws) if (w > 0) { const p = w / tot; h -= p * Math.log2(p); }
  return h;
}

// Posterior over candidate nouns given the bot's own question history.
function posterior(history, category) {
  const cands = kb.NOUNS.filter((n) => category === 'any' || !kb.CATEGORIES.includes(category) || n.category === category);
  const w = cands.map(() => 1);
  for (const h of history) {
    if (h.kind === 'q' && h.attr != null && BOT_ANS.includes(h.answer)) {
      cands.forEach((n, i) => { w[i] *= LIK[n.values[h.attr]][h.answer]; });
    } else if (h.kind === 'guess' && h.noun != null && h.answer !== 'correct') {
      cands.forEach((n, i) => { if (n.id === h.noun) w[i] = 0; });
    }
  }
  let tot = w.reduce((a, b) => a + b, 0);
  if (tot <= 0) { w.fill(1); tot = w.length; } // contradictory answers: start over rather than stall
  for (const h of history) if (h.kind === 'guess' && h.noun != null) cands.forEach((n, i) => { if (n.id === h.noun) w[i] = 0; });
  tot = w.reduce((a, b) => a + b, 0) || 1;
  return cands.map((n, i) => ({ noun: n, p: w[i] / tot })).filter((c) => c.p > 0);
}

function infoGain(post, attr) {
  const before = entropy(post.map((c) => c.p));
  let after = 0;
  for (const a of BOT_ANS) {
    const ws = post.map((c) => c.p * LIK[c.noun.values[attr]][a]);
    const pa = ws.reduce((x, y) => x + y, 0);
    if (pa > 0) after += pa * entropy(ws);
  }
  return before - after;
}

// -> { kind: 'q', attr } | { kind: 'guess', noun }
// opts: { history, category, level, used, attrMask (Set of allowed attr idx or null), rng }
function botGuesserMove({ history, category, level, used, attrMask, rng = Math.random }) {
  const cfg = LEVEL_CFG[level] || LEVEL_CFG.hard;
  const post = posterior(history, category).sort((a, b) => b.p - a.p);
  const left = MAX_Q - used;
  if (!post.length) return { kind: 'guess', noun: kb.NOUNS[Math.floor(rng() * kb.NOUNS.length)].id };
  const top = post[0];
  if (left <= 1 || top.p >= cfg.guessAt) return { kind: 'guess', noun: top.noun.id };
  if (cfg.wild && used >= cfg.wildFrom && rng() < cfg.wild) {
    const pool = post.slice(0, cfg.wildPool);
    return { kind: 'guess', noun: pool[Math.floor(rng() * pool.length)].noun.id };
  }
  const asked = new Set(history.filter((h) => h.kind === 'q' && h.attr != null).map((h) => h.attr));
  const open = kb.ATTRS.map((_, i) => i).filter((i) => !asked.has(i) && (!attrMask || attrMask.has(i)));
  const scored = open.map((i) => ({ i, g: infoGain(post, i) }));
  const useful = scored.filter((s) => s.g > 0.02);
  // Out of useful questions (or nearly out of questions): start guessing down the list.
  if (!useful.length || left <= Math.min(3, post.filter((c) => c.p > 0.05).length)) return { kind: 'guess', noun: top.noun.id };
  if (rng() < cfg.best) {
    useful.sort((a, b) => b.g - a.g);
    return { kind: 'q', attr: useful[0].i };
  }
  const pool = rng() < cfg.informative ? useful : scored;
  return { kind: 'q', attr: pool[Math.floor(rng() * pool.length)].i };
}

// Hard plays with a partial knowledge base: a random 75% of the questions, fixed per round.
function makeAttrMask(level, rng = Math.random) {
  const cfg = LEVEL_CFG[level] || LEVEL_CFG.hard;
  if (cfg.attrShare >= 1) return null;
  const set = new Set();
  kb.ATTRS.forEach((a, i) => { if (i < 5 || rng() < cfg.attrShare) set.add(i); }); // category questions always known
  return set;
}

// Three suggestions from different categories, avoiding words already used this match.
function drawSuggestions(exclude) {
  const cats = kb.CATEGORIES.slice().sort(() => Math.random() - 0.5).slice(0, 3);
  return cats.map((c) => {
    let pool = kb.NOUNS.filter((n) => n.category === c && !exclude.has(n.id));
    if (!pool.length) pool = kb.NOUNS.filter((n) => n.category === c);
    return pool[Math.floor(Math.random() * pool.length)].id;
  });
}

// ---------------------------------------------------------------------------------------------
// State
function newMatchFields(st) {
  st.round = 0;
  st.scores = { p1: 0, p2: 0 };
  st.roundLog = [];
  st.winner = null;
  st.picker = null;
  st.guesser = null;
  st.secret = null;
  st.suggestions = [];
  st.questions = [];
  st.result = null;
  st.nextAt = null;
  st.botMem = null;
}

function bump(st) { st.seq = (st.seq || 0) + 1; }

function seatOf(st, clientId) {
  if (!clientId || clientId === BOT) return null;
  return st.players.p1 === clientId ? 'p1' : st.players.p2 === clientId ? 'p2' : null;
}

function usedNounIds(st) {
  return new Set(st.roundLog.map((r) => r.nounId).filter((x) => x != null));
}

function startRound(st) {
  st.round += 1;
  st.picker = st.round % 2 === 1 ? st.firstPicker : other(st.firstPicker);
  st.guesser = other(st.picker);
  st.secret = null;
  st.questions = [];
  st.result = null;
  st.nextAt = null;
  st.suggestions = drawSuggestions(usedNounIds(st));
  st.botMem = null;
  st.phase = 'picking';
  bump(st);
}

function startMatch(st) {
  newMatchFields(st);
  st.gameId = (st.gameId || 0) + 1;
  startRound(st);
}

function toWaiting(st) {
  st.phase = 'waiting';
  newMatchFields(st);
  bump(st);
}

function endRound(st, solved) {
  const n = st.questions.length;
  const winnerSeat = solved ? st.guesser : st.picker;
  const points = solved ? Math.max(1, MAX_Q + 1 - n) : STUMP_POINTS;
  st.scores[winnerSeat] += points;
  st.result = {
    round: st.round, solved, winner: winnerSeat, points, questions: n,
    word: st.secret.word, category: st.secret.category, picker: st.picker, guesser: st.guesser, nounId: st.secret.nounId,
  };
  st.roundLog.push(st.result);
  if (st.round >= ROUNDS) {
    st.phase = 'game_over';
    st.nextAt = null;
    const { p1, p2 } = st.scores;
    st.winner = p1 > p2 ? 'p1' : p2 > p1 ? 'p2' : 'draw';
    if (st.winner !== 'draw') st.series[st.winner] += 1;
  } else {
    st.phase = 'round_over';
    st.nextAt = Date.now() + timing.roundPause;
  }
  bump(st);
}

function pickSecret(st, word, category) {
  st.secret = makeSecret(word, category);
  st.suggestions = [];
  st.phase = 'asking';
  bump(st);
}

// Guesser asks (kind 'q') or guesses (kind 'guess'). `meta` carries the bot's attr / noun ids.
function pushQuestion(st, kind, text, meta = {}) {
  const entry = { n: st.questions.length + 1, kind, text, answer: null, auto: false, ...meta };
  st.questions.push(entry);
  const target = kind === 'guess' ? text : questionTarget(text);
  if (target && guessMatches(target, st.secret)) {
    entry.answer = 'correct';
    entry.auto = true;
    endRound(st, true);
    return;
  }
  st.phase = 'answering';
  bump(st);
}

function applyAnswer(st, value) {
  const entry = st.questions[st.questions.length - 1];
  const solved = value === 'correct' || (entry.kind === 'guess' && value === 'yes');
  entry.answer = solved ? 'correct' : value;
  if (solved) return endRound(st, true);
  if (st.questions.length >= MAX_Q) return endRound(st, false);
  st.phase = 'asking';
  bump(st);
}

// ---------------------------------------------------------------------------------------------
// Views
function viewFor(room, clientId) {
  const st = room.state;
  const seat = seatOf(st, clientId);
  const isPicker = seat && seat === st.picker;
  const reveal = st.phase === 'round_over' || st.phase === 'game_over';
  const secret = st.secret;
  return {
    phase: st.phase,
    players: st.players,
    botLevels: st.botLevels || {},
    round: st.round,
    rounds: ROUNDS,
    maxQ: MAX_Q,
    picker: st.picker,
    guesser: st.guesser,
    firstPicker: st.firstPicker,
    category: secret ? secret.category : null,
    secretWord: secret && (isPicker || reveal) ? secret.word : null,
    inKb: secret && isPicker ? secret.nounId != null : null,
    suggestions: isPicker && st.phase === 'picking'
      ? st.suggestions.map((id) => ({ word: kb.NOUNS[id].name, category: kb.NOUNS[id].category })) : [],
    questions: st.questions.map((q) => ({ n: q.n, kind: q.kind, text: q.text, answer: q.answer, auto: q.auto })),
    scores: st.scores,
    series: st.series,
    result: st.result ? { ...st.result, nounId: undefined } : null,
    roundLog: st.roundLog.map((r) => ({ round: r.round, solved: r.solved, winner: r.winner, points: r.points, questions: r.questions, word: r.word, category: r.category, picker: r.picker })),
    winner: st.winner,
    nextInMs: st.phase === 'round_over' && st.nextAt ? Math.max(0, st.nextAt - Date.now()) : null,
    seq: st.seq,
  };
}

function broadcastState(room) {
  for (const clientId of room.clients.keys()) {
    room.sendTo(clientId, { v: 1, type: 'game.event', payload: { gameType: TYPE, data: { kind: 'state', ...viewFor(room, clientId) } } });
  }
}

// Broadcast, then (re)arm whatever timer the new state needs.
function changed(room) {
  broadcastState(room);
  scheduleTimers(room);
}

function scheduleTimers(room) {
  const st = room.state;
  const seq = st.seq;
  const live = () => room.state === st && st.seq === seq;

  if (st.phase === 'round_over') {
    if (st._roundTimerSeq === seq) return;
    st._roundTimerSeq = seq;
    setTimeout(() => {
      if (!live() || st.phase !== 'round_over') return;
      startRound(st);
      changed(room);
    }, Math.max(0, st.nextAt - Date.now()));
    return;
  }

  let seat = null;
  let delay = 0;
  if (st.phase === 'picking') { seat = st.picker; delay = randIn(timing.pickMin, timing.pickMax); }
  else if (st.phase === 'asking') { seat = st.guesser; delay = randIn(timing.askMin, timing.askMax); }
  else if (st.phase === 'answering') { seat = st.picker; delay = randIn(timing.answerMin, timing.answerMax); }
  if (!seat || st.players[seat] !== BOT || st._botTimerSeq === seq) return;
  st._botTimerSeq = seq;
  setTimeout(() => {
    if (!live() || st.players[seat] !== BOT) return;
    try {
      botAct(st, seat);
    } catch (err) {
      // Never stall: fall back to the simplest legal action for this phase.
      if (!live()) return;
      if (st.phase === 'picking') pickSecret(st, kb.NOUNS[st.suggestions[0] || 0].name, null);
      else if (st.phase === 'asking') pushQuestion(st, 'q', kb.ATTRS[0].q, { attr: 0 });
      else if (st.phase === 'answering') applyAnswer(st, 'unknown');
    }
    changed(room);
  }, delay);
}

function botAct(st, seat) {
  const level = botLevelOf(st, seat);
  if (st.phase === 'picking') {
    const exclude = usedNounIds(st);
    const pool = kb.NOUNS.filter((n) => !exclude.has(n.id));
    const noun = pool[Math.floor(Math.random() * pool.length)];
    pickSecret(st, noun.name, noun.category);
  } else if (st.phase === 'asking') {
    if (!st.botMem) st.botMem = { attrMask: makeAttrMask(level) };
    const mv = botGuesserMove({ history: st.questions, category: st.secret.category, level, used: st.questions.length, attrMask: st.botMem.attrMask });
    if (mv.kind === 'guess') {
      const name = kb.NOUNS[mv.noun].name;
      pushQuestion(st, 'guess', name, { noun: mv.noun });
    } else {
      pushQuestion(st, 'q', kb.ATTRS[mv.attr].q, { attr: mv.attr });
    }
  } else if (st.phase === 'answering') {
    const entry = st.questions[st.questions.length - 1];
    const noun = st.secret.nounId != null ? kb.NOUNS[st.secret.nounId] : null;
    if (entry.kind === 'guess') return applyAnswer(st, 'no'); // a match would have auto-solved
    if (entry.attr != null && noun) return applyAnswer(st, kb.ANSWER[noun.values[entry.attr]]);
    applyAnswer(st, botAnswer(noun, entry.text));
  }
}

// ---------------------------------------------------------------------------------------------
function startIfReady(st) {
  if (st.phase === 'waiting' && st.players.p1 && st.players.p2) startMatch(st);
}

function vacate(st, seat) {
  st.players[seat] = null;
  if (st.botLevels) delete st.botLevels[seat];
  st.series = { p1: 0, p2: 0 };
  toWaiting(st);
}

module.exports = {
  type: TYPE,

  createInitialState() {
    const st = { phase: 'waiting', players: { p1: null, p2: null }, botLevels: {}, firstPicker: 'p1', series: { p1: 0, p2: 0 }, seq: 0, gameId: 0 };
    newMatchFields(st);
    return st;
  },

  isRoomFull(room) {
    return !!(room.state.players.p1 && room.state.players.p2);
  },

  serializeSnapshot(room, client) {
    return viewFor(room, client ? client.clientId : null);
  },

  onLeave(room, client) {
    const st = room.state;
    const seat = seatOf(st, client.clientId);
    if (!seat) return;
    vacate(st, seat);
    changed(room);
  },

  onMessage(room, client, data, ctx) {
    if (!data || typeof data !== 'object' || typeof data.kind !== 'string') return;
    const st = room.state;
    const sender = ctx && ctx.senderId != null ? ctx.senderId : client && client.clientId;
    const reject = (reason) => room.sendTo(sender, { v: 1, type: 'game.event', payload: { gameType: TYPE, data: { kind: 'moveRejected', reason } } });
    const seatArg = SEATS.includes(data.seat) ? data.seat : null;
    const mySeat = seatOf(st, sender);

    switch (data.kind) {
      case 'sit': {
        if (!seatArg || st.players[seatArg]) return;
        if (data.bot === true) {
          st.players[seatArg] = BOT;
          setBotLevel(st, seatArg, data.level);
        } else {
          if (!sender || sender === BOT || mySeat) return;
          st.players[seatArg] = sender;
        }
        bump(st);
        startIfReady(st);
        return changed(room);
      }
      case 'leaveSeat': {
        if (!mySeat) return;
        vacate(st, mySeat);
        return changed(room);
      }
      case 'setBotLevel': {
        if (!seatArg || st.players[seatArg] !== BOT) return;
        setBotLevel(st, seatArg, data.level);
        if (st.botMem) st.botMem = null;
        broadcastState(room);
        return;
      }
      case 'removeBot': {
        if (!seatArg || st.players[seatArg] !== BOT) return;
        vacate(st, seatArg);
        return changed(room);
      }
      case 'resetGame': {
        if (st.phase !== 'game_over' || !mySeat) return;
        st.firstPicker = other(st.firstPicker);
        startMatch(st);
        return changed(room);
      }
      case 'nextRound': {
        if (st.phase !== 'round_over' || !mySeat) return;
        startRound(st);
        return changed(room);
      }
      case 'reroll': {
        if (st.phase !== 'picking') return reject('not_playing');
        if (mySeat !== st.picker) return reject('not_your_turn');
        st.suggestions = drawSuggestions(new Set([...usedNounIds(st), ...st.suggestions]));
        bump(st);
        return changed(room);
      }
      case 'pick': {
        if (st.phase !== 'picking') return reject('not_playing');
        if (mySeat !== st.picker) return reject('not_your_turn');
        if (data.index != null) {
          const i = data.index;
          if (!Number.isInteger(i) || i < 0 || i >= st.suggestions.length) return reject('invalid');
          const noun = kb.NOUNS[st.suggestions[i]];
          pickSecret(st, noun.name, noun.category);
          return changed(room);
        }
        const word = cleanText(data.word, MAX_WORD_LEN);
        if (word == null) return reject('too_long');
        if (!word || !/[a-z]/i.test(word) || !/^[\p{L}\p{N}' .-]+$/u.test(word) || kb.wordKey(word).length < 2) return reject('bad_word');
        pickSecret(st, word, typeof data.category === 'string' ? data.category : null);
        return changed(room);
      }
      case 'ask':
      case 'guess': {
        if (st.phase !== 'asking') return reject(st.phase === 'answering' ? 'wait_answer' : 'not_playing');
        if (mySeat !== st.guesser) return reject('not_your_turn');
        const text = cleanText(data.text, data.kind === 'guess' ? MAX_WORD_LEN : MAX_Q_LEN);
        if (text == null) return reject('too_long');
        if (!text || !/[\p{L}\p{N}]/u.test(text)) return reject('empty');
        pushQuestion(st, data.kind === 'guess' ? 'guess' : 'q', text);
        return changed(room);
      }
      case 'answer': {
        if (st.phase !== 'answering') return reject('not_playing');
        if (mySeat !== st.picker) return reject('not_your_turn');
        const entry = st.questions[st.questions.length - 1];
        const value = data.value;
        const ok = entry.kind === 'guess' ? ['yes', 'no', 'correct'].includes(value) : [...ANSWERS, 'correct'].includes(value);
        if (!ok) return reject('bad_answer');
        applyAnswer(st, value);
        return changed(room);
      }
      default:
    }
  },

  _internal: {
    timing, kb, MAX_Q, ROUNDS, STUMP_POINTS, LEVEL_CFG,
    botAnswer, botGuesserMove, makeAttrMask, posterior, infoGain, guessMatches, makeSecret, questionTarget, cleanText, viewFor,
  },
};
