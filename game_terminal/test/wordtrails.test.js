// Word Trails: word validation, turn order/timeouts/lives, penalties, leaving mid-turn, solo mode,
// typing relay, and full bot-only rounds at every level (driven by a mocked clock).
// Run: node test/wordtrails.test.js
'use strict';

const assert = require('assert');
const plugin = require('../server/games/wordtrails');
const { isWord } = require('../server/games/words');

const I = plugin._internals;
let failures = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// Mocked clock: the plugin only reads Date.now().
let NOW = 1_000_000;
const realNow = Date.now;
Date.now = () => NOW;

function makeRoom() {
  const sent = [];
  const room = {
    state: plugin.createInitialState(),
    clients: new Map(),
    broadcast: (m) => sent.push({ to: '*', m }),
    sendTo: (id, m) => sent.push({ to: id, m }),
  };
  room.sent = sent;
  return room;
}
function join(room, id) {
  room.clients.set(id, { nickname: id });
  plugin.onJoin(room, { clientId: id, nickname: id });
}
function leave(room, id) {
  room.clients.delete(id);
  plugin.onLeave(room, { clientId: id, nickname: id });
}
const act = (room, id, data) => plugin.onMessage(room, { clientId: id }, data, { senderId: id, broadcast: room.broadcast, sendTo: room.sendTo });
const lastFor = (room, id, kind) => {
  const s = [...room.sent].reverse().find((x) => x.to === id && x.m.payload.data.kind === kind);
  return s && s.m.payload.data;
};
const view = (room) => plugin.serializeSnapshot(room);
// Advance the mocked clock in tick-sized steps.
function run(room, ms) {
  const end = NOW + ms;
  while (NOW < end) { NOW += plugin.tickIntervalMs; plugin.tick(room); }
}
function startPlaying(room, opts = {}) {
  act(room, [...room.state.players.keys()][0], { kind: 'start', ...opts });
  run(room, I.COUNTDOWN_MS + 100);
  assert.strictEqual(room.state.phase, 'playing');
}
// A valid, unused word for the current required letter.
function validWord(room) {
  const st = room.state;
  const need = view(room).required;
  const list = I.vocab('common')[need].filter((w) => w.length >= st.settings.minLen && !st.used.has(w));
  return list[0];
}

test('plugin shape: tick-driven', () => {
  assert.strictEqual(plugin.type, 'wordtrails');
  assert.ok(plugin.tickIntervalMs > 0 && typeof plugin.tick === 'function');
});

test('word checks: letter, length, repeats, dictionary', () => {
  const st = { chain: [{ word: 'trail' }], used: new Set(['trail']), settings: { minLen: 3 } };
  assert.strictEqual(I.checkWord(st, 'lemon'), null);
  assert.strictEqual(I.checkWord(st, ' LEMON '), null);
  assert.strictEqual(I.checkWord(st, 'melon'), 'wrong_letter');
  assert.strictEqual(I.checkWord(st, 'lo'), 'too_short');
  assert.strictEqual(I.checkWord(st, 'lqzzv'), 'not_word');
  assert.strictEqual(I.checkWord(st, 'l3mon'), 'not_word');
  assert.strictEqual(I.checkWord(st, 42), 'not_word');
  st.used.add('lemon');
  assert.strictEqual(I.checkWord(st, 'lemon'), 'used');
  st.settings.minLen = 5;
  assert.strictEqual(I.checkWord(st, 'lamp'), 'too_short');
});

test('round flow: countdown, opener, turns rotate, chain links', () => {
  const room = makeRoom();
  join(room, 'A');
  join(room, 'B');
  act(room, 'A', { kind: 'start', lives: 3, turnSecs: 12, minLen: 3 });
  assert.strictEqual(room.state.phase, 'countdown');
  const v0 = view(room);
  assert.strictEqual(v0.chain.length, 1);
  assert.ok(isWord(v0.chain[0].word));
  run(room, I.COUNTDOWN_MS + 100);
  const v1 = view(room);
  assert.strictEqual(v1.phase, 'playing');
  const first = v1.turnId;
  const other = first === 'A' ? 'B' : 'A';
  act(room, other, { kind: 'submit', word: validWord(room) });
  assert.strictEqual(lastFor(room, other, 'rejected').reason, 'not_your_turn');
  const w = validWord(room);
  act(room, first, { kind: 'submit', word: w });
  const v2 = view(room);
  assert.strictEqual(v2.turnId, other);
  assert.strictEqual(v2.required, w[w.length - 1]);
  assert.strictEqual(v2.chain[v2.chain.length - 1].by, first);
  assert.strictEqual(v2.players.find((p) => p.clientId === first).words, 1);
  // a word already on the trail is rejected
  const again = validWord(room);
  room.state.used.add(again);
  act(room, other, { kind: 'submit', word: again });
  assert.strictEqual(lastFor(room, other, 'rejected').reason, 'used');
});

