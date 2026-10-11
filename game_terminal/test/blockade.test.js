// Blockade: rules (moves, walls, path rule), protocol validation, seats/bots, bot strength.
// Run: node test/blockade.test.js
'use strict';

const assert = require('assert');
const plugin = require('../server/games/blockade');
const E = require('../server/games/ai/blockadeEngine');

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
const lastReject = (room, id) => {
  const s = [...room.sent].reverse().find((x) => x.to === id && x.m.payload.data.kind === 'moveRejected');
  return s && s.m.payload.data.reason;
};
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
const at = (r, c) => r * E.COLS + c;
const seated = () => {
  const room = makeRoom();
  act(room, 'A', { kind: 'sit', seat: 'p1' });
  act(room, 'B', { kind: 'sit', seat: 'p2' });
  return room;
};

// Full bot-vs-bot game in-process; returns winner seat.
function playOut(l1, l2, first = 'p1') {
  const g = { pawns: { p1: E.START.p1.slice(), p2: E.START.p2.slice() }, walls: E.emptyWalls(), left: { p1: { h: 9, v: 9 }, p2: { h: 9, v: 9 } } };
  let seat = first;
  for (let t = 0; t < 400; t++) {
    const { move, wall } = E.bestTurn(g, seat, seat === 'p1' ? l1 : l2);
    assert.ok(move, 'bot found no move');
    assert.ok(E.pawnTargets(g.walls, g.pawns, seat, move.pawn).includes(move.to), 'illegal bot move');
    g.pawns[seat][move.pawn] = move.to;
    if (E.isGoal(seat, move.to)) return seat;
    if (wall) {
      assert.ok(g.left[seat][wall.o] > 0 && E.wallLegal(g.walls, g.pawns, wall.o, wall.r, wall.c), 'illegal bot wall');
      g.walls = E.withWall(g.walls, wall.o, wall.r, wall.c);
      g.left[seat][wall.o]--;
    }
    seat = E.other(seat);
  }
  throw new Error('game did not end');
}

test('pawn moves: 1-2 orthogonal steps, walls block, pawns block landing', () => {
  const W = E.emptyWalls();
  const pawns = { p1: [at(10, 3), at(10, 7)], p2: [at(3, 3), at(3, 7)] };
  const t = E.pawnTargets(W, pawns, 'p1', 0);
  assert.strictEqual(t.length, 12); // 4 one-steps + 4 straight two-steps + 4 L-turns
  assert.ok(t.includes(at(8, 3)) && t.includes(at(9, 4)) && !t.includes(at(10, 3)));
  const W2 = E.withWall(W, 'h', 9, 2); // wall above (10,2)-(10,3)
  assert.ok(!E.pawnTargets(W2, pawns, 'p1', 0).includes(at(9, 3)));
  pawns.p1[1] = at(10, 4);
  assert.ok(!E.pawnTargets(W, pawns, 'p1', 0).includes(at(10, 4)), 'cannot land on a pawn');
  assert.ok(E.pawnTargets(W, pawns, 'p1', 0).includes(at(10, 5)), 'can pass over one');
});

test('walls: no overlap/cross, may not seal a pawn off', () => {
  let W = E.emptyWalls();
  W = E.withWall(W, 'h', 5, 5);
  assert.ok(!E.wallFits(W, 'h', 5, 5) && !E.wallFits(W, 'h', 5, 4) && !E.wallFits(W, 'h', 5, 6));
  assert.ok(!E.wallFits(W, 'v', 5, 5), 'crossing');
  assert.ok(E.wallFits(W, 'h', 5, 7) && E.wallFits(W, 'v', 4, 5));
  assert.ok(!E.wallFits(W, 'h', -1, 0) && !E.wallFits(W, 'h', 0, E.WC) && !E.wallFits(W, 'x', 1, 1) && !E.wallFits(W, 'h', 1.5, 1));
  // Box the corner pawn at (0,0) except one exit, then the last wall must be refused.
  const pawns = { p1: [at(0, 0), at(10, 7)], p2: [at(3, 3), at(3, 7)] };
  let B = E.withWall(E.emptyWalls(), 'v', 0, 0); // right side of (0,0),(1,0)
  B = E.withWall(B, 'h', 1, 0); // below (1,0),(1,1)
  assert.ok(E.mapsIfOpen(B, pawns) === null, 'sanity: that box is sealed');
  assert.ok(!E.wallLegal(E.withWall(E.emptyWalls(), 'v', 0, 0), pawns, 'h', 1, 0), 'sealing wall refused');
});

