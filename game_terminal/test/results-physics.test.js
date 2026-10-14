// End-of-match result reports (server/report.js) from the two-seat physics/duel plugins: pool,
// darts, cup pong, basketball, tanks, mini golf, archery, shuffleboard, bowling, knockout,
// paintball, skee-ball. Each test drives a match to its end through the plugin's messages (from a
// near-end position where a full game would be slow) and checks exactly one report with the right
// placements / scores. Run: node test/results-physics.test.js
'use strict';

const assert = require('assert');

let failures = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function makeRoom(plugin) {
  const room = {
    state: plugin.createInitialState(),
    clients: new Map(['A', 'B', 'C'].map((id) => [id, { nickname: id }])),
    broadcast: () => {},
    sendTo: () => {},
    results: [],
  };
  room.onResult = (r) => room.results.push(r);
  return room;
}
const actor = (plugin) => (room, id, data) => plugin.onMessage(room, { clientId: id }, data, { senderId: id, broadcast: room.broadcast, sendTo: room.sendTo });
function seated(plugin, seats, opts = {}) {
  const room = makeRoom(plugin);
  const act = actor(plugin);
  act(room, 'A', { kind: 'sit', seat: seats[0] });
  if (opts.bot) act(room, 'A', { kind: 'sit', seat: seats[1], bot: true, level: opts.bot });
  else act(room, 'B', { kind: 'sit', seat: seats[1] });
  room.state.busyUntil = 0;
  return { room, act };
}
const only = (room) => {
  assert.strictEqual(room.results.length, 1, `expected exactly one report, got ${room.results.length}`);
  return room.results[0];
};

test('metadata: every plugin declares stats, score only where it reports scores', () => {
  const withScore = { darts: 'high', basketball: 'high', minigolf: 'low', archery: 'high', bowling: 'high', paintball: 'high', skeeball: 'high' };
  for (const g of ['pool', 'darts', 'cuppong', 'basketball', 'tanks', 'minigolf', 'archery', 'shuffleboard', 'bowling', 'knockout', 'paintball', 'skeeball']) {
    const p = require(`../server/games/${g}`);
    assert.strictEqual(p.stats.rated, true, g);
    if (withScore[g]) assert.strictEqual(p.stats.score.better, withScore[g], g);
    else assert.strictEqual(p.stats.score, undefined, g);
  }
});

test('pool: potting the 8 on a clear table vs a bot reports once with botLevel', () => {
  const plugin = require('../server/games/pool');
  const Sim = require('../public/games/pool/sim.js');
  const { room, act } = seated(plugin, ['p1', 'p2'], { bot: 'medium' });
  const st = room.state;
  Object.assign(st, {
    balls: [{ n: 0, x: 200, y: 40 }, { n: 8, x: 230, y: 13 }, { n: 12, x: 40, y: 100 }],
    groups: { p1: 'solids', p2: 'stripes' }, turn: 'p1', ballInHand: false, kitchen: false, breakShot: false,
  });
  const t = st.balls[1];
  const pk = Sim.POCKETS[2];
  let ux = pk.aimX - t.x; let uy = pk.aimY - t.y; const d = Math.hypot(ux, uy); ux /= d; uy /= d;
  const ghost = { x: t.x - ux * 2 * Sim.R, y: t.y - uy * 2 * Sim.R };
  act(room, 'A', { kind: 'shoot', dx: ghost.x - 200, dy: ghost.y - 40, power: 0.3 });
  assert.strictEqual(st.winner, 'p1');
  assert.deepStrictEqual(only(room), { placements: [['A'], ['BOT']], botLevel: 'medium' });
});

test('darts: round-cap finish reports once with 3-dart averages (01 mode)', () => {
  const plugin = require('../server/games/darts');
  const { room, act } = seated(plugin, ['p1', 'p2']);
  const st = room.state;
  Object.assign(st, {
    round: plugin._internal.MAX_ROUNDS, turn: 'p2', scores: { p1: 100, p2: 50 }, turnStart: 50,
    turnDarts: [{ bust: false, scored: 0 }, { bust: false, scored: 0 }],
  });
  st.stats.p1 = { darts: 60, scored: 400, best: 0 };
  st.stats.p2 = { darts: 59, scored: 451, best: 0 };
  act(room, 'B', { kind: 'throw', x: 0, angle: 0, speed: 1, curve: 0 }); // wherever it lands, p2 stays lowest
  assert.strictEqual(st.phase, 'game_over');
  assert.strictEqual(st.winner, 'p2');
  const avg = (s) => Math.round((s.scored / s.darts) * 30) / 10;
  assert.deepStrictEqual(only(room), { placements: [['B'], ['A']], scores: { A: 20, B: avg(st.stats.p2) } });
});

