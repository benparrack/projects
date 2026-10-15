// Greenhouse: questions come from the public job-board API, filling happens in the real form.
const GH = /(?:job-boards|boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_app\?for=)?([\w-]+)\/jobs\/(\d+)/;

export const handles = url => GH.test(url);

const TYPES = { input_text: 'text', textarea: 'textarea', input_file: 'file',
  multi_value_single_select: 'select', multi_value_multi_select: 'multiselect' };

const strip = html => html.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// API question → { key, label, type, options, required }. A question's first field is the one we fill
// (the resume question also offers a "paste text" field we skip).
const toQ = (q, required = q.required) => {
  const f = q.fields[0];
  return { key: f.name, label: q.label, type: TYPES[f.type] || 'text', options: f.values.map(v => v.label), required };
};

export async function load(url) {
  const [, board, id] = url.match(GH);
  const r = await fetch(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${id}?questions=true`);
  if (!r.ok) throw new Error(`greenhouse api ${r.status}`);
  const j = await r.json();
  const questions = [
    ...j.questions.filter(q => q.fields[0] && TYPES[q.fields[0].type]).map(q => toQ(q)),
    ...(j.compliance || []).flatMap(c => c.questions).map(q => toQ(q, false)),
  ];
  return { applyUrl: `https://job-boards.greenhouse.io/${board}/jobs/${id}`, description: strip(j.content || ''), questions };
}

// Form widgets that aren't in the API's question list. [id, search terms, preferred option pattern]
const extras = facts => [
  ['country', ['United States'], /^United States/],
  ['candidate-location', [`${facts.address.city}, ${facts.address.state === 'VA' ? 'Virginia' : facts.address.state}`, facts.address.city], new RegExp(`^${facts.address.city}, Virginia`)],
  ['school--0', ['Virginia Tech', 'Virginia Polytechnic', 'Virginia'], /Virginia Tech|Virginia Polytechnic/],
  ['degree--0', ["Bachelor's", 'Bachelor'], /^Bachelor'?s( Degree)?$/],
  ['discipline--0', ['Computer Science'], /^Computer Science$/],
  ['start-month--0', [facts.education.start.split(' ')[0]], new RegExp(`^${facts.education.start.split(' ')[0]}$`)],
  ['end-month--0', [(facts.education.end || facts.education.graduation).split(' ')[0]], new RegExp(`^${(facts.education.end || facts.education.graduation).split(' ')[0]}$`)],
  // Race only appears once "Hispanic/Latino?" is answered, so it's filled here, after it.
  ['hispanic_ethnicity', [facts.eeo.hispanic_or_latino ? 'Yes' : 'No'], new RegExp(`^${facts.eeo.hispanic_or_latino ? 'Yes' : 'No'}$`)],
  ['race', [facts.eeo.race], new RegExp(`^${facts.eeo.race}`)],
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

// react-select: type to search, then click the option in *this* input's listbox.
async function pickOption(page, el, terms, want) {
  for (const t of terms) {
    await el.click();
    await el.fill('');
    await el.pressSequentially(t.slice(0, 40), { delay: 25 });
    const box = page.locator(`#${await el.getAttribute('aria-controls')} [role=option]`);
    for (let i = 0; i < 12; i++) {           // results load async (location/school search)
      const texts = await box.allInnerTexts().catch(() => []);
      const idx = texts.findIndex(x => want(x.trim()));
      if (idx >= 0) { await box.nth(idx).click(); return true; }
      await sleep(250);
    }
    await el.press('Escape');
  }
  return false;
}

const exact = s => x => x.toLowerCase() === s.toLowerCase();

// Fills every answered field. Returns a list of problems (required fields it couldn't fill).
export async function fill(page, questions, answers, facts) {
  const problems = [];
  for (const q of questions) {
    const v = answers[q.key];
    const el = page.locator(`[id="${q.key}"]`);
    if (v == null || !(await el.count())) {
      if (q.required && v != null) problems.push({ key: q.key, label: q.label, why: 'field not found on page' });
      continue;
    }
    let ok = true;
    const tag = await el.evaluate(e => e.tagName);
    if (tag === 'FIELDSET') {        // checkbox / radio group: tick the boxes whose label matches
      for (const one of [v].flat()) {
        const box = el.getByLabel(one, { exact: true });
        if (await box.count()) await box.first().check(); else ok = false;
      }
    } else if (q.type === 'file') await el.setInputFiles(v);
    else if (q.type === 'select') ok = await pickOption(page, el, [v, v.split(/\s+/).slice(0, 3).join(' ')], exact(v));
    else if (q.type === 'multiselect') {
      for (const one of v) ok = (await pickOption(page, el, [one], exact(one))) && ok;
    } else await el.fill(String(v));
    if (!ok) problems.push({ key: q.key, label: q.label, why: `couldn't select "${v}"` });
  }
  for (const [id, terms, re] of extras(facts)) {
    const el = page.locator(`[id="${id}"]`);
    if (!(await el.count())) continue;
    const ok = await pickOption(page, el, terms, x => re.test(x));
    if (!ok && (await el.getAttribute('aria-required')) === 'true')
      problems.push({ key: id, label: id.replace(/--0$/, ''), why: 'no matching option' });
  }
  // Education years are plain number boxes next to the month pickers.
  for (const [id, when] of [['start-year--0', facts.education.start], ['end-year--0', facts.education.end || facts.education.graduation]]) {
    const el = page.locator(`[id="${id}"]`);
    if (await el.count()) await el.fill(when.split(' ')[1]);
  }
  return problems;
}

// Clicks submit and reports what happened. Never retries: a double submit is worse than a miss.
// Greenhouse's email code is its human check: Ben types it into the open window and clicks Submit himself.
export const humanCode = true;
const CONFIRMED = /thank you for applying|application (has been )?(received|submitted)/i;

export async function submit(page, { onCode } = {}) {
  await page.locator('button[type=submit]').last().click();
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const text = await page.locator('body').innerText();
    if (/confirmation/.test(page.url()) || CONFIRMED.test(text)) return { ok: true };
    if (/security code|verification code/i.test(text)) {
      if (!onCode) return { ok: false, why: 'Greenhouse emailed a security code' };
      await onCode();
      await page.bringToFront();
      await page.getByText('Security code', { exact: true }).scrollIntoViewIfNeeded().catch(() => {});
      for (let t = 0; t < 900; t++) {                              // 15 min for Ben to type it and submit
        if (page.isClosed()) return { ok: false, why: 'window closed before the code was entered' };
        await sleep(1000);
        const done = await page.locator('body').innerText().then(x => /confirmation/.test(page.url()) || CONFIRMED.test(x), () => false);
        if (done) return { ok: true };
      }
      return { ok: false, why: 'security code not entered within 15 minutes' };
    }
    if (/captcha/i.test(text) && /verify|robot/i.test(text)) return { ok: false, why: 'captcha' };
  }
  const err = await page.locator('[class*=error], [aria-invalid=true]').allInnerTexts().catch(() => []);
  return { ok: false, why: 'no confirmation page' + (err.length ? ': ' + err.join('; ').slice(0, 200) : '') };
}
