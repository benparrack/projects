// Bowling: scoring rules (perfect 300, all spares, 10th-frame edge cases), shared sim (determinism,
// pins, gutters, splits), game flow on the server (frame alternation, fresh racks, 10th-frame bonus
// balls), protocol guards, seats/bots/rematch, bot skill gradient. Run: node test/bowling.test.js
'use strict';

const assert = require('assert');
const plugin = require('../server/games/bowling');
const Sim = require('../public/games/bowling/sim.js');

const LEVELS = ['easy', 'medium', 'hard', 'expert'];
let failures = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

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
const ctxFor = (room, id) => ({ senderId: id, broadcast: room.broadcast, sendTo: room.sendTo });
const act = (room, id, data) => plugin.onMessage(room, { clientId: id }, data, ctxFor(room, id));
const lastState = (room) => [...room.sent].reverse().find((s) => s.m.payload.data.kind === 'state').m.payload.data;
const lastReject = (room, id) => {
  const s = [...room.sent].reverse().find((x) => x.to === id && x.m.payload.data.kind === 'moveRejected');
  return s && s.m.payload.data.reason;
};
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// ---- known inputs ----
const GUTTER = { x: -1, aim: -1, power: 0.5, spin: 0 }; // straight into the left gutter
// A ball that clears every pin of `pins` (searched over the crossing point, cached).
const clearCache = new Map();
function clearInput(pins) {
  const key = JSON.stringify(pins);
  if (clearCache.has(key)) return clearCache.get(key);
  const full = pins.length === 10;
  for (const spin of full ? [-0.6, -0.4, 0] : [0, -0.3, 0.3]) {
    for (const x of [0.45, 0, -0.45, 0.8, -0.8]) {
      for (let tx = -0.5; tx <= 0.5; tx += 0.005) {
        const inp = { x, aim: Sim.solveAim(x, 0.7, spin, tx), power: 0.7, spin };
        const r = Sim.simulate(pins, inp);
        if (r.standing.length === 0) { clearCache.set(key, r.input); return r.input; }
      }
    }
  }
  throw new Error(`no clearing input for ${key}`);
}
const STRIKE = clearInput(Sim.rack());
// A first ball that knocks some (not all, not none) pins.
function partialInput() {
  for (let tx = 0.2; tx <= 0.5; tx += 0.01) {
    const inp = { x: 0, aim: Sim.solveAim(0, 0.6, 0, tx), power: 0.6, spin: 0 };
    const r = Sim.simulate(Sim.rack(), inp);
    if (r.knocked.length >= 1 && r.knocked.length <= 6) return { inp: r.input, n: r.knocked.length, standing: r.standing };
  }
  throw new Error('no partial input');
}
const PARTIAL = partialInput();

function seated() {
  const room = makeRoom();
  act(room, 'A', { kind: 'sit', seat: 'p1' });
  act(room, 'B', { kind: 'sit', seat: 'p2' });
  room.state.busyUntil = 0;
  return room;
}
// Roll as whoever is up (A = p1, B = p2), then clear the busy window.
function roll(room, input) {
  const id = room.state.turn === 'p1' ? 'A' : 'B';
  act(room, id, { kind: 'roll', ...input });
  room.state.busyUntil = 0;
  return lastState(room).lastThrow;
}
const clearNow = (room) => clearInput(room.state.pins);

// ---- scoring ----
const card = (...fr) => fr;
test('score: perfect game is 300', () => {
  const fr = card([10], [10], [10], [10], [10], [10], [10], [10], [10], [10, 10, 10]);
  assert.deepStrictEqual(Sim.scoreFrames(fr), [30, 60, 90, 120, 150, 180, 210, 240, 270, 300]);
  assert.deepStrictEqual(Sim.frameMarks([10, 10, 10], 9), ['X', 'X', 'X']);
  assert.deepStrictEqual(Sim.frameMarks([10], 0), ['', 'X']);
});

