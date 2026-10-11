// Tanks: shared sim (terrain, carving, driving, determinism, weapons, solver), rules (turns, wind,
// fuel, ammo, kills, turn limit), protocol guards, seats/bots/rematch, bot skill gradient.
// Run: node test/tanks.test.js
'use strict';

const assert = require('assert');
const plugin = require('../server/games/tanks');
const Sim = require('../public/games/tanks/sim.js');

const { applyFire, applyDrive } = plugin._internal;
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
const events = (room, kind) => room.sent.filter((s) => s.m.payload.data.kind === kind).map((s) => s.m.payload.data);
const lastState = (room) => events(room, 'state').pop();
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
  room.state.busyUntil = 0;
  return room;
}
const idOf = (room, seat) => room.state.players[seat];
// A shot that flies off the left edge (red) / right edge (blue): never touches anything.
const wild = (seat) => ({ angle: seat === 'red' ? 175 : 5, power: 100, weapon: 'shell' });
function fireAs(room, input) {
  const seat = room.state.turn;
  act(room, idOf(room, seat), { kind: 'fire', ...(input || wild(seat)) });
  room.state.busyUntil = 0;
}
const tanksOf = (st) => ({ red: { x: st.tanks.red.x, hp: st.tanks.red.hp }, blue: { x: st.tanks.blue.x, hp: st.tanks.blue.hp } });

// ---- sim ----
test('sim: generate is deterministic and in range; tanks start apart on flat pads', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const a = Sim.generate(seed);
    assert.deepStrictEqual(a, Sim.generate(seed));
    assert.strictEqual(a.terrain.length, Sim.W);
    for (const y of a.terrain) assert.ok(Number.isInteger(y) && y >= 40 && y <= Sim.H * 0.74);
    assert.ok(a.xs.red < Sim.W / 2 && a.xs.blue > Sim.W / 2);
    assert.ok(a.xs.blue - a.xs.red > 300);
    for (const x of [a.xs.red, a.xs.blue]) assert.ok(Math.abs(a.terrain[x + 6] - a.terrain[x - 6]) <= 2);
  }
  assert.notDeepStrictEqual(Sim.generate(1).terrain, Sim.generate(2).terrain);
});

test('sim: carve digs a crater, never below the floor', () => {
  const t = Sim.generate(7).terrain;
  const x = 500;
  const before = t.slice();
  Sim.carve(t, x, t[x], 30);
  assert.ok(t[x] < before[x] - 20);
  assert.strictEqual(t[x - 40], before[x - 40]);
  const flat = new Array(Sim.W).fill(20);
  Sim.carve(flat, 300, 20, 50);
  for (const y of flat) assert.ok(y >= Sim.FLOOR);
  // a blast high in the air touches nothing
  const sky = Sim.generate(7).terrain;
  Sim.carve(sky, 500, Sim.H, 20);
  assert.deepStrictEqual(sky, Sim.generate(7).terrain);
});

test('sim: driving costs fuel, stops at fuel / edges / the other tank / walls', () => {
  const flat = new Array(Sim.W).fill(100);
  let d = Sim.drive(flat, 200, 1, 500, Sim.FUEL, 800);
  assert.strictEqual(d.moved, Sim.FUEL);
  assert.strictEqual(d.fuel, 0);
  assert.strictEqual(d.x, 200 + Sim.FUEL);
  d = Sim.drive(flat, 30, -1, 100, 100, 800);
  assert.strictEqual(d.x, Sim.MARGIN);
  d = Sim.drive(flat, 500, 1, 100, 100, 540);
  assert.strictEqual(d.x, 540 - Sim.TANK_GAP);
  const wall = flat.slice();
  for (let x = 520; x < Sim.W; x++) wall[x] = 200;
  d = Sim.drive(wall, 500, 1, 60, 80, 900);
  assert.strictEqual(d.x, 519);
  // climbing costs extra
  const ramp = flat.map((_, x) => 100 + Math.max(0, x - 300) * 2);
  d = Sim.drive(ramp, 300, 1, 10, 80, 900);
  assert.strictEqual(d.moved, 10);
  assert.strictEqual(d.fuel, 80 - 30);
});

