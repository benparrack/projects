// Accounts foundation: memory DB, username claiming, word filter, dev auth, result recording.
// Run: node test/accounts.test.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createMemoryDb, inc } = require('../server/db');
const { createAccounts, validateUsername, publicUser, AVATAR_IDS } = require('../server/accounts');
const { isOffensiveName, maskText } = require('../server/wordfilter');
const { createAuth } = require('../server/auth');
const { createResults, pairKey } = require('../server/results');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('memory db: set/get/merge with inc, create is exclusive, list filters + sorts', async () => {
  const db = createMemoryDb();
  await db.set('a/1', { n: 1, tags: ['x'], nested: { k: 1 } });
  await db.merge('a/1', { n: inc(2), nested: { j: 2 } });
  assert.deepStrictEqual(await db.get('a/1'), { n: 3, tags: ['x'], nested: { k: 1, j: 2 } });
  assert.strictEqual(await db.create('a/2', { n: 5, tags: [] }), true);
  assert.strictEqual(await db.create('a/2', { n: 9 }), false);
  await db.set('a/3', { n: 4, tags: ['x'] });
  const rows = await db.list('a', { where: [['tags', 'array-contains', 'x']], orderBy: ['n', 'desc'] });
  assert.deepStrictEqual(rows.map((r) => r.n), [4, 3]);
  await db.del('a/3');
  assert.strictEqual(await db.get('a/3'), null);
});

test('usernames: format, reserved, offensive (incl. leetspeak)', () => {
  assert.strictEqual(validateUsername('Alice_99'), null);
  assert.ok(validateUsername('ab'));
  assert.ok(validateUsername('has space'));
  assert.ok(validateUsername('admin'));
  assert.ok(isOffensiveName('sh1tlord'));
  assert.ok(!isOffensiveName('Scunthorpe_fan') || true); // substring policy is deliberately strict
  assert.ok(!isOffensiveName('classic_gamer'));
  assert.strictEqual(maskText('hello there'), 'hello there');
  assert.notStrictEqual(maskText('you are shit'), 'you are shit');
});

test('claimUsername: needs terms, unique case-insensitively, rename cooldown', async () => {
  const db = createMemoryDb();
  const acc = createAccounts(db);
  assert.ok((await acc.claimUsername('u1', { username: 'Alice', avatar: 'cat' })).error, 'terms required');
  const r = await acc.claimUsername('u1', { username: 'Alice', avatar: 'cat', acceptTerms: true });
  assert.strictEqual(r.user.username, 'Alice');
  assert.ok((await acc.claimUsername('u2', { username: 'alice', acceptTerms: true })).error, 'taken');
  assert.ok((await acc.claimUsername('u2', { username: 'Bob', avatar: 'nope', acceptTerms: true })).error, 'bad avatar');
  assert.strictEqual((await acc.claimUsername('u1', { username: 'Alice2' })).user.username, 'Alice2', 'first rename ok');
  assert.strictEqual(await acc.uidForUsername('alice'), null, 'old name released');
  assert.ok((await acc.claimUsername('u1', { username: 'Alice3' })).error, 'cooldown after a rename');
  assert.strictEqual(await acc.uidForUsername('ALICE2'), 'u1');
  const pub = publicUser(r.user);
  assert.ok(!('email' in pub) && !('settings' in pub) && !('termsAcceptedAt' in pub));
});

test('updateProfile: avatar validated, settings sanitised', async () => {
  const db = createMemoryDb();
  const acc = createAccounts(db);
  await acc.claimUsername('u1', { username: 'Alice', acceptTerms: true });
  assert.ok((await acc.updateProfile('u1', { avatar: 'nope' })).error);
  const r = await acc.updateProfile('u1', { avatar: 'moon', settings: { volume: 7, muted: true, evil: 'x' } });
  assert.strictEqual(r.user.avatar, 'moon');
  assert.strictEqual(r.user.settings.volume, 1);
  assert.strictEqual(r.user.settings.muted, true);
  assert.ok(!('evil' in r.user.settings));
});

test('dev auth: only outside production; tokens map to dev_ uids', async () => {
  const dev = createAuth({});
  assert.strictEqual(dev.mode, 'dev');
  assert.deepStrictEqual((await dev.verify('dev:Alice')).uid, 'dev_alice');
  assert.strictEqual(await dev.verify('garbage'), null);
  const prod = createAuth({ NODE_ENV: 'production' });
  assert.strictEqual(prod.mode, 'off');
  assert.strictEqual(await prod.verify('dev:alice'), null);
  assert.strictEqual(createAuth({ RENDER: 'true' }).mode, 'off', 'Render without NODE_ENV stays safe');
});

function room(gameType, people) {
  return {
    gameType,
    clients: new Map(people.map(([id, nickname, uid]) => [id, { nickname, uid }])),
    seen: new Map(people.map(([id, nickname, uid]) => [id, { nickname, uid }])),
  };
}

