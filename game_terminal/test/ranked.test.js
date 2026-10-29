// Phase 5: ranked results move Elo (casual/bots/guests don't), season counters, rollover
// archive + soft reset, and the leaderboard API. Run: node test/ranked.test.js
'use strict';

const assert = require('assert');
const { createMemoryDb } = require('../server/db');
const { createAccounts } = require('../server/accounts');
const { createResults } = require('../server/results');
const { createApi } = require('../server/api');

const Q4 = Date.UTC(2026, 10, 1); // S1
const Q1 = Date.UTC(2027, 1, 1); // S2

function call(api, url) {
  return new Promise((resolve) => {
    api({ url, method: 'GET' }, {
      writeHead(status) { this.status = status; },
      end(body) { resolve({ status: this.status, body: JSON.parse(body) }); },
    });
  });
}
const room = (gameType, ppl, ranked) => ({
  gameType, ranked,
  clients: new Map(ppl.map(([id, nickname, uid]) => [id, { nickname, uid }])),
  seen: new Map(),
});
const A = ['A', 'Alice', 'u1'];
const B = ['B', 'Bob', 'u2'];
const C = ['C', 'Cyril', 'u3'];

(async () => {
  const db = createMemoryDb();
  const accounts = createAccounts(db);
  for (const [, name, uid] of [A, B, C]) await accounts.claimUsername(uid, { username: name, avatar: 'cat', acceptTerms: true });
  const registry = {
    chess: { stats: { rated: true } },
    codemaster: { stats: { rated: true } },
    slope: { stats: { rated: false, score: { label: 'DISTANCE', better: 'high', format: 'int' } } },
    drawing: { stats: { none: true } },
  };
  let t = Q4;
  const results = createResults({ db, registry, now: () => t });

  // Casual: no rating.
  await results.record(room('chess', [A, B], false), { placements: [['A'], ['B']] });
  assert.strictEqual((await db.get('stats/chess_u1')).rating, undefined);

  // Ranked: zero-sum Elo, delta reported, peak + season tracked, match row carries it.
  const rec = await results.record(room('chess', [A, B], true), { placements: [['A'], ['B']] });
  assert.deepStrictEqual(rec.ratings.u1, { rating: 1016, delta: 16, tier: 'Silver' });
  assert.strictEqual(rec.ratings.u2.delta, -16);
  const a = await db.get('stats/chess_u1');
  assert.deepStrictEqual([a.rating, a.ratedGames, a.peak, a.ratedSeason, a.sRated, a.sPlayed, a.sWins], [1016, 1, 1016, 'S1', 1, 2, 2]);
  const m = (await db.list('users/u1/matches')).find((x) => x.ranked);
  assert.deepStrictEqual([m.me.rating, m.me.delta], [1016, 16]);

  // Ranked with a guest or a bot, or co-op: unrated.
  const before = (await db.get('stats/chess_u1')).rating;
  await results.record(room('chess', [A, ['G', 'guest', null]], true), { placements: [['A'], ['G']] });
  await results.record(room('chess', [A], true), { placements: [['A'], ['BOT']] });
  await results.record(room('codemaster', [A, B], true), { placements: [['A', 'B']] });
  assert.strictEqual((await db.get('stats/chess_u1')).rating, before);
  assert.strictEqual((await db.get('stats/codemaster_u1')).rating, undefined);
  // Unrated plugin in a ranked room: no rating.
  await results.record(room('slope', [A, B], true), { placements: [['A'], ['B']], scores: { A: 50, B: 40 } });
  assert.strictEqual((await db.get('stats/slope_u1')).rating, undefined);

  // 3-player ranked: winner up, last down.
  await results.record(room('chess', [A, B, C], true), { placements: [['C'], ['A'], ['B']] });
  assert.ok((await db.get('stats/chess_u3')).rating > 1000);

  const api = createApi({ db, accounts, authMode: 'dev', firebaseWebConfig: null, registry, now: () => t });
  const cfg = await call(api, '/api/config');
  assert.deepStrictEqual(cfg.body.games.chess, { rated: true, score: null });
  assert.ok(!('drawing' in cfg.body.games));
  assert.strictEqual(cfg.body.season.id, 'S1');

  let lb = await call(api, '/api/leaderboard/chess');
  assert.strictEqual(lb.status, 200);
  assert.strictEqual(lb.body.by, 'rating');
  assert.deepStrictEqual(lb.body.rows.map((r) => r.username), ['Cyril', 'Alice', 'Bob']); // fresh Cyril (K=32) beat both
  assert.deepStrictEqual(lb.body.rows.map((r) => r.rank), [1, 2, 3]);
  assert.ok(!/(?<![a-z\d])u1(?![a-z\d])/.test(JSON.stringify(lb.body)), 'no uids leak');
  assert.ok(lb.body.rows[0].tier && lb.body.rows[0].avatar);
  lb = await call(api, '/api/leaderboard/chess?names=bob,cyril');
  assert.deepStrictEqual(lb.body.rows.map((r) => [r.username, r.rank]), [['Cyril', 1], ['Bob', 3]], 'friends view keeps global rank');
  lb = await call(api, '/api/leaderboard/slope');
  assert.deepStrictEqual([lb.body.by, lb.body.rows[0].username, lb.body.rows[0].value], ['best', 'Alice', 50]);
  assert.strictEqual((await call(api, '/api/leaderboard/slope?by=rating')).status, 400);
  assert.strictEqual((await call(api, '/api/leaderboard/nope')).status, 404);
  lb = await call(api, '/api/leaderboard/chess?by=wins');
  assert.strictEqual(lb.body.rows[0].username, 'Alice');

  // Rollover: first run remembers the season; a new quarter archives ranks and soft-resets.
  assert.strictEqual(await results.rollover(), null);
  assert.strictEqual(await results.rollover(), null);
  t = Q1;
  const roll = await results.rollover();
  assert.deepStrictEqual([roll.from, roll.to, roll.archived], ['S1', 'S2', 3]);
  const arch = await db.get('seasonResults/S1_chess_u1');
  assert.deepStrictEqual([arch.rank, arch.of, arch.tier, arch.games], [2, 3, 'Silver', 2]);
  const reset = await db.get('stats/chess_u1');
  assert.strictEqual(reset.rating, 1000 + Math.round((arch.rating - 1000) / 2));
  assert.strictEqual(await results.rollover(), null, 'idempotent');

  // New season: season leaderboard is empty until someone plays ranked; all-time still there.
  lb = await call(api, '/api/leaderboard/chess?scope=season&by=wins');
  assert.strictEqual(lb.body.rows.length, 0);
  await results.record(room('chess', [A, B], true), { placements: [['B'], ['A']] });
  const b = await db.get('stats/chess_u2');
  assert.deepStrictEqual([b.season, b.sPlayed, b.sWins], ['S2', 1, 1]);

  const prof = await call(api, '/api/user/alice');
  assert.deepStrictEqual(prof.body.seasons.map((s) => [s.season, s.gameType, s.rank]), [['S1', 'chess', 2]]);
  assert.ok(prof.body.stats.find((s) => s.gameType === 'chess').tier);
  assert.ok(!JSON.stringify(prof.body).includes('"u1"'));
  assert.strictEqual((await accounts.exportData('u1')).seasons.length, 1);
  await accounts.deleteAccount('u1');
  assert.strictEqual((await db.list('seasonResults', { where: [['uid', '==', 'u1']] })).length, 0, 'deletion drops season archive');
  console.log('ranked.test: all passed');
})().catch((err) => { console.error(err); process.exit(1); });
