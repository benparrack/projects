// Mini Golf: shared sim (determinism, input normalisation, hazards), rules (alternating strokes,
// water penalty, pickup, honours, game over / draw), protocol guards, seats/bots/rematch, and the
// bot skill gradient. Run: node test/minigolf.test.js
'use strict';

const assert = require('assert');
const plugin = require('../server/games/minigolf');
const Sim = require('../public/games/minigolf/sim.js');

const { timing, applyShot, applyPush, nextKnock, scheduleKnock, total, FRAME_MS } = plugin._internal;
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
function seated() {
  const room = makeRoom();
  act(room, 'A', { kind: 'sit', seat: 'red' });
  act(room, 'B', { kind: 'sit', seat: 'blue' });
  return room;
}
const idOf = (c) => (c === 'red' ? 'A' : 'B');
const TINY = { angle: 0, power: Sim.MIN_POWER }; // barely moves, never sinks from the tee
function puttAs(room, color, input) {
  room.state.busyUntil = 0;
  act(room, idOf(color), { kind: 'putt', ...input });
}
// find a shot on hole `hi` from `from` with the wanted outcome (grid search)
function findShot(hi, from, outcome, phase = 0) {
  for (let p = 0.1; p <= 1; p += 0.05) {
    for (let a = -Math.PI; a < Math.PI; a += 0.02) {
      const r = Sim.simulate(hi, from, { angle: a, power: p }, phase);
      if (r.outcome === outcome) return r.input;
    }
  }
  return null;
}
const teeOf = (hi) => ({ x: Sim.HOLES[hi].tee[0], y: Sim.HOLES[hi].tee[1] });

// ---- sim ----
test('sim: 9 holes, par 27, trig accurate', () => {
  assert.strictEqual(Sim.HOLES.length, 9);
  assert.strictEqual(Sim.TOTAL_PAR, 27);
  for (let a = -Math.PI; a <= Math.PI; a += 0.013) {
    assert.ok(Math.abs(Sim.dsin(a) - Math.sin(a)) < 1e-9);
    assert.ok(Math.abs(Sim.dcos(a) - Math.cos(a)) < 1e-9);
  }
});

test('sim: deterministic and quantised', () => {
  const r = rng(7);
  for (let i = 0; i < 40; i++) {
    const hi = i % 9;
    const inp = { angle: r() * 7 - 3.5, power: r() };
    const ph = Math.floor(r() * 60000);
    const a = Sim.simulate(hi, teeOf(hi), inp, ph);
    const b = Sim.simulate(hi, teeOf(hi), JSON.parse(JSON.stringify(inp)), ph);
    assert.deepStrictEqual(a, b);
    assert.ok(a.input.angle > -Math.PI - 1e-9 && a.input.angle <= Math.PI + 1e-9);
    assert.ok(['rest', 'sink', 'water'].includes(a.outcome));
    assert.ok(a.frames.length > 0 && a.frames.length < 240 * 14);
  }
  assert.strictEqual(Sim.normInput({ angle: 'x', power: 0.5 }), null);
  assert.strictEqual(Sim.normInput({ angle: 0, power: NaN }), null);
  assert.strictEqual(Sim.normInput(null).power, 0); // below MIN_POWER, so the server rejects it
  assert.ok(Sim.normInput({ angle: 0, power: 5 }).power <= 1);
});

test('sim: balls stay on the course for random putts', () => {
  const r = rng(11);
  for (let i = 0; i < 120; i++) {
    const hi = i % 9;
    const res = Sim.simulate(hi, teeOf(hi), { angle: r() * 6.28 - 3.14, power: r() }, Math.floor(r() * 60000));
    for (const [x, y] of res.frames) assert.ok(x > 0 && x < Sim.W && y > 0 && y < Sim.H, `hole ${hi + 1} ball left the canvas`);
    if (res.outcome === 'rest') assert.ok(Sim.inPoly(Sim.HOLES[hi].fairway, res.end.x, res.end.y), `hole ${hi + 1} rest off fairway`);
  }
});

test('sim: movers depend on phase', () => {
  const a = Sim.moverShapes(2, 0);
  const b = Sim.moverShapes(2, 0.7);
  assert.ok(a.length > 0);
  const tips = (T) => Sim.moverShapes(2, T).map((m) => [Math.round(m.bx * 1e6), Math.round(m.by * 1e6)]);
  assert.notDeepStrictEqual(tips(0), tips(0.7));
  assert.deepStrictEqual(tips(0), tips(60)); // every period divides the 60s phase cycle
});

