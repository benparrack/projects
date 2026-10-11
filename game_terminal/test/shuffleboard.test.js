// Shuffleboard: shared sim (determinism, physics, scoring), rules (alternating 4 pucks, round
// scoring, lead, target), protocol guards, seats/bots/rematch, bot skill gradient.
// Run: node test/shuffleboard.test.js
'use strict';

const assert = require('assert');
const plugin = require('../server/games/shuffleboard');
const Sim = require('../public/games/shuffleboard/sim.js');

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
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const P = (id, owner, x, y) => ({ id, owner, x, y });
const draw = (x, y) => Sim.aimAt(x, x, y); // straight shot that rests at (x, y)
const SHORT = { x: 0, aim: 0, power: 0 }; // stops at y = 43, removed (short of the foul line)

function seated() {
  const room = makeRoom();
  act(room, 'A', { kind: 'sit', seat: 'red' });
  act(room, 'B', { kind: 'sit', seat: 'blue' });
  return room;
}
function shootAs(room, id, input) {
  act(room, id, { kind: 'shoot', ...input });
  room.state.busyUntil = 0;
}
const idOf = (room) => (room.state.turn === 'red' ? 'A' : 'B');

// ---- sim ----
test('sim: deterministic, rounded, input validation', () => {
  const pucks = [P(1, 'blue', 0, 95), P(2, 'red', 2, 90)];
  const inp = { x: 0.1, aim: 0.02, power: 0.9 };
  const a = Sim.simulate(pucks, inp, 'red', 3);
  assert.deepStrictEqual(a, Sim.simulate(pucks, inp, 'red', 3));
  assert.ok(a.frames.length > 20);
  assert.strictEqual(Sim.simulate([], { x: NaN, aim: 0, power: 0.5 }, 'red', 1), null);
  assert.strictEqual(Sim.simulate([], { x: 0, aim: 'l', power: 0.5 }, 'red', 1), null);
  assert.strictEqual(Sim.simulate([], null, 'red', 1), null);
  assert.deepStrictEqual(Sim.simulate([], { x: 9, aim: -9, power: 4 }, 'red', 1).input, { x: 1, aim: -1, power: 1 });
});

test('sim: power maps to stop distance; aimAt hits its spot', () => {
  for (const [x, y] of [[0, 70], [3, 90], [-4, 96], [0, Sim.TABLE_L - Sim.R * 0.45]]) {
    const r = Sim.simulate([], draw(x, y), 'red', 1);
    assert.strictEqual(r.after.length, 1);
    assert.ok(Math.abs(r.after[0].y - y) < 0.05 && Math.abs(r.after[0].x - x) < 0.05, JSON.stringify(r.after));
  }
  const angled = Sim.simulate([], Sim.aimAt(-3, 2, 96), 'red', 1).after[0];
  assert.ok(Math.abs(angled.x - 2) < 0.05 && Math.abs(angled.y - 96) < 0.05);
});

test('sim: short pucks removed, off the end and gutters fall', () => {
  const s = Sim.simulate([], SHORT, 'red', 1);
  assert.deepStrictEqual(s.after, []);
  assert.strictEqual(s.removed[0].why, 'short');
  const end = Sim.simulate([], { x: 0, aim: 0, power: 1 }, 'red', 1);
  assert.strictEqual(end.removed[0].why, 'end');
  assert.ok(end.events.some((e) => e.type === 'fall' && e.why === 'end'));
  const side = Sim.simulate([], { x: 1, aim: 1, power: 0.7 }, 'red', 1);
  assert.strictEqual(side.removed[0].why, 'side');
});

test('sim: a firm straight hit knocks the target off and the shooter sticks', () => {
  const pucks = [P(1, 'blue', 0, 95)];
  const inp = Sim.aimAt(0, 0, 95);
  const r = Sim.simulate(pucks, { ...inp, power: 1 }, 'red', 2);
  assert.ok(r.removed.some((p) => p.id === 1 && p.why === 'end'));
  assert.ok(r.events.some((e) => e.type === 'hit'));
  const me = r.after.find((p) => p.id === 2);
  assert.ok(me && me.y > 90, JSON.stringify(r.after));
});

