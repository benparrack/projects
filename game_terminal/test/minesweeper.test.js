// Minesweeper race: layout + safe opening, flood/chord/flag, validation, hidden info, freeze,
// race win, bot solver (never stalls, levels get better).
// Run: node test/minesweeper.test.js
'use strict';

const assert = require('assert');
const plugin = require('../server/games/minesweeper');
const S = require('../server/games/ai/minesweeperSolver');

const { SIZES, FREEZE_MS, makeLayout, clickCell, cellsFor } = plugin._internals;
let failures = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function makeRoom() {
  const sent = [];
  const room = {
    state: plugin.createInitialState(),
    clients: new Map([['A', {}], ['B', {}], ['C', {}]]),
    broadcast: (m) => sent.push({ to: '*', m }),
    sendTo: (id, m) => sent.push({ to: id, m }),
  };
  room.sent = sent;
  return room;
}
const ctxFor = (room, id) => ({ senderId: id, broadcast: room.broadcast, sendTo: room.sendTo });
const act = (room, id, data) => plugin.onMessage(room, { clientId: id }, data, ctxFor(room, id));
const stateFor = (room, id) => [...room.sent].reverse().find((s) => s.to === id && s.m.payload.data.kind === 'state').m.payload.data;
const lastReject = (room, id) => {
  const s = [...room.sent].reverse().find((x) => x.to === id && x.m.payload.data.kind === 'moveRejected');
  return s && s.m.payload.data.reason;
};
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
const seated = () => {
  const room = makeRoom();
  act(room, 'A', { kind: 'sit', seat: 'p1' });
  act(room, 'B', { kind: 'sit', seat: 'p2' });
  return room;
};

// Solves a whole layout with the bot brain; returns { steps, hits }.
function solveOut(size, level) {
  const st = { layout: makeLayout(size), boards: {} };
  const L = st.layout;
  const b = { cell: new Array(L.cols * L.rows).fill(0), opened: 0, hits: 0, frozenUntil: 0 };
  st.boards.p1 = b;
  clickCell(st, 'p1', L.start, 0);
  let steps = 0;
  while (b.opened < L.cols * L.rows - L.mines) {
    const i = S.pickMove({ cols: L.cols, rows: L.rows, mines: L.mines, cell: cellsFor(st, b, false) }, level);
    assert.ok(i != null, 'bot stalled with safe cells left');
    clickCell(st, 'p1', i, 0);
    assert.ok(++steps < 2000, 'bot looping');
  }
  return { steps, hits: b.hits };
}

test('layouts: right mine count, numbers match, opening is an empty cell', () => {
  for (const size of Object.keys(SIZES)) {
    for (let n = 0; n < 30; n++) {
      const L = makeLayout(size);
      assert.strictEqual(L.mine.filter(Boolean).length, SIZES[size].mines);
      assert.strictEqual(L.num[L.start], 0);
      assert.ok(!L.mine[L.start]);
      for (let i = 0; i < L.mine.length; i++) {
        if (!L.mine[i]) assert.strictEqual(L.num[i], S.neighbors(L.cols, L.rows, i).filter((j) => L.mine[j]).length);
      }
    }
  }
});

test('seating starts a game with the same opening on both boards, no mines leaked', () => {
  const room = seated();
  const a = stateFor(room, 'A');
  assert.strictEqual(a.phase, 'playing');
  assert.ok(a.boards.p1 && !a.boards.p2, 'player sees only their own board');
  assert.ok(a.progress.p2.opened > 0 && a.progress.p1.opened === a.progress.p2.opened);
  assert.ok(!a.boards.p1.some((v) => v <= -3), 'no mine codes before game over');
  const c = stateFor(room, 'C');
  assert.ok(c.boards.p1 && c.boards.p2, 'spectator sees both');
  assert.deepStrictEqual(c.boards.p1, c.boards.p2);
  assert.ok(!JSON.stringify(room.sent).includes('"mine"'), 'raw layout never sent');
});

test('size is a pregame option anyone can pick before sitting', () => {
  const room = makeRoom();
  act(room, 'C', { kind: 'setSize', size: 'small' });
  assert.strictEqual(room.state.size, 'small');
  act(room, 'A', { kind: 'sit', seat: 'p1' });
  act(room, 'B', { kind: 'sit', seat: 'p2' });
  assert.strictEqual(room.state.phase, 'playing');
  act(room, 'C', { kind: 'setSize', size: 'large' });
  assert.strictEqual(room.state.size, 'small', 'spectators cannot resize a running race');
});

test('garbage input is rejected without throwing', () => {
  const room = seated();
  for (const i of [-1, 1e9, 1.5, '3', null, undefined, {}, NaN]) {
    act(room, 'A', { kind: 'reveal', i });
    assert.strictEqual(lastReject(room, 'A'), 'invalid');
  }
  act(room, 'C', { kind: 'reveal', i: 0 });
  assert.strictEqual(lastReject(room, 'C'), 'not_seated');
  act(room, 'A', { kind: 'setSize', size: '__proto__' });
  act(room, 'A', { kind: 'setSize', size: 'toString' });
  assert.strictEqual(room.state.size, 'medium');
  act(room, 'A', { kind: 'setSize', size: 'small' });
  assert.strictEqual(lastReject(room, 'A'), 'in_progress', 'no mid-game resize vs a human');
  plugin.onMessage(room, { clientId: 'A' }, null, ctxFor(room, 'A'));
  act(room, 'A', { kind: 42 });
});

