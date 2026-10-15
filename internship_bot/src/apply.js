// Applies to one job: load questions → answer → fill in a real browser → (unless dry run) submit.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import * as greenhouse from './ats/greenhouse.js';
import * as ashby from './ats/ashby.js';
import * as lever from './ats/lever.js';
import * as workday from './ats/workday.js';
import { answerAll } from './answer.js';
import { offCycle } from './filter.js';
import { loadProfile, resumeFor } from './profile.js';
import { setStatus, meta } from './db.js';
import { enqueue } from './queue.js';
import { send } from './notify.js';

export const ADAPTERS = [greenhouse, ashby, lever, workday];
// Workday needs a candidate account per company; until Ben allows that, its postings stay "not automated".
export const adapterFor = url => ADAPTERS.find(a => a.handles(url) && (!a.wizard || meta.get('workday_accounts') === '1'));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const DONE = /thank you for (applying|your application|your interest)|application (has been |was )?(successfully )?(received|submitted)|we.ve received your application/i;
const SHOTS = new URL('../data/shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

// Returns { status, needs?, why? } and records it in the db.
export async function apply(browser, job, { dryRun = true } = {}) {
  const ats = adapterFor(job.url);
  const form = await ats.load(job.url);
  const off = job.status !== 'approved' && offCycle(form.description);
  if (off) return record(job, 'skipped', { reason: off }, { why: off });
  // Approved in the dashboard: submit exactly the answers Ben reviewed (and maybe edited).
  const reviewed = job.status === 'approved' && job.answers ? JSON.parse(job.answers).answers : null;
  if (ats.wizard) return wizard(browser, ats, job, form, reviewed, dryRun || !!process.env.INTERN_NO_SUBMIT);
  const { answers, needs, manual } = reviewed ? { answers: reviewed, needs: [] }
    : await answerAll(form.questions, { ...job, description: form.description });
  if (manual) return handOff(job, manual);
  const audit = { answers, questions: form.questions.map(q => [q.key, q.label, q.type]) };
  // A file only Ben can make (a coding assignment, a portfolio) can't be answered by text.
  const file = needs.find(n => n.file || /external task/i.test(n.why));
  if (file) return handOff(job, `${n2why(file)}: "${file.label.slice(0, 150)}"`);
  if (needs.length) { await enqueue(job, needs); return record(job, 'queued', { reason: JSON.stringify(needs), answers: audit }, { needs }); }

  // Live submits run in a visible window: hidden browsers get silently dropped by bot checks, and Ben can step in.
  const own = !dryRun && !process.env.INTERN_NO_SUBMIT && await chromium.launch({ channel: 'chrome', headless: false });
  const page = await (own || browser).newPage({ viewport: { width: 1100, height: 900 } });
  try {
    await page.goto(form.applyUrl, { waitUntil: 'load', timeout: 45000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});   // some boards never go idle
    const problems = await ats.fill(page, form.questions, answers, loadProfile().facts);
    const screenshot = `${SHOTS}${job.id}.png`;
    await page.screenshot({ path: screenshot, fullPage: true });
    if (problems.length) return handOff(job, 'form problems: ' + problems.map(p => `${p.label} (${p.why})`).join('; '), screenshot);
    if (dryRun) return record(job, 'dryrun', { answers: audit, screenshot });
    // Test switch: run the whole live path but stop before the click.
    if (process.env.INTERN_NO_SUBMIT) return record(job, 'dryrun', { reason: 'INTERN_NO_SUBMIT: stopped before submit', answers: audit, screenshot });
    const res = await ats.submit(page, { onCode: () => send(`Type the code: ${job.company}`,
      'Greenhouse emailed you a security code. Type it into the open Chrome window, then click Submit.', { tags: ['key'] }) });
    if (!res.ok && !page.isClosed() && !/window closed|within 15 minutes/.test(res.why)) {
      await send(`Finish it yourself: ${job.company}`, `The form didn't confirm (${res.why}). Check the open Chrome window: fix anything flagged, then click Submit.`, { tags: ['warning'] });
      await page.bringToFront();
      for (let t = 0; t < 900 && !page.isClosed() && !res.ok; t++) {
        await sleep(1000);
        if (await page.locator('body').innerText().then(x => DONE.test(x), () => false)) res.ok = true;
      }
    }
    if (!page.isClosed()) await page.screenshot({ path: screenshot.replace('.png', '-after.png'), fullPage: true });
    if (!res.ok) return handOff(job, `submit blocked: ${res.why}`, screenshot);
    return record(job, 'applied', { answers: audit, screenshot }, res);
  } finally { await (own || page).close().catch(() => {}); }
}

// Multi-page forms (Workday): the adapter walks the pages itself and asks the answer engine page by page.
async function wizard(browser, ats, job, form, reviewed, dryRun) {
  const { facts } = loadProfile();
  const screenshot = `${SHOTS}${job.id}.png`;
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  try {
    const r = await ats.run(page, job, form, { dryRun, reviewed, email: facts.email, resume: resumeFor(job).path,
      allowCreate: meta.get('workday_accounts') === '1', shot: () => screenshot,
      answer: qs => answerAll(qs, { ...job, description: form.description }) });
    if (r.status === 'closed') return record(job, 'skipped', { reason: 'posting closed' });
    if (r.status === 'needs') { await enqueue(job, r.needs); return record(job, 'queued', { reason: JSON.stringify(r.needs), answers: r.audit }, { needs: r.needs }); }
    if (r.status === 'handoff') return handOff(job, r.why, r.screenshot);
    if (r.status === 'review') return record(job, 'dryrun', { answers: r.audit, screenshot, ...(process.env.INTERN_NO_SUBMIT ? { reason: 'INTERN_NO_SUBMIT: stopped before submit' } : {}) });
    return record(job, 'applied', { answers: r.audit, screenshot }, { ok: true });
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
