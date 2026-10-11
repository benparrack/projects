// Pool: deterministic sim, 8-Ball/9-Ball rules, protocol guards, and bot-vs-bot games at every level.
// Run: node test/pool.test.js
'use strict';

const assert = require('assert');
const plugin = require('../server/games/pool');
const Sim = require('../public/games/pool/sim.js');

const I = plugin._internal;
const LEVELS = ['easy', 'medium', 'hard', 'expert'];
let failures = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function makeRoom(ids = ['A', 'B', 'C']) {
  const sent = [];
  const room = {
    state: plugin.createInitialState(),
    clients: new Map(ids.map((id) => [id, { nickname: id }])),
    broadcast: (m, except) => { for (const id of ids) if (id !== except) sent.push({ to: id, m }); },
    sendTo: (id, m) => sent.push({ to: id, m }),
  };
  room.sent = sent;
  return room;
}
const act = (room, id, data) => plugin.onMessage(room, { clientId: id }, data, { senderId: id, broadcast: room.broadcast, sendTo: room.sendTo });
const lastFor = (room, id, kind) => {
  const s = [...room.sent].reverse().find((x) => x.to === id && x.m.payload.data.kind === kind);
  return s && s.m.payload.data;
};
// A playing 8-ball/9-ball state with a hand-placed table.
function table(mode, balls, extra = {}) {
  const st = plugin.createInitialState();
  st.mode = mode;
  I.newRack(st);
  Object.assign(st, { phase: 'playing', players: { p1: 'X', p2: 'Y' }, balls, turn: 'p1', ballInHand: false, kitchen: false, breakShot: false }, extra);
  return st;
}
const straight = (from, to, power = 0.35) => Sim.normShot({ dx: to.x - from.x, dy: to.y - from.y, power });

test('sim is deterministic and the break spreads the rack', () => {
  const rack = I.rack8();
  const shot = Sim.normShot({ dx: Sim.FOOT.x - rack[0].x, dy: 0.3, power: 1 });
  const a = Sim.simulate(rack, shot);
  const b = Sim.simulate(rack, shot);
  assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
  // replaying step by step (as clients do) lands on the same table
  const run = Sim.createShot(rack, shot);
  while (!run.done) run.step();
  const replay = run.balls.filter((x) => x.on).map((x) => [x.n, x.x, x.y]);
  assert.deepStrictEqual(replay, a.balls.map((x) => [x.n, x.x, x.y]));
  const moved = a.balls.filter((x) => x.n !== 0 && Math.abs(x.x - Sim.FOOT.x) > 30).length;
  assert.ok(moved >= 4, `break barely spread (${moved})`);
});

test('racks: 8 in the middle of the 8-ball rack, 1 on the apex and 9 central in 9-ball', () => {
  const r8 = I.rack8();
  assert.strictEqual(r8.length, 16);
  const eight = r8.find((b) => b.n === 8);
  assert.ok(Math.abs(eight.y - Sim.W / 2) < 0.5);
  const r9 = I.rack9();
  assert.strictEqual(r9.length, 10);
  const apex = r9.filter((b) => b.n !== 0).sort((a, b) => a.x - b.x)[0];
  assert.strictEqual(apex.n, 1);
  assert.ok(Math.abs(r9.find((b) => b.n === 9).y - Sim.W / 2) < 0.5);
});

test('8-ball: potting sets groups and keeps the turn; scratch gives ball in hand', () => {
  const cue = { n: 0, x: 100, y: 63.5 };
  const st = table('8ball', [cue, { n: 3, x: 200, y: 63.5 }, { n: 8, x: 60, y: 20 }, { n: 12, x: 60, y: 100 }]);
  // aim the 3 straight into the middle of the foot rail → no pot, but is it legal? use a corner pot instead
  st.balls = [{ n: 0, x: 200, y: 40 }, { n: 3, x: 230, y: 13 }, { n: 8, x: 60, y: 20 }, { n: 12, x: 60, y: 100 }];
  const pk = Sim.POCKETS[2];
  const t = st.balls[1];
  let ux = pk.aimX - t.x; let uy = pk.aimY - t.y; const d = Math.sqrt(ux * ux + uy * uy); ux /= d; uy /= d;
  const ghost = { x: t.x - ux * 2 * Sim.R, y: t.y - uy * 2 * Sim.R };
  const res = I.applyShot(st, 'p1', straight(st.balls[0], ghost, 0.3), null);
  assert.deepStrictEqual(res.pots, [3]);
  assert.strictEqual(res.foul, null);
  assert.deepStrictEqual(st.groups, { p1: 'solids', p2: 'stripes' });
  assert.strictEqual(st.turn, 'p1');
  // now scratch: shoot the cue straight into a corner with nothing in the way
  st.balls = [{ n: 0, x: 30, y: 30 }, { n: 8, x: 200, y: 100 }, { n: 12, x: 150, y: 100 }];
  const r2 = I.applyShot(st, 'p1', straight(st.balls[0], { x: 0, y: 0 }, 0.4), null);
  assert.strictEqual(r2.foul, 'scratch');
  assert.strictEqual(st.turn, 'p2');
  assert.strictEqual(st.ballInHand, true);
  assert.ok(st.balls.find((b) => b.n === 0), 'cue ball returned to the table');
});

