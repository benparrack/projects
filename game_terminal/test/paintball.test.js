// Paintball: shared sim (deterministic schedule, hit-testing, gun rules), bot skill gradient,
// server protocol (turns, run clock, lag window, fire-rate/clip validation), seats/bots/rematch.
// Run: node test/paintball.test.js
'use strict';

const assert = require('assert');
const plugin = require('../server/games/paintball');
const Sim = require('../public/games/paintball/sim.js');

const LEVELS = ['easy', 'medium', 'hard', 'expert'];
const { timing } = plugin._internal;
let fakeNow = 1e12;
timing.now = () => fakeNow;
const advanceClock = (ms) => { fakeNow += ms; };

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
const datas = (room) => room.sent.map((s) => s.m.payload.data);
const lastState = (room) => datas(room).reverse().find((d) => d.kind === 'state');
const lastReject = (room, id) => {
  const s = [...room.sent].reverse().find((x) => x.to === id && x.m.payload.data.kind === 'moveRejected');
  return s && s.m.payload.data.reason;
};
const tickFor = (room, ms, step = 50) => {
  for (let k = 0; k < ms; k += step) {
    advanceClock(step);
    plugin.tick(room);
  }
};

// A point squarely on target `tg` at time t (chest, or head).
function aimAt(tg, t, head) {
  const p = Sim.pose(tg, t);
  if (tg.kind === 'gold') return { x: p.x, y: p.top + p.w * 0.5 };
  return { x: p.x, y: head ? p.top + p.h * 0.18 : p.top + p.h * 0.62 };
}
const midT = (tg) => Math.round((tg.t0 + tg.t1) / 2);

function seated() {
  const room = makeRoom();
  act(room, 'A', { kind: 'sit', seat: 'red' });
  act(room, 'B', { kind: 'sit', seat: 'blue' });
  return room;
}
// Start A's run and move the clock to `t` ms into it.
function startRunAt(room, id, t) {
  act(room, id, { kind: 'start' });
  fakeNow = room.state.runStart + t;
}
const shoot = (room, id, t, x, y) => {
  fakeNow = room.state.runStart + t;
  act(room, id, { kind: 'shot', t, x, y });
};

// ---- sim ----
test('sim: schedule is deterministic per seed and differs between seeds', () => {
  const a = Sim.makeSchedule(42);
  assert.deepStrictEqual(a, Sim.makeSchedule(42));
  assert.notDeepStrictEqual(a, Sim.makeSchedule(43));
  assert.ok(a.length > 25, `only ${a.length} targets`);
  for (const tg of a) {
    assert.ok(tg.t1 > tg.t0 && tg.t0 >= 0 && tg.t0 < Sim.RUN_MS);
    assert.ok(['bad', 'civ', 'gold'].includes(tg.kind));
  }
  for (let i = 1; i < a.length; i++) assert.ok(a[i].t0 >= a[i - 1].t0, 'sorted by start');
});

test('sim: schedules mix pop-ups, sliders, civilians and golds over many seeds', () => {
  let civ = 0; let gold = 0; let slide = 0; let pop = 0; let n = 0;
  for (let s = 1; s <= 30; s++) {
    for (const tg of Sim.makeSchedule(s * 101)) {
      n++;
      if (tg.kind === 'civ') civ++;
      if (tg.kind === 'gold') gold++;
      if (tg.move === 'slide') slide++; else pop++;
    }
  }
  assert.ok(civ / n > 0.1 && civ / n < 0.35, `civ share ${civ / n}`);
  assert.ok(gold >= 60, `golds ${gold}`);
  assert.ok(slide > n * 0.2 && pop > n * 0.3, `slide ${slide} pop ${pop}`);
});

