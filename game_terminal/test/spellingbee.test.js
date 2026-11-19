// node test/spellingbee.test.js — Spelling Bee: word data, audio manifest, scoring, and the
// race / bee / pronouncer flows (server/games/spellingbee.js). Never leaks the word early.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sb = require('../server/games/spellingbee');

const { misspell, pointsFor, blank, closeTurn, WORDS, AUDIO, MAX_CLIP_CHARS } = sb._internals;
const AUDIO_DIR = path.join(__dirname, '../public/games/spellingbee/audio');

function makeRoom(extra = {}) {
  const room = { state: sb.createInitialState(), clients: new Map(), sent: [], ...extra };
  room.sendTo = (id, env) => room.sent.push({ id, env });
  return room;
}
function join(room, id) { room.clients.set(id, {}); sb.onJoin(room, { clientId: id, nickname: id }); }
const act = (room, id, data) => sb.onMessage(room, {}, data, { senderId: id, sendTo: room.sendTo });
const viewOf = (room, id) => sb.serializeSnapshot(room, { clientId: id });
const lastTo = (room, id) => { for (let i = room.sent.length - 1; i >= 0; i--) if (room.sent[i].id === id) return room.sent[i].env.payload.data; return null; };
const openNow = (room) => { room.state.turn.startedAt = Date.now() - 1; }; // skip the countdown
const cleanup = (room) => { clearTimeout(room.state.timer); for (const t of room.state.botTimers) clearTimeout(t); };

// --- word data and audio
const all = Object.entries(WORDS).flatMap(([tier, list]) => list.map((e) => ({ ...e, tier })));
assert.deepStrictEqual(Object.keys(WORDS), ['easy', 'medium', 'hard', 'expert']);
for (const list of Object.values(WORDS)) assert.ok(list.length >= 60, 'each tier has enough words for many games');
assert.strictEqual(new Set(all.map((e) => e.w)).size, all.length, 'no word twice');
for (const e of all) {
  assert.ok(/^[a-z]+$/.test(e.w), e.w);
  assert.ok(e.p && e.d && e.s && e.r, `${e.w} has pos, definition, sentence and respelling`);
  assert.ok(blank(e.s, e.w).includes('_____'), `${e.w}: sentence uses the word`);
  assert.ok(!blank(e.s, e.w).toLowerCase().includes(e.w), `${e.w}: blanked sentence still shows it`);
  assert.ok(!e.d.toLowerCase().split(/[^a-z]+/).includes(e.w), `${e.w}: definition gives it away`);
  const ids = AUDIO[e.w];
  assert.ok(ids && /^[0-9a-f]{16}$/.test(ids.w) && /^[0-9a-f]{16}$/.test(ids.s), `${e.w} has audio ids`);
  for (const id of [ids.w, ids.s]) assert.ok(fs.statSync(path.join(AUDIO_DIR, `${id}.mp3`)).size > 1000, `${e.w}: ${id}.mp3`);
}
assert.strictEqual(Object.keys(AUDIO).length, all.length, 'no stale manifest entries');
assert.strictEqual(fs.readdirSync(AUDIO_DIR).length, all.length * 2, 'no orphan clips');

// --- scoring and bot misspellings
assert.strictEqual(pointsFor('easy', false, 0), 100);
assert.strictEqual(pointsFor('easy', false, 1), 150);
assert.strictEqual(pointsFor('expert', true, 1), 300);
assert.strictEqual(pointsFor('hard', false, 2), 450, 'speed bonus is capped');
for (const e of all) {
  const m = misspell(e.w, e.a || []);
  assert.ok(m !== e.w && !(e.a || []).includes(m) && /^[a-z]+$/.test(m), `${e.w} -> ${m}`);
}