test('8-ball: hitting the wrong group first is a foul; early 8 loses; 8 on a clear table wins', () => {
  const st = table('8ball', [{ n: 0, x: 100, y: 63.5 }, { n: 12, x: 160, y: 63.5 }, { n: 2, x: 60, y: 20 }, { n: 8, x: 60, y: 100 }], { groups: { p1: 'solids', p2: 'stripes' } });
  const r = I.applyShot(st, 'p1', straight(st.balls[0], st.balls[1], 0.3), null);
  assert.strictEqual(r.foul, 'wrong_ball');
  assert.strictEqual(st.turn, 'p2');
  assert.strictEqual(st.ballInHand, true);

  // early 8: p1 still has solids and pots the 8
  const pot8 = (balls, groups) => {
    const s = table('8ball', balls, { groups });
    const t = s.balls.find((b) => b.n === 8);
    const pk = Sim.POCKETS[2];
    let ux = pk.aimX - t.x; let uy = pk.aimY - t.y; const d = Math.sqrt(ux * ux + uy * uy); ux /= d; uy /= d;
    const ghost = { x: t.x - ux * 2 * Sim.R, y: t.y - uy * 2 * Sim.R };
    I.applyShot(s, 'p1', straight(s.balls[0], ghost, 0.3), null);
    return s;
  };
  const early = pot8([{ n: 0, x: 200, y: 40 }, { n: 8, x: 230, y: 13 }, { n: 2, x: 60, y: 100 }, { n: 12, x: 40, y: 100 }], { p1: 'solids', p2: 'stripes' });
  assert.strictEqual(early.winner, 'p2');
  const win = pot8([{ n: 0, x: 200, y: 40 }, { n: 8, x: 230, y: 13 }, { n: 12, x: 40, y: 100 }], { p1: 'solids', p2: 'stripes' });
  assert.strictEqual(win.winner, 'p1');
  assert.strictEqual(win.phase, 'game_over');
});

test('9-ball: must hit the lowest ball; 9 on a legal shot wins, on a foul it is re-spotted', () => {
  const st = table('9ball', [{ n: 0, x: 100, y: 63.5 }, { n: 5, x: 160, y: 63.5 }, { n: 2, x: 60, y: 20 }, { n: 9, x: 60, y: 100 }]);
  const r = I.applyShot(st, 'p1', straight(st.balls[0], st.balls[1], 0.3), null);
  assert.strictEqual(r.foul, 'wrong_ball');
  assert.strictEqual(st.turn, 'p2');
  // combo: hit the 2 (lowest) which drives the 9 into the corner → win
  const pk = Sim.POCKETS[2];
  const nine = { n: 9, x: 230, y: 13 };
  let ux = pk.aimX - nine.x; let uy = pk.aimY - nine.y; const d = Math.sqrt(ux * ux + uy * uy); ux /= d; uy /= d;
  const two = { n: 2, x: nine.x - ux * 2.05 * Sim.R, y: nine.y - uy * 2.05 * Sim.R };
  const cue = { n: 0, x: two.x - ux * 40, y: two.y - uy * 40 };
  const s2 = table('9ball', [cue, two, nine]);
  I.applyShot(s2, 'p1', straight(cue, two, 0.5), null);
  assert.strictEqual(s2.winner, 'p1');
  // 9 potted but the shot scratches too → foul, 9 comes back to the foot spot
  const s3 = table('9ball', [{ n: 0, x: 30, y: 30 }, { n: 1, x: 18, y: 18 }, { n: 9, x: 200, y: 100 }]);
  I.applyShot(s3, 'p1', straight(s3.balls[0], { x: 0, y: 0 }, 0.6), null);
  assert.ok(!s3.winner);
  assert.ok(s3.balls.find((b) => b.n === 9));
});