test('sim: scoreName', () => {
  assert.strictEqual(Sim.scoreName(1, 3), 'HOLE IN ONE');
  assert.strictEqual(Sim.scoreName(2, 3), 'BIRDIE');
  assert.strictEqual(Sim.scoreName(3, 3), 'PAR');
  assert.strictEqual(Sim.scoreName(4, 3), 'BOGEY');
});

// ---- rules ----
test('rules: strokes alternate, both balls stay on the hole', () => {
  const room = seated();
  assert.strictEqual(room.state.phase, 'playing');
  assert.strictEqual(room.state.turn, 'red');
  puttAs(room, 'red', TINY);
  assert.strictEqual(room.state.turn, 'blue');
  assert.strictEqual(room.state.strokes.red, 1);
  puttAs(room, 'blue', TINY);
  assert.strictEqual(room.state.turn, 'red');
  assert.strictEqual(lastState(room).lastShot.by, 'blue');
});

test('rules: 6 strokes max, picked up with a 7', () => {
  const room = seated();
  for (let i = 0; i < 6; i++) { puttAs(room, 'red', TINY); puttAs(room, 'blue', TINY); }
  // both picked up -> hole over, both 7, red keeps the honour on a tie
  assert.deepStrictEqual([room.state.scores.red[0], room.state.scores.blue[0]], [7, 7]);
  assert.strictEqual(room.state.hole, 1);
  assert.strictEqual(room.state.turn, 'red');
  assert.strictEqual(lastState(room).lastShot.holeEnd, true);
  assert.strictEqual(lastState(room).lastShot.pickedUp, true);
});

test('rules: sink ends that ball; the other plays on; honour goes to the lower score', () => {
  const room = seated();
  const ace = findShot(0, teeOf(0), 'sink');
  assert.ok(ace, 'hole 1 has a hole-in-one line');
  puttAs(room, 'red', TINY); // red 1
  puttAs(room, 'blue', ace); // blue aces
  assert.strictEqual(room.state.scores.blue[0], 1);
  assert.ok(room.state.balls.blue.done && room.state.balls.blue.sunk);
  assert.strictEqual(room.state.turn, 'red');
  puttAs(room, 'red', TINY);
  assert.strictEqual(room.state.turn, 'red', 'red keeps putting once blue is in');
  const b = room.state.balls.red;
  act(room, 'B', { kind: 'putt', angle: 0, power: 0.5 });
  assert.strictEqual(lastReject(room, 'B'), 'not_your_turn');
  // finish red by pickup
  while (room.state.hole === 0) puttAs(room, 'red', TINY);
  assert.strictEqual(room.state.scores.red[0], 7);
  assert.strictEqual(room.state.turn, 'blue', 'blue has the honour on hole 2');
  assert.ok(b);
});

test('rules: water = +1 penalty, ball back where it was hit', () => {
  const room = seated();
  room.state.hole = 4; // Lagoon
  room.state.balls = { red: { ...teeOf(4), done: false, sunk: false }, blue: { ...teeOf(4), done: false, sunk: false } };
  const dunk = findShot(4, teeOf(4), 'water', Date.now() % 60000);
  assert.ok(dunk, 'found a water shot');
  const now = Date.now();
  const rec = applyShot(room.state, 'red', { ...dunk, t0: now }, now);
  assert.strictEqual(rec.outcome, 'water');
  assert.strictEqual(rec.penalty, 1);
  assert.strictEqual(room.state.strokes.red, 2);
  assert.deepStrictEqual([room.state.balls.red.x, room.state.balls.red.y], [teeOf(4).x, teeOf(4).y]);
});

test('rules: t0 window — stale/future t0 falls back to server time', () => {
  const st = seated().state;
  const now = 1_000_000;
  const rec = applyShot(st, 'red', { angle: 0, power: 0.3, t0: now - 5000 }, now);
  assert.strictEqual(rec.t0, now);
  st.busyUntil = 0;
  const rolledUntil = st.settledAt;
  assert.ok(rolledUntil > now);
  // a putt can't claim to start before the last ball came to rest
  const rec2 = applyShot(st, 'blue', { angle: 0, power: 0.3, t0: now - 300 }, now);
  assert.strictEqual(rec2.t0, Math.ceil(rolledUntil));
  st.busyUntil = 0;
  st.settledAt = 0;
  const rec3 = applyShot(st, 'red', { angle: 0, power: 0.3, t0: now - 300 }, now);
  assert.strictEqual(rec3.t0, now - 300);
});

