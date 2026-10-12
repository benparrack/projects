// One pass: fetch new postings → filter → apply.
//   --list        show the next jobs in line and stop
//   --apply N     apply to up to N jobs (dry run: fills + screenshots, never submits)
//   --live        actually submit
//   --id ID       just this job
import { chromium } from 'playwright-core';
import { db, upsert, setStatus, meta } from './db.js';
import { fetchAll } from './sources.js';
import { skipReason } from './filter.js';
import { apply, adapterFor } from './apply.js';
import { syncReplies } from './queue.js';
import { topics, send } from './notify.js';

const argv = process.argv.slice(2);
const opt = k => { const i = argv.indexOf(k); return i < 0 ? null : argv[i + 1] ?? true; };

if (!meta.get('ntfy:shown')) {
  console.log(`Phone setup: in the ntfy app subscribe to "${topics().alert}" (alerts) and "${topics().reply}" (where you type answers).`);
  meta.set('ntfy:shown', '1');
}
const synced = await syncReplies();
if (synced.answered) console.log(`${synced.answered} answer(s) from phone, ${synced.released} job(s) back in line.`);

const jobs = await fetchAll({ force: !!opt('--force') });
let fresh = 0;
for (const j of jobs) {
  if (!upsert(j)) continue;
  fresh++;
  const why = skipReason(j);
  if (why) setStatus(j.id, 'skipped', { reason: why });
}
const counts = db.prepare('SELECT status, COUNT(*) n FROM jobs GROUP BY status').all();
console.log(`${jobs.length} fetched, ${fresh} new.`, Object.fromEntries(counts.map(c => [c.status, c.n])));

// Newest postings first: being early matters more than working the backlog.
const live = !!opt('--live');
const pending = (opt('--id')
  ? db.prepare('SELECT * FROM jobs WHERE id=?').all(opt('--id'))
  : db.prepare(`SELECT * FROM jobs WHERE status IN ('new'${live ? ",'dryrun'" : ''}) ORDER BY posted DESC`).all())
  .map(r => ({ ...r, locations: JSON.parse(r.locations) }))
  .filter(r => adapterFor(r.url));

if (opt('--list')) for (const r of pending.slice(0, 25))
  console.log(`${r.id} ${r.company.padEnd(22).slice(0, 22)} ${r.title.slice(0, 60)}`);

const n = +opt('--apply') || 0;
if (n) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const job of pending.slice(0, n)) {
      const res = await apply(browser, job, { dryRun: !live })
        .catch(e => (setStatus(job.id, 'failed', { reason: e.message }), { status: 'failed', why: e.message }));
      console.log(`${res.status.padEnd(7)} ${job.company} | ${job.title}` +
        (res.needs ? '\n          needs: ' + res.needs.map(x => `${x.label} (${x.why})`).join('\n                 ') : '') +
        (res.why ? `\n          ${res.why}` : ''));
    }
  } finally { await browser.close(); }
}

// Evening digest, once a day.
const today = new Date().toISOString().slice(0, 10);
if (new Date().getHours() >= 20 && meta.get('digest') !== today) {
  const since = Date.now() - 864e5;
  const c = st => db.prepare('SELECT COUNT(*) n FROM jobs WHERE status=? AND updated>?').get(st, since).n;
  const open = db.prepare("SELECT COUNT(*) n FROM questions WHERE status='open'").get().n;
  await send('Internship bot: today', `Applied: ${c('applied')}\nApply yourself: ${c('manual')}\nOpen questions: ${open}\nWaiting in line: ${db.prepare("SELECT COUNT(*) n FROM jobs WHERE status='new'").get().n}`, { tags: ['clipboard'] });
  meta.set('digest', today);
}
