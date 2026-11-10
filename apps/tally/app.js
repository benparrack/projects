// Tally UI. State lives in localStorage under 'tally'; window.tally exposes it for the e2e test.
(() => {
const L = Logic, $ = s => document.querySelector(s), view = $('#view');
const DB = L.parseDB(FOOD_DB), DBMAP = Object.fromEntries(DB.map(f => [f.id, f]));
const KEY = 'tally';
const OFF = 'https://world.openfoodfacts.org';
const OFF_FIELDS = 'code,product_name,product_name_en,product_name_sv,brands,nutriments,serving_size,serving_quantity,quantity';

// ---------- state ----------
const blank = () => ({ v: 1, profile: null, plan: null, settings: { units: 'us', theme: 'auto' }, days: {}, weights: {}, foods: {}, usage: {}, meals: [], ts: {}, backupAt: null });
const load = () => { try { return { ...blank(), ...JSON.parse(localStorage.getItem(KEY)) }; } catch { return blank(); } };
let state = load();
let snap = L.snapshot(state); // what each record looked like at the last save, so save() can stamp the ones that changed
function save() {
  const r = L.stamp(state, snap); snap = r.snap;
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { toast('Could not save. Storage may be full.'); }
  if (r.changed && sync) { sync.dirty = true; syncStore(); syncSoon(); }
}
const ui = { today: L.day(), day: L.day(), range: 91, foodsTab: 'saved', foodsQ: '' };
let lastId = 0; // ids sort in the order they were made, which is how a day's entries are ordered after a sync
const uid = () => (lastId = Math.max(Date.now(), lastId + 1)).toString(36) + Math.random().toString(36).slice(2, 7);

// ---------- sync: a private GitHub gist that every device merges into ----------
// The token lives in its own key so it never lands in the gist or a backup file.
const SYNC_KEY = 'tally-sync', GH = 'https://api.github.com', GIST_FILE = 'tally.json';
const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=gist&description=Tally%20sync';
let sync = (() => { try { return JSON.parse(localStorage.getItem(SYNC_KEY)); } catch { return null; } })(); // { token, gist, etag, at, dirty, login }
const syncStore = () => { try { sync ? localStorage.setItem(SYNC_KEY, JSON.stringify(sync)) : localStorage.removeItem(SYNC_KEY); } catch { /* private mode */ } };
const syncRun = { busy: false, again: false, err: null, timer: null };
let needRender = false;
const syncSoon = () => { clearTimeout(syncRun.timer); syncRun.timer = setTimeout(syncNow, 1500); };
class GHError extends Error { constructor(status) { super('github ' + status); this.status = status; } }
async function gh(path, opts = {}, token = sync.token) {
  const r = await fetch(GH + path, { cache: 'no-store', ...opts,
    headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token, ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...opts.headers } });
  if (!r.ok && r.status !== 304) throw new GHError(r.status);
  return r;
}
// The gist's copy of the data. A file over 1 MB comes back truncated and has to be fetched whole.
async function gistData(g) {
  const f = g.files && g.files[GIST_FILE];
  if (!f) return null;
  const text = f.truncated ? await (await fetch(f.raw_url, { cache: 'no-store' })).text() : f.content;
  try { const d = JSON.parse(text); return d && typeof d.days === 'object' ? d : null; } catch { return null; }
}
const gistBody = () => JSON.stringify({ files: { [GIST_FILE]: { content: JSON.stringify(state) } } });
// Take in a merged copy without stamping it as a fresh local change.
function adopt(next) {
  state = next; snap = L.snapshot(state);
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* the next save reports it */ }
  if (ob && ob.step === 0 && !ob.editOnly && state.plan) ob = null; // a second device that just linked skips setup
  paintIfQuiet();
}
// Re-render now unless that would yank a field out from under the user; then it waits for the next quiet moment.
function paintIfQuiet() {
  const a = document.activeElement;
  if (sheetEl.open || (a && view.contains(a) && a.matches('input, textarea, select'))) { needRender = true; return; }
  needRender = false; render();
}
const stuck = () => ['auth', 'gone'].includes(syncRun.err); // needs the user; retrying won't help
async function syncNow(force) {
  if (!sync || !sync.gist || (stuck() && force !== true)) return;
  if (syncRun.busy) { syncRun.again = true; return; }
  if (needRender) paintIfQuiet();
  if (!navigator.onLine) { syncRun.err = 'offline'; return paintSync(); }
  syncRun.busy = true; syncRun.again = false; paintSync();
  try {
    const r = await gh(`/gists/${sync.gist}`, { headers: sync.etag ? { 'If-None-Match': sync.etag } : {} });
    let push = sync.dirty;
    if (r.status !== 304) { // the gist changed since we last looked
      const remote = await gistData(await r.json());
      sync.etag = r.headers.get('ETag');
      const merged = remote ? L.merge(state, remote) : state;
      if (L.digest(merged) !== L.digest(state)) adopt(merged);
      push = !remote || L.digest(merged) !== L.digest(remote);
    }
    if (push) {
      sync.dirty = false; // a save while this is in flight sets it again
      try { const p = await gh(`/gists/${sync.gist}`, { method: 'PATCH', body: gistBody() }); sync.etag = p.headers.get('ETag'); }
      catch (e) { sync.dirty = true; throw e; }
    }
    sync.at = Date.now(); syncRun.err = null;
  } catch (e) {
    syncRun.err = e.status === 401 ? 'auth' : e.status === 404 ? 'gone' : e.status === 403 || e.status === 429 ? 'limit' : 'net';
    if (stuck()) paintIfQuiet(); // Today shows a banner for these
  } finally {
    syncRun.busy = false;
    if (sync) syncStore();
    paintSync();
    if (syncRun.again || (sync && sync.dirty && !syncRun.err)) syncSoon();
  }
}
const ago = t => { const m = Math.round((Date.now() - t) / 6e4); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : dateTxt(L.day(new Date(t))); };
function syncLine() {
  if (!sync) return 'Keep your phone and computer in step';
  if (syncRun.busy) return 'Syncing…';
  return ({ offline: 'Offline. Changes sync when you\'re back online.', net: 'Couldn\'t reach GitHub. Trying again shortly.', limit: 'GitHub is limiting requests. Trying again shortly.',
    auth: 'The sync token stopped working (expired or revoked).', gone: 'The sync gist was deleted on GitHub.' })[syncRun.err] || (sync.at ? `Synced ${ago(sync.at)}` : 'Not synced yet');
}
function paintSync() { document.querySelectorAll('.syncstat').forEach(el => { el.textContent = syncLine(); el.classList.toggle('bad', stuck()); }); }
// Connect with a token (or a code from another device's QR): find the existing Tally gist or make one.
async function connect(raw) {
  let token = raw.trim(), gist = null;
  const code = /^tally-sync:([\w-]+):([0-9a-f]+)$/i.exec(token);
  if (code) [, token, gist] = code;
  if (!/^[\w-]{20,}$/.test(token)) throw new Error('That doesn\'t look like a token. It starts with ghp_ or github_pat_.');
  let me;
  try { const r = await gh('/user', {}, token); me = await r.json(); me.scopes = r.headers.get('X-OAuth-Scopes') || ''; }
  catch (e) { throw new Error(e.status === 401 ? 'GitHub didn\'t accept that token. Check it was copied whole.' : 'Couldn\'t reach GitHub. Check your connection.'); }
  let found = null;
  try {
    if (gist) found = await (await gh(`/gists/${gist}`, {}, token)).json();
    for (let page = 1; !found && page <= 10; page++) {
      const list = await (await gh(`/gists?per_page=100&page=${page}`, {}, token)).json();
      const hit = list.find(g => g.files && g.files[GIST_FILE] && g.description === 'Tally sync');
      if (hit) found = await (await gh(`/gists/${hit.id}`, {}, token)).json();
      if (list.length < 100) break;
    }
  } catch { throw new Error('Couldn\'t read your gists. Make sure the token has the gist box ticked.'); }
  const remote = found && await gistData(found);
  return { token, login: me.login, broad: /\brepo\b/.test(me.scopes), gist: found && found.id, remote };
}
async function finishConnect(c, how) {
  sync = { token: c.token, gist: c.gist, login: c.login, etag: null, at: 0, dirty: true };
  if (how === 'replace') adopt({ ...blank(), ...c.remote, backupAt: state.backupAt });
  else if (c.remote) adopt(L.merge(state, c.remote));
  try {
    if (!c.gist) {
      const r = await gh('/gists', { method: 'POST', body: JSON.stringify({ description: 'Tally sync', public: false, files: { [GIST_FILE]: { content: JSON.stringify(state) } } }) });
      sync.gist = (await r.json()).id;
    }
  } catch (e) { sync = null; throw new Error(e.status === 403 || e.status === 404 ? 'That token can\'t make gists. Make one with the gist box ticked.' : 'Couldn\'t reach GitHub. Check your connection.'); }
  syncStore(); syncRun.err = null;
  await syncNow();
}
// Another tab of the app (a second window on the computer) saved: merge it in rather than overwrite it later.
window.addEventListener('storage', e => {
  if (e.key === SYNC_KEY) { try { sync = JSON.parse(e.newValue); } catch { sync = null; } return paintSync(); }
  if (e.key !== KEY || !e.newValue) return;
  try { const merged = L.merge(state, JSON.parse(e.newValue)); if (L.digest(merged) !== L.digest(state)) adopt(merged); } catch { /* ignore a half-written value */ }
});
window.addEventListener('online', () => syncNow());
setInterval(() => { if (!document.hidden) { syncNow(); paintSync(); } }, 30000);
const loadQR = () => window.qrcode ? Promise.resolve() : new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'vendor/qrcode.js'; s.onload = ok; s.onerror = no; document.head.appendChild(s); });

// ---------- formatting ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = n => Math.round(n).toLocaleString('en-US');
const r1 = n => Math.round(n * 10) / 10;
const num = s => { const n = parseFloat(String(s ?? '').replace(',', '.').trim()); return Number.isFinite(n) ? n : NaN; };
const metric = () => state.settings.units === 'metric';
const wUnit = () => metric() ? 'kg' : 'lb';
const wVal = lb => metric() ? lb / L.KG : lb; // display number
const wTxt = (lb, unit = true) => (lb == null ? '–' : wVal(lb).toFixed(1)) + (unit ? ' ' + wUnit() : '');
const toLb = v => metric() ? v * L.KG : v;
const rateTxt = lb => `${+Math.abs(wVal(lb)).toFixed(metric() ? 2 : 1)} ${wUnit()}/week`;
const signed = (lb, digits = 1) => (lb > 0 ? '+' : lb < 0 ? '−' : '±') + Math.abs(wVal(lb)).toFixed(digits) + ' ' + wUnit();
const dateTxt = (key, long) => {
  const d = L.date(key), opts = { month: 'short', day: 'numeric' };
  if (long) opts.weekday = 'short';
  if (d.getFullYear() !== L.date(ui.today).getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-US', opts);
};
const dayName = key => { const d = L.diffDays(ui.today, key); return d === 0 ? 'Today' : d === -1 ? 'Yesterday' : d === 1 ? 'Tomorrow' : dateTxt(key, true); };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const icon = {
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  dots: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  scan: '<svg viewBox="0 0 24 24"><path d="M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3M8 9v6M11 9v6M14 9v6M17 9v6"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 4l2.4 5 5.4.7-4 3.8 1 5.4L12 16.3 7.2 19l1-5.4-4-3.8 5.4-.7z"/></svg>',
  bolt: '<svg viewBox="0 0 24 24"><path d="M13 3L5 14h6l-1 7 8-11h-6z"/></svg>',
  pen: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4"/></svg>',
  minus: '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>',
};

// ---------- foods ----------
const withUsage = f => f && ({ ...f, ...state.usage[f.id] });
const foodById = id => withUsage(state.foods[id] || DBMAP[id]);
const allFoods = () => [...DB.filter(f => !state.foods[f.id]), ...Object.values(state.foods)].map(withUsage);
const servingKcal = f => { const a = L.defaultAmount(f); return L.of(f, a.qty * a.g).kcal; };
const entriesOf = key => (state.days[key] || {}).entries || [];

function makeEntry(f, a, meal) {
  const n = L.of(f, a.qty * a.g);
  return { id: uid(), meal, foodId: f.id, name: f.name, brand: f.brand || '', qty: Math.round(a.qty * 1000) / 1000, g: a.g, label: a.label,
    kcal: r1(n.kcal), p: r1(n.p), c: r1(n.c), f: r1(n.f) };
}
// Logging a food remembers the amount and keeps Open Food Facts items so they work offline next time.
function touch(f, a, meal) {
  if (!f.id || f.id.startsWith('quick')) return;
  if (f.src === 'off' && !state.foods[f.id]) { const { uses, last, at, star, m, ...clean } = f; state.foods[f.id] = clean; }
  const u = state.usage[f.id] || (state.usage[f.id] = {});
  u.uses = (u.uses || 0) + 1; u.at = Date.now(); u.last = { qty: a.qty, g: a.g, label: a.label };
  u.m = u.m || {}; u.m[meal] = (u.m[meal] || 0) + 1;
}
function addEntries(key, list) {
  const day = state.days[key] || (state.days[key] = { entries: [] });
  day.entries.push(...list);
  save();
  return () => { dropEntries(key, list.map(e => e.id)); render(); };
}
// Undo goes through these rather than a saved reference to the day, which a sync may have replaced since.
function dropEntries(key, ids) { const day = state.days[key]; if (day) day.entries = day.entries.filter(e => !ids.includes(e.id)); save(); }
function putEntries(key, list) {
  const day = state.days[key] || (state.days[key] = { entries: [] }), ids = list.map(e => e.id);
  day.entries = [...day.entries.filter(e => !ids.includes(e.id)), ...list].sort((a, b) => a.id < b.id ? -1 : 1);
  save();
}

// ---------- toast ----------
let toastTimer;
function toast(msg, undo) {
  const t = $('#toast');
  (sheetEl.open ? sheetEl : document.body).appendChild(t); // a modal dialog covers anything outside it
  t.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button data-act="undo">Undo</button>' : ''}`;
  t.classList.add('show');
  toast.undo = undo;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), undo ? 5000 : 2600);
}

// ---------- router ----------
const TABS = ['today', 'progress', 'foods', 'plan'];
let tab = 'today';
function render() {
  document.documentElement.dataset.theme = state.settings.theme === 'auto' ? '' : state.settings.theme;
  if (!state.plan || ob) { document.body.classList.add('setup'); return renderSetup(); }
  document.body.classList.remove('setup');
  const h = location.hash.slice(1);
  tab = TABS.includes(h) ? h : 'today';
  document.querySelectorAll('.tabs a').forEach(a => a.classList.toggle('on', a.dataset.view === tab));
  $('#fab').hidden = tab !== 'today';
  ({ today: renderToday, progress: renderProgress, foods: renderFoods, plan: renderPlan })[tab]();
}
window.addEventListener('hashchange', () => { render(); scrollTo(0, 0); });