// ---- movers vs resting balls ----
// deepest overlap of a ball at (x,y) with any mover at server time ms (0 = touching at most)
function moverDepth(hi, x, y, ms) {
  let d = 0;
  for (const c of Sim.moverShapes(hi, (ms % 60000) / 1000)) {
    const dx = c.bx - c.ax;
    const dy = c.by - c.ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - c.ax) * dx + (y - c.ay) * dy) / l2)) : 0;
    d = Math.max(d, Sim.BALL_R + c.r - Math.hypot(x - c.ax - dx * t, y - c.ay - dy * t));
  }
  return d;
}
// a room on hole `hi` with red resting at p (in a sweep), blue on the tee, rest time chosen clear of the movers
function knockRoom(hi, p, base = 1_000_000) {
  const room = seated();
  const st = room.state;
  st.hole = hi;
  st.balls = { red: { x: p.x, y: p.y, done: false, sunk: false }, blue: { ...teeOf(hi), done: false, sunk: false } };
  let t = base;
  while (moverDepth(hi, p.x, p.y, t) > 0) t += 1;
  st.settledAt = t;
  return room;
}
const SWEEP_SPOTS = [[2, 150, 330], [2, 210, 250], [2, 228, 318], [7, 150, 215], [7, 250, 345], [7, 120, 352], [8, 120, 250], [8, 70, 200], [8, 135, 190]];

test('knocks: a resting ball in a windmill/slider path is knocked out, no stroke, never overlapped', () => {
  for (const [hi, x, y] of SWEEP_SPOTS) {
    assert.ok(Sim.inSweep(hi, x, y), `${hi} ${x},${y} in sweep`);
    const room = knockRoom(hi, { x, y });
    const st = room.state;
    const k = nextKnock(st);
    assert.ok(k && k.color === 'red', `knock found on hole ${hi}`);
    // nothing touches the ball until the knock
    for (let ms = st.settledAt; ms < k.at; ms++) assert.ok(moverDepth(hi, x, y, ms) <= 0, `overlap before knock at ${ms}`);
    const rec = applyPush(st, 'red', k.at, k.at - timing.lead);
    assert.ok(rec && rec.push && rec.by === 'red');
    assert.deepStrictEqual(st.strokes, { red: 0, blue: 0 }, 'no stroke for a knock');
    assert.strictEqual(st.turn, 'red', 'turn unchanged');
    assert.ok(rec.events.some((e) => e.type === 'mover'), 'mover hit event');
    rec.frames.forEach(([fx, fy], i) => assert.ok(moverDepth(hi, fx, fy, k.at + i * FRAME_MS) < 0.05, `hole ${hi} frame ${i} overlaps`));
    const b = st.balls.red;
    assert.ok(Sim.inPoly(Sim.HOLES[hi].fairway, b.x, b.y), 'stays on the course');
    assert.ok(b.x !== x || b.y !== y, 'ball moved');
    // after it settles, it's clear of the movers until the next knock (if any)
    const n = nextKnock(st);
    const until = n ? n.at : st.settledAt + 6000;
    for (let ms = Math.ceil(st.settledAt); ms < until; ms += 2) assert.ok(moverDepth(hi, b.x, b.y, ms) < 0.05, `hole ${hi} overlap after rest`);
    // the game continues: red can putt (after the knock's busy window)
    st.busyUntil = 0;
    assert.ok(applyShot(st, 'red', { angle: -Math.PI / 2, power: 0.3, t0: st.settledAt }, Math.ceil(st.settledAt)));
    assert.strictEqual(st.strokes.red, 1);
  }
});

test('knocks: the other ball gets knocked during a putt (record.side), no stroke for it', () => {
  const room = knockRoom(2, { x: 150, y: 330 });
  const st = room.state;
  st.turn = 'blue';
  const k = nextKnock(st);
  const rec = applyShot(st, 'blue', { angle: -Math.PI / 2, power: 0.5, t0: k.at - 40 }, k.at - 40);
  assert.ok(rec.side && rec.side.color === 'red', 'side path for red');
  assert.ok(rec.side.frames.length > 2);
  assert.deepStrictEqual(rec.post.balls.red, { ...st.balls.red });
  assert.ok(st.balls.red.x !== 150 || st.balls.red.y !== 330);
  assert.deepStrictEqual(st.strokes, { red: 0, blue: 1 });
  rec.side.frames.forEach(([fx, fy], i) => assert.ok(moverDepth(2, fx, fy, rec.t0 + i * FRAME_MS) < 0.05, `side frame ${i} overlaps`));
  assert.strictEqual(st.turn, 'red');
});

