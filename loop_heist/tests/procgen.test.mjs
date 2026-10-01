import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateHeist, makeJob } from '../src/levels/procgen.js';
import { parseLevel } from '../src/sim/level.js';
import { playSolution } from './helpers.mjs';

test('generated buildings are well-formed and deterministic', () => {
  for (let seed = 1; seed <= 30; seed++) for (const tier of [1, 2, 3]) {
    const def = generateHeist(seed, tier);
    def.map.forEach((row) => assert.equal(row.length, def.map[0].length));
    assert.deepEqual(generateHeist(seed, tier), def);
    const L = parseLevel(def);
    assert.ok(L.spawns.length >= 1);
    assert.equal(L.items.filter((i) => i.type === 'loot').length, 1);
    assert.equal(!!L.items.find((i) => i.type === 'key'), tier >= 2);
  }
});

for (const tier of [1, 2, 3]) {
  test(`tier ${tier} contracts come with a solo ghost plan that the sim accepts`, () => {
    for (const seed of [1, 2, 3]) {
      const def = makeJob(seed, tier);
      assert.ok(def, `seed ${seed} found no solvable building`);
      assert.equal(def.id, `job-${tier}-${seed}`);
      const sim = playSolution(parseLevel(def), def.solution);
      assert.equal(sim.over.kind, 'success', JSON.stringify(sim.over));
      assert.deepEqual(makeJob(seed, tier).map, def.map, 'same seed, same building');
    }
  });
}