test('sim: zone values and the furthest-puck rule', () => {
  const L = Sim.TABLE_L;
  const R = Sim.R;
  assert.strictEqual(Sim.zoneValue({ x: 0, y: L - R / 2 }), 4);
  assert.strictEqual(Sim.zoneValue({ x: 0, y: Sim.LINE3 + R }), 3);
  assert.strictEqual(Sim.zoneValue({ x: 0, y: Sim.LINE3 + R - 0.01 }), 2); // touching the line counts lower
  assert.strictEqual(Sim.zoneValue({ x: 0, y: Sim.LINE1 + R }), 1);
  assert.strictEqual(Sim.zoneValue({ x: 0, y: 70 }), 0);
  // red: hanger + 3 + 2 beyond blue's best (a 2); red's 1 sits behind blue's best -> 9
  const r = Sim.scoreRound([P(1, 'red', 0, L - 0.5), P(2, 'red', 1, 96), P(3, 'red', 2, 88.5), P(4, 'red', 0, 81),
    P(5, 'blue', -2, 88), P(6, 'blue', 3, 70)]);
  assert.strictEqual(r.scorer, 'red');
  assert.strictEqual(r.points, 9);
  assert.deepStrictEqual(r.counted.map((c) => c.value).sort(), [2, 3, 4]);
  assert.strictEqual(Sim.scoreRound([]).scorer, null);
  assert.strictEqual(Sim.scoreRound([P(1, 'red', 0, 70)]).scorer, null); // furthest but in no zone
  assert.strictEqual(Sim.scoreRound([P(1, 'red', 0, 95), P(2, 'blue', 1, 95)]).scorer, null); // level
});

test('sim: bot shots are valid inputs for every level and never throw', () => {
  const rand = rng(3);
  const pucks = [P(1, 'blue', 0, 95), P(2, 'red', 3, 90), P(3, 'blue', -3, 97)];
  for (const lv of Sim.BOT_LEVELS) {
    const inp = Sim.botShot(pucks, 'red', lv, { rand, left: { red: 2, blue: 1 } });
    assert.ok(Sim.simulate(pucks, inp, 'red', 9), lv);
  }
  assert.ok(Sim.botShot([], 'blue', 'nonsense', { rand }));
});

// ---- bot skill: head-to-head games with the shared sim ----
function botGame(levels, rand, target) {
  const sc = { red: 0, blue: 0 };
  let lead = 'red';
  let id = 1;
  for (let rounds = 0; rounds < 40 && sc.red < target && sc.blue < target; rounds++) {
    let pucks = [];
    let turn = lead;
    const left = { red: 4, blue: 4 };
    while (left.red + left.blue > 0) {
      const inp = Sim.botShot(pucks, turn, levels[turn], { rand, left });
      pucks = Sim.simulate(pucks, inp, turn, id++).after;
      left[turn]--;
      const o = turn === 'red' ? 'blue' : 'red';
      turn = left[o] > 0 ? o : turn;
    }
    const r = Sim.scoreRound(pucks);
    if (r.scorer) { sc[r.scorer] += r.points; lead = r.scorer; } else lead = lead === 'red' ? 'blue' : 'red';
  }
  return sc.red >= target ? 'red' : sc.blue >= target ? 'blue' : null;
}
function winsOf(strong, weak, n, seed) {
  let w = 0;
  for (let i = 0; i < n; i++) {
    const swap = i % 2 === 1;
    const levels = swap ? { red: strong, blue: weak } : { red: weak, blue: strong };
    if (botGame(levels, rng(seed + i * 31), 15) === (swap ? 'red' : 'blue')) w++;
  }
  return w;
}
test('bots: skill gradient — Expert beats Easy, each level beats the one below', () => {
  const n = 10;
  const res = {
    expertVsEasy: winsOf('expert', 'easy', n, 11),
    mediumVsEasy: winsOf('medium', 'easy', n, 12),
    hardVsMedium: winsOf('hard', 'medium', n, 13),
    expertVsHard: winsOf('expert', 'hard', n, 14),
  };
  console.log('     wins out of', n, JSON.stringify(res));
  assert.ok(res.expertVsEasy >= 9, 'expert vs easy');
  assert.ok(res.mediumVsEasy >= 7, 'medium vs easy');
  assert.ok(res.hardVsMedium >= 6, 'hard vs medium');
  assert.ok(res.expertVsHard >= 4, 'expert vs hard');
});

