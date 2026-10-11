// Knockout: shared sim (determinism, collisions, falling off, shrink), hidden simultaneous moves,
// buzzer + drafts, win/draw, protocol guards, seats/bots/rematch, bot skill gradient.
// Run: node test/knockout.test.js
'use strict';

const assert = require('assert');
const plugin = require('../server/games/knockout');
const Sim = require('../public/games/knockout/sim.js');

const { timing, advance } = plugin._internal;
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
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function seated() {
  const room = makeRoom();
  act(room, 'A', { kind: 'sit', seat: 'red' });
  act(room, 'B', { kind: 'sit', seat: 'blue' });
  room.state.planFrom = 0; // planning open now
  room.state.deadline = Date.now() + 60000;
  return room;
}
const openNow = (room) => { room.state.planFrom = 0; room.state.deadline = Date.now() + 60000; };

test('sim: deterministic, head-on hit transfers momentum, idle round is still', () => {
  const pens = Sim.startPositions(4);
  const mv = { r1: { a: -Math.PI / 2, p: 1 }, r3: { a: 2, p: 0.6 } };
  const a = Sim.simulate(pens, mv, 10);
  const b = Sim.simulate(pens, mv, 10);
  assert.deepStrictEqual(a, b);
  assert.ok(a.events.some((e) => e.type === 'hit' && e.a === 'r1' && e.b === 'b1'));
  const b1 = a.end.find((x) => x.id === 'b1');
  assert.ok(b1.y < -6.3, `b1 shoved back (${b1.y})`);
  const idle = Sim.simulate(pens, {}, 10);
  for (const e of idle.end) {
    const p = pens.find((x) => x.id === e.id);
    assert.strictEqual(e.x, p.x); assert.strictEqual(e.y, p.y); assert.ok(!e.out);
  }
});

test('sim: sliding off the edge eliminates; shrink schedule; normMove guards', () => {
  const res = Sim.simulate(Sim.startPositions(4), { r0: { a: Math.PI / 2, p: 1 } }, 10);
  assert.deepStrictEqual(res.outs.map((o) => o.id), ['r0']);
  assert.ok(res.end.find((e) => e.id === 'r0').out);
  assert.strictEqual(Sim.nextH(10, 1), 10);
  assert.strictEqual(Sim.nextH(10, 2), 8.75);
  assert.strictEqual(Sim.nextH(Sim.H_MIN, 4), Sim.H_MIN);
  for (const bad of [null, 5, 'x', {}, { a: NaN, p: 1 }, { a: 1, p: Infinity }, { a: 1e9, p: 1 }]) assert.strictEqual(Sim.normMove(bad), null);
  assert.deepStrictEqual(Sim.normMove({ a: 0.12345, p: 7 }), { a: 0.123, p: 1 });
  assert.strictEqual(Sim.startPositions(5).length, 10);
});

test('hidden moves: drafts/locks never leak; resolve when both lock; arrows revealed after', () => {
  const room = seated();
  act(room, 'A', { kind: 'submit', moves: { r1: { a: -1.57, p: 0.9 } }, lock: false });
  const leak = (st) => JSON.stringify(st).includes('0.9');
  assert.ok(!room.sent.some((s) => leak(s.m)), 'draft never broadcast');
  act(room, 'A', { kind: 'submit', moves: { r1: { a: -1.57, p: 0.9 } }, lock: true });
  assert.strictEqual(lastState(room).locked.red, true);
  assert.ok(!leak(lastState(room)) && !leak(plugin.serializeSnapshot(room)));
  act(room, 'A', { kind: 'submit', moves: {}, lock: true });
  assert.strictEqual(lastReject(room, 'A'), 'locked');
  act(room, 'B', { kind: 'submit', moves: {}, lock: true });
  const st = lastState(room);
  assert.strictEqual(st.roundSeq, 1);
  assert.strictEqual(st.round, 2);
  assert.deepStrictEqual(st.lastRound.moves.r1, { a: -1.57, p: 0.9 });
  assert.ok(st.lastRound.frames.length > 10);
  assert.deepStrictEqual(st.locked, { red: false, blue: false });
  assert.ok(st.planFrom > Date.now(), 'next round opens after the replay');
  // during the replay submissions are refused
  act(room, 'A', { kind: 'submit', moves: {}, lock: true });
  assert.strictEqual(lastReject(room, 'A'), 'busy');
});

