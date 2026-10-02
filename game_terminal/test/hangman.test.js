// Hangman logic test: `node test/hangman.test.js` (exit 1 on failure).
'use strict';
const assert = require('assert');
const hm = require('../server/games/hangman');

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('ok  ', name); } catch (e) { failures++; console.log('FAIL', name, '\n  ', e.message); }
}

function makeRoom() {
  const sent = [];
  const room = {
    state: hm.createInitialState(),
    clients: new Map(),
    sendTo(id, env) { sent.push({ id, env }); },
    broadcast(env) { for (const id of this.clients.keys()) sent.push({ id, env }); },
  };
  room.sent = sent;
  return room;
}
function join(room, id) { const c = { clientId: id, nickname: id }; room.clients.set(id, c); hm.onJoin(room, c); return c; }
function leave(room, id) { const c = room.clients.get(id); room.clients.delete(id); hm.onLeave(room, c); }
function act(room, id, data) {
  hm.onMessage(room, { clientId: id }, data, { senderId: id, sendTo: (to, env) => room.sendTo(to, env), broadcast: (env) => room.broadcast(env) });
}
const lastView = (room, id) => {
  for (let i = room.sent.length - 1; i >= 0; i--) {
    const { id: to, env } = room.sent[i];
    if (to === id && env.payload.data.kind === 'state') return env.payload.data.view;
  }
  return null;
};
const lastEvent = (room, id) => { for (let i = room.sent.length - 1; i >= 0; i--) if (room.sent[i].id === id) return room.sent[i].env.payload.data; return null; };
const stopBots = (room) => clearTimeout(room.state._botTimer);

test('accepts real words the old list rejected (and inflections, modern words)', () => {
  for (const w of ['and', 'jumped', 'running', 'boxes', 'selfie', 'emails', 'star wars', 'the quick brown fox']) {
    const room = makeRoom(); join(room, 'p'); join(room, 'g');
    act(room, 'p', { kind: 'setWord', word: w });
    assert.strictEqual(room.state.phase, 'guessing', `"${w}" should be accepted`);
  }
});

test('rejects non-words and reports which token was unknown', () => {
  const room = makeRoom(); join(room, 'p'); join(room, 'g');
  act(room, 'p', { kind: 'setWord', word: 'hello qzxvbn' });
  assert.strictEqual(room.state.phase, 'waiting');
  const ev = lastEvent(room, 'p');
  assert.strictEqual(ev.kind, 'wordRejected');
  assert.deepStrictEqual(ev.unknown, ['qzxvbn']);
});

test('only picker can set word; picker cannot guess', () => {
  const room = makeRoom(); join(room, 'p'); join(room, 'g');
  act(room, 'g', { kind: 'setWord', word: 'cat' });
  assert.strictEqual(room.state.phase, 'waiting');
  act(room, 'p', { kind: 'setWord', word: 'cat' });
  act(room, 'p', { kind: 'guessLetter', letter: 'c' });
  assert.deepStrictEqual(room.state.guessedLetters, []);
});

test('solver gets the win; scores in view sorted', () => {
  const room = makeRoom(); join(room, 'p'); join(room, 'a'); join(room, 'b');
  act(room, 'p', { kind: 'setWord', word: 'cat' });
  act(room, 'a', { kind: 'guessLetter', letter: 'c' });
  act(room, 'b', { kind: 'guessLetter', letter: 'a' });
  act(room, 'a', { kind: 'guessLetter', letter: 't' });
  assert.strictEqual(room.state.lastResult, 'win');
  assert.strictEqual(room.state.wins.a, 1);
  assert.ok(!room.state.wins.b);
  const v = lastView(room, 'b');
  assert.strictEqual(v.roundWinner, 'a');
  assert.deepStrictEqual(v.scores.map((s) => s.clientId), ['a', 'p', 'b']);
  assert.strictEqual(v.scores[0].wins, 1);
});