test('protocol: seats, turn guard, ball-in-hand placement validation, mode switching, rematch', () => {
  const room = makeRoom();
  act(room, 'C', { kind: 'setMode', mode: '9ball' }); // empty table: anyone may switch
  assert.strictEqual(room.state.mode, '9ball');
  act(room, 'A', { kind: 'sit', seat: 'p1' });
  act(room, 'A', { kind: 'sit', seat: 'p2' }); // already seated
  assert.strictEqual(room.state.players.p2, null);
  act(room, 'C', { kind: 'setMode', mode: '8ball' }); // spectator can't switch once someone sits
  assert.strictEqual(room.state.mode, '9ball');
  act(room, 'B', { kind: 'sit', seat: 'p2' });
  const st = room.state;
  assert.strictEqual(st.phase, 'playing');
  assert.strictEqual(st.turn, 'p1');
  act(room, 'B', { kind: 'shoot', dx: 1, dy: 0, power: 0.5 });
  assert.strictEqual(lastFor(room, 'B', 'moveRejected').reason, 'not_your_turn');
  act(room, 'A', { kind: 'shoot', dx: 'x', dy: 0, power: 0.5 });
  assert.strictEqual(lastFor(room, 'A', 'moveRejected').reason, 'invalid');
  act(room, 'A', { kind: 'shoot', dx: 1, dy: 0, power: 1, cue: { x: Sim.HEAD_X + 30, y: 60 } }); // outside the kitchen
  assert.strictEqual(lastFor(room, 'A', 'moveRejected').reason, 'bad_spot');
  assert.strictEqual(st.shotNo, 0);
  act(room, 'A', { kind: 'setMode', mode: '8ball' }); // not mid-game
  assert.strictEqual(st.mode, '9ball');
  // aim relays to others but not back to the shooter
  act(room, 'A', { kind: 'aim', dx: 1, dy: 0.1, power: 0.4 });
  assert.ok(lastFor(room, 'B', 'aim'));
  assert.ok(!lastFor(room, 'A', 'aim'));
  act(room, 'A', { kind: 'shoot', dx: 1, dy: 0.01, power: 1, cue: { x: Sim.HEAD_X - 10, y: 60 } });
  assert.strictEqual(st.shotNo, 1);
  assert.strictEqual(st.lastShot.start.find((b) => b.n === 0).x, Sim.HEAD_X - 10);
  assert.strictEqual(st.breakShot, false);
  // force a finish and rematch: breaker alternates, score kept
  st.phase = 'game_over'; st.winner = 'p1'; st.score.p1 = 1;
  act(room, 'C', { kind: 'resetGame' });
  assert.strictEqual(st.phase, 'game_over');
  act(room, 'B', { kind: 'resetGame' });
  assert.strictEqual(st.phase, 'playing');
  assert.strictEqual(st.turn, 'p2');
  assert.strictEqual(st.score.p1, 1);
  plugin.onLeave(room, { clientId: 'B' });
  assert.strictEqual(st.phase, 'waiting');
});

test('pockets: balls rolled into each mouth score in that pocket, balls on the jaw just outside do not', () => {
  const { L, W, R, CORNER, SIDE_HALF } = Sim;
  const roll = (x, y, dx, dy) => Sim.simulate([{ n: 0, x, y }], { dx, dy, power: 0.25 }).summary.pots;
  // [pocket, along-rail coordinate in the mouth, coordinate just outside the jaw tip, rail]
  const inMouth = CORNER - R - 0.3; // clears the rounded jaw tip
  const cases = [];
  for (const [p, cx, cy] of [[0, 0, 0], [2, L, 0], [3, 0, W], [5, L, W]]) {
    const sx = cx === 0 ? 1 : -1;
    const sy = cy === 0 ? 1 : -1;
    // into the long rail near the corner, into the short rail near the corner, and down the diagonal
    cases.push({ p, x: cx + sx * inMouth, y: cy + sy * 20, dx: 0, dy: -sy, pot: true });
    cases.push({ p, x: cx + sx * (CORNER + 0.3), y: cy + sy * 20, dx: 0, dy: -sy, pot: false });
    cases.push({ p, x: cx + sx * 20, y: cy + sy * inMouth, dx: -sx, dy: 0, pot: true });
    cases.push({ p, x: cx + sx * 20, y: cy + sy * (CORNER + 0.3), dx: -sx, dy: 0, pot: false });
    cases.push({ p, x: cx + sx * 30, y: cy + sy * 30, dx: -sx, dy: -sy, pot: true });
  }
  for (const [p, cy] of [[1, 0], [4, W]]) {
    const sy = cy === 0 ? 1 : -1;
    for (const k of [-1, 0, 1]) cases.push({ p, x: L / 2 + k * (SIDE_HALF - R - 0.3), y: cy + sy * 20, dx: 0, dy: -sy, pot: true });
    for (const k of [-1, 1]) cases.push({ p, x: L / 2 + k * (SIDE_HALF + 0.3), y: cy + sy * 20, dx: 0, dy: -sy, pot: false });
  }
  for (const c of cases) {
    const pots = roll(c.x, c.y, c.dx, c.dy);
    if (c.pot) assert.ok(pots.length === 1 && pots[0].pocket === c.p, `expected pot in ${c.p}: ${JSON.stringify(c)} -> ${JSON.stringify(pots)}`);
    else assert.strictEqual(pots.length, 0, `jaw shot should not score: ${JSON.stringify(c)} -> ${JSON.stringify(pots)}`);
  }
});

