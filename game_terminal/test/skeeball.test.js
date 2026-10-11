// Skee-Ball: shared sim (determinism, validation, every hole reachable, bot skill gradient), rules
// (3-ball turns, 9 each, sudden death, draw), protocol guards, seats/bots/rematch.
// Run: node test/skeeball.test.js
'use strict';

const assert = require('assert');
const plugin = require('../server/games/skeeball');
const Sim = require('../public/games/skeeball/sim.js');

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

const GUTTER = { aim: 0, power: 0 };
const FIFTY = Sim.aimFor('50');
const seated = () => {
  const room = makeRoom();
  act(room, 'A', { kind: 'sit', seat: 'red' });
  act(room, 'B', { kind: 'sit', seat: 'blue' });
  return room;
};
function rollAs(room, id, input) {
  act(room, id, { kind: 'roll', ...input });
  room.state.busyUntil = 0;
}
// Play out regulation: red/blue each roll their given inputs in order (3-ball turns).
function playBalls(room, n, inputFor) {
  for (let i = 0; i < n && room.state.phase === 'playing'; i++) {
    const c = room.state.turn;
    rollAs(room, room.state.players[c], inputFor(c, i));
  }
}

// ---- sim ----
test('sim: deterministic — same input gives identical frames', () => {
  const a = Sim.simulate({ aim: 0.13, power: 0.6 });
  const b = Sim.simulate({ aim: 0.13, power: 0.6 });
  assert.deepStrictEqual(a, b);
  assert.ok(a.frames.length > 30 && a.frames.length <= 7 * 60 + 40);
});

test('sim: rejects non-finite input, clamps out-of-range', () => {
  assert.strictEqual(Sim.simulate({ aim: NaN, power: 0.5 }), null);
  assert.strictEqual(Sim.simulate({ aim: 0, power: 'x' }), null);
  assert.strictEqual(Sim.simulate(null), null);
  const r = Sim.simulate({ aim: 9, power: -3 });
  assert.deepStrictEqual(r.input, { aim: 1, power: 0 });
  assert.strictEqual(r.outcome, 'gutter');
  assert.strictEqual(r.points, 0);
});

test('sim: bot aim table hits 50 and both 100 pockets', () => {
  assert.strictEqual(Sim.simulate(Sim.aimFor('50')).points, 50);
  assert.strictEqual(Sim.simulate(Sim.aimFor('L')).hole, 'L');
  assert.strictEqual(Sim.simulate(Sim.aimFor('R')).hole, 'R');
  assert.strictEqual(Sim.simulate(Sim.aimFor('L')).points, 100);
});

test('sim: every ring value is reachable straight up the middle, and the score has a drop frame', () => {
  const seen = new Set();
  for (let p = 0; p <= 1.0001; p += 0.01) {
    const r = Sim.simulate({ aim: 0, power: p });
    seen.add(r.points);
    if (r.outcome === 'score') {
      assert.ok(r.dropFrame > 0 && r.dropFrame < r.frames.length);
      assert.ok(r.events.some((e) => e.type === 'drop'));
    }
  }
  for (const pts of [0, 10, 20, 30, 40, 50]) assert.ok(seen.has(pts), `no roll scored ${pts}`);
});

test('sim: bot skill rises with level; expert sinks 100s often', () => {
  const avg = {};
  let hundreds = 0;
  for (const lvl of ['easy', 'medium', 'hard', 'expert']) {
    const rand = rng(7);
    let sum = 0;
    const N = 150;
    for (let i = 0; i < N; i++) {
      const r = Sim.simulate(Sim.botRoll(lvl, rand));
      sum += r.points;
      if (lvl === 'expert' && r.points === 100) hundreds++;
    }
    avg[lvl] = (sum / N) * 9;
  }
  console.log('     points per 9 balls:', Object.entries(avg).map(([k, v]) => `${k} ${Math.round(v)}`).join(', '),
    `· expert 100s ${Math.round((hundreds / 150) * 100)}%`);
  assert.ok(avg.easy < avg.medium && avg.medium < avg.hard && avg.hard < avg.expert, JSON.stringify(avg));
  assert.ok(hundreds / 150 > 0.45, `expert 100 rate ${hundreds / 150}`);
});

