// Run: node test.js — validates the skill data and the wheel/week logic.
const assert = require('assert');
global.window = globalThis;
require('./skills.js'); require('./logic.js');
const { DAY, TAU, currentRun, dayIndex, buildPool, interleave, indexAt, ease, streak } = Logic;

// Data: every skill complete and well-formed.
const ids = new Set();
for (const k of SKILLS) {
  assert(!ids.has(k.id), 'duplicate id ' + k.id); ids.add(k.id);
  assert(CATS[k.cat], k.id + ' bad cat');
  for (const f of ['name', 'short', 'emoji', 'pitch', 'what', 'why', 'daily', 'goal', 'next']) assert(k[f], `${k.id} missing ${f}`);
  assert(k.short.length <= 15, k.id + ' short name too long for the wheel');
  assert.strictEqual(k.plan.length, 7, k.id + ' plan must have 7 days');
  k.plan.forEach(([t, d]) => assert(t && d && d.length > 15, k.id + ' thin plan day: ' + t));
  assert(k.need.length && k.how.length >= 3 && k.tips.length >= 2 && k.res.length >= 2, k.id + ' thin lists');
  k.res.forEach(r => assert(/^[vwa]:./.test(r), k.id + ' bad resource ' + r));
  assert(k.wk[0] <= k.wk[1] && k.cost <= 40 && [1, 2, 3].includes(k.level), k.id + ' bad numbers');
}
assert(new Set(SKILLS.map(k => k.emoji)).size === SKILLS.length, 'duplicate emoji');

// indexAt: segment i sits under the pointer when rotated to its midpoint.
for (const n of [2, 7, 48]) for (let i = 0; i < n; i++) {
  const seg = TAU / n;
  assert.strictEqual(indexAt(-(i + .5) * seg, n), i);
  assert.strictEqual(indexAt(-(i + .5) * seg + 3 * TAU, n), i);
}
assert(ease(0) === 0 && ease(1) === 1 && ease(.5) > .5);

// interleave: same items, no same-colour neighbours when avoidable.
const mixed = interleave(SKILLS);
assert.strictEqual(mixed.length, SKILLS.length);
mixed.forEach((k, i) => assert.notStrictEqual(k.cat, mixed[(i + 1) % mixed.length].cat, 'neighbours share a colour at ' + i));

// Runs, pool, streak.
const t0 = new Date(2026, 9, 12, 21, 0).getTime();
const run = (id, start, status = 'active') => ({ id, start, status, checks: Array(7).fill(false) });
assert.strictEqual(currentRun([], t0), null);
const r = run('juggling', t0);
assert.strictEqual(currentRun([r], t0 + 6 * DAY), r);
assert.strictEqual(currentRun([r], t0 + 7 * DAY), null);
assert.strictEqual(currentRun([{ ...r, status: 'done' }], t0 + DAY), null);
assert.strictEqual(dayIndex(r, t0), 0);
assert.strictEqual(dayIndex(r, t0 + 3 * 36e5), 1, 'day 2 starts at midnight, not 24h after the spin');
assert.strictEqual(dayIndex(r, t0 + 30 * DAY), 6);

const settings = { cats: {}, excluded: [], quickOnly: false, freeOnly: false, allowRepeats: false };
const runs = [run('origami', t0 - 20 * DAY, 'done'), run('juggling', t0 - 10 * DAY, 'skipped')];
const pool = buildPool(SKILLS, runs, settings);
assert(!pool.some(k => k.id === 'origami'), 'learned skills leave the wheel');
assert(!pool.some(k => k.id === 'juggling'), 'last skill never comes straight back');
assert(buildPool(SKILLS, runs, { ...settings, allowRepeats: true }).some(k => k.id === 'origami'));
assert(buildPool(SKILLS, [], { ...settings, freeOnly: true }).every(k => k.cost === 0));
assert(buildPool(SKILLS, [], { ...settings, cats: { music: false } }).every(k => k.cat !== 'music'));
assert(!buildPool(SKILLS, [], { ...settings, excluded: ['sql'] }).some(k => k.id === 'sql'));

const done = id => run(id, 0, 'done');
assert.strictEqual(streak([done('a'), done('b')], t0), 2);
assert.strictEqual(streak([done('a'), run('x', 0, 'skipped'), done('b')], t0), 1);
assert.strictEqual(streak([done('a'), done('b'), run('c', t0)], t0 + DAY), 2, 'in-progress run keeps the streak');
assert.strictEqual(streak([done('a'), run('c', t0)], t0 + 8 * DAY), 0, 'an expired unfinished run breaks it');

console.log(`ok — ${SKILLS.length} skills, logic checks passed`);
