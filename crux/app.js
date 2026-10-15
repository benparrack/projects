// Crux: the UI. State lives in localStorage, photos in IndexedDB; the send/flash/stats maths is in logic.js.
(function () {
  const L = Logic, $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const KEY = 'crux.v1', DAY = 864e5;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const plural = (n, w) => `${n} ${n === 1 ? w : w.endsWith('y') ? w.slice(0, -1) + 'ies' : w + 's'}`;
  const fmtDate = ts => new Date(ts).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const fmtMin = m => m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`;
  const uniq = a => [...new Set(a.filter(Boolean))].sort((x, y) => x.localeCompare(y));
  const COLORS = { yellow: '#f2c418', orange: '#f08a24', red: '#d8322c', pink: '#ec6fae', purple: '#8250c4', blue: '#2f74d0',
    green: '#3c9a4d', black: '#232323', white: '#f4f4f0', grey: '#9a9a94', brown: '#8a5a36' };
  const I = {
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    camera: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/></svg>',
  };

  // ---------- state ----------
  const fresh = () => ({ routes: [], sessions: [], logs: [], active: null, disc: 'boulder', gym: '', lastExport: 0, last: {},
    view: { routes: 'projects', rdisc: 'all', rgym: 'all' } });
  const merge = s => ({ ...fresh(), ...s, view: { ...fresh().view, ...s.view } });
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (s && typeof s === 'object') return merge(s);
    } catch (e) { /* private mode or bad JSON: start fresh */ }
    return fresh();
  }
  let state = load();
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); return true; }
    catch (e) { toast('Couldn\'t save. Export a backup from More.'); return false; }
  };
  navigator.storage?.persist?.(); // ask the browser not to evict the logbook

  // Photos live in IndexedDB (localStorage only holds ~5MB); `photos` mirrors it in memory so rendering stays synchronous.
  let photos = {};
  const dbp = new Promise((res, rej) => {
    const q = indexedDB.open('crux', 1);
    q.onupgradeneeded = () => q.result.createObjectStore('photos');
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  });
  const tx = (mode, fn) => dbp.then(db => new Promise((res, rej) => {
    const t = db.transaction('photos', mode), out = fn(t.objectStore('photos'));
    t.oncomplete = () => res(out); t.onerror = () => rej(t.error);
  }));
  async function loadPhotos() {
    const [keys, vals] = await tx('readonly', s => [s.getAllKeys(), s.getAll()]).then(([k, v]) => [k.result, v.result]);
    photos = Object.fromEntries(keys.map((k, i) => [k, vals[i]]));
  }
  async function putPhoto(id, data) {
    if (data) await tx('readwrite', s => s.put(data, id)); else await tx('readwrite', s => s.delete(id));
    if (data) photos[id] = data; else delete photos[id];
  }

  const route = id => state.routes.find(r => r.id === id);
  const session = id => state.sessions.find(s => s.id === id);
  const active = () => session(state.active);
  const status = r => L.routeStatus(r.id, state.logs);
  const gradeOf = r => L.gradeName(r.disc, r.grade);
  const TAGS = { Green: COLORS.green, Blue: COLORS.blue, Red: COLORS.red, Black: COLORS.black, White: COLORS.white, Gray: COLORS.grey };
  const gradeHtml = r => r.disc === 'tags' ? `<span class="grade tagpill" style="--c:${TAGS[gradeOf(r)]}">${esc(gradeOf(r))}</span>` : `<span class="grade">${esc(gradeOf(r))}</span>`;
  const hold = r => COLORS[r.color] || (r.disc === 'tags' && TAGS[gradeOf(r)]) || '#999'; // tag routes may skip the hold colour
  const est = r => r.disc === 'tags' && r.est != null ? '~' + L.gradeName('boulder', r.est) : ''; // optional Font estimate on a tag route
  const cap = s => s[0].toUpperCase() + s.slice(1);
  const label = r => r.name || (r.disc === 'tags' ? (r.color ? `${cap(r.color)} holds` : `${gradeOf(r)} tag`) : `${cap(r.color)} ${gradeOf(r)}`);
  // Grading systems you've actually used (all of them until you've used any), so Stats/Routes don't offer empty ones.
  const usedDiscs = () => { const u = Object.keys(L.SCALES).filter(k => state.routes.some(r => r.disc === k)); return u.length ? u : Object.keys(L.SCALES); };
  const gyms = () => uniq([...state.sessions.map(s => s.gym), ...state.routes.map(r => r.gym)]);
  const statusTag = st => st.flash ? '<span class="tag flash">Flash</span>' : st.sent ? `<span class="tag sent">Sent · ${plural(st.triesToSend, 'try')}</span>`
    : st.tries ? `<span class="tag">${plural(st.tries, 'try')}</span>` : '<span class="tag">New</span>';
  const swatch = r => photos[r.id] ? `<img class="thumb" src="${photos[r.id]}" alt="">` : `<span class="swatch" style="background:${hold(r)}"></span>`;
  const sub = r => [r.wall, est(r) || L.SCALES[r.disc].short].filter(Boolean).map(esc).join(' · ');
  const buzz = p => navigator.vibrate?.(p);

  let toastT;
  function toast(msg, undo) {
    const t = $('#toast');
    (sheet.open ? sheet : document.body).appendChild(t); // dialogs sit in the top layer, so the toast has to live inside them
    t.innerHTML = esc(msg) + (undo ? ' <button type="button">Undo</button>' : '');
    if (undo) $('button', t).onclick = () => { undo(); t.classList.remove('on'); };
    t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), undo ? 5000 : 2600);
  }

  // ---------- views ----------
  const views = { climb: renderClimb, routes: renderRoutes, stats: renderStats, more: renderMore };
  const current = () => (location.hash.slice(1) in views ? location.hash.slice(1) : 'climb');
  function render() {
    const v = current();
    $$('.tabs a').forEach(a => a.classList.toggle('on', a.dataset.view === v));
    $('#view').innerHTML = views[v]();
    if (v === 'more') storageInfo();
  }

  const elapsed = s => Math.floor((Date.now() - s.start) / 60000);
  const clock = s => { const m = elapsed(s); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
  const needsBackup = () => state.logs.length >= 10 && Date.now() - (state.lastExport || 0) > 14 * DAY;

  function logRow(l, act) {
    const r = route(l.routeId); if (!r) return '';
    return `<div class="item">${swatch(r)}<button class="hit" data-act="${act}" data-id="${r.id}">${gradeHtml(r)}
      <span class="grow"><span class="title">${esc(label(r))}</span><span class="sub">${l.sent ? (l.tries === 1 ? 'Sent first go' : `Sent in ${l.tries}`) : plural(l.tries, 'try')}${[est(r), r.wall].filter(Boolean).map(x => ' · ' + esc(x)).join('')}</span></span></button>
      <button class="x" data-act="unlog" data-id="${l.id}" aria-label="Remove">${I.close}</button></div>`;
  }

  function renderClimb() {
    const s = active();
    const past = state.sessions.filter(x => x.end).sort((a, b) => b.start - a.start);
    let html = '';
    if (s) {
      const logs = state.logs.filter(l => l.sessionId === s.id).sort((a, b) => b.ts - a.ts);
      const sum = L.sessionSummary(s, state.routes, state.logs);
      html += `<h1>Session</h1><div class="session">${s.gym ? `<div class="gym">${I.pin}${esc(s.gym)}</div>` : ''}<div class="clock" id="clock">${clock(s)}</div>
        <div class="meta">${plural(sum.climbs, 'climb')} · ${plural(sum.sends, 'send')}${sum.hardest ? ` · best ${esc(sum.hardest)}` : ''}</div>
        <div class="row"><button class="btn primary" data-act="log">${I.plus}Log a climb</button><button class="btn" data-act="end">End session</button></div></div>
        <div class="list">${logs.map(l => logRow(l, 'logthis')).join('') || '<div class="empty">Nothing logged yet. Tap <b>Log a climb</b> after each problem.</div>'}</div>
        ${logs.length ? '<p class="hint">Tap a climb to log another go on it.</p>' : ''}`;
    } else {
      const week = L.weekly(state.sessions, Date.now(), 1)[0].n;
      html += `<h1>${past.length ? 'Ready for another?' : 'Ready to climb?'}</h1>
        <label class="field"><span>Gym</span><input type="text" id="gym" list="gyms" value="${esc(state.gym)}" placeholder="Where are you climbing?" autocomplete="off" maxlength="40"></label>
        <datalist id="gyms">${gyms().map(g => `<option value="${esc(g)}">`).join('')}</datalist>
        <button class="btn primary big" data-act="start">Start session</button>
        ${past.length ? `<p class="hint">${week ? `${plural(week, 'session')} this week.` : 'No sessions yet this week.'}</p>` : ''}
        ${needsBackup() ? `<div class="banner"><div><b>Back up your logbook</b><br><span>${state.lastExport ? `Last backup ${fmtDate(state.lastExport)}.` : 'You haven\'t made one yet.'} It only lives on this phone.</span></div><button class="btn" data-act="export">Back up</button></div>` : ''}`;
    }
    html += `<h2>Past sessions</h2><div class="list">${past.map(p => { const sum = L.sessionSummary(p, state.routes, state.logs);
      return `<button class="item" data-act="session" data-id="${p.id}"><div class="grow"><div class="title">${fmtDate(p.start)}${p.gym ? ` <span class="muted">· ${esc(p.gym)}</span>` : ''}</div>
        <div class="sub">${fmtMin(sum.minutes)} · ${plural(sum.climbs, 'climb')} · ${plural(sum.sends, 'send')}</div></div>${sum.hardest ? `<span class="grade">${esc(sum.hardest)}</span>` : ''}</button>`; }).join('')
      || '<div class="empty">Your sessions will show up here.</div>'}</div>`;
    return html;
  }

  function renderRoutes() {
    const f = state.view.routes, d = usedDiscs().includes(state.view.rdisc) ? state.view.rdisc : 'all', gs = gyms(), g = gs.includes(state.view.rgym) ? state.view.rgym : 'all';
    const list = state.routes.filter(r => (d === 'all' || r.disc === d) && (g === 'all' || r.gym === g)).map(r => ({ r, st: status(r) })).filter(({ r, st }) =>
      f === 'archived' ? r.archived : !r.archived && (f === 'all' || (f === 'sent') === st.sent))
      .sort((a, b) => (b.st.last || b.r.created) - (a.st.last || a.r.created));
    const stale = f === 'projects' ? list.filter(x => Date.now() - (x.st.last || x.r.created) > 42 * DAY) : []; // likely reset by the gym
    const chip = (k, v, name, on = state.view[k] === v) => `<button class="chip ${on ? 'on' : ''}" data-act="filter" data-k="${k}" data-v="${esc(v)}">${esc(name)}</button>`;
    return `<h1>Routes</h1>
      <div class="chips">${chip('routes', 'projects', 'Projects')}${chip('routes', 'sent', 'Sent')}${chip('routes', 'all', 'All')}${chip('routes', 'archived', 'Archived')}</div>
      ${usedDiscs().length > 1 ? `<div class="chips">${chip('rdisc', 'all', 'All grading')}${usedDiscs().map(k => chip('rdisc', k, L.SCALES[k].short)).join('')}</div>` : ''}
      ${gs.length > 1 ? `<div class="chips scroll">${chip('rgym', 'all', 'All gyms', g === 'all')}${gs.map(x => chip('rgym', x, x, g === x)).join('')}</div>` : ''}
      ${stale.length ? `<button class="linkbtn" data-act="archstale" style="margin:-4px 0 8px">Archive ${plural(stale.length, 'project')} not tried in 6 weeks</button>` : ''}
      ${list.length ? `<div class="grid">${list.map(({ r, st }) => `<button class="card" data-act="route" data-id="${r.id}">
        ${photos[r.id] ? `<img class="pic" src="${photos[r.id]}" alt="">` : `<div class="pic blank ${['white', 'yellow'].includes(r.color) || (!r.color && gradeOf(r) === 'White') ? 'light' : ''}" style="background:${hold(r)}">${esc(gradeOf(r))}</div>`}
        <div class="body"><div class="line1"><span class="dot" style="background:${hold(r)}"></span>${gradeHtml(r)}</div>
        <div class="name">${esc(label(r))}</div>${r.wall || est(r) ? `<div class="wall">${[est(r), r.wall].filter(Boolean).map(esc).join(' · ')}</div>` : ''}${statusTag(st)}</div></button>`).join('')}</div>`
        : `<div class="empty">${f === 'projects' ? 'No open projects. Anything you try without sending lands here.' : 'Nothing here yet.'}</div>`}
      <div style="margin-top:14px"><button class="btn" data-act="newroute">${I.plus}Add a route</button></div>`;
  }

  function renderStats() {
    const used = usedDiscs(), d = used.includes(state.disc) ? state.disc : used[0], g = i => L.gradeName(d, i);
    const sum = L.summary(state.routes, state.logs, d), pyr = L.pyramid(state.routes, state.logs, d);
    const series = L.hardestBySession(state.sessions, state.routes, state.logs, d);
    const weeks = L.weekly(state.sessions.filter(s => s.end || s.id === state.active), Date.now(), 12);
    const max = Math.max(1, ...pyr.map(p => p.n)), wmax = Math.max(1, ...weeks.map(w => w.n));
    return `<h1>Stats</h1>
      ${used.length > 1 ? `<div class="chips">${used.map(k => `<button class="chip ${d === k ? 'on' : ''}" data-act="disc" data-v="${k}">${L.SCALES[k].short}</button>`).join('')}</div>` : ''}
      <div class="tiles">
        <div class="tile"><b>${sum.hardest === null ? '–' : esc(g(sum.hardest))}</b><span>Hardest send</span></div>
        <div class="tile"><b>${sum.sends}</b><span>Routes sent</span></div>
        <div class="tile"><b>${sum.sends ? Math.round(sum.flashRate * 100) + '%' : '–'}</b><span>Flashed (${sum.flashes})</span></div>
        <div class="tile"><b>${sum.projects}</b><span>Open projects</span></div>
      </div>
      <h2>Grade pyramid</h2>
      ${pyr.length ? `<div class="legend"><span><i class="k-flash"></i>Flash</span><span><i class="k-send"></i>Sent after tries</span></div>
        <div class="pyr">${pyr.map(p => `<div class="bar ${p.n ? '' : 'zero'}"><b>${esc(p.label)}</b><span class="track" style="width:${p.n / max * 100}%">
          <i class="f" style="flex:${p.flash}"></i><i class="s" style="flex:${p.n - p.flash}"></i></span><em>${p.n}</em></div>`).join('')}</div>`
        : '<div class="empty">Send something and your pyramid starts here.</div>'}
      <h2>Hardest send per session</h2>
      ${series.length >= 2 ? lineChart(series, g) : '<div class="empty">Needs sends in two sessions or more.</div>'}
      <h2>Sessions per week</h2>
      <div class="weeks" role="img" aria-label="Sessions per week, last 12 weeks">${weeks.map((w, i) => `<div class="wk" title="Week of ${fmtDate(w.start)}: ${plural(w.n, 'session')}">
        <i style="height:${w.n / wmax * 100}%"></i><span>${w.n || ''}</span></div>`).join('')}</div>
      <div class="weeks-axis"><span>${fmtDate(weeks[0].start)}</span><span>This week</span></div>
      <h2>All time</h2>
      <div class="tiles"><div class="tile"><b>${state.sessions.filter(s => s.end).length}</b><span>Sessions</span></div>
        <div class="tile"><b>${state.logs.reduce((a, l) => a + l.tries, 0)}</b><span>Attempts logged</span></div></div>`;
  }

  function lineChart(series, g) {
    const W = 320, H = 180, pl = 36, pr = 10, pt = 10, pb = 22;
    const lo = Math.min(...series.map(p => p.grade)), hi = Math.max(...series.map(p => p.grade)), span = Math.max(1, hi - lo);
    const x = i => pl + (W - pl - pr) * i / (series.length - 1), y = v => pt + (H - pt - pb) * (1 - (v - lo) / span);
    const ticks = []; for (let v = lo; v <= hi; v += Math.max(1, Math.ceil(span / 4))) ticks.push(v);
    return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Hardest send per session">
      ${ticks.map(v => `<line class="ax" x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}"/><text x="4" y="${y(v) + 4}">${esc(g(v))}</text>`).join('')}
      <polyline class="ln" points="${series.map((p, i) => `${x(i)},${y(p.grade)}`).join(' ')}"/>
      ${series.map((p, i) => `<circle class="pt" cx="${x(i)}" cy="${y(p.grade)}" r="4"><title>${fmtDate(p.start)}: ${esc(g(p.grade))}</title></circle>`).join('')}
      <text x="${pl}" y="${H - 4}">${fmtDate(series[0].start)}</text><text x="${W - pr}" y="${H - 4}" text-anchor="end">${fmtDate(series[series.length - 1].start)}</text>
    </svg></div>`;
  }

  function renderMore() {
    return `<h1>More</h1>
      <h2>Backup</h2>
      <p class="muted">Your logbook lives only on this device. A backup is one file with everything, photos included:
        save it to Files, Drive or send it to yourself.</p>
      <div class="row"><button class="btn primary" data-act="export">Back up now</button><label class="btn">Restore a backup<input type="file" accept="application/json,.json" id="import" hidden></label></div>
      <p class="muted">${state.lastExport ? `Last backup ${fmtDate(state.lastExport)}.` : 'No backup yet.'}</p>
      <h2>Storage</h2>
      <p class="muted" id="storage">${state.routes.length} routes · ${state.logs.length} logs · ${Object.keys(photos).length} photos</p>
      <h2>Grades</h2>
      <p class="muted">Bouldering can use Font grades (6A, 6B+…) or your gym's tag colours (Green → Blue → Red → Black → White → Gray, with an optional estimated Font grade); rope routes use French (6a, 6b+…). A <b>flash</b> is a route sent on your very first try.</p>`;
  }
  async function storageInfo() {
    const e = await navigator.storage?.estimate?.().catch(() => null), el = $('#storage');
    if (e && el && e.quota) el.textContent += ` · ${(e.usage / 1e6).toFixed(1)} MB used of ${Math.round(e.quota / 1e6).toLocaleString()} MB available`;
  }

  // ---------- sheets ----------
  const sheet = $('#sheet'), lightbox = $('#lightbox');
  const openSheet = html => {
    $('#sheet-body').innerHTML = html; if (!sheet.open) sheet.showModal();
    $$('#sheet-body .scroll .on, #sheet-body .scroll .near').forEach(c => c.scrollIntoView({ inline: 'center', block: 'nearest' })); // sideways rows open on your pick
  };
  const closeSheet = () => { if (sheet.open) sheet.close(); render(); };
  sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });
  sheet.addEventListener('close', () => { document.body.appendChild($('#toast')); render(); });
  lightbox.addEventListener('click', () => lightbox.close());
  const head = (title, back) => `<div class="sheet-head">${back ? `<button class="icon-btn" data-act="${back}" aria-label="Back">${I.back}</button>` : ''}<h3>${title}</h3>
    <button class="icon-btn" data-act="close" aria-label="Close">${I.close}</button></div>`;

  let pick = { q: '', disc: null }, draft = null, draftPhoto, tries = 1;
  function pickSheet() {
    const d = pick.disc || state.disc, q = pick.q.toLowerCase().trim(), gym = active()?.gym;
    const list = state.routes.filter(r => !r.archived && r.disc === d && (!gym || !r.gym || r.gym === gym)
      && (!q || [label(r), r.wall, r.color].some(t => (t || '').toLowerCase().includes(q)) || gradeOf(r).toLowerCase() === q))
      .map(r => ({ r, st: status(r) })).sort((a, b) => (a.st.sent - b.st.sent) || ((b.st.last || b.r.created) - (a.st.last || a.r.created)));
    openSheet(`${head('Log a climb')}
      <div class="chips">${Object.keys(L.SCALES).map(k => `<button class="chip ${d === k ? 'on' : ''}" data-act="pickdisc" data-v="${k}">${L.SCALES[k].short}</button>`).join('')}</div>
      <div class="field-label">New route: tap its ${d === 'tags' ? 'tag' : 'grade'}</div>
      <div class="grades ${d === 'tags' ? '' : 'chips scroll'}" style="margin-bottom:6px">${L.SCALES[d].grades.map((g, i) =>
        `<button class="chip ${d === 'tags' ? 'tagchip' : ''} ${state.last[d]?.grade === i ? 'on' : ''}" ${d === 'tags' ? `style="--c:${TAGS[g]}"` : ''} data-act="quick" data-v="${i}">${esc(g)}</button>`).join('')}</div>
      <button class="linkbtn" data-act="newroute" style="margin-bottom:14px">${I.plus}New route with photo, name or wall</button>
      ${list.length > 5 || q ? `<input type="search" id="pickq" placeholder="Search name, wall, colour or grade" value="${esc(pick.q)}" style="margin-bottom:10px">` : ''}
      ${list.length ? '<div class="field-label">Or one you\'ve tried</div>' : ''}
      <div class="list">${list.map(({ r, st }) => `<button class="item" data-act="pickroute" data-id="${r.id}">${swatch(r)}${gradeHtml(r)}
        <div class="grow"><div class="title">${esc(label(r))}</div>${r.wall || est(r) ? `<div class="sub">${[est(r), r.wall].filter(Boolean).map(esc).join(' · ')}</div>` : ''}</div>${statusTag(st)}</button>`).join('')
        || `<div class="empty">${q ? 'No match. Add it as a new route above.' : 'No routes here yet. Tap the grade of the one you just tried.'}</div>`}</div>`);
  }

  function routeForm(fromLog) {
    const r = draft, sc = L.SCALES[r.disc], ph = draftPhoto === undefined ? photos[r.id] : draftPhoto;
    const walls = uniq(state.routes.filter(x => !r.gym || x.gym === r.gym).map(x => x.wall));
    // Your usual estimate for this tag colour, so the sideways row opens there instead of at "3".
    const ests = state.routes.filter(x => x.disc === 'tags' && x.grade === r.grade && x.est != null).map(x => x.est).sort((a, b) => a - b), near = ests[ests.length >> 1];
    openSheet(`${head(r.id ? 'Edit route' : 'New route', fromLog ? 'backpick' : (r.id ? 'backroute' : null))}
      <div class="field-label">Grading</div><div class="chips">${Object.keys(L.SCALES).map(k => `<button class="chip ${r.disc === k ? 'on' : ''}" data-act="ddisc" data-v="${k}">${L.SCALES[k].short}</button>`).join('')}</div>
      <div class="field-label">${r.disc === 'tags' ? 'Tag' : 'Grade'}</div><div class="grades" style="margin-bottom:14px">${sc.grades.map((g, i) =>
        `<button class="chip ${r.disc === 'tags' ? 'tagchip' : ''} ${r.grade === i ? 'on' : ''}" ${r.disc === 'tags' ? `style="--c:${TAGS[g]}"` : ''} data-act="dgrade" data-v="${i}">${esc(g)}</button>`).join('')}</div>
      ${r.disc === 'tags' ? `<div class="field-label">Estimated grade (optional)</div><div class="grades chips scroll" style="margin-bottom:14px">${L.SCALES.boulder.grades.map((g, i) =>
        `<button class="chip ${r.est === i ? 'on' : r.est == null && near === i ? 'near' : ''}" data-act="dest" data-v="${i}">${esc(g)}</button>`).join('')}</div>` : ''}
      <div class="field-label">Hold colour${r.disc === 'tags' ? ' (optional)' : ''}</div><div class="colors" style="margin-bottom:14px">${Object.entries(COLORS).map(([k, c]) =>
        `<button class="${r.color === k ? 'on' : ''}" style="background:${c}" data-act="dcolor" data-v="${k}" aria-label="${k}" title="${k}"></button>`).join('')}</div>
      <div class="two"><label class="field"><span>Name (optional)</span><input type="text" id="dname" maxlength="60" value="${esc(r.name)}" placeholder="The pinch one"></label>
        <label class="field"><span>Wall (optional)</span><input type="text" id="dwall" list="walls" maxlength="40" value="${esc(r.wall)}" placeholder="Cave, slab…" autocomplete="off"></label></div>
      <datalist id="walls">${walls.map(w => `<option value="${esc(w)}">`).join('')}</datalist>
      <div class="field-label">Photo (optional)</div>
      ${ph ? `<img class="photo" src="${ph}" alt="Route photo" data-act="zoom">` : ''}
      <div class="row" style="margin-bottom:14px"><label class="btn">${I.camera}${ph ? 'Replace photo' : 'Add photo'}<input type="file" accept="image/*" id="dphoto" hidden></label>
        ${ph ? '<button class="btn" data-act="dnophoto">Remove</button>' : ''}</div>
      <label class="field"><span>Notes / beta</span><textarea id="dnotes" maxlength="2000" placeholder="Heel hook on the second volume…">${esc(r.notes)}</textarea></label>
      <button class="btn primary big" data-act="dsave" ${r.grade === null ? 'disabled' : ''}>${r.grade === null ? 'Pick a grade' : fromLog ? 'Next' : 'Save route'}</button>`);
  }
  const keepDraftText = () => { if ($('#dname')) { draft.name = $('#dname').value.trim(); draft.wall = $('#dwall').value.trim(); draft.notes = $('#dnotes').value; } };

  function triesSheet(r, back) {
    const prior = r.id && state.logs.find(l => l.sessionId === state.active && l.routeId === r.id && !l.sent);
    openSheet(`${head(esc(label(r)), back)}
      <div class="item" style="margin-bottom:6px">${swatch(r)}${gradeHtml(r)}<div class="grow"><div class="sub">${sub(r)}</div></div>${statusTag(status(r))}</div>
      <p class="muted" style="text-align:center;margin:18px 0 0">${prior ? `Extra attempts (already ${plural(prior.tries, 'try')} this session)` : 'Attempts this time'}</p>
      <div class="stepper"><button data-act="tries" data-v="-1" aria-label="Fewer">−</button><output id="tries">${tries}</output><button data-act="tries" data-v="1" aria-label="More">+</button></div>
      <div class="row"><button class="btn big" data-act="savelog" data-id="${r.id || ''}" data-sent="0">Not yet</button><button class="btn good big" data-act="savelog" data-id="${r.id || ''}" data-sent="1">Sent it</button></div>
      ${r.id ? '' : `<button class="linkbtn" data-act="qdetails" style="margin:16px auto 0">${I.camera}Add photo, name or wall</button>`}`);
  }

  let confirmDel = null;
  function routeSheet(r) {
    const st = status(r), hist = state.logs.filter(l => l.routeId === r.id).sort((a, b) => b.ts - a.ts);
    openSheet(`${head(esc(label(r)))}
      ${photos[r.id] ? `<img class="photo" src="${photos[r.id]}" alt="Route photo" data-act="zoom">` : ''}
      <div class="item" style="margin-bottom:12px"><span class="swatch" style="background:${hold(r)}"></span>${gradeHtml(r)}
        <div class="grow"><div class="sub">${[r.gym, r.wall, est(r) ? `${L.SCALES[r.disc].short} (${est(r)})` : L.SCALES[r.disc].short].filter(Boolean).map(esc).join(' · ')}<br>${plural(st.tries, 'try')} over ${plural(st.sessions, 'session')}</div></div>${statusTag(st)}</div>
      ${r.notes ? `<div class="field-label">Notes / beta</div><p class="notes">${esc(r.notes)}</p>` : ''}
      <div class="row" style="margin-bottom:8px"><button class="btn primary" data-act="logthis" data-id="${r.id}">${st.sent ? 'Log a repeat' : 'Log a go'}</button><button class="btn" data-act="editroute" data-id="${r.id}">Edit</button></div>
      <h2>History</h2><div class="hist">${hist.map(l => `<div><span>${fmtDate(l.ts)}</span><span>${l.sent ? `<b>Sent</b> · ${plural(l.tries, 'try')}` : plural(l.tries, 'try')}</span></div>`).join('')
        || '<p class="muted">Not tried yet.</p>'}</div>
      <div class="row" style="margin-top:18px"><button class="btn" data-act="archive" data-id="${r.id}">${r.archived ? 'Unarchive' : 'Archive (reset / gone)'}</button>
        <button class="btn danger" data-act="delroute" data-id="${r.id}">${confirmDel === r.id ? 'Tap again to delete' : 'Delete'}</button></div>`);
  }

  function sessionSheet(s) {
    const sum = L.sessionSummary(s, state.routes, state.logs), logs = state.logs.filter(l => l.sessionId === s.id).sort((a, b) => a.ts - b.ts);
    openSheet(`${head(fmtDate(s.start))}
      <p class="muted" style="margin-top:-6px">${[s.gym, new Date(s.start).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), fmtMin(sum.minutes)].filter(Boolean).map(esc).join(' · ')}</p>
      <div class="tiles three"><div class="tile"><b>${sum.climbs}</b><span>Climbs</span></div><div class="tile"><b>${sum.sends}</b><span>Sends</span></div><div class="tile"><b>${sum.flashes}</b><span>Flashes</span></div></div>
      <h2>Climbs</h2><div class="list">${logs.map(l => logRow(l, 'route')).join('') || '<p class="muted">No climbs left in this session.</p>'}</div>
      <div class="row" style="margin-top:18px"><button class="btn danger" data-act="delsession" data-id="${s.id}">${confirmDel === s.id ? 'Tap again to delete session' : 'Delete session'}</button></div>`);
  }

  function recapSheet(s) {
    const sum = L.sessionSummary(s, state.routes, state.logs), pbs = L.personalBests(s, state.routes, state.logs);
    const sends = state.logs.filter(l => l.sessionId === s.id && l.sent).map(l => route(l.routeId)).filter(Boolean).sort((a, b) => b.grade - a.grade);
    openSheet(`${head('Session done')}
      ${pbs.map(p => `<div class="pb">${I.star}<div><b>New best: ${esc(p.label)}</b><span>${esc(L.SCALES[p.disc].name)}, up from ${esc(p.prev)}</span></div></div>`).join('')}
      <div class="tiles"><div class="tile"><b>${fmtMin(sum.minutes)}</b><span>On the wall${s.gym ? ' at ' + esc(s.gym) : ''}</span></div><div class="tile"><b>${sum.climbs}</b><span>Climbs · ${plural(sum.tries, 'attempt')}</span></div>
        <div class="tile"><b>${sum.sends}</b><span>Sends</span></div><div class="tile"><b>${sum.flashes}</b><span>Flashes</span></div></div>
      ${sends.length ? `<h2>Sent</h2><div class="sendlist">${sends.map(r => `<span class="sendchip"><i style="background:${r.disc === 'tags' ? TAGS[gradeOf(r)] : hold(r)}"></i>${esc(gradeOf(r))}${est(r) ? ` <span class="muted">${esc(est(r))}</span>` : ''}</span>`).join('')}</div>` : ''}
      <button class="btn primary big" data-act="close" style="margin-top:20px">Done</button>`);
  }

  // Shrinks a phone photo: plenty to recognise the holds, small enough to keep hundreds.
  function shrink(file) {
    return new Promise((res, rej) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, 900 / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        res(c.toDataURL('image/jpeg', 0.75));
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('bad image')); };
      img.src = url;
    });
  }

  // A session left running after you go home ends itself at your last climb (or is dropped if nothing was logged).
  function autoEnd() {
    const s = active(); if (!s) return;
    const mine = state.logs.filter(l => l.sessionId === s.id), last = Math.max(s.start, ...mine.map(l => l.ts));
    if (Date.now() - last < 4 * 3600e3) return;
    if (mine.length) s.end = last; else state.sessions = state.sessions.filter(x => x !== s);
    state.active = null; save();
    if (mine.length) toast(`Ended your ${fmtDate(s.start)} session`);
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && active()) { autoEnd(); if (!sheet.open) render(); } });

  function startSession() {
    const gymEl = $('#gym'); if (gymEl) state.gym = gymEl.value.trim();
    const s = { id: uid(), start: Date.now(), end: null, gym: state.gym };
    state.sessions.push(s); state.active = s.id; save();
  }
  // Another go on a route you haven't sent yet this session adds to that entry; a send after a send is a separate repeat.
  function logClimb(routeId, n, sent, snap) {
    if (!active()) startSession();
    const prior = state.logs.find(l => l.sessionId === state.active && l.routeId === routeId && !l.sent);
    if (prior) { prior.tries += n; prior.sent = sent; prior.ts = Date.now(); }
    else state.logs.push({ id: uid(), routeId, sessionId: state.active, ts: Date.now(), tries: n, sent });
    if (!save()) return;
    const st = status(route(routeId));
    buzz(sent ? [30, 50, 80] : 15);
    toast(!sent ? 'Logged. It\'s in your projects.' : st.flash ? 'Flashed it!' : st.sentTs === (prior || state.logs[state.logs.length - 1]).ts ? 'Sent! Project ticked.' : 'Repeat logged',
      () => { state = merge(JSON.parse(snap)); save(); refresh(); });
  }

  async function exportBackup() {
    const data = JSON.stringify({ app: 'crux', version: 2, exported: Date.now(), ...state, photos });
    const name = `crux-backup-${new Date().toISOString().slice(0, 10)}.json`, file = new File([data], name, { type: 'application/json' });
    try {
      if (navigator.canShare?.({ files: [file] }) && matchMedia('(pointer: coarse)').matches) await navigator.share({ files: [file], title: 'Crux backup' });
      else { const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
    } catch (e) { if (e.name === 'AbortError') return; toast('Backup failed: ' + e.message); return; }
    state.lastExport = Date.now(); save(); render(); toast('Backup saved');
  }
  async function importBackup(f) {
    const d = JSON.parse(await f.text());
    if (!Array.isArray(d.routes) || !Array.isArray(d.sessions) || !Array.isArray(d.logs)) throw new Error('shape');
    const ph = { ...(d.photos || {}) };
    for (const r of d.routes) if (typeof r.photo === 'string') { ph[r.id] = r.photo; r.photo = true; } // v1 backups kept photos inline
    delete d.photos; delete d.app; delete d.version; delete d.exported;
    await tx('readwrite', s => { s.clear(); for (const [k, v] of Object.entries(ph)) s.put(v, k); });
    photos = ph; state = merge(d); save();
    toast(`Restored ${plural(state.routes.length, 'route')} and ${plural(Object.keys(ph).length, 'photo')}`);
  }

  // ---------- events ----------
  let draftFromLog = false, pending = null; // pending: a quick-added route that only joins the logbook once a go is logged on it
  function addRoute(r) {
    if (!r.id) Object.assign(r, { id: uid(), created: Date.now(), archived: false, photo: false });
    state.routes.push(r); state.disc = r.disc; state.last[r.disc] = { grade: r.grade, color: r.color };
  }
  const undoable = (msg, apply) => { const snap = JSON.stringify(state); apply(); save(); render(); toast(msg, () => { state = merge(JSON.parse(snap)); save(); refresh(); }); };
  const refresh = () => { if (!sheet.open) return render(); const s = $('#sheet-body [data-act="delsession"]'); s ? sessionSheet(session(s.dataset.id)) : render(); };
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act, id = b.dataset.id, v = b.dataset.v;
    if (act !== 'delroute' && act !== 'delsession') confirmDel = null;
    switch (act) {
      case 'start': startSession(); render(); break;
      case 'end': {
        const s = active(); s.end = Date.now(); state.active = null;
        const empty = !state.logs.some(l => l.sessionId === s.id);
        if (empty) state.sessions = state.sessions.filter(x => x !== s); // drop empty sessions
        save(); render(); if (!empty) recapSheet(s); break;
      }
      case 'log': pick = { q: '', disc: null }; pickSheet(); break;
      case 'pickdisc': pick.disc = v; pickSheet(); break;
      case 'backpick': pickSheet(); break;
      case 'pickroute': case 'logthis': tries = 1; triesSheet(route(id), act === 'pickroute' ? 'backpick' : null); break;
      case 'tries': tries = Math.max(1, Math.min(99, tries + Number(v))); $('#tries').textContent = tries; break;
      case 'savelog': {
        const snap = JSON.stringify(state);
        if (!id && pending) addRoute(pending);
        logClimb(id || pending.id, tries, b.dataset.sent === '1', snap); pending = null; closeSheet(); break;
      }
      case 'quick': {
        const disc = pick.disc || state.disc, last = state.last[disc] || {};
        pending = { disc, grade: Number(v), est: null, color: disc === 'tags' ? null : last.color || 'yellow', name: '', wall: '', notes: '', gym: active()?.gym ?? state.gym };
        tries = 1; triesSheet(pending, 'backpick'); break;
      }
      case 'qdetails': draft = pending; pending = null; draftPhoto = null; draftFromLog = true; routeForm(true); break;
      case 'unlog': { const l = state.logs.find(x => x.id === id), r = l && route(l.routeId);
        undoable(`Removed ${r ? label(r) : 'climb'}`, () => { state.logs = state.logs.filter(x => x.id !== id); }); refresh(); break; }
      case 'newroute': {
        draftFromLog = sheet.open; draftPhoto = null;
        const disc = pick.disc || state.disc, last = state.last[disc] || {};
        draft = { id: null, disc, grade: last.grade ?? null, est: null, color: 'color' in last ? last.color : disc === 'tags' ? null : 'yellow', name: '', wall: '', notes: '', gym: active()?.gym ?? state.gym };
        routeForm(draftFromLog); break;
      }
      case 'editroute': draftFromLog = false; draft = { ...route(id) }; draftPhoto = undefined; routeForm(false); break;
      case 'backroute': routeSheet(route(draft.id)); break;
      case 'ddisc': keepDraftText(); if (draft.disc !== v) { draft.disc = v; draft.grade = state.last[v]?.grade ?? null; } routeForm(draftFromLog); break;
      case 'dgrade': keepDraftText(); draft.grade = Number(v); routeForm(draftFromLog); break;
      case 'dest': keepDraftText(); draft.est = draft.est === Number(v) ? null : Number(v); routeForm(draftFromLog); break;
      case 'dcolor': keepDraftText(); draft.color = draft.disc === 'tags' && draft.color === v ? null : v; routeForm(draftFromLog); break;
      case 'dnophoto': keepDraftText(); draftPhoto = null; routeForm(draftFromLog); break;
      case 'dsave': {
        keepDraftText();
        const isNew = !draft.id;
        if (isNew) Object.assign(draft, { id: uid(), created: Date.now(), archived: false });
        try { if (draftPhoto !== undefined) await putPhoto(draft.id, draftPhoto); }
        catch (err) { toast('Couldn\'t save the photo'); }
        draft.photo = !!photos[draft.id];
        if (draft.disc !== 'tags') delete draft.est;
        if (isNew) addRoute(draft); else Object.assign(route(draft.id), draft);
        if (!save()) break;
        if (draftFromLog) { tries = 1; triesSheet(route(draft.id), 'backpick'); } else routeSheet(route(draft.id));
        break;
      }
      case 'route': routeSheet(route(id)); break;
      case 'session': sessionSheet(session(id)); break;
      case 'zoom': $('#lightbox img').src = b.src; lightbox.showModal(); break;
      case 'archive': { const r = route(id); r.archived = !r.archived; save(); routeSheet(r); toast(r.archived ? 'Archived' : 'Back in your routes'); break; }
      case 'delroute':
        if (confirmDel !== id) { confirmDel = id; routeSheet(route(id)); break; }
        confirmDel = null; closeSheet();
        undoable('Route deleted', () => { state.routes = state.routes.filter(r => r.id !== id); state.logs = state.logs.filter(l => l.routeId !== id); });
        break; // the photo stays in IndexedDB until restore/overwrite so Undo can bring it back
      case 'delsession':
        if (confirmDel !== id) { confirmDel = id; sessionSheet(session(id)); break; }
        confirmDel = null; closeSheet();
        undoable('Session deleted', () => { state.sessions = state.sessions.filter(s => s.id !== id); state.logs = state.logs.filter(l => l.sessionId !== id); });
        break;
      case 'archstale': {
        const old = state.routes.filter(r => !r.archived && !status(r).sent && Date.now() - (status(r).last || r.created) > 42 * DAY);
        undoable(`Archived ${plural(old.length, 'project')}`, () => old.forEach(r => { r.archived = true; })); break;
      }
      case 'filter': state.view[b.dataset.k] = v; save(); render(); break;
      case 'disc': state.disc = v; save(); render(); break;
      case 'close': closeSheet(); break;
      case 'export': exportBackup(); break;
    }
  });

  document.addEventListener('input', e => {
    if (e.target.id === 'pickq') {
      pick.q = e.target.value; const pos = e.target.selectionStart; pickSheet();
      const q = $('#pickq'); q.focus(); q.setSelectionRange(pos, pos);
    }
    if (e.target.id === 'gym') { state.gym = e.target.value.trim(); save(); }
  });

  document.addEventListener('change', async e => {
    if (e.target.id === 'dphoto' && e.target.files[0]) {
      keepDraftText();
      try { draftPhoto = await shrink(e.target.files[0]); } catch (err) { toast('Couldn\'t read that image'); }
      routeForm(draftFromLog);
    }
    if (e.target.id === 'import' && e.target.files[0]) {
      try { await importBackup(e.target.files[0]); } catch (err) { toast('That isn\'t a Crux backup'); }
      e.target.value = ''; render();
    }
  });

  addEventListener('hashchange', () => { if (sheet.open) sheet.close(); render(); });
  setInterval(() => { const c = $('#clock'), s = active(); if (c && s) c.textContent = clock(s); }, 15000);

  (async () => {
    try {
      autoEnd();
      await loadPhotos();
      const old = state.routes.filter(r => typeof r.photo === 'string'); // pre-IndexedDB versions kept photos inline
      for (const r of old) { await putPhoto(r.id, r.photo); r.photo = true; }
      if (old.length) save();
      for (const k of Object.keys(photos)) if (!route(k)) await putPhoto(k, null); // left behind by deleted routes
    } catch (e) { toast('Photos can\'t be stored in this browser'); }
    render();
  })();
  window.crux = { get state() { return state; }, photos: () => photos }; // for e2e
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // Home-screen apps resume rather than reload, so check for a deploy on every resume and reload into it
    // (straight away unless a sheet is open, otherwise when the app is next backgrounded).
    const hadSW = !!navigator.serviceWorker.controller;
    let stale = false;
    navigator.serviceWorker.register('sw.js').then(reg => document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
      else if (stale) location.reload();
    }));
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadSW) return; // first install, nothing new to show
      if (sheet.open) stale = true; else location.reload();
    });
  }
})();
