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
// shortcut: assumes US applicant (true for Ben); read facts.address.country if this is ever reused.
const FIXED = { countryPhoneCode: 'United States of America (+1)', country: 'United States of America' };

// Workday lays a transparent "click_filter" div over its submit buttons and ignores synthetic clicks on
// either; a real mouse click on the button's spot is what goes through.
async function press(page, id) {
  const btn = page.locator(A(id)).first();
  await btn.scrollIntoViewIfNeeded().catch(() => {});
  const bb = await btn.boundingBox();
  if (!bb) return btn.click();
  await page.mouse.move(bb.x + bb.width / 2 - 15, bb.y + bb.height / 2, { steps: 5 });
  await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2, { delay: 60 });
}

async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  for (let i = 0; i < 40 && await page.locator('[data-automation-id="loadingSpinner"], [data-automation-id="wd-LoadingPanel"]').first().isVisible().catch(() => false); i++) await sleep(250);
  await sleep(600);
}

const visibleText = async (page, sel) => (await page.locator(sel).allInnerTexts().catch(() => [])).map(t => t.trim()).filter(Boolean);
export const stepName = async page => (await page.locator(A('progressBarActiveStep')).first().innerText().catch(() => ''))
  .replace(/current step \d+ of \d+/i, '').trim();
// Workday also puts success toasts in role=alert ("resume-swe.pdf successfully uploaded", "Search for Jobs page is loaded" after a submit); those aren't errors.
const errors = async page => (await visibleText(page, `${A('errorMessage')}, ${A('inputAlert')}, ${A('errorBanner')} li, [role=alert]`)).filter(t => !/successfully|page is loaded/i.test(t));

// ---- account -------------------------------------------------------------------------------------

