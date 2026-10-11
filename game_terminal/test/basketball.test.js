// Basketball: shared sim (determinism, hoop motion, solver), run scoring (swish, money ball, on
// fire, moving hoop), bot skill gradient, protocol guards, run sequence (runs, overtime, draw),
// seats/bots/rematch. Run: node test/basketball.test.js
'use strict';

const assert = require('assert');
const plugin = require('../server/games/basketball');
const Sim = require('../public/games/basketball/sim.js');

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

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const STATIC = [{ t: 0, amp: 0, period: 0 }];
const MOVING = [{ t: 0, amp: 0, period: 0 }, { t: 1000, amp: 0.8, period: 2600 }];
const MISS = { aim: -1, power: 0 };

const T = plugin._internal.timing;
const SAVED = { ...T, react: T.react.slice() };
const restore = () => Object.assign(T, SAVED, { react: SAVED.react.slice() });

// Seated human game with the run already live (no countdown).
function seated() {
  Object.assign(T, { countdown: 0 });
  const room = makeRoom();
  act(room, 'A', { kind: 'sit', seat: 'red' });
  act(room, 'B', { kind: 'sit', seat: 'blue' });
  restore();
  return room;
}
// Pretend `ms` of the run clock has passed (so the next ball is in hand).
const advance = (room, ms) => { room.state.run.startAt -= ms; room.state.run.endAt -= ms; };
const runAt = (room) => Date.now() - room.state.run.startAt;
function shootAs(room, id, input) {
  advance(room, Sim.COOLDOWN_MS + 50);
  const at = runAt(room);
  act(room, id, { kind: 'shoot', aim: input.aim, power: input.power, at });
  return at;
}
const makeInput = (room) => Sim.solveShot(room.state.run.sched, runAt(room) + Sim.COOLDOWN_MS + 50);

// ---- sim ----
test('sim: deterministic — same input + time gives identical frames', () => {
  const a = Sim.simulate(MOVING, { aim: 0.13, power: 0.55 }, 4321);
  const b = Sim.simulate(MOVING, { aim: 0.13, power: 0.55 }, 4321);
  assert.deepStrictEqual(a, b);
  assert.ok(a.frames.length > 30);
});

test('sim: rejects non-finite input, clamps out-of-range', () => {
  assert.strictEqual(Sim.simulate(STATIC, { aim: NaN, power: 0.5 }, 0), null);
  assert.strictEqual(Sim.simulate(STATIC, { aim: 'x', power: 0.5 }, 0), null);
  assert.strictEqual(Sim.simulate(STATIC, { aim: 0, power: 0.5 }, 'soon'), null);
  const r = Sim.simulate(STATIC, { aim: 9, power: -3 }, 0);
  assert.deepStrictEqual(r.input, { aim: 1, power: 0 });
  assert.strictEqual(r.made, false);
});

test('sim: the hoop is still, then slides smoothly once moving (no jumps)', () => {
  assert.strictEqual(Sim.hoopX(STATIC, 12345), 0);
  assert.strictEqual(Sim.hoopX(MOVING, 999), 0);
  const sched = [{ t: 0, amp: 0, period: 0 }, { t: 3000, amp: 0.45, period: 3400 }, { t: 9000, amp: 0.8, period: 2600 }];
  let max = 0;
  let prev = Sim.hoopX(sched, 0);
  let peak = 0;
  for (let t = 1; t < 20000; t++) {
    const x = Sim.hoopX(sched, t);
    max = Math.max(max, Math.abs(x - prev));
    peak = Math.max(peak, Math.abs(x));
    prev = x;
  }
  assert.ok(max < 0.003, `largest 1 ms step ${max}`);
  assert.ok(peak > 0.75 && peak <= 0.8 + 1e-9, `peak ${peak}`);
});

