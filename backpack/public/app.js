import { feedItems, typeOf } from './ics.js';

const KEY = 'backpack.v1';
const COLORS = ['#e4572e', '#2e86ab', '#3bb273', '#f2a541', '#8e5ccf', '#d6457c', '#17a3a3', '#7a8b99'];
const DAY = 864e5;
const $ = (s) => document.querySelector(s);

// Everything lives on this device. Synced items are replaced on every sync; done
// flags, notes, class moves, colors and personal tasks are the user's and never are.
const BASE = () => ({ feeds: [], items: {}, done: {}, classes: {}, tasks: [], courseOf: {}, notes: {}, view: 'list', demo: false, lastSync: 0 });
function load() {
  try { return { ...BASE(), ...JSON.parse(localStorage.getItem(KEY)) }; } catch { return BASE(); }
}
let S = load();
let filter = null, syncing = false;
const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const monthStart = (t) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); };
let calMonth = monthStart(Date.now()), calDay = startOfDay(Date.now());

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch { setStatus("Couldn't save on this device (private browsing?). Changes will be lost."); }
}

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k.includes('-') || k === 'list' || k === 'style') el.setAttribute(k, v);
    else el[k] = v;
  }
  el.append(...kids.flat().filter((k) => k != null && k !== false && k !== ''));
  return el;
}

function classOf(name) {
  if (!S.classes[name]) S.classes[name] = { color: COLORS[Object.keys(S.classes).length % COLORS.length], label: '', hidden: false };
  return S.classes[name];
}
const label = (name) => classOf(name).label || name;
const own = (it) => it.uid.startsWith('task-');
const isTask = (it) => it.kind !== 'event';
const byDue = (a, b) => a.due.localeCompare(b.due);
const safeUrl = (u) => (/^https?:\/\//.test(u || '') ? u : '');
const rawItems = () => [...Object.values(S.items), ...S.tasks];
const withCourse = (i) => ({ ...i, course: S.courseOf[i.uid] || i.course });

function setStatus(msg) { $('#status').textContent = msg; }

let toastTimer;
function toast(msg, action, fn) {
  const t = $('#toast');
  t.replaceChildren(h('span', {}, msg), ...(action ? [h('button', { type: 'button', onclick: () => { t.hidden = true; fn(); } }, action)] : []));
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 5000);
}

/* ---------- sync ---------- */

async function sync() {
  if (syncing || !S.feeds.length) return;
  syncing = true;
  $('#syncBtn').classList.add('spin');
  setStatus('');
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
  fresh.sort(byDue).forEach((i) => classOf(i.course));
  if (failed.size < S.feeds.length) S.lastSync = Date.now();
  save();
  syncing = false;
  $('#syncBtn').classList.remove('spin');
  if (errors.length) setStatus(navigator.onLine ? 'Sync problem: ' + errors[0] : "You're offline. Showing your last sync.");
  render();
}

function maybeSync() { if (Date.now() - S.lastSync > 15 * 60e3) sync(); }

async function addFeed(input) {
  const url = input.value.trim();
  if (!/^(https|webcal):\/\//i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url)) {
    setStatus('Paste the full calendar link (it starts with https:// or webcal://).');
    return;
  }
  if (S.demo) clearDemo();
  if (!S.feeds.includes(url)) S.feeds.push(url);
  input.value = '';
  save();
  S.lastSync = 0;
  render();
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

/* ---------- sample data ---------- */

function startDemo() {
  const at = (days, hr, min = 59) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hr, min, 0, 0); return d.toISOString(); };
  const demo = [
    ['Problem set 6', 'MATH 221', -1, 23], ['Reading response 3', 'ENG 200', -1, 17, 0], ['Read chapter 7 and take notes', 'HIST 110', 0, 23],
    ['Pre-lab quiz: titration', 'CHEM 101', 0, 18, 0], ['Lecture: The Cold War', 'HIST 110', 1, 10, 15, 'event'],
    ['Problem set 7', 'MATH 221', 2, 23], ['Lab report 4', 'CHEM 101', 4, 23], ['Essay outline', 'ENG 200', 5, 17, 0],
    ['Midterm exam', 'MATH 221', 9, 9, 0], ['Research paper draft', 'ENG 200', 16, 23],
  ];
  demo.forEach(([title, course, days, hr, min, kind], i) => {
    const uid = 'demo-' + i;
    S.items[uid] = { uid, title, course, due: at(days, hr, min), allDay: false, url: '', description: '', kind: kind || 'task', type: typeOf(title), feed: 'demo' };
    classOf(course);
  });
  S.done['demo-0'] = Date.now();
  S.demo = true;
  save();
  render();
}