// Returns null when signed in, else a reason to hand off.
async function signIn(page, host, { allowCreate, email: me, verifyLink, apply, again = false }) {
  await page.locator(A('legalNoticeAcceptButton')).click({ timeout: 3000 }).catch(() => {});
  const email = page.locator(`input${A('email')}`);
  // Some tenants lead with Apple/Google buttons and hide the email form behind "Sign in with email".
  const viaEmail = page.getByRole('button', { name: /^(sign in|continue) with email$/i });
  await email.or(viaEmail).first().waitFor({ timeout: 20000 }).catch(() => {});
  if (!(await email.isVisible().catch(() => false)) && await viaEmail.isVisible().catch(() => false)) {
    await viaEmail.click(); await email.waitFor({ timeout: 8000 }).catch(() => {});
  }
  if (!(await email.count())) return null;                 // tenant without accounts, or already signed in
  const all = creds();
  let c = all[host];
  const typ = async (sel, v) => { const e = page.locator(sel).first(); await e.click(); await e.fill(''); await e.pressSequentially(v, { delay: 12 }); await e.press('Tab'); };
  const creating = await page.locator(`input${A('verifyPassword')}`).count();
  if (c && creating) { await page.locator(A('signInLink')).click(); await page.locator(`input${A('verifyPassword')}`).waitFor({ state: 'detached', timeout: 8000 }).catch(() => {}); }
  if (!c) {
    if (!allowCreate) return 'Workday account creation is off (dashboard → Settings)';
    if (!creating) { await page.locator(A('createAccountLink')).click(); await page.locator(`input${A('verifyPassword')}`).waitFor({ timeout: 8000 }); }
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
  }
  // The first click sometimes lands before Workday has wired the button up: give it one more.
  const btn = (await verify.count()) ? 'createAccountSubmitButton' : 'signInSubmitButton';
  for (let i = 0; i < 2; i++) {
    await press(page, btn); await settle(page);
    await email.waitFor({ state: 'hidden', timeout: 12000 }).catch(() => {});
    if (!(await email.isVisible().catch(() => false)) || (await errors(page)).length) break;
  }
  const err = (await errors(page)).join(' ');
  if (/already (exists|in use|registered)|account with this email/i.test(err)) {
    delete all[host].created; all[host].password = ''; saveCreds(all);
    return `you already have a Workday account here; put its password in data/workday.json under "${host}" or reset it`;
  }
  const body = await page.locator('body').innerText().catch(() => '');
  if (/(verify|confirm|activate) your (email|account)|verification (email|link)|sent (you )?an? (email|link)/i.test(err + ' ' + body)) {
    const link = verifyLink?.(host);
    if (!link) return 'Workday sent a verification email; click it, then let the bot retry (or connect Gmail in Settings so it can)';
    await page.goto(link, { waitUntil: 'load' }); await settle(page);
    await page.goto(apply, { waitUntil: 'load' }); await settle(page);
    return signIn(page, host, { allowCreate: false, email: me, apply, again: true });
  }
  // Some tenants drop you on a sign-in page after creating the account: go back and sign in once.
  if (!again && await email.isVisible().catch(() => false) && !err) {
    await page.goto(apply, { waitUntil: 'load' }); await settle(page);
    return signIn(page, host, { allowCreate: false, email: me, apply, again: true });
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
  // Listbox options only exist while open; set ones are kept, so only open the ones we'll fill.
  for (const f of fields.filter(f => f.type === 'dropdown' && (!f.value || (FIXED[f.id] && !/united states/i.test(f.value))))) {
    const btn = page.locator(`[data-ib="${f.ref}"] button[aria-haspopup=listbox]`).first();
    await btn.click().catch(() => {});
    // The list fades in with only "Select One" rendered at first: poll until real choices show.
    for (let t = 0; t < 15 && !f.options?.length; t++) {
      if (t) await sleep(200);
      f.options = (await visibleText(page, OPTION)).filter(o => !/^select one$/i.test(o));
    }
    await closeMenu(page);
  }
  for (const f of fields.filter(f => f.type === 'prompt' && !f.value)) {     // short pickers list their choices on click
    await open(page.locator(`[data-ib="${f.ref}"] input`).first()).catch(() => {});
    await sleep(900);
    const opts = await menu(page);
    if (opts.length && opts.length < 40) f.options = opts;
    await closeMenu(page);
  }
  return fields;
}

// Escape doesn't close Workday's pickers; a click on the empty page margin does, like a person would.
const closeMenu = async page => {
  await page.keyboard.press('Escape').catch(() => {});
  for (const [x, y] of [[60, 300], [6, 500]]) {
    if (!(await page.locator('[role=listbox]:visible, [data-automation-id="activeListContainer"]:visible').count())) return;
    await page.mouse.click(x, y); await sleep(300);
  }
};
// The sticky page footer covers fields near the bottom of the viewport: centre the field first.
// A selected value's pill sits over the input, so click the box like a person would.
const open = async el => {
  await el.evaluate(e => e.scrollIntoView({ block: 'center' })); await sleep(200);
  const bb = await el.boundingBox();
  await el.page().mouse.click(bb.x + bb.width - 40, bb.y + bb.height / 2);
};
// Selected prompt pills are role=option too: skip them.
const OPTION = '[role=listbox] [role=option]:visible:not([data-automation-id="selectedItem"])';
const MENU = '[data-automation-id="activeListContainer"] [data-automation-id="menuItem"]:visible';
const menu = async page => (await page.locator(MENU).allInnerTexts().catch(() => [])).map(t => t.trim()).filter(t => t && !/^no items/i.test(t));
const chosen = box => box.locator('[data-automation-id="selectedItem"]').evaluateAll(es =>
  es.map(e => (e.getAttribute('aria-label') || e.innerText).replace(/, press delete to clear value\.?$/, '')));
const best = (opts, want) => { const n = normQ(want); let i = opts.findIndex(t => normQ(t) === n);
  return i >= 0 ? i : opts.findIndex(t => normQ(t).includes(n) || (normQ(t).length > 3 && n.includes(normQ(t)))); };

// The answer engine's view of a field. Keys are stable across runs so approved answers refill the same box.
export function toQuestion(f, step) {
  const where = /my experience/i.test(step) && f.section ? `${f.section}: ` : '';
  const type = { radio: 'select', dropdown: 'select', check: 'select', checks: 'multiselect', prompt: f.options?.length ? 'select' : 'text', date: 'date', file: 'file', textarea: 'textarea', text: 'text' }[f.type];
  return { key: `${normQ(step)}|${normQ(f.section)}|${f.id}`, label: where + f.label, type, options: f.options, required: f.required, widget: f.type, ref: f.ref,
    ...(f.type === 'check' ? { description: 'single checkbox: answer Yes to tick it' } : {}),
    ...(f.type === 'prompt' && !f.options?.length ? { description: 'searchable picker: answer with the text to search for' } : {}) };
}

// ---- filling -------------------------------------------------------------------------------------

// Workday "prompt" pickers: a short list (maybe with sub-lists, like How did you hear → Job Sites → ...)
// or a search box over a long one (schools, countries). `sub(label, options)` answers a sub-list.
async function pickPrompt(page, box, want, sub, label) {
  const input = box.locator('input').first(), leaves = [];
  for (const one of String(want).split(' | ')) {
    if ((await chosen(box)).some(g => best([g], one) === 0)) { leaves.push(one); continue; }   // already set (e.g. by the country)
    await open(input); await sleep(700);
    let opts = await menu(page), i = best(opts, one);
    if (i < 0) {                                                // not in the short list: search for it
      await input.fill(''); await input.pressSequentially(one.replace(/\s*\(.*\)\s*$/, ''), { delay: 20 }); await input.press('Enter'); await sleep(1800);
      opts = await menu(page); i = best(opts, one);
      if (i < 0 && opts.length) i = 0;                          // the search already narrowed it
    }
    if (i < 0) { await closeMenu(page); return false; }
    const path = [opts[i]];
    for (let depth = 0; depth < 3; depth++) {
      await page.locator(MENU).nth(i).click(); await sleep(1100);
      if ((await chosen(box)).some(g => best([g], opts[i]) === 0)) break;   // a leaf: picked
      const next = await menu(page);
      if (!next.length || next.join('|') === opts.join('|')) break;
      const pick = next.length === 1 ? next[0] : await sub?.(`${label} → ${path.join(' → ')}`, next);
      i = pick ? best(next, pick) : -1;
      if (i < 0) { await closeMenu(page); return false; }
      opts = next; path.push(next[i]);
    }
    leaves.push(path.at(-1));
    await closeMenu(page);
  }
  const got = await chosen(box);
  return leaves.every(w => got.some(g => best([g], w) === 0));
}

export async function setField(page, q, v, sub) {
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
    const opt = page.locator(OPTION).filter({ hasText: new RegExp(`^\\s*${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) }).first();
    if (!(await opt.count())) { await page.keyboard.press('Escape'); return false; }
    await opt.click(); await sleep(300); return true;
  }
  if (q.widget === 'date') {
    const d = new Date(/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v) ? v : Date.parse(v) ? v : NaN);
    if (isNaN(d)) return false;
    const parts = { Month: d.getMonth() + 1, Day: d.getDate(), Year: d.getFullYear() };
    for (const [k, n] of Object.entries(parts)) {
      const e = box.locator(`[data-automation-id="dateSection${k}-input"], input[data-automation-id="dateSection${k}"]`).first();
      // focus, not click: a -display overlay sits on the input and swallows clicks
      if (await e.count()) { await e.focus(); await page.keyboard.type(String(n).padStart(k === 'Year' ? 4 : 2, '0'), { delay: 30 }); }
    }
    await page.keyboard.press('Tab'); return true;
  }
  if (q.widget === 'prompt') return pickPrompt(page, box, v, sub, q.label);
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
  // Sub-lists that open after a pick are asked like any other question (and learned the same way).
  let subNeeds = null;
  const sub = async (label, options) => {
    const key = 'sub|' + normQ(label);
    if (ctx.reviewed?.[key]) return ctx.reviewed[key];
    const r = await ctx.answer([{ key, label, type: 'select', options, required: true }]);
    if (r.needs?.length) { subNeeds = r.needs; return null; }
    audit.questions.push([key, label, 'select']); audit.answers[key] = r.answers[key];
    return r.answers[key];
  };

  await page.goto(form.applyUrl, { waitUntil: 'load', timeout: 45000 });
  await settle(page);
  if (/no longer (accepting|available)|job (posting )?is closed/i.test(await page.locator('body').innerText())) return out('closed');
  const why = await signIn(page, u.host, { allowCreate: ctx.allowCreate, email: ctx.email, verifyLink, apply: form.applyUrl });
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

    // The step bar renders before the form: wait for the fields, or we'd press Next on an empty page.
    await page.locator('[data-automation-id^="formField-"]').first().waitFor({ timeout: 15000 }).catch(() => {});
    await sleep(800);
    const fields = await scan(page);
    // Prefilled by the account, an earlier save, or the resume parse: keep it (Ben sees it at review).
    // Workday guesses the country (and phone code) from the IP, which is Sweden for Ben right now.
    const fixed = f => FIXED[f.id] && !/united states/i.test(f.value) ? FIXED[f.id] : null;
    const todo = fields.filter(f => !f.value || fixed(f) || (f.type === 'check' && f.required && f.value !== 'Yes'));
    const qs = todo.map(f => toQuestion(f, step)).filter(q => q.type !== 'file');
    const forced = Object.fromEntries(todo.filter(fixed).map(f => [toQuestion(f, step).key, fixed(f)]));
    for (const f of fields.filter(f => f.value && !fixed(f))) { const q = toQuestion(f, step); audit.questions.push([q.key, q.label, q.type]); audit.answers[q.key] = f.value; }

    if (qs.length) {
      const known = { ...(ctx.reviewed ? Object.fromEntries(qs.filter(q => q.key in ctx.reviewed).map(q => [q.key, ctx.reviewed[q.key]])) : {}), ...forced };
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
        let v = answers[q.key];
        if (v == null || v === '') continue;
        audit.answers[q.key] = v;
        let ok = await setField(page, q, v, sub).catch(() => false);
        // A category whose sub-list has no honest choice (How did you hear → Job Sites → Indeed, LinkedIn...):
        // drop it and ask again with what's left.
        for (let tries = 0, opts = q.options; subNeeds && !ok && opts?.length > 1 && tries < 3; tries++) {
          opts = opts.filter(o => o !== v); subNeeds = null;
          const r = await ctx.answer([{ ...q, options: opts }]);
          if (r.needs?.length || !r.answers[q.key]) { subNeeds = r.needs; break; }
          audit.answers[q.key] = v = r.answers[q.key];
          ok = await setField(page, q, v, sub).catch(() => false);
        }
        if (!ok && q.required) problems.push(`${q.label} ("${v}")`);
      }
      if (subNeeds) return out('needs', { needs: subNeeds });
      if (problems.length) return out('handoff', { why: 'form problems: ' + problems.join('; ').slice(0, 300), screenshot: await shot() });
    }
    await closeMenu(page);
    const pressed = await press(page, 'pageFooterNextButton').then(() => true, () =>
      page.getByRole('button', { name: /save and continue|next|continue/i }).first().click({ timeout: 8000 }).then(() => true, () => false));
    if (!pressed) return out('handoff', { why: `no Save and Continue button on "${step || 'an unnamed page'}"`, screenshot: await shot() });
    // Saving can outlast networkidle (the button greys out meanwhile): wait for the next step or an error.
    for (let t = 0; t < 40 && await stepName(page) === step && !(await errors(page)).length; t++) await sleep(500);
  }
  return out('handoff', { why: 'too many pages', screenshot: await shot() });
}
