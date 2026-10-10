// node test/wordscapes.test.js — layout/rules/bot tests for server/games/wordscapes.js.
'use strict';

const assert = require('assert');
const path = require('path');
const plugin = require('../server/games/wordscapes');
const { isWord, isCommon } = require('../server/games/words');
const { makePuzzle, validateLayout, slotCells, wheelSizeFor, BOT_SPEED, BOT_CFG } = plugin._test;

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeRoom() {
  const room = { state: plugin.createInitialState(), clients: new Map(), sent: [] };
  room.sendTo = (id, env) => room.sent.push({ id, env });
  room.broadcast = (env) => { for (const id of room.clients.keys()) room.sendTo(id, env); };
  return room;
}
function join(room, id) {
  room.clients.set(id, { nickname: id });
  plugin.onJoin(room, { clientId: id, nickname: id });
}
function leave(room, id) {
  room.clients.delete(id);
  plugin.onLeave(room, { clientId: id });
}
function act(room, id, data) {
  const ctx = { senderId: id, sendTo: room.sendTo, broadcast: room.broadcast };
  plugin.onMessage(room, room.clients.get(id), data, ctx);
}
const lastOf = (room, id, kind) => {
  for (let i = room.sent.length - 1; i >= 0; i--) {
    const d = room.sent[i].env.payload.data;
    if (room.sent[i].id === id && d.kind === kind) return d;
  }
  return null;
};
const words = (room) => room.state.puzzle.slots.map((s) => s.word);
const goNow = (room) => { room.state.startAt = Date.now() - 1; };

test('300 seeds: valid connected crossword, 5-12 common targets, wheel size by level', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const level = 1 + (seed % 14);
    const p = makePuzzle(level, seed);
    const err = validateLayout({ placed: p.slots, rows: p.rows, cols: p.cols });
    assert.strictEqual(err, null, `seed ${seed}: ${err}`);
    assert.ok(p.slots.length >= 5 && p.slots.length <= 12, `seed ${seed}: ${p.slots.length} targets`);
    assert.strictEqual(p.letters.length, wheelSizeFor(level));
    assert.ok(p.rows <= 10 && p.cols <= 12, `seed ${seed}: ${p.rows}x${p.cols}`);
    assert.deepStrictEqual(p.letters.split('').sort(), p.base.split('').sort());
    assert.ok(p.slots.some((s) => s.word === p.base), 'base word is in the grid');
    const seen = new Set();
    for (const s of p.slots) {
      assert.ok(s.word.length >= 3 && isCommon(s.word), `seed ${seed}: ${s.word}`);
      assert.ok(!seen.has(s.word), 'no duplicate targets');
      seen.add(s.word);
    }
    for (const b of p.bonusList) assert.ok(isWord(b) && !seen.has(b));
  }
  assert.strictEqual(wheelSizeFor(1), 5);
  assert.strictEqual(wheelSizeFor(5), 6);
  assert.strictEqual(wheelSizeFor(12), 7);
});

test('validateLayout catches stray adjacencies and disconnection', () => {
  const ok = { rows: 3, cols: 3, placed: [{ word: 'cat', r: 0, c: 0, dir: 'h' }, { word: 'cow', r: 0, c: 0, dir: 'v' }] };
  assert.strictEqual(validateLayout(ok), null);
  const stray = { rows: 2, cols: 3, placed: [{ word: 'cat', r: 0, c: 0, dir: 'h' }, { word: 'dog', r: 1, c: 0, dir: 'h' }] };
  assert.match(validateLayout(stray), /stray|disconnected/);
  const apart = { rows: 3, cols: 3, placed: [{ word: 'cat', r: 0, c: 0, dir: 'h' }, { word: 'dog', r: 2, c: 0, dir: 'h' }] };
  assert.strictEqual(validateLayout(apart), 'disconnected');
});