test('sim: hit-testing — chest, head bonus, behind barricade, before/after, no double hit', () => {
  const sch = Sim.makeSchedule(7);
  const tg = sch.find((x) => x.kind === 'bad' && x.move === 'pop');
  const t = midT(tg);
  const body = Sim.hitTest(sch, t, aimAt(tg, t).x, aimAt(tg, t).y, new Set());
  assert.ok(body && body.id === tg.id, 'chest hit');
  assert.strictEqual(body.pts, Sim.POINTS.pop[tg.lane]);
  const head = Sim.hitTest(sch, t, aimAt(tg, t, true).x, aimAt(tg, t, true).y, new Set());
  assert.strictEqual(head.pts, Sim.POINTS.pop[tg.lane] + Sim.POINTS.head);
  assert.ok(head.head);
  // below the barricade edge: hidden
  const lane = Sim.LANES[tg.lane];
  assert.notStrictEqual((Sim.hitTest(sch, t, tg.x0, lane.top + 3, new Set()) || {}).id, tg.id);
  // not up yet / already down
  assert.notStrictEqual((Sim.hitTest(sch, tg.t0 - 5, aimAt(tg, t).x, aimAt(tg, t).y, new Set()) || {}).id, tg.id);
  assert.notStrictEqual((Sim.hitTest(sch, tg.t1 + 5, aimAt(tg, t).x, aimAt(tg, t).y, new Set()) || {}).id, tg.id);
  assert.notStrictEqual((Sim.hitTest(sch, t, aimAt(tg, t).x, aimAt(tg, t).y, new Set([tg.id])) || {}).id, tg.id);
  // civilians and sliders
  const civ = sch.find((x) => x.kind === 'civ');
  const ct = midT(civ);
  assert.strictEqual(Sim.hitTest(sch, ct, aimAt(civ, ct).x, aimAt(civ, ct).y, new Set()).pts, Sim.POINTS.civ);
  const sl = sch.find((x) => x.kind === 'bad' && x.move === 'slide');
  const st = midT(sl);
  assert.strictEqual(Sim.hitTest(sch, st, aimAt(sl, st).x, aimAt(sl, st).y, new Set()).pts, Sim.POINTS.pop[sl.lane] + Sim.POINTS.slideBonus);
  // a slider has moved: aiming at where it was a second earlier misses it
  const old = aimAt(sl, st - 1000);
  assert.notStrictEqual((Sim.hitTest(sch, st, old.x, old.y, new Set()) || {}).id, sl.id);
});

test('sim: gun rules — clip, empty, reload time, fire rate, monotonic time, garbage', () => {
  const run = Sim.newRun(5);
  let t = 1000;
  for (let i = 0; i < Sim.CLIP; i++) {
    assert.ok(Sim.applyEvent(run, { type: 'shot', t, x: 10, y: 10 }).ok, `shot ${i}`);
    t += Sim.FIRE_MIN_MS;
  }
  assert.strictEqual(Sim.applyEvent(run, { type: 'shot', t, x: 10, y: 10 }).reason, 'empty');
  assert.ok(Sim.applyEvent(run, { type: 'reload', t }).ok);
  assert.strictEqual(Sim.applyEvent(run, { type: 'reload', t: t + 10 }).reason, 'reloading');
  assert.strictEqual(Sim.applyEvent(run, { type: 'shot', t: t + Sim.RELOAD_MS - 1, x: 10, y: 10 }).reason, 'reloading');
  t += Sim.RELOAD_MS;
  assert.ok(Sim.applyEvent(run, { type: 'shot', t, x: 10, y: 10 }).ok);
  assert.strictEqual(Sim.applyEvent(run, { type: 'shot', t: t + Sim.FIRE_MIN_MS - 1, x: 10, y: 10 }).reason, 'too_fast');
  assert.strictEqual(Sim.applyEvent(run, { type: 'shot', t: t - 50, x: 10, y: 10 }).reason, 'bad_time');
  assert.strictEqual(Sim.applyEvent(run, { type: 'shot', t: Sim.RUN_MS + 1, x: 10, y: 10 }).reason, 'time_up');
  assert.strictEqual(Sim.applyEvent(run, { type: 'shot', t: t + 500, x: 'a', y: 10 }).reason, 'invalid');
  assert.strictEqual(Sim.applyEvent(run, { type: 'nuke', t: t + 500 }).reason, 'invalid');
  assert.strictEqual(Sim.applyEvent(run, null).reason, 'invalid');
  assert.strictEqual(Sim.applyEvent(Sim.newRun(5), { type: 'reload', t: 10 }).reason, 'full');
  assert.strictEqual(run.stats.shots, Sim.CLIP + 1);
});

