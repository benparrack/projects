// Word Bites: puzzle generation/solver, move validation + run scoring, privacy of other players'
// boards, round lifecycle, bots at every level.
// Run: node test/wordbites.test.js
'use strict';

const assert = require('assert');
const plugin = require('../server/games/wordbites');

const W = plugin._internals;
let failures = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const wait = (ms) => new Promise((res) => setTimeout(res, ms));

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
  room.clients.set(id, { clientId: id, nickname: id });
  plugin.onJoin(room, { clientId: id, nickname: id });
}
const act = (room, id, data) => plugin.onMessage(room, { clientId: id }, data, { senderId: id, broadcast: room.broadcast, sendTo: room.sendTo });
const lastOf = (room, id, kind) => {
  const s = [...room.sent].reverse().find((x) => x.to === id && x.m.payload.data.kind === kind);
  return s && s.m.payload.data;
};
// Skip the 3s countdown.
function go(room) {
  room.state.startedAt = Date.now() - 1;
}
// A hand-made puzzle so scoring can be tested exactly.
function rig(room, pieces, start) {
  const st = room.state;
  st.puzzle = { pieces, start, words: W.solve(pieces) };
  for (const p of st.players.values()) { p.pos = JSON.parse(JSON.stringify(start)); p.found = new Set(); p.words = []; p.score = 0; }
}
const RIG_PIECES = [
  { id: 0, kind: 's', letters: 'c' },
  { id: 1, kind: 'h', letters: 'at' },
  { id: 2, kind: 'v', letters: 'se' },
  { id: 3, kind: 's', letters: 'r' },
];
const RIG_START = { 0: [0, 0], 1: [4, 4], 2: [6, 0], 3: [8, 7] };

test('points table', () => {
  assert.deepStrictEqual([3, 4, 5, 6, 7, 8, 9].map(W.pointsFor), [100, 400, 800, 1400, 1800, 2200, 2200]);
});

test('formable: pairs along the run use both letters, across the run one letter', () => {
  const pcs = [{ id: 0, kind: 'h', letters: 'ca' }, { id: 1, kind: 'v', letters: 'at' }, { id: 2, kind: 's', letters: 't' }];
  assert.ok(W.formable('cat', pcs, 'h')); // CA + (a|t) from the vertical pair
  assert.ok(W.formable('cat', [{ id: 0, kind: 'v', letters: 'ca' }, { id: 1, kind: 's', letters: 't' }], 'v'));
  assert.ok(!W.formable('cat', [{ id: 0, kind: 'v', letters: 'ca' }, { id: 1, kind: 's', letters: 't' }], 'h')); // C,A would need two pieces
  assert.ok(!W.formable('act', [{ id: 0, kind: 'h', letters: 'ca' }, { id: 1, kind: 's', letters: 't' }], 'h'));
});

test('generated puzzles: 15 pieces, plenty of words, a clean (wordless) start, all on the board', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const pz = W.generatePuzzle(W.mulberry32(seed));
    assert.strictEqual(pz.pieces.length, 15);
    assert.ok(pz.words.filter((w) => w.common).length >= 40, `seed ${seed}: too few words`);
    const g = W.gridOf(pz.pieces, pz.start);
    let cells = 0;
    for (const row of g) for (const x of row) if (x) cells++;
    assert.strictEqual(cells, pz.pieces.reduce((n, p) => n + p.letters.length, 0), 'pieces overlap or fell off');
    const all = [];
    for (let r = 0; r < W.ROWS; r++) for (let c = 0; c < W.COLS; c++) if (g[r][c]) all.push([r, c]);
    assert.strictEqual(W.runsThrough(g, all).length, 0, 'start board already has a 3+ run');
    for (const w of pz.words.slice(0, 50)) assert.ok(W.isValid(w.word));
  }
});