// ======================================================================
// Today
// ======================================================================
function renderToday() {
  const key = ui.day, plan = state.plan, entries = entriesOf(key);
  const t = L.sum(entries), budget = L.budget(plan, key), left = budget - t.kcal;
  const series = L.trend(state.weights), trend = L.trendOn(series, key);
  const w = state.weights[key], lastW = series.filter(s => s.day < key).pop();
  const flexDay = budget > plan.kcal;
  const prevKey = L.addDays(key, -1);

  const meals = L.MEALS.map(([id, name]) => {
    const list = entries.filter(e => e.meal === id), kcal = L.sum(list).kcal;
    const yest = entriesOf(prevKey).filter(e => e.meal === id);
    return `<section class="meal">
      <header>
        <h2>${name}</h2><span class="mk">${list.length ? fmt(kcal) : ''}</span>
        ${list.length ? `<button class="icon" data-act="mealmenu" data-meal="${id}" aria-label="${name} options">${icon.dots}</button>` : ''}
        <button class="icon" data-act="add" data-meal="${id}" aria-label="Add to ${name.toLowerCase()}">${icon.plus}</button>
      </header>
      ${list.length ? `<ul>${list.map(e => `<li><button class="entry" data-act="edit" data-id="${e.id}">
          <span class="en">${esc(e.name)}<small>${esc(e.foodId ? L.amountText(e) : 'Quick add')}${e.p >= 1 ? ` · ${fmt(e.p)} g protein` : ''}</small></span>
          <span class="ek">${fmt(e.kcal)}</span></button></li>`).join('')}</ul>`
        : yest.length ? `<button class="repeat" data-act="repeat" data-meal="${id}">Same as ${L.diffDays(ui.today, prevKey) === -1 ? 'yesterday' : dateTxt(prevKey)}<span>${esc(yest.map(e => e.name).slice(0, 3).join(', '))}${yest.length > 3 ? '…' : ''} · ${fmt(L.sum(yest).kcal)} kcal</span></button>` : ''}
    </section>`;
  }).join('');

  const isToday = key === ui.today, future = key > ui.today;
  const sug = isToday && entries.length ? L.suggest(suggestPool(), left, plan.protein - t.p).slice(0, 4) : [];
  const streak = L.streak(state, ui.today);

  view.innerHTML = `
  <div class="daybar">
    <button class="icon" data-act="day" data-d="-1" aria-label="Previous day">${icon.back}</button>
    <label class="dayname"><span>${dayName(key)}</span><small>${isToday ? dateTxt(key, true) : streakLine(streak)}</small>
      <input type="date" id="daypick" value="${key}" max="${ui.today}" aria-label="Pick a day"></label>
    <button class="icon" data-act="day" data-d="1" aria-label="Next day" ${key >= ui.today ? 'disabled' : ''}>${icon.next}</button>
  </div>
  ${isToday && streak > 1 ? `<p class="streak">${streak} days logged in a row</p>` : ''}
  <section class="label" aria-label="Calories">
    <div class="lt"><h1>${left >= 0 ? 'Calories left' : 'Over budget'}</h1>${flexDay ? '<span class="tag">Flex day</span>' : ''}</div>
    <div class="rule-xl"></div>
    <div class="lbig"><span class="num${left < 0 ? ' over' : ''}">${fmt(Math.abs(left))}</span><span class="of">of ${fmt(budget)} kcal</span></div>
    <div class="meter${left < 0 ? ' over' : ''}"><i style="width:${Math.min(100, t.kcal / budget * 100)}%"></i></div>
    <div class="rule-m"></div>
    <div class="lrow"><b>Eaten</b><span>${fmt(t.kcal)} kcal</span></div>
    <div class="lrow"><b>Protein</b><span>${fmt(t.p)} <small>/ ${plan.protein} g</small></span></div>
    <div class="meter thin p"><i style="width:${Math.min(100, t.p / plan.protein * 100)}%"></i></div>
    <div class="lrow sub"><span>Carbs ${fmt(t.c)} g</span><span>Fat ${fmt(t.f)} g</span></div>
  </section>
  ${future ? '' : w != null ? `
  <section class="weigh done">
    <div><span class="wl">Weight</span> <b>${wTxt(w)}</b>${trend ? `<span class="wt">trend ${wTxt(trend, false)}${lastW ? ` · ${signed(w - lastW.lb)} vs ${dateTxt(lastW.day)}` : ''}</span>` : ''}</div>
    <button class="link" data-act="weightsheet" data-day="${key}">Edit</button>
  </section>` : `
  <section class="weigh">
    <label for="wIn">${isToday ? 'Morning weight' : 'Weight that day'}</label>
    <div class="wfield"><input id="wIn" type="text" inputmode="decimal" autocomplete="off" placeholder="${lastW ? wTxt(lastW.lb, false) : ''}"><span>${wUnit()}</span></div>
    <button class="btn sm" data-act="saveweight">Save</button>
  </section>`}
  ${meals}
  ${sug.length ? `<section class="ideas"><h2>Fits what's left${plan.protein - t.p > 15 ? ', high protein' : ''}</h2>
    <div class="chips">${sug.map(s => `<button class="idea" data-act="pickfood" data-id="${esc(s.food.id)}"><b>${esc(s.food.name)}</b><span>${esc(L.amountText(s.a))} · ${fmt(s.n.kcal)} kcal · ${fmt(s.n.p)} g P</span></button>`).join('')}</div></section>` : ''}
  ${isToday ? tipCard() : ''}
  ${backupNag()}`;
}
const streakLine = s => s ? `${s}-day streak` : 'Not logged';

// Your own regulars first, plus a few easy high-protein staples.
const STAPLES = ['Kvarg (quark), plain', 'Greek yogurt, plain, nonfat', 'Cottage cheese, 2%', 'Egg', 'Tuna, canned in water, drained', 'Chicken breast, cooked', 'Whey protein powder', 'Protein bar', 'Apple', 'Banana', 'Turkey, deli sliced', 'Edamame'];
function suggestPool() {
  const mine = Object.keys(state.usage).map(foodById).filter(Boolean);
  const ids = new Set(mine.map(f => f.id));
  return [...mine, ...DB.filter(f => STAPLES.includes(f.name) && !ids.has(f.id)).map(withUsage)];
}

// ---------- tips ----------
const TIPS = [
  { h: 'Getting the numbers right', items: [
    ['Weigh in every morning', 'Same scale, after the bathroom, before eating or drinking. One day can swing 1–2 kg from salt, carbs and water, so only the trend line matters.'],
    ['Log before you eat, not at night', 'Ten seconds while the food is in front of you beats rebuilding the day from memory. Missed meals are the main reason logs run low.'],
    ['Use a kitchen scale for a week', 'Eyeballed peanut butter, oil, rice and cereal usually come out 30–50% bigger than you think. A week of weighing calibrates your eye for good.'],
    ['Cooking oil counts', 'A tablespoon is about 120 kcal and almost never gets logged. Same for butter on toast and dressing on salad.'],
    ['Restaurant food runs high', 'Kitchens use more butter, oil and sugar than home cooking. Log the closest match and add about 20%.'],
  ] },
  { h: 'Staying full', items: [
    ['Protein at every meal', 'It fills you up the most and keeps your muscle while you lose. Around 30–40 g a meal gets you to your target without thinking about it.', 'protein'],
    ['Eat big plates of cheap food', 'Vegetables, fruit, soup, potatoes, kvarg and popcorn are a lot of food for few calories. Bulk out meals with them before cutting portions.'],
    ['Drink water, not calories', 'Soda, juice, lattes and alcohol add up without filling you up. Zero sodas and black coffee are the easiest swap there is.'],
    ['Keep easy protein around', 'Kvarg, cottage cheese, eggs, tuna, rotisserie chicken and protein bars. When hunger hits, the easy option should also be the good one.'],
    ['Don\'t arrive at dinner starving', 'Skipping meals is fine if it works for you, but if you overeat at night, move some calories earlier in the day.'],
  ] },
  { h: 'Weekends, eating out, drinking', items: [
    ['Plan it, don\'t make up for it', 'Flex days (Plan tab) move calories from weekdays to the weekend so a night out fits without blowing the week.', 'weekend'],
    ['Log the big meal first', 'Going out tonight? Log your best guess at lunch, then fit the rest of the day around what\'s left.'],
    ['Alcohol is sneaky', 'A beer or glass of wine is 130–200 kcal, and drinking makes late-night food a lot more likely. Spirits with a zero mixer are the cheapest.'],
    ['One big day doesn\'t undo a week', 'Log it honestly and carry on as normal. The weekly average moves the scale, not any one day.'],
  ] },
  { h: 'When progress stalls', items: [
    ['Give it two to three weeks', 'Water can hide fat loss for a week or two and then drop off all at once. Judge the trend over weeks, not days.', 'stall'],
    ['Check the logging first', 'Weigh portions again for a few days and look for unlogged oil, sauces, drinks and bites while cooking.'],
    ['Use your measured maintenance', 'After 3–4 weeks of logging and weighing, the Progress tab works out what you really burn. It beats any formula.'],
    ['Walk more', 'Steps are the easiest lever. 3,000 extra steps a day burns about 100–150 kcal, and it barely makes you hungrier.'],
    ['Take a diet break', 'After 8–12 weeks of dieting, a week or two at maintenance helps with hunger and motivation without losing progress.'],
  ] },
  { h: 'Training and recovery', items: [
    ['Keep training hard', 'Strength work (climbing counts) tells your body to keep muscle, so more of what you lose is fat. Eat some carbs 2–3 hours before a session.'],
    ['Don\'t eat back exercise calories', 'Your activity level already counts your workouts, and watches overestimate burns, often by a lot.'],
    ['Sleep 7–9 hours', 'Short sleep makes you hungrier the next day and shifts more of the loss toward muscle.'],
  ] },
];
const ALL_TIPS = TIPS.flatMap(g => g.items);
function tipCard() {
  const plan = state.plan, last7 = [...Array(7)].map((_, i) => L.addDays(ui.today, -1 - i)).filter(k => L.logged(state, k));
  const avgP = last7.length ? last7.reduce((a, k) => a + L.dayTotal(state, k).p, 0) / last7.length : null;
  const lastW = Object.keys(state.weights).sort().pop();
  let tip;
  if (!lastW || L.diffDays(lastW, ui.today) >= 3) tip = ALL_TIPS[0];
  else if (last7.length >= 4 && avgP < plan.protein * 0.8) tip = ALL_TIPS.find(t => t[2] === 'protein');
  else {
    const wk = last7.filter(k => [0, 6].includes(L.weekday(k)));
    const overWeekend = wk.some(k => L.dayTotal(state, k).kcal > L.budget(plan, k) + 400);
    tip = overWeekend && !(plan.flex || []).length ? ALL_TIPS.find(t => t[2] === 'weekend') : ALL_TIPS[L.diffDays('2026-01-01', ui.today) % ALL_TIPS.length];
  }
  return `<aside class="tip"><span class="tk">Tip</span><b>${esc(tip[0])}</b><p>${esc(tip[1])}</p><a href="#plan">More tips</a></aside>`;
}
function backupNag() {
  if (sync) return stuck() ? `<p class="nag">Sync is paused: ${syncRun.err === 'auth' ? 'the token stopped working' : 'the gist was deleted on GitHub'}. <button class="link" data-act="syncsheet">Fix it</button></p>` : '';
  const n = Object.keys(state.days).length;
  if (n < 14 || (state.backupAt && Date.now() - state.backupAt < 30 * 864e5)) return '';
  return `<p class="nag">Your log only lives on this device. <button class="link" data-act="syncsheet">Turn on sync</button> or <button class="link" data-act="export">back it up</button>.</p>`;
}

// ======================================================================
// Sheet (bottom panel): add food, amounts, quick add, create food, scan, menus
// ======================================================================
const sheetEl = $('#sheet'), sheetBody = $('#sheet-body');
let sh = null; // current sheet state
function openSheet(s) {
  sh = s;
  renderSheet();
  if (!sheetEl.open) { sheetEl.showModal(); document.body.classList.add('locked'); }
}
function closeSheet() { stopScan(); sh = null; if (sheetEl.open) sheetEl.close(); }
sheetEl.addEventListener('close', () => { if (sheetEl.open) return; stopScan(); sh = null; document.body.classList.remove('locked'); render(); });
sheetEl.addEventListener('click', e => { if (e.target === sheetEl) closeSheet(); }); // tap the backdrop
function renderSheet() {
  sheetEl.className = ['add', 'scan'].includes(sh.mode) ? 'tall' : '';
  sheetBody.innerHTML = ({ add: sheetAdd, amount: sheetAmount, quick: sheetQuick, create: sheetCreate, scan: sheetScan, menu: sheetMenu,
    confirm: sheetConfirm, savemeal: sheetSaveMeal, meal: sheetMeal, weight: sheetWeight, food: sheetFood, sync: sheetSync, syncpick: sheetSyncPick })[sh.mode]();
  if (sh.mode === 'add') renderResults();
  const f = sheetBody.querySelector('[autofocus]');
  if (f) f.focus();
}
const sheetHead = (title, back) => `<div class="sh-head">${back ? `<button class="icon" data-act="${back}" aria-label="Back">${icon.back}</button>` : ''}<h3>${title}</h3><button class="icon" data-act="close" aria-label="Close">${icon.close}</button></div>`;
const mealSeg = (meal, act = 'setmeal') => `<div class="seg" role="radiogroup" aria-label="Meal">${L.MEALS.map(([id, n]) => `<button role="radio" aria-checked="${id === meal}" class="${id === meal ? 'on' : ''}" data-act="${act}" data-meal="${id}">${n}</button>`).join('')}</div>`;