function clearDemo() {
  for (const uid of Object.keys(S.items)) if (uid.startsWith('demo-')) { delete S.items[uid]; delete S.done[uid]; delete S.notes[uid]; delete S.courseOf[uid]; }
  const used = new Set([...S.tasks.map((t) => t.course), ...Object.values(S.courseOf)]);
  for (const c of Object.keys(S.classes)) if (!used.has(c)) delete S.classes[c];
  S.demo = false;
  save();
}

/* ---------- list ---------- */

const GROUPS = ['Overdue', 'Today', 'Tomorrow', 'This week', 'Later', 'Done'];
function groupOf(item, now) {
  const t = Date.parse(item.due), today = startOfDay(now);
  if (isTask(item) && S.done[item.uid]) return t >= today - 7 * DAY ? 'Done' : null;
  if (t < now) {
    // Feeds include the whole term; anything over two weeks late is hidden instead of flooding Overdue.
    if (!isTask(item) || t < today - 14 * DAY) return null;
    return t < today ? 'Overdue' : 'Today';
  }
  if (t < today + DAY) return 'Today';
  if (t < today + 2 * DAY) return 'Tomorrow';
  if (t < today + 7 * DAY) return 'This week';
  return 'Later';
}

const time = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function fmtDue(it, group) {
  const d = new Date(it.due);
  const at = it.allDay ? '' : time(d);
  if (group === 'Overdue') {
    const days = Math.round((startOfDay(Date.now()) - startOfDay(d)) / DAY);
    return days === 1 ? 'was due yesterday' : `${days} days late`;
  }
  if (group === 'Today' && Date.parse(it.due) < Date.now()) return `was due ${at || 'today'}`;
  if (group === 'Today' || group === 'Tomorrow') return at;
  if (group === 'This week') return d.toLocaleDateString([], { weekday: 'long' }) + (at && ` ${at}`);
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + (at && `, ${at}`);
}

function toggleDone(it, input) {
  const done = input.checked;
  if (done) S.done[it.uid] = Date.now(); else delete S.done[it.uid];
  save();
  input.closest('.item').classList.toggle('done', done);
  setTimeout(render, 400); // let the check animation play before the row moves to Done
  if (done) toast(`Done: ${it.title}`, 'Undo', () => { delete S.done[it.uid]; save(); render(); });
}

function row(it, group) {
  const c = classOf(it.course), done = !!S.done[it.uid], task = isTask(it);
  const ms = Date.parse(it.due) - Date.now();
  const urgent = task && !done && (group === 'Overdue' || (ms < 6 * 3600e3 && group === 'Today'));
  return h('li', { className: `item${done ? ' done' : ''}${task ? '' : ' event'}`, style: `--c:${c.color}` },
    task
      ? h('input', { type: 'checkbox', checked: done, 'aria-label': `Mark "${it.title}" done`, onchange: (e) => toggleDone(it, e.target) })
      : h('span', { className: 'evmark', title: 'Calendar event' }),
    h('button', { type: 'button', className: 'body', onclick: () => openDetail(it.uid) },
      h('span', { className: 'title' }, it.title,
        it.type === 'test' && h('span', { className: 'badge' }, 'Test'),
        S.notes[it.uid] && h('span', { className: 'has-note', title: 'Has notes', 'aria-label': 'has notes' }, '✎')),
      h('span', { className: 'meta' },
        h('span', { className: 'dot' }), label(it.course),
        !task && ' · event',
        fmtDue(it, group) && h('span', { className: urgent ? 'urgent' : '' }, ' · ' + fmtDue(it, group)))));
}