test('sim: a centred shot swishes; the solver also hits a moving hoop', () => {
  const r = Sim.simulate(STATIC, Sim.solveShot(STATIC, 0), 0);
  assert.ok(r.made && r.swish);
  assert.ok(r.events.some((e) => e.type === 'make'));
  let made = 0;
  let n = 0;
  for (let at = 1500; at < 30000; at += 211) {
    n++;
    if (Sim.simulate(MOVING, Sim.solveShot(MOVING, at), at).made) made++;
  }
  assert.ok(made / n > 0.95, `moving ${made}/${n}`);
});

test('sim: too soft / too hard / way off line all miss; a rim-in is not a swish', () => {
  const sol = Sim.solveShot(STATIC, 0);
  assert.strictEqual(Sim.simulate(STATIC, { aim: sol.aim, power: sol.power - 0.2 }, 0).made, false);
  assert.strictEqual(Sim.simulate(STATIC, { aim: sol.aim, power: 1 }, 0).made, false);
  assert.strictEqual(Sim.simulate(STATIC, { aim: sol.aim + 0.4, power: sol.power }, 0).made, false);
  let found = false;
  for (let p = sol.power - 0.06; p < sol.power + 0.06 && !found; p += 0.002) {
    const r = Sim.simulate(STATIC, { aim: 0, power: p }, 0);
    if (r.made && !r.swish) { found = true; assert.ok(r.events.some((e) => e.type === 'rim' || e.type === 'board')); }
  }
  assert.ok(found, 'no rim-in found near the sweet spot');
});

// ---- run scoring ----
test('scoring: make 2, swish 3, money ball x2, ON FIRE x2 after 3 in a row', () => {
  const run = Sim.newRun();
  const swish = (at) => Sim.shoot(run, Sim.solveShot(run.sched, at), at);
  const a = swish(0);
  assert.strictEqual(a.points, 3);
  assert.strictEqual(a.swish, true);
  assert.strictEqual(a.money, false);
  swish(500);
  const c = swish(1000);
  assert.strictEqual(c.fire, false);
  assert.strictEqual(c.streak, 3);
  const d = swish(1500); // 4th ball, on fire
  assert.strictEqual(d.fire, true);
  assert.strictEqual(d.points, 6);
  const e = swish(2000); // 5th ball = money ball, on fire
  assert.strictEqual(e.money, true);
  assert.strictEqual(e.points, 12);
  assert.strictEqual(run.score, 3 + 3 + 3 + 6 + 12);
  const m = Sim.shoot(run, MISS, 2600);
  assert.strictEqual(m.made, false);
  assert.strictEqual(m.points, 0);
  assert.strictEqual(run.streak, 0);
  const f = swish(3200);
  assert.strictEqual(f.fire, false);
  assert.strictEqual(f.points, 3);
  assert.strictEqual(run.bestStreak, 5);
  assert.strictEqual(run.makes, 6);
  assert.strictEqual(run.shots, 7);
});

test('scoring: cooldown, not started, time up', () => {
  const run = Sim.newRun(10000);
  assert.strictEqual(Sim.shoot(run, MISS, -5).error, 'not_started');
  assert.ok(!Sim.shoot(run, MISS, 0).error);
  assert.strictEqual(Sim.shoot(run, MISS, Sim.COOLDOWN_MS - 1).error, 'busy');
  assert.ok(!Sim.shoot(run, MISS, Sim.COOLDOWN_MS).error);
  assert.strictEqual(Sim.shoot(run, MISS, 10001).error, 'time_up');
  assert.ok(!Sim.shoot(run, MISS, 10000).error); // buzzer beater
  assert.strictEqual(Sim.shoot(run, { aim: 'x', power: 1 }, 20000).error, 'time_up');
  assert.strictEqual(run.shots, 3);
});

test('scoring: hoop starts moving after 5 makes, faster after 12 — only once balls have landed', () => {
  const run = Sim.newRun();
  let at = 0;
  const recs = [];
  while (run.makes < 12) {
    recs.push(Sim.shoot(run, Sim.solveShot(run.sched, at), at));
    at += 500;
  }
  assert.strictEqual(run.level, 2);
  assert.strictEqual(run.sched.length, 3);
  const up1 = recs.find((r) => r.levelUp === 1);
  const up2 = recs.find((r) => r.levelUp === 2);
  assert.ok(up1 && up2);
  // every shot fired before a level-up has finished its flight before the hoop starts moving
  for (const up of [up1, up2]) {
    for (const r of recs.filter((x) => x.at <= up.at)) {
      assert.ok(r.at + (r.frames.length - 1) * Sim.FRAME_MS <= up.levelAt + 1, 'hoop moved under a ball in the air');
    }
  }
  assert.ok(Sim.hoopX(run.sched, up1.levelAt + 1500) !== 0);
});

