// Phase 6 home screen: notable-moment extraction, per-account activity log (capped, streak
// deduped), the merged friends feed, play counters and /api/live. Run: node test/activity.test.js
'use strict';

const assert = require('assert');
const { createMemoryDb } = require('../server/db');
const { createActivity, itemsFor } = require('../server/activity');
const { createApi } = require('../server/api');

const DAY = 86400000;
const sum = (o) => ({ endedAt: 1000, gameType: 'chess', kind: 'pvp', players: [{ uid: 'u1', place: 0 }, { uid: 'u2', place: 1 }], ...o });
const get = (api, url) => new Promise((resolve) => api({ url, method: 'GET' }, { writeHead(st) { this.st = st; }, end(b) { resolve({ status: this.st, body: JSON.parse(b) }); } }));

(async () => {
  // Only notable moments become items.
  assert.deepStrictEqual(itemsFor(sum(), 'u1', {}), []);
  assert.deepStrictEqual(itemsFor(sum(), 'u1', { rating: { rating: 1016 } }).map((i) => i.kind), ['ranked']);
  assert.deepStrictEqual(itemsFor(sum(), 'u2', { rating: { rating: 984 } }), [], 'ranked losses are not news');
  const solo = sum({ kind: 'solo', gameType: 'wordhunt', players: [{ uid: 'u1', place: 0 }] });
  assert.deepStrictEqual(itemsFor(solo, 'u1', { daily: { rank: 4, of: 9, streak: 2 } }), []);
  assert.deepStrictEqual(itemsFor(solo, 'u1', { daily: { rank: 2, of: 9, streak: 7 } }).map((i) => [i.kind, i.rank || i.days]), [['daily', 2], ['streak', 7]]);
  const prog = { levelUp: true, level: 5, badges: [{ id: 'first_win', name: 'First Blood' }] };
  assert.deepStrictEqual(itemsFor(sum(), 'u1', { progress: prog }).map((i) => i.kind), ['level', 'achievement']);

  let t = Date.UTC(2026, 9, 11, 12);
  const db = createMemoryDb();
  const act = createActivity(db, { now: () => t });

  // Log keeps the newest 20, newest first, and a repeated streak milestone only once.
  for (let i = 0; i < 25; i++) await act.log('u1', [{ at: i, kind: 'level', level: i }]);
  let doc = await db.get('activity/u1');
  assert.strictEqual(doc.items.length, 20);
  assert.strictEqual(doc.items[0].level, 24);
  await act.log('u1', [{ at: 30, kind: 'streak', days: 7 }]);
  await act.log('u1', [{ at: 31, kind: 'streak', days: 7 }]);
  doc = await db.get('activity/u1');
  assert.strictEqual(doc.items.filter((i) => i.kind === 'streak').length, 1);

  // Feed merges friends newest first, tagged with uid, limited.
  await act.log('u2', [{ at: 26, kind: 'achievement', id: 'x', name: 'X' }]);
  const feed = await act.feed(['u1', 'u2', 'nobody'], 3);
  assert.deepStrictEqual(feed.map((i) => [i.uid, i.at]), [['u1', 30], ['u2', 26], ['u1', 24]]);

  // Counters: today + most played this week (older than 7 days drops out); concurrent counts aren't lost.
  await Promise.all([act.counted('chess'), act.counted('chess'), act.counted('slope')]);
  t -= 3 * DAY; await act.counted('slope'); await act.counted('slope');
  t -= 10 * DAY; for (let i = 0; i < 9; i++) await act.counted('pool');
  t += 13 * DAY;
  assert.deepStrictEqual(await act.stats(), { today: 3, topWeek: { gameType: 'slope', plays: 3 } });
  // Survives a restart (counters are written through).
  assert.deepStrictEqual(await createActivity(db, { now: () => t }).stats(), { today: 3, topWeek: { gameType: 'slope', plays: 3 } });

  const api = createApi({ db, accounts: {}, live: async () => ({ online: 4, ...(await act.stats()) }), authMode: 'dev', firebaseWebConfig: null, registry: {} });
  const res = await get(api, '/api/live');
  assert.deepStrictEqual([res.status, res.body.online, res.body.today], [200, 4, 3]);
  console.log('activity.test: all passed');
})().catch((err) => { console.error(err); process.exit(1); });
