// Archery: ring scoring, sway/wind determinism, end rotation, totals, shoot-off, protocol guards,
// and bot-vs-bot games at every level (with a skill gradient check).
// Run: node test/archery.test.js
'use strict';

const assert = require('assert');
const plugin = require('../server/games/archery');
const Sim = require('../public/games/archery/sim.js');

const { applyShot, resetGame, timing } = plugin._internal;
const LEVELS = ['easy', 'medium', 'hard', 'expert'];
let failures = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const wait = (ms) => new Promise((res) => setTimeout(res, ms));

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
const act = (room, id, data) => plugin.onMessage(room, { clientId: id }, data, { senderId: id, broadcast: room.broadcast, sendTo: room.sendTo });
const lastReject = (room, id) => {
  const s = [...room.sent].reverse().find((x) => x.to === id && x.m.payload.data.kind === 'moveRejected');
  return s && s.m.payload.data.reason;
};
// A point that scores `pts` (11 = X, 0 = miss) on the vertical line below the centre.
const ptFor = (pts) => (pts === 11 ? 0 : pts === 0 ? 80 : (10 - pts) * Sim.RING_W + Sim.RING_W * 0.75);
const hit = (st, pts) => applyShot(st, 0, ptFor(pts));

function playing() {
  const st = plugin.createInitialState();
  st.players = { p1: 'A', p2: 'B' };
  resetGame(st);
  st.phase = 'playing';
  return st;
}

test('scoreAt: X, every ring, line-cutters and misses', () => {
  assert.deepStrictEqual(Sim.scoreAt(0, 0), { pts: 10, x: true, label: 'X', ring: 11 });
  for (let pts = 1; pts <= 10; pts++) {
    const s = Sim.scoreAt(0, ptFor(pts));
    assert.strictEqual(s.pts, pts);
    assert.strictEqual(s.label, String(pts));
    assert.strictEqual(Sim.scoreAt(ptFor(pts), 0).pts, pts); // symmetric
  }
  // the shaft touching the 9/10 line scores 10
  assert.strictEqual(Sim.scoreAt(Sim.RING_W + Sim.ARROW_R - 0.01, 0).pts, 10);
  assert.strictEqual(Sim.scoreAt(Sim.RING_W + Sim.ARROW_R + 0.05, 0).pts, 9);
  assert.strictEqual(Sim.scoreAt(Sim.X_R + 0.3, 0).label, 'X');
  assert.strictEqual(Sim.scoreAt(0, Sim.FACE_R + Sim.ARROW_R - 0.01).pts, 1);
  assert.strictEqual(Sim.scoreAt(0, Sim.FACE_R + 1).label, 'M');
  assert.strictEqual(Sim.scoreAt(200, 200).pts, 0);
});

test('wind: drift direction and size (half a ring per mph)', () => {
  const r = Sim.windDrift({ angle: 90, speed: 4 }); // blowing to the right
  assert.ok(Math.abs(r.dx - 4 * Sim.CM_PER_MPH) < 1e-9 && Math.abs(r.dy) < 1e-9);
  const u = Sim.windDrift({ angle: 0, speed: 2 }); // blowing up the face
  assert.ok(Math.abs(u.dy + 2 * Sim.CM_PER_MPH) < 1e-9);
  assert.strictEqual(Sim.CM_PER_MPH * 2, Sim.RING_W);
  for (let i = 0; i < 500; i++) {
    const w = Sim.randomWind(Math.random);
    assert.ok(w.speed >= 0 && w.speed <= Sim.MAX_WIND && w.angle >= 0 && w.angle < 360 && Number.isInteger(w.angle));
  }
});

test('sway is deterministic per seed, settles then tires; shots drift with the wind', () => {
  const wind = { angle: 270, speed: 5 };
  const a = Sim.shoot(0, 0, 1234, 1800, wind);
  assert.deepStrictEqual(a, Sim.shoot(0, 0, 1234, 1800, wind));
  assert.notDeepStrictEqual(Sim.shoot(0, 0, 1235, 1800, wind), a);
  assert.ok(Sim.swayAmp(0) > Sim.swayAmp(1.8) * 4);
  assert.ok(Sim.swayAmp(5.5) > Sim.swayAmp(1.8) * 4);
  // calm air, steady window: within sway + jitter of the aim
  let sumX = 0;
  for (let seed = 1; seed < 300; seed++) {
    const p = Sim.shoot(10, -5, seed, 1900, { angle: 0, speed: 0 });
    assert.ok(Math.hypot(p.x - 10, p.y + 5) < Sim.swayAmp(1.9) * 1.1 + 6);
    const q = Sim.shoot(0, 0, seed, 1900, wind); // wind blowing left
    sumX += q.x;
  }
  const meanX = sumX / 299;
  assert.ok(Math.abs(meanX + 5 * Sim.CM_PER_MPH) < 2.5, `mean drift ${meanX}`);
  // aim is clamped
  const far = Sim.shoot(1e6, -1e6, 9, 1900, null);
  assert.ok(Math.abs(far.x) < Sim.MAX_AIM + 40 && Math.abs(far.y) < Sim.MAX_AIM + 40);
});