test('knocks: a putt that stops in a sweep zone gets knocked next (no free pass)', () => {
  let found = 0;
  for (let p = 0.2; p <= 0.34 && found < 3; p += 0.01) {
    const room = knockRoom(2, { x: 180, y: 420 });
    const st = room.state;
    applyShot(st, 'red', { angle: -2.1, power: p, t0: st.settledAt }, st.settledAt);
    const b = { ...st.balls.red };
    if (b.done || !Sim.inSweep(2, b.x, b.y)) continue;
    found++;
    const k = nextKnock(st);
    assert.ok(k && k.color === 'red' && k.at - st.settledAt < 4000, 'knock within one windmill turn');
    for (let ms = Math.ceil(st.settledAt); ms < k.at; ms++) assert.ok(moverDepth(2, b.x, b.y, ms) < 0.05, 'clear until the knock');
    st.busyUntil = 0;
    const rec = applyPush(st, 'red', k.at, k.at);
    assert.ok(rec && rec.push);
    assert.strictEqual(st.strokes.red, 1);
    assert.strictEqual(st.turn, 'blue', 'still blue to putt after red was knocked');
  }
  assert.ok(found > 0, 'some putt stopped in the sweep');
});

test('knocks: safe drop spot is clear of movers, rails and water', () => {
  for (const [hi, x, y] of SWEEP_SPOTS) {
    const s = Sim.safeSpot(hi, x, y);
    assert.ok(!Sim.inSweep(hi, s.x, s.y) && Sim.inPoly(Sim.HOLES[hi].fairway, s.x, s.y));
    assert.ok(Math.hypot(s.x - x, s.y - y) < 80, 'near the knock');
  }
});

test('knocks: server timer knocks a resting ball, then play (and bots) carry on', async () => {
  const saved = { ...timing };
  Object.assign(timing, { min: 0, max: 2 });
  try {
    const room = knockRoom(2, { x: 150, y: 330 }, Date.now());
    const st = room.state;
    const k = nextKnock(st);
    scheduleKnock(room);
    await wait(Math.max(0, k.at - Date.now()) + 50);
    const s1 = lastState(room);
    assert.ok(s1.lastShot && s1.lastShot.push && s1.lastShot.by === 'red', 'knock broadcast');
    assert.strictEqual(s1.strokes.red, 0);
    // a putt during the knock is busy-rejected; afterwards it's accepted
    act(room, 'A', { kind: 'putt', angle: -1.2, power: 0.3 });
    assert.strictEqual(lastReject(room, 'A'), 'busy');
    // hand blue to a bot with red's ball in the windmill: the bot must still putt
    plugin.onLeave(room, { clientId: 'B' });
    act(room, 'X', { kind: 'sit', seat: 'blue', bot: true, level: 'easy' });
    st.hole = 2;
    st.turn = 'blue';
    st.balls.blue = { x: 150, y: 330, done: false, sunk: false };
    st.settledAt = Date.now();
    st.busyUntil = 0;
    scheduleKnock(room);
    plugin.onMessage(room, { clientId: 'A' }, { kind: 'setBotLevel', seat: 'blue', level: 'easy' }, ctxFor(room, 'A'));
    const t = Date.now();
    while (st.strokes.blue === 0 && Date.now() - t < 6000) await wait(20);
    assert.strictEqual(st.strokes.blue, 1, 'bot putted');
  } finally { Object.assign(timing, saved); }
});

