// Applies to one job: load questions → answer → fill in a real browser → (unless dry run) submit.
import { mkdirSync } from 'node:fs';
import * as greenhouse from './ats/greenhouse.js';
import { answerAll } from './answer.js';
import { loadProfile } from './profile.js';
import { setStatus } from './db.js';

export const ADAPTERS = [greenhouse];
export const adapterFor = url => ADAPTERS.find(a => a.handles(url));

const SHOTS = new URL('../data/shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

// Returns { status, needs?, why? } and records it in the db.
export async function apply(browser, job, { dryRun = true } = {}) {
  const ats = adapterFor(job.url);
  const form = await ats.load(job.url);
  const { answers, needs, manual } = await answerAll(form.questions, { ...job, description: form.description });
  if (manual) return record(job, 'manual', { reason: manual }, { why: manual });
  const audit = { answers, questions: form.questions.map(q => [q.key, q.label]) };
  if (needs.length) return record(job, 'queued', { reason: JSON.stringify(needs), answers: audit }, { needs });

  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  try {
    await page.goto(form.applyUrl, { waitUntil: 'networkidle', timeout: 45000 });
    const problems = await ats.fill(page, form.questions, answers, loadProfile().facts);
    const screenshot = `${SHOTS}${job.id}.png`;
    await page.screenshot({ path: screenshot, fullPage: true });
    if (problems.length) return record(job, 'queued', { reason: JSON.stringify(problems), answers: audit, screenshot }, { needs: problems });
    if (dryRun) return record(job, 'dryrun', { answers: audit, screenshot });
    const res = await ats.submit(page);
    await page.screenshot({ path: screenshot.replace('.png', '-after.png'), fullPage: true });
    return record(job, res.ok ? 'applied' : 'failed', { reason: res.why, answers: audit, screenshot }, res);
  } finally { await page.close(); }
}

function record(job, status, extra, out = {}) {
  setStatus(job.id, status, extra);
  return { status, ...out };
}