test('buzzer: unlocked drafts count, unset penguins stay put', () => {
  const room = seated();
  act(room, 'A', { kind: 'submit', moves: { r0: { a: Math.PI / 2, p: 1 } }, lock: false });
  assert.strictEqual(advance(room, room.state.deadline - 1), false);
  assert.ok(advance(room, room.state.deadline));
  const lr = room.state.lastRound;
  assert.deepStrictEqual(lr.outs.map((o) => o.id), ['r0']);
  assert.strictEqual(room.state.penguins.length, 7);
  assert.strictEqual(room.state.stats.blue.ko, 1);
  assert.strictEqual(room.state.stats.red.lost, 1);
});

test('shrink after round 2 drops rim penguins; win and draw', () => {
  const room = seated();
  const st = room.state;
  st.round = 2;
  st.penguins = [
    { id: 'r0', side: 'red', x: 0, y: 9.5, face: 0 }, // on the rim that breaks off
    { id: 'r1', side: 'red', x: 0, y: 2, face: 0 },
    { id: 'b0', side: 'blue', x: 3, y: -3, face: 0 },
  ];
  act(room, 'A', { kind: 'submit', moves: {}, lock: true });
  act(room, 'B', { kind: 'submit', moves: {}, lock: true });
  assert.strictEqual(st.H, 8.75);
  assert.deepStrictEqual(st.lastRound.fell, ['r0']);
  assert.ok(st.lastRound.shrinkMs > 0);
  assert.deepStrictEqual(st.penguins.map((p) => p.id).sort(), ['b0', 'r1']);
  // red knocks the last blue off -> red wins
  openNow(room);
  st.penguins = [{ id: 'r1', side: 'red', x: 0, y: -4, face: 0 }, { id: 'b0', side: 'blue', x: 0, y: -6.5, face: 0 }];
  act(room, 'A', { kind: 'submit', moves: { r1: { a: -Math.PI / 2, p: 0.8 } }, lock: true });
  act(room, 'B', { kind: 'submit', moves: {}, lock: true });
  assert.strictEqual(st.phase, 'game_over');
  assert.strictEqual(st.winner, 'red');
  // both last penguins dive in the same round -> draw
  const d = seated();
  d.state.penguins = [{ id: 'r0', side: 'red', x: 0, y: 8, face: 0 }, { id: 'b0', side: 'blue', x: 0, y: -8, face: 0 }];
  act(d, 'A', { kind: 'submit', moves: { r0: { a: Math.PI / 2, p: 1 } }, lock: true });
  act(d, 'B', { kind: 'submit', moves: { b0: { a: -Math.PI / 2, p: 1 } }, lock: true });
  assert.strictEqual(d.state.winner, 'draw');
});

test('protocol: garbage never throws; ownership, phase and seat checks', () => {
  const room = seated();
  const garbage = [null, 7, 'x', [], {}, { kind: 5 }, { kind: 'submit' }, { kind: 'submit', moves: 'x' },
    { kind: 'submit', moves: [] }, { kind: 'submit', moves: { b0: { a: 0, p: 1 } } }, { kind: 'submit', moves: { r0: { a: 'x', p: 1 } } },
    { kind: 'submit', moves: { __proto__: { a: 1 } } }, { kind: 'submit', moves: { r0: null } },
    { kind: 'sit', seat: 'green' }, { kind: 'setCount', count: 9 }, { kind: 'setBotLevel', seat: 'red', level: 'god' },
    { kind: 'removeBot', seat: 'red' }, { kind: 'resetGame' }, { kind: 'nope' }];
  for (const g of garbage) act(room, 'A', g);
  assert.strictEqual(room.state.phase, 'playing');
  assert.deepStrictEqual(room.state.locked, { red: false, blue: false });
  act(room, 'A', { kind: 'submit', moves: { b0: { a: 0, p: 1 } }, lock: true });
  assert.strictEqual(lastReject(room, 'A'), 'invalid');
  act(room, 'C', { kind: 'submit', moves: {}, lock: true });
  assert.strictEqual(lastReject(room, 'C'), 'not_seated');
  act(room, 'A', { kind: 'setCount', count: 5 }); // not mid-game
  assert.strictEqual(room.state.count, 4);
  const w = makeRoom();
  act(w, 'A', { kind: 'submit', moves: {}, lock: true });
  assert.strictEqual(lastReject(w, 'A'), 'not_playing');
  act(w, 'A', { kind: 'setCount', count: 5 });
  assert.strictEqual(w.state.penguins.length, 10);
  plugin.tick(w); // waiting: no-op
});

