import { feedItems } from './ics.js';

const KEY = 'backpack.v1';
const COLORS = ['#e4572e', '#2e86ab', '#3bb273', '#f2a541', '#8e5ccf', '#d6457c', '#17a3a3', '#7a8b99'];
const DAY = 864e5;
const $ = (s) => document.querySelector(s);

// Everything lives on this device. Synced items are replaced on every sync;
// done flags, class colors and personal tasks are the user's and never are.
function load() {
  const base = { feeds: [], items: {}, done: {}, classes: {}, tasks: [], lastSync: 0 };
  try { return { ...base, ...JSON.parse(localStorage.getItem(KEY)) }; } catch { return base; }
}
let S = load();
let filter = null;
let syncing = false;

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch { setStatus("Couldn't save on this device (private browsing?). Changes will be lost."); }
}

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k.includes('-')) el.setAttribute(k, v);
    else el[k] = v;
  }
  el.append(...kids.flat().filter((k) => k != null && k !== false));
  return el;
}

function classOf(name) {
  if (!S.classes[name]) S.classes[name] = { color: COLORS[Object.keys(S.classes).length % COLORS.length], label: '', hidden: false };
  return S.classes[name];
}
const label = (name) => classOf(name).label || name;

function setStatus(msg) { $('#status').textContent = msg; }

async function sync() {
  if (syncing || !S.feeds.length) return;
  syncing = true;
  $('#syncBtn').disabled = true;
  setStatus('Syncing…');
  const fresh = [], errors = [], failed = new Set();
  await Promise.all(S.feeds.map(async (f) => {
    try {
      const r = await fetch('/feed?url=' + encodeURIComponent(f));
      const t = await r.text();
      if (!r.ok) throw new Error(t);
      fresh.push(...feedItems(t, f));
    } catch (e) { failed.add(f); errors.push(e.message || 'Network error'); }
  }));
  // A failed feed keeps its last copy, so a bad connection never empties the planner.
  const kept = Object.values(S.items).filter((i) => failed.has(i.feed));
  S.items = Object.fromEntries([...kept, ...fresh].map((i) => [i.uid, i]));
  fresh.forEach((i) => classOf(i.course));
  if (failed.size < S.feeds.length) S.lastSync = Date.now();
  save();
  syncing = false;
  $('#syncBtn').disabled = false;
  setStatus(errors.length ? 'Sync problem: ' + errors[0] : '');
  render();
}

function maybeSync() { if (Date.now() - S.lastSync > 15 * 60e3) sync(); }

async function addFeed(input) {
  const url = input.value.trim();
  if (!/^(https|webcal):\/\//i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url)) {
    setStatus('Paste the full calendar link (it starts with https:// or webcal://).');
    return;
  }
  if (!S.feeds.includes(url)) S.feeds.push(url);
  input.value = '';
  save();
  S.lastSync = 0;
  await sync();
  renderSettings();
}

function removeFeed(url) {
  S.feeds = S.feeds.filter((f) => f !== url);
  S.items = Object.fromEntries(Object.entries(S.items).filter(([, i]) => i.feed !== url));
  save();
  render();
  renderSettings();
}

function startOfDay(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }

const GROUPS = ['Overdue', 'Today', 'Tomorrow', 'This week', 'Later', 'Done'];
function groupOf(item, now) {
  const t = Date.parse(item.due), today = startOfDay(now);
  if (S.done[item.uid]) return t >= today - 7 * DAY ? 'Done' : null;
  // Feeds include the whole term; anything over two weeks late is hidden instead of flooding Overdue.
  if (t < now) return t >= today - 14 * DAY ? 'Overdue' : null;
  if (t < today + DAY) return 'Today';
  if (t < today + 2 * DAY) return 'Tomorrow';
  if (t < today + 7 * DAY) return 'This week';
  return 'Later';
}

function fmtDue(item) {
  const opts = { weekday: 'short', month: 'short', day: 'numeric' };
  if (!item.allDay) Object.assign(opts, { hour: 'numeric', minute: '2-digit' });
  return new Date(item.due).toLocaleString([], opts);
}

function ago(t) {
  const m = Math.round((Date.now() - t) / 60e3);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
}