test('sim: normInput rejects garbage, clamps and rounds', () => {
  for (const bad of [null, 5, 'x', {}, { angle: NaN, power: 5, weapon: 'shell' }, { angle: 1, power: 1, weapon: 'nuke' },
    { angle: 1, power: 1, weapon: 'toString' }, { angle: 1, power: 1, weapon: '__proto__' }, { angle: Infinity, power: 1, weapon: 'shell' }]) {
    assert.strictEqual(Sim.normInput(bad), null);
  }
  assert.deepStrictEqual(Sim.normInput({ angle: 200.4, power: -3, weapon: 'big' }), { angle: 180, power: 0, weapon: 'big' });
  assert.deepStrictEqual(Sim.normInput({ angle: '44.6', power: '50.2', weapon: 'triple' }), { angle: 45, power: 50, weapon: 'triple' });
});

test('sim: simulate is deterministic and does not mutate its input', () => {
  const g = Sim.generate(11);
  const tanks = { red: { x: g.xs.red, hp: 100 }, blue: { x: g.xs.blue, hp: 100 } };
  const copy = g.terrain.slice();
  for (const w of Sim.WEAPON_KEYS) {
    const a = Sim.simulate(g.terrain, tanks, 'red', { angle: 50, power: 62, weapon: w }, 3);
    const b = Sim.simulate(g.terrain, tanks, 'red', { angle: 50, power: 62, weapon: w }, 3);
    assert.deepStrictEqual(a, b);
    assert.ok(a.frames > 10 && a.frames <= 840);
  }
  assert.deepStrictEqual(g.terrain, copy);
});

test('sim: weapons — triple fires 3 shells, big digs deeper, bouncer bounces', () => {
  const flat = new Array(Sim.W).fill(120);
  const tanks = { red: { x: 100, hp: 100 }, blue: { x: 900, hp: 100 } };
  const tri = Sim.simulate(flat, tanks, 'red', { angle: 45, power: 60, weapon: 'triple' }, 0);
  assert.strictEqual(tri.projectiles.length, 3);
  assert.strictEqual(tri.explosions.length, 3);
  const sh = Sim.simulate(flat, tanks, 'red', { angle: 45, power: 60, weapon: 'shell' }, 0);
  const bg = Sim.simulate(flat, tanks, 'red', { angle: 45, power: 60, weapon: 'big' }, 0);
  assert.ok(Math.min(...bg.terrain) < Math.min(...sh.terrain));
  const bo = Sim.simulate(flat, tanks, 'red', { angle: 30, power: 45, weapon: 'bouncer' }, 0);
  assert.ok(bo.projectiles[0].bounces.length >= 1);
  assert.ok(bo.explosions[0].x > sh.explosions[0].x - 400);
  // wind pushes the shell
  const tail = Sim.simulate(flat, tanks, 'red', { angle: 45, power: 60, weapon: 'shell' }, 10);
  const head = Sim.simulate(flat, tanks, 'red', { angle: 45, power: 60, weapon: 'shell' }, -10);
  assert.ok(tail.explosions[0].x > sh.explosions[0].x && head.explosions[0].x < sh.explosions[0].x);
});

test('sim: a direct hit damages the target, self-blasts hurt the shooter', () => {
  const g = Sim.generate(3);
  const tanks = { red: { x: g.xs.red, hp: 100 }, blue: { x: g.xs.blue, hp: 100 } };
  const s = Sim.solve(g.terrain, tanks, 'red', 'shell', 4);
  const r = Sim.simulate(g.terrain, tanks, 'red', { angle: s.angle, power: s.power, weapon: 'shell' }, 4);
  assert.ok(r.hp.blue <= 100 - 25, `blue hp ${r.hp.blue}`);
  assert.strictEqual(r.hp.red, 100);
  const self = Sim.simulate(g.terrain, tanks, 'red', { angle: 90, power: 8, weapon: 'big' }, 0);
  assert.ok(self.hp.red < 100);
});

test('sim: solver lands near the enemy across terrains, wind and both sides', () => {
  let close = 0;
  let n = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const g = Sim.generate(seed * 31);
    const tanks = { red: { x: g.xs.red, hp: 100 }, blue: { x: g.xs.blue, hp: 100 } };
    for (const by of ['red', 'blue']) {
      const wind = ((seed * 7) % 21) - 10;
      const s = Sim.solve(g.terrain, tanks, by, 'shell', wind);
      const r = Sim.simulate(g.terrain, tanks, by, { angle: s.angle, power: s.power, weapon: 'shell' }, wind);
      n++;
      if (r.hp[by === 'red' ? 'blue' : 'red'] < 100) close++;
    }
  }
  assert.ok(close >= n * 0.85, `${close}/${n} solver shots hit`);
});

