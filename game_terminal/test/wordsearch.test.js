// node test/wordsearch.test.js — rules/generation/bot tests for server/games/wordsearch.js.
'use strict';

const assert = require('assert');
const path = require('path');
const plugin = require('../server/games/wordsearch');
const { generatePuzzle, findAll, THEMES, SIZES, BOT } = plugin._internals;

let failures = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const ctx = { senderId: id, sendTo: room.sendTo, broadcast: room.broadcast };
  plugin.onMessage(room, room.clients.get(id), data, ctx);
}
const lastTo = (room, id) => {
  for (let i = room.sent.length - 1; i >= 0; i--) if (room.sent[i].id === id) return room.sent[i].env.payload.data;
  return null;
};
const lastState = (room, id) => {
  for (let i = room.sent.length - 1; i >= 0; i--) {
    const d = room.sent[i].env.payload.data;
    if (room.sent[i].id === id && d.kind === 'state') return d;
  }
  return null;
};
function goNow(room) {
  room.state.startedAt = Date.now() - 1;
}
const endOf = (w) => ({ r2: w.r + w.dr * (w.word.length - 1), c2: w.c + w.dc * (w.word.length - 1) });

test('every theme × size generates a valid puzzle with each word exactly once', () => {
  for (const theme of [...Object.keys(THEMES), 'random']) {
    for (const size of Object.keys(SIZES).map(Number)) {
      for (let k = 0; k < 8; k++) {
        const p = generatePuzzle(theme, size);
        assert.strictEqual(p.grid.length, size);
        assert.ok(p.grid.every((row) => row.length === size && /^[a-z]+$/.test(row)));
        assert.strictEqual(p.placed.length, SIZES[size].words, `${theme} ${size} word count`);
        const grid = p.grid.map((r) => r.split(''));
        for (const w of p.placed) {
          assert.strictEqual(findAll(grid, w.word).length, 1, `${w.word} appears once`);
          for (const o of p.placed) if (o !== w) assert.ok(!o.word.includes(w.word), `${w.word} inside ${o.word}`);
        }
      }
    }
  }
});

test('start hides unfound positions; claims validated', () => {
  const room = makeRoom();
  join(room, 'a');
  join(room, 'b');
  act(room, 'a', { kind: 'start', size: 10, theme: 'animals' });
  const st = room.state;
  assert.strictEqual(st.phase, 'playing');
  assert.strictEqual(st.size, 10);
  let view = lastState(room, 'b');
  assert.ok(view.words.every((w) => w.pos === null), 'positions hidden');
  const w = st.words[0];
  // Too early (countdown).
  act(room, 'a', { kind: 'claim', r1: w.r, c1: w.c, ...endOf(w) });
  assert.strictEqual(lastTo(room, 'a').kind, 'miss');
  assert.ok(!w.foundBy);
  goNow(room);
  // Garbage input is ignored.
  act(room, 'a', { kind: 'claim', r1: 'x', c1: 0, r2: 0, c2: 0 });
  act(room, 'a', { kind: 'claim', r1: -1, c1: 0, r2: 0, c2: 99 });
  act(room, 'a', { kind: 'claim', r1: 0, c1: 0, r2: 1, c2: 2 }); // not a straight line
  assert.strictEqual(lastTo(room, 'a').reason, 'not_a_line');
  assert.ok(st.words.every((x) => !x.foundBy));
  // Backwards drag counts.
  const { r2, c2 } = endOf(w);
  act(room, 'b', { kind: 'claim', r1: r2, c1: c2, r2: w.r, c2: w.c });
  assert.strictEqual(w.foundBy, 'b');
  assert.strictEqual(st.players.get('b').score, w.points);
  view = lastState(room, 'a');
  assert.ok(view.words.find((x) => x.word === w.word).pos, 'claimed word position public');
  assert.ok(view.words.filter((x) => !x.foundBy).every((x) => x.pos === null));
  // Taken.
  act(room, 'a', { kind: 'claim', r1: w.r, c1: w.c, r2, c2 });
  assert.strictEqual(lastTo(room, 'a').reason, 'taken');
  assert.strictEqual(st.players.get('a').score, 0);
  // Right letters' length but wrong spot → miss.
  act(room, 'a', { kind: 'claim', r1: 0, c1: 0, r2: 0, c2: 1 });
  assert.strictEqual(lastTo(room, 'a').kind, 'miss');
  // Can't restart mid-round.
  const rid = st.roundId;
  act(room, 'a', { kind: 'start', size: 15 });
  assert.strictEqual(st.roundId, rid);
  // Claim the rest: round ends, wins awarded to the leader.
  for (const x of st.words) if (!x.foundBy) act(room, 'a', { kind: 'claim', r1: x.r, c1: x.c, ...endOf(x) });
  assert.strictEqual(st.phase, 'results');
  assert.strictEqual(st.endReason, 'all_found');
  assert.strictEqual(st.players.get('a').wins, 1);
  assert.strictEqual(st.players.get('b').wins, 0);
  view = lastState(room, 'b');
  assert.ok(view.words.every((x) => x.pos), 'all positions public at results');
  // Rematch resets scores, keeps wins.
  act(room, 'b', { kind: 'start', size: 15, theme: 'nope' });
  assert.strictEqual(st.phase, 'playing');
  assert.strictEqual(st.size, 15);
  assert.strictEqual(st.themeChoice, 'surprise');
  assert.strictEqual(st.players.get('a').score, 0);
  assert.strictEqual(st.players.get('a').wins, 1);
  leave(room, 'a');
  leave(room, 'b');
  assert.strictEqual(st.roundTimer, null);
});

