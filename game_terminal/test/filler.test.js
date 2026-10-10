// Filler: board generation, flood rules, protocol validation, seats/bots/rematch, engine strength.
// Run: node test/filler.test.js
'use strict';

const assert = require('assert');
const plugin = require('../server/games/filler');
const E = require('../server/games/ai/fillerEngine');

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
const lastState = (room) => [...room.sent].reverse().find((s) => s.m.payload.data.kind === 'state').m.payload.data;
const lastReject = (room, id) => {
  const s = [...room.sent].reverse().find((x) => x.to === id && x.m.payload.data.kind === 'moveRejected');
  return s && s.m.payload.data.reason;
};
const wait = (ms) => new Promise((res) => setTimeout(res, ms));

// Plays a full engine-vs-engine game; returns the winner (1, 2 or 0).
function playOut(level1, level2, first = 1) {
  const colors = E.randomBoard();
  const owner = E.initialOwner();
  let p = first;
  let moves = 0;
  while (!E.isOver(owner, moves)) {
    const { color } = E.bestMove({ colors, owner, player: p, level: p === 1 ? level1 : level2, timeMs: 60 });
    assert.ok(E.legalColors(colors, p).includes(color), 'engine picked an illegal colour');
    E.applyColor(colors, owner, p, color);
    moves++;
    p = E.other(p);
  }
  return E.winnerOf(owner);
}

test('random boards: no equal orthogonal neighbours, distinct start corners, single-cell regions', () => {
  for (let n = 0; n < 200; n++) {
    const b = E.randomBoard();
    assert.strictEqual(b.length, E.CELLS);
    for (let i = 0; i < E.CELLS; i++) {
      assert.ok(b[i] >= 0 && b[i] < E.NCOLORS);
      for (const j of E.NEIGHBORS[i]) assert.notStrictEqual(b[i], b[j]);
    }
    assert.notStrictEqual(b[E.START[1]], b[E.START[2]]);
  }
  const o = E.initialOwner();
  assert.deepStrictEqual(E.counts(o), { 1: 1, 2: 1 });
});

test('legal colours exclude both current colours (always 4 options)', () => {
  const b = E.randomBoard();
  for (const p of [1, 2]) {
    const legal = E.legalColors(b, p);
    assert.strictEqual(legal.length, 4);
    assert.ok(!legal.includes(b[E.START[1]]) && !legal.includes(b[E.START[2]]));
  }
});

test('flood absorbs chains of the picked colour, recolours the region, reports wave distance', () => {
  // Bottom-left start; build a snake of colour 3 going up column 0 then right along row 3.
  const colors = new Array(E.CELLS).fill(0).map((_, i) => (i % 2 ? 1 : 2));
  const at = (r, c) => r * E.COLS + c;
  colors[at(6, 0)] = 4; // P1 start
  colors[at(0, 7)] = 5; // P2 start
  for (const [r, c] of [[5, 0], [4, 0], [3, 0], [3, 1], [3, 2]]) colors[at(r, c)] = 3;
  const owner = E.initialOwner();
  const gained = E.applyColor(colors, owner, 1, 3);
  assert.deepStrictEqual(gained.map((g) => g.i).sort((a, b) => a - b), [at(3, 0), at(3, 1), at(3, 2), at(4, 0), at(5, 0)].sort((a, b) => a - b));
  assert.strictEqual(gained.find((g) => g.i === at(3, 2)).d, 5);
  assert.strictEqual(colors[at(6, 0)], 3);
  assert.strictEqual(E.counts(owner)[1], 6);
  // Opponent's cells are never taken even if they match.
  const owner2 = E.initialOwner();
  const c2 = colors.slice();
  c2[at(5, 0)] = 5;
  E.applyColor(c2, owner2, 1, 5);
  assert.strictEqual(owner2[at(0, 7)], 2);
});

test('game ends past half the board; winner by count', () => {
  const owner = new Array(E.CELLS).fill(0);
  for (let i = 0; i < E.HALF; i++) owner[i] = 1;
  assert.ok(!E.isOver(owner, 0));
  owner[E.HALF] = 1;
  assert.ok(E.isOver(owner, 0));
  assert.strictEqual(E.winnerOf(owner), 1);
  const tie = new Array(E.CELLS).fill(1).map((_, i) => (i < E.HALF ? 1 : 2));
  assert.ok(E.isOver(tie, 0));
  assert.strictEqual(E.winnerOf(tie), 0);
});

test('protocol: seats, turn order, validation, spectators', () => {
  const room = makeRoom();
  act(room, 'A', { kind: 'move', color: 0 });
  assert.strictEqual(lastReject(room, 'A'), 'not_playing');
  act(room, 'A', { kind: 'sit', seat: 'p1' });
  act(room, 'A', { kind: 'sit', seat: 'p2' }); // can't take both seats
  assert.strictEqual(room.state.players.p2, null);
  act(room, 'B', { kind: 'sit', seat: 'nope' });
  act(room, 'B', { kind: 'sit', seat: 'p2' });
  let s = lastState(room);
  assert.strictEqual(s.phase, 'playing');
  assert.strictEqual(s.turn, 'p1');
  act(room, 'B', { kind: 'move', color: 0 });
  assert.strictEqual(lastReject(room, 'B'), 'not_your_turn');
  act(room, 'C', { kind: 'move', color: 0 });
  assert.strictEqual(lastReject(room, 'C'), 'not_seated');
  for (const bad of [-1, 6, 1.5, '2', null]) {
    act(room, 'A', { kind: 'move', color: bad });
    assert.strictEqual(lastReject(room, 'A'), 'invalid');
  }
  act(room, 'A', { kind: 'move', color: s.current.p2 });
  assert.strictEqual(lastReject(room, 'A'), 'color_taken');
  act(room, 'A', { kind: 'move', color: s.current.p1 });
  assert.strictEqual(lastReject(room, 'A'), 'color_taken');
  const legal = E.legalColors(room.state.colors, 1);
  act(room, 'A', { kind: 'move', color: legal[0] });
  s = lastState(room);
  assert.strictEqual(s.turn, 'p2');
  assert.strictEqual(s.current.p1, legal[0]);
  assert.strictEqual(s.lastMove.seat, 'p1');
  assert.strictEqual(s.counts.p1, 1 + s.lastMove.gained.length);
  // garbage messages never throw
  for (const junk of [null, {}, { kind: 5 }, { kind: 'sit' }, { kind: 'move' }, { kind: 'setBotLevel', seat: 'p1' }]) act(room, 'C', junk);
});

