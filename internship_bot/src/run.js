// One pass: fetch new postings → filter → (later) apply. `--list` stops after showing what would be applied to.
import { db, upsert, setStatus } from './db.js';
import { fetchAll } from './sources.js';
import { skipReason } from './filter.js';

const args = new Set(process.argv.slice(2));
const jobs = await fetchAll({ force: args.has('--force') });
let fresh = 0;
for (const j of jobs) {
  if (!upsert(j)) continue;
  fresh++;
  const why = skipReason(j);
  if (why) setStatus(j.id, 'skipped', { reason: why });
}
const counts = db.prepare('SELECT status, COUNT(*) n FROM jobs GROUP BY status').all();
console.log(`${jobs.length} fetched, ${fresh} new.`, Object.fromEntries(counts.map(c => [c.status, c.n])));

if (args.has('--list')) {
  // Newest postings first: being early matters more than working the backlog.
  for (const r of db.prepare(`SELECT company, title, url FROM jobs WHERE status='new' ORDER BY posted DESC LIMIT 25`).all())
    console.log(`${r.company.padEnd(24).slice(0, 24)} ${r.title.slice(0, 60).padEnd(60)} ${new URL(r.url).host}`);
}
