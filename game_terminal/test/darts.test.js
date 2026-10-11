// Darts: board scoring, flick-landing model, 01 bust/checkout rules, cricket, protocol guards,
// checkout planner, and bot-vs-bot games at every level in every mode.
// Run: node test/darts.test.js
'use strict';

const assert = require('assert');
const plugin = require('../server/games/darts');
const Sim = require('../public/games/darts/sim.js');

const { applyDart, resetGame, timing } = plugin._internal;
const LEVELS = ['easy', 'medium', 'hard', 'expert'];
const T20 = { x: 0, angle: 0, speed: 2.99, curve: 0 }; // ~ideal flick at treble 20
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
const at = (label) => Sim.targetPoint(label);
const hitLabel = (st, label) => { const p = at(label); return applyDart(st, p.x, p.y); };

function playing(mode = '501') {
  const st = plugin.createInitialState();
  st.mode = mode;
  st.players = { p1: 'A', p2: 'B' };
  resetGame(st);
  st.phase = 'playing';
  return st;
}

test('scoreAt: every named target scores itself; edges and misses', () => {
  for (let n = 1; n <= 20; n++) {
    for (const r of ['T', 'D']) { const p = at(`${r}${n}`); assert.strictEqual(Sim.scoreAt(p.x, p.y).label, `${r}${n}`); }
    const p = at(`S${n}`);
    assert.strictEqual(Sim.scoreAt(p.x, p.y).value, n);
  }
  assert.strictEqual(Sim.scoreAt(0, 0).value, 50);
  assert.strictEqual(Sim.scoreAt(0, -10).value, 25);
  assert.strictEqual(Sim.scoreAt(0, -171).ring, 'MISS');
  assert.strictEqual(Sim.scoreAt(0, -103).label, 'T20');
  assert.strictEqual(Sim.scoreAt(0, 103).label, 'T3');
  assert.strictEqual(Sim.scoreAt(103, 0).label, 'T6');
  assert.strictEqual(Sim.scoreAt(-103, 0).label, 'T11');
});

test('flick landing: deterministic, speed sets height, lean/curve push wide, clamped', () => {
  const f = { x: 0, angle: 0, speed: 2.4, curve: 0 };
  assert.deepStrictEqual(Sim.flickLanding(f, 1234), Sim.flickLanding(f, 1234));
  assert.notDeepStrictEqual(Sim.flickLanding(f, 1235), Sim.flickLanding(f, 1234));
  // the ideal flick hits its point (within the release jitter)
  for (const label of ['T20', 'D16', 'DB', 'T19', 'S11']) {
    const p = Sim.targetPoint(label);
    const ideal = Sim.idealFlick(p.x, p.y);
    let hits = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const l = Sim.flickLanding(ideal, seed);
      if (Sim.scoreAt(l.x, l.y).label === Sim.scoreAt(p.x, p.y).label) hits++;
    }
    assert.ok(hits >= 60, `${label} ideal hit ${hits}/100`);
  }
  const at = (o) => Sim.flickLanding({ ...f, ...o }, 7);
  assert.ok(at({ speed: 1.2 }).y > at({}).y + 50, 'slow drops low');
  assert.ok(at({ speed: 3.6 }).y < at({}).y - 50, 'fast flies high');
  assert.ok(at({ angle: 6 }).x > at({}).x + 20 && at({ angle: -6 }).x < at({}).x - 20, 'lean goes wide');
  assert.ok(at({ curve: 0.15 }).x > at({}).x + 20, 'curve drifts');
  assert.deepStrictEqual(Sim.clampFlick({ x: 1e9, angle: -500, speed: 99, curve: 5 }), { x: 300, angle: -45, speed: 8, curve: 1 });
  assert.strictEqual(Sim.scoreAt(at({ speed: 0.2 }).x, at({ speed: 0.2 }).y).ring, 'MISS');
});

