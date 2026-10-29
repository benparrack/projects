import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLevel } from '../src/sim/level.js';
import { Sim } from '../src/sim/sim.js';
import { Bot, runBot } from '../src/sim/bot.js';
import { LEVELS } from '../src/levels/campaign.js';
import { SOLUTIONS } from '../src/levels/solutions.js';
import { gatherTargets } from '../src/sim/interact.js';

const L = parseLevel(LEVELS.find((l) => l.id === 'hold-the-door'));
const gate = () => L.doors.findIndex((d) => d.gate);

test('a gate opens while its plate is held and shuts when it is clear', () => {
  const sim = new Sim(L, [{ role: 'ghost', rec: null }]);
  const bot = new Bot([{ to: [6, 2] }, { use: true }, { path: [[8, 2], [12, 3], [12, 6]] }, { wait: 20 }, { to: [12, 3] }]);
  let opened = -1, closed = -1;
  for (let t = 0; t < 600 && !bot.done; t++) {
    sim.step(bot.input(sim.S.actors[0], sim.S.tick));
    if (opened < 0 && sim.S.doors[gate()].open) opened = t;
    if (opened >= 0 && closed < 0 && !sim.S.doors[gate()].open) closed = t;
  }
  assert.ok(opened > 0 && closed > opened, `opened ${opened} closed ${closed}`);
});

test('gates cannot be opened by hand', () => {
  const sim = new Sim(L, [{ role: 'cracker', rec: null }]);
  runBot(sim, new Bot([{ to: [6, 2] }, { use: true }, { to: [16, 2] }]), 400);
  assert.ok(!gatherTargets(sim, sim.S.actors[0]).some((t) => t.kind === 'door' && t.idx === gate()));
});

test('a clone that loses its plate-holder gets locked out (paradox)', () => {
  // The cracker's take relied on the ghost holding the plate; drop the ghost and replay.
  const [ghost, cracker] = SOLUTIONS['hold-the-door'];
  const crew = [];
  for (const m of [ghost, cracker]) {
    const sim = new Sim(L, [...crew, { role: m.role, rec: null }]);
    crew.push({ role: m.role, rec: runBot(sim, new Bot(m.cmds)) });
  }
  const sim = new Sim(L, [crew[1]]);
  sim.runToEnd(L.loopTicks + 5);
  assert.ok(sim.S.actors[0].lost, 'cracker should be lost without the plate held');
});
