// Applies to one job: load questions → answer → fill in a real browser → (unless dry run) submit.
import { mkdirSync } from 'node:fs';
import * as greenhouse from './ats/greenhouse.js';
import * as ashby from './ats/ashby.js';
import { answerAll } from './answer.js';
import { loadProfile } from './profile.js';
import { setStatus } from './db.js';
import { enqueue } from './queue.js';
import { send } from './notify.js';

export const ADAPTERS = [greenhouse, ashby];
export const adapterFor = url => ADAPTERS.find(a => a.handles(url));

const SHOTS = new URL('../data/shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

// Returns { status, needs?, why? } and records it in the db.
export async function apply(browser, job, { dryRun = true } = {}) {
  const ats = adapterFor(job.url);
  const form = await ats.load(job.url);
  const { answers, needs, manual } = await answerAll(form.questions, { ...job, description: form.description });
  if (manual) return handOff(job, manual);
  const audit = { answers, questions: form.questions.map(q => [q.key, q.label]) };
  // A file only Ben can make (a coding assignment, a portfolio) can't be answered by text.
  const file = needs.find(n => n.file || /external task/i.test(n.why));
  if (file) return handOff(job, `${n2why(file)}: "${file.label.slice(0, 150)}"`);
  if (needs.length) { await enqueue(job, needs); return record(job, 'queued', { reason: JSON.stringify(needs), answers: audit }, { needs }); }

  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  try {
    await page.goto(form.applyUrl, { waitUntil: 'networkidle', timeout: 45000 });
    const problems = await ats.fill(page, form.questions, answers, loadProfile().facts);
    const screenshot = `${SHOTS}${job.id}.png`;
    await page.screenshot({ path: screenshot, fullPage: true });
    if (problems.length) return handOff(job, 'form problems: ' + problems.map(p => `${p.label} (${p.why})`).join('; '), screenshot);
    if (dryRun) return record(job, 'dryrun', { answers: audit, screenshot });
    const res = await ats.submit(page);
    await page.screenshot({ path: screenshot.replace('.png', '-after.png'), fullPage: true });
    if (!res.ok) return handOff(job, `submit blocked: ${res.why}`, screenshot);
    return record(job, 'applied', { answers: audit, screenshot }, res);
  } finally { await page.close(); }
}

const n2why = n => /external task/i.test(n.why) ? 'asks for outside work' : /field type/.test(n.why) ? 'has a field the bot can\'t fill' : 'wants a file upload';

// Things the bot must not or cannot do: Ben gets a one-tap link to apply himself.
async function handOff(job, why, screenshot) {
  await send(`Apply yourself: ${job.company}`, `${job.title}\n${why}`, { click: job.url, tags: ['point_right'] });
  return record(job, 'manual', { reason: why, screenshot }, { why });
}

function record(job, status, extra, out = {}) {
  setStatus(job.id, status, extra);
  return { status, ...out };
}