test('bot flick skill gradient (points per dart at T20)', () => {
  const avg = {};
  let seed = 99;
  const rand = Sim.mulberry32(seed);
  for (const level of LEVELS) {
    let t = 0;
    for (let i = 0; i < 20000; i++) { const p = Sim.botThrow('T20', level, rand); t += Sim.scoreAt(p.x, p.y).value; }
    avg[level] = Math.round((t / 20000) * 10) / 10;
  }
  console.log(`  points per dart at T20: ${JSON.stringify(avg)}`);
  assert.ok(avg.easy < avg.medium && avg.medium < avg.hard && avg.hard < avg.expert);
  assert.ok(avg.easy < 15 && avg.expert > 28 && avg.expert < 45);
});

test('checkout planner: classic finishes, impossible ones, straight-out', () => {
  assert.deepStrictEqual(Sim.planCheckout(170, 3), ['T20', 'T20', 'DB']);
  assert.deepStrictEqual(Sim.planCheckout(40, 3), ['D20']);
  assert.deepStrictEqual(Sim.planCheckout(100, 3), ['T20', 'D20']);
  assert.strictEqual(Sim.planCheckout(169, 3), null);
  assert.strictEqual(Sim.planCheckout(159, 3), null);
  assert.strictEqual(Sim.planCheckout(41, 1), null);
  assert.strictEqual(Sim.chooseTarget01(41, 1), 'S1');
  assert.strictEqual(Sim.chooseTarget01(17, 1), 'S1'); // S17 would be a no-double bust
  assert.strictEqual(Sim.chooseTarget01(17, 1, false), 'S17');
  // every 2..170 except the bogeys has a 3-dart plan whose values sum right and ends on a double
  const bogey = [169, 168, 166, 165, 163, 162, 159];
  for (let r = 2; r <= 170; r++) {
    const plan = Sim.planCheckout(r, 3);
    if (bogey.includes(r)) { assert.strictEqual(plan, null, `${r}`); continue; }
    assert.ok(plan, `no plan for ${r}`);
    const sum = plan.reduce((s, l) => { const p = at(l); return s + Sim.scoreAt(p.x, p.y).value; }, 0);
    assert.strictEqual(sum, r);
    assert.ok(/^D|^DB$/.test(plan[plan.length - 1]));
  }
});

test('501: three darts per turn, 180 callout, turn passes', () => {
  const st = playing('501');
  hitLabel(st, 'T20'); hitLabel(st, 'T20');
  assert.strictEqual(st.turn, 'p1');
  hitLabel(st, 'T20');
  assert.strictEqual(st.scores.p1, 321);
  assert.strictEqual(st.turn, 'p2');
  assert.strictEqual(st.callout.kind, '180');
  assert.strictEqual(st.prevTurn.total, 180);
  assert.strictEqual(st.turnStart, 501);
});

test('501 bust: over, left on 1, and zero without a double all revert the turn', () => {
  for (const [rem, darts] of [[40, ['T20']], [41, ['D20']], [40, ['S20', 'S20']]]) {
    const st = playing('501');
    st.scores.p1 = rem;
    st.turnStart = rem;
    for (const d of darts) hitLabel(st, d);
    assert.strictEqual(st.scores.p1, rem, `rem ${rem} ${darts}`);
    assert.strictEqual(st.turn, 'p2');
    assert.strictEqual(st.callout.kind, 'bust');
    assert.ok(st.prevTurn.bust);
    assert.strictEqual(st.stats.p1.scored, 0);
  }
});

test('501 checkout on a double wins; 301 straight-out allows singles', () => {
  const st = playing('501');
  st.scores.p1 = 60; st.turnStart = 60;
  hitLabel(st, 'S20'); hitLabel(st, 'D20');
  assert.strictEqual(st.phase, 'game_over');
  assert.strictEqual(st.winner, 'p1');
  assert.strictEqual(st.callout.kind, 'checkout');
  const s3 = playing('301');
  assert.strictEqual(s3.scores.p1, 301);
  s3.scores.p1 = 7; s3.turnStart = 7;
  hitLabel(s3, 'S7');
  assert.strictEqual(s3.winner, 'p1');
});