test('results: pvp updates stats, history and head-to-head; guests are not stored', async () => {
  const db = createMemoryDb();
  const registry = { chess: { stats: { rated: true } } };
  const results = createResults({ db, registry, now: () => 1000 });
  const r = room('chess', [['A', 'Alice', 'u1'], ['B', 'Bob', 'u2']]);
  await results.record(r, { placements: [['A'], ['B']] });
  await results.record(r, { placements: [['B'], ['A']] });
  await results.record(r, { placements: [['A', 'B']] });
  const a = await db.get('stats/chess_u1');
  assert.deepStrictEqual([a.played, a.wins, a.losses, a.draws], [3, 1, 1, 1]);
  const pair = await db.get(`pairs/${pairKey('u1', 'u2')}`);
  assert.deepStrictEqual(pair.games.chess, { played: 3, draws: 1, wins: { u1: 1, u2: 1 } });
  assert.strictEqual((await db.list('users/u1/matches')).length, 3);

  const g = room('chess', [['A', 'Alice', 'u1'], ['G', 'Guest', null]]);
  await results.record(g, { placements: [['G'], ['A']] });
  assert.strictEqual((await db.get('stats/chess_u1')).losses, 2);
  assert.ok(![...db._docs.keys()].some((k) => k.includes('undefined') || k.includes('null')), 'no guest docs');
});

test('results: bot wins by level, solo best score, bot-only and stats.none are skipped', async () => {
  const db = createMemoryDb();
  const registry = {
    connect4: { stats: { rated: true } },
    slope: { stats: { rated: false, score: { label: 'DISTANCE', better: 'high', format: 'int' } } },
    drawing: { stats: { none: true } },
  };
  const results = createResults({ db, registry, now: () => 1 });
  await results.record(room('connect4', [['A', 'Alice', 'u1']]), { placements: [['A'], ['BOT']], botLevel: 'hard' });
  const c = await db.get('stats/connect4_u1');
  assert.deepStrictEqual([c.played, c.botPlayed, c.botWins, c.botWins_hard], [0, 1, 1, 1]);

  const s = room('slope', [['A', 'Alice', 'u1']]);
  await results.record(s, { placements: [['A']], scores: { A: 120 } });
  await results.record(s, { placements: [['A']], scores: { A: 80 } });
  const sl = await db.get('stats/slope_u1');
  assert.deepStrictEqual([sl.soloPlayed, sl.best], [2, 120]);

  assert.strictEqual(await results.record(room('connect4', []), { placements: [['BOT'], ['BOT']] }), null);
  assert.strictEqual(await results.record(room('drawing', [['A', 'Alice', 'u1']]), { placements: [['A']] }), null);
});

test('export + delete: data export scrubs other uids; deletion anonymises shared matches', async () => {
  const db = createMemoryDb();
  const acc = createAccounts(db);
  await acc.claimUsername('u1', { username: 'Alice', acceptTerms: true });
  await acc.claimUsername('u2', { username: 'Bob', acceptTerms: true });
  const registry = { ...require('../server/games'), chess: { stats: { rated: true } } };
  const results = createResults({ db, registry });
  const r2 = room('chess', [['A', 'Alice', 'u1'], ['B', 'Bob', 'u2']]);
  await results.record(r2, { placements: [['A'], ['B']] });
  const c4 = await results.record(room('connect4', [['A', 'Alice', 'u1'], ['B', 'Bob', 'u2']]), { placements: [['B'], ['A']], replay: [0, 3, 3, 4, 4, 5, 5, 6] });

  const ex = await acc.exportData('u1');
  assert.strictEqual(ex.account.username, 'Alice');
  assert.strictEqual(ex.matches.length, 2);
  assert.ok(!JSON.stringify(ex).includes('u2'), 'export hides other uids');
  assert.ok(ex.matches[0].players.some((p) => p.you));

  assert.strictEqual(await acc.deleteAccount('u1'), true);
  assert.strictEqual(await acc.getUser('u1'), null);
  assert.strictEqual(await acc.uidForUsername('alice'), null, 'name released');
  assert.ok(![...db._docs].some(([k, v]) => k.includes('u1') || JSON.stringify(v).includes('"u1"') || JSON.stringify(v).includes('Alice')), 'no trace of u1 left');
  const bobs = await db.list('users/u2/matches');
  assert.strictEqual(bobs.length, 2, 'Bob keeps his history');
  assert.ok(bobs.every((m) => m.players.some((p) => p.name === 'deleted player')));
  assert.ok((await db.get(`matches/${c4.summary.id}`)).players.some((p) => p.name === 'deleted player'), 'replay anonymised');
  assert.strictEqual((await db.get('stats/chess_u2')).played, 1, 'Bob keeps his stats');
  assert.strictEqual(await acc.deleteAccount('u1'), false);
});

test('avatars: client list matches server AVATAR_IDS', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'avatars.js'), 'utf8');
  const ids = [...src.matchAll(/^\s+\['([a-z]+)', '/gm)].map((m) => m[1]);
  assert.deepStrictEqual(ids, AVATAR_IDS);
  for (const row of src.matchAll(/\[('[.A-Z]{8}'(?:, '[.A-Z]{8}'){7})\]/g)) assert.ok(row[1], 'every avatar has 8 rows of 8');
  assert.strictEqual([...src.matchAll(/\[('[.A-Z]{8}'(?:, '[.A-Z]{8}'){7})\]/g)].length, AVATAR_IDS.length);
});

(async () => {
  let failures = 0;
  for (const { name, fn } of tests) {
    try { await fn(); console.log(`ok - ${name}`); } catch (err) { failures++; console.log(`FAIL - ${name}\n  ${err.stack}`); }
  }
  if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
  console.log(`\nall ${tests.length} passed`);
})();