test('score: all 5-spares with a 5 bonus is 150; gutter game 0; all nines 90', () => {
  const sp = Array.from({ length: 9 }, () => [5, 5]).concat([[5, 5, 5]]);
  assert.strictEqual(Sim.scoreFrames(sp)[9], 150);
  assert.deepStrictEqual(Sim.frameMarks([5, 5], 3), ['5', '/']);
  assert.deepStrictEqual(Sim.frameMarks([5, 5, 5], 9), ['5', '/', '5']);
  const g = Array.from({ length: 10 }, () => [0, 0]);
  assert.strictEqual(Sim.scoreFrames(g)[9], 0);
  assert.deepStrictEqual(Sim.frameMarks([0, 0], 2), ['-', '-']);
  const nines = Array.from({ length: 10 }, () => [9, 0]);
  assert.strictEqual(Sim.scoreFrames(nines)[9], 90);
  const zeroSpares = Array.from({ length: 9 }, () => [0, 10]).concat([[0, 10, 0]]);
  assert.strictEqual(Sim.scoreFrames(zeroSpares)[9], 100);
  assert.deepStrictEqual(Sim.frameMarks([0, 10], 0), ['-', '/']);
});

test('score: strike and spare bonuses, pending frames are null', () => {
  assert.deepStrictEqual(Sim.scoreFrames([[10], [3, 4]]).slice(0, 3), [17, 24, null]);
  assert.deepStrictEqual(Sim.scoreFrames([[10], [10], [10]]).slice(0, 4), [30, null, null, null]);
  assert.deepStrictEqual(Sim.scoreFrames([[10]]).slice(0, 2), [null, null]);
  assert.deepStrictEqual(Sim.scoreFrames([[10], [3]]).slice(0, 2), [null, null]);
  assert.deepStrictEqual(Sim.scoreFrames([[7, 3], [4]]).slice(0, 2), [14, null]);
  assert.deepStrictEqual(Sim.scoreFrames([[7, 3]]).slice(0, 1), [null]);
  assert.deepStrictEqual(Sim.scoreFrames([[7, 2]]).slice(0, 2), [9, null]);
  assert.strictEqual(Sim.knownTotal([[10], [10], [3]]), 23);
  assert.strictEqual(Sim.knownTotal([[10], [10]]), 0);
  assert.strictEqual(Sim.knownTotal([[10], [10], [3, 4]]), 23 + 17 + 7);
  // a strike followed by a spare frame: 10 + 7 + 3
  assert.deepStrictEqual(Sim.scoreFrames([[10], [7, 3], [0, 0]]).slice(0, 3), [20, 30, 30]);
});

test('score: 10th-frame edge cases', () => {
  const nine = Array.from({ length: 9 }, () => [0, 0]);
  const tenth = (r) => Sim.scoreFrames(nine.concat([r]))[9];
  assert.strictEqual(tenth([10, 10, 10]), 30);
  assert.strictEqual(tenth([10, 7, 3]), 20);
  assert.strictEqual(tenth([10, 7, 2]), 19);
  assert.strictEqual(tenth([10, 10, 7]), 27);
  assert.strictEqual(tenth([7, 3, 10]), 20);
  assert.strictEqual(tenth([7, 3, 4]), 14);
  assert.strictEqual(tenth([7, 2]), 9);
  assert.strictEqual(tenth([0, 0]), 0);
  // unfinished 10th
  assert.strictEqual(tenth([10, 10]), null);
  assert.strictEqual(tenth([7, 3]), null);
  assert.strictEqual(tenth([10]), null);
  // frame-done rules
  assert.strictEqual(Sim.frameDone(nine.concat([[7, 2]]), 9), true);
  assert.strictEqual(Sim.frameDone(nine.concat([[7, 3]]), 9), false);
  assert.strictEqual(Sim.frameDone(nine.concat([[10, 2]]), 9), false);
  assert.strictEqual(Sim.frameDone([[10]], 0), true);
  assert.strictEqual(Sim.frameDone([[3]], 0), false);
  // fresh racks in the 10th
  assert.strictEqual(Sim.nextIsFresh([10], 9), true);
  assert.strictEqual(Sim.nextIsFresh([7], 9), false);
  assert.strictEqual(Sim.nextIsFresh([10, 10], 9), true);
  assert.strictEqual(Sim.nextIsFresh([10, 7], 9), false);
  assert.strictEqual(Sim.nextIsFresh([7, 3], 9), true);
  assert.strictEqual(Sim.nextIsFresh([7], 4), false);
  // marks in the 10th
  assert.deepStrictEqual(Sim.frameMarks([10, 7, 3], 9), ['X', '7', '/']);
  assert.deepStrictEqual(Sim.frameMarks([10, 10, 7], 9), ['X', 'X', '7']);
  assert.deepStrictEqual(Sim.frameMarks([7, 3, 10], 9), ['7', '/', 'X']);
  assert.deepStrictEqual(Sim.frameMarks([0, 10, 0], 9), ['-', '/', '-']);
  assert.deepStrictEqual(Sim.frameMarks([10, 0, 10], 9), ['X', '-', '/']);
  // a nine-strike run into a 9/ 10th
  const run = Array.from({ length: 9 }, () => [10]).concat([[9, 1, 10]]);
  assert.strictEqual(Sim.scoreFrames(run)[9], 279);
});