function row(it) {
  const c = classOf(it.course), done = !!S.done[it.uid];
  const title = it.url ? h('a', { href: it.url, target: '_blank', rel: 'noopener' }, it.title) : it.title;
  return h('li', { className: 'item' + (done ? ' done' : '') },
    h('input', { type: 'checkbox', checked: done, 'aria-label': `Mark "${it.title}" done`, onchange: () => {
      if (S.done[it.uid]) delete S.done[it.uid]; else S.done[it.uid] = Date.now();
      save(); render();
    } }),
    h('div', { className: 'body' },
      h('div', { className: 'title' }, title),
      h('div', { className: 'meta' },
        h('span', { className: 'dot', style: `background:${c.color}` }), label(it.course), ' · ', fmtDue(it),
        it.uid.startsWith('task-') && ' · yours')),
    it.uid.startsWith('task-') && h('button', { className: 'icon', 'aria-label': `Delete "${it.title}"`, onclick: () => {
      S.tasks = S.tasks.filter((t) => t.uid !== it.uid);
      delete S.done[it.uid];
      save(); render();
    } }, '×'));
}

function render() {
  $('#setup').hidden = S.feeds.length > 0;
  $('#lastSync').textContent = S.lastSync ? 'Synced ' + ago(S.lastSync) : '';
  const now = Date.now();
  const all = [...Object.values(S.items), ...S.tasks].filter((i) => !classOf(i.course).hidden);
  const courses = [...new Set(all.map((i) => i.course))].sort((a, b) => label(a).localeCompare(label(b)));
  if (filter && !courses.includes(filter)) filter = null;

  $('#filters').replaceChildren(...(courses.length > 1 ? [null, ...courses] : []).map((c) =>
    h('button', { className: 'chip', 'aria-pressed': String(filter === c), onclick: () => { filter = c; render(); } },
      c && h('span', { className: 'dot', style: `background:${classOf(c).color}` }), c ? label(c) : 'All')));

  const groups = Object.fromEntries(GROUPS.map((g) => [g, []]));
  for (const it of all) {
    if (filter && it.course !== filter) continue;
    const g = groupOf(it, now);
    if (g) groups[g].push(it);
  }
  const sections = GROUPS.filter((g) => groups[g].length).map((g) => {
    const items = groups[g].sort((a, b) => a.due.localeCompare(b.due));
    const list = h('ul', {}, items.map(row));
    return g === 'Done'
      ? h('details', { className: 'group' }, h('summary', {}, `Done (${items.length})`), list)
      : h('section', { className: 'group' + (g === 'Overdue' ? ' overdue' : '') }, h('h2', {}, `${g} `, h('span', { className: 'count' }, items.length)), list);
  });
  $('#list').replaceChildren(...(sections.length ? sections : [h('p', { className: 'empty' }, S.feeds.length ? 'Nothing due. Nice.' : '')]));

  const sel = $('#taskClass'), prev = sel.value;
  sel.replaceChildren(...['Personal', ...courses.filter((c) => c !== 'Personal')].map((c) => h('option', { value: c }, label(c))));
  sel.value = courses.includes(prev) || prev === 'Personal' ? prev : (filter || 'Personal');
}

function renderSettings() {
  $('#feedList').replaceChildren(...S.feeds.map((f) =>
    h('li', {}, h('span', { className: 'url', title: f }, f.replace(/^(https?|webcal):\/\//, '')),
      h('button', { onclick: () => removeFeed(f) }, 'Remove'))));
  $('#classList').replaceChildren(...Object.keys(S.classes).sort().map((name) => {
    const c = S.classes[name];
    const change = (key) => (e) => { c[key] = e.target.type === 'checkbox' ? !e.target.checked : e.target.value.trim(); save(); render(); };
    return h('li', {},
      h('input', { type: 'color', value: c.color, 'aria-label': `Color for ${name}`, oninput: change('color') }),
      h('input', { type: 'text', value: c.label, placeholder: name, 'aria-label': `Display name for ${name}`, onchange: change('label') }),
      h('label', { className: 'show' }, h('input', { type: 'checkbox', checked: !c.hidden, onchange: change('hidden') }), 'Show'));
  }));
}

$('#setupForm').addEventListener('submit', (e) => { e.preventDefault(); addFeed($('#setupUrl')); });
$('#feedForm').addEventListener('submit', (e) => { e.preventDefault(); addFeed($('#feedUrl')); });
$('#syncBtn').addEventListener('click', sync);
$('#settingsBtn').addEventListener('click', () => { renderSettings(); $('#settings').showModal(); });
$('#closeSettings').addEventListener('click', () => $('#settings').close());
$('#addForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const [y, m, d] = $('#taskDate').value.split('-').map(Number);
  const course = $('#taskClass').value;
  classOf(course);
  S.tasks.push({ uid: `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, title: $('#taskTitle').value.trim(), course, due: new Date(y, m - 1, d, 23, 59).toISOString(), allDay: true, url: '' });
  $('#taskTitle').value = '';
  save(); render();
});
$('#taskDate').valueAsDate = new Date(Date.now() - new Date().getTimezoneOffset() * 60e3);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); maybeSync(); } });

render();
maybeSync();
