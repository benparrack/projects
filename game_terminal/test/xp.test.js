// Phase 6: results.record grants daily-capped XP, levels and achievements on the user doc.
// Run: node test/xp.test.js
'use strict';

const assert = require('assert');
const { createMemoryDb } = require('../server/db');
const { createAccounts } = require('../server/accounts');
const { createResults } = require('../server/results');
const { DAILY_CAP } = require('../server/progression');

const room = (ppl) => ({ gameType: 'chess', clients: new Map(ppl.map(([id, nickname, uid]) => [id, { nickname, uid }])), seen: new Map() });
const A = ['A', 'Alice', 'u1'];
const B = ['B', 'Bob', 'u2'];

(async () => {
  const db = createMemoryDb();
  const accounts = createAccounts(db);
  for (const [, name, uid] of [A, B]) await accounts.claimUsername(uid, { username: name, avatar: 'cat', acceptTerms: true });
  let t = Date.UTC(2026, 10, 1, 12);
  const results = createResults({ db, registry: { chess: { stats: { rated: true } } }, now: () => t });

  // A friend win: 50 XP for the winner, 20 for the loser, first-game/first-win/beat-a-friend unlocks.
  await db.set('social/u1', { friends: { u2: 1 }, incoming: {}, outgoing: {}, blocked: {}, recent: [] });
  const rec = await results.record(room([A, B]), { placements: [['A'], ['B']] });
  assert.deepStrictEqual([rec.progress.u1.gained, rec.progress.u2.gained], [50, 20]);
  assert.deepStrictEqual(rec.progress.u1.unlocked.sort(), ['beat_friend', 'first_game', 'first_win']);
  assert.deepStrictEqual(rec.progress.u2.unlocked, ['first_game']);
  const u1 = await db.get('users/u1');
  assert.deepStrictEqual([u1.xp, u1.level, u1.xpToday], [50, 1, 50]);
  assert.ok(u1.achievements.first_win);

  // Already-unlocked achievements don't repeat; levels go up; guests get nothing.
  const r2 = await results.record(room([A, B]), { placements: [['A'], ['B']] });
  assert.deepStrictEqual(r2.progress.u1.unlocked, []);
  assert.strictEqual(r2.progress.u1.levelUp, true);
  assert.strictEqual(r2.progress.u1.level, 2);
  const g = await results.record(room([A, ['G', 'guest', null]]), { placements: [['G'], ['A']] });
  assert.strictEqual(g.progress.G, undefined);

  // Daily cap, then a fresh allowance the next UTC day.
  for (let i = 0; i < 12; i++) await results.record(room([A, B]), { placements: [['A'], ['B']] });
  assert.strictEqual((await db.get('users/u1')).xpToday, DAILY_CAP);
  const capped = await results.record(room([A, B]), { placements: [['A'], ['B']] });
  assert.deepStrictEqual([capped.progress.u1.gained, capped.progress.u1.capped], [0, true]);
  t += 86400000;
  const fresh = await results.record(room([A, B]), { placements: [['A'], ['B']] });
  assert.strictEqual(fresh.progress.u1.gained, 50);
  assert.strictEqual((await db.get('users/u1')).xpToday, 50);
  assert.ok(rec.progress.u1.xp > 0 && (await db.get('users/u1')).xp === DAILY_CAP + 50);

  // An account whose user doc vanished (deleted mid-match) is skipped, not crashed.
  await db.del('users/u2');
  const gone = await results.record(room([A, B]), { placements: [['B'], ['A']] });
  assert.strictEqual(gone.progress.u2, null);
  assert.strictEqual(rec.progress.u1.badges.find((b) => b.id === 'first_win').name, 'Winner Winner');
  const { createApi } = require('../server/api');
  const api = createApi({ db, accounts, authMode: 'dev', firebaseWebConfig: null, registry: { chess: { stats: { rated: true } } } });
  const prof = await new Promise((resolve) => api({ url: '/api/user/Alice', method: 'GET' }, { writeHead(st) { this.st = st; }, end(b) { resolve(JSON.parse(b)); } }));
  assert.strictEqual(prof.progress.level, (await db.get('users/u1')).level);
  assert.ok(prof.achievements.find((x) => x.id === 'first_win').at);
  assert.strictEqual(prof.achievements.find((x) => x.id === 'wins_500').at, null);
  assert.ok(!('test' in prof.achievements[0]));
  console.log('xp.test: all passed');
})().catch((err) => { console.error(err); process.exit(1); });