test('sim: replay of the same events gives the same score', () => {
  const ev = Sim.botPlan(99, 'hard', Sim.mulberry32(3));
  const a = Sim.replay(99, ev);
  const b = Sim.replay(99, JSON.parse(JSON.stringify(ev)));
  assert.strictEqual(a.score, b.score);
  assert.strictEqual(a.count, ev.length, 'every planned event is valid');
});

test('bots: skill gradient easy < medium < hard < expert; expert reliably beats easy', () => {
  const N = 40;
  const scores = {};
  for (const lv of LEVELS) {
    const rand = Sim.mulberry32(LEVELS.indexOf(lv) + 11);
    scores[lv] = [];
    for (let s = 1; s <= N; s++) {
      const seed = s * 7919;
      const ev = Sim.botPlan(seed, lv, rand);
      const run = Sim.replay(seed, ev);
      assert.strictEqual(run.count, ev.length, `${lv} plan had invalid events`);
      scores[lv].push(run.score);
    }
  }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const means = LEVELS.map((lv) => mean(scores[lv]));
  console.log(`     mean scores: ${LEVELS.map((lv, i) => `${lv} ${Math.round(means[i])}`).join(', ')}`);
  for (let i = 1; i < means.length; i++) assert.ok(means[i] > means[i - 1] + 400, `means ${means}`);
  let expertWins = 0;
  for (let s = 0; s < N; s++) if (scores.expert[s] > scores.easy[s]) expertWins++;
  assert.ok(expertWins >= N * 0.95, `expert beat easy ${expertWins}/${N}`);
});

// ---- server ----
test('server: red runs first after START; run clock, countdown, shots scored & broadcast', () => {
  const room = seated();
  const st = room.state;
  assert.strictEqual(st.phase, 'playing');
  assert.strictEqual(st.turn, 'red');
  assert.strictEqual(st.runStart, null);
  act(room, 'B', { kind: 'start' });
  assert.strictEqual(lastReject(room, 'B'), 'not_your_turn');
  act(room, 'A', { kind: 'shot', t: 0, x: 1, y: 1 });
  assert.strictEqual(lastReject(room, 'A'), 'not_started');
  act(room, 'A', { kind: 'start' });
  assert.strictEqual(st.runStart, fakeNow + timing.countdown);
  act(room, 'A', { kind: 'shot', t: 0, x: 1, y: 1 }); // still in the countdown
  assert.strictEqual(lastReject(room, 'A'), 'not_started');
  const sch = Sim.makeSchedule(st.seed);
  const tg = sch.find((x) => x.kind === 'bad' && x.move === 'pop');
  const t = midT(tg);
  const a = aimAt(tg, t);
  shoot(room, 'A', t, a.x, a.y);
  const ev = datas(room).reverse().find((d) => d.kind === 'shots');
  assert.strictEqual(ev.seat, 'red');
  assert.strictEqual(ev.from, 0);
  assert.strictEqual(ev.events[0].hit, tg.id);
  assert.strictEqual(ev.score, Sim.POINTS.pop[tg.lane]);
  assert.strictEqual(st.run.events.length, 1);
});