test('ends: opener shoots 3 then the other; arrows stay for the end; opener alternates', () => {
  const st = playing();
  assert.strictEqual(st.turn, 'p1');
  hit(st, 11); hit(st, 10); hit(st, 9);
  assert.strictEqual(st.turn, 'p2');
  assert.strictEqual(st.endArrows.length, 3);
  hit(st, 8); hit(st, 0); hit(st, 1);
  assert.strictEqual(st.end, 2);
  assert.strictEqual(st.endArrows.length, 0);
  assert.strictEqual(st.lastEndArrows.length, 6);
  assert.strictEqual(st.turn, 'p2'); // p2 opens end 2
  assert.strictEqual(st.opener, 'p2');
  assert.deepStrictEqual(st.card.p1[0], ['X', '10', '9']);
  assert.deepStrictEqual(st.card.p2[0], ['8', 'M', '1']);
  assert.strictEqual(st.totals.p1, 29);
  assert.strictEqual(st.totals.p2, 9);
  assert.strictEqual(st.xs.p1, 1);
  assert.strictEqual(st.tens.p1, 2);
  assert.strictEqual(st.callout.kind, 'end');
  hit(st, 5);
  assert.strictEqual(st.endArrows[0].seat, 'p2');
  assert.strictEqual(st.card.p2[1][0], '5');
});

test('perfect end callout; final end decides on points', () => {
  const st = playing();
  hit(st, 10); hit(st, 11); hit(st, 10);
  assert.strictEqual(st.callout.kind, 'perfect');
  hit(st, 1); hit(st, 1); hit(st, 1);
  for (let e = 2; e <= Sim.ENDS; e++) for (let i = 0; i < 6; i++) hit(st, 5);
  assert.strictEqual(st.phase, 'game_over');
  assert.strictEqual(st.winner, 'p1');
  assert.strictEqual(st.endReason, 'points');
  assert.strictEqual(st.end, Sim.ENDS);
  assert.strictEqual(st.lastEndArrows.length, 6);
});

test('tie goes to a one-arrow shoot-off, closest to the centre wins (re-shoot when level)', () => {
  const st = playing();
  for (let e = 1; e <= Sim.ENDS; e++) for (let i = 0; i < 6; i++) hit(st, 7);
  assert.strictEqual(st.phase, 'playing');
  assert.strictEqual(st.shootoff, 1);
  assert.strictEqual(st.callout.kind, 'shootoff');
  assert.strictEqual(st.turn, 'p1');
  const totals = { ...st.totals };
  applyShot(st, 0, 4.2); // p1: a 10, 4.2 cm out
  assert.strictEqual(st.turn, 'p2');
  applyShot(st, 4.2, 0); // p2: exactly as close -> again
  assert.strictEqual(st.phase, 'playing');
  assert.strictEqual(st.shootoff, 2);
  assert.strictEqual(st.turn, 'p2'); // second shoot-off: p2 first
  assert.deepStrictEqual(st.totals, totals); // shoot-off arrows don't add to the score
  applyShot(st, 3, 3); // p2: 4.24 cm
  applyShot(st, 0, 4.1); // p1: 4.1 cm
  assert.strictEqual(st.phase, 'game_over');
  assert.strictEqual(st.winner, 'p1');
  assert.strictEqual(st.endReason, 'shootoff');
  assert.strictEqual(st.shootoffLog.length, 2);
  assert.strictEqual(st.lastEndArrows.length, 2);
});

test('endless dead-level shoot-offs end in a draw', () => {
  const st = playing();
  for (let e = 1; e <= Sim.ENDS; e++) for (let i = 0; i < 6; i++) hit(st, 7);
  for (let i = 0; i < 40 && st.phase === 'playing'; i++) applyShot(st, 0, 80);
  assert.strictEqual(st.phase, 'game_over');
  assert.strictEqual(st.winner, 'draw');
});