function finishGame(st, scoreFn) {
  for (let hi = 0; hi < 9; hi++) { st.scores.red[hi] = scoreFn('red', hi); st.scores.blue[hi] = scoreFn('blue', hi); }
}
test('rules: game over on hole 9, lower total wins, ties are a draw', () => {
  for (const [rs, bs, winner] of [[3, 4, 'red'], [5, 4, 'blue'], [4, 4, 'draw']]) {
    const room = seated();
    finishGame(room.state, (c) => (c === 'red' ? rs : bs));
    room.state.hole = 8;
    room.state.scores.red[8] = null;
    room.state.scores.blue[8] = null;
    room.state.balls = { red: { ...teeOf(8), done: false, sunk: false }, blue: { ...teeOf(8), done: false, sunk: false } };
    for (let i = 0; i < 6; i++) { puttAs(room, 'red', TINY); puttAs(room, 'blue', TINY); }
    assert.strictEqual(room.state.phase, 'game_over');
    // last hole both 7: totals differ by 8*(rs-bs)
    assert.strictEqual(room.state.winner, winner);
    assert.strictEqual(total(room.state.scores.red), rs * 8 + 7);
    act(room, 'A', { kind: 'putt', angle: 0, power: 0.5 });
    assert.strictEqual(lastReject(room, 'A'), 'not_playing');
  }
});

// ---- protocol ----
test('protocol: garbage never throws and is rejected', () => {
  const room = seated();
  const junk = [null, 5, 'x', [], {}, { kind: 3 }, { kind: 'sit', seat: 'green' }, { kind: 'sit', seat: '__proto__' },
    { kind: 'putt' }, { kind: 'putt', angle: 'a', power: 1 }, { kind: 'putt', angle: 0, power: -1 },
    { kind: 'putt', angle: Infinity, power: 0.5 }, { kind: 'putt', angle: 0, power: 0.001 },
    { kind: 'setBotLevel', seat: 'red', level: 'god' }, { kind: 'removeBot', seat: 'red' }, { kind: 'resetGame' }, { kind: 'nope' }];
  for (const j of junk) act(room, 'A', j);
  for (const j of junk) act(room, 'Z', j);
  assert.strictEqual(room.state.strokes.red, 0);
  assert.strictEqual(room.state.players.red, 'A');
  act(room, 'A', { kind: 'putt', angle: 0, power: 0.001 });
  assert.strictEqual(lastReject(room, 'A'), 'invalid');
  act(room, 'Z', { kind: 'putt', angle: 0, power: 0.5 });
  assert.strictEqual(lastReject(room, 'Z'), 'not_your_turn');
});

test('protocol: busy window rejects a putt while the ball rolls', () => {
  const room = seated();
  act(room, 'A', { kind: 'putt', angle: -1.57, power: 0.8 });
  room.state.turn = 'red'; // force red again to hit the busy guard
  act(room, 'A', { kind: 'putt', angle: 0, power: 0.5 });
  assert.strictEqual(lastReject(room, 'A'), 'busy');
});

test('seats: one seat per client, leave mid-game resets, spectators see state', () => {
  const room = makeRoom();
  act(room, 'A', { kind: 'sit', seat: 'red' });
  act(room, 'A', { kind: 'sit', seat: 'blue' });
  assert.strictEqual(room.state.players.blue, null);
  assert.strictEqual(room.state.phase, 'waiting');
  act(room, 'B', { kind: 'sit', seat: 'red' }); // taken
  assert.strictEqual(room.state.players.red, 'A');
  act(room, 'B', { kind: 'sit', seat: 'blue' });
  assert.strictEqual(room.state.phase, 'playing');
  puttAs(room, 'red', TINY);
  plugin.onLeave(room, { clientId: 'B' });
  assert.strictEqual(room.state.phase, 'waiting');
  assert.strictEqual(room.state.players.blue, null);
  assert.strictEqual(room.state.strokes.red, 0);
  plugin.onLeave(room, { clientId: 'spectator' });
  act(room, 'A', { kind: 'leaveSeat' });
  assert.strictEqual(room.state.players.red, null);
  const snap = plugin.serializeSnapshot(room);
  assert.ok(snap.balls && snap.scores && typeof snap.serverNow === 'number');
  assert.strictEqual(plugin.isRoomFull(room), false);
});

