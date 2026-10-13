// node test/anagrams.test.js — puzzle/scoring/protocol/bot tests for server/games/anagrams.js.
'use strict';

const assert = require('assert');
const plugin = require('../server/games/anagrams');
const { isWord, letterCounts, canSpell } = require('../server/games/words');
const { makePuzzle, pointsFor, BOT, JUNK } = plugin._internals;

let failures = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const realSetTimeout = setTimeout;
// Uses the real timer even while a test speeds up the plugin's timers by patching setTimeout.
const sleep = (ms) => new Promise((r) => realSetTimeout(r, ms));

function makeRoom() {
  const room = { state: plugin.createInitialState(), clients: new Map(), sent: [] };
  room.sendTo = (id, env) => room.sent.push({ id, env });
  room.broadcast = (env) => { for (const id of room.clients.keys()) room.sendTo(id, env); };
  return room;
}
function join(room, id, nickname = id) {
  room.clients.set(id, { nickname });
  plugin.onJoin(room, { clientId: id, nickname });
}
function leave(room, id) {
  room.clients.delete(id);
  plugin.onLeave(room, { clientId: id });
}
function act(room, id, data) {
  plugin.onMessage(room, room.clients.get(id), data, { senderId: id, sendTo: room.sendTo, broadcast: room.broadcast });
}
const lastOf = (room, id, kind) => {
  const hit = [...room.sent].reverse().find((s) => s.id === id && s.env.payload.data.kind === kind);
  return hit && hit.env.payload.data;
};
// Skip the countdown so submissions count immediately.
function startNow(room, id) {
  act(room, id, { kind: 'start' });
  room.state.startedAt = Date.now() - 1;
}
function stop(room) {
  clearTimeout(room.state.roundTimer);
  for (const p of room.state.players.values()) clearTimeout(p.botTimer);
}

test('puzzles: six letters, a 6-letter answer, never shuffled into a 6-letter word', () => {
  for (let i = 0; i < 300; i++) {
    const pz = makePuzzle();
    assert.strictEqual(pz.letters.length, 6);
    assert.deepStrictEqual([...pz.letters].sort(), [...pz.base].sort());
    assert.ok(pz.answers.includes(pz.base));
    assert.ok(!pz.answers.filter((w) => w.length === 6).includes(pz.letters), `letters spell ${pz.letters}`);
    assert.ok(pz.common.length >= 10);
    const counts = letterCounts(pz.letters);
    for (const w of pz.answers) {
      assert.ok(w.length >= 3 && w.length <= 6 && isWord(w) && canSpell(w, counts) && !JUNK.has(w), w);
    }
    assert.strictEqual(new Set(pz.answers).size, pz.answers.length);
  }
});

test('points: 100 / 400 / 1200 / 2000', () => {
  assert.deepStrictEqual(['cat', 'cats', 'carts', 'carted'].map(pointsFor), [100, 400, 1200, 2000]);
});