test('picker gets the win when guessers run out; word revealed in mask', () => {
  const room = makeRoom(); join(room, 'p'); join(room, 'g');
  act(room, 'p', { kind: 'setWord', word: 'cat' });
  for (const l of 'zqxjkv') act(room, 'g', { kind: 'guessLetter', letter: l });
  assert.strictEqual(room.state.lastResult, 'lose');
  assert.strictEqual(room.state.wins.p, 1);
  assert.strictEqual(lastView(room, 'g').mask.join(''), 'CAT');
});

test('wins persist across rounds; picker rotates', () => {
  const room = makeRoom(); join(room, 'p'); join(room, 'g');
  act(room, 'p', { kind: 'setWord', word: 'cat' });
  for (const l of 'cat') act(room, 'g', { kind: 'guessLetter', letter: l });
  act(room, 'g', { kind: 'nextRound' });
  assert.strictEqual(room.state.pickerClientId, 'g');
  act(room, 'g', { kind: 'setWord', word: 'dog' });
  for (const l of 'dog') act(room, 'p', { kind: 'guessLetter', letter: l });
  assert.deepStrictEqual(room.state.wins, { g: 1, p: 1 });
});

test('leaver removed from scoreboard; others get a fresh view', () => {
  const room = makeRoom(); join(room, 'p'); join(room, 'a'); join(room, 'b');
  act(room, 'p', { kind: 'setWord', word: 'cat' });
  for (const l of 'cat') act(room, 'a', { kind: 'guessLetter', letter: l });
  room.sent.length = 0;
  leave(room, 'a');
  assert.ok(!('a' in room.state.wins));
  const v = lastView(room, 'b');
  assert.ok(v && !v.scores.some((s) => s.clientId === 'a'));
  leave(room, 'p'); // picker leaves mid-waiting → b becomes picker
  assert.strictEqual(room.state.pickerClientId, 'b');
  assert.strictEqual(lastView(room, 'b').isPicker, true);
});

// Async section: real timers, a bot picker vs a bot guesser + one human spectating-guesser.
async function asyncTests() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (const level of ['easy', 'expert']) {
    const room = makeRoom(); join(room, 'h');
    act(room, 'h', { kind: 'addBot', level });
    const picker = room.state.pickerClientId;
    await sleep(1400);
    try {
      assert.strictEqual(room.state.phase, 'guessing', `${level} bot picked`);
      const w = room.state.word.toLowerCase();
      assert.ok(require('../server/games/words').isCommon(w), `${level} bot word "${w}" is common`);
      console.log('ok   bot picker', level, '->', room.state.word);
    } catch (e) { failures++; console.log('FAIL bot picker', level, e.message); }
    // Human solves it → wins tracked, then leaves; bots must be cleared with no timer firing.
    for (const l of new Set(room.state.word)) act(room, 'h', { kind: 'guessLetter', letter: l });
    try { assert.strictEqual(room.state.wins.h, 1); console.log('ok   human solve vs bot picker', level); } catch (e) { failures++; console.log('FAIL', e.message); }
    void picker;
    leave(room, 'h');
    try { assert.deepStrictEqual(room.state.pickerOrder, []); assert.deepStrictEqual(room.state.wins, {}); console.log('ok   last human leaving clears bots + scores'); } catch (e) { failures++; console.log('FAIL', e.message); }
  }
  // Bot guesser solves, gets credited.
  const room = makeRoom(); join(room, 'h');
  act(room, 'h', { kind: 'addBot', level: 'expert' });
  stopBots(room);
  // Make the human the picker instead.
  room.state.pickerClientId = 'h';
  act(room, 'h', { kind: 'setWord', word: 'garden' });
  const bot = room.state.pickerOrder.find((id) => id.startsWith('bot-'));
  for (let i = 0; i < 160 && room.state.phase === 'guessing'; i++) await sleep(250);
  try {
    assert.strictEqual(room.state.phase, 'round_over');
    const who = room.state.lastResult === 'win' ? bot : 'h';
    assert.strictEqual(room.state.wins[who], 1);
    console.log('ok   expert bot guesser finished round:', room.state.lastResult, `(${room.state.guessedLetters.join('')})`);
  } catch (e) { failures++; console.log('FAIL bot guesser', e.message); }
  leave(room, 'h');
}

asyncTests().then(() => {
  if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
  console.log('\nall hangman tests passed');
  process.exit(0);
});