test('sim: client replay (carve with broadcast explosions) reproduces the server terrain', () => {
  const g = Sim.generate(99);
  const tanks = { red: { x: g.xs.red, hp: 100 }, blue: { x: g.xs.blue, hp: 100 } };
  for (const w of Sim.WEAPON_KEYS) {
    const r = Sim.simulate(g.terrain, tanks, 'red', { angle: 48, power: 64, weapon: w }, -4);
    const t = g.terrain.slice();
    for (const ev of r.explosions) Sim.carve(t, ev.x, ev.y, ev.r);
    assert.deepStrictEqual(t, r.terrain, w);
  }
});

// ---- rules ----
test('rules: firing passes the turn, refuels the opponent and spends ammo', () => {
  const room = seated();
  const st = room.state;
  assert.strictEqual(st.phase, 'playing');
  assert.strictEqual(st.turn, 'red');
  act(room, 'A', { kind: 'drive', dir: 1, steps: 10, seq: 1 });
  assert.ok(st.tanks.red.fuel < Sim.FUEL);
  fireAs(room, { angle: 175, power: 100, weapon: 'big' });
  assert.strictEqual(st.turn, 'blue');
  assert.strictEqual(st.turnNo, 1);
  assert.strictEqual(st.tanks.red.ammo.big, 1);
  assert.strictEqual(st.tanks.blue.fuel, Sim.FUEL);
  assert.ok(st.wind >= -10 && st.wind <= 10 && Number.isInteger(st.wind));
  const s = lastState(room);
  assert.strictEqual(s.lastShot.seq, 1);
  assert.strictEqual(s.lastShot.by, 'red');
  assert.strictEqual(s.lastShot.windNext, st.wind);
  fireAs(room);
  assert.strictEqual(st.turn, 'red');
  assert.strictEqual(st.tanks.red.fuel, Sim.FUEL);
});

test('rules: ammo runs out -> no_ammo; shell is unlimited', () => {
  const room = seated();
  for (let i = 0; i < 2; i++) {
    fireAs(room, { angle: 175, power: 100, weapon: 'triple' });
    fireAs(room);
  }
  assert.strictEqual(room.state.tanks.red.ammo.triple, 0);
  act(room, 'A', { kind: 'fire', angle: 175, power: 100, weapon: 'triple' });
  assert.strictEqual(lastReject(room, 'A'), 'no_ammo');
  assert.strictEqual(room.state.turn, 'red');
  fireAs(room);
  assert.strictEqual(room.state.turn, 'blue');
});

test('rules: destroying the enemy wins; both dead is a draw', () => {
  const room = seated();
  const st = room.state;
  st.tanks.blue.hp = 5;
  const s = Sim.solve(st.terrain, tanksOf(st), 'red', 'shell', st.wind);
  fireAs(room, { angle: s.angle, power: s.power, weapon: 'shell' });
  assert.strictEqual(st.phase, 'game_over');
  assert.strictEqual(st.winner, 'red');
  assert.strictEqual(st.endReason, 'destroyed');
  assert.strictEqual(st.stats.red.hits, 1);
  act(room, 'A', { kind: 'fire', angle: 10, power: 10, weapon: 'shell' });
  assert.strictEqual(lastReject(room, 'A'), 'not_playing');

  const r2 = seated();
  const s2 = r2.state;
  s2.tanks.red.hp = 1;
  s2.tanks.blue.hp = 1;
  // drive red right next to blue and blast the ground between them
  s2.tanks.red.x = s2.tanks.blue.x - Sim.TANK_GAP;
  fireAs(r2, { angle: 90, power: 6, weapon: 'big' });
  assert.strictEqual(s2.phase, 'game_over');
  assert.strictEqual(s2.winner, 'draw');
});