// ---- rules ----
test('rules: red rolls 3, then blue 3, three rounds, 9 balls each', () => {
  const order = [];
  for (let n = 0; n < 18; n++) order.push(plugin._internal.shooterOf(n)[0]);
  assert.strictEqual(order.join(''), 'rrrbbbrrrbbbrrrbbb');
  const room = seated();
  playBalls(room, 18, (c) => (c === 'red' ? FIFTY : GUTTER));
  const st = lastState(room);
  assert.strictEqual(st.balls.red.length, 9);
  assert.strictEqual(st.balls.blue.length, 9);
  assert.strictEqual(st.phase, 'game_over');
  assert.strictEqual(st.winner, 'red');
  assert.strictEqual(st.totals.red, 450);
  assert.strictEqual(st.totals.blue, 0);
});

test('rules: turnOver flags the third ball of a turn', () => {
  const room = seated();
  rollAs(room, 'A', GUTTER);
  assert.strictEqual(room.state.lastRoll.turnOver, false);
  rollAs(room, 'A', GUTTER);
  rollAs(room, 'A', GUTTER);
  assert.strictEqual(room.state.lastRoll.turnOver, true);
  assert.strictEqual(room.state.turn, 'blue');
});

test('rules: a tie goes to sudden death, and a tie after 3 extra balls is a draw', () => {
  const room = seated();
  playBalls(room, 18, () => GUTTER);
  assert.strictEqual(room.state.phase, 'playing');
  assert.strictEqual(room.state.sudden, 1);
  assert.strictEqual(room.state.turn, 'red');
  // sudden death: red scores, blue misses -> red wins
  const won = JSON.parse(JSON.stringify(room.state));
  rollAs(room, 'A', FIFTY);
  rollAs(room, 'B', GUTTER);
  assert.strictEqual(room.state.winner, 'red');
  // replay from the tie: everyone keeps missing -> draw
  room.state = won;
  playBalls(room, 6, () => GUTTER);
  assert.strictEqual(room.state.phase, 'game_over');
  assert.strictEqual(room.state.winner, 'draw');
  assert.strictEqual(room.state.balls.red.length, 12);
});

// ---- protocol ----
test('protocol: not your turn, busy, invalid, not playing, spectators, garbage', () => {
  const room = makeRoom();
  act(room, 'A', { kind: 'roll', aim: 0, power: 0.5 });
  assert.strictEqual(lastReject(room, 'A'), 'not_playing');
  act(room, 'A', { kind: 'sit', seat: 'red' });
  act(room, 'B', { kind: 'sit', seat: 'blue' });
  act(room, 'B', { kind: 'roll', aim: 0, power: 0.5 });
  assert.strictEqual(lastReject(room, 'B'), 'not_your_turn');
  act(room, 'S', { kind: 'roll', aim: 0, power: 0.5 });
  assert.strictEqual(lastReject(room, 'S'), 'not_your_turn');
  act(room, 'A', { kind: 'roll', aim: 'left', power: 0.5 });
  assert.strictEqual(lastReject(room, 'A'), 'invalid');
  act(room, 'A', { kind: 'roll', aim: 0, power: 0.5 });
  assert.strictEqual(room.state.balls.red.length, 1);
  act(room, 'A', { kind: 'roll', aim: 0, power: 0.5 }); // previous ball still rolling
  assert.strictEqual(lastReject(room, 'A'), 'busy');
  assert.strictEqual(room.state.balls.red.length, 1);
  for (const junk of [null, undefined, 5, 'x', {}, { kind: 7 }, { kind: 'sit', seat: 'green' }, { kind: 'sit' },
    { kind: 'roll', aim: Infinity, power: 1 }, { kind: 'setBotLevel', seat: 'red', level: 'god' }, { kind: 'resetGame' },
    { kind: 'removeBot', seat: 'red' }, { kind: 'nope' }, { kind: 'roll', aim: { a: 1 }, power: [1] }]) {
    act(room, 'S', junk);
    act(room, 'A', junk);
  }
  assert.strictEqual(room.state.players.red, 'A');
  assert.strictEqual(room.state.phase, 'playing');
  // the snapshot is serialisable and has everything a fresh spectator needs
  const snap = JSON.parse(JSON.stringify(plugin.serializeSnapshot(room)));
  assert.strictEqual(snap.lastRoll.by, 'red');
  assert.ok(Array.isArray(snap.lastRoll.frames));
  assert.strictEqual(plugin.isRoomFull(room), false);
});