// ---- bots ----
function botRun(level, rand, length) {
  const run = Sim.newRun(length);
  let at = 400 + Math.floor(rand() * 500);
  while (at <= run.length) {
    const r = Sim.shoot(run, Sim.botShot(run, level, at, rand), at);
    assert.ok(!r.error, r.error);
    at += Sim.botGap(level, rand);
  }
  return run;
}

test('bots: make rate and score rise with level; Expert reliably beats Easy', () => {
  const N = 24;
  const stats = LEVELS.map((lv, i) => {
    const rand = rng(777 + i);
    let makes = 0; let shots = 0; const scores = [];
    for (let k = 0; k < N; k++) {
      const run = botRun(lv, rand);
      makes += run.makes; shots += run.shots; scores.push(run.score);
    }
    return { lv, pct: makes / shots, avg: scores.reduce((a, b) => a + b, 0) / N, scores };
  });
  console.log(`     ${stats.map((s) => `${s.lv} ${(s.pct * 100).toFixed(0)}% avg ${s.avg.toFixed(0)}`).join(' · ')}`);
  for (let i = 1; i < stats.length; i++) {
    assert.ok(stats[i].pct > stats[i - 1].pct, 'make % not increasing');
    assert.ok(stats[i].avg > stats[i - 1].avg, 'score not increasing');
  }
  assert.ok(stats[0].pct > 0.15 && stats[3].pct < 0.92);
  // head to head: expert vs easy, run by run
  let wins = 0;
  for (let k = 0; k < N; k++) if (stats[3].scores[k] > stats[0].scores[k]) wins++;
  assert.ok(wins >= N - 1, `expert beat easy ${wins}/${N}`);
});

// ---- protocol ----
test('protocol: shots validated (turn, spectators, types, busy, countdown, waiting)', () => {
  const waiting = makeRoom();
  act(waiting, 'A', { kind: 'shoot', aim: 0, power: 0.5, at: 0 });
  assert.strictEqual(lastReject(waiting, 'A'), 'not_playing');

  const room = makeRoom(); // default 3 s countdown
  act(room, 'A', { kind: 'sit', seat: 'red' });
  act(room, 'B', { kind: 'sit', seat: 'blue' });
  assert.strictEqual(room.state.phase, 'playing');
  assert.strictEqual(room.state.run.shooter, 'red');
  act(room, 'A', { kind: 'shoot', aim: 0, power: 0.5, at: 0 });
  assert.strictEqual(lastReject(room, 'A'), 'not_started');
  advance(room, 3000);
  act(room, 'B', { kind: 'shoot', aim: 0, power: 0.5, at: 100 });
  assert.strictEqual(lastReject(room, 'B'), 'not_your_turn');
  act(room, 'C', { kind: 'shoot', aim: 0, power: 0.5 });
  assert.strictEqual(lastReject(room, 'C'), 'not_your_turn');
  act(room, 'A', { kind: 'shoot', aim: 'left', power: 0.5 });
  assert.strictEqual(lastReject(room, 'A'), 'invalid');
  act(room, 'A', { kind: 'shoot', aim: 0, power: null });
  assert.strictEqual(lastReject(room, 'A'), 'invalid');
  act(room, 'A', { kind: 'shoot', aim: 0, power: 0.5, at: 'now' }); // bad `at` -> server clock
  assert.strictEqual(room.state.shotSeq, 1);
  act(room, 'A', { kind: 'shoot', aim: 0, power: 0.5 });
  assert.strictEqual(lastReject(room, 'A'), 'busy');
  assert.strictEqual(room.state.shotSeq, 1);
  // garbage never throws
  for (const g of [null, 5, 'x', [], {}, { kind: 7 }, { kind: 'sit', seat: 'green' }, { kind: 'shoot', aim: Infinity, power: 1 },
    { kind: 'setBotLevel', seat: 'red', level: 'god' }, { kind: 'removeBot', seat: 'red' }, { kind: 'resetGame' }, { kind: '__proto__' }]) {
    act(room, 'A', g);
    act(room, 'Z', g);
  }
  plugin.onLeave(room, null);
  plugin.onLeave(room, {});
  assert.strictEqual(room.state.phase, 'playing');
});