test('server: rejects shots from the future, stale shots, too fast, empty clip, wrong seat, garbage', () => {
  const room = seated();
  startRunAt(room, 'A', 5000);
  act(room, 'A', { kind: 'shot', t: 5000 + timing.lagAhead + 50, x: 5, y: 5 });
  assert.strictEqual(lastReject(room, 'A'), 'bad_time');
  act(room, 'A', { kind: 'shot', t: 5000 - timing.lagBack - 50, x: 5, y: 5 });
  assert.strictEqual(lastReject(room, 'A'), 'bad_time');
  act(room, 'A', { kind: 'shot', t: 4900, x: 5, y: 5 }); // a little lag is fine
  assert.strictEqual(room.state.run.events.length, 1);
  act(room, 'A', { kind: 'shot', t: 4950, x: 5, y: 5 });
  assert.strictEqual(lastReject(room, 'A'), 'too_fast');
  act(room, 'B', { kind: 'shot', t: 5000, x: 5, y: 5 });
  assert.strictEqual(lastReject(room, 'B'), 'not_your_turn');
  act(room, 'C', { kind: 'reload', t: 5000 });
  assert.strictEqual(lastReject(room, 'C'), 'not_your_turn');
  for (const bad of [{ t: 'x', x: 1, y: 1 }, { t: 5100 }, { t: 5100, x: NaN, y: 2 }, { t: null, x: {}, y: [] }]) {
    act(room, 'A', { kind: 'shot', ...bad });
    assert.ok(['invalid', 'bad_time'].includes(lastReject(room, 'A')), JSON.stringify(bad));
  }
  // garbage messages don't throw
  for (const g of [null, 5, 'x', {}, { kind: 7 }, { kind: 'sit', seat: 'green' }, { kind: 'start', seat: {} }]) act(room, 'A', g);
  // empty the clip at the max fire rate, then one more
  let t = 6000;
  fakeNow = room.state.runStart + t;
  for (let i = 1; i < Sim.CLIP; i++, t += Sim.FIRE_MIN_MS) shoot(room, 'A', t, 5, 5);
  assert.strictEqual(room.state.run.events.length, Sim.CLIP);
  shoot(room, 'A', t, 5, 5);
  assert.strictEqual(lastReject(room, 'A'), 'empty');
  shoot(room, 'A', t, 5, 5);
  act(room, 'A', { kind: 'reload', t });
  assert.strictEqual(room.state.run.events.at(-1).type, 'reload');
  shoot(room, 'A', t + 200, 5, 5);
  assert.strictEqual(lastReject(room, 'A'), 'reloading');
  shoot(room, 'A', t + Sim.RELOAD_MS, 5, 5);
  assert.strictEqual(room.state.run.events.at(-1).t, t + Sim.RELOAD_MS);
});

test('server: run ends after 45 s (+grace), then blue; higher score wins; tie is a draw', () => {
  const room = seated();
  const st = room.state;
  const sch = Sim.makeSchedule(st.seed);
  const tg = sch.find((x) => x.kind === 'bad' && x.move === 'pop');
  startRunAt(room, 'A', 0);
  const a = aimAt(tg, midT(tg));
  shoot(room, 'A', midT(tg), a.x, a.y);
  fakeNow = st.runStart + Sim.RUN_MS + timing.endGrace - 60;
  plugin.tick(room);
  assert.strictEqual(st.turn, 'red');
  tickFor(room, 100);
  assert.strictEqual(st.turn, 'blue');
  assert.strictEqual(st.scores.red, Sim.POINTS.pop[tg.lane]);
  assert.strictEqual(st.stats.red.hits, 1);
  assert.strictEqual(st.runStart, null);
  assert.strictEqual(st.run.events.length, 0);
  // blue is idle: auto-started after the ready timeout, then misses everything
  tickFor(room, timing.readyMs + 100);
  assert.ok(st.runStart != null);
  fakeNow = st.runStart + Sim.RUN_MS + timing.endGrace + 10;
  plugin.tick(room);
  assert.strictEqual(st.phase, 'game_over');
  assert.strictEqual(st.winner, 'red');
  assert.strictEqual(lastState(room).scores.blue, 0);

  const tie = seated();
  for (const id of ['A', 'B']) {
    startRunAt(tie, id, 0);
    fakeNow = tie.state.runStart + Sim.RUN_MS + timing.endGrace + 10;
    plugin.tick(tie);
  }
  assert.strictEqual(tie.state.phase, 'game_over');
  assert.strictEqual(tie.state.winner, 'draw');
});

test('server: shots after time is up are refused', () => {
  const room = seated();
  startRunAt(room, 'A', Sim.RUN_MS + 100);
  act(room, 'A', { kind: 'shot', t: Sim.RUN_MS + 100, x: 1, y: 1 });
  assert.strictEqual(lastReject(room, 'A'), 'time_up');
});

test('seats: one seat per person; leaving mid-run resets; rematch swaps seats', () => {
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
  startRunAt(room, 'A', 1000);
  plugin.onLeave(room, { clientId: 'B' }); // the waiting player leaves mid-run
  assert.strictEqual(room.state.phase, 'waiting');
  assert.strictEqual(room.state.run, null);
  act(room, 'B', { kind: 'sit', seat: 'blue' });
  room.state.phase = 'game_over';
  room.state.winner = 'red';
  const g = room.state.gameId;
  const seed = room.state.seed;
  act(room, 'A', { kind: 'resetGame' });
  assert.strictEqual(room.state.players.red, 'B');
  assert.strictEqual(room.state.players.blue, 'A');
  assert.strictEqual(room.state.phase, 'playing');
  assert.strictEqual(room.state.turn, 'red');
  assert.strictEqual(room.state.gameId, g + 1);
  assert.notStrictEqual(room.state.seed, seed);
  act(room, 'A', { kind: 'leaveSeat' });
  assert.strictEqual(room.state.phase, 'waiting');
  assert.strictEqual(room.state.players.blue, null);
});

