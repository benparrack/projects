// Phase 6 daily challenge: shared seeds, one claimed attempt per account per UTC day, scoring
// through results.record, streaks, the daily board API. Run: node test/daily.test.js
'use strict';

const assert = require('assert');
const { createMemoryDb } = require('../server/db');
const { createAccounts } = require('../server/accounts');
const { createResults } = require('../server/results');
const { createApi } = require('../server/api');
const { createDaily, seedOf, mulberry32 } = require('../server/daily');

const DAY = 86400000;
const solo = (gameType, [id, nickname, uid], date) => ({ gameType, daily: { date, seed: seedOf(date, gameType), uid }, clients: new Map([[id, { nickname, uid }]]), seen: new Map() });
const get = (api, url) => new Promise((resolve) => api({ url, method: 'GET' }, { writeHead(st) { this.st = st; }, end(b) { resolve({ status: this.st, body: JSON.parse(b) }); } }));

(async () => {
  // Seeds: stable per (date, game), different across days and games; the PRNG is deterministic.
  assert.strictEqual(seedOf('2026-10-11', 'mazedash'), seedOf('2026-10-11', 'mazedash'));
  assert.notStrictEqual(seedOf('2026-10-11', 'mazedash'), seedOf('2026-10-12', 'mazedash'));
  assert.notStrictEqual(seedOf('2026-10-11', 'mazedash'), seedOf('2026-10-11', 'wordhunt'));
  const r1 = mulberry32(42); const r2 = mulberry32(42);
  for (let i = 0; i < 5; i++) assert.strictEqual(r1(), r2());


  // Word Hunt's grid is a pure function of the daily seed.
  const { generateGrid } = require('../server/games/wordhunt')._internals;
  assert.strictEqual(generateGrid(mulberry32(seedOf('2026-10-11', 'wordhunt'))).grid, generateGrid(mulberry32(seedOf('2026-10-11', 'wordhunt'))).grid);
  assert.notStrictEqual(generateGrid(mulberry32(seedOf('2026-10-11', 'wordhunt'))).grid, generateGrid(mulberry32(seedOf('2026-10-12', 'wordhunt'))).grid);

  // Crossword and Anagrams: a daily room deals the same puzzle to everyone (crossword always MEDIUM).
  const dealt = (gameType, date, size) => {
    const plugin = require(`../server/games/${gameType}`);
    const room = { gameType, clients: new Map([['A', {}]]), daily: { date, seed: seedOf(date, gameType) }, sendTo() {}, broadcast() {} };
    room.state = plugin.createInitialState(room);
    plugin.onJoin(room, { clientId: 'A', nickname: 'Alice' });
    plugin.onMessage(room, room.clients.get('A'), { kind: 'start', size }, { senderId: 'A' });
    for (const p of room.state.players.values()) clearTimeout(p.botTimer);
    clearTimeout(room.state.roundTimer);
    return JSON.stringify(gameType === 'crossword' ? [room.state.size, room.state.puzzle.solution] : room.state.letters);
  };
  for (const g of ['crossword', 'anagrams']) {
    assert.strictEqual(dealt(g, '2026-10-11', 'mini'), dealt(g, '2026-10-11', 'large'), `${g}: same daily puzzle`);
    assert.notStrictEqual(dealt(g, '2026-10-11'), dealt(g, '2026-10-12'), `${g}: new puzzle each day`);
  }
  assert.ok(dealt('crossword', '2026-10-11', 'mini').startsWith('["medium"'));

  const db = createMemoryDb();
  const accounts = createAccounts(db);
  for (const [name, uid] of [['Alice', 'u1'], ['Bob', 'u2'], ['Cyril', 'u3']]) await accounts.claimUsername(uid, { username: name, avatar: 'cat', acceptTerms: true });
  let t = Date.UTC(2026, 9, 11, 9);
  const daily = createDaily(db, { now: () => t });
  const registry = { wordhunt: { stats: { rated: true, score: { label: 'Points', better: 'high', format: 'pts' } } }, mazedash: { stats: { rated: true, score: { label: 'TIME', better: 'low', format: 'ms' } } } };
  const results = createResults({ db, registry, daily, now: () => t });
  const date = daily.today();
  assert.strictEqual(date, '2026-10-11');

  // One attempt: the claim is atomic and a second start is refused.
  assert.strictEqual(await daily.attempted('u1', 'wordhunt'), false);
  assert.strictEqual(await daily.start('u1', 'Alice', 'wordhunt'), true);
  assert.strictEqual(await daily.start('u1', 'Alice', 'wordhunt'), false);
  assert.strictEqual(await daily.attempted('u1', 'wordhunt'), true);
  assert.strictEqual((await db.get('users/u1')).dailyToday.games.wordhunt, 'started');

  // Scoring goes through results.record; XP is the daily bonus; streak 1; Daily Grind unlocks.
  const rec = await results.record(solo('wordhunt', ['A', 'Alice', 'u1'], date), { placements: [['A']], scores: { A: 2400 } });
  assert.deepStrictEqual(rec.daily.u1, { score: 2400, streak: 1, rank: 1, of: 1 });
  assert.strictEqual(rec.progress.u1.gained, 40);
  assert.ok(rec.progress.u1.unlocked.includes('daily_first'));
  assert.strictEqual(rec.summary.daily, date);
  // Later rounds in the same room don't rescore.
  const again = await results.record(solo('wordhunt', ['A', 'Alice', 'u1'], date), { placements: [['A']], scores: { A: 9999 } });
  assert.strictEqual(again.daily.u1, null);
  assert.strictEqual((await db.get(`daily/${date}_wordhunt_u1`)).score, 2400);

  // Others: a better score ranks first, a tie shares the rank, a DNF counts as played but isn't ranked.
  for (const [id, name, uid, score] of [['B', 'Bob', 'u2', 3000], ['C', 'Cyril', 'u3', 2400]]) {
    await daily.start(uid, name, 'wordhunt');
    t += 1000;
    await results.record(solo('wordhunt', [id, name, uid], date), { placements: [[id]], scores: { [id]: score } });
  }
  await daily.start('u2', 'Bob', 'mazedash');
  const dnf = await results.record(solo('mazedash', ['B', 'Bob', 'u2'], date), { placements: [['B']] });
  assert.deepStrictEqual([dnf.daily.u2.score, dnf.daily.u2.rank], [null, null]);
  assert.deepStrictEqual((await daily.board('wordhunt')).map((r) => [r.username, r.rank]), [['Bob', 1], ['Alice', 2], ['Cyril', 2]]);

  // Board API: no uids, profiles joined.
  const api = createApi({ db, accounts, daily, authMode: 'dev', firebaseWebConfig: null, registry, now: () => t });
  const res = await get(api, '/api/daily');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.date, date);
  assert.deepStrictEqual(res.body.games.wordhunt.rows.map((r) => [r.rank, r.username, r.score]), [[1, 'Bob', 3000], [2, 'Alice', 2400], [2, 'Cyril', 2400]]);
  assert.strictEqual(res.body.games.mazedash.total, 0);
  assert.ok(!JSON.stringify(res.body).includes('"uid"'));

  // Streak: next day +1, a skipped day resets to 1, and the live streak reads 0 after a gap.
  t += DAY;
  const d2 = daily.today();
  await daily.start('u1', 'Alice', 'mazedash', d2);
  const s2 = await results.record(solo('mazedash', ['A', 'Alice', 'u1'], d2), { placements: [['A']], scores: { A: 31000 } });
  assert.strictEqual(s2.daily.u1.streak, 2);
  // A second game the same day doesn't double-count.
  await daily.start('u1', 'Alice', 'wordhunt', d2);
  assert.strictEqual((await results.record(solo('wordhunt', ['A', 'Alice', 'u1'], d2), { placements: [['A']], scores: { A: 100 } })).daily.u1.streak, 2);
  assert.strictEqual(daily.liveStreak(await db.get('users/u1')), 2);
  t += 2 * DAY;
  assert.strictEqual(daily.liveStreak(await db.get('users/u1')), 0);
  const d4 = daily.today();
  await daily.start('u1', 'Alice', 'mazedash', d4);
  assert.strictEqual((await results.record(solo('mazedash', ['A', 'Alice', 'u1'], d4), { placements: [['A']], scores: { A: 30000 } })).daily.u1.streak, 1);
  assert.strictEqual((await db.get('users/u1')).dailyBest, 2);

  // Non-daily solo runs never touch the daily docs.
  const plain = await results.record({ gameType: 'wordhunt', clients: new Map([['A', { nickname: 'Alice', uid: 'u1' }]]), seen: new Map() }, { placements: [['A']], scores: { A: 50 } });
  assert.deepStrictEqual(plain.daily, {});
  assert.strictEqual(plain.progress.u1.gained, 10);
  console.log('daily.test: all passed');
})().catch((err) => { console.error(err); process.exit(1); });
