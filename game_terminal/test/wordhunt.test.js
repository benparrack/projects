// Word Hunt: path validation, solver, grid quality, submit outcomes, no-leak views, bots and cleanup.
// Run: node test/wordhunt.test.js
'use strict';

const assert = require('assert');
const plugin = require('../server/games/wordhunt');

const T = plugin._internals;
let failures = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const rooms = [];

function makeRoom(ids = ['A', 'B']) {
  const sent = [];
  const room = {
    state: plugin.createInitialState(),
    clients: new Map(ids.map((id) => [id, { nickname: id }])),
    broadcast: (m) => sent.push({ to: '*', m }),
    sendTo: (id, m) => sent.push({ to: id, m }),
  };
  room.sent = sent;
  for (const id of ids) plugin.onJoin(room, { clientId: id, nickname: id });
  rooms.push(room);
  return room;
}
const act = (room, id, data) => plugin.onMessage(room, { clientId: id }, data, { senderId: id, broadcast: room.broadcast, sendTo: room.sendTo });
const lastFor = (room, id, kind) => {
  const s = [...room.sent].reverse().find((x) => x.to === id && x.m.payload.data.kind === kind);
  return s && s.m.payload.data;
};
// Start a round and skip the countdown.
function startNow(room, id = 'A') {
  act(room, id, { kind: 'start' });
  const st = room.state;
  const shift = st.startedAt - Date.now() + 1;
  st.startedAt -= shift;
  st.endsAt -= shift;
  return st;
}
const FIXED = 'catsoxenbirdpqlm'; // c a t s / o x e n / b i r d / p q l m
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('points by length', () => {
  assert.deepStrictEqual([2, 3, 4, 5, 6, 7, 8, 12].map(T.pointsFor), [0, 100, 400, 800, 1400, 1800, 2200, 2200]);
});

test('wordFromPath accepts touching distinct cells, rejects everything else', () => {
  assert.strictEqual(T.wordFromPath(FIXED, [0, 1, 2]), 'cat');
  assert.strictEqual(T.wordFromPath(FIXED, [0, 5, 10]), 'cxr'); // diagonals are fine
  assert.strictEqual(T.wordFromPath(FIXED, [0, 2]), null); // not touching
  assert.strictEqual(T.wordFromPath(FIXED, [3, 4]), null); // row wrap is not adjacent
  assert.strictEqual(T.wordFromPath(FIXED, [0, 1, 0]), null); // reuse
  assert.strictEqual(T.wordFromPath(FIXED, [15, 16]), null);
  assert.strictEqual(T.wordFromPath(FIXED, [-1]), null);
  assert.strictEqual(T.wordFromPath(FIXED, [0.5]), null);
  assert.strictEqual(T.wordFromPath(FIXED, 'abc'), null);
  assert.strictEqual(T.wordFromPath(FIXED, []), null);
});

test('solver finds known words with valid paths', () => {
  const words = T.solve(FIXED);
  for (const w of ['cat', 'cats', 'bird']) assert.ok(words.has(w), `missing ${w}`);
  for (const [w, path] of words) {
    assert.strictEqual(T.wordFromPath(FIXED, path), w);
    assert.ok(w.length >= 3 && T.isValid(w));
  }
});

test('generated grids are rich enough and fast', () => {
  const t0 = Date.now();
  for (let k = 0; k < 20; k++) {
    const { grid, words } = T.generateGrid();
    assert.strictEqual(grid.length, 16);
    assert.ok(/^[a-z]+$/.test(grid), grid);
    assert.ok(words.size >= 40, `only ${words.size} words in ${grid}`);
  }
  assert.ok(Date.now() - t0 < 4000, 'grid generation too slow');
});

test('bot plans grow with level and stay inside the round', () => {
  const { words } = T.generateGrid();
  const pts = {};
  for (const level of ['easy', 'medium', 'hard', 'expert']) {
    const plan = T.planBot(words, level);
    for (const x of plan) {
      assert.ok(words.has(x.word));
      assert.ok(x.at > 0 && x.at < T.ROUND_MS);
    }
    assert.strictEqual(new Set(plan.map((x) => x.word)).size, plan.length);
    pts[level] = plan.reduce((s, x) => s + T.pointsFor(x.word.length), 0);
  }
  assert.ok(pts.easy < pts.medium && pts.medium < pts.hard && pts.hard < pts.expert, JSON.stringify(pts));
});