test('moves: bounds, overlap, countdown and garbage are rejected; a word scores once', () => {
  const room = makeRoom();
  join(room, 'a');
  act(room, 'a', { kind: 'start' });
  rig(room, RIG_PIECES, RIG_START);
  act(room, 'a', { kind: 'move', id: 1, r: 0, c: 1, seq: 1 });
  assert.strictEqual(lastOf(room, 'a', 'moveRejected').reason, 'countdown');
  go(room);
  act(room, 'a', { kind: 'move', id: 1, r: 0, c: 7, seq: 2 });
  assert.strictEqual(lastOf(room, 'a', 'moveRejected').reason, 'out_of_bounds');
  act(room, 'a', { kind: 'move', id: 2, r: 8, c: 0, seq: 3 });
  assert.strictEqual(lastOf(room, 'a', 'moveRejected').reason, 'out_of_bounds');
  act(room, 'a', { kind: 'move', id: 1, r: 0, c: 0, seq: 4 });
  assert.strictEqual(lastOf(room, 'a', 'moveRejected').reason, 'occupied');
  act(room, 'a', { kind: 'move', id: 99, r: 0, c: 0, seq: 5 });
  assert.strictEqual(lastOf(room, 'a', 'moveRejected').reason, 'bad');
  act(room, 'a', { kind: 'move', id: '1', r: 0, c: 1 });
  assert.strictEqual(lastOf(room, 'a', 'moveRejected').reason, 'bad');
  // C + AT -> CAT across
  act(room, 'a', { kind: 'move', id: 1, r: 0, c: 1, seq: 6 });
  const m = lastOf(room, 'a', 'moved');
  assert.strictEqual(m.seq, 6);
  assert.deepStrictEqual(m.scored.map((s) => [s.word, s.pts, s.dir, s.r, s.c]), [['cat', 100, 'h', 0, 0]]);
  const me = room.state.players.get('a');
  assert.strictEqual(me.score, 100);
  // Move CAT away and back: no second score for the same word.
  act(room, 'a', { kind: 'move', id: 0, r: 3, c: 3, seq: 7 });
  act(room, 'a', { kind: 'move', id: 0, r: 0, c: 0, seq: 8 });
  assert.strictEqual(lastOf(room, 'a', 'moved').scored.length, 0);
  assert.strictEqual(me.score, 100);
  // Vertical pair S/E under the T of CAT? T is at (0,2): put SE at (1,2) -> 'tse' down: not a word.
  // Put SE at (1,3) right of nothing; then CATS: S at (0,3) -> move SE to (0,3): CATS across + SE down.
  act(room, 'a', { kind: 'move', id: 2, r: 0, c: 3, seq: 9 });
  assert.deepStrictEqual(lastOf(room, 'a', 'moved').scored.map((s) => s.word), ['cats']);
  assert.strictEqual(me.score, 500);
  clearTimeout(room.state.roundTimer);
});

test('privacy: other players\' boards and words are hidden until the round ends', () => {
  const room = makeRoom();
  join(room, 'a');
  join(room, 'b');
  act(room, 'a', { kind: 'start' });
  rig(room, RIG_PIECES, RIG_START);
  go(room);
  act(room, 'a', { kind: 'move', id: 1, r: 0, c: 1, seq: 1 });
  const vb = plugin.serializeSnapshot(room, { clientId: 'b' });
  const pa = vb.players.find((p) => p.clientId === 'a');
  assert.strictEqual(pa.score, 100);
  assert.strictEqual(pa.words, undefined);
  assert.deepStrictEqual(vb.myWords, []);
  assert.deepStrictEqual(vb.myPos[1], [4, 4]);
  assert.strictEqual(vb.bestWords, null);
  assert.ok(!JSON.stringify(vb).includes('"cat"'));
  const va = plugin.serializeSnapshot(room, { clientId: 'a' });
  assert.deepStrictEqual(va.myPos[1], [0, 1]);
  // round ends -> everything public
  room.state.endsAt = Date.now() - 1;
  act(room, 'b', { kind: 'move', id: 1, r: 0, c: 1, seq: 1 });
  assert.strictEqual(lastOf(room, 'b', 'moveRejected').reason, 'time');
  clearTimeout(room.state.roundTimer);
  W.endRound(room);
  const after = plugin.serializeSnapshot(room, { clientId: 'b' });
  assert.deepStrictEqual(after.players.find((p) => p.clientId === 'a').words.map((w) => w.word), ['cat']);
  assert.ok(after.bestWords.length > 0);
});

