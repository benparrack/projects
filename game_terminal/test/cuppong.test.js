// Cup Pong: shared sim (determinism, solver, bot accuracy), rules (2 throws, balls back, re-rack,
// win), protocol guards, seats/bots/rematch. Run: node test/cuppong.test.js
'use strict';

const assert = require('assert');
const plugin = require('../server/games/cuppong');
const Sim = require('../public/games/cuppong/sim.js');

const LEVELS = ['easy', 'medium', 'hard', 'expert'];
let failures = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function makeRoom() {
  const sent = [];
  const room = {
    state: plugin.createInitialState(),
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

// Deterministic rand for bot statistics.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const MISS = { aim: -1, power: 0 }; // falls short off the side
const sinkInput = (cups, id) => Sim.solveAim(cups.find((c) => c.id === id));

function seated() {
  const room = makeRoom();
  act(room, 'A', { kind: 'sit', seat: 'red' });
  act(room, 'B', { kind: 'sit', seat: 'blue' });
  room.state.busyUntil = 0;
  return room;
}
// Throw by the player on turn, then clear the busy window so the next throw is accepted.
function throwAs(room, id, input) {
  act(room, id, { kind: 'throw', ...input });
  room.state.busyUntil = 0;
}
const sinkFor = (room, by) => {
  const target = by === 'red' ? 'blue' : 'red';
  const cups = room.state.cups[target];
  return sinkInput(cups, cups[0].id);
};

// ---- sim ----
test('sim: rack has 10 distinct cups on the table', () => {
  const r = Sim.fullRack();
  assert.strictEqual(r.length, 10);
  assert.strictEqual(new Set(r.map((c) => c.id)).size, 10);
  for (const c of r) assert.ok(Math.abs(c.x) < Sim.TABLE_W / 2 && c.z < Sim.TABLE_L && c.z > Sim.TABLE_L / 2);
});

test('sim: deterministic — same input gives identical frames', () => {
  const inp = { aim: 0.13, power: 0.41 };
  const a = Sim.simulate(Sim.fullRack(), inp);
  const b = Sim.simulate(Sim.fullRack(), inp);
  assert.deepStrictEqual(a, b);
  assert.ok(a.frames.length > 10);
});

test('sim: rejects non-finite input, clamps out-of-range', () => {
  assert.strictEqual(Sim.simulate(Sim.fullRack(), { aim: NaN, power: 0.5 }), null);
  assert.strictEqual(Sim.simulate(Sim.fullRack(), { aim: 'x', power: 0.5 }), null);
  const r = Sim.simulate(Sim.fullRack(), { aim: 9, power: -3 });
  assert.ok(r);
  assert.deepStrictEqual(r.input, { aim: 1, power: 0 });
});

test('sim: solveAim sinks every cup of a full rack', () => {
  const rack = Sim.fullRack();
  for (const c of rack) {
    const r = Sim.simulate(rack, Sim.solveAim(c));
    assert.strictEqual(r.outcome, 'sink', `cup ${c.id}`);
    assert.strictEqual(r.cupId, c.id, `cup ${c.id}`);
  }
});

test('sim: re-rack shapes keep ids and stay on the table', () => {
  const rack = Sim.fullRack();
  for (const n of [6, 3, 2, 1]) {
    const cups = rack.slice(0, n);
    const rr = Sim.rerack(cups);
    assert.strictEqual(rr.length, n);
    assert.deepStrictEqual(rr.map((c) => c.id).sort(), cups.map((c) => c.id).sort());
    for (const c of rr) {
      const r = Sim.simulate(rr, Sim.solveAim(c));
      assert.strictEqual(r.outcome, 'sink', `rerack ${n} cup ${c.id}`);
    }
  }
});

test('sim: bot accuracy increases with level', () => {
  const rates = LEVELS.map((lv, i) => {
    const rand = rng(1234 + i);
    let made = 0;
    const N = 400;
    for (let k = 0; k < N; k++) {
      const rack = Sim.fullRack();
      const r = Sim.simulate(rack, Sim.botThrow(rack, lv, rand));
      if (r.outcome === 'sink') made++;
    }
    return made / N;
  });
  for (let i = 1; i < rates.length; i++) assert.ok(rates[i] > rates[i - 1], `rates ${rates.map((r) => r.toFixed(2))}`);
  assert.ok(rates[0] > 0.05 && rates[3] < 0.95, `rates ${rates}`);
});

// ---- rules ----
test('rules: two throws then the turn passes', () => {
  const room = seated();
  assert.strictEqual(room.state.phase, 'playing');
  assert.strictEqual(room.state.turn, 'red');
  throwAs(room, 'A', MISS);
  assert.strictEqual(room.state.throwsLeft, 1);
  assert.strictEqual(room.state.turn, 'red');
  throwAs(room, 'A', MISS);
  assert.strictEqual(room.state.turn, 'blue');
  assert.strictEqual(room.state.throwsLeft, 2);
  assert.strictEqual(lastState(room).lastThrow.turnOver, true);
  assert.strictEqual(room.state.cups.blue.length, 10);
});

test('rules: a sink removes the cup; one hit of two passes the turn', () => {
  const room = seated();
  throwAs(room, 'A', sinkFor(room, 'red'));
  assert.strictEqual(room.state.cups.blue.length, 9);
  assert.strictEqual(lastState(room).lastThrow.outcome, 'sink');
  throwAs(room, 'A', MISS);
  assert.strictEqual(room.state.turn, 'blue');
});

test('rules: making both throws gives balls back', () => {
  const room = seated();
  throwAs(room, 'A', sinkFor(room, 'red'));
  throwAs(room, 'A', sinkFor(room, 'red'));
  assert.strictEqual(room.state.turn, 'red');
  assert.strictEqual(room.state.throwsLeft, 2);
  assert.strictEqual(lastState(room).lastThrow.ballsBack, true);
});

test('rules: re-rack at 6 and 3 when enabled, not when disabled', () => {
  const room = seated();
  // 4 sinks (two balls-back turns) -> 6 cups: re-rack into a 3-row triangle
  for (let i = 0; i < 4; i++) throwAs(room, 'A', sinkFor(room, 'red'));
  assert.strictEqual(room.state.cups.blue.length, 6);
  assert.strictEqual(lastState(room).lastThrow.rerack, true);
  assert.deepStrictEqual(room.state.reracked.blue, [6]);

  const off = makeRoom();
  act(off, 'A', { kind: 'setRerack', on: false });
  act(off, 'A', { kind: 'sit', seat: 'red' });
  act(off, 'B', { kind: 'sit', seat: 'blue' });
  off.state.busyUntil = 0;
  const before = off.state.cups.blue.slice(4).map((c) => ({ ...c }));
  for (let i = 0; i < 4; i++) throwAs(off, 'A', sinkInput(off.state.cups.blue, off.state.cups.blue[0].id));
  assert.strictEqual(lastState(off).lastThrow.rerack, false);
  assert.deepStrictEqual(off.state.cups.blue, before);
});

test('rules: clearing all cups wins', () => {
  const room = seated();
  let guard = 0;
  while (room.state.phase === 'playing' && guard++ < 40) {
    const id = room.state.turn === 'red' ? 'A' : 'B';
    throwAs(room, id, room.state.turn === 'red' ? sinkFor(room, 'red') : MISS);
  }
  const s = lastState(room);
  assert.strictEqual(s.phase, 'game_over');
  assert.strictEqual(s.winner, 'red');
  assert.strictEqual(s.cups.blue.length, 0);
  assert.strictEqual(s.stats.red.made, 10);
});

// ---- protocol ----
test('protocol: not your turn, busy, bad input, spectators', () => {
  const room = seated();
  act(room, 'B', { kind: 'throw', aim: 0, power: 0.5 });
  assert.strictEqual(lastReject(room, 'B'), 'not_your_turn');
  act(room, 'C', { kind: 'throw', aim: 0, power: 0.5 });
  assert.strictEqual(lastReject(room, 'C'), 'not_your_turn');
  act(room, 'A', { kind: 'throw', aim: 'left', power: 0.5 });
  assert.strictEqual(lastReject(room, 'A'), 'invalid');
  act(room, 'A', { kind: 'throw', aim: 0, power: 0.1 });
  assert.strictEqual(room.state.throwSeq, 1);
  act(room, 'A', { kind: 'throw', aim: 0, power: 0.1 }); // ball still flying
  assert.strictEqual(lastReject(room, 'A'), 'busy');
  assert.strictEqual(room.state.throwSeq, 1);
  const waiting = makeRoom();
  act(waiting, 'A', { kind: 'throw', aim: 0, power: 0.5 });
  assert.strictEqual(lastReject(waiting, 'A'), 'not_playing');
});

test('protocol: server broadcasts authoritative frames matching the shared sim', () => {
  const room = seated();
  const inp = { aim: 0.05, power: 0.4 };
  const expected = Sim.simulate(Sim.fullRack(), inp);
  act(room, 'A', { kind: 'throw', ...inp });
  const t = lastState(room).lastThrow;
  assert.deepStrictEqual(t.frames, expected.frames);
  assert.strictEqual(t.outcome, expected.outcome);
  assert.strictEqual(t.before.length, 10);
  assert.ok(lastState(room).busyUntil > Date.now());
});

test('seats: one seat per person; leaving resets; rematch swaps colours', () => {
  const room = makeRoom();
  act(room, 'A', { kind: 'sit', seat: 'red' });
  act(room, 'A', { kind: 'sit', seat: 'blue' });
  assert.strictEqual(room.state.players.blue, null);
  act(room, 'B', { kind: 'sit', seat: 'red' });
  assert.strictEqual(room.state.players.red, 'A');
  act(room, 'B', { kind: 'sit', seat: 'blue' });
  assert.strictEqual(room.state.phase, 'playing');
  act(room, 'A', { kind: 'resetGame' }); // not over yet
  assert.strictEqual(room.state.players.red, 'A');
  room.state.phase = 'game_over';
  room.state.winner = 'red';
  const g = room.state.gameId;
  act(room, 'A', { kind: 'resetGame' });
  assert.strictEqual(room.state.players.red, 'B');
  assert.strictEqual(room.state.players.blue, 'A');
  assert.strictEqual(room.state.phase, 'playing');
  assert.strictEqual(room.state.gameId, g + 1);
  assert.strictEqual(room.state.cups.red.length, 10);
  plugin.onLeave(room, { clientId: 'A' });
  assert.strictEqual(room.state.phase, 'waiting');
  assert.strictEqual(room.state.players.blue, null);
});

test('bots: level change, removal, bot-vs-bot game completes', async () => {
  const t = plugin._internal.timing;
  const saved = { ...t };
  Object.assign(t, { min: 0, max: 1, after: -100000 }); // no flight wait in tests
  try {
    const room = makeRoom();
    act(room, 'A', { kind: 'sit', seat: 'blue', bot: true, level: 'easy' });
    act(room, 'A', { kind: 'setBotLevel', seat: 'blue', level: 'expert' });
    assert.strictEqual(room.state.botLevels.blue, 'expert');
    act(room, 'A', { kind: 'removeBot', seat: 'blue' });
    assert.strictEqual(room.state.players.blue, null);

    act(room, 'A', { kind: 'sit', seat: 'red', bot: true, level: 'expert' });
    act(room, 'A', { kind: 'sit', seat: 'blue', bot: true, level: 'expert' });
    for (let i = 0; i < 400 && room.state.phase === 'playing'; i++) await wait(5);
    assert.strictEqual(room.state.phase, 'game_over');
    assert.ok(['red', 'blue'].includes(room.state.winner));
    assert.strictEqual(room.state.cups[room.state.winner === 'red' ? 'blue' : 'red'].length, 0);

    // human vs bot: the bot answers after the human's turn passes
    const hb = makeRoom();
    act(hb, 'A', { kind: 'sit', seat: 'red' });
    act(hb, 'A', { kind: 'sit', seat: 'blue', bot: true, level: 'medium' });
    throwAs(hb, 'A', MISS);
    throwAs(hb, 'A', MISS);
    assert.strictEqual(hb.state.turn, 'blue');
    for (let i = 0; i < 100 && hb.state.stats.blue.throws === 0; i++) await wait(5);
    assert.ok(hb.state.stats.blue.throws >= 1);
    // a human leaving cancels the bot's pending throws
    plugin.onLeave(hb, { clientId: 'A' });
    const seq = hb.state.throwSeq;
    await wait(30);
    assert.strictEqual(hb.state.throwSeq, seq);
  } finally {
    Object.assign(t, saved);
  }
});

(async () => {
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (e) {
      failures++;
      console.log(`FAIL ${name}\n     ${e.stack.split('\n').slice(0, 3).join('\n     ')}`);
    }
  }
  console.log(failures ? `\n${failures} failing` : `\nall ${tests.length} passing`);
  process.exit(failures ? 1 : 0);
})();
