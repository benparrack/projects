// Lever: the apply page is server-rendered. Custom questions ship as JSON (cards[..][baseTemplate]);
// standard fields (name, links, EEO) are read from the form's named controls.
const LEVER = /jobs\.lever\.co\/([^/?#]+)\/([0-9a-f-]{36})/i;

export const handles = url => LEVER.test(url);

const unesc = s => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const text = h => unesc(h.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const CARD_TYPES = { text: 'text', textarea: 'textarea', 'multiple-choice': 'select', 'multiple-select': 'multiselect', dropdown: 'select', 'file-upload': 'file' };
const SKIP = /^(accountId|linkedInData|origin|referer|h-captcha-response|selectedLocation|socialProfiles|resumeStorageId|consent|cards\[|surveysResponses\[)/;
const ALIAS = { name: 'full_name', 'eeo[gender]': 'gender', 'eeo[race]': 'race', 'eeo[veteran]': 'veteran_status', 'eeo[disability]': 'disability_status',
  'eeo[disabilitySignature]': 'full_name', 'eeo[disabilitySignatureDate]': 'today', urls: null };

// Pure HTML → questions, so it can be tested on a saved page.
export function parse(html) {
  const qs = [];
  // Custom cards: cards[id][fieldN]. Voluntary surveys (demographics): surveysResponses[id][responses][fieldN].
  for (const m of html.matchAll(/<input[^>]*\[baseTemplate\][^>]*>/g)) {
    const [, kind, id] = m[0].match(/name="(cards|surveysResponses)\[([^\]]+)\]\[baseTemplate\]"/);
    const t = JSON.parse(unesc(m[0].match(/value="([^"]*)"/)[1]));
    const at = i => kind === 'cards' ? `cards[${id}][field${i}]` : `surveysResponses[${id}][responses][field${i}]`;
    // "Select One" / "Other" mean nothing alone (and would be learned across companies): add the card title.
    const label = f => /^(select one|choose one|other|please (select|specify|explain)|if (yes|other|so)\b.{0,20})$/i.test(f.text.trim()) ? `${t.text} ${f.text}` : f.text;
    t.fields.forEach((f, i) => qs.push({ key: at(i), name: at(i), label: label(f),
      type: CARD_TYPES[f.type] || 'unsupported', ...(f.type === 'multiple-choice' ? { widget: 'radio' } : {}), options: (f.options || []).map(o => o.text), required: !!f.required,
      ...(f.description ? { description: f.description.slice(0, 400) } : {}) }));
  }
  const seen = new Set();
  for (const m of html.matchAll(/<(input|select|textarea)\b([^>]*)>/g)) {
    const name = m[2].match(/name="([^"]+)"/)?.[1];
    if (!name || SKIP.test(name) || seen.has(name) || /type="hidden"/.test(m[2])) continue;
    seen.add(name);
    const before = html.slice(Math.max(0, m.index - 1500), m.index);
    const labels = [...before.matchAll(/class="application-label[^"]*">([\s\S]*?)<\/div>/g)];
    const label = name === 'resume' ? 'Resume/CV' : labels.length ? text(labels.at(-1)[1]).replace(/✱/g, '').trim() : name;
    let options = [];
    if (m[1] === 'select') {
      const end = html.indexOf('</select>', m.index);
      options = [...html.slice(m.index, end).matchAll(/<option value="([^"]+)"[^>]*>([^<]*)/g)].map(o => text(o[2]));
    }
    const type = /type="file"/.test(m[2]) ? 'file' : m[1] === 'select' ? 'select' : m[1] === 'textarea' ? 'textarea' : name === 'location' ? 'location' : 'text';
    qs.push({ key: ALIAS[name] ?? name, name, label, type, options, required: /\brequired\b/.test(m[2]) || /✱/.test(labels.at(-1)?.[1] || '') });
  }
  return qs;
}

export async function load(url) {
  const [, co, id] = url.match(LEVER);
  const r = await fetch(`https://jobs.lever.co/${co}/${id}/apply`);
  if (!r.ok) throw new Error(`lever ${r.status} (closed?)`);
  const html = await r.text();
  const d = await fetch(`https://api.lever.co/v0/postings/${co}/${id}`).then(r => r.ok ? r.json() : {}).catch(() => ({}));
  const description = [d.descriptionPlain, ...(d.lists || []).map(l => `${l.text}: ${text(l.content)}`)].filter(Boolean).join('\n');
  return { applyUrl: `https://jobs.lever.co/${co}/${id}/apply`, description, questions: parse(html) };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function fill(page, questions, answers, facts) {
  const problems = [];
  // Lever parses the resume and autofills over typed fields when it finishes, so upload it first and wait.
  const order = [...questions].sort((a, b) => (b.name === 'resume') - (a.name === 'resume'));
  for (const q of order) {
    let v = answers[q.key];
    if (v == null) continue;
    const el = page.locator(`[name="${q.name}"]`);
    if (!(await el.count())) { if (q.required) problems.push({ key: q.key, label: q.label, why: 'field not found on page' }); continue; }
    let ok = true;
    try {
      if (q.type === 'file') {
        await el.first().setInputFiles(v);
        if (q.name === 'resume') {
          const busy = page.getByText(/analyzing resume/i);
          for (let i = 0; i < 10 && !(await busy.isVisible().catch(() => false)); i++) await sleep(300);   // it starts a beat late
          for (let i = 0; i < 60 && await busy.isVisible().catch(() => false); i++) await sleep(500);
        }
      }
      else if (q.type === 'select' && q.widget !== 'radio') await el.first().selectOption({ label: v });
      else if (q.type === 'select' || q.type === 'multiselect') {
        for (const one of [v].flat()) {
          const box = page.locator(`input[name="${q.name}"][value="${one.replace(/"/g, '\\"')}"]`);
          if (await box.count()) await box.first().check({ force: true }); else ok = false;
        }
      } else if (q.type === 'location') {
        await el.click(); await el.fill(''); await el.pressSequentially(`${facts.address.city}, ${facts.address.state}`, { delay: 30 });
        const opt = page.locator('.dropdown-location').first();
        for (let i = 0; i < 16 && !(await opt.isVisible().catch(() => false)); i++) await sleep(250);
        if (await opt.isVisible().catch(() => false)) await opt.click(); else ok = false;
      } else await el.first().fill(String(v));
    } catch (e) { ok = false; }
    // Optional fields that won't take a value (e.g. a survey hidden until a location is picked) are left blank.
    if (!ok && q.required) problems.push({ key: q.key, label: q.label, why: `couldn't set "${v}"` });
  }
  return problems;
}

export async function submit(page) {
  await page.locator('#btn-submit, button[type=submit]').first().click();
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    if (/\/thanks/.test(page.url())) return { ok: true };
    const t = await page.locator('body').innerText();
    if (/application submitted|thank you for (applying|your application)/i.test(t)) return { ok: true };
    if (await page.locator('iframe[src*="hcaptcha"][title*="challenge" i]').isVisible().catch(() => false)) return { ok: false, why: 'captcha' };
  }
  const err = await page.locator('.error-message, .application-error').allInnerTexts().catch(() => []);
  return { ok: false, why: 'no confirmation' + (err.length ? ': ' + err.join('; ').slice(0, 200) : '') };
}
