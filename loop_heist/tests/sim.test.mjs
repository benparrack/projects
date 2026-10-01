import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLevel } from '../src/sim/level.js';
import { Sim } from '../src/sim/sim.js';
import { Bot, runBot } from '../src/sim/bot.js';
import { hashState } from '../src/sim/hash.js';
import { Rng } from '../src/sim/rng.js';
import * as F from './fixtures.mjs';

const lvl = (d) => parseLevel(d);

function randomRun(L, seed, ticks) {
  const sim = new Sim(L, [{ role: 'ghost', rec: null }]);
  const r = new Rng(seed);
  const hashes = [];
  let inp = 0;
  for (let t = 0; t < ticks && !sim.over; t++) {
    if (r.int(8) === 0) inp = r.int(128);
    sim.step(inp);
    hashes.push(hashState(sim.S));
  }
  return { sim, hashes };
}

test('same inputs give identical state every tick', () => {
  for (const def of [F.corridor, F.guarded, F.security, F.vault]) {
    const a = randomRun(lvl(def), 7, 800);
    const b = randomRun(lvl(def), 7, 800);
    assert.deepEqual(a.hashes, b.hashes, def.id);
  }
});

const corridorRun = [{ wait: 40 }, { to: [4, 2] }, { use: true }, { path: [[6, 2], [8, 2]] }, { use: true }];

test('a recorded take replays as a clone without desync', () => {
  const L = lvl(F.corridor);
  const live = new Sim(L, [{ role: 'ghost', rec: null }]);
  const rec = runBot(live, new Bot(corridorRun));
  assert.equal(live.over.kind, 'success');
  assert.deepEqual(rec.events.map((e) => e.k), ['open', 'escape']);

  const replay = new Sim(L, [{ role: 'ghost', rec }]);
  const trace = [];
  while (!replay.over) {
    const t = replay.tick;
    replay.step();
    if (t < rec.len) trace.push(replay.S.actors[0].x, replay.S.actors[0].y);
  }
  assert.equal(replay.over.kind, 'success');
  assert.equal(replay.S.actors[0].lost, null);
  assert.deepEqual(trace.slice(0, rec.trace.length), rec.trace);
});

test('a later crew member opening the door first makes the clone lose sync (paradox)', () => {
  const L = lvl(F.corridor);
  const rec0 = runBot(new Sim(L, [{ role: 'ghost', rec: null }]), new Bot(corridorRun));
  const sim = new Sim(L, [{ role: 'ghost', rec: rec0 }, { role: 'hacker', rec: null }]);
  // Crew member 2 spawns at (1,2) and rushes the door before clone 1 gets there.
  runBot(sim, new Bot([{ to: [4, 2] }, { use: true }, { path: [[6, 2], [8, 2]] }, { use: true }]));
  const clone = sim.S.actors[0];
  assert.ok(clone.lost, 'clone should be lost');
  assert.equal(clone.lost.kind, 'diverged');
  assert.match(clone.lost.why, /d1/);
  assert.notEqual(sim.over.kind, 'success'); // the lost clone never escapes
});

test('a crew member who does not interfere leaves the clone in sync', () => {
  const L = lvl(F.corridor);
  const rec0 = runBot(new Sim(L, [{ role: 'ghost', rec: null }]), new Bot(corridorRun));
  const sim = new Sim(L, [{ role: 'ghost', rec: rec0 }, { role: 'hacker', rec: null }]);
  runBot(sim, new Bot([{ wait: 120 }, { path: [[4, 2], [6, 2], [8, 2]] }, { use: true }]));
  assert.equal(sim.S.actors[0].lost, null);
  assert.equal(sim.over.kind, 'success');
});

test('walking into a guard\'s view raises the alarm', () => {
  const sim = new Sim(lvl(F.guarded), [{ role: 'ghost', rec: null }]);
  runBot(sim, new Bot([{ path: [[10, 1], [11, 1]] }, { wait: 100 }]));
  assert.equal(sim.over.kind, 'alarm');
  assert.match(sim.over.reason, /g1 spotted/);
});

test('a whistle lures the guard to investigate', () => {
  const sim = new Sim(lvl(F.guarded), [{ role: 'ghost', rec: null }]);
  const bot = new Bot([{ to: [6, 4], sneak: true }, { ability: true }, { wait: 5 }]);
  let investigated = false;
  while (!sim.over && !bot.done) {
    sim.step(bot.input(sim.S.actors[0]));
    if (sim.S.guards[0].state === 'investigate') investigated = true;
  }
  assert.ok(investigated);
  assert.ok(sim.S.log.some((e) => e.k === 'whistle'));
});

test('lasers trip the alarm unless the power is cut; a guard comes to restore it', () => {
  const L = lvl(F.security);
  const a = new Sim(L, [{ role: 'ghost', rec: null }]);
  runBot(a, new Bot([{ path: [[1, 4], [10, 4]] }]));
  assert.equal(a.over?.kind, 'alarm');
  assert.match(a.over.reason, /laser/);

  const b = new Sim(L, [{ role: 'ghost', rec: null }]);
  // Cut the power, slip through the dead laser, then wait out of sight at the van.
  const bot = new Bot([{ to: [2, 2] }, { hold: 32 }, { path: [[2, 4], [12, 4]] }, { wait: 1000 }]);
  let restored = false;
  while (!b.over && !restored) {
    b.step(bot.input(b.S.actors[0]));
    restored = b.S.log.some((e) => e.k === 'power-restored');
  }
  assert.equal(b.over, null, b.over?.reason);
  assert.ok(b.S.actors[0].x > 10 * 256, 'crossed the laser line');
  assert.ok(restored, 'guard should restore power');
  assert.equal(b.S.circuits.A, true);
});

test('the cracker opens the vault and the crew escapes with the loot', () => {
  const sim = new Sim(lvl(F.vault), [{ role: 'cracker', rec: null }]);
  runBot(sim, new Bot([{ to: [6, 2] }, { hold: 42 }, { to: [5, 2] }, { use: true }, { to: [10, 1] }, { use: true }]));
  assert.equal(sim.over.kind, 'success');
  assert.equal(sim.over.take, 5000);
});

test('a non-cracker cannot crack the vault', () => {
  const sim = new Sim(lvl(F.vault), [{ role: 'ghost', rec: null }]);
  runBot(sim, new Bot([{ to: [6, 2] }, { hold: 60 }, { to: [10, 1] }, { use: true }]));
  assert.equal(sim.over.kind, 'nolot');
});

test('snapshot/restore resumes bit-identically', () => {
  const L = lvl(F.guarded);
  const r = new Rng(3);
  const inputs = Array.from({ length: 400 }, () => r.int(64));
  const sim = new Sim(L, [{ role: 'ghost', rec: null }]);
  for (let t = 0; t < 150; t++) sim.step(inputs[t]);
  const snap = sim.snapshot();
  for (let t = 150; t < 400 && !sim.over; t++) sim.step(inputs[t]);
  const end = hashState(sim.S);
  sim.restore(snap);
  for (let t = 150; t < 400 && !sim.over; t++) sim.step(inputs[t]);
  assert.equal(hashState(sim.S), end);
});