// ---- add: search, recents, saved, meals ----
function openAdd(meal) {
  const hour = new Date().getHours();
  openSheet({ mode: 'add', meal: meal || L.mealFor(hour), q: '', list: 'recent', added: [], off: { q: '', status: 'idle', results: [] } });
}
function sheetAdd() {
  const n = sh.added.length;
  return `<div class="sh-head"><h3>Add to ${dayName(ui.day).toLowerCase() === 'today' ? 'today' : dayName(ui.day)}</h3>
      ${n ? `<button class="btn sm" data-act="close">Done</button>` : `<button class="icon" data-act="close" aria-label="Close">${icon.close}</button>`}</div>
    ${mealSeg(sh.meal)}
    <div class="searchrow">
      <label class="search">${icon.search}<input id="q" type="search" placeholder="Search foods" value="${esc(sh.q)}" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search"></label>
      <button class="icon boxed" data-act="scan" aria-label="Scan a barcode">${icon.scan}</button>
    </div>
    ${n ? `<p class="added">${plural(n, 'item')} added · ${fmt(L.sum(sh.added).kcal)} kcal</p>` : ''}
    <div id="results" class="results"></div>`;
}
function renderResults() {
  const box = $('#results');
  if (!box) return;
  const q = sh.q.trim();
  if (!q) {
    const tabs = [['recent', 'Recent'], ['saved', 'Saved'], ['meals', 'Meals']];
    let rows = '';
    if (sh.list === 'recent') {
      const now = Date.now();
      const rec = Object.entries(state.usage).filter(([, u]) => u.at).map(([id, u]) => ({ f: foodById(id), u })).filter(r => r.f)
        .map(r => ({ ...r, s: ((r.u.m || {})[sh.meal] || 0) * 2 + Math.min(r.u.uses, 20) * 0.3 + Math.max(0, 7 - (now - r.u.at) / 864e5) }))
        .sort((a, b) => b.s - a.s).slice(0, 30);
      rows = rec.length ? rec.map(r => foodRow(r.f)).join('') : `<p class="empty">Foods you log show up here with the amount you had last time, so repeats are one tap.<br>Search below, or try a few: ${['Banana', 'Egg', 'Greek yogurt, plain, nonfat', 'Oats, rolled, dry'].map(n => DB.find(f => f.name === n)).map(f => `<button class="link" data-act="pickfood" data-id="${f.id}">${esc(f.name.split(',')[0])}</button>`).join(', ')}.</p>`;
    } else if (sh.list === 'saved') {
      const saved = savedFoods();
      rows = saved.length ? saved.map(foodRow).join('') : '<p class="empty">Star a food to keep it here. Foods you create and scan are saved automatically.</p>';
    } else {
      rows = state.meals.length ? state.meals.map(m => `<div class="row"><button class="rmain" data-act="logmeal" data-id="${m.id}"><span class="rn">${esc(m.name)}</span><small>${esc(m.items.map(i => i.name).join(', '))}</small></button><span class="rk">${fmt(L.sum(m.items).kcal)}</span><button class="icon qa" data-act="logmeal" data-id="${m.id}" aria-label="Add ${esc(m.name)}">${icon.plus}</button></div>`).join('')
        : '<p class="empty">Meals are groups of foods you eat together. Log one once, then tap ··· on it in Today and choose Save as meal.</p>';
    }
    box.innerHTML = `<div class="tabs2">${tabs.map(([id, n]) => `<button class="${sh.list === id ? 'on' : ''}" data-act="list" data-v="${id}">${n}</button>`).join('')}</div>
      <div class="actions2"><button data-act="quick">${icon.bolt}Quick add calories</button><button data-act="create">${icon.pen}Create a food</button></div>
      <div class="rows">${rows}</div>`;
    return;
  }
  const local = L.search(allFoods(), q, 30);
  const o = sh.off;
  const seen = new Set(local.map(f => f.id));
  const online = o.q === q ? o.results.filter(f => !seen.has(f.id)) : [];
  box.innerHTML = `<div class="rows">${local.map(foodRow).join('') || `<p class="empty">Nothing in your list matches “${esc(q)}”.</p>`}</div>
    <h4 class="srch">Open Food Facts${o.q === q && o.status === 'loading' ? '<span class="spin"></span>' : ''}</h4>
    <div class="rows">${online.map(foodRow).join('')}
      ${o.q === q && o.status === 'done' && !online.length ? '<p class="empty">No packaged products found. Try the brand name, or scan the barcode.</p>' : ''}
      ${o.q === q && o.status === 'error' ? `<p class="empty">${navigator.onLine ? 'Open Food Facts didn\'t answer.' : 'You\'re offline.'} <button class="link" data-act="retryoff">Try again</button></p>` : ''}
      ${q.length < 3 ? '<p class="empty">Keep typing to search packaged foods.</p>' : ''}</div>
    <div class="actions2"><button data-act="quick">${icon.bolt}Quick add calories</button><button data-act="create">${icon.pen}Create “${esc(q.slice(0, 24))}”</button></div>`;
}
function foodRow(f) {
  const a = L.defaultAmount(f), n = L.of(f, a.qty * a.g);
  return `<div class="row"><button class="rmain" data-act="pickfood" data-id="${esc(f.id)}"><span class="rn">${esc(f.name)}${f.star ? ' <i class="st" aria-label="saved">★</i>' : ''}</span>
    <small>${f.brand ? esc(f.brand) + ' · ' : ''}${esc(L.amountText(a))}${n.p >= 1 ? ` · ${fmt(n.p)} g P` : ''}</small></button>
    <span class="rk">${fmt(n.kcal)}</span><button class="icon qa" data-act="quickfood" data-id="${esc(f.id)}" aria-label="Add ${esc(f.name)}, ${esc(L.amountText(a))}">${icon.plus}</button></div>`;
}
const savedFoods = () => allFoods().filter(f => f.star || f.src === 'custom' || f.src === 'off').sort((a, b) => a.name.localeCompare(b.name));
const offCache = new Map(); // looked-up products this session, so tapping a search result finds them
let offTimer, offCtl;
function searchOFF(q) {
  clearTimeout(offTimer);
  if (offCtl) offCtl.abort();
  if (q.length < 3) { sh.off = { q, status: 'idle', results: [] }; return; }
  sh.off = { q, status: 'loading', results: [] };
  offTimer = setTimeout(async () => {
    const ctl = offCtl = new AbortController(), live = () => ctl === offCtl && sh && sh.mode === 'add' && sh.off.q === q;
    const kill = setTimeout(() => ctl.abort(), 9000);
    try {
      const r = await fetch(`${OFF}/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=30&fields=${OFF_FIELDS}`, { signal: ctl.signal });
      if (!r.ok) throw new Error(r.status);
      const data = await r.json(), seen = new Set();
      const results = (data.products || []).map(L.fromOFF).filter(f => f && !seen.has(f.name + f.brand) && seen.add(f.name + f.brand)).slice(0, 15);
      results.forEach(f => offCache.set(f.id, f));
      if (live()) { sh.off = { q, status: 'done', results: results.map(withUsage) }; renderResults(); }
    } catch {
      if (live()) { sh.off.status = 'error'; renderResults(); }
    } finally { clearTimeout(kill); }
  }, 450);
}
const anyFood = id => foodById(id) || withUsage(offCache.get(id));

// ---- amount: pick how much of a food (new entry or editing one) ----
function openAmount(f, opts = {}) {
  const a = opts.entry ? { qty: opts.entry.qty, g: opts.entry.g, label: opts.entry.label } : L.defaultAmount(f);
  // From the scanner, Back returns to the search it came from.
  openSheet({ mode: 'amount', f, a: { ...a }, back: sh && sh.mode === 'add' ? sh : (sh && sh.back) || null, meal: opts.entry ? opts.entry.meal : (sh && sh.meal) || L.mealFor(new Date().getHours()), entry: opts.entry || null });
}
function unitOptions(f) {
  const base = f.ml ? 'ml' : 'g';
  return [...f.servings.map(s => ({ label: s.label, g: s.g })), { label: base, g: 1 }];
}
function sheetAmount() {
  const { f, a, entry } = sh;
  const n = L.of(f, a.qty * a.g), opts = unitOptions(f);
  const step = a.g === 1 ? (a.qty >= 100 ? 10 : 5) : a.qty < 1 ? 0.25 : 0.5;
  const canStar = f.src !== 'gone';
  return `${sheetHead(entry ? 'Edit' : 'How much?', sh.back ? 'backadd' : null)}
    <div class="food-h"><h2>${esc(f.name)}</h2>${canStar ? `<button class="star${f.star ? ' on' : ''}" data-act="star" aria-pressed="${!!f.star}">${icon.star}<span>${f.star ? 'Saved' : 'Save'}</span></button>` : ''}</div>
    <p class="src">${f.brand ? esc(f.brand) + ' · ' : ''}${{ db: 'Built-in list', off: 'Open Food Facts', custom: 'Your food' }[f.src] || ''} · ${fmt(f.k)} kcal per 100 ${f.ml ? 'ml' : 'g'}</p>
    <div class="units" role="radiogroup" aria-label="Unit">${opts.map((o, i) => `<button role="radio" aria-checked="${o.label === a.label}" class="${o.label === a.label ? 'on' : ''}" data-act="unit" data-i="${i}">${esc(o.label)}${o.g !== 1 ? ` <small>${r1(o.g)} ${f.ml ? 'ml' : 'g'}</small>` : ''}</button>`).join('')}</div>
    <div class="qty">
      <button class="icon boxed" data-act="qty" data-d="-${step}" aria-label="Less">${icon.minus}</button>
      <input id="qtyIn" type="text" inputmode="decimal" value="${L.trim(a.qty)}" aria-label="Amount">
      <span class="qu">${a.g === 1 ? esc(a.label) : '× ' + esc(a.label)}</span>
      <button class="icon boxed" data-act="qty" data-d="${step}" aria-label="More">${icon.plus}</button>
    </div>
    ${a.g !== 1 ? `<div class="fracs">${[0.5, 1, 1.5, 2].map(q => `<button data-act="setqty" data-v="${q}" class="${a.qty === q ? 'on' : ''}">${L.frac(q)}</button>`).join('')}</div>` : ''}
    <div class="facts" id="facts">${factsHTML(n)}</div>
    ${mealSeg(sh.meal, 'amealset')}
    <div class="sh-actions">
      ${entry ? `<button class="btn ghost danger" data-act="delentry">Delete</button>` : ''}
      <button class="btn wide" data-act="${entry ? 'saveentry' : 'addfood'}" ${a.qty > 0 ? '' : 'disabled'}>${entry ? 'Save' : `Add to ${L.MEALS.find(m => m[0] === sh.meal)[1].toLowerCase()}`}</button>
    </div>`;
}
const factsHTML = n => `<div><b>${fmt(n.kcal)}</b><span>kcal</span></div><div><b>${r1(n.p)}</b><span>protein</span></div><div><b>${r1(n.c)}</b><span>carbs</span></div><div><b>${r1(n.f)}</b><span>fat</span></div>`;
function updateFacts() {
  const n = L.of(sh.f, sh.a.qty * sh.a.g);
  $('#facts').innerHTML = factsHTML(n);
  const btn = sheetBody.querySelector('[data-act="addfood"],[data-act="saveentry"]');
  if (btn) btn.disabled = !(sh.a.qty > 0);
  sheetBody.querySelectorAll('.fracs button').forEach(b => b.classList.toggle('on', +b.dataset.v === sh.a.qty));
}

// ---- quick add ----
function sheetQuick() {
  const e = sh.entry;
  return `${sheetHead(e ? 'Edit quick add' : 'Quick add', sh.back ? 'backadd' : null)}
    ${e ? '' : '<p class="hint">For meals out or anything you\'d rather not look up. A rough number beats skipping it.</p>'}
    <div class="form">
      <label class="f wide"><span>Calories</span><input id="qk" type="text" inputmode="numeric" autofocus placeholder="0" value="${e ? e.kcal : ''}"></label>
      <label class="f"><span>Protein g <i>optional</i></span><input id="qp" type="text" inputmode="decimal" value="${e && e.p ? e.p : ''}"></label>
      <label class="f"><span>Label <i>optional</i></span><input id="qn" type="text" placeholder="Dinner out" maxlength="60" value="${e && e.name !== 'Quick add' ? esc(e.name) : ''}"></label>
    </div>
    ${mealSeg(sh.meal)}
    <div class="sh-actions">${e ? '<button class="btn ghost danger" data-act="delentry">Delete</button>' : ''}<button class="btn wide" data-act="savequick">${e ? 'Save' : 'Add'}</button></div>`;
}

// ---- create / edit a food ----
function sheetCreate() {
  const f = sh.edit || {}, per = sh.per || (f.servings && f.servings[0] ? 'serving' : f.id ? '100' : 'serving');
  sh.per = per;
  const s = f.servings && f.servings[0];
  const scale = per === 'serving' && s ? s.g / 100 : 1;
  const v = k => f[k] != null ? r1(f[k] * scale) : '';
  return `${sheetHead(f.id ? 'Edit food' : 'Create a food', sh.back ? 'backadd' : null)}
    ${sh.note ? `<p class="hint">${esc(sh.note)}</p>` : ''}
    <div class="form">
      <label class="f wide"><span>Name</span><input id="cn" type="text" value="${esc(f.name || sh.q || '')}" maxlength="80" ${f.id ? '' : 'autofocus'}></label>
      <label class="f wide"><span>Brand <i>optional</i></span><input id="cb" type="text" value="${esc(f.brand || '')}" maxlength="60"></label>
      <div class="f wide"><span>Nutrition is listed per</span>
        <div class="seg two"><button class="${per === 'serving' ? 'on' : ''}" data-act="per" data-v="serving">Serving</button><button class="${per === '100' ? 'on' : ''}" data-act="per" data-v="100">100 g or ml</button></div></div>
      ${per === 'serving' ? `
      <label class="f"><span>Serving name</span><input id="csl" type="text" value="${esc(s ? s.label : '1 serving')}" maxlength="40"></label>
      <label class="f"><span>Serving size, g</span><input id="csg" type="text" inputmode="decimal" value="${s ? r1(s.g) : ''}" placeholder="e.g. 40"></label>` : ''}
      <label class="f"><span>Calories</span><input id="ck" type="text" inputmode="decimal" value="${v('k')}"></label>
      <label class="f"><span>Protein g</span><input id="cp" type="text" inputmode="decimal" value="${v('p')}"></label>
      <label class="f"><span>Carbs g</span><input id="cc" type="text" inputmode="decimal" value="${v('c')}"></label>
      <label class="f"><span>Fat g</span><input id="cf" type="text" inputmode="decimal" value="${v('f')}"></label>
      <label class="f wide chk"><input id="cml" type="checkbox" ${f.ml ? 'checked' : ''}> It's a drink (measured in ml)</label>
    </div>
    <p class="err" id="cerr" hidden></p>
    <div class="sh-actions">${f.id ? `<button class="btn ghost danger" data-act="delfood">Delete</button>` : ''}<button class="btn wide" data-act="savefood">${f.id ? 'Save' : 'Save and continue'}</button></div>`;
}
function readCreate() {
  const val = id => { const el = $('#' + id); return el ? el.value.trim() : ''; };
  const name = val('cn'), per = sh.per;
  const k = num(val('ck')), p = num(val('cp')) || 0, c = num(val('cc')) || 0, fa = num(val('cf')) || 0;
  let g = 100, label = '';
  if (per === 'serving') { g = num(val('csg')); label = val('csl') || '1 serving'; }
  if (!name) return 'Give it a name.';
  if (!(k >= 0)) return 'Enter the calories.';
  if (per === 'serving' && !(g > 0)) return 'Enter the serving size in grams (it\'s on the label, often in brackets).';
  const m = 100 / g;
  if (k * m > 950) return 'That\'s more than 950 kcal per 100 g. Check the serving size.';
  if (p + c + fa > g * 1.05) return 'Protein, carbs and fat add up to more than the serving weighs. Check the numbers.';
  const old = sh.edit || {};
  const servings = per === 'serving' ? [{ label, g }, ...(old.servings || []).slice(1)] : (old.servings || []);
  return { ...old, id: old.id || 'my:' + uid(), src: old.src || 'custom', name, brand: val('cb'), ml: $('#cml').checked, alc: false,
    k: r1(k * m), p: r1(p * m), c: r1(c * m), f: r1(fa * m), servings, code: old.code || sh.code || undefined };
}

