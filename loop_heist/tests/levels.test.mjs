import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLevel } from '../src/sim/level.js';
import { Sim } from '../src/sim/sim.js';
import { Bot, runBot } from '../src/sim/bot.js';
import { LEVELS } from '../src/levels/campaign.js';
import { SOLUTIONS } from '../src/levels/solutions.js';

// Record each crew member in turn, exactly like a player would.
export function playSolution(L, sol) {
  const crew = [];
  for (const m of sol) {
    const sim = new Sim(L, [...crew, { role: m.role, rec: null }]);
    const rec = runBot(sim, new Bot(m.cmds));
    crew.push({ role: m.role, rec });
  }
  const sim = new Sim(L, crew);
  sim.runToEnd(L.loopTicks + 5);
  return sim;
}

for (const def of LEVELS) {
  test(`level ${def.id} parses and has a working solution`, () => {
    const L = parseLevel(def);
    assert.ok(SOLUTIONS[def.id], 'missing reference solution');
    const sol = SOLUTIONS[def.id];
    assert.ok(sol.length <= L.maxCrew, 'solution uses too many crew');
    for (const m of sol) assert.ok(L.roles.includes(m.role), `role ${m.role} not allowed`);
    const sim = playSolution(L, sol);
    assert.equal(sim.over.kind, 'success', JSON.stringify(sim.over));
    assert.ok(sim.S.actors.every((a) => !a.lost), 'a clone desynced');
  });
}

test('double-act cannot be done by one ghost alone', () => {
  const L = parseLevel(LEVELS.find((l) => l.id === 'double-act'));
  const sim = playSolution(L, SOLUTIONS['double-act'].slice(0, 1));
  assert.notEqual(sim.over.kind, 'success');
});