test('protocol: seats, turn guard, garbage, stale seed, busy, spectators, leaving', () => {
  const room = makeRoom();
  act(room, 'A', null);
  act(room, 'A', { kind: 42 });
  act(room, 'A', { kind: 'sit', seat: 'p3' });
  act(room, 'A', { kind: 'sit', seat: 'p1' });
  act(room, 'A', { kind: 'sit', seat: 'p2' }); // can't take both
  assert.strictEqual(room.state.players.p2, null);
  act(room, 'A', { kind: 'shoot', x: 0, y: 0, t: 1500 });
  assert.strictEqual(lastReject(room, 'A'), 'not_playing');
  act(room, 'B', { kind: 'sit', seat: 'p2' });
  assert.strictEqual(room.state.phase, 'playing');
  act(room, 'B', { kind: 'shoot', x: 0, y: 0, t: 1500 });
  assert.strictEqual(lastReject(room, 'B'), 'not_your_turn');
  act(room, 'C', { kind: 'shoot', x: 0, y: 0, t: 1500 });
  assert.strictEqual(lastReject(room, 'C'), 'not_your_turn');
  for (const bad of [{ x: 'a', y: 0, t: 1 }, { x: 0, y: 0, t: -5 }, { x: 1e9, y: 0, t: 5 }, { x: 0, y: 0 }, { x: null, y: [], t: {} }, { x: 0, y: 0, t: 1e9 }]) {
    act(room, 'A', { kind: 'shoot', ...bad });
    assert.strictEqual(lastReject(room, 'A'), 'invalid');
  }
  act(room, 'A', { kind: 'shoot', x: 0, y: 0, t: 1500, seed: room.state.shotSeed + 1 });
  assert.strictEqual(lastReject(room, 'A'), 'stale');
  const seed = room.state.shotSeed;
  const wind = { ...room.state.wind };
  act(room, 'A', { kind: 'shoot', x: 3, y: -2, t: 1700, seed });
  assert.strictEqual(room.state.shotNo, 1);
  const expect = Sim.shoot(3, -2, seed, 1700, wind);
  const a = room.state.endArrows[0];
  assert.strictEqual(a.x, expect.x);
  assert.strictEqual(a.label, Sim.scoreAt(expect.x, expect.y).label);
  assert.deepStrictEqual(a.wind, wind);
  act(room, 'A', { kind: 'shoot', x: 0, y: 0, t: 1500, seed }); // double-send with the old seed
  assert.strictEqual(lastReject(room, 'A'), 'stale');
  act(room, 'A', { kind: 'shoot', x: 0, y: 0, t: 1500, seed: room.state.shotSeed }); // too soon after
  assert.strictEqual(lastReject(room, 'A'), 'busy');
  assert.strictEqual(room.state.shotNo, 1);
  room.state.busyUntil = 0;
  act(room, 'A', { kind: 'shoot', x: 0, y: 0, t: 1500, seed: room.state.shotSeed });
  assert.strictEqual(room.state.shotNo, 2);
  // spectators can't reset / change bots
  act(room, 'C', { kind: 'resetGame' });
  act(room, 'C', { kind: 'leaveSeat' });
  assert.strictEqual(room.state.shotNo, 2);
  // leaving mid-game returns to waiting with a fresh card
  plugin.onLeave(room, { clientId: 'B' });
  assert.strictEqual(room.state.phase, 'waiting');
  assert.strictEqual(room.state.players.p2, null);
  assert.strictEqual(room.state.totals.p1, 0);
  assert.strictEqual(room.state.endArrows.length, 0);
  plugin.onLeave(room, { clientId: 'C' }); // spectator: no-op
  plugin.onLeave(room, {});
  // snapshot is plain JSON
  JSON.parse(JSON.stringify(plugin.serializeSnapshot(room)));
});

test('rematch swaps seats; bot seat controls', () => {
  const room = makeRoom();
  act(room, 'A', { kind: 'sit', seat: 'p1' });
  act(room, 'A', { kind: 'sit', seat: 'p2', bot: true, level: 'nonsense' });
  assert.strictEqual(room.state.botLevels.p2, 'hard');
  act(room, 'A', { kind: 'setBotLevel', seat: 'p2', level: 'easy' });
  assert.strictEqual(room.state.botLevels.p2, 'easy');
  act(room, 'A', { kind: 'setBotLevel', seat: 'p1', level: 'easy' }); // not a bot
  assert.strictEqual(room.state.botLevels.p1, undefined);
  const st = room.state;
  st.phase = 'game_over';
  st.winner = 'p1';
  act(room, 'A', { kind: 'resetGame' });
  assert.strictEqual(st.players.p1, 'BOT');
  assert.strictEqual(st.players.p2, 'A');
  assert.strictEqual(st.botLevels.p1, 'easy');
  assert.strictEqual(st.phase, 'playing');
  act(room, 'A', { kind: 'removeBot', seat: 'p1' });
  assert.strictEqual(st.phase, 'waiting');
  assert.strictEqual(st.players.p1, null);
});

