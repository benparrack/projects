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
    def.map.forEach((row, y) => assert.equal(row.length, def.map[0].length, `map row ${y} has the wrong width`));
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

for (const key of Object.keys(SOLUTIONS).filter((k) => k.includes('#'))) {
  test(`alternative route ${key} works`, () => {
    const L = parseLevel(LEVELS.find((l) => l.id === key.split('#')[0]));
    const sim = playSolution(L, SOLUTIONS[key]);
    assert.equal(sim.over.kind, 'success', JSON.stringify(sim.over));
  });
}

test('closed-circuit cannot be done by one ghost alone', () => {
  const L = parseLevel(LEVELS.find((l) => l.id === 'closed-circuit'));
  const sim = playSolution(L, SOLUTIONS['closed-circuit'].slice(1));
  assert.notEqual(sim.over.kind, 'success');
});

test('double-act cannot be done by one ghost alone', () => {
  const L = parseLevel(LEVELS.find((l) => l.id === 'double-act'));
  const sim = playSolution(L, SOLUTIONS['double-act'].slice(0, 1));
  assert.notEqual(sim.over.kind, 'success');
});

test('relay needs all three: without the ghost the cracker is caught', () => {
  const L = parseLevel(LEVELS.find((l) => l.id === 'relay'));
  const [hacker, , cracker] = SOLUTIONS.relay;
  const sim = playSolution(L, [hacker, cracker]);
  assert.notEqual(sim.over.kind, 'success');
});