// ---- barcode scan ----
let scanStream = null, scanLoop = null;
function sheetScan() {
  if (sh.qr) return `${sheetHead('Scan the sync code', 'syncback')}
    <div class="cam"><video id="cam" playsinline muted autoplay></video><div class="frame sq"></div></div>
    <p class="hint" id="scanmsg">${esc(sh.msg || 'Starting camera…')}</p>`;
  return `${sheetHead('Scan a barcode', 'backadd')}
    <div class="cam"><video id="cam" playsinline muted autoplay></video><div class="frame"></div></div>
    <p class="hint" id="scanmsg">${esc(sh.msg || 'Starting camera…')}</p>
    <div class="searchrow"><label class="search"><input id="code" type="text" inputmode="numeric" placeholder="Or type the barcode number" autocomplete="off"></label><button class="btn sm" data-act="lookup">Look up</button></div>`;
}
async function startScan() {
  const msg = t => { const m = $('#scanmsg'); if (m) m.textContent = t; };
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('nocam');
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    if (!sh || sh.mode !== 'scan') return stopScan();
    const video = $('#cam');
    video.srcObject = scanStream;
    await video.play().catch(() => {});
    const qr = sh.qr;
    msg(qr ? 'On your other device, open Plan, then Sync, and point the camera at the code.' : 'Point at the barcode. It reads on its own.');
    const det = await detector(qr ? ['qr_code'] : FORMATS);
    const tick = async () => {
      if (!scanStream || !sh || sh.mode !== 'scan') return;
      try {
        if (video.readyState >= 2) {
          const codes = await det.detect(video);
          const code = codes.find(c => qr ? c.rawValue.startsWith('tally-sync:') : /^\d{8,14}$/.test(c.rawValue));
          if (code) {
            navigator.vibrate?.(40); stopScan();
            if (!qr) return lookupCode(code.rawValue);
            openSheet({ mode: 'sync', token: code.rawValue }); return act.syncconnect();
          }
        }
      } catch { /* a bad frame; keep going */ }
      scanLoop = setTimeout(tick, 180);
    };
    tick();
  } catch (e) {
    stopScan();
    const qr = sh && sh.qr;
    msg(e.name === 'NotAllowedError' ? `Camera access is off. Allow it in Settings, or ${qr ? 'go back and paste the code' : 'type the number below'}.` : qr ? 'No camera here. Go back and paste the code or a token instead.' : 'No camera available. Type the barcode number below.');
  }
}
function stopScan() {
  clearTimeout(scanLoop); scanLoop = null;
  if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; }
}
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
async function detector(formats) {
  if ('BarcodeDetector' in window) {
    try { const ok = await BarcodeDetector.getSupportedFormats(); if (ok.includes(formats[0])) return new BarcodeDetector({ formats }); } catch { /* fall through */ }
  }
  const m = await import('./vendor/ponyfill.js'); // zxing in WebAssembly, for Safari
  return new m.BarcodeDetector({ formats });
}
async function lookupCode(code) {
  code = String(code).replace(/\D/g, '');
  if (code.length < 8) return toast('That doesn\'t look like a barcode.');
  const mine = allFoods().find(f => f.code === code || f.code === code.replace(/^0/, ''));
  if (mine) return openAmount(mine);
  const back = sh && sh.back;
  sh.msg = 'Looking it up…'; renderSheet();
  try {
    const r = await fetch(`${OFF}/api/v2/product/${code}?fields=${OFF_FIELDS}`);
    const data = r.ok || r.status === 404 ? await r.json() : null;
    if (!data) throw new Error('http');
    const f = data.status === 1 && data.product ? L.fromOFF({ ...data.product, code }) : null;
    if (f) { offCache.set(f.id, f); return openAmount(withUsage(f)); }
    openSheet({ mode: 'create', back, meal: back ? back.meal : 'snacks', code, q: data.product?.product_name || '',
      note: data.status === 1 ? 'Found the product, but its nutrition info is missing or doesn\'t add up. Copy it from the label once and it\'s saved for next time.' : 'This barcode isn\'t in Open Food Facts yet. Copy the label once and it\'s saved for next time you scan it.' });
  } catch {
    sh.msg = navigator.onLine ? 'Couldn\'t reach Open Food Facts. Try again in a moment.' : 'You\'re offline. Barcode lookup needs a connection.';
    renderSheet();
  }
}