test('protocol: broadcast roll matches the shared sim exactly', () => {
  const room = seated();
  act(room, 'A', { kind: 'roll', aim: -0.2, power: 0.55 });
  const rec = lastState(room).lastRoll;
  const local = Sim.simulate({ aim: -0.2, power: 0.55 });
  assert.deepStrictEqual(rec.frames, local.frames);
  assert.strictEqual(rec.points, local.points);
  assert.ok(lastState(room).busyUntil > Date.now());
});

// ---- seats / bots ----
test('seats: one seat each; leaving mid-game resets; rematch swaps colours', () => {
  const room = seated();
  act(room, 'A', { kind: 'sit', seat: 'blue' }); // taken
  assert.strictEqual(room.state.players.blue, 'B');
  rollAs(room, 'A', FIFTY);
  act(room, 'A', { kind: 'leaveSeat' });
  assert.strictEqual(room.state.phase, 'waiting');
  assert.strictEqual(room.state.players.red, null);
  assert.strictEqual(room.state.balls.red.length, 0);
  act(room, 'C', { kind: 'sit', seat: 'red' });
  assert.strictEqual(room.state.phase, 'playing');
  plugin.onLeave(room, { clientId: 'Z' }); // a spectator leaving changes nothing
  assert.strictEqual(room.state.phase, 'playing');
  act(room, 'C', { kind: 'resetGame' }); // not over yet
  assert.strictEqual(room.state.players.red, 'C');
  playBalls(room, 18, (c) => (c === 'red' ? FIFTY : GUTTER));
  assert.strictEqual(room.state.phase, 'game_over');
  const gid = room.state.gameId;
  act(room, 'S', { kind: 'resetGame' }); // spectators can't
  assert.strictEqual(room.state.gameId, gid);
  act(room, 'B', { kind: 'resetGame' });
  assert.deepStrictEqual(room.state.players, { red: 'B', blue: 'C' });
  assert.strictEqual(room.state.phase, 'playing');
  assert.strictEqual(room.state.balls.red.length, 0);
});

test('bots: level change, removal, bot-vs-bot completes, human leaving cancels the bot', async () => {
  const t = plugin._internal.timing;
  const saved = { ...t };
  Object.assign(t, { min: 0, max: 1, after: -100000 }); // no roll wait in tests
  try {
    const room = makeRoom();
    act(room, 'A', { kind: 'sit', seat: 'blue', bot: true, level: 'easy' });
    act(room, 'A', { kind: 'setBotLevel', seat: 'blue', level: 'expert' });
    assert.strictEqual(room.state.botLevels.blue, 'expert');
    act(room, 'A', { kind: 'removeBot', seat: 'blue' });
    assert.strictEqual(room.state.players.blue, null);

    act(room, 'A', { kind: 'sit', seat: 'red', bot: true, level: 'expert' });
    act(room, 'A', { kind: 'sit', seat: 'blue', bot: true, level: 'easy' });
    for (let i = 0; i < 600 && room.state.phase === 'playing'; i++) await wait(5);
    assert.strictEqual(room.state.phase, 'game_over');
    assert.ok(['red', 'blue', 'draw'].includes(room.state.winner));
    assert.ok(room.state.balls.red.length >= 9 && room.state.balls.blue.length >= 9);

    const hb = makeRoom();
    act(hb, 'A', { kind: 'sit', seat: 'red' });
    act(hb, 'A', { kind: 'sit', seat: 'blue', bot: true, level: 'medium' });
    for (let i = 0; i < 3; i++) rollAs(hb, 'A', GUTTER);
    assert.strictEqual(hb.state.turn, 'blue');
    for (let i = 0; i < 200 && hb.state.balls.blue.length < 3; i++) await wait(5);
    assert.strictEqual(hb.state.balls.blue.length, 3); // bot rolled its whole turn
    assert.strictEqual(hb.state.turn, 'red'); // and stopped
    hb.state.busyUntil = 0;
    rollAs(hb, 'A', GUTTER);
    rollAs(hb, 'A', GUTTER);
    rollAs(hb, 'A', GUTTER);
    plugin.onLeave(hb, { clientId: 'A' }); // leaving cancels the bot's pending rolls
    const seq = hb.state.rollSeq;
    await wait(40);
    assert.strictEqual(hb.state.rollSeq, seq);
    assert.strictEqual(hb.state.phase, 'waiting');
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
      console.log(`FAIL ${name}\n     ${e.stack.split('\n').slice(0, 8).join('\n     ')}`);
    }
  }
  console.log(failures ? `\n${failures} failing` : `\nall ${tests.length} passing`);
  process.exit(failures ? 1 : 0);
})();
