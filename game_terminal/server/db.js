// Tiny document store with two backends: Firestore (when FIREBASE_SERVICE_ACCOUNT is set) and an
// in-memory map (tests, local dev, and production until Firebase is configured). Only the server
// ever touches the database — Firestore security rules deny all client access.
//
// Paths are 'collection/docId' or 'collection/docId/sub/docId'. The API is the small subset the
// accounts code needs:
//   get(path)                 -> data | null
//   set(path, data)           -> replaces the doc
//   merge(path, patch)        -> deep-merges plain objects; db.inc(n) increments a number field
//   create(path, data)        -> true, or false if the doc already exists (atomic)
//   del(path)
//   list(collection, { where: [[field, '==', value], ...], orderBy: [field, 'asc'|'desc'], limit })
//                             -> [{ id, ...data }]   (where only supports '==' and 'array-contains')

const INC = Symbol('inc');
const inc = (n) => ({ [INC]: n });
const isInc = (v) => v && typeof v === 'object' && INC in v;
const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v) && !isInc(v) && Object.getPrototypeOf(v) === Object.prototype;

function deepMerge(target, patch) {
  const out = { ...target };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (isInc(v)) out[k] = (typeof out[k] === 'number' ? out[k] : 0) + v[INC];
    else if (isPlain(v)) out[k] = deepMerge(isPlain(out[k]) ? out[k] : {}, v);
    else out[k] = v;
  }
  return out;
}

// Strips inc() sentinels to their value, for set()/create() on a fresh doc.
const resolve = (data) => deepMerge({}, data);

function getField(obj, field) {
  return field.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function createMemoryDb() {
  const docs = new Map(); // path -> data
  const clone = (v) => (v == null ? null : structuredClone(v));
  return {
    backend: 'memory',
    inc,
    async get(path) { return clone(docs.get(path)); },
    async set(path, data) { docs.set(path, resolve(data)); },
    async merge(path, patch) { docs.set(path, deepMerge(docs.get(path) || {}, patch)); },
    async create(path, data) {
      if (docs.has(path)) return false;
      docs.set(path, resolve(data));
      return true;
    },
    async del(path) { docs.delete(path); },
    async list(collection, { where = [], orderBy, limit } = {}) {
      const prefix = `${collection}/`;
      let rows = [];
      for (const [path, data] of docs) {
        if (!path.startsWith(prefix) || path.slice(prefix.length).includes('/')) continue;
        const ok = where.every(([f, op, v]) => {
          const x = getField(data, f);
          return op === 'array-contains' ? Array.isArray(x) && x.includes(v) : x === v;
        });
        if (ok) rows.push({ id: path.slice(prefix.length), ...clone(data) });
      }
      if (orderBy) {
        const [f, dir = 'asc'] = orderBy;
        const s = dir === 'desc' ? -1 : 1;
        rows.sort((a, b) => ((getField(a, f) ?? 0) > (getField(b, f) ?? 0) ? s : (getField(a, f) ?? 0) < (getField(b, f) ?? 0) ? -s : 0));
      }
      if (limit) rows = rows.slice(0, limit);
      return rows;
    },
    _docs: docs,
  };
}

function createFirestoreDb(serviceAccountJson) {
  const admin = require('firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(serviceAccountJson)) });
  const fs = admin.firestore();
  const { FieldValue } = admin.firestore;
  // Convert inc() sentinels to FieldValue.increment and nested objects to merge-friendly form.
  const toFs = (data) => {
    if (isInc(data)) return FieldValue.increment(data[INC]);
    if (!isPlain(data)) return data;
    const out = {};
    for (const [k, v] of Object.entries(data)) if (v !== undefined) out[k] = toFs(v);
    return out;
  };
  return {
    backend: 'firestore',
    inc,
    async get(path) {
      const snap = await fs.doc(path).get();
      return snap.exists ? snap.data() : null;
    },
    async set(path, data) { await fs.doc(path).set(toFs(resolve(data))); },
    async merge(path, patch) { await fs.doc(path).set(toFs(patch), { merge: true }); },
    async create(path, data) {
      try {
        await fs.doc(path).create(toFs(resolve(data)));
        return true;
      } catch (err) {
        if (err.code === 6) return false; // ALREADY_EXISTS
        throw err;
      }
    },
    async del(path) { await fs.doc(path).delete(); },
    async list(collection, { where = [], orderBy, limit } = {}) {
      let q = fs.collection(collection);
      for (const [f, op, v] of where) q = q.where(f, op, v);
      if (orderBy) q = q.orderBy(orderBy[0], orderBy[1] || 'asc');
      if (limit) q = q.limit(limit);
      const snap = await q.get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },
  };
}

function createDb(env = process.env) {
  return env.FIREBASE_SERVICE_ACCOUNT ? createFirestoreDb(env.FIREBASE_SERVICE_ACCOUNT) : createMemoryDb();
}

module.exports = { createDb, createMemoryDb, inc, deepMerge };
