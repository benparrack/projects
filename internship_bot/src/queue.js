// Questions the bot couldn't answer. Each is asked once (phone or terminal); the answer is learned
// and every job waiting on it goes back in line.
//   node src/queue.js          answer open questions in the terminal
import { createInterface } from 'node:readline/promises';
import { db } from './db.js';
import { learn, normQ, loadProfile } from './profile.js';
import { shortList } from './answer.js';
import { send, replyButton, pollReplies } from './notify.js';

db.exec(`CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY, norm TEXT UNIQUE, label TEXT, options TEXT, status TEXT DEFAULT 'open', created INTEGER)`);

// Records a queued job's needs; notifies Ben only about questions he hasn't been asked yet.
export async function enqueue(job, needs) {
  const { facts } = loadProfile();
  for (const n of needs) {
    const opts = shortList(n.options || [], facts);   // a 3000-school list is useless on a phone
    const r = db.prepare('INSERT OR IGNORE INTO questions (norm,label,options,created) VALUES (?,?,?,?)')
      .run(normQ(n.label), n.label, JSON.stringify(opts), Date.now());
    if (!r.changes) continue;
    const id = Number(r.lastInsertRowid);
    await send(`#${id} ${job.company} needs an answer`,
      `${n.label.slice(0, 600)}\n\n${opts.length ? 'Options: ' + opts.join(' / ') + '\n' : ''}Reply: ${id} <answer>   (or: skip ${id})`,
      { click: job.url, tags: ['question'], actions: opts.length <= 3 ? opts.map(o => replyButton(o, `${id} ${o}`)) : [] });
  }
}

// Jobs whose every open need is now answered go back to 'new'.
function release() {
  const open = new Set(db.prepare("SELECT norm FROM questions WHERE status='open'").all().map(q => q.norm));
  const skipped = new Set(db.prepare("SELECT norm FROM questions WHERE status='skipped'").all().map(q => q.norm));
  let n = 0;
  for (const j of db.prepare("SELECT id, reason FROM jobs WHERE status='queued'").all()) {
    const needs = JSON.parse(j.reason || '[]').map(x => normQ(x.label));
    if (needs.some(k => skipped.has(k))) db.prepare("UPDATE jobs SET status='skipped', reason='Ben skipped a required question' WHERE id=?").run(j.id);
    else if (!needs.some(k => open.has(k))) { db.prepare("UPDATE jobs SET status='new', reason=NULL WHERE id=?").run(j.id); n++; }
  }
  return n;
}

// "12 my answer" saves an answer; "skip 12" drops jobs that require that question.
export function handleReply(text) {
  const m = text.trim().match(/^(skip\s+)?#?(\d+)\s*(.*)$/is);
  if (!m) return null;
  const q = db.prepare('SELECT * FROM questions WHERE id=?').get(+m[2]);
  if (!q || (!m[1] && !m[3])) return null;
  if (m[1]) db.prepare("UPDATE questions SET status='skipped' WHERE id=?").run(q.id);
  else { learn(q.label, m[3].trim()); db.prepare("UPDATE questions SET status='answered' WHERE id=?").run(q.id); }
  return q.id;
}

export async function syncReplies() {
  const done = (await pollReplies().catch(() => [])).map(handleReply).filter(Boolean);
  return { answered: done.length, released: release() };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  for (const q of db.prepare("SELECT * FROM questions WHERE status='open' ORDER BY id").all()) {
    const opts = JSON.parse(q.options);
    const a = (await rl.question(`\n#${q.id} ${q.label}\n${opts.length ? '  options: ' + opts.join(' / ') + '\n' : ''}> (Enter = later, "skip" = drop those jobs) `)).trim();
    if (a) handleReply(a === 'skip' ? `skip ${q.id}` : `${q.id} ${a}`);
  }
  rl.close();
  console.log(`${release()} job(s) back in line.`);
}