test('round cap: lowest remaining wins after the last round', () => {
  const st = playing('501');
  for (let r = 0; r < plugin._internal.MAX_ROUNDS * 2 * 3; r++) {
    if (st.phase !== 'playing') break;
    hitLabel(st, st.turn === 'p1' ? 'S1' : 'S2');
  }
  assert.strictEqual(st.phase, 'game_over');
  assert.strictEqual(st.endReason, 'rounds');
  assert.strictEqual(st.winner, 'p2');
});

test('cricket: marks, closing, scoring only while opponent is open, win on all closed', () => {
  const st = playing('cricket');
  hitLabel(st, 'T20'); // closes 20
  hitLabel(st, 'T20'); // 60 points
  hitLabel(st, 'S5'); // not a cricket number
  assert.strictEqual(st.cricket.p1.marks[20], 6);
  assert.strictEqual(st.cricket.p1.points, 60);
  hitLabel(st, 'T20'); // p2 closes 20
  hitLabel(st, 'T20'); hitLabel(st, 'S1');
  assert.strictEqual(st.cricket.p2.points, 0); // p1 has 20 closed, so p2 can't score on it
  hitLabel(st, 'T20'); // both closed: no points
  assert.strictEqual(st.cricket.p1.points, 60);
  // close everything for p1
  st.cricket.p1.marks = { 20: 3, 19: 3, 18: 3, 17: 3, 16: 3, 15: 3, 25: 1 };
  hitLabel(st, 'DB');
  assert.strictEqual(st.phase, 'game_over');
  assert.strictEqual(st.winner, 'p1');
});

test('cricket: closing everything while behind on points does not win', () => {
  const st = playing('cricket');
  st.cricket.p2.points = 100;
  st.cricket.p1.marks = { 20: 3, 19: 3, 18: 3, 17: 3, 16: 3, 15: 3, 25: 2 };
  hitLabel(st, 'SB');
  assert.strictEqual(st.phase, 'playing');
});

test('protocol: seats, turn guard, garbage, stale seed, spectators, mode switch', () => {
  const room = makeRoom();
  act(room, 'A', { kind: 'setMode', mode: 'cricket' });
  assert.strictEqual(room.state.mode, 'cricket');
  act(room, 'A', { kind: 'sit', seat: 'p1' });
  act(room, 'A', { kind: 'sit', seat: 'p2' }); // can't take both
  assert.strictEqual(room.state.players.p2, null);
  act(room, 'C', { kind: 'setMode', mode: '501' }); // spectator can't change a seated table
  assert.strictEqual(room.state.mode, 'cricket');
  act(room, 'A', { kind: 'setMode', mode: '501' });
  act(room, 'B', { kind: 'sit', seat: 'p2' });
  assert.strictEqual(room.state.phase, 'playing');
  act(room, 'A', { kind: 'setMode', mode: '301' }); // not mid-game
  assert.strictEqual(room.state.mode, '501');
  act(room, 'B', { kind: 'throw', ...T20 });
  assert.strictEqual(lastReject(room, 'B'), 'not_your_turn');
  act(room, 'C', { kind: 'throw', ...T20 });
  assert.strictEqual(lastReject(room, 'C'), 'not_your_turn');
  for (const bad of [{ ...T20, x: 'a' }, { ...T20, speed: NaN }, { x: 0, angle: 0, speed: 2 }, {}]) {
    act(room, 'A', { kind: 'throw', ...bad });
    assert.strictEqual(lastReject(room, 'A'), 'invalid');
  }
  act(room, 'A', { kind: 'throw', ...T20, seed: room.state.dartSeed + 1 });
  assert.strictEqual(lastReject(room, 'A'), 'stale');
  const seed = room.state.dartSeed;
  act(room, 'A', { kind: 'throw', ...T20, seed });
  assert.strictEqual(room.state.throwNo, 1);
  const expect = Sim.flickLanding(T20, seed);
  assert.strictEqual(room.state.turnDarts[0].label, Sim.scoreAt(expect.x, expect.y).label);
  act(room, 'A', { kind: 'throw', ...T20, seed }); // double-send with the old seed
  assert.strictEqual(room.state.throwNo, 1);
  plugin.onLeave(room, { clientId: 'B' });
  assert.strictEqual(room.state.phase, 'waiting');
  assert.strictEqual(room.state.scores.p1, 501);
});