function renderList(list, now) {
  const groups = Object.fromEntries(GROUPS.map((g) => [g, []]));
  for (const it of list) { const g = groupOf(it, now); if (g) groups[g].push(it); }
  const sections = GROUPS.filter((g) => groups[g].length).map((g) => {
    const items = groups[g].sort(byDue);
    const ul = h('ul', {}, items.map((i) => row(i, g)));
    if (g === 'Done') return h('details', { className: 'group' }, h('summary', {}, `Done this week · ${items.length}`), ul);
    const n = items.filter(isTask).length;
    return h('section', { className: 'group' + (g === 'Overdue' ? ' overdue' : '') }, h('h2', {}, g, n > 0 && h('span', { className: 'count' }, n)), ul);
  });
  $('#list').replaceChildren(...(sections.length ? sections : [
    h('div', { className: 'empty' }, h('p', { className: 'big' }, 'Nothing coming up.'), h('p', {}, 'Enjoy it. New assignments show up here on their own.')),
  ]));
}

/* ---------- calendar ---------- */

function renderCalendar(list, now) {
  const first = new Date(calMonth), y = first.getFullYear(), m = first.getMonth();
  const byDay = {};
  for (const it of list) (byDay[startOfDay(Date.parse(it.due))] ||= []).push(it);
  const today = startOfDay(now);
  const cells = Array.from({ length: first.getDay() }, () => h('span', { className: 'cell pad' }));
  for (let d = 1; d <= new Date(y, m + 1, 0).getDate(); d++) {
    const t = new Date(y, m, d).getTime(), its = (byDay[t] || []).sort(byDue);
    const open = its.filter((i) => isTask(i) && !S.done[i.uid]).length;
    cells.push(h('button', {
      type: 'button', className: `cell${t === today ? ' today' : ''}${t === calDay ? ' sel' : ''}${t < today ? ' past' : ''}`,
      'aria-label': `${new Date(t).toLocaleDateString([], { month: 'long', day: 'numeric' })}: ${open} due`,
      'aria-pressed': String(t === calDay), onclick: () => { calDay = t; render(); },
    }, h('span', { className: 'num' }, d),
    h('span', { className: 'dots' }, its.slice(0, 4).map((i) => h('span', { className: `dot${S.done[i.uid] ? ' faded' : ''}${isTask(i) ? '' : ' ring'}`, style: `--c:${classOf(i.course).color}` })))));
  }
  const step = (n) => () => { calMonth = new Date(y, m + n, 1).getTime(); render(); };
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2026, 1, 1 + i).toLocaleDateString([], { weekday: 'narrow' })); // Feb 1 2026 is a Sunday
  const dayItems = (byDay[calDay] || []).sort(byDue);
  $('#list').replaceChildren(
    h('div', { className: 'cal card' },
      h('div', { className: 'calhead' },
        h('button', { type: 'button', className: 'icon', 'aria-label': 'Previous month', onclick: step(-1) }, '‹'),
        h('h2', {}, first.toLocaleDateString([], { month: 'long', year: 'numeric' })),
        h('button', { type: 'button', className: 'icon', 'aria-label': 'Next month', onclick: step(1) }, '›')),
      h('div', { className: 'grid weekdays', 'aria-hidden': 'true' }, weekdays.map((n) => h('span', {}, n))),
      h('div', { className: 'grid' }, cells)),
    h('section', { className: 'group' },
      h('h2', {}, new Date(calDay).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })),
      dayItems.length ? h('ul', {}, dayItems.map((i) => row(i, null))) : h('p', { className: 'empty' }, 'Nothing due this day.')));
}

/* ---------- main render ---------- */

