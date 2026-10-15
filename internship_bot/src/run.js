// One pass: fetch new postings → filter → apply.
//   --list        show the next jobs in line and stop
//   --apply N     work through up to N new jobs. Unless auto-submit is on (dashboard → Settings)
//                 this is a dry run: fill + screenshot, then wait for Ben's approval.
//   --live        submit new jobs without approval (this run only)
//   --id ID       just this job
//   --approved    only submit jobs Ben approved in the dashboard (no fetch)
// Approved jobs are always submitted first, by whichever run gets there.
import { chromium } from 'playwright-core';
import { openSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { db, upsert, setStatus, meta } from './db.js';
import { fetchAll } from './sources.js';
import { skipReason } from './filter.js';
import { apply, adapterFor } from './apply.js';
import { syncReplies } from './queue.js';
import { topics, send } from './notify.js';

const argv = process.argv.slice(2);
const opt = k => { const i = argv.indexOf(k); return i < 0 ? null : argv[i + 1]?.startsWith('--') ? true : argv[i + 1] ?? true; };

// One runner at a time (timer, dashboard and terminal can all start one).
const LOCK = new URL('../data/run.lock', import.meta.url).pathname;
try { openSync(LOCK, 'wx'); } catch {
  const pid = +readFileSync(LOCK, 'utf8');
  try { process.kill(pid, 0); console.log(`another run (pid ${pid}) is going; it picks up approved jobs too.`); process.exit(0); }
  catch { /* stale lock from a crashed run */ }
}
writeFileSync(LOCK, String(process.pid));
const unlock = () => { try { if (readFileSync(LOCK, 'utf8') === String(process.pid)) unlinkSync(LOCK); } catch {} };
process.on('exit', unlock);
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => process.exit(1));

if (!meta.get('ntfy:shown')) {
  console.log(`Phone setup: in the ntfy app subscribe to "${topics().alert}" (alerts) and "${topics().reply}" (where you type answers).`);
  meta.set('ntfy:shown', '1');
}
const synced = await syncReplies();
if (synced.answered) console.log(`${synced.answered} answer(s) from phone, ${synced.released} job(s) back in line.`);

if (!opt('--approved')) {
  const jobs = await fetchAll({ force: !!opt('--force') });
  let fresh = 0;
  for (const j of jobs) {
    if (!upsert(j)) continue;
    fresh++;
    const why = skipReason(j);
    if (why) setStatus(j.id, 'skipped', { reason: why });
  }
  meta.set('fetch:at', String(Date.now()));
  const counts = db.prepare('SELECT status, COUNT(*) n FROM jobs GROUP BY status').all();
  console.log(`${jobs.length} fetched, ${fresh} new.`, Object.fromEntries(counts.map(c => [c.status, c.n])));
}

const rows = sql => db.prepare(sql).all().map(r => ({ ...r, locations: JSON.parse(r.locations) })).filter(r => adapterFor(r.url));
const approved = () => rows("SELECT * FROM jobs WHERE status='approved' ORDER BY updated");
// Ben's "just approve" ones (Greenhouse, Lever) first, so he can clear a batch in one sitting; then newest first.
const pending = opt('--id') ? rows(`SELECT * FROM jobs WHERE id='${String(opt('--id')).replace(/\W/g, '')}'`)
  : opt('--approved') ? [] : rows(`SELECT * FROM jobs WHERE status='new'
      ORDER BY (url LIKE '%greenhouse.io%' OR url LIKE '%lever.co%') DESC, posted DESC`);

if (opt('--list')) for (const r of pending.slice(0, 25))
  console.log(`${r.id} ${r.company.padEnd(22).slice(0, 22)} ${r.title.slice(0, 60)}`);

const live = !!opt('--live') || meta.get('auto_submit') === '1';
const cap = +(meta.get('daily_cap') || 25);
const doneToday = () => db.prepare("SELECT COUNT(*) n FROM jobs WHERE status IN ('applied','dryrun') AND updated > ?")
  .get(new Date().setHours(0, 0, 0, 0)).n;
const n = opt('--id') ? 1 : Math.min(+opt('--apply') || 0, Math.max(0, cap - doneToday()));

let browser;
const run = async (job, dryRun) => {
  browser ??= await chromium.launch({ channel: 'chrome', headless: true });
  meta.set('run:current', `${job.company}: ${job.title}`);
  const res = await apply(browser, job, { dryRun })
    .catch(e => {
      // The lists lag behind: a 404 from the board means the posting was taken down.
      const status = /\b404\b|closed/i.test(e.message) ? 'skipped' : 'failed';
      setStatus(job.id, status, { reason: status === 'skipped' ? 'posting closed' : e.message });
      return { status, why: e.message };
    });
  console.log(`${res.status.padEnd(7)} ${job.company} | ${job.title}` +
    (res.needs ? '\n          needs: ' + res.needs.map(x => `${x.label} (${x.why})`).join('\n                 ') : '') +
    (res.why ? `\n          ${res.why}` : ''));
};
try {
  for (let a; (a = approved()).length;) for (const job of a) await run(job, false);
  for (const job of pending.slice(0, n)) {
    await run(job, !live);
    for (const job of approved()) await run(job, false);   // Ben approved something mid-run
  }
} finally { meta.set('run:current', ''); await browser?.close(); }

// Evening digest, once a day.
const today = new Date().toISOString().slice(0, 10);
if (new Date().getHours() >= 20 && meta.get('digest') !== today) {
  const since = Date.now() - 864e5;
  const c = st => db.prepare('SELECT COUNT(*) n FROM jobs WHERE status=? AND updated>?').get(st, since).n;
  const open = db.prepare("SELECT COUNT(*) n FROM questions WHERE status='open'").get().n;
  await send('Internship bot: today', `Applied: ${c('applied')}\nAwaiting your approval: ${db.prepare("SELECT COUNT(*) n FROM jobs WHERE status='dryrun'").get().n}\nApply yourself: ${c('manual')}\nOpen questions: ${open}\nWaiting in line: ${db.prepare("SELECT COUNT(*) n FROM jobs WHERE status='new'").get().n}`, { tags: ['clipboard'] });
  meta.set('digest', today);
}