test('submit outcomes: closed, found, already, invalid, short, bad_path', () => {
  const room = makeRoom();
  act(room, 'A', { kind: 'submit', path: [0, 1, 2], seq: 1 });
  assert.strictEqual(lastFor(room, 'A', 'result').outcome, 'closed'); // no round yet
  act(room, 'A', { kind: 'start' });
  act(room, 'A', { kind: 'submit', path: [0, 1, 2], seq: 2 });
  assert.strictEqual(lastFor(room, 'A', 'result').outcome, 'closed'); // countdown
  const st = startNow(room);
  st.grid = FIXED;
  st.solutions = T.solve(FIXED);
  act(room, 'A', { kind: 'submit', path: [0, 1, 2], seq: 3 });
  let r = lastFor(room, 'A', 'result');
  assert.deepStrictEqual([r.seq, r.outcome, r.word, r.points], [3, 'found', 'cat', 100]);
  act(room, 'A', { kind: 'submit', path: [0, 1, 2], seq: 4 });
  assert.strictEqual(lastFor(room, 'A', 'result').outcome, 'already');
  act(room, 'B', { kind: 'submit', path: [0, 1, 2], seq: 1 });
  assert.strictEqual(lastFor(room, 'B', 'result').outcome, 'found'); // lists are per player
  act(room, 'A', { kind: 'submit', path: [0, 5, 10], seq: 5 });
  assert.strictEqual(lastFor(room, 'A', 'result').outcome, 'invalid');
  act(room, 'A', { kind: 'submit', path: [0, 1], seq: 6 });
  assert.strictEqual(lastFor(room, 'A', 'result').outcome, 'short');
  act(room, 'A', { kind: 'submit', path: [0, 2, 3], seq: 7 });
  assert.strictEqual(lastFor(room, 'A', 'result').outcome, 'bad_path');
  act(room, 'A', { kind: 'submit', path: { evil: 1 }, seq: 8 });
  assert.strictEqual(lastFor(room, 'A', 'result').outcome, 'bad_path');
  act(room, 'A', { kind: 'submit', path: [8, 9, 10, 11], seq: 10 });
  assert.strictEqual(lastFor(room, 'A', 'result').outcome, 'found');
  assert.strictEqual(st.players.get('A').score, 500);
  act(room, 'A', { kind: 'start' }); // ignored mid-round
  assert.strictEqual(st.grid, FIXED);
});

test('views never leak other players\' words or the answers until results', () => {
  const room = makeRoom();
  const st = startNow(room);
  st.grid = FIXED;
  st.solutions = T.solve(FIXED);
  act(room, 'A', { kind: 'submit', path: [0, 1, 2], seq: 1 });
  const vb = plugin.serializeSnapshot(room, { clientId: 'B' });
  const va = plugin.serializeSnapshot(room, { clientId: 'A' });
  assert.strictEqual(vb.players.find((p) => p.clientId === 'A').words, undefined);
  assert.strictEqual(vb.players.find((p) => p.clientId === 'A').count, 1);
  assert.deepStrictEqual(va.players.find((p) => p.clientId === 'A').words, ['cat']);
  assert.ok(!vb.allWords && !va.allWords);
  assert.ok(!JSON.stringify(vb).includes('"cat"'));
  assert.ok(!JSON.stringify(vb).includes('solutions'));
});

test('ending the round awards wins once and reveals everything', () => {
  const room = makeRoom();
  const st = startNow(room);
  st.grid = FIXED;
  st.solutions = T.solve(FIXED);
  act(room, 'A', { kind: 'submit', path: [8, 9, 10, 11], seq: 1 });
  act(room, 'B', { kind: 'submit', path: [0, 1, 2], seq: 1 });
  clearTimeout(st.roundTimer);
  T.endRound(room); // what the round timer calls
  T.endRound(room); // a second call is a no-op (no double wins)
  assert.strictEqual(st.phase, 'results');
  assert.strictEqual(st.players.get('A').wins, 1);
  assert.strictEqual(st.players.get('B').wins, 0);
  const vb = plugin.serializeSnapshot(room, { clientId: 'B' });
  assert.deepStrictEqual(vb.players.find((p) => p.clientId === 'A').words, ['bird']);
  assert.strictEqual(vb.totalWords, st.solutions.size);
  assert.strictEqual(vb.allWords.length, st.solutions.size);
  assert.ok(vb.allWords.every((x) => Array.isArray(x.path)));
  for (let k = 1; k < vb.allWords.length; k++) assert.ok(vb.allWords[k - 1].word.length >= vb.allWords[k].word.length);
  act(room, 'A', { kind: 'submit', path: [0, 1, 2], seq: 2 });
  assert.strictEqual(lastFor(room, 'A', 'result').outcome, 'closed');
  // A new round resets scores/words but keeps wins.
  startNow(room, 'B');
  assert.strictEqual(st.players.get('A').score, 0);
  assert.deepStrictEqual(st.players.get('A').words, []);
  assert.strictEqual(st.players.get('A').wins, 1);
});