test('round lifecycle: timer ends the round, winner gets a win, NEW ROUND resets', async () => {
  const room = makeRoom();
  join(room, 'a');
  join(room, 'b');
  act(room, 'a', { kind: 'start' });
  rig(room, RIG_PIECES, RIG_START);
  go(room);
  act(room, 'a', { kind: 'move', id: 1, r: 0, c: 1, seq: 1 });
  // shorten the round
  clearTimeout(room.state.roundTimer);
  room.state.endsAt = Date.now() + 30;
  const rid = room.state.roundId;
  room.state.roundTimer = setTimeout(() => { if (room.state.roundId === rid) { W.endRound(room); } }, 30);
  await wait(60);
  assert.strictEqual(room.state.phase, 'results');
  const v = plugin.serializeSnapshot(room, { clientId: 'b' });
  assert.deepStrictEqual(v.players.find((p) => p.clientId === 'a').words.map((w) => w.word), ['cat']);
  assert.ok(Array.isArray(v.bestWords));
  assert.strictEqual(room.state.players.get('a').wins, 1);
  assert.strictEqual(room.state.players.get('b').wins, 0);
  act(room, 'b', { kind: 'start' });
  assert.strictEqual(room.state.phase, 'playing');
  assert.strictEqual(room.state.players.get('a').score, 0);
  assert.strictEqual(room.state.players.get('a').words.length, 0);
  clearTimeout(room.state.roundTimer);
  // last human leaves -> round stops, bots dropped
  act(room, 'a', { kind: 'addBot', level: 'easy' });
  plugin.onLeave(room, { clientId: 'a' });
  plugin.onLeave(room, { clientId: 'b' });
  assert.strictEqual(room.state.players.size, 0);
  assert.strictEqual(room.state.phase, 'waiting');
});

test('bots at every level find only formable valid words; stronger bots score more', async () => {
  const room = makeRoom();
  join(room, 'h');
  for (const lv of ['easy', 'medium', 'hard', 'expert']) act(room, 'h', { kind: 'addBot', level: lv });
  assert.strictEqual(room.state.players.size, 5);
  // speed bots up 60x for the test
  const saved = {};
  for (const [k, v] of Object.entries(W.BOT)) { saved[k] = v.gap; v.gap /= 60; }
  act(room, 'h', { kind: 'start' });
  go(room);
  for (const p of room.state.players.values()) {
    if (p.bot) { clearTimeout(p.botTimer); p.botTimer = null; }
  }
  // reschedule now that the countdown is skipped
  for (const p of room.state.players.values()) if (p.bot) W.scheduleBot(room, p);
  await wait(80 * 1000 / 60);
  for (const [k, v] of Object.entries(W.BOT)) v.gap = saved[k];
  const formable = new Set(room.state.puzzle.words.map((w) => w.word));
  const byLevel = {};
  for (const p of room.state.players.values()) {
    if (!p.bot) continue;
    byLevel[p.bot] = p.score;
    assert.ok(p.words.length > 0, `${p.bot} found nothing`);
    assert.strictEqual(new Set(p.words.map((w) => w.word)).size, p.words.length, 'duplicate word');
    for (const w of p.words) assert.ok(formable.has(w.word) && W.isValid(w.word));
    assert.ok(p.words.every((w) => w.word.length <= W.BOT[p.bot].maxLen));
  }
  console.log('  bot scores (one sped-up round):', JSON.stringify(byLevel));
  assert.ok(byLevel.expert > byLevel.easy, 'expert should beat easy');
  assert.ok(byLevel.hard > byLevel.easy, 'hard should beat easy');
  for (const p of room.state.players.values()) clearTimeout(p.botTimer);
  clearTimeout(room.state.roundTimer);
  // removeBot
  act(room, 'h', { kind: 'removeBot', clientId: 'bot-Ace' });
  assert.ok(!room.state.players.has('bot-Ace'));
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); console.log(`ok   ${name}`); } catch (err) { failures++; console.log(`FAIL ${name}\n     ${err.stack.split('\n').slice(0, 3).join('\n     ')}`); }
  }
  console.log(failures ? `\n${failures} failing` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
