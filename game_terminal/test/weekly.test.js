// Game of the week: Monday-UTC weeks, a fixed rotation of real multiplayer games, double XP and
// a points table for the featured game only, and /api/weekly.
'use strict';
const assert = require('assert');
const { createMemoryDb } = require('../server/db');
const { createAccounts } = require('../server/accounts');
const { createResults } = require('../server/results');
const { createApi } = require('../server/api');
const { createWeekly, weekOf, POOL } = require('../server/weekly');
const registry = require('../server/games');

const room = (gameType, ppl) => ({ gameType, clients: new Map(ppl.map(([id, nickname, uid]) => [id, { nickname, uid }])), seen: new Map() });
const A = ['A', 'Alice', 'u1'];
const B = ['B', 'Bob', 'u2'];

(async () => {
  // Weeks run Monday 00:00 UTC to Monday 00:00 UTC; consecutive weeks feature different games.
  const mon = Date.UTC(2026, 9, 12); // Monday 2026-10-12
  const w = weekOf(mon + 3 * 864e5 + 5);
  assert.deepStrictEqual([w.id, w.start, w.endsAt], ['2026-10-12', mon, mon + 7 * 864e5]);
  assert.strictEqual(weekOf(mon - 1).id, '2026-10-05');
  assert.notStrictEqual(weekOf(mon - 1).gameType, w.gameType);
  assert.strictEqual(new Set(POOL).size, POOL.length);
  for (const g of POOL) assert.ok(registry[g] && !(registry[g].stats || {}).none, `${g} records results`);

  const db = createMemoryDb();
  const accounts = createAccounts(db);
  for (const [, name, uid] of [A, B]) await accounts.claimUsername(uid, { username: name, avatar: 'cat', acceptTerms: true });
  const t = mon + 864e5;
  const weekly = createWeekly(db, { now: () => t });
  const featured = weekly.current().gameType;
  const other = POOL.find((g) => g !== featured);
  const reg = { [featured]: { stats: { rated: true } }, [other]: { stats: { rated: true } } };
  const results = createResults({ db, registry: reg, weekly, now: () => t });

  // Featured game: double XP and points (win 3, loss 0, draw 1 each).
  const r1 = await results.record(room(featured, [A, B]), { placements: [['A'], ['B']] });
  assert.deepStrictEqual([r1.progress.u1.gained, r1.progress.u2.gained, r1.progress.u1.double], [100, 40, true]);
  await results.record(room(featured, [A, B]), { placements: [['A', 'B']] });
  // Any other game: normal XP, no points.
  const r3 = await results.record(room(other, [A, B]), { placements: [['B'], ['A']] });
  assert.deepStrictEqual([r3.progress.u2.gained, r3.progress.u2.double], [50, undefined]);
  assert.deepStrictEqual(await db.get(`weekly/${weekly.current().id}_u1`), { week: '2026-10-12', gameType: featured, uid: 'u1', username: 'Alice', points: 4, wins: 1, played: 2 });

  const api = createApi({ db, accounts, weekly, authMode: 'dev', firebaseWebConfig: null, registry: reg, now: () => t });
  const res = await new Promise((resolve) => api({ url: '/api/weekly', method: 'GET' }, { writeHead(st) { this.st = st; }, end(b) { resolve({ st: this.st, b: JSON.parse(b) }); } }));
  assert.strictEqual(res.st, 200);
  assert.strictEqual(res.b.gameType, featured);
  assert.deepStrictEqual(res.b.rows.map((r) => [r.rank, r.username, r.points]), [[1, 'Alice', 4], [2, 'Bob', 1]]);
  assert.ok(!/(?<![a-z\d])u1(?![a-z\d])/.test(JSON.stringify(res.b)), 'no uids');
  console.log('weekly.test: all passed');
})().catch((err) => { console.error(err); process.exit(1); });