// ---- rules ----
test('rules: alternate shots, 4 each, leader first', () => {
  const room = seated();
  const st = room.state;
  assert.strictEqual(st.phase, 'playing');
  const order = [];
  for (let i = 0; i < 7; i++) { order.push(st.turn); shootAs(room, idOf(room), draw(i % 2 ? -3 : 3, 75 + i)); }
  assert.deepStrictEqual(order, ['red', 'blue', 'red', 'blue', 'red', 'blue', 'red']);
  assert.deepStrictEqual(st.left, { red: 0, blue: 1 });
  assert.strictEqual(st.turn, 'blue');
  assert.strictEqual(st.pucks.length, 7);
});

test('rules: round scoring, scorer leads next round, removed pucks', () => {
  const room = seated();
  const st = room.state;
  // red parks in the 3 zone; blue shoots short every time
  for (let i = 0; i < 8; i++) shootAs(room, idOf(room), st.turn === 'red' ? draw([-4.5, -1.5, 1.5, 4.5][i / 2], 96) : SHORT);
  const rec = lastState(room).lastShot;
  assert.ok(rec.roundEnd);
  assert.strictEqual(rec.roundEnd.scorer, 'red');
  assert.strictEqual(rec.roundEnd.points, 12);
  assert.deepStrictEqual(st.scores, { red: 12, blue: 0 });
  assert.strictEqual(st.round, 2);
  assert.strictEqual(st.turn, 'red');
  assert.strictEqual(st.lead, 'red');
  assert.deepStrictEqual(st.pucks, []);
  assert.deepStrictEqual(st.left, { red: 4, blue: 4 });
  assert.strictEqual(rec.after.length, 4);
  assert.ok(lastState(room).busyUntil > Date.now() + plugin._internal.timing.tally - 100);
  // no score -> the lead alternates
  for (let i = 0; i < 8; i++) shootAs(room, idOf(room), SHORT);
  assert.strictEqual(lastState(room).lastShot.roundEnd.scorer, null);
  assert.strictEqual(st.turn, 'blue');
});

test('rules: reaching the target wins; setTarget 21 only between games', () => {
  const room = makeRoom();
  act(room, 'A', { kind: 'setTarget', target: 21 });
  assert.strictEqual(room.state.target, 21);
  act(room, 'A', { kind: 'setTarget', target: 99 });
  assert.strictEqual(room.state.target, 21);
  act(room, 'A', { kind: 'setTarget', target: 15 });
  act(room, 'A', { kind: 'sit', seat: 'red' });
  act(room, 'B', { kind: 'sit', seat: 'blue' });
  act(room, 'A', { kind: 'setTarget', target: 21 }); // mid-game: ignored
  assert.strictEqual(room.state.target, 15);
  let guard = 0;
  while (room.state.phase === 'playing' && guard++ < 40) {
    const st = room.state;
    const k = 4 - st.left.red;
    shootAs(room, idOf(room), st.turn === 'red' ? draw([-4.5, -1.5, 1.5, 4.5][k], 96) : SHORT);
  }
  const s = lastState(room);
  assert.strictEqual(s.phase, 'game_over');
  assert.strictEqual(s.winner, 'red');
  assert.strictEqual(s.scores.red, 24);
  assert.strictEqual(s.history.length, 2);
  act(room, 'B', { kind: 'shoot', x: 0, aim: 0, power: 0.5 });
  assert.strictEqual(lastReject(room, 'B'), 'not_playing');
});

test('rules: hanger scores 4 and is counted in stats', () => {
  const room = seated();
  for (let i = 0; i < 8; i++) {
    const red = room.state.turn === 'red';
    shootAs(room, idOf(room), red && i === 0 ? draw(0, Sim.TABLE_L - Sim.R * 0.45) : SHORT);
  }
  assert.deepStrictEqual(room.state.scores, { red: 4, blue: 0 });
  assert.strictEqual(room.state.stats.red.hangers, 1);
});