test('protocol: turn order, move-then-wall, garbage rejected', () => {
  const room = seated();
  const st = room.state;
  assert.strictEqual(st.phase, 'playing');
  act(room, 'B', { kind: 'move', pawn: 0, to: at(4, 3) });
  assert.strictEqual(lastReject(room, 'B'), 'not_your_turn');
  act(room, 'A', { kind: 'wall', o: 'h', r: 0, c: 0 });
  assert.strictEqual(lastReject(room, 'A'), 'move_first');
  for (const bad of [{ pawn: 2, to: at(9, 3) }, { pawn: 0, to: at(5, 3) }, { pawn: '0', to: at(9, 3) }, { pawn: 0, to: 'x' }, { pawn: 0 }]) {
    act(room, 'A', { kind: 'move', ...bad });
    assert.strictEqual(lastReject(room, 'A'), 'bad_move');
  }
  act(room, 'A', { kind: 'move', pawn: 0, to: at(8, 3) });
  assert.strictEqual(st.step, 'wall');
  act(room, 'A', { kind: 'move', pawn: 0, to: at(7, 3) });
  assert.strictEqual(lastReject(room, 'A'), 'place_wall');
  for (const bad of [{ o: 'd', r: 1, c: 1 }, { o: 'h', r: 99, c: 0 }, { o: 'h', r: null, c: 0 }, {}]) {
    act(room, 'A', { kind: 'wall', ...bad });
    assert.strictEqual(lastReject(room, 'A'), 'bad_wall');
  }
  act(room, 'A', { kind: 'wall', o: 'h', r: 3, c: 3 });
  assert.strictEqual(st.turn, 'p2');
  assert.strictEqual(st.left.p1.h, 8);
  assert.strictEqual(st.wallOwner.h33, 'p1');
  act(room, 'C', { kind: 'move', pawn: 0, to: 0 });
  assert.strictEqual(lastReject(room, 'C'), 'not_seated');
  plugin.onMessage(room, { clientId: 'A' }, null, ctxFor(room, 'A'));
});

test('reaching an opponent home square wins, even if occupied', () => {
  const room = seated();
  const st = room.state;
  st.pawns.p1[0] = at(4, 3); // next to p2's home (3,3), which a p2 pawn sits on
  act(room, 'A', { kind: 'move', pawn: 0, to: at(3, 3) });
  assert.strictEqual(st.phase, 'game_over');
  assert.strictEqual(st.winner, 'p1');
  assert.strictEqual(st.score.p1, 1);
  act(room, 'B', { kind: 'resetGame' });
  assert.strictEqual(st.phase, 'playing');
  assert.strictEqual(st.turn, 'p2', 'first move alternates');
});

test('bots: legal full games at every level; stronger levels win more', () => {
  for (const l of ['easy', 'medium', 'hard', 'expert']) playOut(l, l);
  const series = (a, b, n) => {
    let w = 0;
    for (let i = 0; i < n; i++) if (playOut(a, b, i % 2 ? 'p2' : 'p1') === 'p1') w++;
    return w;
  };
  const hardVsEasy = series('hard', 'easy', 10);
  assert.ok(hardVsEasy >= 8, `hard beat easy ${hardVsEasy}/10`);
  const expVsHard = series('expert', 'hard', 16);
  assert.ok(expVsHard >= 10, `expert beat hard ${expVsHard}/16`);
});

test('bot seat takes its move and wall on timers', async () => {
  const room = makeRoom();
  act(room, 'A', { kind: 'sit', seat: 'p1', bot: true, level: 'expert' });
  act(room, 'A', { kind: 'sit', seat: 'p2', bot: true, level: 'easy' });
  for (let t = 0; t < 40 && room.state.moveCount < 2; t++) await wait(200);
  const st = room.state;
  assert.ok(st.moveCount >= 2, 'both bots finished a turn');
  assert.ok(st.left.p1.h + st.left.p1.v === 17 && st.left.p2.h + st.left.p2.v <= 17, 'walls placed');
  act(room, 'A', { kind: 'removeBot', seat: 'p2' });
  assert.strictEqual(st.phase, 'waiting');
});

(async () => {
  for (const { name, fn } of tests) {
    try {
      const t0 = Date.now();
      await fn();
      console.log(`ok - ${name} (${Date.now() - t0}ms)`);
    } catch (e) {
      failures++;
      console.log(`FAIL - ${name}\n  ${e.stack}`);
    }
  }
  console.log(failures ? `${failures} failing` : 'all passing');
  process.exit(failures ? 1 : 0);
})();
