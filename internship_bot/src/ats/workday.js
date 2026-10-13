// Workday: a multi-page wizard behind a candidate account (one per company). Questions only exist
// page by page, so this adapter drives the whole flow itself (`run`) instead of load → fill → submit:
//   account → My Information → My Experience (resume upload) → questions → disclosures → self-ID → Review.
// Every page is read generically from Workday's data-automation-id markup, answered by the normal
// answer engine, filled, and saved with "Save and Continue". Anything it can't handle hands off.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { normQ } from '../profile.js';

const WD = /^https:\/\/([\w-]+)\.(wd\d+)\.(myworkdayjobs|myworkdaysite)\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([^/?#]+)\/(?:details\/|job\/)(.+?)\/?(?:\?.*)?$/;
export const handles = url => WD.test(url);
export const wizard = true;

const CREDS = new URL('../../data/workday.json', import.meta.url).pathname;
const creds = () => (existsSync(CREDS) ? JSON.parse(readFileSync(CREDS, 'utf8')) : {});
const saveCreds = c => writeFileSync(CREDS, JSON.stringify(c, null, 1), { mode: 0o600 });
// Meets every Workday password policy seen: upper, lower, digit, special, 8+.
const newPassword = () => 'Ib!' + randomBytes(12).toString('base64url').replace(/[-_]/g, 'x') + '7q';

export function parseUrl(url) {
  const m = url.match(WD);
  if (!m) return null;
  const [, tenant, dc, dom, site, path] = m;
  const host = `${tenant}.${dc}.${dom}.com`;
  return { host, tenant, site, path, apply: `https://${host}/en-US/${site}/job/${path}/apply/applyManually` };
}

const strip = h => h.replace(/<br\s*\/?>|<\/(p|li|div|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

export async function load(url) {
  const u = parseUrl(url);
  const r = await fetch(`https://${u.host}/wday/cxs/${u.tenant}/${u.site}/job/${u.path}`, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`workday ${r.status} (closed?)`);
  const j = (await r.json()).jobPostingInfo;
  if (j.canApply === false) throw new Error('workday: posting closed');
  return { applyUrl: u.apply, description: strip(j.jobDescription || ''), questions: [] };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const A = id => `[data-automation-id="${id}"]`;

// Workday puts a transparent "click_filter" div over its real buttons; clicking that is what a user does.
async function press(page, id) {
  const filt = page.locator(`${A(id)} ~ ${A('click_filter')}, ${A('click_filter')}:has(+ ${A(id)})`).first();
  if (await filt.count()) await filt.click();
  else await page.locator(A(id)).first().click();
}

async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  for (let i = 0; i < 40 && await page.locator('[data-automation-id="loadingSpinner"], [data-automation-id="wd-LoadingPanel"]').first().isVisible().catch(() => false); i++) await sleep(250);
  await sleep(600);
}

const visibleText = async (page, sel) => (await page.locator(sel).allInnerTexts().catch(() => [])).map(t => t.trim()).filter(Boolean);
export const stepName = async page => (await page.locator(A('progressBarActiveStep')).first().innerText().catch(() => ''))
  .replace(/current step \d+ of \d+/i, '').trim();
const errors = page => visibleText(page, `${A('errorMessage')}, ${A('inputAlert')}, ${A('errorBanner')} li, [role=alert]`);

// ---- account -------------------------------------------------------------------------------------

// Returns null when signed in, else a reason to hand off.
async function signIn(page, host, { allowCreate, email: me, verifyLink }) {
  await page.locator(A('legalNoticeAcceptButton')).click({ timeout: 3000 }).catch(() => {});
  const email = page.locator(`input${A('email')}`);
  await email.waitFor({ timeout: 20000 }).catch(() => {});
  if (!(await email.count())) return null;                 // tenant without accounts, or already signed in
  const all = creds();
  let c = all[host];
  const typ = async (sel, v) => { const e = page.locator(sel).first(); await e.click(); await e.fill(''); await e.pressSequentially(v, { delay: 12 }); await e.press('Tab'); };
  const creating = await page.locator(`input${A('verifyPassword')}`).count();
  if (c && creating) { await press(page, 'signInLink'); await page.locator(`input${A('verifyPassword')}`).waitFor({ state: 'detached', timeout: 8000 }).catch(() => {}); }
  if (!c) {
    if (!allowCreate) return 'Workday account creation is off (dashboard → Settings)';
    if (!creating) { await press(page, 'createAccountLink'); await page.locator(`input${A('verifyPassword')}`).waitFor({ timeout: 8000 }); }
    c = all[host] = { email: me, password: newPassword(), created: Date.now() };
  }
  if (!c.email) return 'no email for the Workday account';
  await typ(`input${A('email')}`, c.email);
  await typ(`input${A('password')}`, c.password);
  const verify = page.locator(`input${A('verifyPassword')}`);
  if (await verify.count()) {
    await typ(`input${A('verifyPassword')}`, c.password);
    const box = page.locator(`input${A('createAccountCheckbox')}`);
    if (await box.count() && !(await box.isChecked())) await box.click();
    saveCreds(all);                                       // before submitting, so a crash can't lose the password
    await press(page, 'createAccountSubmitButton');
  } else await press(page, 'signInSubmitButton');
  await settle(page);
  const err = (await errors(page)).join(' ');
  if (/already (exists|in use|registered)|account with this email/i.test(err)) {
    delete all[host].created; all[host].password = ''; saveCreds(all);
    return `you already have a Workday account here; put its password in data/workday.json under "${host}" or reset it`;
  }
  if (/verif/i.test(err + ' ' + await page.locator('body').innerText().catch(() => '')) && await email.isVisible().catch(() => false)) {
    const link = verifyLink?.(host);
    if (!link) return 'Workday sent a verification email; click it, then let the bot retry (or set up Gmail so it can)';
    await page.goto(link, { waitUntil: 'load' }); await settle(page);
    return signIn(page, host, { allowCreate: false, email: me });
  }
  if (/incorrect|invalid|locked/i.test(err)) return `Workday sign-in failed: ${err.slice(0, 160)}`;
  if (await email.isVisible().catch(() => false)) return `Workday sign-in didn't go through${err ? ': ' + err.slice(0, 160) : ' (captcha?)'}`;
  return null;
}

// Verification links arrive by email; mail.py can fetch them once Gmail is set up.
export function verifyLink(host) {
  const r = spawnSync('python3', [new URL('../mail.py', import.meta.url).pathname, '--verify', host], { encoding: 'utf8', timeout: 180000 });
  return r.status === 0 ? r.stdout.trim() || null : null;
}

// ---- reading a page ------------------------------------------------------------------------------

// Every visible form field on the page, tagged with data-ib so fill() can find it again.
const SCAN = () => {
  const out = [];
  const lab = el => (el?.innerText || '').replace(/\s*\*\s*$/, '').replace(/\s+/g, ' ').trim();
  const fields = [...document.querySelectorAll('[data-automation-id^="formField-"]')].filter(f => f.offsetParent && !f.parentElement.closest('[data-automation-id^="formField-"]'));
  fields.forEach((f, i) => {
    f.dataset.ib = String(i);
    const id = f.dataset.automationId.replace(/^formField-/, '');
    const group = f.closest('[role=group][aria-labelledby], [data-automation-id$="-panel"], [data-fkit-id]');
    const section = group ? lab(document.getElementById(group.getAttribute('aria-labelledby')) || group.querySelector('h3,h4')) : '';
    const labelEl = f.querySelector('legend, label');
    let label = lab(labelEl) || f.getAttribute('aria-label') || id;
    const required = /\*/.test(labelEl?.innerText || '') || !!f.querySelector('[aria-required=true], [required]');
    const radios = [...f.querySelectorAll('input[type=radio]')];
    const boxes = [...f.querySelectorAll('input[type=checkbox]')];
    const date = f.querySelector('[data-automation-id^="dateSection"]');
    const drop = f.querySelector('button[aria-haspopup=listbox]');
    const prompt = f.querySelector('[data-automation-id="multiselectInputContainer"], input[data-uxi-widget-type="selectinput"]');
    const file = f.querySelector('input[type=file]');
    const area = f.querySelector('textarea');
    const text = f.querySelector('input[type=text], input[type=email], input[type=tel], input[type=number], input:not([type])');
    const optLabel = el => lab(f.querySelector(`label[for="${el.id}"]`) || el.closest('label') || el.parentElement);
    let type, options = [], value = '';
    if (radios.length) { type = 'radio'; options = radios.map(optLabel); value = radios.filter(r => r.checked).map(optLabel)[0] || ''; }
    else if (boxes.length > 1) { type = 'checks'; options = boxes.map(optLabel); value = boxes.filter(b => b.checked).map(optLabel).join(' | '); }
    else if (boxes.length === 1) { type = 'check'; options = ['Yes', 'No']; value = boxes[0].checked ? 'Yes' : '';
      if (!labelEl || lab(labelEl) === optLabel(boxes[0])) label = optLabel(boxes[0]) || label; }
    else if (date) { type = 'date'; value = [...f.querySelectorAll('[data-automation-id^="dateSection"][data-automation-id$="-input"], input[data-automation-id^="dateSection"]')].map(e => e.value).filter(Boolean).join('/'); }
    else if (drop) { type = 'dropdown'; value = /^select one$/i.test(drop.innerText.trim()) ? '' : drop.innerText.trim(); }
    else if (prompt) { type = 'prompt'; value = [...f.querySelectorAll('[data-automation-id="selectedItem"]')].map(lab).join(' | '); }
    else if (file) { type = 'file'; value = f.querySelector('[data-automation-id="file-upload-item-name"], [data-automation-id="fileName"]')?.innerText || ''; }
    else if (area) { type = 'textarea'; value = area.value; }
    else if (text) { type = 'text'; value = text.value; }
    else return;
    out.push({ ref: String(i), id, section, label, type, options, required, value });
  });
  return out;
};

export async function scan(page) {
  const fields = await page.evaluate(SCAN);
  for (const f of fields.filter(f => f.type === 'dropdown')) {    // listbox options only exist while open
    const btn = page.locator(`[data-ib="${f.ref}"] button[aria-haspopup=listbox]`).first();
    await btn.click().catch(() => {});
    await page.locator('[role=listbox] [role=option]').first().waitFor({ timeout: 3000 }).catch(() => {});
    f.options = (await visibleText(page, '[role=listbox] [role=option]')).filter(o => !/^select one$/i.test(o));
    await page.keyboard.press('Escape'); await sleep(150);
  }
  return fields;
}

// The answer engine's view of a field. Keys are stable across runs so approved answers refill the same box.
export function toQuestion(f, step) {
  const where = /my experience/i.test(step) && f.section ? `${f.section}: ` : '';
  const type = { radio: 'select', dropdown: 'select', check: 'select', checks: 'multiselect', prompt: 'text', date: 'date', file: 'file', textarea: 'textarea', text: 'text' }[f.type];
  return { key: `${normQ(step)}|${normQ(f.section)}|${f.id}`, label: where + f.label, type, options: f.options, required: f.required, widget: f.type, ref: f.ref,
    ...(f.type === 'check' ? { description: 'single checkbox: answer Yes to tick it' } : {}),
    ...(f.type === 'prompt' ? { description: 'searchable picker: answer with the text to search for' } : {}) };
}

// ---- filling -------------------------------------------------------------------------------------

async function pickPrompt(page, box, want) {
  const input = box.locator('input').first();
  for (const one of String(want).split(' | ')) {
    await input.click(); await input.fill(''); await input.pressSequentially(one, { delay: 20 }); await input.press('Enter');
    const opts = page.locator('[data-automation-id="promptOption"], [role=option]');
    await opts.first().waitFor({ timeout: 5000 }).catch(() => {});
    const texts = await visibleText(page, '[data-automation-id="promptOption"], [role=option]');
    if (!texts.length) return false;
    const n = normQ(one);
    let i = texts.findIndex(t => normQ(t) === n);
    if (i < 0) i = texts.findIndex(t => normQ(t).includes(n) || n.includes(normQ(t)));
    if (i < 0) i = 0;
    await opts.nth(i).click(); await sleep(500);
    // Hierarchical pickers ("How did you hear" → Job Board → …): a new level opens; take the closest leaf.
    const next = await visibleText(page, '[data-automation-id="promptOption"]');
    if (next.length && next.join() !== texts.join()) {
      const j = Math.max(0, next.findIndex(t => /other|website|job board|internet|online/i.test(t)));
      await page.locator('[data-automation-id="promptOption"]').nth(j).click(); await sleep(400);
    }
    await page.keyboard.press('Escape').catch(() => {});
  }
  return true;
}

export async function setField(page, q, v) {
  const box = page.locator(`[data-ib="${q.ref}"]`);
  if (q.widget === 'text' || q.widget === 'textarea') { const e = box.locator('input, textarea').first(); await e.fill(String(v)); await e.press('Tab'); return true; }
  if (q.widget === 'file') { await box.locator('input[type=file]').setInputFiles(v); await settle(page); return true; }
  if (q.widget === 'check') { const c = box.locator('input[type=checkbox]'); if (/^y/i.test(v) !== await c.isChecked()) await c.click({ force: true }); return true; }
  if (q.widget === 'radio' || q.widget === 'checks') {
    for (const one of [v].flat().flatMap(x => String(x).split(' | '))) {
      const l = box.getByLabel(one, { exact: true });
      if (!(await l.count())) return false;
      if (!(await l.first().isChecked())) await l.first().click({ force: true });
    }
    return true;
  }
  if (q.widget === 'dropdown') {
    await box.locator('button[aria-haspopup=listbox]').click();
    const opt = page.locator('[role=listbox] [role=option]').filter({ hasText: new RegExp(`^\\s*${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) }).first();
    if (!(await opt.count())) { await page.keyboard.press('Escape'); return false; }
    await opt.click(); await sleep(300); return true;
  }
  if (q.widget === 'date') {
    const d = new Date(/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v) ? v : Date.parse(v) ? v : NaN);
    if (isNaN(d)) return false;
    const parts = { Month: d.getMonth() + 1, Day: d.getDate(), Year: d.getFullYear() };
    for (const [k, n] of Object.entries(parts)) {
      const e = box.locator(`[data-automation-id="dateSection${k}-input"], input[data-automation-id="dateSection${k}"]`).first();
      if (await e.count()) { await e.click(); await e.pressSequentially(String(n).padStart(k === 'Year' ? 4 : 2, '0'), { delay: 30 }); }
    }
    await page.keyboard.press('Tab'); return true;
  }
  if (q.widget === 'prompt') return pickPrompt(page, box, v);
  return false;
}

// ---- the whole flow ------------------------------------------------------------------------------

// ctx: { answer(questions) → {answers, needs, manual}, reviewed: {key: value} | null, dryRun, resume,
//        allowCreate, email, shot() → screenshot path }
// Returns { status: 'review' | 'submitted' | 'needs' | 'handoff', audit, needs?, why?, screenshot? }
export async function run(page, job, form, ctx) {
  const u = parseUrl(job.url);
  const audit = { answers: {}, questions: [] };
  const shot = async () => { const p = ctx.shot(); await page.screenshot({ path: p, fullPage: true }); return p; };
  const out = (status, extra = {}) => ({ status, audit, ...extra });

  await page.goto(form.applyUrl, { waitUntil: 'load', timeout: 45000 });
  await settle(page);
  if (/no longer (accepting|available)|job (posting )?is closed/i.test(await page.locator('body').innerText())) return out('closed');
  const why = await signIn(page, u.host, { allowCreate: ctx.allowCreate, email: ctx.email, verifyLink });
  if (why) return out('handoff', { why, screenshot: await shot() });

  for (let pageNo = 0, last = '', same = 0; pageNo < 14; pageNo++) {
    await settle(page);
    const step = await stepName(page);
    same = step === last ? same + 1 : 0; last = step;
    if (same >= 2) return out('handoff', { why: `stuck on "${step}": ${(await errors(page)).join('; ').slice(0, 200) || 'Save and Continue did nothing'}`, screenshot: await shot() });
    if (/assessment/i.test(step)) return out('handoff', { why: 'has an assessment step (outside work)', screenshot: await shot() });

    if (/review/i.test(step)) {
      const screenshot = await shot();
      if (ctx.dryRun) return out('review', { screenshot });
      await press(page, 'pageFooterSubmitButton').catch(() => page.getByRole('button', { name: /^submit$/i }).click());
      for (let i = 0; i < 30; i++) {
        await sleep(1000);
        const t = await page.locator('body').innerText();
        if (/application (has been )?submitted|successfully submitted|thank you for applying|congratulations/i.test(t)) return out('submitted', { screenshot });
        const e = await errors(page);
        if (e.length) return out('handoff', { why: 'submit blocked: ' + e.join('; ').slice(0, 200), screenshot });
      }
      return out('handoff', { why: 'submit: no confirmation', screenshot });
    }

    // My Experience: the resume upload fills work history and education for us.
    if (/experience/i.test(step) && ctx.resume) {
      const up = page.locator('input[type=file]').first();
      const has = await visibleText(page, '[data-automation-id="file-upload-item-name"], [data-automation-id="fileName"]');
      if (await up.count() && !has.length) { await up.setInputFiles(ctx.resume); await settle(page); await sleep(2500); await settle(page); }
    }

    const fields = await scan(page);
    // Prefilled by the account, an earlier save, or the resume parse: keep it (Ben sees it at review).
    const todo = fields.filter(f => !f.value || (f.type === 'check' && f.required && f.value !== 'Yes'));
    const qs = todo.map(f => toQuestion(f, step)).filter(q => q.type !== 'file');
    for (const f of fields.filter(f => f.value)) { const q = toQuestion(f, step); audit.questions.push([q.key, q.label, q.type]); audit.answers[q.key] = f.value; }

    if (qs.length) {
      const known = ctx.reviewed ? Object.fromEntries(qs.filter(q => q.key in ctx.reviewed).map(q => [q.key, ctx.reviewed[q.key]])) : {};
      const rest = qs.filter(q => !(q.key in known));
      const res = rest.length ? await ctx.answer(rest) : { answers: {}, needs: [] };
      if (res.manual) return out('handoff', { why: res.manual, screenshot: await shot() });
      const file = res.needs.find(n => n.file || /external task/i.test(n.why));
      if (file) return out('handoff', { why: `needs something only you can do: "${file.label.slice(0, 150)}"`, screenshot: await shot() });
      if (res.needs.length) return out('needs', { needs: res.needs });
      const answers = { ...res.answers, ...known };
      const problems = [];
      for (const q of qs) {
        audit.questions.push([q.key, q.label, q.type]);
        const v = answers[q.key];
        if (v == null || v === '') continue;
        audit.answers[q.key] = v;
        const ok = await setField(page, q, v).catch(() => false);
        if (!ok && q.required) problems.push(`${q.label} ("${v}")`);
      }
      if (problems.length) return out('handoff', { why: 'form problems: ' + problems.join('; ').slice(0, 300), screenshot: await shot() });
    }
    await press(page, 'pageFooterNextButton').catch(() => page.getByRole('button', { name: /save and continue|next|continue/i }).first().click());
  }
  return out('handoff', { why: 'too many pages', screenshot: await shot() });
}