function renderSummary(list, now) {
  const open = list.filter((i) => isTask(i) && !S.done[i.uid]);
  const n = (...gs) => open.filter((i) => gs.includes(groupOf(i, now))).length;
  const stats = [['Overdue', n('Overdue'), 'bad'], ['Due today', n('Today'), 'warn'], ['Next 7 days', n('Today', 'Tomorrow', 'This week'), '']];
  $('#summary').replaceChildren(...stats.map(([name, v, tone]) =>
    h('div', { className: `stat ${v ? tone : 'zero'}` }, h('span', { className: 'num' }, v), h('span', { className: 'lbl' }, name))));
}

function render() {
  const now = Date.now();
  const active = S.feeds.length > 0 || S.demo;
  $('#setup').hidden = active;
  $('#app').hidden = !active;
  $('#syncBtn').hidden = !S.feeds.length;
  $('#demoBanner').hidden = !S.demo;
  updateLastSync();
  if (!active) return;

  const visible = rawItems().map(withCourse).filter((i) => !classOf(i.course).hidden);
  const courses = [...new Set(visible.map((i) => i.course))].sort((a, b) => label(a).localeCompare(label(b)));
  if (filter && !courses.includes(filter)) filter = null;
  const list = filter ? visible.filter((i) => i.course === filter) : visible;

  renderSummary(list, now);
  $('#viewList').setAttribute('aria-pressed', String(S.view !== 'calendar'));
  $('#viewCal').setAttribute('aria-pressed', String(S.view === 'calendar'));
  $('#filters').replaceChildren(...(courses.length > 1 ? [null, ...courses] : []).map((c) =>
    h('button', { type: 'button', className: 'chip', 'aria-pressed': String(filter === c), style: c ? `--c:${classOf(c).color}` : null, onclick: () => { filter = c; render(); } },
      c && h('span', { className: 'dot' }), c ? label(c) : 'All classes')));
  if (S.view === 'calendar') renderCalendar(list, now); else renderList(list, now);

  const all = Object.keys(S.classes).filter((c) => !S.classes[c].hidden);
  const sel = $('#taskClass'), prev = sel.value;
  sel.replaceChildren(...['Personal', ...all.filter((c) => c !== 'Personal').sort()].map((c) => h('option', { value: c }, label(c))));
  sel.value = prev && [...sel.options].some((o) => o.value === prev) ? prev : (filter || 'Personal');
  $('#classOptions').replaceChildren(...Object.keys(S.classes).map((c) => h('option', { value: label(c) })));
}

function updateLastSync() {
  const m = Math.round((Date.now() - S.lastSync) / 60e3);
  $('#lastSync').textContent = !S.lastSync ? '' : m < 1 ? 'Synced just now' : m < 60 ? `Synced ${m} min ago` : m < 1440 ? `Synced ${Math.round(m / 60)} h ago` : `Synced ${Math.round(m / 1440)} d ago`;
}

/* ---------- detail sheet ---------- */