// Small seeded PRNG so the statistical tests are repeatable.
const seeded = (seed) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

test('bot breaks: soft and scattered at low levels, potting rises with the level', () => {
  const stats = {};
  for (const level of LEVELS) {
    const rand = seeded(7);
    let pots = 0;
    let dry = 0;
    const N = 150;
    for (let i = 0; i < N; i++) {
      const st = table('8ball', null);
      I.newRack(st);
      const pick = I.chooseBotShot(st, st.turn, level, rand);
      const balls = st.balls.map((b) => (b.n === 0 && pick.cue ? { n: 0, ...pick.cue } : b));
      const p = Sim.simulate(balls, Sim.normShot(pick.shot)).summary.pots.filter((x) => x.n !== 0).length;
      pots += p;
      if (!p) dry++;
    }
    stats[level] = { avg: pots / N, dry: dry / N };
  }
  console.log('  break stats', JSON.stringify(stats));
  for (let i = 1; i < LEVELS.length; i++) assert.ok(stats[LEVELS[i]].avg > stats[LEVELS[i - 1]].avg, `break gradient ${LEVELS[i - 1]} -> ${LEVELS[i]}`);
  assert.ok(stats.easy.dry >= 0.55 && stats.medium.dry >= 0.3, 'easy/medium should often come up dry');
  assert.ok(stats.expert.avg < 2.2, 'expert break too strong');
});

test('bot-vs-bot (sync) at every level finishes in both modes', () => {
  for (const mode of ['8ball', '9ball']) {
    for (const level of LEVELS) {
      const st = table(mode, null);
      I.newRack(st);
      let shots = 0;
      while (!st.winner && shots < 300) {
        const pick = I.chooseBotShot(st, st.turn, st.turn === 'p1' ? level : 'hard');
        const shot = Sim.normShot(pick.shot);
        assert.ok(shot, 'bot produced an invalid shot');
        if (pick.cue) assert.ok(Sim.validCueSpot(st.balls.filter((b) => b.n !== 0), pick.cue.x, pick.cue.y, st.kitchen), 'bad cue spot');
        I.applyShot(st, st.turn, shot, pick.cue);
        shots++;
        const nums = st.balls.map((b) => b.n);
        assert.strictEqual(new Set(nums).size, nums.length, 'duplicate ball');
      }
      assert.ok(st.winner, `${mode} ${level}: no winner after ${shots} shots`);
      console.log(`  ${mode} ${level} vs hard: ${st.winner} wins (${st.winReason}) in ${shots} shots`);
    }
  }
});

test('level gradient: expert beats easy in most 8-ball games', () => {
  const rand = seeded(11);
  let expertWins = 0;
  const N = 12;
  for (let g = 0; g < N; g++) {
    const st = table('8ball', null, { breaker: g % 2 ? 'p2' : 'p1' });
    I.newRack(st);
    for (let shots = 0; !st.winner && shots < 300; shots++) {
      const pick = I.chooseBotShot(st, st.turn, st.turn === 'p1' ? 'expert' : 'easy', rand);
      I.applyShot(st, st.turn, Sim.normShot(pick.shot), pick.cue);
    }
    if (st.winner === 'p1') expertWins++;
  }
  console.log(`  expert vs easy: ${expertWins}/${N}`);
  assert.ok(expertWins >= 9, `expert only won ${expertWins}/${N}`);
});

test('bot-vs-bot through the room plugin (worker thread) reaches game over', async () => {
  I.timing.think = 0;
  I.timing.perStepMs = 0;
  const room = makeRoom(['A']);
  act(room, 'A', { kind: 'sit', seat: 'p1', bot: true, level: 'expert' });
  act(room, 'A', { kind: 'sit', seat: 'p2', bot: true, level: 'easy' });
  const t0 = Date.now();
  while (room.state.phase === 'playing' && Date.now() - t0 < 30000) await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(room.state.phase, 'game_over');
  assert.ok(room.state.score[room.state.winner] === 1);
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); console.log(`ok   ${name}`); } catch (err) { failures++; console.log(`FAIL ${name}\n     ${err.stack.split('\n').slice(0, 3).join('\n     ')}`); }
  }
  console.log(failures ? `\n${failures} failing` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