test('submit: found, already, short, not_word, invalid letters, closed', () => {
  const room = makeRoom();
  join(room, 'a');
  join(room, 'b');
  act(room, 'a', { kind: 'submit', word: 'abc' });
  assert.strictEqual(lastOf(room, 'a', 'result').outcome, 'closed');
  startNow(room, 'a');
  const st = room.state;
  const three = st.answers.find((w) => w.length === 3);
  act(room, 'a', { kind: 'submit', word: st.base.toUpperCase() });
  let r = lastOf(room, 'a', 'result');
  assert.strictEqual(r.outcome, 'found');
  assert.strictEqual(r.points, 2000);
  act(room, 'a', { kind: 'submit', word: st.base });
  assert.strictEqual(lastOf(room, 'a', 'result').outcome, 'already');
  // Another player can score the same word.
  act(room, 'b', { kind: 'submit', word: st.base });
  assert.strictEqual(lastOf(room, 'b', 'result').outcome, 'found');
  if (three) {
    act(room, 'a', { kind: 'submit', word: three });
    assert.strictEqual(lastOf(room, 'a', 'result').points, 100);
  }
  act(room, 'a', { kind: 'submit', word: st.letters.slice(0, 2) });
  assert.strictEqual(lastOf(room, 'a', 'result').outcome, 'short');
  act(room, 'a', { kind: 'submit', word: 'zzzq' });
  assert.strictEqual(lastOf(room, 'a', 'result').outcome, 'invalid');
  act(room, 'a', { kind: 'submit', word: st.letters + st.letters[0] });
  assert.strictEqual(lastOf(room, 'a', 'result').outcome, 'invalid');
  act(room, 'a', { kind: 'submit', word: 42 });
  assert.strictEqual(lastOf(room, 'a', 'result').outcome, 'invalid');
  // A letter-legal non-word (all six letters reversed is almost never a word; skip if it is).
  const junk = [...st.letters].reverse().join('');
  if (!st.answers.includes(junk)) {
    act(room, 'a', { kind: 'submit', word: junk });
    assert.strictEqual(lastOf(room, 'a', 'result').outcome, 'not_word');
  }
  const a = st.players.get('a');
  assert.strictEqual(a.score, 2000 + (three ? 100 : 0));
  stop(room);
});

test('views never leak other players\' words or the answers mid-round; all revealed after', () => {
  const room = makeRoom();
  join(room, 'a');
  join(room, 'b');
  startNow(room, 'a');
  act(room, 'a', { kind: 'submit', word: room.state.base });
  const vb = plugin.serializeSnapshot(room, { clientId: 'b' });
  assert.strictEqual(vb.answers, null);
  assert.strictEqual(vb.base, null);
  assert.deepStrictEqual(vb.myWords, []);
  assert.strictEqual(vb.players.find((p) => p.clientId === 'a').words, undefined);
  assert.strictEqual(vb.players.find((p) => p.clientId === 'a').count, 1);
  assert.ok(!JSON.stringify(vb).includes(`"${room.state.base}"`));
  const va = plugin.serializeSnapshot(room, { clientId: 'a' });
  assert.deepStrictEqual(va.myWords, [room.state.base]);
  // Past the deadline (before the end timer has fired) submissions are refused.
  room.state.endsAt = Date.now() - 1;
  act(room, 'b', { kind: 'submit', word: room.state.base });
  assert.strictEqual(lastOf(room, 'b', 'result').outcome, 'closed');
  stop(room);
});

test('round ends via its timer: winner gets a win, results reveal everything', async () => {
  const room = makeRoom();
  join(room, 'a');
  join(room, 'b');
  // Monkey-patch setTimeout delays so the round timer fires immediately.
  const realST = global.setTimeout;
  global.setTimeout = (fn, ms, ...rest) => realST(fn, Math.min(ms, 30), ...rest);
  try {
    act(room, 'a', { kind: 'start' });
    room.state.startedAt = Date.now() - 1;
    act(room, 'a', { kind: 'submit', word: room.state.base });
    await sleep(60);
  } finally { global.setTimeout = realST; }
  const st = room.state;
  assert.strictEqual(st.phase, 'results');
  assert.strictEqual(st.players.get('a').wins, 1);
  assert.strictEqual(st.players.get('b').wins, 0);
  const vb = plugin.serializeSnapshot(room, { clientId: 'b' });
  assert.ok(Array.isArray(vb.answers) && vb.answers.includes(st.base));
  assert.strictEqual(vb.base, st.base);
  assert.deepStrictEqual(vb.players.find((p) => p.clientId === 'a').words, [st.base]);
  // A new round resets scores but keeps wins.
  act(room, 'b', { kind: 'start' });
  assert.strictEqual(st.phase, 'playing');
  assert.strictEqual(st.players.get('a').score, 0);
  assert.strictEqual(st.players.get('a').wins, 1);
  act(room, 'a', { kind: 'start' }); // ignored mid-round
  stop(room);
});