test('snapshot never leaks unfound target words', () => {
  const room = makeRoom();
  join(room, 'a');
  const snap = plugin.serializeSnapshot(room, { clientId: 'a' });
  assert.strictEqual(snap.cells.length, 0);
  assert.ok(snap.slots.every((s) => s.word === undefined));
  const json = JSON.stringify(snap);
  // Match string values only — a target like "phase" can also be a JSON key in the snapshot.
  for (const w of words(room)) if (w.length >= 4) assert.ok(!new RegExp(`"${w}"(?!:)`).test(json), `leaked ${w}`);
  assert.strictEqual(snap.missedBonus, undefined);
});

test('co-op: finds fill for everyone, credited; bonus/invalid/already/short handled', () => {
  const room = makeRoom();
  join(room, 'a');
  join(room, 'b');
  const [w0, w1] = words(room);
  act(room, 'a', { kind: 'submit', word: w0.toUpperCase() });
  assert.strictEqual(lastOf(room, 'a', 'result').outcome, 'found');
  const sb = lastOf(room, 'b', 'state');
  const slot = sb.slots.find((s) => s.word === w0);
  assert.ok(slot && slot.found && slot.by === 'a');
  assert.ok(sb.cells.length >= w0.length);
  assert.strictEqual(sb.players.find((p) => p.clientId === 'a').score, w0.length);
  act(room, 'b', { kind: 'submit', word: w0 });
  assert.strictEqual(lastOf(room, 'b', 'result').outcome, 'already');
  act(room, 'b', { kind: 'submit', word: w1 });
  assert.strictEqual(lastOf(room, 'b', 'result').outcome, 'found');
  const bonus = room.state.puzzle.bonusList[0];
  if (bonus) {
    act(room, 'a', { kind: 'submit', word: bonus });
    assert.strictEqual(lastOf(room, 'a', 'result').outcome, 'bonus');
    act(room, 'a', { kind: 'submit', word: bonus });
    assert.strictEqual(lastOf(room, 'a', 'result').outcome, 'alreadyBonus');
  }
  act(room, 'a', { kind: 'submit', word: room.state.puzzle.letters.slice(0, 2) });
  assert.strictEqual(lastOf(room, 'a', 'result').outcome, 'short');
  act(room, 'a', { kind: 'submit', word: 'qqqqq' });
  assert.strictEqual(lastOf(room, 'a', 'result').outcome, 'invalid');
  for (const bad of [null, 5, {}, ['x'], 'a'.repeat(500), 'ab cd']) act(room, 'a', { kind: 'submit', word: bad });
  act(room, 'a', null);
  act(room, 'a', { kind: 42 });
  act(room, 'ghost', { kind: 'submit', word: w0 });
  // Finish the grid.
  for (const w of words(room)) act(room, 'a', { kind: 'submit', word: w });
  assert.strictEqual(room.state.phase, 'complete');
  const end = lastOf(room, 'b', 'state');
  assert.ok(end.slots.every((s) => s.word), 'all words shown when over');
  act(room, 'a', { kind: 'submit', word: w0 });
  assert.strictEqual(lastOf(room, 'a', 'result').outcome, 'closed');
  act(room, 'b', { kind: 'nextLevel' });
  assert.strictEqual(room.state.level, 2);
  assert.strictEqual(room.state.phase, 'playing');
  assert.strictEqual(lastOf(room, 'a', 'state').foundCount, 0);
  act(room, 'b', { kind: 'nextLevel' }); // only from complete
  assert.strictEqual(room.state.level, 2);
});

test('hints: reveal a letter, cost points, limited, can complete words', () => {
  const room = makeRoom();
  join(room, 'a');
  const p = room.state.players.get('a');
  p.score = 10;
  act(room, 'a', { kind: 'hint' });
  const h = lastOf(room, 'a', 'hintResult');
  assert.ok(Array.isArray(h.cell));
  assert.strictEqual(p.score, 8);
  assert.strictEqual(lastOf(room, 'a', 'state').cells.filter((c) => c[3] === 1).length, 1);
  act(room, 'a', { kind: 'hint' });
  act(room, 'a', { kind: 'hint' });
  assert.strictEqual(p.hintsLeft, 0);
  act(room, 'a', { kind: 'hint' });
  assert.strictEqual(lastOf(room, 'a', 'hintResult').cell, null);
  // Unlimited hints eventually solve the whole grid (auto-complete of fully revealed words).
  p.hintsLeft = 999;
  for (let i = 0; i < 200 && room.state.phase === 'playing'; i++) act(room, 'a', { kind: 'hint' });
  assert.strictEqual(room.state.phase, 'complete');
  assert.strictEqual(p.score, 0, 'score floors at 0');
});