test('protocol: claimed release time is clamped to the server clock', () => {
  const room = seated();
  advance(room, 5000);
  act(room, 'A', { kind: 'shoot', aim: 0, power: 0.5, at: 0 }); // claims 5 s ago
  const s1 = lastState(room).lastShot;
  assert.ok(Math.abs(s1.at - (runAt(room) - 1200)) <= 20, `at ${s1.at}`);
  advance(room, 2000);
  act(room, 'A', { kind: 'shoot', aim: 0, power: 0.5, at: 1e9 }); // claims the future
  const s2 = lastState(room).lastShot;
  assert.ok(Math.abs(s2.at - (runAt(room) + 200)) <= 20, `at ${s2.at}`);
});

test('protocol: server broadcasts authoritative frames matching the shared sim; scores add up', () => {
  const room = seated();
  const inp = makeInput(room);
  const at = shootAs(room, 'A', inp);
  const s = lastState(room);
  const expected = Sim.simulate(STATIC, inp, at);
  assert.deepStrictEqual(s.lastShot.frames, expected.frames);
  assert.strictEqual(s.lastShot.made, true);
  assert.strictEqual(s.lastShot.by, 'red');
  assert.strictEqual(s.scores.red, 3);
  assert.strictEqual(s.run.score, 3);
  shootAs(room, 'A', MISS);
  assert.strictEqual(lastState(room).lastShot.made, false);
  assert.strictEqual(lastState(room).scores.red, 3);
  assert.strictEqual(lastState(room).run.shots, 2);
});

// ---- run sequence ----
test('runs: red then blue; higher total wins', () => {
  const room = seated();
  shootAs(room, 'A', makeInput(room));
  plugin._internal.finishRun(room);
  assert.strictEqual(room.state.run.shooter, 'blue');
  assert.strictEqual(room.state.run.idx, 1);
  assert.strictEqual(room.state.runs.length, 1);
  assert.strictEqual(room.state.runs[0].score, 3);
  act(room, 'A', { kind: 'shoot', aim: 0, power: 0.5 });
  assert.strictEqual(lastReject(room, 'A'), 'not_your_turn');
  advance(room, 4000); // past the countdown
  shootAs(room, 'B', makeInput(room));
  shootAs(room, 'B', makeInput(room));
  plugin._internal.finishRun(room);
  const s = lastState(room);
  assert.strictEqual(s.phase, 'game_over');
  assert.strictEqual(s.winner, 'blue');
  assert.deepStrictEqual(s.scores, { red: 3, blue: 6 });
});

test('runs: a tie goes to sudden-death overtime; still tied after 3 OTs is a draw', () => {
  const room = seated();
  plugin._internal.finishRun(room);
  plugin._internal.finishRun(room); // 0 - 0
  assert.strictEqual(room.state.phase, 'playing');
  assert.strictEqual(room.state.otRound, 1);
  assert.strictEqual(room.state.run.ot, true);
  assert.strictEqual(room.state.run.shooter, 'red');
  assert.strictEqual(room.state.run.length, Sim.OT_MS);
  for (let i = 0; i < 2 * plugin._internal.MAX_OT; i++) plugin._internal.finishRun(room);
  assert.strictEqual(room.state.phase, 'game_over');
  assert.strictEqual(room.state.winner, 'draw');
  assert.strictEqual(room.state.runs.length, 2 + 2 * plugin._internal.MAX_OT);
});