test('bots: add/remove, find only valid words, stronger levels score more', async () => {
  const room = makeRoom();
  join(room, 'h');
  for (const level of ['easy', 'medium', 'hard', 'expert']) act(room, 'h', { kind: 'addBot', level });
  const bots = [...room.state.players.values()].filter((p) => p.bot);
  assert.strictEqual(bots.length, 4, 'four bots');
  const realST = global.setTimeout;
  // Run bot thinking 100x faster.
  global.setTimeout = (fn, ms, ...rest) => realST(fn, Math.max(0, ms / 100), ...rest);
  try {
    act(room, 'h', { kind: 'start' });
    await sleep(1000);
  } finally { global.setTimeout = realST; }
  const st = room.state;
  assert.strictEqual(st.phase, 'results');
  const byLevel = {};
  for (const b of bots) {
    byLevel[b.bot] = b.score;
    const counts = letterCounts(st.letters);
    for (const w of b.found) assert.ok(st.answerSet.has(w) && canSpell(w, counts), `${b.bot} found bad word ${w}`);
    assert.strictEqual(new Set(b.found).size, b.found.length);
  }
  console.log('     bot scores:', JSON.stringify(byLevel));
  assert.ok(byLevel.expert > byLevel.easy, 'expert should beat easy');
  assert.ok(byLevel.hard >= byLevel.easy, 'hard should not lose to easy');
  // remove a bot; non-bot ids are ignored
  act(room, 'h', { kind: 'removeBot', clientId: bots[0].clientId });
  act(room, 'h', { kind: 'removeBot', clientId: 'h' });
  assert.strictEqual(st.players.size, 4);
  assert.ok(BOT.easy.maxMs > BOT.expert.maxMs);
});

test('last human leaving stops the round and drops bots', () => {
  const room = makeRoom();
  join(room, 'h');
  act(room, 'h', { kind: 'addBot', level: 'hard' });
  act(room, 'h', { kind: 'start' });
  leave(room, 'h');
  assert.strictEqual(room.state.players.size, 0);
  assert.strictEqual(room.state.phase, 'waiting');
  assert.strictEqual(room.state.roundTimer, null);
});

test('find-every-word mode: no clock, ends when everyone finds all or gives up', () => {
  const room = makeRoom();
  join(room, 'a'); join(room, 'b');
  act(room, 'a', { kind: 'start', mode: 'complete' });
  room.state.startedAt = Date.now() - 1;
  const st = room.state;
  assert.strictEqual(st.mode, 'complete');
  assert.strictEqual(st.endsAt, null);
  assert.strictEqual(st.roundTimer, null);
  for (const w of st.answers) act(room, 'a', { kind: 'submit', word: w });
  assert.strictEqual(st.phase, 'playing', 'b is still searching');
  act(room, 'b', { kind: 'giveUp' });
  assert.strictEqual(st.phase, 'results');
  assert.ok(lastOf(room, 'a', 'state').answers.length > 0, 'answers revealed');
  act(room, 'a', { kind: 'start' }); // no mode → back to timed
  assert.strictEqual(st.mode, 'timed');
  assert.ok(st.endsAt);
  stop(room);
  const ranked = makeRoom();
  ranked.ranked = true;
  join(ranked, 'a');
  act(ranked, 'a', { kind: 'start', mode: 'complete' });
  assert.strictEqual(ranked.state.mode, 'timed', 'ranked stays timed');
  stop(ranked);
});

test('garbage messages are ignored', () => {
  const room = makeRoom();
  join(room, 'a');
  act(room, 'a', null);
  act(room, 'a', { kind: 7 });
  act(room, 'a', { kind: 'nope' });
  plugin.onMessage(room, {}, { kind: 'start' }, { senderId: 'ghost', sendTo: room.sendTo });
  assert.strictEqual(room.state.phase, 'waiting');
});

(async () => {
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (err) {
      failures++;
      console.log(`FAIL ${name}\n     ${String(err.stack).split('\n').slice(0, 3).join('\n     ')}`);
    }
  }
  console.log(failures ? `\n${failures} failing` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