// ---- menus, confirm, meals, weight ----
function sheetMenu() {
  const list = entriesOf(ui.day).filter(e => e.meal === sh.meal), name = L.MEALS.find(m => m[0] === sh.meal)[1];
  return `${sheetHead(name)}
    <p class="hint">${plural(list.length, 'item')} · ${fmt(L.sum(list).kcal)} kcal · ${fmt(L.sum(list).p)} g protein</p>
    <div class="menu">
      <button data-act="savemeal">Save as a meal<small>Log all of it in one tap next time</small></button>
      ${ui.day !== ui.today ? `<button data-act="copytoday">Copy to today<small>Adds these to today's ${name.toLowerCase()}</small></button>` : ''}
      <button data-act="clearmeal" class="danger">Clear ${name.toLowerCase()}<small>Removes ${list.length === 1 ? 'the item' : `all ${list.length} items`} (you can undo)</small></button>
    </div>`;
}
function sheetConfirm() {
  return `${sheetHead(esc(sh.title))}<p class="hint">${sh.text}</p>
    <div class="sh-actions"><button class="btn ghost" data-act="close">Cancel</button><button class="btn wide${sh.danger ? ' dangerbg' : ''}" data-act="yes">${esc(sh.yes)}</button></div>`;
}
function sheetSync() {
  if (sh.c) return sheetSyncPick();
  if (sync) {
    let qr = '';
    try { const q = qrcode(0, 'M'); q.addData(`tally-sync:${sync.token}:${sync.gist}`); q.make(); qr = q.createSvgTag({ cellSize: 4, margin: 3, scalable: true }); } catch { /* QR script didn't load (offline) */ }
    return `${sheetHead('Sync')}
      <div class="syncnow"><p><b>Connected${sync.login ? ` as ${esc(sync.login)}` : ''}</b><span class="syncstat${stuck() ? ' bad' : ''}">${esc(syncLine())}</span></p><button class="btn sm ghost" data-act="syncgo">Sync now</button></div>
      ${syncRun.err === 'auth' ? `<p class="warn">Make a new token (<a class="link" href="${TOKEN_URL}" target="_blank" rel="noopener">on GitHub</a>, Expiration: No expiration), then disconnect and connect with it. Nothing is lost.</p>` : ''}
      ${syncRun.err === 'gone' ? '<p class="warn">Disconnect, then connect again to start a new gist from what\'s on this device.</p>' : ''}
      <h4 class="ssub">Add another device</h4>
      ${qr ? `<div class="qr">${qr}</div><p class="hint">On the other device, open Tally and tap <b>Set up</b> next to Sync in Plan (or <b>Sync it here</b> on the first screen). Then tap <b>Scan a code</b> and point it at this one.</p>` : ''}
      <p class="hint">No camera there? <button class="link" data-act="synccopy">Copy the code</button> and paste it into the token box instead.</p>
      <p class="fine">The code contains your sync token. Only show it to your own devices.</p>
      <div class="sh-actions"><button class="btn ghost danger wide" data-act="syncoff">Disconnect this device</button></div>`;
  }
  return `${sheetHead('Sync', sh.back ? 'syncback' : null)}
    <p class="hint">Keeps your phone and computer in step. Your data is saved to a private gist on your own GitHub account, and every device merges in changes a few seconds after they're made.</p>
    <ol class="steps">
      <li><span><a class="link" href="${TOKEN_URL}" target="_blank" rel="noopener">Make a sync token on GitHub</a>. Set <b>Expiration</b> to <b>No expiration</b>, leave only <b>gist</b> ticked, then <b>Generate token</b> and copy it.</span></li>
      <li><span>Paste it here and connect.</span></li>
    </ol>
    <div class="form"><label class="f wide"><span>Token or sync code</span><input id="stoken" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="ghp_…" value="${esc(sh.token || '')}"></label></div>
    ${sh.err ? `<p class="warn">${esc(sh.err)}</p>` : ''}
    <div class="sh-actions"><button class="btn ghost" data-act="syncscan">Scan a code</button><button class="btn wide" data-act="syncconnect" ${sh.busy ? 'disabled' : ''}>${sh.busy ? 'Connecting…' : 'Connect'}</button></div>
    <p class="fine">Already syncing on another device? Scan the code it shows under Plan, Sync. Or make a second token the same way: it finds the same data.</p>`;
}
function sheetSyncPick() {
  const r = sh.c.remote, n = o => plural(Object.keys(o.days || {}).length, 'logged day');
  return `${sheetHead('Both devices have data')}
    <p class="hint">The synced copy has ${n(r)}. This device has ${n(state)}.</p>
    <div class="choices">
      <button class="choice" data-act="syncpick" data-v="merge"><b>Combine them</b><span class="pd">Keeps every log and weigh-in from both. Where both changed the same thing, the newer change wins.</span></button>
      <button class="choice" data-act="syncpick" data-v="replace"><b>Use the synced copy</b><span class="pd">Replaces what's on this device. Pick this if this device was only a test.</span></button>
    </div>`;
}
function sheetSaveMeal() {
  return `${sheetHead('Save as a meal')}
    <div class="form"><label class="f wide"><span>Name</span><input id="mname" type="text" maxlength="50" value="${esc(sh.name)}" autofocus></label></div>
    <p class="hint">${esc(sh.items.map(i => i.name).join(', '))} · ${fmt(L.sum(sh.items).kcal)} kcal</p>
    <div class="sh-actions"><button class="btn wide" data-act="dosavemeal">Save meal</button></div>`;
}
function sheetMeal() {
  const m = state.meals.find(x => x.id === sh.id);
  return `${sheetHead('Meal')}
    <div class="form"><label class="f wide"><span>Name</span><input id="mname" type="text" maxlength="50" value="${esc(m.name)}"></label></div>
    <ul class="mitems">${m.items.map((i, n) => `<li><span>${esc(i.name)}<small>${esc(i.foodId ? L.amountText(i) : 'Quick add')}</small></span><b>${fmt(i.kcal)}</b><button class="icon" data-act="mitemdel" data-i="${n}" aria-label="Remove ${esc(i.name)}">${icon.close}</button></li>`).join('')}</ul>
    <p class="hint">Total ${fmt(L.sum(m.items).kcal)} kcal · ${fmt(L.sum(m.items).p)} g protein</p>
    <div class="sh-actions"><button class="btn ghost danger" data-act="mealdel">Delete</button><button class="btn wide" data-act="mealsave">Save</button></div>`;
}
function sheetWeight() {
  const w = state.weights[sh.day];
  return `${sheetHead(sh.isNew ? 'Add a weigh-in' : 'Weigh-in')}
    <div class="form">
      ${sh.isNew ? `<label class="f"><span>Date</span><input id="wd" type="date" value="${sh.day}" max="${ui.today}"></label>` : `<p class="hint wide">${dayName(sh.day)}${L.diffDays(ui.today, sh.day) > -2 ? ', ' + dateTxt(sh.day) : ''}</p>`}
      <label class="f"><span>Weight, ${wUnit()}</span><input id="wv" type="text" inputmode="decimal" value="${w != null ? wVal(w).toFixed(1) : ''}" autofocus></label>
    </div>
    <div class="sh-actions">${w != null && !sh.isNew ? '<button class="btn ghost danger" data-act="wdel">Delete</button>' : ''}<button class="btn wide" data-act="wsave">Save</button></div>`;
}
function sheetFood() {
  const f = anyFood(sh.id);
  if (!f) return sheetHead('Food') + '<p class="empty">This food was deleted.</p>';
  const a = L.defaultAmount(f), n = L.of(f, a.qty * a.g);
  const editable = f.src === 'custom' || f.src === 'off';
  return `${sheetHead(esc(f.name))}
    <p class="src">${f.brand ? esc(f.brand) + ' · ' : ''}${{ db: 'Built-in list', off: 'Open Food Facts', custom: 'Your food' }[f.src]}${f.uses ? ` · logged ${plural(f.uses, 'time')}` : ''}</p>
    <div class="facts">${factsHTML({ kcal: f.k, p: f.p, c: f.c, f: f.f })}</div>
    <p class="hint">Per 100 ${f.ml ? 'ml' : 'g'}. ${f.servings.length ? 'Servings: ' + esc(f.servings.map(s => `${s.label} (${r1(s.g)} ${f.ml ? 'ml' : 'g'})`).join(', ')) + '.' : ''} ${esc(L.amountText(a))} is ${fmt(n.kcal)} kcal.</p>
    <div class="sh-actions">
      <button class="btn ghost" data-act="star">${f.star ? 'Unsave' : 'Save'}</button>
      ${editable ? '<button class="btn ghost" data-act="editfood">Edit</button>' : ''}
      <button class="btn wide" data-act="logfood">Log it</button>
    </div>`;
}

// ======================================================================
// Progress
// ======================================================================
function renderProgress() {
  const plan = state.plan, series = L.trend(state.weights), last = series[series.length - 1];
  const first = series[0] && series[0].day < plan.start ? series[0].day : plan.start;
  const from = ui.range && L.addDays(ui.today, -ui.range) > first ? L.addDays(ui.today, -ui.range) : first;
  const rate = L.rate(series, ui.today), trend = last ? last.trend : plan.startLb;
  const eta = L.eta(trend, plan.goalLb, rate, ui.today);
  const toGo = plan.goalLb - trend, since = trend - plan.startLb;
  const plannedNow = L.planned(plan, ui.today);
  const loggedDays = [...Array(7)].map((_, i) => L.addDays(ui.today, -1 - i)).filter(k => L.logged(state, k));
  const avg = k => loggedDays.length ? loggedDays.reduce((a, d) => a + L.dayTotal(state, d)[k], 0) / loggedDays.length : null;
  const avgBudget = loggedDays.length ? loggedDays.reduce((a, d) => a + L.budget(plan, d), 0) / loggedDays.length : plan.kcal;
  const mm = L.measuredMaintenance(state, ui.today);
  const dir = Math.sign(plan.goalLb - plan.startLb);
  const ahead = dir && series.length >= 3 ? (trend - plannedNow) * dir : null; // >0 means ahead of plan
  const ranges = [[30, '1M'], [91, '3M'], [182, '6M'], [365, '1Y'], [0, 'All']];

  view.innerHTML = `
  <header class="ph"><h1>Progress</h1></header>
  <section class="card hero">
    <div class="hl">
      <div><span class="k">Trend weight</span><b class="big">${wTxt(trend, false)}<small>${wUnit()}</small></b></div>
      <div class="right"><span class="k">${dir ? 'To go' : 'Goal'}</span><b class="mid">${dir ? (Math.abs(toGo) < 0.5 ? 'Done' : wTxt(Math.abs(toGo))) : wTxt(plan.goalLb)}</b></div>
    </div>
    <p class="sub">${series.length ? `${signed(since)} since ${dateTxt(plan.start)}` : 'No weigh-ins yet'}${ahead != null && Math.abs(ahead) >= 0.5 ? ` · ${wTxt(Math.abs(ahead))} ${ahead > 0 ? 'ahead of' : 'behind'} plan` : ahead != null ? ' · right on plan' : ''}</p>
    <div class="seg small" role="radiogroup" aria-label="Range">${ranges.map(([d, n]) => `<button role="radio" aria-checked="${ui.range === d}" class="${ui.range === d ? 'on' : ''}" data-act="range" data-v="${d}">${n}</button>`).join('')}</div>
    <div class="chart" id="wchart"></div>
    <div class="legend"><span><i class="lg-dot"></i>Scale</span><span><i class="lg-line"></i>Trend</span><span><i class="lg-plan"></i>Plan</span><span><i class="lg-goal"></i>Goal</span></div>
  </section>
  <section class="tiles">
    <div class="tile"><span class="k">Rate, last 4 weeks</span><b>${rate == null ? '–' : (rate > 0 ? '+' : rate < 0 ? '−' : '') + rateTxt(rate).replace('/week', '')}</b><small>${rate == null ? 'Needs about 2 weeks of weigh-ins' : `per week · plan ${rateTxt(plan.rate)}`}</small></div>
    <div class="tile"><span class="k">Reach goal by</span><b>${!dir ? '–' : eta ? dateTxt(eta) : '–'}</b><small>${!dir ? 'Maintaining' : eta ? `plan says ${plan.finish ? dateTxt(plan.finish) : '–'}` : rate == null ? 'Not enough data yet' : 'Trend is flat or the wrong way'}</small></div>
    <div class="tile"><span class="k">Average, last 7 days</span><b>${avg('kcal') == null ? '–' : fmt(avg('kcal'))}<small> kcal</small></b><small>${avg('kcal') == null ? 'Log a few days first' : `target ${fmt(avgBudget)} · ${plural(loggedDays.length, 'day')} logged`}</small></div>
    <div class="tile"><span class="k">Protein, last 7 days</span><b>${avg('p') == null ? '–' : fmt(avg('p'))}<small> g</small></b><small>target ${plan.protein} g a day</small></div>
  </section>
  <section class="card">
    <h2 class="ch">Calories, ${ui.range && ui.range <= 30 ? 'last 30 days' : 'weekly average'}</h2>
    <div class="chart" id="kchart"></div>
    <div class="legend"><span><i class="lg-bar"></i>Under target</span><span><i class="lg-bar over"></i>Over</span><span><i class="lg-tick"></i>Target</span></div>
  </section>
  <section class="card">
    <h2 class="ch">Your real maintenance</h2>
    ${mm.ready ? `
      <p class="mm"><b>${fmt(mm.kcal)}</b> kcal a day</p>
      <p class="hint">From the last 4 weeks: you ate ${fmt(mm.intake)} a day on average and your trend moved ${signed(mm.change)}. The setup formula guessed ${fmt(plan.maint)}.</p>
      ${Math.abs(mm.kcal - plan.maint) >= 100 ? `<button class="btn" data-act="usemm" data-v="${mm.kcal}">Use ${fmt(mm.kcal)} and update my target</button>` : '<p class="hint">That\'s close to your plan, so your target is right.</p>'}`
    : `<p class="hint">After about 3 weeks of logging and weighing in, Tally works out what you actually burn from your intake and your trend. It's usually more accurate than any formula. So far: ${plural(mm.logged, 'day')} logged and ${plural(mm.weighed, 'weigh-in')} in the last 4 weeks (needs 14 and 6).</p>`}
  </section>
  <section class="card">
    <div class="ch-row"><h2 class="ch">Weigh-ins</h2><button class="link" data-act="addweight">Add past weigh-in</button></div>
    ${series.length ? `<ul class="wlist">${series.slice(-10).reverse().map((s, i, arr) => `<li><button data-act="weightsheet" data-day="${s.day}"><span>${dateTxt(s.day, true)}</span><b>${wTxt(s.lb)}</b><small>${arr[i + 1] ? signed(s.lb - arr[i + 1].lb) : ''}</small></button></li>`).join('')}</ul>` : '<p class="hint">Log your weight on the Today tab each morning.</p>'}
  </section>`;
  drawWeight(series, from);
  drawCalories();
}

// ---------- charts (plain SVG) ----------
const charts = {};
function niceStep(span, n = 4) {
  const raw = span / n, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}
function drawWeight(series, from) {
  const el = $('#wchart'), plan = state.plan, to = ui.today;
  const W = el.clientWidth || 340, H = 210, padL = 36, padR = 10, padT = 12, padB = 24;
  const pts = series.filter(s => s.day >= from && s.day <= to);
  if (pts.length < 2) {
    el.innerHTML = `<p class="chart-empty">${series.length ? 'One weigh-in so far. ' : ''}Weigh in each morning and your trend line shows up here after a few days.</p>`;
    return;
  }
  const span = Math.max(1, L.diffDays(from, to));
  const planEnd = plan.finish && plan.finish < to ? plan.finish : to;
  const planStart = plan.start > from ? plan.start : from;
  const vals = pts.flatMap(s => [s.lb, s.trend]).concat(plan.rate ? [L.planned(plan, planStart), L.planned(plan, planEnd)] : []);
  const showGoal = Math.abs(plan.goalLb - pts[pts.length - 1].trend) < (Math.max(...vals) - Math.min(...vals)) * 2 + 6;
  if (showGoal) vals.push(plan.goalLb);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = Math.max(0.6, (hi - lo) * 0.08); lo -= pad; hi += pad;
  const dlo = wVal(lo), dhi = wVal(hi), step = niceStep(dhi - dlo);
  const x = d => padL + (W - padL - padR) * L.diffDays(from, d) / span;
  const y = lb => padT + (H - padT - padB) * (1 - (lb - lo) / (hi - lo));
  let grid = '';
  for (let v = Math.ceil(dlo / step) * step; v <= dhi; v += step) {
    const yy = y(metric() ? v * L.KG : v);
    grid += `<line x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}" class="grid"/><text x="${padL - 6}" y="${yy + 4}" class="ax" text-anchor="end">${r1(v)}</text>`;
  }
  const xl = [from, L.addDays(from, Math.round(span / 2)), to].map((d, i) => `<text x="${x(d)}" y="${H - 6}" class="ax" text-anchor="${['start', 'middle', 'end'][i]}">${dateTxt(d)}</text>`).join('');
  const line = pts.map((s, i) => `${i ? 'L' : 'M'}${x(s.day).toFixed(1)},${y(s.trend).toFixed(1)}`).join('');
  const planLine = plan.rate && planStart < planEnd ? `<path d="M${x(planStart)},${y(L.planned(plan, planStart))}L${x(planEnd)},${y(L.planned(plan, planEnd))}" class="planl"/>` : '';
  const goal = showGoal ? `<line x1="${padL}" x2="${W - padR}" y1="${y(plan.goalLb)}" y2="${y(plan.goalLb)}" class="goal"/><text x="${W - padR}" y="${y(plan.goalLb) - 5}" text-anchor="end" class="gl">Goal ${wTxt(plan.goalLb, false)}</text>` : '';
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Weight over time: trend ${wTxt(pts[pts.length - 1].trend)}">
    ${grid}${xl}${goal}${planLine}
    ${pts.map(s => `<circle cx="${x(s.day).toFixed(1)}" cy="${y(s.lb).toFixed(1)}" r="3" class="dot"/>`).join('')}
    <path d="${line}" class="trend"/>
    <g class="hover" hidden><line class="cross" y1="${padT}" y2="${H - padB}"/><circle r="5" class="hdot"/></g>
  </svg><div class="tipbox" hidden></div>`;
  charts.w = { el, pts: pts.map(s => ({ ...s, x: x(s.day), y: y(s.trend) })) };
  hover(el, charts.w.pts, p => `<b>${dateTxt(p.day, true)}</b>${wTxt(p.lb)}<span>trend ${wTxt(p.trend)}</span>`);
}
function drawCalories() {
  const el = $('#kchart'), plan = state.plan, daily = ui.range && ui.range <= 30;
  const W = el.clientWidth || 340, H = 170, padL = 36, padR = 6, padT = 10, padB = 22;
  let bars = [];
  if (daily) {
    for (let i = 29; i >= 0; i--) {
      const d = L.addDays(ui.today, -i);
      bars.push({ day: d, label: dateTxt(d, true), kcal: L.logged(state, d) ? L.dayTotal(state, d).kcal : null, target: L.budget(plan, d) });
    }
  } else {
    const weeks = Math.ceil((ui.range || Math.max(28, L.diffDays(Object.keys(state.days).sort()[0] || ui.today, ui.today) + 1)) / 7);
    for (let w = Math.min(weeks, 52) - 1; w >= 0; w--) {
      const end = L.addDays(ui.today, -7 * w), days = [...Array(7)].map((_, i) => L.addDays(end, -i)).filter(d => L.logged(state, d) && d !== ui.today);
      bars.push({ day: end, label: `Week of ${dateTxt(L.addDays(end, -6))}`, kcal: days.length ? days.reduce((a, d) => a + L.dayTotal(state, d).kcal, 0) / days.length : null,
        target: days.length ? days.reduce((a, d) => a + L.budget(plan, d), 0) / days.length : plan.kcal, n: days.length });
    }
  }
  if (!bars.some(b => b.kcal != null)) { el.innerHTML = '<p class="chart-empty">Nothing logged in this range yet.</p>'; return; }
  const max = Math.max(...bars.map(b => Math.max(b.kcal || 0, b.target))) * 1.08;
  const step = niceStep(max, 3), bw = (W - padL - padR) / bars.length, gap = Math.min(4, bw * 0.25);
  const y = v => padT + (H - padT - padB) * (1 - v / max);
  let grid = '';
  for (let v = 0; v <= max; v += step) grid += `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${padL - 6}" y="${y(v) + 4}" class="ax" text-anchor="end">${v >= 1000 ? r1(v / 1000) + 'k' : v}</text>`;
  const pts = bars.map((b, i) => ({ ...b, x: padL + bw * i + bw / 2 }));
  const marks = pts.map(b => {
    const x0 = b.x - bw / 2 + gap / 2, w = bw - gap, t = `<line x1="${x0 - 1}" x2="${x0 + w + 1}" y1="${y(b.target)}" y2="${y(b.target)}" class="tick"/>`;
    if (b.kcal == null) return t;
    const h = Math.max(2, y(0) - y(b.kcal));
    return `<path d="M${x0},${y(0)}v${-(h - Math.min(3, w / 2))}q0,-${Math.min(3, w / 2)} ${Math.min(3, w / 2)},-${Math.min(3, w / 2)}h${w - 2 * Math.min(3, w / 2)}q${Math.min(3, w / 2)},0 ${Math.min(3, w / 2)},${Math.min(3, w / 2)}v${h - Math.min(3, w / 2)}z" class="bar${b.kcal > b.target * 1.03 ? ' over' : ''}"/>${t}`;
  }).join('');
  const xl = [pts[0], pts[pts.length - 1]].map((b, i) => `<text x="${i ? W - padR : padL}" y="${H - 6}" class="ax" text-anchor="${i ? 'end' : 'start'}">${daily ? dateTxt(b.day) : dateTxt(L.addDays(b.day, -6))}</text>`).join('');
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Calories eaten versus target">${grid}${marks}${xl}
    <g class="hover" hidden><line class="cross" y1="${padT}" y2="${H - padB}"/></g></svg><div class="tipbox" hidden></div>`;
  hover(el, pts.filter(b => b.kcal != null), b => `<b>${b.label}</b>${fmt(b.kcal)} kcal<span>target ${fmt(b.target)}${b.n ? ` · ${plural(b.n, 'day')} logged` : ''}</span>`);
}
// Crosshair + tooltip that follows a finger or mouse to the nearest point.
function hover(el, pts, html) {
  const svg = el.querySelector('svg'), g = svg.querySelector('.hover'), tip = el.querySelector('.tipbox');
  const show = e => {
    const r = svg.getBoundingClientRect(), mx = (e.clientX - r.left) * svg.viewBox.baseVal.width / r.width;
    let best = pts[0];
    for (const p of pts) if (Math.abs(p.x - mx) < Math.abs(best.x - mx)) best = p;
    g.hidden = false;
    g.querySelector('.cross').setAttribute('x1', best.x); g.querySelector('.cross').setAttribute('x2', best.x);
    const dot = g.querySelector('.hdot');
    if (dot) { dot.setAttribute('cx', best.x); dot.setAttribute('cy', best.y); }
    tip.innerHTML = html(best); tip.hidden = false;
    const tx = best.x * r.width / svg.viewBox.baseVal.width;
    tip.style.left = Math.max(0, Math.min(r.width - tip.offsetWidth, tx - tip.offsetWidth / 2)) + 'px';
  };
  const hide = () => { g.hidden = true; tip.hidden = true; };
  svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointermove', show);
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('pointercancel', hide);
}

// ======================================================================
// Foods
// ======================================================================
function renderFoods() {
  const t = ui.foodsTab, q = ui.foodsQ.trim();
  let body;
  if (t === 'meals') {
    body = state.meals.length ? state.meals.map(m => `<div class="row"><button class="rmain" data-act="mealedit" data-id="${m.id}"><span class="rn">${esc(m.name)}</span><small>${esc(m.items.map(i => i.name).join(', '))}</small></button><span class="rk">${fmt(L.sum(m.items).kcal)}</span></div>`).join('')
      : '<p class="empty">No meals yet. Log something you eat often (say, your usual breakfast), then tap ··· next to it on Today and choose Save as meal.</p>';
  } else {
    const list = t === 'saved' ? savedFoods() : allFoods().sort((a, b) => a.name.localeCompare(b.name));
    const shown = q ? L.search(list, q, 200) : list;
    body = shown.map(f => `<div class="row"><button class="rmain" data-act="foodinfo" data-id="${esc(f.id)}"><span class="rn">${esc(f.name)}${f.star ? ' <i class="st">★</i>' : ''}</span><small>${f.brand ? esc(f.brand) + ' · ' : ''}${esc(L.amountText(L.defaultAmount(f)))}</small></button><span class="rk">${fmt(servingKcal(f))}</span></div>`).join('')
      || `<p class="empty">${t === 'saved' && !q ? 'Foods you create, scan or star show up here.' : 'No matches.'}</p>`;
  }
  view.innerHTML = `
  <header class="ph"><h1>Foods</h1><button class="btn sm" data-act="${t === 'meals' ? 'newmealhelp' : 'newfood'}">${t === 'meals' ? 'How to add' : 'New food'}</button></header>
  <div class="seg" role="radiogroup" aria-label="List">${[['saved', 'Saved'], ['meals', 'Meals'], ['all', 'All foods']].map(([id, n]) => `<button role="radio" aria-checked="${t === id}" class="${t === id ? 'on' : ''}" data-act="foodstab" data-v="${id}">${n}</button>`).join('')}</div>
  ${t !== 'meals' ? `<label class="search page">${icon.search}<input id="fq" type="search" placeholder="Search ${t === 'saved' ? 'saved foods' : `${allFoods().length} foods`}" value="${esc(ui.foodsQ)}" autocomplete="off"></label>` : ''}
  <div class="rows list" id="foodlist">${body}</div>`;
}

// ======================================================================
// Plan, tips and settings
// ======================================================================
function renderPlan() {
  const plan = state.plan, p = state.profile, series = L.trend(state.weights);
  const trend = series.length ? series[series.length - 1].trend : plan.startLb;
  const drift = Math.abs(trend - plan.maintLb) >= 5 && plan.rate !== 0;
  const flex = plan.flex || [];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const flexKey = flex.length ? L.budget(plan, L.addDays('2026-11-08', flex[0])) : null, normalKey = L.budget(plan, L.addDays('2026-11-08', [0, 1, 2, 3, 4, 5, 6].find(d => !flex.includes(d))));
  view.innerHTML = `
  <header class="ph"><h1>Plan</h1></header>
  <section class="label plan">
    <div class="lt"><h1>${plan.rate < 0 ? 'Lose' : plan.rate > 0 ? 'Gain' : 'Maintain'} ${plan.rate ? wTxt(Math.abs(plan.goalLb - plan.startLb)) : ''}</h1><span class="tag">${esc(plan.paceName)}</span></div>
    <div class="rule-xl"></div>
    <div class="lrow"><b>Goal</b><span>${wTxt(plan.goalLb)}${plan.finish ? ` by ${dateTxt(plan.finish)}` : ''}</span></div>
    <div class="lrow"><b>Pace</b><span>${plan.rate ? rateTxt(plan.rate) : 'Hold steady'}</span></div>
    <div class="rule-m"></div>
    <div class="lrow"><b>Daily calories</b><span>${flex.length ? `${fmt(normalKey)} / ${fmt(flexKey)}` : fmt(plan.kcal)}</span></div>
    ${flex.length ? `<div class="lrow sub"><span>Flex days</span><span>${flex.map(d => DAYS[d]).join(', ')} +${plan.bonus} kcal</span></div>` : ''}
    <div class="lrow"><b>Protein</b><span>${plan.protein} g a day</span></div>
    <div class="lrow sub"><span>Maintenance</span><span>${fmt(plan.maint)} kcal${plan.measured ? ' (measured)' : ' (estimate)'}</span></div>
  </section>
  ${drift ? `<section class="card note"><p><b>Your weight has moved ${wTxt(Math.abs(trend - plan.maintLb))} since these numbers were set.</b> A ${trend < plan.maintLb ? 'lighter' : 'heavier'} body burns ${trend < plan.maintLb ? 'less' : 'more'}, so the target should follow.</p><button class="btn" data-act="recalc">Update my targets</button></section>` : ''}
  <div class="btnrow"><button class="btn" data-act="replan">Change plan</button><button class="btn ghost" data-act="editprofile">Edit my details</button></div>

  <h2 class="sect">Tips and tricks</h2>
  ${TIPS.map(g => `<details class="tips"><summary>${esc(g.h)}<span>${g.items.length}</span></summary>${g.items.map(([h, b]) => `<div class="tipi"><b>${esc(h)}</b><p>${esc(b)}</p></div>`).join('')}</details>`).join('')}

  <h2 class="sect">Settings</h2>
  <section class="card settings">
    <div class="set"><span>Units</span><div class="seg small">${[['us', 'lb, ft'], ['metric', 'kg, cm']].map(([v, n]) => `<button class="${state.settings.units === v ? 'on' : ''}" data-act="units" data-v="${v}">${n}</button>`).join('')}</div></div>
    <div class="set"><span>Theme</span><div class="seg small">${[['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([v, n]) => `<button class="${state.settings.theme === v ? 'on' : ''}" data-act="theme" data-v="${v}">${n}</button>`).join('')}</div></div>
    <div class="set"><span>Sync<small class="syncstat">${esc(syncLine())}</small></span><button class="btn sm${sync ? ' ghost' : ''}" data-act="syncsheet">${sync ? 'Manage' : 'Set up'}</button></div>
    <div class="set"><span>Backup<small>${state.backupAt ? 'Last: ' + dateTxt(L.day(new Date(state.backupAt))) : 'Never backed up'}</small></span><div class="btnrow tight"><button class="btn sm ghost" data-act="import">Restore</button><button class="btn sm" data-act="export">Back up</button></div></div>
    <div class="set"><span>Start over<small>Deletes your log, weigh-ins and foods${sync ? ' everywhere' : ''}</small></span><button class="btn sm ghost danger" data-act="reset">Erase</button></div>
  </section>
  <p class="foot">Food data: USDA FoodData Central, Livsmedelsverket and <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener">Open Food Facts</a> (ODbL). Calorie targets are estimates, not medical advice.</p>
  <input type="file" id="importfile" accept="application/json,.json" hidden>`;
}

// ======================================================================
// Setup: about you, goal, pace, rhythm
// ======================================================================
let ob = null;
function startSetup(step = 0) {
  const p = state.profile || {}, plan = state.plan || {}, series = L.trend(state.weights);
  const lb = series.length ? series[series.length - 1].lb : plan.startLb;
  ob = { step, sex: p.sex || '', age: p.birthYear ? L.age(p, ui.today) : '', heightIn: p.heightIn || null, activity: p.activity || '',
    lb: lb || null, goalLb: plan.goalLb || null, by: plan.by || '', pace: plan.pace || '', flex: plan.flex || [], bonus: plan.bonus || 300, rhythm: (plan.flex || []).length ? 'flex' : 'even', editOnly: false };
  render();
}
function renderSetup() {
  if (!ob) startSetup();
  const steps = [setupWelcome, setupYou, setupBody, setupGoal, setupPace, setupRhythm, setupDone];
  const s = ob.step;
  view.innerHTML = `<div class="setup-wrap">
    ${s > 0 && s < 6 ? `<div class="sbar"><button class="icon" data-act="sback" aria-label="Back">${icon.back}</button><div class="dots">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= s ? 'on' : ''}"></i>`).join('')}</div>${state.plan ? `<button class="link" data-act="scancel">Cancel</button>` : '<span></span>'}</div>` : ''}
    ${steps[s]()}
    <p class="err" id="serr" hidden></p>
  </div>`;
  const f = view.querySelector('[autofocus]');
  if (f && matchMedia('(pointer: fine)').matches) f.focus();
}
const ft = () => ob.heightIn ? Math.floor(ob.heightIn / 12) : '', inch = () => ob.heightIn ? Math.round(ob.heightIn % 12 * 10) / 10 : '';
function setupWelcome() {
  return `<div class="welcome">
    <div class="mark">${logoSVG()}</div>
    <h1 class="wm">Tally</h1>
    <p class="lede">Log what you eat in a few taps, watch the trend instead of the daily noise, and get to your goal weight on a pace you can actually keep.</p>
    <div class="label mini">
      <div class="lrow"><b>Setup</b><span>about a minute</span></div><div class="rule-m"></div>
      <div class="lrow sub"><span>Your details</span><span>height, weight, age</span></div>
      <div class="lrow sub"><span>Your goal</span><span>weight and date</span></div>
      <div class="lrow sub"><span>Your plan</span><span>pick a pace</span></div>
    </div>
    <div class="f wide"><span>Units</span><div class="seg two">${[['us', 'lb, ft, in'], ['metric', 'kg, cm']].map(([v, n]) => `<button class="${state.settings.units === v ? 'on' : ''}" data-act="units" data-v="${v}">${n}</button>`).join('')}</div></div>
    <button class="btn wide big" data-act="snext">Get started</button>
    <p class="fine">Everything stays on this device unless you turn on sync.<br>Already using Tally somewhere else? <button class="link" data-act="syncsheet">Sync it here</button></p>
  </div>`;
}
function setupYou() {
  return `<h1 class="sq">A bit about you</h1><p class="sh">Used to estimate how much you burn in a day.</p>
    <div class="form">
      <div class="f wide"><span>Sex</span><div class="seg two">${[['m', 'Male'], ['f', 'Female']].map(([v, n]) => `<button class="${ob.sex === v ? 'on' : ''}" data-act="sset" data-k="sex" data-v="${v}">${n}</button>`).join('')}</div></div>
      <label class="f"><span>Age</span><input id="sage" type="text" inputmode="numeric" value="${ob.age}" autofocus></label>
      ${metric() ? `<label class="f"><span>Height, cm</span><input id="scm" type="text" inputmode="decimal" value="${ob.heightIn ? Math.round(ob.heightIn * L.CM) : ''}"></label>`
        : `<div class="f"><span>Height</span><div class="pair"><label><input id="sft" type="text" inputmode="numeric" value="${ft()}" aria-label="Feet"><i>ft</i></label><label><input id="sin" type="text" inputmode="decimal" value="${inch()}" aria-label="Inches"><i>in</i></label></div></div>`}
    </div>
    <button class="btn wide big" data-act="snext">Next</button>`;
}
function setupBody() {
  return `<h1 class="sq">Weight and activity</h1><p class="sh">Your weight this morning is ideal, but a recent number is fine.</p>
    <div class="form"><label class="f wide"><span>Current weight, ${wUnit()}</span><input id="slb" type="text" inputmode="decimal" value="${ob.lb ? wVal(ob.lb).toFixed(1) : ''}" autofocus></label></div>
    <p class="fl">How active is a normal week?</p>
    <div class="choices">${L.ACTIVITY.map(a => `<button class="choice${ob.activity === a.id ? ' on' : ''}" data-act="sset" data-k="activity" data-v="${a.id}"><b>${a.name}</b><span>${a.desc}</span></button>`).join('')}</div>
    <p class="fine">Count climbing, gym and sports. If you're between two, pick the lower one. Tally corrects it from your real data after a few weeks.</p>
    <button class="btn wide big" data-act="snext">Next</button>`;
}
function setupGoal() {
  const prof = profileFromOb(), maint = L.maintenance(prof, ob.lb, ui.today);
  const [lo, hi] = L.healthyRange(prof);
  const presets = [[0, 'No date'], [8, '2 months'], [13, '3 months'], [26, '6 months']];
  const g = ob.goalLb;
  return `<h1 class="sq">Your goal</h1>
    <p class="sh">You burn roughly <b>${fmt(L.round(maint, 10))} kcal</b> a day right now. The healthy range for your height is ${rangeTxt(lo, hi)}.</p>
    <div class="form">
      <label class="f wide"><span>Goal weight, ${wUnit()}</span><input id="sgoal" type="text" inputmode="decimal" value="${g ? wVal(g).toFixed(1) : ''}" autofocus></label>
      <div class="f wide"><span>By when?</span>
        <div class="seg">${presets.map(([w, n]) => { const d = w ? L.addDays(ui.today, w * 7) : ''; return `<button class="${ob.by === d ? 'on' : ''}" data-act="sby" data-v="${d}">${n}</button>`; }).join('')}</div>
        <label class="datef"><span>Or pick a date</span><input id="sdate" type="date" min="${L.addDays(ui.today, 7)}" value="${ob.by}"></label>
      </div>
    </div>
    <p class="warn" id="gwarn" ${g && g < lo ? '' : 'hidden'}>${goalWarn(lo, hi)}</p>
    <button class="btn wide big" data-act="snext">See my options</button>`;
}
const rangeTxt = (lo, hi) => `${Math.round(wVal(lo))}–${Math.round(wVal(hi))} ${wUnit()}`;
const goalWarn = (lo, hi) => `That's under the healthy range for your height (${rangeTxt(lo, hi)}). Consider a higher goal.`;
function setupPace() {
  const po = paceOptions();
  if (!ob.pace || !po.options.some(o => o.id === ob.pace)) ob.pace = (po.options.find(o => o.meets && o.id !== 'fast') || po.options.find(o => o.id === 'steady') || po.options[0]).id;
  const diff = Math.abs(ob.goalLb - ob.lb);
  const tooFast = po.needed != null && !po.options.some(o => o.meets);
  return `<h1 class="sq">${po.dir === 'maintain' ? 'Hold steady' : `Pick a pace`}</h1>
    <p class="sh">${po.dir === 'maintain' ? 'Your goal is your current weight, so the plan is to eat at maintenance.' : `${po.dir === 'lose' ? 'Losing' : 'Gaining'} ${wTxt(diff)}. Slower is easier to stick to, and it's the sticking that matters.`}</p>
    ${tooFast ? `<p class="warn">Reaching ${wTxt(ob.goalLb)} by ${dateTxt(ob.by)} would take ${rateTxt(Math.abs(po.needed))}${po.dir === 'lose' && Math.abs(po.needed) > po.maxLoss ? ', which loses a lot of muscle along with the fat' : ''}. Here's what's realistic.</p>` : ''}
    <div class="choices">${po.options.map(o => `<button class="choice pace${ob.pace === o.id ? ' on' : ''}" data-act="sset" data-k="pace" data-v="${o.id}">
      <div class="pt"><b>${o.name}</b>${o.meets ? '<span class="tag">Hits your date</span>' : ''}${o.capped ? '<span class="tag">Floor</span>' : ''}</div>
      <div class="pn"><span><em>${fmt(o.kcal)}</em> kcal a day</span><span>${o.rate ? rateTxt(o.rate) : 'no change'}</span></div>
      ${o.finish ? `<div class="pd">Goal by <b>${dateTxt(o.finish)}</b> · ${plural(Math.ceil(o.weeks), 'week')}</div>` : ''}
      <span class="pf">${o.capped ? `Capped at ${fmt(po.floor)} kcal, the lowest that's sensible without a doctor. ` : ''}${esc(o.feel)}</span></button>`).join('')}</div>
    <button class="btn wide big" data-act="snext">Next</button>`;
}
function setupRhythm() {
  const opt = paceOptions().options.find(o => o.id === ob.pace);
  const plan = { kcal: opt.kcal, flex: ob.rhythm === 'flex' ? ob.flex : [], bonus: ob.bonus };
  const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'], NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const flexOn = plan.flex.length > 0 && plan.flex.length < 7;
  const low = flexOn ? L.budget(plan, L.addDays('2026-11-08', [0, 1, 2, 3, 4, 5, 6].find(d => !plan.flex.includes(d)))) : opt.kcal;
  const tooLow = flexOn && low < L.floor(profileFromOb());
  return `<h1 class="sq">Your week</h1><p class="sh">Same number every day, or save some up for the weekend. The weekly total is the same either way.</p>
    <div class="choices">
      <button class="choice${ob.rhythm === 'even' ? ' on' : ''}" data-act="sset" data-k="rhythm" data-v="even"><b>Every day the same</b><span>${fmt(opt.kcal)} kcal every day. Simple and predictable.</span></button>
      <button class="choice${ob.rhythm === 'flex' ? ' on' : ''}" data-act="sset" data-k="rhythm" data-v="flex"><b>Flex days</b><span>A bit less on normal days, more on the days you go out or eat with friends.</span></button>
    </div>
    ${ob.rhythm === 'flex' ? `
      <div class="f wide"><span>Flex days</span><div class="days">${DAYS.map((d, i) => `<button class="${ob.flex.includes(i) ? 'on' : ''}" data-act="sflex" data-v="${i}" aria-label="${NAMES[i]}" aria-pressed="${ob.flex.includes(i)}">${d}</button>`).join('')}</div></div>
      <div class="f wide"><span>Extra on flex days</span><div class="seg">${[200, 300, 400, 500].map(b => `<button class="${ob.bonus === b ? 'on' : ''}" data-act="sbonus" data-v="${b}">+${b}</button>`).join('')}</div></div>
      ${flexOn ? `<div class="label mini"><div class="lrow"><b>Normal days</b><span>${fmt(low)} kcal</span></div><div class="lrow"><b>Flex days</b><span>${fmt(opt.kcal + ob.bonus)} kcal</span></div></div>` : '<p class="fine">Pick at least one flex day.</p>'}
      ${tooLow ? `<p class="warn">That puts normal days under ${fmt(L.floor(profileFromOb()))} kcal. Pick fewer flex days or a smaller bonus.</p>` : ''}` : ''}
    <button class="btn wide big" data-act="snext" ${ob.rhythm === 'flex' && (!flexOn || tooLow) ? 'disabled' : ''}>Next</button>`;
}
function setupDone() {
  const p = state.plan;
  return `<div class="welcome">
    <h1 class="sq">You're set</h1>
    <div class="label">
      <div class="lt"><h1>Daily target</h1></div><div class="rule-xl"></div>
      <div class="lbig"><span class="num">${fmt(p.kcal)}</span><span class="of">kcal${(p.flex || []).length ? ' average' : ''}</span></div>
      <div class="rule-m"></div>
      <div class="lrow"><b>Protein</b><span>${p.protein} g</span></div>
      <div class="lrow"><b>Goal</b><span>${wTxt(p.goalLb)}${p.finish ? ` by ${dateTxt(p.finish)}` : ''}</span></div>
    </div>
    <ol class="starter">
      <li><b>Weigh in every morning.</b> Ignore the daily number; the trend line on Progress is the real one.</li>
      <li><b>Log as you eat.</b> Your regulars become one-tap adds after the first time.</li>
      <li><b>Hit your protein.</b> ${p.protein} g keeps you full and keeps your muscle.</li>
    </ol>
    <button class="btn wide big" data-act="sfinish">Start logging</button>
  </div>`;
}
const profileFromOb = () => ({ sex: ob.sex, birthYear: Number(ui.today.slice(0, 4)) - Number(ob.age), heightIn: ob.heightIn, activity: ob.activity });
const paceOptions = () => L.planOptions({ profile: profileFromOb(), lb: ob.lb, goalLb: ob.goalLb, by: ob.by || null, today: ui.today });
function setupErr(msg) { const e = $('#serr'); e.textContent = msg; e.hidden = !msg; if (msg) e.scrollIntoView({ block: 'nearest' }); return !msg; }
function setupNext() {
  const s = ob.step, v = id => { const el = $('#' + id); return el ? el.value : ''; };
  if (s === 1) {
    const age = num(v('sage'));
    let h = metric() ? num(v('scm')) / L.CM : num(v('sft')) * 12 + (num(v('sin')) || 0);
    if (!ob.sex) return setupErr('Pick one. It changes the calorie estimate by about 160 kcal.');
    if (!(age >= 13 && age <= 100)) return setupErr('Enter your age (13 or older).');
    if (!(h >= 48 && h <= 96)) return setupErr(metric() ? 'Enter your height in cm.' : 'Enter your height in feet and inches.');
    ob.age = Math.round(age); ob.heightIn = r1(h);
  }
  if (s === 2) {
    const lb = toLb(num(v('slb')));
    if (!(lb >= 70 && lb <= 700)) return setupErr('Enter your current weight.');
    if (!ob.activity) return setupErr('Pick how active you are.');
    ob.lb = r1(lb);
  }
  if (s === 3) {
    const g = toLb(num(v('sgoal')));
    if (!(g >= 70 && g <= 700)) return setupErr('Enter a goal weight.');
    ob.goalLb = r1(g);
    const d = v('sdate');
    if (d && d !== ob.by) ob.by = d;
    if (ob.by && ob.by <= ui.today) ob.by = '';
  }
  if (s === 4 && paceOptions().dir === 'maintain') { ob.rhythm = 'even'; return finishSetup(); }
  if (s === 5) return finishSetup();
  setupErr('');
  if (ob.editOnly && s === 2) { ob.step = 3; }
  ob.step++;
  render(); scrollTo(0, 0);
}
function finishSetup() {
  const prof = profileFromOb(), po = paceOptions(), o = po.options.find(x => x.id === ob.pace) || po.options[0];
  const flex = ob.rhythm === 'flex' ? [...ob.flex].sort() : [];
  state.profile = prof;
  state.plan = { start: ui.today, startLb: ob.lb, goalLb: ob.goalLb, by: ob.by || null, rate: o.rate, pace: o.id, paceName: o.name,
    kcal: o.kcal, protein: L.protein(ob.goalLb, ob.lb), maint: po.maint, maintLb: ob.lb, finish: o.finish, flex, bonus: flex.length ? ob.bonus : 0 };
  if (state.weights[ui.today] == null || Math.abs(state.weights[ui.today] - ob.lb) > 0.05) state.weights[ui.today] = ob.lb;
  save();
  ob.step = 6;
  render(); scrollTo(0, 0);
}
function logoSVG() {
  return '<svg viewBox="0 0 512 512" class="logo" aria-hidden="true"><rect width="512" height="512" rx="112" fill="currentColor"/><path d="M164 136v240M228 136v240M292 136v240M356 136v240" class="lm" stroke-width="40"/><path d="M110 330L410 182" stroke="#f3c74a" stroke-width="40"/></svg>';
}

// ======================================================================
// Actions
// ======================================================================
const act = {
  undo() { const u = toast.undo; toast.undo = null; $('#toast').classList.remove('show'); if (u) u(); },
  close: closeSheet,
  // today
  day(el) { const k = L.addDays(ui.day, +el.dataset.d); if (k <= ui.today) { ui.day = k; render(); } },
  add(el) { openAdd(el.dataset.meal); },
  saveweight() {
    const v = toLb(num($('#wIn').value));
    if (!(v >= 70 && v <= 700)) { toast(`Enter your weight in ${wUnit()}.`); return $('#wIn').focus(); }
    state.weights[ui.day] = r1(v); save(); render();
    toast(`Saved ${wTxt(v)}`);
  },
  weightsheet(el) { openSheet({ mode: 'weight', day: el.dataset.day }); },
  addweight() { openSheet({ mode: 'weight', day: L.addDays(ui.today, -1), isNew: true }); },
  wsave() {
    const v = toLb(num($('#wv').value)), d = sh.isNew ? $('#wd').value : sh.day;
    if (!(v >= 70 && v <= 700)) return toast(`Enter a weight in ${wUnit()}.`);
    if (!d || d > ui.today) return toast('Pick a date up to today.');
    state.weights[d] = r1(v); save(); closeSheet(); toast(`Saved ${wTxt(v)} for ${dateTxt(d)}`);
  },
  wdel() {
    const d = sh.day, old = state.weights[d];
    delete state.weights[d]; save(); closeSheet();
    toast('Weigh-in deleted', () => { state.weights[d] = old; save(); render(); });
  },
  edit(el) {
    const e = entriesOf(ui.day).find(x => x.id === el.dataset.id); if (!e) return;
    if (!e.foodId) return openSheet({ mode: 'quick', meal: e.meal, entry: e });
    openAmount(anyFood(e.foodId) || entryFood(e), { entry: e });
  },
  repeat(el) {
    const meal = el.dataset.meal, src = entriesOf(L.addDays(ui.day, -1)).filter(e => e.meal === meal);
    const copies = src.map(e => ({ ...e, id: uid() }));
    const undo = addEntries(ui.day, copies); render();
    toast(`Added ${plural(copies.length, 'item')} · ${fmt(L.sum(copies).kcal)} kcal`, undo);
  },
  mealmenu(el) { openSheet({ mode: 'menu', meal: el.dataset.meal }); },
  savemeal() {
    const items = entriesOf(ui.day).filter(e => e.meal === sh.meal);
    openSheet({ mode: 'savemeal', items, name: `My ${L.MEALS.find(m => m[0] === sh.meal)[1].toLowerCase()}` });
  },
  dosavemeal() {
    const name = $('#mname').value.trim() || 'Meal';
    state.meals.push({ id: uid(), name, items: sh.items.map(({ id, meal, ...rest }) => rest) });
    save(); closeSheet(); toast(`Saved “${name}”. Find it under Meals when adding food.`);
  },
  copytoday() {
    const items = entriesOf(ui.day).filter(e => e.meal === sh.meal).map(e => ({ ...e, id: uid() }));
    const undo = addEntries(ui.today, items); closeSheet();
    toast(`Copied ${plural(items.length, 'item')} to today`, undo);
  },
  clearmeal() {
    const key = ui.day, removed = entriesOf(key).filter(e => e.meal === sh.meal);
    dropEntries(key, removed.map(e => e.id)); closeSheet();
    toast(`Cleared ${plural(removed.length, 'item')}`, () => { putEntries(key, removed); render(); });
  },
  // add sheet
  setmeal(el) { sh.meal = el.dataset.meal; sheetBody.querySelectorAll('.seg button').forEach(b => { b.classList.toggle('on', b.dataset.meal === sh.meal); b.setAttribute('aria-checked', b.dataset.meal === sh.meal); }); if (sh.mode === 'add') renderResults(); },
  list(el) { sh.list = el.dataset.v; renderResults(); },
  backadd() { stopScan(); const b = sh.back; if (b) { sh = b; renderSheet(); } else closeSheet(); },
  pickfood(el) {
    const f = anyFood(el.dataset.id); if (!f) return;
    if (!sheetEl.open) { openAdd(); }
    openAmount(f);
  },
  quickfood(el) {
    const f = anyFood(el.dataset.id); if (!f) return;
    const a = L.defaultAmount(f), e = makeEntry(f, a, sh.meal), key = ui.day;
    touch(f, a, sh.meal); addEntries(key, [e]); sh.added.push(e);
    const keep = sh; renderSheet();
    toast(`Added ${f.name} · ${fmt(e.kcal)} kcal`, () => { dropEntries(key, [e.id]); keep.added = keep.added.filter(x => x !== e); if (sh === keep) renderSheet(); else render(); });
  },
  retryoff() { sh.off.q = ''; searchOFF(sh.q.trim()); renderResults(); },
  scan() { const back = sh; openSheet({ mode: 'scan', back, meal: back.meal }); startScan(); },
  lookup() { lookupCode($('#code').value); },
  quick() { openSheet({ mode: 'quick', back: sh, meal: sh.meal }); },
  create() { openSheet({ mode: 'create', back: sh, meal: sh.meal, q: sh.q || '' }); },
  logmeal(el) {
    const m = state.meals.find(x => x.id === el.dataset.id);
    const items = m.items.map(i => ({ ...i, id: uid(), meal: sh.meal }));
    const undo = addEntries(ui.day, items); sh.added.push(...items);
    const keep = sh; renderSheet();
    toast(`Added ${m.name} · ${fmt(L.sum(items).kcal)} kcal`, () => { undo(); keep.added = keep.added.filter(x => !items.includes(x)); if (sh === keep) renderSheet(); });
  },
  // amount
  unit(el) {
    const o = unitOptions(sh.f)[+el.dataset.i], grams = sh.a.qty * sh.a.g;
    sh.a = { label: o.label, g: o.g, qty: o.g === 1 ? Math.round(grams) || 100 : Math.max(0.25, Math.round(grams / o.g * 4) / 4) || 1 };
    renderSheet();
  },
  qty(el) {
    const d = +el.dataset.d, min = sh.a.g === 1 ? 1 : 0.25;
    let q = Math.round((sh.a.qty + d) / Math.abs(d)) * Math.abs(d);
    if (q < min) q = min;
    sh.a.qty = r1(q * 100) / 100; $('#qtyIn').value = L.trim(sh.a.qty); updateFacts();
  },
  setqty(el) { sh.a.qty = +el.dataset.v; $('#qtyIn').value = L.trim(sh.a.qty); updateFacts(); },
  amealset(el) { sh.meal = el.dataset.meal; renderSheet(); },
  star() {
    const f = sh.mode === 'food' ? anyFood(sh.id) : sh.f;
    if (f.src === 'off' && !state.foods[f.id]) { const { uses, last, at, star, m, ...clean } = f; state.foods[f.id] = clean; }
    const u = state.usage[f.id] || (state.usage[f.id] = {});
    u.star = !u.star; save();
    if (sh.mode === 'amount') sh.f = { ...sh.f, star: u.star };
    renderSheet(); if (tab === 'foods') render();
  },
  addfood() {
    if (!(sh.a.qty > 0)) return;
    const f = sh.f, e = makeEntry(f, sh.a, sh.meal), key = ui.day;
    touch(f, sh.a, sh.meal); addEntries(key, [e]);
    const back = sh.back;
    if (back) { back.added.push(e); back.meal = sh.meal; sh = back; renderSheet(); } else closeSheet();
    toast(`Added ${f.name} · ${fmt(e.kcal)} kcal`, () => { dropEntries(key, [e.id]); if (back) back.added = back.added.filter(x => x !== e); if (sh && sh === back) renderSheet(); else render(); });
  },
  saveentry() {
    const old = sh.entry, f = sh.f, key = ui.day;
    if (!entriesOf(key).some(x => x.id === old.id)) return closeSheet();
    const e = { ...makeEntry(f, sh.a, sh.meal), id: old.id, foodId: old.foodId, name: old.name, brand: old.brand };
    if (state.usage[old.foodId]) state.usage[old.foodId].last = { qty: sh.a.qty, g: sh.a.g, label: sh.a.label };
    putEntries(key, [e]); closeSheet();
    toast('Saved', () => { putEntries(key, [old]); render(); });
  },
  delentry() {
    const key = ui.day, old = sh.entry;
    dropEntries(key, [old.id]); closeSheet();
    toast(`Removed ${old.name}`, () => { putEntries(key, [old]); render(); });
  },
  savequick() {
    const k = num($('#qk').value), p = num($('#qp').value) || 0;
    if (!(k > 0 && k < 10000)) { toast('Enter the calories.'); return $('#qk').focus(); }
    const old = sh.entry, key = ui.day;
    const e = { id: old ? old.id : uid(), meal: sh.meal, foodId: null, name: $('#qn').value.trim() || 'Quick add', qty: 1, g: 1, label: '', kcal: Math.round(k), p: r1(p), c: 0, f: 0 };
    if (old) { putEntries(key, [e]); closeSheet(); return toast('Saved', () => { putEntries(key, [old]); render(); }); }
    addEntries(key, [e]);
    const back = sh.back;
    if (back) { back.added.push(e); back.meal = sh.meal; sh = back; renderSheet(); } else closeSheet();
    toast(`Added ${fmt(k)} kcal`, () => { dropEntries(key, [e.id]); if (back) back.added = back.added.filter(x => x !== e); if (sh && sh === back) renderSheet(); else render(); });
  },
  // create food
  per(el) { const keep = snapshotCreate(); sh.per = el.dataset.v; renderSheet(); restoreCreate(keep); },
  savefood() {
    const f = readCreate();
    const err = $('#cerr');
    if (typeof f === 'string') { err.textContent = f; err.hidden = false; return; }
    const isNew = !state.foods[f.id];
    state.foods[f.id] = (({ uses, last, at, star, m, ...clean }) => clean)(f);
    if (isNew) (state.usage[f.id] = state.usage[f.id] || {}).star = true;
    save();
    if (sh.fromFoods) { closeSheet(); return toast(isNew ? `Created ${f.name}` : 'Saved'); }
    const back = sh.back, meal = sh.meal;
    sh = back ? { ...back } : null;
    if (!sh) { openAdd(meal); }
    sh.meal = meal;
    openAmount(withUsage(state.foods[f.id]));
  },
  delfood() {
    const f = sh.edit;
    openSheet({ mode: 'confirm', title: `Delete ${f.name}?`, text: 'It disappears from your foods. Days you already logged it keep their numbers.', yes: 'Delete', danger: true,
      onYes: () => { delete state.foods[f.id]; delete state.usage[f.id]; save(); closeSheet(); toast(`Deleted ${f.name}`); } });
  },
  yes() { sh.onYes(); },
  // foods tab
  foodstab(el) { ui.foodsTab = el.dataset.v; ui.foodsQ = ''; render(); },
  foodinfo(el) { openSheet({ mode: 'food', id: el.dataset.id }); },
  newfood() { openSheet({ mode: 'create', fromFoods: true, meal: 'snacks' }); },
  newmealhelp() { toast('Log the foods on Today, then tap ··· on that meal and choose Save as meal.'); },
  editfood() { const f = anyFood(sh.id); openSheet({ mode: 'create', edit: f, fromFoods: true, meal: 'snacks' }); },
  logfood() { const f = anyFood(sh.id); location.hash = '#today'; ui.day = ui.today; openAdd(); openAmount(f); },
  mealedit(el) { openSheet({ mode: 'meal', id: el.dataset.id }); },
  mitemdel(el) { const m = state.meals.find(x => x.id === sh.id); if (!m) return closeSheet(); m.items.splice(+el.dataset.i, 1); save(); renderSheet(); },
  mealsave() { const m = state.meals.find(x => x.id === sh.id); if (!m) return closeSheet(); m.name = $('#mname').value.trim() || m.name; save(); closeSheet(); },
  mealdel() {
    const i = state.meals.findIndex(x => x.id === sh.id), m = state.meals[i];
    state.meals.splice(i, 1); save(); closeSheet();
    toast(`Deleted ${m.name}`, () => { state.meals.splice(i, 0, m); save(); render(); });
  },
  // progress
  range(el) { ui.range = +el.dataset.v; render(); },
  usemm(el) {
    const v = +el.dataset.v, p = state.plan;
    const kcal = Math.max(L.floor(state.profile), L.round(v + p.rate * L.KCAL_PER_LB / 7, 10));
    openSheet({ mode: 'confirm', title: 'Update your target?', text: `Maintenance becomes ${fmt(v)} kcal, so your daily target goes from ${fmt(p.kcal)} to <b>${fmt(kcal)}</b> kcal at your current pace.`, yes: 'Update',
      onYes: () => { Object.assign(p, { maint: v, kcal, measured: true, maintLb: L.trend(state.weights).pop()?.trend ?? p.maintLb }); save(); closeSheet(); toast(`Target is now ${fmt(kcal)} kcal`); } });
  },
  // plan
  replan() { startSetup(3); ob.step = 3; },
  editprofile() { startSetup(1); ob.editOnly = true; render(); },
  scancel() { ob = null; render(); },
  recalc() {
    const p = state.plan, trend = L.trend(state.weights).pop().trend;
    const maint = p.measured ? p.maint + (trend - p.maintLb) * 10 : L.round(L.maintenance(state.profile, trend, ui.today), 10); // ~10 kcal per lb for measured
    const kcal = Math.max(L.floor(state.profile), L.round(maint + p.rate * L.KCAL_PER_LB / 7, 10));
    Object.assign(p, { maint: L.round(maint, 10), kcal, maintLb: r1(trend), protein: L.protein(p.goalLb, trend) });
    save(); render(); toast(`Target is now ${fmt(kcal)} kcal`);
  },
  units(el) { state.settings.units = el.dataset.v; save(); render(); },
  theme(el) { state.settings.theme = el.dataset.v; save(); render(); },
  async export() {
    const json = JSON.stringify(state), name = `tally-backup-${ui.today}.json`;
    const file = new File([json], name, { type: 'application/json' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] }) && matchMedia('(pointer: coarse)').matches) await navigator.share({ files: [file], title: 'Tally backup' });
      else { const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
      state.backupAt = Date.now(); save(); render(); toast('Backup saved');
    } catch (e) { if (e.name !== 'AbortError') toast('Backup failed'); }
  },
  import() { $('#importfile').click(); },
  async syncsheet() { if (sync) await loadQR().catch(() => {}); openSheet({ mode: 'sync' }); },
  syncback() { openSheet({ mode: 'sync' }); },
  async syncconnect() {
    const keep = sh, v = (($('#stoken') || {}).value ?? keep.token ?? '').trim();
    if (!v) { keep.err = 'Paste the token first.'; return renderSheet(); }
    keep.token = v; keep.busy = true; keep.err = null; renderSheet();
    try {
      const c = await connect(v);
      if (sh !== keep) return;
      if (c.remote && c.remote.plan && state.plan) { keep.c = c; keep.busy = false; return renderSheet(); }
      await finishConnect(c);
      if (sh === keep) closeSheet();
      toast(c.broad ? 'Connected. This token can also change your repos, so a gist-only one is safer.' : c.remote ? 'Connected and synced' : 'Connected. Your data is now saved to GitHub too.');
    } catch (e) { if (sh === keep) { keep.busy = false; keep.err = e.message; renderSheet(); } }
  },
  async syncpick(el) {
    const keep = sh;
    try { await finishConnect(keep.c, el.dataset.v); if (sh === keep) closeSheet(); toast('Connected and synced'); }
    catch (e) { toast(e.message || 'Couldn\'t finish connecting. Try again.'); }
  },
  syncgo() { syncNow(true); },
  async synccopy() {
    try { await navigator.clipboard.writeText(`tally-sync:${sync.token}:${sync.gist}`); toast('Copied. Paste it on the other device.'); }
    catch { toast('Couldn\'t copy. Make a second token on the other device instead.'); }
  },
  syncscan() { openSheet({ mode: 'scan', qr: true }); startScan(); },
  syncoff() {
    openSheet({ mode: 'confirm', title: 'Disconnect sync?', text: 'This device stops syncing. Its data stays here, and the gist keeps the synced copy for your other devices.', yes: 'Disconnect',
      onYes: () => { sync = null; syncStore(); syncRun.err = null; closeSheet(); toast('Sync is off on this device'); } });
  },
  reset() {
    openSheet({ mode: 'confirm', title: 'Erase everything?', text: `Your log, weigh-ins, foods, meals and plan are deleted from ${sync ? '<b>every synced device</b>' : 'this device'}. Back up first if you might want them.`, yes: 'Erase', danger: true,
      onYes: () => { state = { ...blank(), settings: state.settings, ts: state.ts }; save(); ob = null; closeSheet(); location.hash = '#today'; render(); } });
  },
  // setup
  snext: () => setupNext(),
  sback() { if (ob.editOnly && ob.step === 1) { ob = null; return render(); } ob.step = Math.max(ob.editOnly ? 1 : 0, ob.step - 1); render(); },
  sset(el) {
    const k = el.dataset.k, keepIn = [...view.querySelectorAll('input')].map(i => [i.id, i.value]);
    ob[k] = el.dataset.v;
    if (k === 'rhythm' && ob.rhythm === 'flex' && !ob.flex.length) ob.flex = [6, 0];
    render(); keepIn.forEach(([id, v]) => { const i = document.getElementById(id); if (i) i.value = v; });
  },
  sby(el) { readGoalInput(); ob.by = el.dataset.v; render(); },
  sflex(el) { const d = +el.dataset.v; ob.flex = ob.flex.includes(d) ? ob.flex.filter(x => x !== d) : [...ob.flex, d]; render(); },
  sbonus(el) { ob.bonus = +el.dataset.v; render(); },
  sfinish() { ob = null; location.hash = '#today'; ui.day = ui.today; render(); },
};
function readGoalInput() { const g = toLb(num(($('#sgoal') || {}).value)); if (g >= 70) ob.goalLb = r1(g); }
// An entry whose food was deleted: rebuild per-100 g values from the entry itself so its amount can still change.
const entryFood = e => { const m = 100 / (e.qty * e.g || 100); return { id: e.foodId, src: 'gone', name: e.name, brand: e.brand, k: e.kcal * m, p: e.p * m, c: e.c * m, f: e.f * m, servings: e.g !== 1 ? [{ label: e.label, g: e.g }] : [], ml: false }; };
const snapshotCreate = () => [...sheetBody.querySelectorAll('input')].map(i => [i.id, i.type === 'checkbox' ? i.checked : i.value]);
const restoreCreate = vals => vals.forEach(([id, v]) => { const i = document.getElementById(id); if (i && !['ck', 'cp', 'cc', 'cf'].includes(id)) i.type === 'checkbox' ? (i.checked = v) : (i.value = v); });

// ---------- events ----------
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const f = act[el.dataset.act];
  if (f) { e.preventDefault(); f(el, e); }
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'q') { sh.q = t.value; searchOFF(t.value.trim()); renderResults(); }
  else if (t.id === 'fq') {
    ui.foodsQ = t.value;
    const pos = t.selectionStart; renderFoods(); const n = $('#fq'); n.focus(); n.setSelectionRange(pos, pos);
  } else if (t.id === 'qtyIn') { const v = num(t.value); sh.a.qty = v > 0 ? v : 0; updateFacts(); }
  else if (t.id === 'sgoal' && ob) {
    const g = toLb(num(t.value)), [lo] = L.healthyRange(profileFromOb());
    $('#gwarn').hidden = !(g >= 70 && g < lo);
  }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'daypick' && t.value) { ui.day = t.value > ui.today ? ui.today : t.value; render(); }
  if (t.id === 'sdate') { readGoalInput(); ob.by = t.value; render(); }
  if (t.id === 'importfile' && t.files[0]) importFile(t.files[0]);
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.isComposing) return;
  const id = e.target.id;
  const map = { wIn: 'saveweight', wv: 'wsave', qk: 'savequick', qp: 'savequick', qn: 'savequick', mname: sh && sh.mode === 'meal' ? 'mealsave' : 'dosavemeal', code: 'lookup', qtyIn: sh && sh.entry ? 'saveentry' : 'addfood' };
  if (ob && ['sage', 'scm', 'sft', 'sin', 'slb', 'sgoal'].includes(id)) { e.preventDefault(); return setupNext(); }
  if (id === 'q') { e.target.blur(); return; }
  if (map[id]) { e.preventDefault(); act[map[id]](); }
});
async function importFile(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!data || typeof data.days !== 'object' || typeof data.weights !== 'object') throw new Error('shape');
    openSheet({ mode: 'confirm', title: 'Restore this backup?', text: `It has ${plural(Object.keys(data.days).length, 'logged day')} and ${plural(Object.keys(data.weights).length, 'weigh-in')}. It replaces everything on ${sync ? 'every synced device' : 'this device'}.`, yes: 'Restore',
      onYes: () => { state = { ...blank(), ...data, ts: state.ts }; save(); closeSheet(); toast('Restored'); } });
  } catch { toast('That file isn\'t a Tally backup.'); }
  $('#importfile') && ($('#importfile').value = '');
}
// A new day while the app sat open in the background.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (sync && sync.dirty) syncNow(); return; }
  syncNow();
  const now = L.day();
  if (now !== ui.today) { if (ui.day === ui.today) ui.day = now; ui.today = now; if (!sheetEl.open) render(); }
});
let rz;
window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (tab === 'progress' && state.plan && !sheetEl.open) render(); }, 150); });

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
render();
syncNow();
window.tally = { get state() { return state; }, get sync() { return sync; }, syncNow, L, ui, render };
})();