test('full human game reaches game_over; rematch swaps first mover; leaving resets', () => {
  const room = makeRoom();
  act(room, 'A', { kind: 'sit', seat: 'p1' });
  act(room, 'B', { kind: 'sit', seat: 'p2' });
  let guard = 0;
  while (room.state.phase === 'playing' && guard++ < 400) {
    const seat = room.state.turn;
    const id = seat === 'p1' ? 'A' : 'B';
    const p = seat === 'p1' ? 1 : 2;
    const gains = E.legalColors(room.state.colors, p).map((c) => [c, E.gainFor(room.state.colors, room.state.owner, p, c)]);
    gains.sort((a, b) => b[1] - a[1]);
    act(room, id, { kind: 'move', color: gains[0][0] });
  }
  const s = lastState(room);
  assert.strictEqual(s.phase, 'game_over');
  assert.ok(['p1', 'p2', 'draw'].includes(s.winner));
  assert.strictEqual(s.score.p1 + s.score.p2 + s.score.draws, 1);
  act(room, 'C', { kind: 'resetGame' }); // spectator can't
  assert.strictEqual(room.state.phase, 'game_over');
  act(room, 'A', { kind: 'resetGame' });
  assert.strictEqual(room.state.phase, 'playing');
  assert.strictEqual(room.state.turn, 'p2');
  assert.deepStrictEqual(E.counts(room.state.owner), { 1: 1, 2: 1 });
  plugin.onLeave(room, { clientId: 'B' });
  assert.strictEqual(room.state.phase, 'waiting');
  assert.strictEqual(room.state.players.p2, null);
  assert.deepStrictEqual(room.state.score, { p1: 0, p2: 0, draws: 0 });
});

test('bot vs bot via the plugin plays to completion; removing a bot mid-think is harmless', async () => {
  const room = makeRoom();
  act(room, 'A', { kind: 'sit', seat: 'p1', bot: true, level: 'expert' });
  act(room, 'A', { kind: 'sit', seat: 'p2', bot: true, level: 'easy' });
  assert.strictEqual(room.state.botLevels.p1, 'expert');
  assert.strictEqual(room.state.phase, 'playing');
  // Speed the clock up: run timers fast by polling.
  const deadline = Date.now() + 60000;
  while (room.state.phase === 'playing' && Date.now() < deadline) await wait(50);
  assert.strictEqual(room.state.phase, 'game_over');
  // Mid-think removal.
  const r2 = makeRoom();
  act(r2, 'A', { kind: 'sit', seat: 'p1' });
  act(r2, 'B', { kind: 'sit', seat: 'p2', bot: true });
  const legal = E.legalColors(r2.state.colors, 1);
  act(r2, 'A', { kind: 'move', color: legal[0] });
  act(r2, 'A', { kind: 'removeBot', seat: 'p2' });
  await wait(1800);
  assert.strictEqual(r2.state.phase, 'waiting');
  assert.strictEqual(r2.state.moveCount, 0);
});

test('engine: every level returns a legal colour quickly', () => {
  for (const level of ['easy', 'medium', 'hard', 'expert']) {
    const colors = E.randomBoard();
    const owner = E.initialOwner();
    const t = Date.now();
    const { color } = E.bestMove({ colors, owner, player: 1, level });
    assert.ok(E.legalColors(colors, 1).includes(color));
    assert.ok(Date.now() - t < 1500, `${level} too slow`);
  }
});

test('engine strength ladder: stronger levels beat weaker ones', () => {
  const match = (a, b, games) => {
    let w = 0;
    let l = 0;
    for (let g = 0; g < games; g++) {
      const first = g % 2 ? 1 : 2;
      const r = playOut(a, b, first);
      if (r === 1) w++;
      else if (r === 2) l++;
    }
    return { w, l };
  };
  const mediumVsEasy = match('medium', 'easy', 30);
  const hardVsMedium = match('hard', 'medium', 30);
  const expertVsMedium = match('expert', 'medium', 20);
  console.log('    strength:', JSON.stringify({ mediumVsEasy, hardVsMedium, expertVsMedium }));
  assert.ok(mediumVsEasy.w >= 22, 'medium should beat easy');
  assert.ok(hardVsMedium.w >= 18, 'hard should beat medium');
  assert.ok(expertVsMedium.w >= 15, 'expert should beat medium');
});

(async () => {
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok - ${name}`);
    } catch (err) {
      failures++;
      console.log(`FAIL - ${name}\n     ${err.stack.split('\n').slice(0, 4).join('\n     ')}`);
    }
  }
  console.log(failures ? `\n${failures} failing` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
