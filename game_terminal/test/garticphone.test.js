// Drawing Phone logic test: `node test/garticphone.test.js` (exit 1 on failure).
'use strict';
const assert = require('assert');
const gp = require('../server/games/garticphone');

// Capture the round timer instead of waiting 60s+ for it.
const timers = [];
global.setTimeout = (fn) => { timers.push(fn); return timers.length; };
global.clearTimeout = () => {};

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('ok  ', name); } catch (e) { failures++; console.log('FAIL', name, '\n  ', e.message); }
}

function makeRoom() {
  const sent = [];
  return { state: gp.createInitialState(), clients: new Map(), sent, sendTo(id, env) { sent.push({ id, env }); } };
}
function join(room, id) { const c = { clientId: id }; room.clients.set(id, c); gp.onJoin(room, c); }
function act(room, id, data) { gp.onMessage(room, { clientId: id }, data, { senderId: id }); }
function lastState(room, id) {
  for (let i = room.sent.length - 1; i >= 0; i--) if (room.sent[i].id === id) return room.sent[i].env.payload.data;
  return null;
}
const IMG = 'data:image/png;base64,AAAA';
function playRound(room, ids) {
  for (const id of ids) {
    const t = lastState(room, id).myTask.taskType;
    act(room, id, { kind: 'submit', content: t === 'drawing' ? IMG : `${id}-text` });
  }
}

test('rounds = players; every book visits every seat once despite shuffled offsets', () => {
  for (let n = 3; n <= 8; n++) {
    const room = makeRoom();
    const ids = [...Array(n).keys()].map((i) => `p${i}`);
    ids.forEach((id) => join(room, id));
    act(room, 'p0', { kind: 'startGame' });
    const st = room.state;
    assert.strictEqual(st.totalRounds, n);
    for (let seat = 0; seat < n; seat++) {
      const books = new Set([...Array(n).keys()].map((r) => gp._test.bookForSeatAtRound(st, seat, r)));
      assert.strictEqual(books.size, n);
    }
    for (let r = 0; r < n; r++) {
      const books = new Set([...Array(n).keys()].map((s) => gp._test.bookForSeatAtRound(st, s, r)));
      assert.strictEqual(books.size, n, 'no two seats share a book in a round');
    }
  }
});

test('timeout fills blanks and the game still finishes; reveal steps link by link', () => {
  const room = makeRoom();
  ['a', 'b', 'c'].forEach((id) => join(room, id));
  act(room, 'a', { kind: 'setRoundSecs', secs: 60 });
  act(room, 'a', { kind: 'startGame' });
  assert.ok(lastState(room, 'a').roundEndsAt > Date.now());
  act(room, 'a', { kind: 'submit', content: 'a cat' });
  timers[timers.length - 1](); // round 0 times out for b and c
  const st = room.state;
  assert.strictEqual(st.currentRound, 1);
  assert.strictEqual(st.books.flat().filter((e) => e.content === null).length, 2);
  playRound(room, st.seats);
  playRound(room, st.seats);
  assert.strictEqual(st.phase, 'reveal');
  let v = lastState(room, 'a');
  assert.deepStrictEqual([v.reveal.bookIdx, v.reveal.step, v.reveal.entries.length], [0, 0, 1]);
  let steps = 0;
  while (!lastState(room, 'a').reveal.done) { st.revealAt = 0; act(room, 'b', { kind: 'revealNext' }); steps++; }
  assert.strictEqual(steps, 3 * 3 - 1);
  v = lastState(room, 'a');
  assert.strictEqual(v.reveal.entries.length, 3);
  act(room, 'a', { kind: 'revealNext' });
  assert.ok(lastState(room, 'a').reveal.done);
});

test('stale timer from an earlier round does nothing', () => {
  const room = makeRoom();
  ['a', 'b', 'c'].forEach((id) => join(room, id));
  act(room, 'a', { kind: 'startGame' });
  const stale = timers[timers.length - 1];
  playRound(room, room.state.seats);
  stale();
  assert.strictEqual(room.state.currentRound, 1);
  assert.strictEqual(room.state.submittedThisRound.size, 0);
});

if (failures) { console.log(`${failures} failed`); process.exit(1); }
console.log('all passed');