test('flag toggles, mine freezes, chord opens around a satisfied number', () => {
  const room = seated();
  const st = room.state;
  const L = st.layout;
  const mineAt = L.mine.indexOf(true);
  act(room, 'A', { kind: 'flag', i: mineAt });
  assert.strictEqual(stateFor(room, 'A').boards.p1[mineAt], -2);
  act(room, 'A', { kind: 'flag', i: mineAt });
  assert.strictEqual(stateFor(room, 'A').boards.p1[mineAt], -1);
  act(room, 'A', { kind: 'reveal', i: mineAt });
  const v = stateFor(room, 'A');
  assert.strictEqual(v.boards.p1[mineAt], -3);
  assert.strictEqual(v.progress.p1.hits, 1);
  assert.ok(v.progress.p1.frozenMs > FREEZE_MS - 500);
  assert.strictEqual(v.phase, 'playing', 'a mine does not end the race');
  act(room, 'A', { kind: 'reveal', i: L.start });
  assert.strictEqual(lastReject(room, 'A'), 'frozen');
  // Chord: B flags every mine next to some numbered opened cell, then clicks the number.
  const b = st.boards.p2;
  const num = b.cell.findIndex((c, i) => c === 1 && L.num[i] > 0 && S.neighbors(L.cols, L.rows, i).some((j) => b.cell[j] === 0 && !L.mine[j]));
  if (num >= 0) {
    for (const j of S.neighbors(L.cols, L.rows, num)) if (L.mine[j]) act(room, 'B', { kind: 'flag', i: j });
    const before = b.opened;
    act(room, 'B', { kind: 'reveal', i: num });
    assert.ok(b.opened > before, 'chord opened neighbours');
    assert.strictEqual(b.hits, 0);
  }
});

test('first to clear wins; boards and mines are revealed to all at game over', () => {
  const room = seated();
  const L = room.state.layout;
  for (let i = 0; i < L.mine.length; i++) if (!L.mine[i] && room.state.phase === 'playing') act(room, 'B', { kind: 'reveal', i });
  const v = stateFor(room, 'A');
  assert.strictEqual(v.phase, 'game_over');
  assert.strictEqual(v.winner, 'p2');
  assert.strictEqual(v.score.p2, 1);
  assert.ok(v.boards.p2 && v.boards.p1.includes(-4));
  act(room, 'A', { kind: 'reveal', i: 0 });
  assert.strictEqual(lastReject(room, 'A'), 'not_playing');
  act(room, 'A', { kind: 'setSize', size: 'small' });
  const n = stateFor(room, 'A');
  assert.strictEqual(n.phase, 'playing');
  assert.strictEqual(n.cols * n.rows, 81);
});

test('solver deduces safe cells from a known pattern', () => {
  // 1 at top-left of a 3x1 strip "1 ? ?" opened only at 0 with mines=1 -> cell 1 is the mine.
  const { safe, mines } = S.deduce({ cols: 3, rows: 1, cell: [1, -1, 0] }, true);
  assert.ok(mines.has(1));
  assert.strictEqual(safe.size, 0);
  // 1-2-1 style subset: row [1,1] over hidden row -> third hidden is safe.
  const r = S.deduce({ cols: 3, rows: 2, cell: [1, 1, 0, -1, -1, -1] }, true);
  assert.ok(r.safe.has(5) || r.mines.size > 0);
});

test('bots always finish; higher levels hit fewer mines', () => {
  const avg = (level) => {
    let hits = 0;
    for (let n = 0; n < 25; n++) hits += solveOut('medium', level).hits;
    return hits / 25;
  };
  const easy = avg('easy');
  const hard = avg('hard');
  const expert = avg('expert');
  assert.ok(expert <= easy && hard < easy, `hits easy ${easy} hard ${hard} expert ${expert}`);
  solveOut('large', 'expert');
  solveOut('small', 'easy');
});

test('bot opponent races on its own timers and wins if the human idles', async () => {
  const room = makeRoom();
  act(room, 'A', { kind: 'sit', seat: 'p1' });
  act(room, 'A', { kind: 'sit', seat: 'p2', bot: true, level: 'expert' });
  act(room, 'B', { kind: 'sit', seat: 'p2' }); // occupied: ignored
  assert.strictEqual(room.state.players.p2, 'BOT');
  act(room, 'A', { kind: 'setSize', size: 'small' }); // vs a bot: allowed mid-game, restarts
  assert.strictEqual(room.state.layout.cols, 9);
  for (let t = 0; t < 120 && room.state.phase === 'playing'; t++) await wait(250);
  assert.strictEqual(room.state.phase, 'game_over', 'bot cleared the small board');
  assert.strictEqual(room.state.winner, 'p2');
});

(async () => {
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok - ${name}`);
    } catch (e) {
      failures++;
      console.log(`FAIL - ${name}\n  ${e.stack}`);
    }
  }
  console.log(failures ? `${failures} failing` : 'all passing');
  process.exit(failures ? 1 : 0);
})();