test('cup pong: clearing the cups reports once; repeat broadcasts do not re-report; a rematch reports again', () => {
  const plugin = require('../server/games/cuppong');
  const Sim = require('../public/games/cuppong/sim.js');
  const { room, act } = seated(plugin, ['red', 'blue']);
  const MISS = { aim: -1, power: 0 };
  const play = (winnerColor) => {
    for (let guard = 0; room.state.phase === 'playing' && guard < 60; guard++) {
      const st = room.state;
      const cups = st.cups[st.turn === 'red' ? 'blue' : 'red'];
      act(room, st.players[st.turn], { kind: 'throw', ...(st.turn === winnerColor ? Sim.solveAim(cups[0]) : MISS) });
      room.state.busyUntil = 0;
    }
  };
  play('red');
  assert.deepStrictEqual(only(room), { placements: [['A'], ['B']] });
  act(room, 'A', { kind: 'setRerack', on: false }); // broadcasts again while game_over
  assert.strictEqual(room.results.length, 1);
  act(room, 'A', { kind: 'resetGame' }); // rematch swaps colours: B is red now
  play('red');
  assert.strictEqual(room.results.length, 2);
  assert.deepStrictEqual(room.results[1], { placements: [['B'], ['A']] });
});

test('basketball: higher total after both runs wins; scores are points', () => {
  const plugin = require('../server/games/basketball');
  const { room } = seated(plugin, ['red', 'blue']);
  plugin._internal.finishRun(room);
  room.state.scores = { red: 3, blue: 6 };
  plugin._internal.finishRun(room);
  assert.strictEqual(room.state.winner, 'blue');
  assert.deepStrictEqual(only(room), { placements: [['B'], ['A']], scores: { A: 3, B: 6 } });
});

test('basketball solo: one run alone (as blue) ends the game with a solo score', () => {
  const plugin = require('../server/games/basketball');
  const room = makeRoom(plugin);
  const act = actor(plugin);
  act(room, 'A', { kind: 'sit', seat: 'blue' });
  act(room, 'A', { kind: 'startSolo' });
  assert.strictEqual(room.state.run.shooter, 'blue');
  act(room, 'B', { kind: 'sit', seat: 'red' });
  assert.strictEqual(room.state.players.red, null);
  room.state.scores.blue = 14;
  plugin._internal.finishRun(room);
  assert.strictEqual(room.state.phase, 'game_over');
  assert.deepStrictEqual(only(room), { placements: [['A']], scores: { A: 14 } });
});

test('archery solo: five ends of three arrows alone, reports a solo score', () => {
  const plugin = require('../server/games/archery');
  const room = makeRoom(plugin);
  const act = actor(plugin);
  act(room, 'A', { kind: 'sit', seat: 'p2' });
  act(room, 'A', { kind: 'startSolo' });
  act(room, 'B', { kind: 'sit', seat: 'p1' });
  assert.strictEqual(room.state.players.p1, null);
  let n = 0;
  for (; room.state.phase === 'playing' && n < 30; n++) {
    assert.strictEqual(room.state.turn, 'p2');
    act(room, 'A', { kind: 'shoot', x: 0, y: 0, t: 1000, seed: room.state.shotSeed });
    room.state.busyUntil = 0;
  }
  assert.strictEqual(n, 15, 'five ends of three arrows');
  const r = only(room);
  assert.deepStrictEqual(r.placements, [['A']]);
  assert.strictEqual(r.scores.A, room.state.totals.p2);
});

test('mini golf solo: nine holes alone (as blue), the empty ball sits out, reports a solo score', () => {
  const plugin = require('../server/games/minigolf');
  const room = makeRoom(plugin);
  const act = actor(plugin);
  act(room, 'A', { kind: 'sit', seat: 'blue' });
  act(room, 'A', { kind: 'startSolo' });
  act(room, 'B', { kind: 'sit', seat: 'red' });
  assert.strictEqual(room.state.players.red, null);
  let putts = 0;
  for (; room.state.phase === 'playing' && putts < 80; putts++) {
    assert.strictEqual(room.state.turn, 'blue');
    assert.strictEqual(room.state.balls.red.done, true, 'red ball sits out');
    act(room, 'A', { kind: 'putt', angle: putts * 0.7, power: 0.6, t0: Date.now() });
    room.state.busyUntil = 0;
  }
  assert.strictEqual(room.state.phase, 'game_over');
  const r = only(room);
  assert.deepStrictEqual(r.placements, [['A']]);
  assert.strictEqual(r.scores.A, room.state.scores.blue.reduce((x, y) => x + y, 0));
});

