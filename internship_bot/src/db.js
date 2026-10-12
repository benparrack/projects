import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';

mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
export const db = new DatabaseSync(new URL('../data/jobs.sqlite', import.meta.url).pathname);
db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY, source TEXT, company TEXT, title TEXT, url TEXT UNIQUE,
    locations TEXT, category TEXT, posted INTEGER, first_seen INTEGER,
    status TEXT DEFAULT 'new',   -- new | skipped | queued | applied | failed
    reason TEXT, answers TEXT, screenshot TEXT, updated INTEGER
  );
  CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
`);

export const meta = {
  get: k => db.prepare('SELECT v FROM meta WHERE k=?').get(k)?.v,
  set: (k, v) => db.prepare('INSERT OR REPLACE INTO meta VALUES (?,?)').run(k, v),
};

// Returns true if the job is new to us.
export function upsert(j) {
  return db.prepare(`INSERT OR IGNORE INTO jobs (id,source,company,title,url,locations,category,posted,first_seen)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(j.id, j.source, j.company, j.title, j.url,
    JSON.stringify(j.locations), j.category, j.posted, Date.now()).changes > 0;
}

export const setStatus = (id, status, extra = {}) =>
  db.prepare('UPDATE jobs SET status=?, reason=?, answers=?, screenshot=?, updated=? WHERE id=?')
    .run(status, extra.reason ?? null, extra.answers ? JSON.stringify(extra.answers) : null,
      extra.screenshot ?? null, Date.now(), id);