test('bots compensate for wind: expert groups tight in a gale', () => {
  const wind = { angle: 90, speed: 9 };
  for (const level of LEVELS) {
    let sx = 0;
    let pts = 0;
    for (let i = 0; i < 400; i++) {
      const p = Sim.botShot(wind, level, i + 1, Math.random);
      sx += p.x;
      pts += Sim.scoreAt(p.x, p.y).pts;
    }
    console.log(`  ${level.padEnd(6)} in a 9 mph crosswind: mean x ${(sx / 400).toFixed(1)} cm, ${(pts / 400).toFixed(2)} per arrow`);
    if (level === 'expert') assert.ok(Math.abs(sx / 400) < 1.5 && pts / 400 > 9.2);
    if (level === 'easy') assert.ok(sx / 400 > 10); // drifts well downwind
  }
});

test('bot-vs-bot games finish at every level; better bots score more; expert beats easy', async () => {
  timing.first = 0; timing.next = 0; timing.jitter = 0; timing.flight = 0;
  for (const level of LEVELS) {
    const room = makeRoom();
    act(room, 'A', { kind: 'sit', seat: 'p1', bot: true, level });
    act(room, 'A', { kind: 'sit', seat: 'p2', bot: true, level: 'hard' });
    for (let i = 0; i < 400 && room.state.phase === 'playing'; i++) await wait(2);
    assert.strictEqual(room.state.phase, 'game_over', `${level} did not finish`);
    const s = room.state;
    assert.ok(s.card.p1.every((e) => e.length === 3) && s.card.p2.every((e) => e.length === 3));
    assert.ok(s.winner === 'p1' || s.winner === 'p2' || s.winner === 'draw');
  }
  // A human sits down against a bot that opens: the bot must stop and wait at the human's turn.
  const room = makeRoom();
  act(room, 'A', { kind: 'sit', seat: 'p1', bot: true, level: 'expert' });
  act(room, 'B', { kind: 'sit', seat: 'p2' });
  for (let i = 0; i < 50; i++) await wait(2);
  assert.strictEqual(room.state.turn, 'p2');
  assert.strictEqual(room.state.shotNo, 3);

  // Strength: simulate directly (no timers).
  const avg = {};
  const play = (lv1, lv2) => {
    const st = playing();
    st.botLevels = { p1: lv1, p2: lv2 };
    while (st.phase === 'playing') {
      const p = Sim.botShot(st.wind, st.botLevels[st.turn], st.shotSeed, Math.random);
      applyShot(st, p.x, p.y);
    }
    return st;
  };
  for (const level of LEVELS) {
    let tot = 0;
    for (let g = 0; g < 60; g++) tot += play(level, level).totals.p1;
    avg[level] = Math.round((tot / 60) * 10) / 10;
  }
  console.log(`  average 15-arrow total: ${JSON.stringify(avg)} (max 150)`);
  assert.ok(avg.easy < avg.medium && avg.medium < avg.hard && avg.hard < avg.expert);
  let expertWins = 0;
  let hardOverMedium = 0;
  for (let g = 0; g < 100; g++) {
    const flip = g % 2;
    const st = play(flip ? 'expert' : 'easy', flip ? 'easy' : 'expert');
    if (st.botLevels[st.winner] === 'expert') expertWins++;
    const s2 = play(flip ? 'hard' : 'medium', flip ? 'medium' : 'hard');
    if (s2.botLevels[s2.winner] === 'hard') hardOverMedium++;
  }
  console.log(`  expert beat easy ${expertWins}/100, hard beat medium ${hardOverMedium}/100`);
  assert.ok(expertWins >= 97);
  assert.ok(hardOverMedium >= 70);
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); console.log(`ok   ${name}`); } catch (err) { failures++; console.log(`FAIL ${name}\n     ${err.stack.split('\n').slice(0, 3).join('\n     ')}`); }
  }
  console.log(failures ? `\n${failures} failing` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
