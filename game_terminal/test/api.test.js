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

  assert.strictEqual((await call(api, '/api/user/nobody')).status, 404);
  assert.strictEqual((await call(api, '/api/nope')).status, 404);
  assert.strictEqual((await call(api, '/api/config')).body.authMode, 'dev');
  console.log('all api tests passed');
})().catch((err) => { console.error(err); process.exit(1); });
