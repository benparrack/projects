// Tiny IndexedDB key-value wrapper (structured clone, so typed arrays are stored natively).
// Falls back to an in-memory map if IndexedDB is unavailable (private mode, etc.).

const DB_NAME = 'gb-emu';
const STORE = 'kv';
let dbPromise = null;
const memory = new Map();

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbPromise;
}

export async function get(key) {
  const db = await open();
  if (!db) return memory.get(key);
  return new Promise((resolve) => {
    const req = db.transaction(STORE).objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(undefined);
  });
}

export async function set(key, value) {
  const db = await open();
  if (!db) { memory.set(key, value); return; }
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export async function del(key) {
  const db = await open();
  if (!db) { memory.delete(key); return; }
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export async function romKey(rom) {
  try {
    const hash = await crypto.subtle.digest('SHA-1', rom);
    return [...new Uint8Array(hash)].slice(0, 10).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // crypto.subtle needs a secure context; fall back to a cheap FNV hash.
    let h = 0x811c9dc5;
    for (let i = 0; i < rom.length; i += 7) { h ^= rom[i]; h = Math.imul(h, 16777619); }
    return 'f' + (h >>> 0).toString(16) + rom.length.toString(16);
  }
}