test('seats: one seat per person; leaving mid-game resets; rematch swaps colours', () => {
  const room = makeRoom();
  act(room, 'A', { kind: 'sit', seat: 'red' });
  act(room, 'A', { kind: 'sit', seat: 'blue' });
  assert.strictEqual(room.state.players.blue, null);
  act(room, 'B', { kind: 'sit', seat: 'red' });
  assert.strictEqual(room.state.players.red, 'A');
  act(room, 'B', { kind: 'sit', seat: 'blue' });
  assert.strictEqual(room.state.phase, 'playing');
  act(room, 'A', { kind: 'resetGame' });
  assert.strictEqual(room.state.players.red, 'A');
  room.state.phase = 'game_over';
  room.state.winner = 'red';
  const g = room.state.gameId;
  act(room, 'A', { kind: 'resetGame' });
  assert.deepStrictEqual(room.state.players, { red: 'B', blue: 'A' });
  assert.strictEqual(room.state.phase, 'playing');
  assert.strictEqual(room.state.gameId, g + 1);
  plugin.onLeave(room, { clientId: 'A' });
  assert.strictEqual(room.state.phase, 'waiting');
  assert.strictEqual(room.state.players.blue, null);
  plugin.onLeave(room, { clientId: 'Z' }); // spectator leaving is a no-op
});

test('bots: lock in on time, never stall; bot-vs-bot and human-vs-bot finish', () => {
  const room = makeRoom();
  act(room, 'A', { kind: 'sit', seat: 'blue', bot: true, level: 'easy' });
  act(room, 'A', { kind: 'setBotLevel', seat: 'blue', level: 'expert' });
  assert.strictEqual(room.state.botLevels.blue, 'expert');
  act(room, 'A', { kind: 'removeBot', seat: 'blue' });
  assert.strictEqual(room.state.players.blue, null);
  act(room, 'A', { kind: 'sit', seat: 'red', bot: true, level: 'hard' });
  act(room, 'A', { kind: 'sit', seat: 'blue', bot: true, level: 'expert' });
  let now = Date.now();
  for (let i = 0; i < 2000 && room.state.phase === 'playing'; i++) { now += 500; advance(room, now); }
  assert.strictEqual(room.state.phase, 'game_over');
  // human AFK vs bot: the buzzer keeps it moving, the bot plays every round
  const hb = makeRoom();
  act(hb, 'A', { kind: 'sit', seat: 'red' });
  act(hb, 'A', { kind: 'sit', seat: 'blue', bot: true, level: 'medium' });
  now = Date.now();
  advance(hb, hb.state.planFrom + timing.botMax + 1);
  assert.strictEqual(hb.state.locked.blue, true, 'bot locked within its think window');
  for (let i = 0; i < 4000 && hb.state.phase === 'playing'; i++) { now += 1000; advance(hb, Math.max(now, hb.state.deadline)); now = Math.max(now, hb.state.deadline); }
  assert.strictEqual(hb.state.phase, 'game_over');
  assert.notStrictEqual(hb.state.winner, 'red');
});

test('bot skill gradient (sim-level, seeded)', () => {
  function game(lr, lb, seed) {
    const rand = rng(seed);
    let p = Sim.startPositions(4);
    let H = Sim.H0;
    for (let round = 1; round <= plugin._internal.MAX_ROUNDS; round++) {
      const m = Object.assign({}, Sim.botMoves(p, 'red', H, round, lr, rand), Sim.botMoves(p, 'blue', H, round, lb, rand));
      const res = Sim.simulate(p, m, H, { noFrames: true });
      const Hn = Sim.nextH(H, round);
      p = res.end.filter((b) => !b.out && Sim.onIce(b.x, b.y, Hn));
      H = Hn;
      const r = p.filter((x) => x.side === 'red').length;
      const b = p.filter((x) => x.side === 'blue').length;
      if (!r || !b) return !r && !b ? 'draw' : r ? 'red' : 'blue';
    }
    return 'draw';
  }
  const rate = (hi, lo, n) => {
    let w = 0;
    for (let i = 0; i < n; i++) {
      const sw = i % 2 === 1;
      const res = game(sw ? lo : hi, sw ? hi : lo, 1000 + i);
      if (res === (sw ? 'blue' : 'red')) w++;
    }
    return w / n;
  };
  const r1 = rate('expert', 'easy', 12);
  const r2 = rate('hard', 'medium', 12);
  const r3 = rate('medium', 'easy', 12);
  console.log(`     win rates: expert>easy ${r1.toFixed(2)}, hard>medium ${r2.toFixed(2)}, medium>easy ${r3.toFixed(2)}`);
  assert.ok(r1 >= 0.85, `expert beats easy (${r1})`);
  assert.ok(r2 >= 0.6, `hard beats medium (${r2})`);
  assert.ok(r3 >= 0.6, `medium beats easy (${r3})`);
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