test('rules: after MAX_TURNS shots the healthier tank wins (or a draw)', () => {
  const room = seated();
  const st = room.state;
  st.tanks.blue.hp = 60;
  const calm = (r) => { r.state.terrain.fill(100); r.state.wind = 0; }; // wild shots must touch nothing
  for (let i = 0; i < Sim.MAX_TURNS && st.phase === 'playing'; i++) { calm(room); fireAs(room); }
  assert.strictEqual(st.phase, 'game_over');
  assert.strictEqual(st.turnNo, Sim.MAX_TURNS);
  assert.strictEqual(st.winner, 'red');
  assert.strictEqual(st.endReason, 'turns');
  const r2 = seated();
  for (let i = 0; i < Sim.MAX_TURNS; i++) { calm(r2); fireAs(r2); }
  assert.strictEqual(r2.state.winner, 'draw');
});

// ---- protocol ----
test('protocol: turn / busy / spectator guards; aim & drive broadcast tank events', () => {
  const room = seated();
  act(room, 'B', { kind: 'fire', angle: 45, power: 50, weapon: 'shell' });
  assert.strictEqual(lastReject(room, 'B'), 'not_your_turn');
  act(room, 'S', { kind: 'fire', angle: 45, power: 50, weapon: 'shell' });
  assert.strictEqual(lastReject(room, 'S'), 'not_your_turn');
  act(room, 'A', { kind: 'fire', angle: 45, power: 50, weapon: 'nuke' });
  assert.strictEqual(lastReject(room, 'A'), 'invalid');
  act(room, 'A', { kind: 'fire', angle: 'x', power: 50, weapon: 'shell' });
  assert.strictEqual(lastReject(room, 'A'), 'invalid');
  const n = room.sent.length;
  act(room, 'B', { kind: 'aim', angle: 10, power: 10 });
  act(room, 'B', { kind: 'drive', dir: 1, steps: 5 });
  assert.strictEqual(room.sent.length, n); // out-of-turn aim/drive ignored silently
  act(room, 'A', { kind: 'aim', angle: 61.4, power: 77, weapon: 'bouncer' });
  let t = events(room, 'tank').pop();
  assert.deepStrictEqual([t.seat, t.angle, t.power, t.weapon], ['red', 61, 77, 'bouncer']);
  const x0 = room.state.tanks.red.x;
  act(room, 'A', { kind: 'drive', dir: -1, steps: 3, seq: 9 });
  t = events(room, 'tank').pop();
  assert.strictEqual(t.ack, 9);
  assert.ok(t.x < x0 && t.fuel < Sim.FUEL);
  act(room, 'A', { kind: 'drive', dir: 1, steps: 61 });
  act(room, 'A', { kind: 'drive', dir: 2, steps: 5 });
  assert.strictEqual(room.state.tanks.red.x, t.x);
  // busy while the shot flies
  act(room, 'A', { kind: 'fire', angle: 175, power: 100, weapon: 'shell' });
  act(room, 'B', { kind: 'fire', angle: 5, power: 100, weapon: 'shell' });
  assert.strictEqual(lastReject(room, 'B'), 'busy');
  assert.ok(room.state.busyUntil > Date.now());
});

test('protocol: garbage never throws and never changes the game', () => {
  const room = seated();
  const before = JSON.stringify(room.state);
  const junk = [null, undefined, 5, 'str', [], {}, { kind: 5 }, { kind: 'sit', seat: 'green' }, { kind: 'sit', seat: '__proto__' },
    { kind: 'fire' }, { kind: 'fire', angle: {}, power: [], weapon: 'constructor' }, { kind: 'fire', weapon: '__proto__', angle: 1, power: 1 },
    { kind: 'aim', angle: 'a' }, { kind: 'aim', angle: 5, power: 5, weapon: 'hasOwnProperty' }, { kind: 'drive', dir: 1, steps: 1.5 },
    { kind: 'drive', dir: '1', steps: 3 }, { kind: 'setBotLevel', seat: 'red', level: 'god' }, { kind: 'removeBot', seat: 'red' },
    { kind: 'resetGame' }, { kind: 'leaveSeat' }, { kind: 'toString' }];
  for (const j of junk) {
    for (const id of ['A', 'S']) {
      if (j && j.kind === 'leaveSeat' && id === 'A') continue;
      plugin.onMessage(room, { clientId: id }, j, ctxFor(room, id));
    }
  }
  const after = JSON.parse(JSON.stringify(room.state));
  const b = JSON.parse(before);
  assert.deepStrictEqual(after.tanks.red.x, b.tanks.red.x);
  assert.strictEqual(after.shotSeq, 0);
  assert.strictEqual(after.tanks.red.weapon, 'shell');
  assert.deepStrictEqual(after.players, b.players);
  plugin.onLeave(room, { clientId: 'nobody' });
  assert.strictEqual(room.state.phase, 'playing');
});