// ---- sim ----
test('sim: rack is the standard 10-pin triangle', () => {
  const r = Sim.rack();
  assert.strictEqual(r.length, 10);
  assert.deepStrictEqual(r.map((p) => p.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.ok(r[0].z < r[1].z && r[1].x < 0 && r[2].x > 0 && r[6].x < r[9].x);
  for (const p of r) assert.ok(Math.abs(p.x) + Sim.PIN_R < Sim.LANE_HALF);
});

test('sim: deterministic — same input gives identical frames; bad input rejected', () => {
  const inp = { x: 0.3, aim: 0.12, power: 0.55, spin: -0.4 };
  const a = Sim.simulate(Sim.rack(), inp);
  const b = Sim.simulate(Sim.rack(), inp);
  assert.deepStrictEqual(a, b);
  assert.ok(a.frames.length > 30 && a.frames[0].length === 22);
  assert.strictEqual(Sim.simulate(Sim.rack(), { x: NaN, aim: 0, power: 0.5, spin: 0 }), null);
  assert.strictEqual(Sim.simulate(Sim.rack(), { x: 0, aim: 'x', power: 0.5, spin: 0 }), null);
  assert.strictEqual(Sim.simulate(Sim.rack(), null), null);
  assert.strictEqual(Sim.simulate(Sim.rack(), { x: 0, aim: 0 }), null);
  const c = Sim.simulate(Sim.rack(), { x: 9, aim: -9, power: 4, spin: -3 });
  assert.deepStrictEqual(c.input, { x: 1, aim: -1, power: 1, spin: -1 });
});

test('sim: gutter ball knocks nothing; strike knocks all; partial leaves pins where they stand', () => {
  const g = Sim.simulate(Sim.rack(), GUTTER);
  assert.strictEqual(g.gutter, true);
  assert.strictEqual(g.knocked.length, 0);
  assert.ok(g.events.some((e) => e.type === 'gutter'));
  const s = Sim.simulate(Sim.rack(), STRIKE);
  assert.strictEqual(s.knocked.length, 10);
  assert.strictEqual(s.standing.length, 0);
  assert.ok(s.events.some((e) => e.type === 'hit'));
  for (const p of s.pins) assert.ok(p.fallF >= 0 || p.outF >= 0);
  assert.strictEqual(PARTIAL.standing.length + PARTIAL.n, 10);
  for (const p of PARTIAL.standing) {
    const spot = Sim.SPOTS[p.id];
    assert.ok(Math.hypot(p.x - spot.x, p.z - spot.z) < 0.08, `pin ${p.id} drifted`);
  }
});

test('sim: centre hits strike more than random rolls; splits detected', () => {
  let strikes = 0;
  for (let tx = 0.05; tx <= 0.08; tx += 0.005) {
    if (Sim.simulate(Sim.rack(), { x: 0.45, aim: Sim.solveAim(0.45, 0.6, -0.6, tx), power: 0.6, spin: -0.6 }).knocked.length === 10) strikes++;
  }
  assert.ok(strikes >= 3, `pocket strikes ${strikes}`);
  assert.strictEqual(Sim.isSplit([7, 10]), true);
  assert.strictEqual(Sim.isSplit([4, 6, 7, 10]), true);
  assert.strictEqual(Sim.isSplit([2, 7]), true);
  assert.strictEqual(Sim.isSplit([4, 7]), false);
  assert.strictEqual(Sim.isSplit([1, 7, 10]), false); // head pin standing: not a split
  assert.strictEqual(Sim.isSplit([10]), false);
  assert.strictEqual(Sim.isSplit([5, 8]), false);
});

// ---- game flow ----
test('flow: perfect game through the server scores 300; players alternate frames', () => {
  const room = seated();
  const order = [];
  let guard = 0;
  while (room.state.phase === 'playing' && guard++ < 60) {
    const turn = room.state.turn;
    order.push(`${turn}${room.state.frame}`);
    const t = roll(room, turn === 'p1' ? STRIKE : GUTTER);
    if (turn === 'p1') assert.strictEqual(t.mark, 'strike');
  }
  const s = lastState(room);
  assert.strictEqual(s.phase, 'game_over');
  assert.strictEqual(s.totals.p1, 300);
  assert.strictEqual(s.totals.p2, 0);
  assert.strictEqual(s.winner, 'p1');
  assert.deepStrictEqual(s.rolls.p1[9], [10, 10, 10]);
  assert.strictEqual(s.stats.p1.strikes, 12);
  assert.strictEqual(s.stats.p2.gutters, 20);
  assert.deepStrictEqual(order.slice(0, 6), ['p10', 'p20', 'p20', 'p11', 'p21', 'p21']);
});

test('flow: all spares (gutter then clear) with a bonus ball scores 100', () => {
  const room = seated();
  let guard = 0;
  while (room.state.phase === 'playing' && guard++ < 80) {
    const turn = room.state.turn;
    if (turn === 'p2') { roll(room, GUTTER); continue; }
    const r = room.state.rolls.p1[room.state.frame];
    if (r.length === 0) roll(room, GUTTER);
    else if (r.length === 1) {
      assert.strictEqual(room.state.pins.length, 10, 'gutter leaves a full rack');
      const t = roll(room, clearNow(room));
      assert.strictEqual(t.mark, 'spare');
    } else {
      assert.strictEqual(room.state.frame, 9);
      assert.strictEqual(room.state.pins.length, 10, 'fresh rack for the 10th-frame bonus ball');
      roll(room, GUTTER);
    }
  }
  const s = lastState(room);
  assert.strictEqual(s.totals.p1, 100);
  assert.deepStrictEqual(s.rolls.p1[9], [0, 10, 0]);
  assert.strictEqual(s.stats.p1.spares, 10);
});

test('flow: open frame, standing pins carry to ball two, turn passes after two balls', () => {
  const room = seated();
  const t1 = roll(room, PARTIAL.inp);
  assert.strictEqual(t1.count, PARTIAL.n);
  assert.strictEqual(room.state.turn, 'p1');
  assert.deepStrictEqual(room.state.pins.map((p) => p.id), PARTIAL.standing.map((p) => p.id));
  assert.strictEqual(lastState(room).ball, 1);
  const t2 = roll(room, GUTTER);
  assert.strictEqual(t2.turnOver, true);
  assert.strictEqual(t2.freshNext, true);
  assert.strictEqual(room.state.turn, 'p2');
  assert.strictEqual(room.state.frame, 0);
  assert.strictEqual(room.state.pins.length, 10);
  assert.deepStrictEqual(room.state.rolls.p1[0], [PARTIAL.n, 0]);
  assert.strictEqual(lastState(room).totals.p1, PARTIAL.n);
  // the record carries the scorecard as of that ball for the client's delayed scoreboard
  assert.deepStrictEqual(t2.rollsAfter.p1[0], [PARTIAL.n, 0]);
});

function toTenth(room) {
  while (!(room.state.turn === 'p1' && room.state.frame === 9)) roll(room, GUTTER);
}

test('flow: 10th frame — strike then partial then third ball at the leftover pins', () => {
  const room = seated();
  toTenth(room);
  roll(room, STRIKE);
  assert.strictEqual(room.state.turn, 'p1');
  assert.strictEqual(room.state.pins.length, 10);
  const t = roll(room, PARTIAL.inp);
  assert.strictEqual(t.freshNext, false);
  assert.strictEqual(room.state.turn, 'p1');
  assert.strictEqual(room.state.pins.length, 10 - PARTIAL.n);
  roll(room, clearNow(room));
  assert.deepStrictEqual(room.state.rolls.p1[9], [10, PARTIAL.n, 10 - PARTIAL.n]);
  assert.strictEqual(room.state.turn, 'p2');
  assert.strictEqual(lastState(room).totals.p1, 20);
});

test('flow: 10th frame — open frame gets no third ball; tie is a draw', () => {
  const room = seated();
  toTenth(room);
  roll(room, GUTTER);
  roll(room, GUTTER);
  assert.strictEqual(room.state.turn, 'p2');
  assert.deepStrictEqual(room.state.rolls.p1[9], [0, 0]);
  roll(room, GUTTER);
  roll(room, GUTTER);
  const s = lastState(room);
  assert.strictEqual(s.phase, 'game_over');
  assert.strictEqual(s.winner, 'draw');
});

test('flow: 10th frame — X X then a third fresh-rack ball; spare then a fresh bonus ball', () => {
  const room = seated();
  toTenth(room);
  roll(room, STRIKE);
  roll(room, STRIKE);
  assert.strictEqual(room.state.pins.length, 10);
  roll(room, PARTIAL.inp);
  assert.deepStrictEqual(room.state.rolls.p1[9], [10, 10, PARTIAL.n]);
  assert.strictEqual(room.state.turn, 'p2');
  roll(room, PARTIAL.inp);
  roll(room, clearNow(room));
  assert.strictEqual(room.state.turn, 'p2');
  assert.strictEqual(room.state.pins.length, 10);
  roll(room, STRIKE);
  const s = lastState(room);
  assert.deepStrictEqual(s.rolls.p2[9], [PARTIAL.n, 10 - PARTIAL.n, 10]);
  assert.strictEqual(s.totals.p2, 20);
  assert.strictEqual(s.totals.p1, 20 + PARTIAL.n);
  assert.strictEqual(s.winner, 'p1');
});

// ---- protocol ----
test('protocol: not your turn, busy, bad input, spectators, garbage', () => {
  const room = seated();
  act(room, 'B', { kind: 'roll', x: 0, aim: 0, power: 0.5, spin: 0 });
  assert.strictEqual(lastReject(room, 'B'), 'not_your_turn');
  act(room, 'C', { kind: 'roll', x: 0, aim: 0, power: 0.5, spin: 0 });
  assert.strictEqual(lastReject(room, 'C'), 'not_your_turn');
  act(room, 'A', { kind: 'roll', x: 'left', aim: 0, power: 0.5, spin: 0 });
  assert.strictEqual(lastReject(room, 'A'), 'invalid');
  act(room, 'A', { kind: 'roll', x: 0, aim: 0, power: 0.5 });
  assert.strictEqual(lastReject(room, 'A'), 'invalid');
  act(room, 'A', { kind: 'roll', ...GUTTER });
  assert.strictEqual(room.state.throwSeq, 1);
  act(room, 'A', { kind: 'roll', ...GUTTER }); // still rolling
  assert.strictEqual(lastReject(room, 'A'), 'busy');
  assert.strictEqual(room.state.throwSeq, 1);
  assert.ok(lastState(room).busyUntil > Date.now());
  const waiting = makeRoom();
  act(waiting, 'A', { kind: 'roll', x: 0, aim: 0, power: 0.5, spin: 0 });
  assert.strictEqual(lastReject(waiting, 'A'), 'not_playing');
  // garbage never throws or changes the game
  const junk = [null, undefined, 5, 'roll', [], {}, { kind: 7 }, { kind: 'sit', seat: 'p3' }, { kind: 'sit', seat: { a: 1 } },
    { kind: 'roll', x: {}, aim: [], power: null, spin: Infinity }, { kind: 'setBotLevel', seat: 'p1', level: 'god' },
    { kind: 'removeBot', seat: 'p1' }, { kind: 'resetGame' }, { kind: '__proto__' }, { kind: 'roll', x: 1e308, aim: -1e308, power: 1e308, spin: -1e308 }];
  const before = JSON.stringify(room.state.rolls);
  for (const j of junk) act(room, 'B', j);
  plugin.onMessage(room, { clientId: 'B' }, { kind: 'roll' }, ctxFor(room, 'B'));
  assert.strictEqual(JSON.stringify(room.state.rolls), before);
  assert.strictEqual(room.state.players.p1, 'A');
});

test('protocol: server frames match the shared sim; record carries before/after pins', () => {
  const room = seated();
  const inp = { x: 0.2, aim: 0.05, power: 0.4, spin: -0.3 };
  const expected = Sim.simulate(Sim.rack(), inp);
  act(room, 'A', { kind: 'roll', ...inp });
  const t = lastState(room).lastThrow;
  assert.deepStrictEqual(t.frames, expected.frames);
  assert.deepStrictEqual(t.knocked, expected.knocked);
  assert.strictEqual(t.before.length, 10);
  assert.ok(Array.isArray(t.pinsAfter));
});

test('seats: one seat per person; leaving mid-game resets; rematch swaps seats', () => {
  const room = makeRoom();
  act(room, 'A', { kind: 'sit', seat: 'p1' });
  act(room, 'A', { kind: 'sit', seat: 'p2' });
  assert.strictEqual(room.state.players.p2, null);
  act(room, 'B', { kind: 'sit', seat: 'p1' });
  assert.strictEqual(room.state.players.p1, 'A');
  act(room, 'B', { kind: 'sit', seat: 'p2' });
  assert.strictEqual(room.state.phase, 'playing');
  act(room, 'A', { kind: 'resetGame' }); // not over yet
  assert.strictEqual(room.state.players.p1, 'A');
  room.state.phase = 'game_over';
  room.state.winner = 'p1';
  const g = room.state.gameId;
  act(room, 'C', { kind: 'resetGame' }); // spectators can't
  assert.strictEqual(room.state.gameId, g);
  act(room, 'A', { kind: 'resetGame' });
  assert.strictEqual(room.state.players.p1, 'B');
  assert.strictEqual(room.state.players.p2, 'A');
  assert.strictEqual(room.state.phase, 'playing');
  assert.strictEqual(room.state.gameId, g + 1);
  roll(room, GUTTER);
  plugin.onLeave(room, { clientId: 'A' });
  assert.strictEqual(room.state.phase, 'waiting');
  assert.strictEqual(room.state.players.p2, null);
  assert.deepStrictEqual(room.state.rolls.p1[0], []);
  plugin.onLeave(room, { clientId: 'Z' }); // a spectator leaving is harmless
  assert.strictEqual(room.state.players.p1, 'B');
});

// ---- bots ----
function botGame(level, rand) {
  const frames = Array.from({ length: 10 }, () => []);
  const st = { strikes: 0, gutters: 0 };
  for (let f = 0; f < 10; f++) {
    let pins = Sim.rack();
    while (!Sim.frameDone(frames, f)) {
      if (Sim.nextIsFresh(frames[f], f)) pins = Sim.rack();
      const fresh = pins.length === 10;
      const res = Sim.simulate(pins, Sim.botRoll(pins, level, rand));
      frames[f].push(res.knocked.length);
      if (fresh && res.knocked.length === 10) st.strikes++;
      if (res.gutter) st.gutters++;
      pins = res.standing;
    }
  }
  return { score: Sim.scoreFrames(frames)[9], ...st };
}

test('bots: skill gradient — Expert > Hard > Medium > Easy, Expert reliably beats Easy', () => {
  const N = 16;
  const res = {};
  for (const lv of LEVELS) {
    const rand = rng(99 + lv.length);
    const games = Array.from({ length: N }, () => botGame(lv, rand));
    res[lv] = {
      avg: games.reduce((a, g) => a + g.score, 0) / N,
      strikes: games.reduce((a, g) => a + g.strikes, 0) / N,
      gutters: games.reduce((a, g) => a + g.gutters, 0) / N,
      scores: games.map((g) => g.score),
    };
  }
  const line = LEVELS.map((lv) => `${lv} ${res[lv].avg.toFixed(0)} (X ${res[lv].strikes.toFixed(1)}/g, gutters ${res[lv].gutters.toFixed(1)}/g)`).join(' · ');
  console.log(`     ${line}`);
  for (let i = 1; i < LEVELS.length; i++) assert.ok(res[LEVELS[i]].avg > res[LEVELS[i - 1]].avg, line);
  assert.ok(res.expert.avg >= 185, line);
  assert.ok(res.expert.strikes >= 4, line);
  assert.ok(res.easy.avg <= 125, line);
  assert.ok(res.easy.gutters >= 1, `easy gutters sometimes: ${line}`);
  assert.ok(res.expert.gutters < 0.5, line);
  let wins = 0;
  for (let i = 0; i < N; i++) if (res.expert.scores[i] > res.easy.scores[i]) wins++;
  assert.ok(wins >= N - 1, `expert beat easy ${wins}/${N}`);
});

test('bots: level change, removal, bot-vs-bot game completes; human leaving cancels the bot', async () => {
  const t = plugin._internal.timing;
  const saved = { ...t };
  Object.assign(t, { min: 0, max: 1, after: -100000 });
  try {
    const room = makeRoom();
    act(room, 'A', { kind: 'sit', seat: 'p2', bot: true, level: 'easy' });
    act(room, 'A', { kind: 'setBotLevel', seat: 'p2', level: 'expert' });
    assert.strictEqual(room.state.botLevels.p2, 'expert');
    act(room, 'A', { kind: 'removeBot', seat: 'p2' });
    assert.strictEqual(room.state.players.p2, null);

    act(room, 'A', { kind: 'sit', seat: 'p1', bot: true, level: 'expert' });
    act(room, 'A', { kind: 'sit', seat: 'p2', bot: true, level: 'easy' });
    for (let i = 0; i < 2000 && room.state.phase === 'playing'; i++) await wait(2);
    const s = lastState(room);
    assert.strictEqual(s.phase, 'game_over');
    assert.ok(['p1', 'p2', 'draw'].includes(s.winner));
    assert.ok(s.rolls.p1.every((r, f) => Sim.frameDone(s.rolls.p1, f)));
    assert.ok(s.rolls.p2.every((r, f) => Sim.frameDone(s.rolls.p2, f)));

    const hb = makeRoom();
    act(hb, 'A', { kind: 'sit', seat: 'p1' });
    act(hb, 'A', { kind: 'sit', seat: 'p2', bot: true, level: 'medium' });
    hb.state.busyUntil = 0;
    roll(hb, GUTTER);
    roll(hb, GUTTER);
    assert.strictEqual(hb.state.turn, 'p2');
    for (let i = 0; i < 200 && hb.state.stats.p2.balls === 0; i++) await wait(2);
    assert.ok(hb.state.stats.p2.balls >= 1);
    plugin.onLeave(hb, { clientId: 'A' });
    const seq = hb.state.throwSeq;
    await wait(30);
    assert.strictEqual(hb.state.throwSeq, seq);
  } finally {
    Object.assign(t, saved);
  }
});

(async () => {
  const t0 = Date.now();
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (e) {
      failures++;
      console.log(`FAIL ${name}\n     ${e.stack.split('\n').slice(0, 3).join('\n     ')}`);
    }
  }
  console.log(failures ? `\n${failures} failing` : `\nall ${tests.length} passing (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  process.exit(failures ? 1 : 0);
})();
