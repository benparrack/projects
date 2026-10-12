// Firestore backup / restore. Every document (with subcollections) goes into one gzipped JSON,
// encrypted with AES-256-GCM under BACKUP_PASSPHRASE, so the file is safe to keep somewhere public
// (GitHub Actions artifacts on a public repo can be downloaded by any signed-in GitHub user).
//   FIREBASE_SERVICE_ACCOUNT=... BACKUP_PASSPHRASE=... node scripts/backup.js dump out.bak
//   BACKUP_PASSPHRASE=... node scripts/backup.js inspect out.bak            (counts per collection)
//   FIREBASE_SERVICE_ACCOUNT=... BACKUP_PASSPHRASE=... node scripts/backup.js restore out.bak --yes
// Restore overwrites docs that are in the backup; it does not delete docs created since.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const zlib = require('zlib');

const MAGIC = Buffer.from('GTBAK1');

function encrypt(obj, passphrase) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', crypto.scryptSync(passphrase, salt, 32), iv);
  const body = Buffer.concat([c.update(zlib.gzipSync(JSON.stringify(obj))), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), body]);
}

function decrypt(buf, passphrase) {
  if (!buf.subarray(0, 6).equals(MAGIC)) throw new Error('Not a Game Terminal backup.');
  const salt = buf.subarray(6, 22);
  const d = crypto.createDecipheriv('aes-256-gcm', crypto.scryptSync(passphrase, salt, 32), buf.subarray(22, 34));
  d.setAuthTag(buf.subarray(34, 50));
  try {
    return JSON.parse(zlib.gunzipSync(Buffer.concat([d.update(buf.subarray(50)), d.final()])));
  } catch {
    throw new Error('Wrong passphrase or corrupted backup.');
  }
}

// { 'users/u1': {...}, 'users/u1/matches/m1': {...}, ... } — one read per document.
async function dump(firestore) {
  const docs = {};
  async function walk(collections) {
    for (const col of collections) {
      for (const snap of (await col.get()).docs) {
        docs[snap.ref.path] = snap.data();
        await walk(await snap.ref.listCollections());
      }
      // Docs that only exist as parents of subcollections have no data but still hold children.
      for (const ref of await col.listDocuments()) if (!(ref.path in docs)) await walk(await ref.listCollections());
    }
  }
  await walk(await firestore.listCollections());
  return { version: 1, at: new Date().toISOString(), docs };
}

async function restore(firestore, backup) {
  const paths = Object.keys(backup.docs);
  for (let i = 0; i < paths.length; i += 400) {
    const batch = firestore.batch();
    for (const p of paths.slice(i, i + 400)) batch.set(firestore.doc(p), backup.docs[p]);
    await batch.commit();
  }
  return paths.length;
}

const countByCollection = (backup) => Object.keys(backup.docs).reduce((m, p) => {
  const col = p.split('/').filter((_, i) => i % 2 === 0).join('/*/');
  m[col] = (m[col] || 0) + 1;
  return m;
}, {});

function firestoreFromEnv() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set.');
  const admin = require('firebase-admin');
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  return admin.firestore();
}

async function main([cmd, file, flag]) {
  const pass = process.env.BACKUP_PASSPHRASE;
  if (!pass || pass.length < 12) throw new Error('BACKUP_PASSPHRASE must be set (12+ characters).');
  if (!file || !['dump', 'inspect', 'restore'].includes(cmd)) throw new Error('Usage: node scripts/backup.js dump|inspect|restore <file> [--yes]');
  if (cmd === 'dump') {
    const backup = await dump(firestoreFromEnv());
    fs.writeFileSync(file, encrypt(backup, pass));
    console.log(`Backed up ${Object.keys(backup.docs).length} documents to ${file}`);
    return;
  }
  const backup = decrypt(fs.readFileSync(file), pass);
  console.log(`Backup from ${backup.at}:`, countByCollection(backup));
  if (cmd === 'restore') {
    if (flag !== '--yes') throw new Error('Restore overwrites live data. Re-run with --yes to confirm.');
    console.log(`Restored ${await restore(firestoreFromEnv(), backup)} documents.`);
  }
}

if (require.main === module) main(process.argv.slice(2)).catch((err) => { console.error(err.message); process.exit(1); });

module.exports = { encrypt, decrypt, dump, restore, countByCollection };