test('protocol: broadcast shot matches the shared sim exactly; snapshot is JSON-safe', () => {
  const room = seated();
  const st = room.state;
  const terrain = st.terrain.slice();
  const tanks = tanksOf(st);
  const wind = st.wind;
  const input = { angle: 52, power: 66, weapon: 'triple' };
  act(room, 'A', { kind: 'fire', ...input });
  const shot = lastState(room).lastShot;
  const r = Sim.simulate(terrain, tanks, 'red', input, wind);
  assert.deepStrictEqual(shot.projectiles, r.projectiles);
  assert.deepStrictEqual(shot.explosions, r.explosions);
  assert.deepStrictEqual(st.terrain, r.terrain);
  const snap = plugin.serializeSnapshot(room);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(snap)).lastShot, JSON.parse(JSON.stringify(shot)));
  assert.ok(JSON.stringify(snap).length < 200000);
});

// ---- seats ----
test('seats: one seat per person, leaving mid-game resets, rematch swaps sides', () => {
  const room = makeRoom();
  assert.strictEqual(plugin.isRoomFull(room), false);
  act(room, 'A', { kind: 'sit', seat: 'red' });
  act(room, 'A', { kind: 'sit', seat: 'blue' });
  assert.strictEqual(room.state.players.blue, null);
  act(room, 'B', { kind: 'sit', seat: 'red' });
  assert.strictEqual(room.state.players.red, 'A');
  act(room, 'B', { kind: 'sit', seat: 'blue' });
  assert.strictEqual(room.state.phase, 'playing');
  room.state.busyUntil = 0;
  fireAs(room);
  act(room, 'B', { kind: 'leaveSeat' });
  assert.strictEqual(room.state.phase, 'waiting');
  assert.strictEqual(room.state.shotSeq, 0);
  act(room, 'C', { kind: 'sit', seat: 'blue' });
  assert.strictEqual(room.state.phase, 'playing');
  act(room, 'A', { kind: 'resetGame' });
  assert.strictEqual(room.state.players.red, 'A'); // no reset mid-game
  room.state.tanks.blue.hp = 1;
  const s = Sim.solve(room.state.terrain, tanksOf(room.state), 'red', 'big', room.state.wind);
  fireAs(room, { angle: s.angle, power: s.power, weapon: 'big' });
  assert.strictEqual(room.state.phase, 'game_over');
  const gid = room.state.gameId;
  act(room, 'S', { kind: 'resetGame' }); // spectators can't
  assert.strictEqual(room.state.phase, 'game_over');
  act(room, 'C', { kind: 'resetGame' });
  assert.strictEqual(room.state.phase, 'playing');
  assert.deepStrictEqual(room.state.players, { red: 'C', blue: 'A' });
  assert.strictEqual(room.state.gameId, gid + 1);
  assert.strictEqual(room.state.tanks.red.hp, Sim.MAX_HP);
  plugin.onLeave(room, { clientId: 'A' });
  assert.strictEqual(room.state.phase, 'waiting');
  assert.strictEqual(room.state.players.blue, null);
});