// --- race: one try each, hint halves, nothing leaks before the reveal
{
  const room = makeRoom();
  join(room, 'a'); join(room, 'b');
  act(room, 'a', { kind: 'settings', level: 'hard', clues: 'written' });
  act(room, 'a', { kind: 'start' });
  const st = room.state;
  assert.strictEqual(st.phase, 'playing');
  const word = st.turn.entry.w;
  for (const id of ['a', 'b']) {
    const v = viewOf(room, id);
    assert.ok(!JSON.stringify(v).toLowerCase().includes(word), 'word hidden from spellers');
    assert.strictEqual(v.turn.clue.len, word.length);
    assert.ok(v.turn.clue.resp && !v.turn.clue.audio, 'written clues: respelling, no audio');
  }
  act(room, 'a', { kind: 'submit', word }); // still counting down: ignored
  assert.ok(!st.turn.attempts.has('a'));
  openNow(room);
  act(room, 'b', { kind: 'hint' });
  assert.deepStrictEqual(lastTo(room, 'b').turn.hint, { first: word[0], len: word.length });
  act(room, 'a', { kind: 'submit', word: word.toUpperCase() });
  const j = room.sent.find((m) => m.id === 'a' && m.env.payload.data.kind === 'judged').env.payload.data;
  assert.deepStrictEqual([j.turnId, j.attempt, j.correct], [room.state.turn.id, word, true]);
  assert.ok(st.turn.attempts.get('a').correct && st.turn.attempts.get('a').points >= 300);
  act(room, 'a', { kind: 'submit', word: 'again' }); // one try only
  assert.strictEqual(st.players.get('a').review.length, 1);
  assert.strictEqual(st.turn.stage, 'spell');
  act(room, 'b', { kind: 'draft', text: 'xyz' });
  act(room, 'b', { kind: 'submit', word });
  assert.ok(st.turn.attempts.get('b').points === 230, 'hinted word scores half (225, rounded)');
  assert.strictEqual(st.turn.stage, 'reveal', 'everyone answered: reveal');
  const rv = viewOf(room, 'b');
  assert.strictEqual(rv.turn.answer, word);
  assert.ok(rv.turn.answerResp && rv.turn.answerAudio === AUDIO[word].w);
  act(room, 'a', { kind: 'next' });
  assert.strictEqual(st.turn.stage, 'reveal', 'waits for every human');
  act(room, 'b', { kind: 'next' });
  assert.strictEqual(st.game.index, 1);
  assert.strictEqual(st.turn.stage, 'spell');
  // play out the rest: a spells everything right, b misses
  while (st.phase === 'playing') {
    openNow(room);
    act(room, 'a', { kind: 'submit', word: st.turn.entry.w });
    act(room, 'b', { kind: 'submit', word: 'wrong' });
    act(room, 'a', { kind: 'next' }); act(room, 'b', { kind: 'next' });
  }
  assert.strictEqual(st.phase, 'results');
  const res = viewOf(room, 'a');
  assert.strictEqual(res.review.length, 10);
  assert.ok(res.review.every((r) => r.correct && r.audio === AUDIO[r.word].w));
  assert.strictEqual(st.players.get('a').wins, 1);
  assert.strictEqual(st.players.get('b').wins, 0);
  cleanup(room);
}

// --- spoken clues: random ids only, and the buzzer judges whatever was typed
{
  const room = makeRoom();
  join(room, 'a');
  act(room, 'a', { kind: 'start' });
  const st = room.state;
  const word = st.turn.entry.w;
  const v = viewOf(room, 'a');
  assert.deepStrictEqual(v.turn.clue.audio, AUDIO[word]);
  assert.ok(!v.turn.clue.resp && !JSON.stringify(v).toLowerCase().includes(`"${word}"`));
  openNow(room);
  act(room, 'a', { kind: 'draft', text: word });
  closeTurn(room); // the buzzer
  assert.strictEqual(st.turn.stage, 'reveal');
  assert.ok(st.turn.attempts.get('a').correct, 'typed-but-not-submitted word still counts');
  assert.strictEqual(st.turn.attempts.get('a').points, 100 * { easy: 1, medium: 2, hard: 3, expert: 4 }[st.turn.tier], 'no speed bonus at the buzzer');
  cleanup(room);
}