test('tanks: healthier tank wins at the turn cap', () => {
  const plugin = require('../server/games/tanks');
  const Sim = require('../public/games/tanks/sim.js');
  const { room, act } = seated(plugin, ['red', 'blue']);
  const st = room.state;
  st.tanks.blue.hp = 60;
  for (let i = 0; i < Sim.MAX_TURNS && st.phase === 'playing'; i++) {
    st.terrain.fill(100); st.wind = 0; // wild shots touch nothing
    act(room, st.players[st.turn], { kind: 'fire', angle: st.turn === 'red' ? 175 : 5, power: 100, weapon: 'shell' });
    st.busyUntil = 0;
  }
  assert.strictEqual(st.winner, 'red');
  assert.deepStrictEqual(only(room), { placements: [['A'], ['B']] });
});

test('mini golf: last putt on hole 9 ends it; scores are total strokes (low)', () => {
  const plugin = require('../server/games/minigolf');
  const Sim = require('../public/games/minigolf/sim.js');
  const { room, act } = seated(plugin, ['red', 'blue']);
  const st = room.state;
  const last = Sim.HOLES.length - 1;
  const [x, y] = Sim.HOLES[last].tee;
  st.hole = last;
  st.balls = { red: { x, y, done: false, sunk: false }, blue: { x, y, done: true, sunk: true } };
  st.scores = { red: Sim.HOLES.map((_, i) => (i < last ? 2 : null)), blue: Sim.HOLES.map(() => 3) };
  st.strokes = { red: Sim.MAX_STROKES - 1, blue: 3 };
  st.turn = 'red';
  act(room, 'A', { kind: 'putt', angle: 0, power: 0.5, t0: Date.now() }); // holed or picked up: either way done
  assert.strictEqual(st.phase, 'game_over');
  assert.strictEqual(st.winner, 'red');
  const red = st.scores.red.reduce((a, b) => a + b, 0);
  assert.ok(red <= 2 * last + Sim.PICKUP_SCORE);
  assert.deepStrictEqual(only(room), { placements: [['A'], ['B']], scores: { A: red, B: 27 } });
});

test('archery: last arrow of the last end decides it; scores are totals', () => {
  const plugin = require('../server/games/archery');
  const Sim = require('../public/games/archery/sim.js');
  const { room, act } = seated(plugin, ['p1', 'p2']);
  const st = room.state;
  Object.assign(st, { end: Sim.ENDS, opener: 'p1', turn: 'p2', shotsInEnd: 2 * Sim.ARROWS_PER_END - 1, totals: { p1: 200, p2: 100 } });
  st.card.p1[Sim.ENDS - 1] = ['5', '5', '5'];
  st.card.p2[Sim.ENDS - 1] = ['5', '5'];
  act(room, 'B', { kind: 'shoot', x: 0, y: 0, t: 1000 });
  assert.strictEqual(st.winner, 'p1');
  assert.deepStrictEqual(only(room), { placements: [['A'], ['B']], scores: { A: 200, B: st.totals.p2 } });
});

test('shuffleboard: first to the target wins', () => {
  const plugin = require('../server/games/shuffleboard');
  const Sim = require('../public/games/shuffleboard/sim.js');
  const { room, act } = seated(plugin, ['red', 'blue']);
  const SHORT = { x: 0, aim: 0, power: 0 }; // removed short of the foul line
  const LANES = [-4.5, -1.5, 1.5, 4.5]; // red's 4 pucks rest side by side deep in the 3 zone
  for (let guard = 0; room.state.phase === 'playing' && guard < 40; guard++) {
    const st = room.state;
    const k = 4 - st.left.red;
    act(room, st.players[st.turn], { kind: 'shoot', ...(st.turn === 'red' ? Sim.aimAt(LANES[k], LANES[k], 96) : SHORT) });
    room.state.busyUntil = 0;
  }
  assert.strictEqual(room.state.winner, 'red');
  assert.deepStrictEqual(only(room), { placements: [['A'], ['B']] });
});

test('bowling: all gutters is a draw — one shared place, 0 pins each', () => {
  const plugin = require('../server/games/bowling');
  const { room, act } = seated(plugin, ['p1', 'p2']);
  for (let guard = 0; room.state.phase === 'playing' && guard < 60; guard++) {
    act(room, room.state.players[room.state.turn], { kind: 'roll', x: -1, aim: -1, power: 0.5, spin: 0 });
    room.state.busyUntil = 0;
  }
  assert.strictEqual(room.state.winner, 'draw');
  assert.deepStrictEqual(only(room), { placements: [['A', 'B']], scores: { A: 0, B: 0 } });
});