// ---- bots ----
test('bots: level change, removal, bot-vs-bot completes, human leave cancels the bot', async () => {
  const t = plugin._internal.timing;
  const saved = { ...t };
  Object.assign(t, { min: 0, max: 1, aim: 0, drive: 0, after: -100000 });
  try {
    const room = makeRoom();
    act(room, 'A', { kind: 'sit', seat: 'blue', bot: true, level: 'easy' });
    act(room, 'A', { kind: 'setBotLevel', seat: 'blue', level: 'expert' });
    assert.strictEqual(room.state.botLevels.blue, 'expert');
    act(room, 'A', { kind: 'removeBot', seat: 'blue' });
    assert.strictEqual(room.state.players.blue, null);

    for (const lv of ['easy', 'expert']) {
      const bb = makeRoom();
      act(bb, 'A', { kind: 'sit', seat: 'red', bot: true, level: lv });
      act(bb, 'A', { kind: 'sit', seat: 'blue', bot: true, level: lv });
      for (let i = 0; i < 1500 && bb.state.phase === 'playing'; i++) await wait(2);
      assert.strictEqual(bb.state.phase, 'game_over', `${lv} bot game stalled at shot ${bb.state.shotSeq}`);
      assert.ok(['red', 'blue', 'draw'].includes(bb.state.winner));
    }

    // human vs bot: the bot answers after the human fires; then waits for the human
    const hb = makeRoom();
    act(hb, 'A', { kind: 'sit', seat: 'red' });
    act(hb, 'A', { kind: 'sit', seat: 'blue', bot: true, level: 'medium' });
    hb.state.busyUntil = 0;
    fireAs(hb);
    assert.strictEqual(hb.state.turn, 'blue');
    for (let i = 0; i < 300 && hb.state.shotSeq < 2; i++) await wait(2);
    assert.strictEqual(hb.state.shotSeq, 2);
    assert.strictEqual(hb.state.turn, 'red');
    await wait(20);
    assert.strictEqual(hb.state.shotSeq, 2);
    // a human leaving cancels the bot's pending shot
    hb.state.busyUntil = 0;
    fireAs(hb);
    plugin.onLeave(hb, { clientId: 'A' });
    const seq = hb.state.shotSeq;
    await wait(40);
    assert.strictEqual(hb.state.shotSeq, seq);
    assert.strictEqual(hb.state.phase, 'waiting');
  } finally {
    Object.assign(t, saved);
  }
});

function headless(a, b, seed) {
  const st = plugin.createInitialState();
  st.phase = 'playing';
  st.botLevels = { red: a, blue: b };
  const rand = rng(seed);
  for (let n = 0; st.phase === 'playing' && n < 100; n++) {
    const p = Sim.botPlan({ terrain: st.terrain, tanks: st.tanks, wind: st.wind, turnNo: st.turnNo }, st.turn, st.botLevels[st.turn], rand);
    assert.ok(Sim.normInput(p), 'bot plan is a valid shot');
    if (p.drive) applyDrive(st, st.turn, p.drive.dir, p.drive.steps);
    assert.ok(applyFire(st, st.turn, p, 0));
  }
  return st;
}
function series(a, b, n) {
  let wa = 0; let wb = 0; let draws = 0;
  const hit = { [a]: [0, 0], [b]: [0, 0] };
  for (let i = 0; i < n; i++) {
    const swap = i % 2 === 1;
    const st = headless(swap ? b : a, swap ? a : b, 1000 + i);
    const sideA = swap ? 'blue' : 'red';
    const sideB = swap ? 'red' : 'blue';
    if (st.winner === 'draw') draws++; else if (st.winner === sideA) wa++; else wb++;
    hit[a][0] += st.stats[sideA].hits; hit[a][1] += st.stats[sideA].shots;
    hit[b][0] += st.stats[sideB].hits; hit[b][1] += st.stats[sideB].shots;
  }
  return { wa, wb, draws, rateA: hit[a][0] / hit[a][1], rateB: hit[b][0] / hit[b][1] };
}

test('bots: skill gradient — expert crushes easy, each level beats the one below', () => {
  const ee = series('expert', 'easy', 12);
  assert.ok(ee.wa >= 11, `expert vs easy ${ee.wa}-${ee.wb}`);
  assert.ok(ee.rateA > ee.rateB + 0.25, `hit rates ${ee.rateA} vs ${ee.rateB}`);
  const hm = series('hard', 'medium', 12);
  assert.ok(hm.wa >= 8, `hard vs medium ${hm.wa}-${hm.wb}`);
  const me = series('medium', 'easy', 12);
  assert.ok(me.wa >= 7, `medium vs easy ${me.wa}-${me.wb}`);
  console.log(`     expert-easy ${ee.wa}-${ee.wb} (hit ${(ee.rateA * 100).toFixed(0)}% vs ${(ee.rateB * 100).toFixed(0)}%), `
    + `hard-medium ${hm.wa}-${hm.wb}, medium-easy ${me.wa}-${me.wb}`);
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