test('bots pick sensible targets', () => {
  const st = playing('501');
  st.players.p1 = 'BOT';
  st.botLevels = { p1: 'expert' };
  st.scores.p1 = 501; assert.strictEqual(plugin._internal.botTarget(st, 'p1'), 'T20');
  st.scores.p1 = 32; assert.strictEqual(plugin._internal.botTarget(st, 'p1'), 'D16');
  st.scores.p1 = 170; assert.strictEqual(plugin._internal.botTarget(st, 'p1'), 'T20');
  st.scores.p1 = 50; assert.strictEqual(plugin._internal.botTarget(st, 'p1'), 'DB');
  const cr = playing('cricket');
  cr.botLevels = { p1: 'hard' };
  assert.strictEqual(plugin._internal.botTarget(cr, 'p1'), 'T20');
  cr.cricket.p1.marks[20] = 3;
  cr.cricket.p2.points = 40;
  assert.strictEqual(plugin._internal.botTarget(cr, 'p1'), 'T20'); // behind: score on the open 20
});

test('bot-vs-bot games finish in every mode at every level; better bots win more', async () => {
  timing.firstDart = 0; timing.nextDart = 0; timing.jitter = 0;
  for (const mode of ['501', '301', 'cricket']) {
    for (const level of LEVELS) {
      const room = makeRoom();
      act(room, 'A', { kind: 'setMode', mode });
      act(room, 'A', { kind: 'sit', seat: 'p1', bot: true, level });
      act(room, 'A', { kind: 'sit', seat: 'p2', bot: true, level: 'hard' });
      for (let i = 0; i < 400 && room.state.phase === 'playing'; i++) await wait(2);
      assert.strictEqual(room.state.phase, 'game_over', `${mode}/${level} did not finish`);
      const s = room.state;
      for (const seat of ['p1', 'p2']) assert.ok(s.scores[seat] >= 0);
    }
  }
  // Strength: simulate directly (no timers) many 501 legs, expert vs easy.
  let expertWins = 0;
  for (let g = 0; g < 60; g++) {
    const st = playing('501');
    st.botLevels = { p1: g % 2 ? 'expert' : 'easy', p2: g % 2 ? 'easy' : 'expert' };
    while (st.phase === 'playing') {
      const label = plugin._internal.botTarget(st, st.turn);
      const p = Sim.botThrow(label, st.botLevels[st.turn], Math.random);
      applyDart(st, p.x, p.y);
    }
    if (st.botLevels[st.winner] === 'expert') expertWins++;
  }
  console.log(`  expert beat easy in ${expertWins}/60 legs`);
  assert.ok(expertWins >= 50);
  // Darts per leg by level (sanity check the difficulty spread).
  const avg = {};
  for (const level of LEVELS) {
    let darts = 0;
    for (let g = 0; g < 40; g++) {
      const st = playing('501');
      st.botLevels = { p1: level, p2: level };
      // Solo leg: hand the board straight back to p1 after every turn (no round cap).
      while (st.phase === 'playing' && st.stats.p1.darts < 600) {
        if (st.turn !== 'p1') { st.turn = 'p1'; st.turnStart = st.scores.p1; }
        const p = Sim.botThrow(plugin._internal.botTarget(st, 'p1'), level, Math.random);
        applyDart(st, p.x, p.y);
      }
      darts += st.stats.p1.darts;
    }
    avg[level] = Math.round(darts / 40);
  }
  console.log(`  darts per 501 leg: ${JSON.stringify(avg)}`);
  assert.ok(avg.easy > avg.medium && avg.medium > avg.hard && avg.hard > avg.expert);
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); console.log(`ok   ${name}`); } catch (err) { failures++; console.log(`FAIL ${name}\n     ${err.stack.split('\n').slice(0, 3).join('\n     ')}`); }
  }
  console.log(failures ? `\n${failures} failing` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