test('wrong submissions burn clock time but no life', () => {
  const room = makeRoom();
  join(room, 'A');
  join(room, 'B');
  startPlaying(room);
  const id = view(room).turnId;
  const before = room.state.turnEndsAt;
  act(room, id, { kind: 'submit', word: 'zzzzqx' });
  assert.ok(lastFor(room, id, 'rejected'));
  assert.strictEqual(room.state.turnEndsAt, before - I.PENALTY_MS);
  assert.strictEqual(view(room).players.find((p) => p.clientId === id).lives, 3);
  assert.strictEqual(view(room).turnId, id);
});

test('timeout costs a life, same letter passes on; elimination ends the round', () => {
  const room = makeRoom();
  join(room, 'A');
  join(room, 'B');
  startPlaying(room, { lives: 1, turnSecs: 8 });
  const loser = view(room).turnId;
  const need = view(room).required;
  run(room, 8000 + 100);
  assert.strictEqual(room.state.phase, 'results');
  const v = view(room);
  assert.strictEqual(v.winner, loser === 'A' ? 'B' : 'A');
  assert.strictEqual(v.players.find((p) => p.clientId === v.winner).wins, 1);
  assert.ok(v.players.find((p) => p.clientId === loser).out);
  assert.strictEqual(v.lastEvent.kind, 'timeout');
  assert.strictEqual(v.lastEvent.letter, need);

  // 3 lives: after a timeout the other player gets the same letter after a short pause
  act(room, 'A', { kind: 'start', lives: 3, turnSecs: 8 });
  run(room, I.COUNTDOWN_MS + 100);
  const p1 = view(room).turnId;
  const letter = view(room).required;
  run(room, 8000 + 100);
  assert.strictEqual(view(room).players.find((p) => p.clientId === p1).lives, 2);
  assert.strictEqual(room.state.phase, 'playing');
  act(room, p1 === 'A' ? 'B' : 'A', { kind: 'submit', word: validWord(room) });
  assert.strictEqual(lastFor(room, p1 === 'A' ? 'B' : 'A', 'rejected').reason, 'not_playing'); // still in the pause
  run(room, I.AFTER_LIFE_LOST_MS + 100);
  const v2 = view(room);
  assert.notStrictEqual(v2.turnId, p1);
  assert.strictEqual(v2.required, letter);
});

test('turn clock shrinks each lap, floored', () => {
  const st = { chain: [{}], order: ['a', 'b'], settings: { turnSecs: 8 } };
  const t0 = I.turnMsFor(st);
  st.chain = new Array(9).fill({});
  assert.ok(I.turnMsFor(st) < t0);
  st.chain = new Array(500).fill({});
  assert.strictEqual(I.turnMsFor(st), I.MIN_TURN_MS);
});

test('leaving on your turn hands the turn on; last one standing wins', () => {
  const room = makeRoom();
  join(room, 'A');
  join(room, 'B');
  join(room, 'C');
  startPlaying(room);
  const cur = view(room).turnId;
  const order = room.state.order.slice();
  const next = order[(order.indexOf(cur) + 1) % 3];
  leave(room, cur);
  assert.strictEqual(room.state.phase, 'playing');
  assert.strictEqual(view(room).turnId, next);
  assert.ok(room.state.turnEndsAt > NOW);
  leave(room, next);
  assert.strictEqual(room.state.phase, 'results');
  assert.strictEqual(view(room).winner, order.find((id) => id !== cur && id !== next));
});

