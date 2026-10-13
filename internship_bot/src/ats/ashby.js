// Ashby: the form definition comes from the same GraphQL endpoint Ashby's own page uses.
const ASHBY = /jobs\.ashbyhq\.com\/([^/?#]+)\/([0-9a-f-]{36})/i;

export const handles = url => ASHBY.test(url);

const QUERY = `query ApiJobPosting($organizationHostedJobsPageName: String!, $jobPostingId: String!) {
  jobPosting(organizationHostedJobsPageName: $organizationHostedJobsPageName, jobPostingId: $jobPostingId) {
    descriptionHtml
    applicationForm { sections { fieldEntries { ... on FormFieldEntry { field isRequired descriptionHtml } } } }
    surveyForms { sections { fieldEntries { ... on FormFieldEntry { field isRequired } } } }
  } }`;

const TYPES = { String: 'text', Email: 'text', Phone: 'text', Number: 'text', Url: 'text', LongText: 'textarea', File: 'file',
  Boolean: 'select', ValueSelect: 'select', MultiValueSelect: 'multiselect', Location: 'location', EducationHistory: 'education' };

// Ashby system paths → the standard keys answer.js knows.
const ALIAS = { _systemfield_name: 'full_name', _systemfield_email: 'email', _systemfield_resume: 'resume',
  _systemfield_eeoc_gender: 'gender', _systemfield_eeoc_race: 'race',
  _systemfield_eeoc_veteran_status: 'veteran_status', _systemfield_eeoc_disability_status: 'disability_status' };

const strip = html => (html || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

const toQ = ({ field: f, isRequired, descriptionHtml }) => ({
  key: ALIAS[f.path] || f.path, path: f.path, label: f.title, type: TYPES[f.type] || 'unsupported',
  options: f.type === 'Boolean' ? ['Yes', 'No'] : (f.selectableValues || []).map(v => v.label),
  required: isRequired, ...(descriptionHtml ? { description: strip(descriptionHtml).slice(0, 500) } : {}),
});

export async function load(url) {
  const [, org, id] = url.match(ASHBY);
  const r = await fetch('https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ operationName: 'ApiJobPosting', query: QUERY, variables: { organizationHostedJobsPageName: org, jobPostingId: id } }),
  });
  const p = (await r.json()).data?.jobPosting;
  if (!p) throw new Error('ashby: posting not found (closed?)');
  const entries = [...p.applicationForm.sections, ...(p.surveyForms || []).flatMap(s => s.sections)].flatMap(s => s.fieldEntries);
  return { applyUrl: `https://jobs.ashbyhq.com/${org}/${id}/application`, description: strip(p.descriptionHtml), questions: entries.filter(e => e.field).map(toQ) };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Combobox (location, long dropdowns): type, then click the first option matching.
async function combo(page, input, text, want = () => true) {
  await input.click();
  await input.fill('');
  await input.pressSequentially(text.slice(0, 40), { delay: 25 });
  for (let i = 0; i < 12; i++) {
    const opts = page.locator('[role=option]');
    const texts = await opts.allInnerTexts().catch(() => []);
    const idx = texts.findIndex(t => want(t.trim()));
    if (idx >= 0) { await opts.nth(idx).click(); return true; }
    await sleep(250);
  }
  return false;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const monthYear = s => { const [m, y] = s.toLowerCase().split(/\s+/); return [String(MONTHS.indexOf(m) + 1), y]; };

// School search + major + start/end month-year dropdowns. The end-year list may stop before
// the grad year; then "currently attending" is ticked instead.
async function education(page, box, edu) {
  if (!(await combo(page, box.getByPlaceholder(/search schools/i), edu.school, t => t.split('\n')[0] === edu.school))) return false;
  const sel = box.locator('select');
  const [sm, sy] = monthYear(edu.start), [em, ey] = monthYear(edu.graduation);
  await sel.nth(0).selectOption(sm); await sel.nth(1).selectOption(sy);
  const years = await sel.nth(3).locator('option').allInnerTexts();
  if (years.includes(ey)) { await sel.nth(2).selectOption(em); await sel.nth(3).selectOption(ey); }
  else await box.locator('[id$="-isCurrent"]').check();
  const major = box.locator('[id$="-major"]');   // filled last: picking a school re-renders it
  if (await major.count()) { await major.click(); await major.pressSequentially(edu.major, { delay: 15 }); await major.press('Tab'); }
  return true;
}

export async function fill(page, questions, answers, facts) {
  const problems = [];
  for (const q of questions) {
    const v = answers[q.key];
    const box = page.locator(`[data-field-path="${q.path}"]`).first();
    if (v == null) continue;
    if (!(await box.count())) { if (q.required) problems.push({ key: q.key, label: q.label, why: 'field not found on page' }); continue; }
    let ok = true;
    if (q.type === 'file') await box.locator('input[type=file]').setInputFiles(v);
    else if (q.type === 'text' || q.type === 'textarea') await box.locator('input, textarea').first().fill(String(v));
    else if (q.type === 'location') {
      ok = await combo(page, box.locator('input').first(), `${facts.address.city}, ${facts.address.state}`, t => t.startsWith(facts.address.city));
    } else if (q.type === 'education') {
      ok = await education(page, box, facts.education);
    } else if (q.options.join() === 'Yes,No' && (await box.locator('button[data-option]').count())) {
      await box.locator(`button[data-option="${v === 'Yes' ? 'yes' : 'no'}"]`).click();
    } else {
      for (const one of [v].flat()) {
        const opt = box.getByLabel(one, { exact: true });
        if (await opt.count()) await opt.first().check();
        else ok = (await box.locator('input').count()) ? await combo(page, box.locator('input').first(), one, t => t === one) && ok : false;
      }
    }
    if (!ok) problems.push({ key: q.key, label: q.label, why: `couldn't set "${v}"` });
  }
  return problems;
}

export async function submit(page) {
  await page.getByRole('button', { name: /submit application/i }).click();
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const text = await page.locator('body').innerText();
    if (/thank you for applying|application (was )?(successfully )?submitted|we.ve received your application/i.test(text)) return { ok: true };
    if (/spam|couldn.t submit|could not submit/i.test(text)) return { ok: false, why: 'Ashby rejected the submission (spam check)' };
  }
  const err = await page.locator('[class*=error]').allInnerTexts().catch(() => []);
  return { ok: false, why: 'no confirmation' + (err.length ? ': ' + err.join('; ').slice(0, 200) : '') };
}