test('seats: rematch swaps colours and bot levels', () => {
  const room = makeRoom();
  act(room, 'A', { kind: 'sit', seat: 'red' });
  act(room, 'A', { kind: 'sit', seat: 'blue', bot: true, level: 'easy' });
  assert.strictEqual(room.state.players.blue, 'BOT');
  act(room, 'A', { kind: 'setBotLevel', seat: 'blue', level: 'expert' });
  assert.strictEqual(room.state.botLevels.blue, 'expert');
  room.state.phase = 'game_over';
  const gid = room.state.gameId;
  act(room, 'Z', { kind: 'resetGame' }); // spectator can't
  assert.strictEqual(room.state.phase, 'game_over');
  act(room, 'A', { kind: 'resetGame' });
  assert.strictEqual(room.state.players.red, 'BOT');
  assert.strictEqual(room.state.players.blue, 'A');
  assert.strictEqual(room.state.botLevels.red, 'expert');
  assert.strictEqual(room.state.phase, 'playing');
  assert.strictEqual(room.state.gameId, gid + 1);
  act(room, 'A', { kind: 'removeBot', seat: 'red' });
  assert.strictEqual(room.state.players.red, null);
  assert.strictEqual(room.state.phase, 'waiting');
});

// ---- bots ----
test('bots: bot vs bot plays a full game on timers (never stalls)', async () => {
  const saved = { ...timing };
  Object.assign(timing, { after: -1e7, holePause: 0, min: 0, max: 2 }); // skip roll-out waits
  try {
    const room = makeRoom();
    act(room, 'X', { kind: 'sit', seat: 'red', bot: true, level: 'expert' });
    act(room, 'X', { kind: 'sit', seat: 'blue', bot: true, level: 'medium' });
    const t = Date.now();
    while (room.state.phase === 'playing' && Date.now() - t < 25000) await wait(20);
    assert.strictEqual(room.state.phase, 'game_over', `stuck on hole ${room.state.hole + 1}`);
    assert.ok(room.state.scores.red.every((v) => v >= 1 && v <= 7));
    assert.ok(room.state.winner);
  } finally { Object.assign(timing, saved); }
});

// one game without timers; returns totals
function botGame(lvRed, lvBlue, seed) {
  const st = makeRoom().state;
  st.players = { red: 'BOT', blue: 'BOT' };
  st.phase = 'playing';
  const rand = rng(seed);
  let now = 5_000_000 + seed * 7919;
  let guard = 0;
  while (st.phase === 'playing' && guard++ < 200) {
    const c = st.turn;
    const b = st.balls[c];
    const inp = Sim.botPutt(st.hole, { x: b.x, y: b.y }, now % 60000, c === 'red' ? lvRed : lvBlue, rand);
    assert.ok(applyShot(st, c, { ...inp, t0: now }, now));
    now += 3137;
  }
  assert.strictEqual(st.phase, 'game_over');
  return { red: total(st.scores.red), blue: total(st.scores.blue), st };
}

const stats = {};
test('bots: expert reliably beats easy', () => {
  let wins = 0;
  const ex = [];
  const ez = [];
  for (let g = 0; g < 8; g++) {
    // alternate colours
    const r = g % 2 ? botGame('easy', 'expert', 100 + g) : botGame('expert', 'easy', 100 + g);
    const e = g % 2 ? r.blue : r.red;
    const z = g % 2 ? r.red : r.blue;
    ex.push(e); ez.push(z);
    if (e < z) wins++;
  }
  const avg = (a) => +(a.reduce((s, v) => s + v, 0) / a.length).toFixed(1);
  stats.expert = avg(ex); stats.easy = avg(ez);
  console.log(`    expert beat easy ${wins}/8 — avg totals expert ${stats.expert}, easy ${stats.easy} (par 27)`);
  assert.ok(wins >= 7, `expert won only ${wins}/8`);
});

test('bots: hard beats medium on average', () => {
  const h = [];
  const m = [];
  for (let g = 0; g < 3; g++) {
    const r = g % 2 ? botGame('medium', 'hard', 300 + g) : botGame('hard', 'medium', 300 + g);
    h.push(g % 2 ? r.blue : r.red);
    m.push(g % 2 ? r.red : r.blue);
  }
  const avg = (a) => +(a.reduce((s, v) => s + v, 0) / a.length).toFixed(1);
  stats.hard = avg(h); stats.medium = avg(m);
  console.log(`    avg totals hard ${stats.hard}, medium ${stats.medium}`);
  assert.ok(stats.hard < stats.medium);
  assert.ok(stats.expert <= stats.hard + 2 && stats.medium < stats.easy, 'monotone gradient');
});

(async () => {
  const t0 = Date.now();
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (e) {
      failures++;
      console.log(`FAIL ${name}\n     ${e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n     ') : e}`);
    }
  }
  console.log(`${tests.length - failures}/${tests.length} passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(failures ? 1 : 0);
})();
