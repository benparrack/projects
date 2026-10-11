// Phase 5 rating math: pairwise Elo, rateMatch contract, tiers, seasons.
// Run: node test/ratings.test.js
'use strict';

const assert = require('assert');
const { rate, rateMatch, tierOf, seasonOf, softReset } = require('../server/ratings');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('1v1 at equal rating: K=32 new, K=16 established, zero-sum', () => {
  const r = rate([{ uid: 'a', rating: 1000, games: 0, place: 0 }, { uid: 'b', rating: 1000, games: 0, place: 1 }]);
  assert.deepStrictEqual(r, { a: { rating: 1016, delta: 16 }, b: { rating: 984, delta: -16 } });
  const s = rate([{ uid: 'a', rating: 1000, games: 50, place: 0 }, { uid: 'b', rating: 1000, games: 50, place: 1 }]);
  assert.strictEqual(s.a.delta, 8);
});

test('upset moves more than expected win; draw pulls toward each other', () => {
  const upset = rate([{ uid: 'lo', rating: 900, games: 30, place: 0 }, { uid: 'hi', rating: 1300, games: 30, place: 1 }]);
  const fav = rate([{ uid: 'hi', rating: 1300, games: 30, place: 0 }, { uid: 'lo', rating: 900, games: 30, place: 1 }]);
  assert.ok(upset.lo.delta > 13 && fav.hi.delta < 3);
  const draw = rate([{ uid: 'lo', rating: 900, games: 30, place: 0 }, { uid: 'hi', rating: 1300, games: 30, place: 0 }]);
  assert.ok(draw.lo.delta > 0 && draw.hi.delta < 0);
});

test('multi-player: winner gains, last loses, middle ~0 at equal ratings', () => {
  const r = rate(['a', 'b', 'c'].map((uid, place) => ({ uid, rating: 1000, games: 0, place })));
  assert.deepStrictEqual([r.a.delta, r.b.delta, r.c.delta], [16, 0, -16]);
});

test('rateMatch: skips BOTs and guests, counts rated games, starts at 1000', () => {
  const out = rateMatch({ u1: { rating: 1100, ratedGames: 4 } }, [['A'], ['BOT', 'BOT'], ['B'], ['G']], { A: 'u1', B: 'u2' });
  assert.deepStrictEqual(Object.keys(out).sort(), ['u1', 'u2']);
  assert.strictEqual(out.u1.ratedGames, 5);
  assert.strictEqual(out.u2.ratedGames, 1);
  assert.ok(out.u1.delta > 0 && out.u2.rating === 1000 + out.u2.delta);
});

test('rateMatch: nothing to rate with <2 accounts or a co-op shared group', () => {
  assert.deepStrictEqual(rateMatch({}, [['A'], ['BOT']], { A: 'u1' }), {});
  assert.deepStrictEqual(rateMatch({}, [['A'], ['G']], { A: 'u1' }), {});
  assert.deepStrictEqual(rateMatch({}, [['A', 'B']], { A: 'u1', B: 'u2' }, { coop: true }), {});
  const draw = rateMatch({}, [['A', 'B']], { A: 'u1', B: 'u2' });
  assert.deepStrictEqual([draw.u1.delta, draw.u2.delta], [0, 0]);
});

test('tiers', () => {
  assert.deepStrictEqual([800, 1000, 1100, 1300, 1450, 2000].map(tierOf), ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master']);
});

test('seasons: S1 = 2026 Q4 (UTC), then quarterly', () => {
  assert.deepStrictEqual(seasonOf(Date.UTC(2026, 9, 11)), { id: 'S1', n: 1, start: Date.UTC(2026, 9, 1), end: Date.UTC(2027, 0, 1) });
  assert.strictEqual(seasonOf(Date.UTC(2026, 11, 31, 23, 59)).id, 'S1');
  assert.strictEqual(seasonOf(Date.UTC(2027, 0, 1)).id, 'S2');
  assert.strictEqual(seasonOf(Date.UTC(2027, 11, 1)).id, 'S5');
});

test('soft reset halves distance to 1000', () => {
  assert.deepStrictEqual([1400, 800, 1000, undefined].map(softReset), [1200, 900, 1000, 1000]);
});

(async () => {
  let failures = 0;
  for (const { name, fn } of tests) {
    try { await fn(); console.log(`ok - ${name}`); } catch (err) { failures++; console.log(`FAIL - ${name}\n  ${err.stack}`); }
  }
  if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
  console.log(`\nall ${tests.length} passed`);
})();