test('race: private progress, countdown, first to finish wins', () => {
  const room = makeRoom();
  join(room, 'a');
  join(room, 'b');
  act(room, 'a', { kind: 'setMode', mode: 'race' });
  assert.strictEqual(room.state.mode, 'race');
  const w = words(room);
  act(room, 'a', { kind: 'submit', word: w[0] });
  assert.strictEqual(lastOf(room, 'a', 'result').outcome, 'early');
  goNow(room);
  act(room, 'a', { kind: 'submit', word: w[0] });
  assert.strictEqual(lastOf(room, 'a', 'result').outcome, 'found');
  const sb = lastOf(room, 'b', 'state');
  assert.strictEqual(sb.foundCount, 0, "b's grid is untouched");
  assert.strictEqual(sb.cells.length, 0, 'no letters leak to rival');
  assert.strictEqual(sb.players.find((p) => p.clientId === 'a').progress, 1);
  const foundEv = room.sent.filter((s) => s.id === 'b' && s.env.payload.data.kind === 'found').pop().env.payload.data;
  assert.strictEqual(foundEv.word, null);
  act(room, 'b', { kind: 'submit', word: w[0] });
  assert.strictEqual(lastOf(room, 'b', 'result').outcome, 'found', 'same word counts for b too');
  for (const x of w) act(room, 'b', { kind: 'submit', word: x });
  assert.strictEqual(room.state.phase, 'complete');
  assert.strictEqual(room.state.winnerId, 'b');
  assert.strictEqual(room.state.players.get('b').raceWins, 1);
  act(room, 'a', { kind: 'setMode', mode: 'bogus' });
  assert.strictEqual(room.state.mode, 'race');
  act(room, 'a', { kind: 'setMode', mode: 'coop' });
  assert.strictEqual(room.state.mode, 'coop');
  assert.strictEqual(room.state.phase, 'playing');
});

test('late joiner gets current co-op progress; leaving keeps game; empty room resets', () => {
  const room = makeRoom();
  join(room, 'a');
  act(room, 'a', { kind: 'submit', word: words(room)[0] });
  join(room, 'c');
  const snap = plugin.serializeSnapshot(room, { clientId: 'c' });
  assert.strictEqual(snap.foundCount >= 1, true);
  assert.ok(snap.me && snap.me.hintsLeft === 3);
  leave(room, 'a');
  assert.ok(!room.state.players.has('a'));
  assert.ok(lastOf(room, 'c', 'state').foundCount >= 1, 'progress survives a leave');
  const spect = plugin.serializeSnapshot(room, { clientId: 'nobody' });
  assert.strictEqual(spect.me, null);
  leave(room, 'c');
  assert.strictEqual(room.state.players.size, 0);
  assert.strictEqual(room.state.level, 1);
  assert.strictEqual(room.state.coop.found.size, 0);
});