function openDetail(uid) {
  const raw = rawItems().find((i) => i.uid === uid);
  if (!raw) return;
  const it = withCourse(raw), mine = own(it), task = isTask(it), url = safeUrl(it.url);
  const d = new Date(it.due), close = () => $('#detail').close();
  const pad = (n) => String(n).padStart(2, '0');
  const update = (fn) => { fn(); save(); render(); };

  // Typing a class name either picks an existing class (by its display name) or makes a new one.
  const setClass = (e) => {
    const typed = e.target.value.trim();
    if (!typed) return;
    const name = Object.keys(S.classes).find((c) => label(c).toLowerCase() === typed.toLowerCase()) || typed;
    classOf(name);
    update(() => { if (mine) raw.course = name; else S.courseOf[uid] = name; });
    $('#detail').style.setProperty('--c', classOf(name).color);
  };
  const setDue = () => {
    const [y, mo, day] = $('#editDate').value.split('-').map(Number), tv = $('#editTime').value;
    if (!y) return;
    const [hh, mm] = tv ? tv.split(':').map(Number) : [23, 59];
    update(() => { raw.due = new Date(y, mo - 1, day, hh, mm).toISOString(); raw.allDay = !tv; });
  };
  const source = it.uid.startsWith('event-') ? 'Canvas' : /schoology/i.test(it.url) ? 'Schoology' : 'school site';

  $('#detail').style.setProperty('--c', classOf(it.course).color);
  $('#detailBody').replaceChildren(
    h('div', { className: 'sheet-head' },
      mine ? h('input', { className: 'title-input', value: it.title, 'aria-label': 'Task', onchange: (e) => e.target.value.trim() && update(() => { raw.title = e.target.value.trim(); raw.type = typeOf(raw.title); }) })
        : h('h2', {}, it.title, it.type === 'test' && h('span', { className: 'badge' }, 'Test')),
      h('button', { type: 'button', className: 'icon', 'aria-label': 'Close', autofocus: true, onclick: close }, '×')),
    h('dl', {},
      h('dt', {}, 'Class'),
      h('dd', {}, h('input', { list: 'classOptions', value: label(it.course), 'aria-label': 'Class', onchange: setClass }),
        !mine && it.course !== raw.course && h('span', { className: 'muted small' }, ` (was ${label(raw.course)})`)),
      h('dt', {}, task ? 'Due' : 'When'),
      h('dd', {}, mine
        ? h('span', { className: 'row' },
          h('input', { id: 'editDate', type: 'date', value: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, 'aria-label': 'Due date', onchange: setDue }),
          h('input', { id: 'editTime', type: 'time', value: it.allDay ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`, 'aria-label': 'Due time', onchange: setDue }))
        : d.toLocaleString([], { weekday: 'long', month: 'long', day: 'numeric', ...(it.allDay ? {} : { hour: 'numeric', minute: '2-digit' }) }))),
    it.description && h('div', { className: 'desc' }, it.description),
    h('label', { className: 'notes' }, 'My notes',
      h('textarea', { rows: 3, value: S.notes[uid] || '', placeholder: 'Page numbers, who to ask, anything…', oninput: (e) => {
        if (e.target.value.trim()) S.notes[uid] = e.target.value; else delete S.notes[uid];
        save();
      } })),
    h('div', { className: 'row actions' },
      url && h('a', { className: 'button', href: url, target: '_blank', rel: 'noopener' }, `Open in ${source} ↗`),
      task && h('button', { type: 'button', className: 'primary', onclick: () => { update(() => { if (S.done[uid]) delete S.done[uid]; else S.done[uid] = Date.now(); }); close(); } }, S.done[uid] ? 'Mark not done' : 'Mark done'),
      mine && h('button', { type: 'button', className: 'danger', onclick: () => {
        update(() => { S.tasks = S.tasks.filter((t) => t.uid !== uid); delete S.done[uid]; delete S.notes[uid]; });
        close();
        toast('Task deleted', 'Undo', () => update(() => S.tasks.push(raw)));
      } }, 'Delete')));
  $('#detail').showModal();
}

/* ---------- settings ---------- */

function renderSettings() {
  $('#feedList').replaceChildren(...(S.feeds.length ? S.feeds.map((f) =>
    h('li', {}, h('span', { className: 'url', title: f }, f.replace(/^(https?|webcal):\/\//, '')),
      h('button', { type: 'button', onclick: () => removeFeed(f) }, 'Remove'))) : [h('li', { className: 'muted small' }, 'No calendar connected yet.')]));
  const counts = {};
  rawItems().map(withCourse).forEach((i) => { counts[i.course] = (counts[i.course] || 0) + 1; });
  $('#classList').replaceChildren(...Object.keys(S.classes).sort().map((name) => {
    const c = S.classes[name];
    const change = (key) => (e) => { c[key] = e.target.type === 'checkbox' ? !e.target.checked : e.target.value.trim(); save(); render(); };
    return h('li', {},
      h('input', { type: 'color', value: c.color, 'aria-label': `Color for ${name}`, oninput: change('color') }),
      h('input', { type: 'text', value: c.label, placeholder: name, 'aria-label': `Display name for ${name}`, onchange: change('label') }),
      h('span', { className: 'muted small' }, counts[name] || 0),
      h('label', { className: 'show' }, h('input', { type: 'checkbox', checked: !c.hidden, onchange: change('hidden') }), 'Show'));
  }));
}

function exportData() {
  const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(S)], { type: 'application/json' })), download: `backpack-backup-${new Date().toISOString().slice(0, 10)}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importData(file) {
  try {
    const data = JSON.parse(await file.text()), base = BASE();
    const ok = data && typeof data === 'object' && Array.isArray(data.feeds) && data.feeds.every((f) => typeof f === 'string')
      && Object.keys(base).every((k) => data[k] === undefined || (data[k] !== null && typeof data[k] === typeof base[k] && Array.isArray(data[k]) === Array.isArray(base[k])))
      && (data.tasks || []).every((t) => t && typeof t.uid === 'string' && typeof t.title === 'string' && !isNaN(Date.parse(t.due)));
    if (!ok) throw new Error('bad backup');
    S = { ...base, ...data };
    save();
    render();
    renderSettings();
    toast('Backup restored');
    S.lastSync = 0;
    sync();
  } catch { toast("That file isn't a Backpack backup."); }
}

/* ---------- wiring ---------- */

$('#setupForm').addEventListener('submit', (e) => { e.preventDefault(); addFeed($('#setupUrl')); });
$('#feedForm').addEventListener('submit', (e) => { e.preventDefault(); addFeed($('#feedUrl')); });
$('#demoBtn').addEventListener('click', startDemo);
$('#exitDemo').addEventListener('click', () => { clearDemo(); render(); $('#setupUrl').focus(); });
$('#syncBtn').addEventListener('click', sync);
$('#viewList').addEventListener('click', () => { S.view = 'list'; save(); render(); });
$('#viewCal').addEventListener('click', () => { S.view = 'calendar'; save(); render(); });
$('#addToggle').addEventListener('click', () => {
  const form = $('#addForm'), open = form.hidden;
  form.hidden = !open;
  $('#addToggle').setAttribute('aria-expanded', String(open));
  $('#addToggle').textContent = open ? 'Cancel' : '+ Add task';
  if (open) $('#taskTitle').focus();
});
$('#settingsBtn').addEventListener('click', () => { renderSettings(); $('#settings').showModal(); });
$('#closeSettings').addEventListener('click', () => $('#settings').close());
$('#exportBtn').addEventListener('click', exportData);
$('#importFile').addEventListener('change', (e) => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ''; });
$('#eraseBtn').addEventListener('click', (e) => {
  if (e.target.dataset.armed !== '1') { e.target.dataset.armed = '1'; e.target.textContent = 'Tap again to erase'; return; }
  S = BASE();
  save();
  $('#settings').close();
  render();
});
$('#settings').addEventListener('close', () => { $('#eraseBtn').dataset.armed = ''; $('#eraseBtn').textContent = 'Erase everything'; });
$('#detail').addEventListener('close', render); // notes may have changed
for (const dlg of document.querySelectorAll('dialog')) dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // tap backdrop to close

$('#addForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const [y, m, d] = $('#taskDate').value.split('-').map(Number), tv = $('#taskTime').value;
  const [hh, mm] = tv ? tv.split(':').map(Number) : [23, 59];
  const title = $('#taskTitle').value.trim(), course = $('#taskClass').value;
  classOf(course);
  S.tasks.push({ uid: `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, title, course, due: new Date(y, m - 1, d, hh, mm).toISOString(), allDay: !tv, url: '', kind: 'task', type: typeOf(title) });
  $('#taskTitle').value = '';
  $('#taskTime').value = '';
  save();
  render();
  toast(`Added: ${title}`);
});
const todayStr = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 10);
$('#taskDate').value = todayStr();

document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); maybeSync(); } });
setInterval(updateLastSync, 60e3);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

render();
maybeSync();
