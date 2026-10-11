// Public JSON API: profiles never leak uids, carry score meta, 404 unknown users.
// Run: node test/api.test.js
'use strict';

const assert = require('assert');
const { createMemoryDb } = require('../server/db');
const { createAccounts } = require('../server/accounts');
const { createResults } = require('../server/results');
const { createApi } = require('../server/api');

function call(api, url) {
  return new Promise((resolve) => {
    const res = {
      writeHead(status, headers) { this.status = status; this.headers = headers; },
      end(body) { resolve({ status: this.status, headers: this.headers, body: JSON.parse(body) }); },
    };
    api({ url, method: 'GET' }, res);
  });
}

(async () => {
  const db = createMemoryDb();
  const accounts = createAccounts(db);
  await accounts.claimUsername('u1', { username: 'Alice', avatar: 'cat', acceptTerms: true });
  await accounts.claimUsername('u2', { username: 'Bob', avatar: 'moon', acceptTerms: true });
  const registry = { slope: { stats: { score: { label: 'DISTANCE', better: 'high', format: 'int' } } }, chess: { stats: { rated: true } } };
  const results = createResults({ db, registry });
  const people = [['A', 'Alice', 'u1'], ['B', 'Bob', 'u2'], ['G', 'guest', null]];
  const room = (gameType, ppl) => ({ gameType, clients: new Map(ppl.map(([id, nickname, uid]) => [id, { nickname, uid }])), seen: new Map() });
  await results.record(room('chess', people.slice(0, 2)), { placements: [['A'], ['B']] });
  await results.record(room('chess', [people[0], people[2]]), { placements: [['G'], ['A']] });
  await results.record(room('slope', [people[0]]), { placements: [['A']], scores: { A: 99 } });
  const api = createApi({ db, accounts, authMode: 'dev', firebaseWebConfig: null, registry });

  const r = await call(api, '/api/user/alice');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.user.username, 'Alice');
  assert.ok(!JSON.stringify(r.body).includes('u1') && !JSON.stringify(r.body).includes('u2'), 'no uids leak');
  assert.deepStrictEqual(r.body.stats.find((s) => s.gameType === 'slope').score.label, 'DISTANCE');
  assert.strictEqual(r.body.matches.length, 3);
  const vsBob = r.body.matches.find((m) => m.players.some((p) => p.name === 'Bob'));
  assert.strictEqual(vsBob.players.find((p) => p.name === 'Bob').account, true);
  const vsGuest = r.body.matches.find((m) => m.players.some((p) => p.name === 'guest'));
  assert.ok(!vsGuest.players.find((p) => p.name === 'guest').account, 'guests are not linkable');
  assert.strictEqual(vsGuest.me.won, false);

  const hh = await call(api, '/api/h2h/alice/bob');
  assert.strictEqual(hh.status, 200);
  assert.deepStrictEqual(hh.body.games, [{ gameType: 'chess', played: 1, draws: 0, a: 1, b: 0 }]);
  assert.strictEqual(hh.body.matches.length, 1);
  assert.strictEqual(hh.body.matches[0].winner, 'a');
  assert.ok(!JSON.stringify(hh.body).includes('u1'), 'no uids in h2h');
  assert.deepStrictEqual((await call(api, '/api/h2h/bob/alice')).body.games[0], { gameType: 'chess', played: 1, draws: 0, a: 0, b: 1 });
  assert.strictEqual((await call(api, '/api/h2h/alice/alice')).status, 400);
  assert.strictEqual((await call(api, '/api/h2h/alice/nobody')).status, 404);
  assert.strictEqual((await call(api, '/api/user/nobody')).status, 404);
  assert.strictEqual((await call(api, '/api/nope')).status, 404);
  assert.strictEqual((await call(api, '/api/config')).body.authMode, 'dev');

  // Replays: stored for plugins with replayFrames, served as frames, uids stripped.
  const real = require('../server/games');
  const rdb = createMemoryDb();
  const racc = createAccounts(rdb);
  await racc.claimUsername('u1', { username: 'Alice', acceptTerms: true });
  const rres = createResults({ db: rdb, registry: real });
  const rec = await rres.record(room('connect4', [people[0], people[2]]), { placements: [['A'], ['G']], replay: [0, 3, 3, 4, 4, 5, 5, 6] });
  assert.strictEqual(rec.summary.replay, true);
  const rapi = createApi({ db: rdb, accounts: racc, authMode: 'dev', firebaseWebConfig: null, registry: real });
  const fr = await call(rapi, `/api/match/${rec.summary.id}/frames`);
  assert.strictEqual(fr.status, 200);
  assert.strictEqual(fr.body.frames.length, 8);
  assert.ok(!JSON.stringify(fr.body).includes('"u1"'));
  assert.strictEqual((await call(rapi, '/api/match/doesnotexist1/frames')).status, 404);
  console.log('all api tests passed');
})().catch((err) => { console.error(err); process.exit(1); });
