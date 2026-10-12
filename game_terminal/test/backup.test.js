// scripts/backup.js: encryption round trip, wrong passphrase, and dump/restore against a fake Firestore
// (including subcollections under a doc that has no data of its own).
// Run: node test/backup.test.js
'use strict';

const assert = require('assert');
const { encrypt, decrypt, dump, restore, countByCollection } = require('../scripts/backup');

// Flat path -> data store with just the Firestore admin calls the script uses.
function fakeFirestore(docs) {
  const childCols = (prefix) => [...new Set(Object.keys(docs)
    .filter((p) => p.startsWith(prefix) && p.split('/').length > prefix.split('/').length)
    .map((p) => p.split('/').slice(0, prefix.split('/').length).join('/')))].map(col);
  const ref = (path) => ({ path, listCollections: async () => childCols(`${path}/`) });
  function col(path) {
    const depth = path.split('/').length + 1;
    const ids = [...new Set(Object.keys(docs).filter((p) => p.startsWith(`${path}/`)).map((p) => p.split('/').slice(0, depth).join('/')))];
    return {
      get: async () => ({ docs: ids.filter((p) => docs[p]).map((p) => ({ ref: ref(p), data: () => docs[p] })) }),
      listDocuments: async () => ids.map(ref),
    };
  }
  return {
    listCollections: async () => childCols(''),
    doc: (path) => ({ path }),
    batch() {
      const ops = [];
      return { set: (r, d) => ops.push([r.path, d]), commit: async () => { for (const [p, d] of ops) docs[p] = d; } };
    },
  };
}

(async () => {
  const live = {
    'users/u1': { username: 'Alice', xp: 50 },
    'users/u1/matches/m1': { won: true },
    'users/u2': { username: 'Bob' },
    'social/u1': { friends: { u2: 1 } },
    'ghost/x/items/i1': { n: 1 }, // ghost/x itself has no data
  };
  const backup = await dump(fakeFirestore(live));
  assert.deepStrictEqual(backup.docs, live);
  assert.deepStrictEqual(countByCollection(backup), { users: 2, 'users/*/matches': 1, social: 1, 'ghost/*/items': 1 });

  const file = encrypt(backup, 'correct horse battery');
  assert.ok(!file.includes(Buffer.from('Alice')), 'backup must not be readable without the passphrase');
  assert.deepStrictEqual(decrypt(file, 'correct horse battery'), backup);
  assert.throws(() => decrypt(file, 'wrong passphrase!!'), /Wrong passphrase/);
  assert.throws(() => decrypt(Buffer.from('nope'), 'x'), /Not a Game Terminal backup/);

  const wiped = { 'users/u1': { username: 'Alice', xp: 0 } };
  assert.strictEqual(await restore(fakeFirestore(wiped), backup), 5);
  assert.deepStrictEqual(wiped, live);
  console.log('backup.test: all passed');
})().catch((err) => { console.error(err); process.exit(1); });