test('points grow with word length', () => {
  assert.ok(plugin._internals.pointsFor('tiger') < plugin._internals.pointsFor('elephant'));
});

test('late joiner sees current claims and can play', () => {
  const room = makeRoom();
  join(room, 'a');
  act(room, 'a', { kind: 'start', size: 12, theme: 'food' });
  goNow(room);
  const w = room.state.words[1];
  act(room, 'a', { kind: 'claim', r1: w.r, c1: w.c, ...endOf(w) });
  join(room, 'c');
  const snap = plugin.serializeSnapshot(room);
  assert.strictEqual(snap.words.find((x) => x.word === w.word).foundBy, 'a');
  const w2 = room.state.words[2];
  act(room, 'c', { kind: 'claim', r1: w2.r, c1: w2.c, ...endOf(w2) });
  assert.strictEqual(w2.foundBy, 'c');
  leave(room, 'a');
  leave(room, 'c');
});

test('bots at every level find words; faster levels find more; cleaned up on leave', async () => {
  const saved = Object.fromEntries(Object.entries(BOT).map(([k, v]) => [k, v.base]));
  // Scale delays down so the test is quick (same relative ordering as the real values).
  for (const k of Object.keys(BOT)) BOT[k].base = saved[k] / 300;
  try {
    const room = makeRoom();
    join(room, 'a');
    act(room, 'a', { kind: 'addBot', level: 'easy' });
    act(room, 'a', { kind: 'start', size: 15, theme: 'random' });
    goNow(room);
    const st = room.state;
    // Bots added mid-round are scheduled straight away (no countdown left).
    act(room, 'a', { kind: 'removeBot', clientId: [...st.players.keys()].find((id) => id.startsWith('bot-')) });
    for (const level of ['easy', 'medium', 'hard', 'expert']) act(room, 'a', { kind: 'addBot', level });
    assert.strictEqual([...st.players.values()].filter((p) => p.bot).length, 4);
    await sleep(1200);
    const bots = [...st.players.values()].filter((p) => p.bot);
    const byLevel = Object.fromEntries(bots.map((p) => [p.bot, p.found]));
    const total = bots.reduce((s, p) => s + p.found, 0);
    assert.ok(total > 0, 'bots found something');
    assert.ok(byLevel.expert >= byLevel.easy, `expert ${byLevel.expert} >= easy ${byLevel.easy}`);
    assert.ok(st.words.filter((w) => w.foundBy).every((w) => w.foundBy === 'a' || st.players.has(w.foundBy)));
    // Last human leaves: bots dropped, timers cleared, nothing fires afterwards.
    leave(room, 'a');
    assert.strictEqual(st.players.size, 0);
    assert.strictEqual(st.roundTimer, null);
    const before = room.sent.length;
    await sleep(300);
    assert.strictEqual(room.sent.length, before, 'no messages after room emptied');
  } finally {
    for (const k of Object.keys(BOT)) BOT[k].base = saved[k];
  }
});

test('time running out ends the round', async () => {
  const room = makeRoom();
  join(room, 'a');
  const st = room.state;
  const realTime = SIZES[10].timeMs;
  SIZES[10].timeMs = 50;
  try {
    act(room, 'a', { kind: 'start', size: 10, theme: 'space' });
    assert.strictEqual(st.phase, 'playing');
    await sleep(3000 + 200);
    assert.strictEqual(st.phase, 'results');
    assert.strictEqual(st.endReason, 'time');
    assert.strictEqual(st.players.get('a').wins, 0, 'no win for a zero score');
  } finally {
    SIZES[10].timeMs = realTime;
    leave(room, 'a');
  }
});

test('client helpers: snapSelection snaps to 8 directions and clamps', async () => {
  // Minimal browser globals so the module (and the shared sfx helper) can load in Node.
  if (typeof globalThis.window === 'undefined') {
    globalThis.window = globalThis;
    globalThis.localStorage = { getItem: () => null, setItem: () => {} };
    globalThis.addEventListener = () => {};
    globalThis.removeEventListener = () => {};
  }
  const mod = await import(path.join(__dirname, '..', 'public', 'games', 'wordsearch', 'client.js')).catch((e) => { console.log('   import error:', e.message); return null; });
  if (!mod) { console.log('   (client import needs a DOM — skipped)'); return; }
  const { snapSelection, lettersOf } = mod;
  assert.deepStrictEqual(snapSelection(5, 5, 5.1, 9.2, 10), { r1: 5, c1: 5, r2: 5, c2: 9 });
  assert.deepStrictEqual(snapSelection(5, 5, 7.8, 8.2, 10), { r1: 5, c1: 5, r2: 8, c2: 8 });
  assert.deepStrictEqual(snapSelection(5, 5, 1.1, 5.3, 10), { r1: 5, c1: 5, r2: 1, c2: 5 });
  assert.deepStrictEqual(snapSelection(2, 2, -5, -5, 10), { r1: 2, c1: 2, r2: 0, c2: 0 });
  assert.deepStrictEqual(snapSelection(5, 5, 5.2, 5.1, 10), { r1: 5, c1: 5, r2: 5, c2: 5 });
  assert.strictEqual(lettersOf(['abc', 'def', 'ghi'], { r1: 2, c1: 2, r2: 0, c2: 0 }), 'iea');
});

(async () => {
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`ok   ${t.name}`);
    } catch (err) {
      failures++;
      console.log(`FAIL ${t.name}\n     ${err && err.stack}`);
    }
  }
  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