test('bots: level change, removal; human vs bot and bot vs bot games complete via the tick', () => {
  const room = makeRoom();
  act(room, 'A', { kind: 'sit', seat: 'blue', bot: true, level: 'easy' });
  act(room, 'A', { kind: 'setBotLevel', seat: 'blue', level: 'expert' });
  assert.strictEqual(room.state.botLevels.blue, 'expert');
  act(room, 'A', { kind: 'setBotLevel', seat: 'blue', level: 'godlike' });
  assert.strictEqual(room.state.botLevels.blue, 'hard');
  act(room, 'A', { kind: 'removeBot', seat: 'blue' });
  assert.strictEqual(room.state.players.blue, null);

  // human (red) vs bot: the bot's run starts on its own and streams events
  act(room, 'A', { kind: 'sit', seat: 'red' });
  act(room, 'A', { kind: 'sit', seat: 'blue', bot: true, level: 'expert' });
  startRunAt(room, 'A', Sim.RUN_MS + timing.endGrace + 10);
  plugin.tick(room);
  assert.strictEqual(room.state.turn, 'blue');
  assert.ok(room.state.runStart > fakeNow, 'bot countdown scheduled');
  const before = room.sent.length;
  tickFor(room, timing.botPause + timing.countdown + 15000);
  const streamed = room.sent.slice(before).filter((s) => s.m.payload.data.kind === 'shots');
  assert.ok(streamed.length > 5, 'bot shots broadcast as they come due');
  tickFor(room, Sim.RUN_MS);
  assert.strictEqual(room.state.phase, 'game_over');
  assert.strictEqual(room.state.winner, 'blue');
  assert.ok(room.state.scores.blue > 3000, `expert scored ${room.state.scores.blue}`);

  // bot vs bot: expert beats easy
  let expertWins = 0;
  for (let g = 0; g < 5; g++) {
    const bb = makeRoom();
    act(bb, 'X', { kind: 'sit', seat: 'red', bot: true, level: 'easy' });
    act(bb, 'X', { kind: 'sit', seat: 'blue', bot: true, level: 'expert' });
    tickFor(bb, 2 * (Sim.RUN_MS + timing.botPause + timing.countdown + timing.endGrace) + 500, 100);
    assert.strictEqual(bb.state.phase, 'game_over');
    if (bb.state.winner === 'blue') expertWins++;
    assert.ok(bb.state.stats.blue.shots > 0 && bb.state.stats.red.shots > 0, 'both bots fired');
  }
  assert.strictEqual(expertWins, 5);

  // a bot leaving (removed) mid-run stops its stream
  const hb = makeRoom();
  act(hb, 'A', { kind: 'sit', seat: 'red', bot: true, level: 'hard' });
  act(hb, 'A', { kind: 'sit', seat: 'blue' });
  tickFor(hb, timing.botPause + timing.countdown + 5000);
  assert.ok(hb.state.run.events.length > 0);
  act(hb, 'A', { kind: 'removeBot', seat: 'red' });
  const n = hb.sent.length;
  tickFor(hb, 3000);
  assert.strictEqual(hb.sent.length, n);
  assert.strictEqual(hb.state.phase, 'waiting');
});

test('snapshot: late joiners get the run so far', () => {
  const room = seated();
  startRunAt(room, 'A', 2000);
  act(room, 'A', { kind: 'shot', t: 2000, x: 100, y: 100 });
  const snap = plugin.serializeSnapshot(room);
  assert.strictEqual(snap.run.seat, 'red');
  assert.strictEqual(snap.run.events.length, 1);
  assert.strictEqual(snap.seed, room.state.seed);
  assert.strictEqual(typeof snap.serverNow, 'number');
  assert.ok(!('priv' in snap));
  JSON.stringify(snap);
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