test('bots at every level find words; removal and level change stop them', async () => {
  for (const lv of Object.keys(BOT_SPEED)) BOT_SPEED[lv].ms = [5, 15];
  BOT_CFG.leadMs = 0;
  BOT_CFG.countdownMs = 20;
  for (const level of ['easy', 'medium', 'hard', 'expert']) {
    const room = makeRoom();
    join(room, 'a');
    act(room, 'a', { kind: 'addBot', level });
    const bot = [...room.state.players.values()].find((p) => p.bot);
    assert.ok(bot && bot.bot === level, `bot ${level}`);
    for (let i = 0; i < 400 && room.state.phase === 'playing'; i++) await sleep(5);
    assert.strictEqual(room.state.phase, 'complete', `${level} bot completes the co-op grid`);
    assert.ok(bot.words > 0);
    for (const p of room.state.players.values()) assert.ok(!p.timer, 'no timer after complete');
    leave(room, 'a');
  }
  // Race vs two bots.
  const room = makeRoom();
  join(room, 'a');
  act(room, 'a', { kind: 'addBot', level: 'expert' });
  act(room, 'a', { kind: 'addBot', level: 'easy' });
  act(room, 'a', { kind: 'setMode', mode: 'race' });
  for (let i = 0; i < 400 && room.state.phase === 'playing'; i++) await sleep(5);
  assert.ok(room.state.winnerId && room.state.winnerId.startsWith('bot-'));
  // Removing a bot cancels its timer.
  act(room, 'a', { kind: 'nextLevel' });
  const ids = [...room.state.players.keys()].filter((id) => id.startsWith('bot-'));
  const removed = room.state.players.get(ids[0]);
  act(room, 'a', { kind: 'removeBot', clientId: ids[0] });
  assert.ok(!room.state.players.has(ids[0]) && !removed.timer);
  act(room, 'a', { kind: 'removeBot', clientId: 'a' }); // non-bot ignored
  assert.ok(room.state.players.has('a'));
  // Last human leaving drops bots and their timers.
  const other = room.state.players.get(ids[1]);
  leave(room, 'a');
  assert.strictEqual(room.state.players.size, 0);
  assert.ok(!other.timer);
  const before = room.sent.length;
  await sleep(80);
  assert.strictEqual(room.sent.length, before, 'nothing fires into an empty room');
  // Max bots.
  const r2 = makeRoom();
  join(r2, 'a');
  for (let i = 0; i < 10; i++) act(r2, 'a', { kind: 'addBot', level: 'hard' });
  assert.ok([...r2.state.players.keys()].filter((id) => id.startsWith('bot-')).length <= 6);
  leave(r2, 'a');
});

test('newPuzzle / restart', () => {
  const room = makeRoom();
  join(room, 'a');
  const pid = room.state.puzzleId;
  act(room, 'a', { kind: 'newPuzzle' });
  assert.strictEqual(room.state.puzzleId, pid + 1);
  room.state.level = 7;
  act(room, 'a', { kind: 'restart' });
  assert.strictEqual(room.state.level, 1);
  assert.strictEqual(room.state.puzzle.letters.length, 5);
});

test('client pure helpers', async () => {
  const url = require('url').pathToFileURL(path.join(__dirname, '../public/games/wordscapes/wheel.js')).href;
  const w = await import(url);
  const pos = w.wheelPositions(6, 150, 150, 90);
  assert.strictEqual(pos.length, 6);
  assert.deepStrictEqual(pos[0], { x: 150, y: 60 });
  assert.strictEqual(w.hitNode(pos, { x: 152, y: 63 }, 30), 0);
  assert.strictEqual(w.hitNode(pos, { x: 150, y: 150 }, 30), -1);
  let sel = w.applyDragNode([], 2);
  sel = w.applyDragNode(sel, 3);
  assert.deepStrictEqual(sel, [2, 3]);
  assert.strictEqual(w.applyDragNode(sel, 3), sel);
  assert.deepStrictEqual(w.applyDragNode(sel, 2), [2], 'drag back undoes');
  assert.deepStrictEqual(w.applyDragNode([1, 2, 3], 1), [1, 2, 3], 'no reuse');
  assert.strictEqual(w.keyPick('apple', [1], 'p'), 2);
  assert.strictEqual(w.keyPick('apple', [1, 2], 'p'), -1);
  assert.ok(w.fitCell(300, 12, 10, 300) >= 18 && w.fitCell(600, 4, 4, 600) === 46);
  for (let l = 1; l < 30; l++) assert.ok(w.sceneFor(l).sky);
});

(async () => {
  let failures = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (err) {
      failures++;
      console.log(`FAIL ${name}\n     ${err && err.stack}`);
    }
  }
  console.log(failures ? `\n${failures} failing` : `\nall ${tests.length} passed`);
  process.exit(failures ? 1 : 0);
})();