// --- bee: turns, elimination at round end, everyone-missed keeps everyone in
{
  const room = makeRoom();
  join(room, 'a'); join(room, 'b'); join(room, 'c');
  act(room, 'a', { kind: 'settings', format: 'bee', level: 'easy' });
  act(room, 'a', { kind: 'start' });
  const st = room.state;
  const g = st.game;
  const spellerTurn = (ok) => {
    const t = st.turn;
    openNow(room);
    for (const id of ['a', 'b', 'c']) if (id !== t.spellerId) act(room, id, { kind: 'submit', word: t.entry.w }); // not their turn
    act(room, t.spellerId, { kind: 'submit', word: ok ? t.entry.w : 'qq' });
    assert.strictEqual(t.attempts.size, 1, 'only the speller answers');
    assert.strictEqual(t.stage, 'reveal');
    for (const id of ['a', 'b', 'c']) if (st.players.has(id)) act(room, id, { kind: 'next' });
  };
  // live draft is shown to the room, the word is not
  openNow(room);
  const sp = st.turn.spellerId;
  act(room, sp, { kind: 'draft', text: 'ab' });
  const other = ['a', 'b', 'c'].find((id) => id !== sp);
  assert.strictEqual(viewOf(room, other).turn.live, 'ab');
  act(room, other, { kind: 'hint' }); // no hints in a bee
  assert.ok(!st.turn.hinted.size);
  // round 1: everyone misses -> all stay
  spellerTurn(false); spellerTurn(false); spellerTurn(false);
  assert.strictEqual(g.round, 2);
  assert.strictEqual(g.notice, 'allMissed');
  assert.ok([...st.players.values()].every((p) => !p.out));
  // round 2: first speller misses, others spell right -> first is out
  const first = g.order[0];
  spellerTurn(false); spellerTurn(true); spellerTurn(true);
  assert.strictEqual(g.round, 3);
  assert.ok(st.players.get(first).out && st.players.get(first).outRound === 2);
  assert.strictEqual(g.order.length, 2);
  // round 3: second misses -> last one standing wins
  const [x] = g.order;
  spellerTurn(false); spellerTurn(true);
  assert.strictEqual(st.phase, 'results');
  const winner = [...st.players.values()].find((p) => !p.out);
  assert.notStrictEqual(winner.clientId, x);
  assert.strictEqual(winner.wins, 1);
  cleanup(room);
}

// --- solo bee is survival: one miss ends it
{
  const room = makeRoom();
  join(room, 'a');
  act(room, 'a', { kind: 'settings', format: 'bee' });
  act(room, 'a', { kind: 'start' });
  const st = room.state;
  for (let i = 0; i < 3; i++) { openNow(room); act(room, 'a', { kind: 'submit', word: st.turn.entry.w }); act(room, 'a', { kind: 'next' }); }
  assert.strictEqual(st.phase, 'playing');
  openNow(room); act(room, 'a', { kind: 'submit', word: 'zz' }); act(room, 'a', { kind: 'next' });
  assert.strictEqual(st.phase, 'results');
  assert.strictEqual(st.players.get('a').correct, 3);
  cleanup(room);
}