test('solo survival: ends when lives run out, records best trail', () => {
  const room = makeRoom();
  join(room, 'A');
  startPlaying(room, { lives: 1, turnSecs: 8 });
  act(room, 'A', { kind: 'submit', word: validWord(room) });
  act(room, 'A', { kind: 'submit', word: validWord(room) });
  assert.strictEqual(view(room).turnId, 'A');
  run(room, 9000);
  const v = view(room);
  assert.strictEqual(v.phase, 'results');
  assert.strictEqual(v.endReason, 'solo_over');
  assert.strictEqual(v.winner, null);
  assert.strictEqual(v.players[0].bestTrail, 2);
});

test('typing is relayed to others only, only from the current player', () => {
  const room = makeRoom();
  join(room, 'A');
  join(room, 'B');
  startPlaying(room);
  const cur = view(room).turnId;
  const other = cur === 'A' ? 'B' : 'A';
  room.sent.length = 0;
  act(room, cur, { kind: 'typing', text: 'Le<b>m' });
  assert.strictEqual(lastFor(room, other, 'typing').text, 'lebm');
  assert.strictEqual(lastFor(room, cur, 'typing'), undefined);
  room.sent.length = 0;
  act(room, other, { kind: 'typing', text: 'x' });
  assert.strictEqual(room.sent.length, 0);
});

test('bots: added only between rounds, removed anytime, dropped when humans leave', () => {
  const room = makeRoom();
  join(room, 'A');
  act(room, 'A', { kind: 'addBot', level: 'expert' });
  act(room, 'A', { kind: 'addBot', level: 'nonsense' });
  const bots = view(room).players.filter((p) => p.bot);
  assert.deepStrictEqual(bots.map((b) => b.bot), ['expert', 'hard']);
  startPlaying(room);
  act(room, 'A', { kind: 'addBot' });
  assert.strictEqual(view(room).players.length, 3);
  act(room, 'A', { kind: 'removeBot', clientId: bots[0].clientId });
  assert.strictEqual(view(room).players.length, 2);
  assert.strictEqual(room.state.phase, 'playing');
  leave(room, 'A');
  assert.strictEqual(room.state.players.size, 0);
  assert.strictEqual(room.state.phase, 'waiting');
});

test('bot-only rounds finish at every level with valid, linked, unique words', () => {
  for (const level of ['easy', 'medium', 'hard', 'expert']) {
    const room = makeRoom();
    join(room, 'H'); // a human spectator-player who immediately leaves the table by timing out
    act(room, 'H', { kind: 'addBot', level });
    act(room, 'H', { kind: 'addBot', level: 'hard' });
    act(room, 'H', { kind: 'start', lives: 1, turnSecs: 12 });
    // Take the human out of the rotation: they just time out on their turn.
    let guard = 0;
    while (room.state.phase !== 'results' && guard++ < 20000) run(room, 100);
    assert.strictEqual(room.state.phase, 'results', `${level}: round never ended`);
    const chain = room.state.chain;
    const seen = new Set();
    for (let i = 1; i < chain.length; i++) {
      const w = chain[i].word;
      assert.ok(isWord(w), `${level}: ${w} not a word`);
      assert.strictEqual(w[0], chain[i - 1].word.slice(-1), `${level}: ${w} doesn't link`);
      assert.ok(!seen.has(w), `${level}: repeat ${w}`);
      seen.add(w);
    }
    console.log(`  ${level}: trail of ${chain.length - 1} words, winner ${room.state.winner} (${((guard * 100) / 1000).toFixed(0)}s simulated)`);
  }
});

test('expert steers toward trap letters more than easy', () => {
  const st = { chain: [{ word: 'trail' }], used: new Set(['trail']), settings: { minLen: 3 }, order: ['a', 'b'] };
  const trapEnds = (lv) => {
    let n = 0;
    for (let i = 0; i < 60; i++) {
      const w = I.chooseBotWord(st, lv);
      if ('jkqvxyz'.includes(w[w.length - 1])) n++;
    }
    return n;
  };
  assert.ok(trapEnds('expert') > trapEnds('easy'));
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); console.log(`ok   ${name}`); } catch (err) { failures++; console.log(`FAIL ${name}\n     ${err.stack.split("\n").slice(0, 8).join('\n     ')}`); }
  }
  Date.now = realNow;
  console.log(failures ? `\n${failures} failing` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