test('runs: an overtime make wins it', () => {
  const room = seated();
  plugin._internal.finishRun(room);
  plugin._internal.finishRun(room);
  advance(room, 4000);
  shootAs(room, 'A', makeInput(room));
  plugin._internal.finishRun(room);
  plugin._internal.finishRun(room);
  assert.strictEqual(room.state.phase, 'game_over');
  assert.strictEqual(room.state.winner, 'red');
});

test('runs: real timers end each run and the game (short runs)', async () => {
  Object.assign(T, { countdown: 20, land: 20, runMs: 120, otMs: 60 });
  try {
    const room = makeRoom();
    act(room, 'A', { kind: 'sit', seat: 'red' });
    act(room, 'B', { kind: 'sit', seat: 'blue' });
    for (let i = 0; i < 200 && room.state.phase === 'playing'; i++) await wait(10);
    assert.strictEqual(room.state.phase, 'game_over');
    assert.strictEqual(room.state.winner, 'draw'); // nobody shot
  } finally { restore(); }
});

// ---- seats & bots ----
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
  act(room, 'C', { kind: 'resetGame' }); // spectators can't
  assert.strictEqual(room.state.phase, 'game_over');
  act(room, 'A', { kind: 'resetGame' });
  assert.strictEqual(room.state.players.red, 'B');
  assert.strictEqual(room.state.players.blue, 'A');
  assert.strictEqual(room.state.phase, 'playing');
  assert.ok(room.state.gameId > g);
  assert.deepStrictEqual(room.state.scores, { red: 0, blue: 0 });
  assert.strictEqual(room.state.run.shooter, 'red');
  plugin.onLeave(room, { clientId: 'A' });
  assert.strictEqual(room.state.phase, 'waiting');
  assert.strictEqual(room.state.players.blue, null);
  assert.strictEqual(room.state.run, null);
  act(room, 'B', { kind: 'leaveSeat' });
  assert.strictEqual(room.state.players.red, null);
});

test('bots: level change, removal, bot-vs-bot game completes, leaving cancels the bot', async () => {
  Object.assign(T, { countdown: 0, land: 0, react: [0, 1], runMs: 2200, otMs: 1200 });
  try {
    const room = makeRoom();
    act(room, 'A', { kind: 'sit', seat: 'blue', bot: true, level: 'easy' });
    act(room, 'A', { kind: 'setBotLevel', seat: 'blue', level: 'expert' });
    assert.strictEqual(room.state.botLevels.blue, 'expert');
    act(room, 'A', { kind: 'removeBot', seat: 'blue' });
    assert.strictEqual(room.state.players.blue, null);

    act(room, 'A', { kind: 'sit', seat: 'red', bot: true, level: 'expert' });
    act(room, 'A', { kind: 'sit', seat: 'blue', bot: true, level: 'expert' });
    for (let i = 0; i < 1500 && room.state.phase === 'playing'; i++) await wait(10);
    assert.strictEqual(room.state.phase, 'game_over');
    assert.ok(['red', 'blue', 'draw'].includes(room.state.winner));
    const shots = room.state.runs.map((r) => r.shots);
    assert.ok(shots[0] >= 2 && shots[1] >= 2, `bots shot ${shots}`);

    // human vs bot: the bot shoots its run after the human's run ends
    const hb = makeRoom();
    act(hb, 'A', { kind: 'sit', seat: 'red' });
    act(hb, 'A', { kind: 'sit', seat: 'blue', bot: true, level: 'medium' });
    plugin._internal.finishRun(hb);
    assert.strictEqual(hb.state.run.shooter, 'blue');
    for (let i = 0; i < 300 && hb.state.run.shots === 0; i++) await wait(5);
    assert.ok(hb.state.run.shots >= 1);
    plugin.onLeave(hb, { clientId: 'A' });
    const seq = hb.state.shotSeq;
    await wait(1200);
    assert.strictEqual(hb.state.shotSeq, seq);
    assert.strictEqual(hb.state.phase, 'waiting');
  } finally { restore(); }
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