// --- pronouncer: needs two people, validates words and clips, computer voice fallback
{
  const room = makeRoom();
  join(room, 'a');
  act(room, 'a', { kind: 'settings', format: 'pronounce' });
  act(room, 'a', { kind: 'start' });
  assert.strictEqual(room.state.phase, 'waiting');
  assert.strictEqual(lastTo(room, 'a').kind, 'error');
  room.sent.length = 0;
  join(room, 'b');
  assert.strictEqual(lastTo(room, 'a').players.length, 2, 'everyone hears about a new player');
  act(room, 'a', { kind: 'start' });
  const st = room.state;
  const t = st.turn;
  assert.strictEqual(t.stage, 'pick');
  const p = t.pronouncerId;
  const s = p === 'a' ? 'b' : 'a';
  const pv = viewOf(room, p);
  assert.ok(pv.turn.suggest && pv.turn.suggest.word === t.suggest.w);
  assert.ok(!viewOf(room, s).turn.suggest, 'speller never sees the suggestion');
  assert.ok(!JSON.stringify(viewOf(room, s)).includes(`"${t.suggest.w}"`));
  act(room, s, { kind: 'pronounce', aloud: true }); // not their turn
  assert.strictEqual(t.stage, 'pick');
  act(room, p, { kind: 'reroll' });
  act(room, p, { kind: 'pronounce', word: 'qzxv', aloud: true });
  assert.match(lastTo(room, p).message, /dictionary/);
  act(room, p, { kind: 'pronounce', word: 'garden' });
  assert.match(lastTo(room, p).message, /Record/);
  act(room, p, { kind: 'pronounce', word: 'garden', clue: 'where a GARDEN grows', aloud: true });
  assert.match(lastTo(room, p).message, /gives the word away/);
  act(room, p, { kind: 'pronounce', aloud: false, clip: { mime: 'text/html', data: 'AAAA' } });
  assert.match(lastTo(room, p).message, /recording/);
  act(room, p, { kind: 'pronounce', clip: { mime: 'audio/webm', data: 'A'.repeat(MAX_CLIP_CHARS + 4) } });
  assert.match(lastTo(room, p).message, /recording/);
  assert.strictEqual(t.stage, 'pick');
  // the suggested word, not recorded or said: spellers get the computer voice
  act(room, p, { kind: 'pronounce', aloud: false });
  assert.strictEqual(t.stage, 'spell');
  const sv = viewOf(room, s);
  assert.deepStrictEqual(sv.turn.clue.audio, AUDIO[t.entry.w]);
  assert.ok(!JSON.stringify(sv).includes(`"${t.entry.w}"`));
  assert.strictEqual(viewOf(room, p).turn.answer, t.entry.w, 'the pronouncer sees their own word');
  openNow(room);
  act(room, p, { kind: 'submit', word: t.entry.w });
  assert.ok(!t.attempts.has(p), 'the pronouncer does not spell');
  act(room, s, { kind: 'submit', word: t.entry.w });
  assert.strictEqual(t.stage, 'reveal');
  act(room, 'a', { kind: 'next' }); act(room, 'b', { kind: 'next' });
  // next turn: the other player pronounces their own word with a recording
  const t2 = st.turn;
  assert.strictEqual(t2.pronouncerId, s);
  room.sent.length = 0;
  act(room, s, { kind: 'pronounce', word: 'Gar-den!', clue: 'flowers grow here', clip: { mime: 'audio/webm;codecs=opus', data: 'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYEC' } });
  assert.strictEqual(t2.stage, 'spell');
  assert.strictEqual(t2.entry.w, 'garden');
  const toP = room.sent.filter((m) => m.id === p).map((m) => m.env.payload.data);
  assert.ok(toP[0].turn.clip && toP[0].turn.clue.custom && toP[0].turn.clue.text === 'flowers grow here' && !toP[0].turn.clue.audio);
  assert.ok(!JSON.stringify(toP).includes('"garden"'));
  // leaving mid-game with fewer than two pronouncers ends it
  sb.onLeave(room, { clientId: s });
  room.clients.delete(s);
  assert.strictEqual(st.phase, 'results');
  cleanup(room);
}

// --- daily and ranked are locked to a mixed race with spoken words; settings can't change it
{
  const room = makeRoom({ daily: { seed: 1234, date: '2026-11-19' } });
  join(room, 'a');
  viewOf(room, 'a');
  act(room, 'a', { kind: 'settings', format: 'bee', level: 'easy' });
  act(room, 'a', { kind: 'start' });
  const g = room.state.game;
  assert.deepStrictEqual([g.format, g.level, g.clues], ['race', 'mix', 'spoken']);
  const w1 = room.state.turn.entry.w;
  cleanup(room);
  const again = makeRoom({ daily: { seed: 1234, date: '2026-11-19' } });
  join(again, 'z');
  act(again, 'z', { kind: 'start' });
  assert.strictEqual(again.state.turn.entry.w, w1, 'same daily seed, same words');
  cleanup(again);
}

// --- bots play race rounds on their own
{
  const room = makeRoom();
  join(room, 'a');
  act(room, 'a', { kind: 'addBot', level: 'expert' });
  assert.strictEqual(room.state.players.size, 2);
  act(room, 'a', { kind: 'start' });
  assert.ok(room.state.botTimers.length > 0, 'bot scheduled to answer');
  cleanup(room);
}

console.log('spellingbee: all tests passed');