test('bots find words on their own timers; leaving clears every timer', async () => {
  const room = makeRoom(['A']);
  act(room, 'A', { kind: 'addBot', level: 'expert' });
  act(room, 'A', { kind: 'addBot', level: 'easy' });
  const bots = [...room.state.players.values()].filter((p) => p.bot);
  assert.strictEqual(bots.length, 2);
  const st = startNow(room);
  // Pull every bot's plan forward so the test runs quickly.
  for (const b of bots) {
    clearTimeout(b.botTimer);
    b.plan = b.plan.map((x, k) => ({ word: x.word, at: 1 + k }));
    b.planRound = st.roundId;
    T.scheduleBot(room, b);
  }
  await sleep(150);
  for (const b of bots) {
    assert.ok(b.words.length > 0, `${b.bot} bot found nothing`);
    for (const w of b.words) assert.ok(st.solutions.has(w));
  }
  const expert = bots.find((b) => b.bot === 'expert');
  assert.ok(expert.score > bots.find((b) => b.bot === 'easy').score);
  act(room, 'A', { kind: 'removeBot', clientId: bots[1].clientId });
  assert.ok(!st.players.has(bots[1].clientId));
  // Re-arm a long timer, then have the only human leave.
  expert.plan = [{ word: 'zzz', at: 60000 }];
  T.scheduleBot(room, expert);
  assert.ok(expert.botTimer);
  plugin.onLeave(room, { clientId: 'A' });
  assert.strictEqual(st.players.size, 0);
  assert.strictEqual(expert.botTimer, null);
  assert.strictEqual(st.roundTimer, null);
  assert.strictEqual(st.phase, 'waiting');
});

test('garbage messages are ignored without throwing', () => {
  const room = makeRoom(['A']);
  act(room, 'A', null);
  act(room, 'A', { kind: 42 });
  act(room, 'ghost', { kind: 'start' });
  act(room, 'A', { kind: 'removeBot', clientId: 'A' });
  assert.ok(room.state.players.has('A'));
  act(room, 'A', { kind: 'addBot', level: 'nonsense' });
  assert.strictEqual([...room.state.players.values()].filter((p) => p.bot).length, 1);
});

test('client path helper: extend, backtrack, ignore; client parses', async () => {
  require('child_process').execFileSync(process.execPath, ['--check', require('path').join(__dirname, '../public/games/wordhunt/client.js')]);
  const { extendPath } = await import('../public/games/wordhunt/path.js');
  assert.deepStrictEqual(extendPath([], 5), [5]);
  assert.deepStrictEqual(extendPath([5], 10), [5, 10]);
  assert.deepStrictEqual(extendPath([5, 10], 5), [5]); // back onto previous: undo
  assert.deepStrictEqual(extendPath([5, 10], 15), [5, 10, 15]);
  assert.deepStrictEqual(extendPath([5, 10, 15], 5), [5, 10, 15]); // not touching / reused
  assert.deepStrictEqual(extendPath([3], 4), [3]); // row wrap
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); console.log(`ok   ${name}`); } catch (err) { failures++; console.log(`FAIL ${name}\n     ${err.stack.split('\n').slice(0, 3).join('\n     ')}`); }
  }
  // Stop anything still scheduled so the process exits promptly.
  for (const room of rooms) {
    clearTimeout(room.state.roundTimer);
    for (const p of room.state.players.values()) clearTimeout(p.botTimer);
  }
  console.log(failures ? `\n${failures} failing` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