// ---- protocol ----
test('protocol: turn, busy, garbage input, spectators', () => {
  const room = seated();
  act(room, 'B', { kind: 'shoot', x: 0, aim: 0, power: 0.5 });
  assert.strictEqual(lastReject(room, 'B'), 'not_your_turn');
  act(room, 'C', { kind: 'shoot', x: 0, aim: 0, power: 0.5 });
  assert.strictEqual(lastReject(room, 'C'), 'not_your_turn');
  act(room, 'A', { kind: 'shoot', x: 'left', aim: 0, power: 0.5 });
  assert.strictEqual(lastReject(room, 'A'), 'invalid');
  act(room, 'A', { kind: 'shoot', aim: 0, power: 0.5 });
  assert.strictEqual(lastReject(room, 'A'), 'invalid');
  act(room, 'A', { kind: 'shoot', x: 0, aim: 0, power: 0.6 });
  assert.strictEqual(room.state.shotSeq, 1);
  room.state.turn = 'red'; // force red again to test busy
  act(room, 'A', { kind: 'shoot', x: 0, aim: 0, power: 0.6 });
  assert.strictEqual(lastReject(room, 'A'), 'busy');
  assert.strictEqual(room.state.shotSeq, 1);
  for (const junk of [null, 5, 'x', [], { kind: 7 }, { kind: 'sit', seat: 'green' }, { kind: 'setBotLevel', seat: 'red' },
    { kind: 'removeBot', seat: 'red' }, { kind: 'resetGame' }, { kind: 'nope' }]) act(room, 'C', junk);
  plugin.onLeave(room, null);
  plugin.onLeave(room, { clientId: 'C' });
  assert.strictEqual(room.state.phase, 'playing');
  assert.strictEqual(room.state.players.red, 'A');
});

test('protocol: broadcast frames match the shared sim', () => {
  const room = seated();
  const inp = { x: 0.2, aim: -0.1, power: 0.7 };
  const expected = Sim.simulate([], inp, 'red', room.state.nextId);
  act(room, 'A', { kind: 'shoot', ...inp });
  const t = lastState(room).lastShot;
  assert.deepStrictEqual(t.frames, expected.frames);
  assert.deepStrictEqual(t.after, expected.after);
  assert.deepStrictEqual(lastState(room).pucks, expected.after);
  assert.ok(lastState(room).busyUntil > Date.now());
});

test('seats: one seat each; leaving resets; rematch swaps colours', () => {
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
  act(room, 'C', { kind: 'resetGame' }); // spectators can't
  assert.strictEqual(room.state.gameId, g);
  act(room, 'A', { kind: 'resetGame' });
  assert.deepStrictEqual(room.state.players, { red: 'B', blue: 'A' });
  assert.strictEqual(room.state.phase, 'playing');
  assert.strictEqual(room.state.gameId, g + 1);
  assert.deepStrictEqual(room.state.scores, { red: 0, blue: 0 });
  shootAs(room, 'B', draw(0, 90));
  act(room, 'A', { kind: 'leaveSeat' }); // mid-game
  assert.strictEqual(room.state.phase, 'waiting');
  assert.strictEqual(room.state.players.blue, null);
  assert.deepStrictEqual(room.state.pucks, []);
});

test('bots: level change, removal, bot-vs-bot game completes, human leaving cancels', async () => {
  const t = plugin._internal.timing;
  const saved = { ...t };
  Object.assign(t, { min: 0, max: 1, after: -100000, tally: 0 });
  try {
    const room = makeRoom();
    act(room, 'A', { kind: 'sit', seat: 'blue', bot: true, level: 'easy' });
    act(room, 'A', { kind: 'setBotLevel', seat: 'blue', level: 'expert' });
    assert.strictEqual(room.state.botLevels.blue, 'expert');
    act(room, 'A', { kind: 'removeBot', seat: 'blue' });
    assert.strictEqual(room.state.players.blue, null);

    act(room, 'A', { kind: 'sit', seat: 'red', bot: true, level: 'medium' });
    act(room, 'A', { kind: 'sit', seat: 'blue', bot: true, level: 'medium' });
    for (let i = 0; i < 2000 && room.state.phase === 'playing'; i++) await wait(5);
    assert.strictEqual(room.state.phase, 'game_over');
    assert.ok(room.state.scores[room.state.winner] >= 15);

    const hb = makeRoom();
    act(hb, 'A', { kind: 'sit', seat: 'red' });
    act(hb, 'A', { kind: 'sit', seat: 'blue', bot: true, level: 'hard' });
    shootAs(hb, 'A', draw(0, 95));
    assert.strictEqual(hb.state.turn, 'blue');
    for (let i = 0; i < 200 && hb.state.stats.blue.shots === 0; i++) await wait(5);
    assert.strictEqual(hb.state.stats.blue.shots, 1);
    assert.strictEqual(hb.state.turn, 'red'); // bot waits for the human
    plugin.onLeave(hb, { clientId: 'A' });
    const seq = hb.state.shotSeq;
    await wait(30);
    assert.strictEqual(hb.state.shotSeq, seq);
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