test('bowling solo: one bowler, ten frames, reports a solo score; nobody can sit in mid-run', () => {
  const plugin = require('../server/games/bowling');
  const room = makeRoom(plugin);
  const act = actor(plugin);
  act(room, 'A', { kind: 'sit', seat: 'p1' });
  act(room, 'A', { kind: 'startSolo' });
  assert.strictEqual(room.state.phase, 'playing');
  act(room, 'B', { kind: 'sit', seat: 'p2' });
  assert.strictEqual(room.state.players.p2, null, 'seat stays empty during a solo run');
  let balls = 0;
  for (; room.state.phase === 'playing' && balls < 40; balls++) {
    assert.strictEqual(room.state.turn, 'p1');
    act(room, 'A', { kind: 'roll', x: -1, aim: -1, power: 0.5, spin: 0 });
    room.state.busyUntil = 0;
  }
  assert.strictEqual(balls, 20, 'ten frames of two gutter balls');
  assert.deepStrictEqual(only(room), { placements: [['A']], scores: { A: 0 } });
  act(room, 'A', { kind: 'resetGame' });
  assert.strictEqual(room.state.phase, 'playing', 'rematch replays solo');
  assert.strictEqual(room.state.solo, true);
});

test('skeeball solo: nine balls alone (as blue), reports a solo score', () => {
  const plugin = require('../server/games/skeeball');
  const room = makeRoom(plugin);
  const act = actor(plugin);
  act(room, 'A', { kind: 'sit', seat: 'blue' });
  act(room, 'A', { kind: 'startSolo' });
  act(room, 'B', { kind: 'sit', seat: 'red' });
  assert.strictEqual(room.state.players.red, null);
  let balls = 0;
  for (; room.state.phase === 'playing' && balls < 20; balls++) {
    assert.strictEqual(room.state.turn, 'blue');
    act(room, 'A', { kind: 'roll', aim: 0, power: 0.6 });
    room.state.busyUntil = 0;
  }
  assert.strictEqual(balls, 9);
  const r = only(room);
  assert.deepStrictEqual(r.placements, [['A']]);
  assert.strictEqual(typeof r.scores.A, 'number');
});

test('knockout: knocking the last enemy penguin off wins', () => {
  const plugin = require('../server/games/knockout');
  const { room, act } = seated(plugin, ['red', 'blue']);
  const st = room.state;
  st.planFrom = 0;
  st.deadline = Date.now() + 60000;
  st.penguins = [{ id: 'r1', side: 'red', x: 0, y: -4, face: 0 }, { id: 'b0', side: 'blue', x: 0, y: -6.5, face: 0 }];
  act(room, 'A', { kind: 'submit', moves: { r1: { a: -Math.PI / 2, p: 0.8 } }, lock: true });
  act(room, 'B', { kind: 'submit', moves: {}, lock: true });
  assert.strictEqual(st.winner, 'red');
  plugin.tick(room); // later ticks change nothing
  assert.deepStrictEqual(only(room), { placements: [['A'], ['B']] });
});

test('paintball: higher run score wins after both runs (tick-driven end)', () => {
  const plugin = require('../server/games/paintball');
  const Sim = require('../public/games/paintball/sim.js');
  const { timing } = plugin._internal;
  const realNow = timing.now;
  let fake = 1e12;
  timing.now = () => fake;
  try {
    const { room, act } = seated(plugin, ['red', 'blue']);
    const st = room.state;
    for (const [id, score] of [['A', 120], ['B', 40]]) {
      act(room, id, { kind: 'start' });
      st.priv.sim.score = score;
      fake = st.runStart + Sim.RUN_MS + timing.endGrace + 10;
      plugin.tick(room);
    }
    assert.strictEqual(st.winner, 'red');
    assert.deepStrictEqual(only(room), { placements: [['A'], ['B']], scores: { A: 120, B: 40 } });
  } finally { timing.now = realNow; }
});

test('skee-ball: 9 balls each, higher total wins; score is the regulation total', () => {
  const plugin = require('../server/games/skeeball');
  const Sim = require('../public/games/skeeball/sim.js');
  const { room, act } = seated(plugin, ['red', 'blue']);
  for (let guard = 0; room.state.phase === 'playing' && guard < 30; guard++) {
    const c = room.state.turn;
    act(room, room.state.players[c], { kind: 'roll', ...(c === 'red' ? Sim.aimFor('50') : { aim: 0, power: 0 }) });
    room.state.busyUntil = 0;
  }
  assert.strictEqual(room.state.winner, 'red');
  assert.deepStrictEqual(only(room), { placements: [['A'], ['B']], scores: { A: 450, B: 0 } });
});

test('leaving mid-game is an abort, not a result', () => {
  const plugin = require('../server/games/cuppong');
  const { room } = seated(plugin, ['red', 'blue']);
  plugin.onLeave(room, { clientId: 'A' });
  assert.strictEqual(room.results.length, 0);
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
