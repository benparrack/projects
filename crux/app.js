// Crux: the UI. State lives in localStorage; the send/flash/stats maths is in logic.js.
(function () {
  const L = Logic, $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const KEY = 'crux.v1';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const fmtDate = ts => new Date(ts).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const COLORS = { yellow: '#f2c418', orange: '#f08a24', red: '#d8322c', pink: '#ec6fae', purple: '#8250c4', blue: '#2f74d0',
    green: '#3c9a4d', black: '#232323', white: '#f4f4f0', grey: '#9a9a94', brown: '#8a5a36' };
  const I = {
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    camera: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  };

  // ---------- state ----------
  const fresh = () => ({ routes: [], sessions: [], logs: [], active: null, disc: 'boulder', view: { routes: 'projects', rdisc: 'all' } });
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (s && typeof s === 'object') return { ...fresh(), ...s, view: { ...fresh().view, ...s.view } };
    } catch (e) { /* private mode or bad JSON: start fresh */ }
    return fresh();
  }
  let state = load();
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); return true; }
    catch (e) { toast('Couldn\'t save. Storage may be full: export a backup and remove some photos.'); return false; }
  };
  navigator.storage?.persist?.(); // ask the browser not to evict the logbook

  const route = id => state.routes.find(r => r.id === id);
  const active = () => state.sessions.find(s => s.id === state.active);
  const status = r => L.routeStatus(r.id, state.logs);
  const gradeOf = r => L.gradeName(r.disc, r.grade);
  const label = r => r.name || `${r.color[0].toUpperCase()}${r.color.slice(1)} ${gradeOf(r)}`;
  const statusTag = st => st.flash ? '<span class="tag flash">Flash</span>' : st.sent ? `<span class="tag sent">Sent · ${plural(st.triesToSend, 'try')}</span>`
    : st.tries ? `<span class="tag">${plural(st.tries, 'try')}</span>` : '<span class="tag">New</span>';

  let toastT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2600); }

  // ---------- views ----------
  const views = { climb: renderClimb, routes: renderRoutes, stats: renderStats, more: renderMore };
  const current = () => (location.hash.slice(1) in views ? location.hash.slice(1) : 'climb');
  function render() {
    const v = current();
    $$('.tabs a').forEach(a => a.classList.toggle('on', a.dataset.view === v));
    $('#view').innerHTML = views[v]();
  }

  function clock(s) { const m = Math.floor((Date.now() - s.start) / 60000); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; }

  function renderClimb() {
    const s = active();
    const past = state.sessions.filter(x => x.end).sort((a, b) => b.start - a.start);
    let html = '';
    if (s) {
      const logs = state.logs.filter(l => l.sessionId === s.id).sort((a, b) => b.ts - a.ts);
      const sum = L.sessionSummary(s, state.routes, state.logs);
      html += `<h1>Session</h1><div class="session"><div class="clock" id="clock">${clock(s)}</div>
        <div class="meta">${plural(sum.climbs, 'climb')} · ${plural(sum.sends, 'send')}${sum.hardest ? ` · best ${esc(sum.hardest)}` : ''}</div>
        <div class="row"><button class="btn primary" data-act="log">${I.plus}Log a climb</button><button class="btn" data-act="end">End session</button></div></div>
        <div class="list">${logs.map(l => { const r = route(l.routeId); return r ? `<div class="item">${swatch(r)}<span class="grade">${esc(gradeOf(r))}</span>
          <div class="grow"><div class="title">${esc(label(r))}</div><div class="sub">${l.sent ? (l.tries === 1 ? 'Sent first go' : `Sent in ${l.tries}`) : plural(l.tries, 'try')}</div></div>
          <button class="x" data-act="unlog" data-id="${l.id}" aria-label="Remove">${I.close}</button></div>` : ''; }).join('')
          || '<div class="empty">Nothing logged yet. Tap <b>Log a climb</b> after each problem.</div>'}</div>`;
    } else {
      html += `<h1>Ready to climb?</h1><button class="btn primary big" data-act="start">Start session</button>`;
    }
    html += `<h2>Past sessions</h2><div class="list">${past.map(p => { const sum = L.sessionSummary(p, state.routes, state.logs);
      return `<div class="item"><div class="grow"><div class="title">${fmtDate(p.start)}</div>
        <div class="sub">${sum.minutes} min · ${plural(sum.climbs, 'climb')} · ${plural(sum.sends, 'send')}</div></div>${sum.hardest ? `<span class="grade">${esc(sum.hardest)}</span>` : ''}</div>`; }).join('')
      || '<div class="empty">Your sessions will show up here.</div>'}</div>`;
    return html;
  }
  const swatch = r => r.photo ? `<img class="thumb" src="${r.photo}" alt="">` : `<span class="swatch" style="background:${COLORS[r.color] || '#999'}"></span>`;

  function renderRoutes() {
    const f = state.view.routes, d = state.view.rdisc;
    const list = state.routes.filter(r => (d === 'all' || r.disc === d)).map(r => ({ r, st: status(r) })).filter(({ r, st }) =>
      f === 'archived' ? r.archived : !r.archived && (f === 'all' || (f === 'sent') === st.sent))
      .sort((a, b) => (b.st.last || b.r.created) - (a.st.last || a.r.created));
    const chip = (k, v, name) => `<button class="chip ${state.view[k] === v ? 'on' : ''}" data-act="filter" data-k="${k}" data-v="${v}">${name}</button>`;
    return `<h1>Routes</h1>
      <div class="chips">${chip('routes', 'projects', 'Projects')}${chip('routes', 'sent', 'Sent')}${chip('routes', 'all', 'All')}${chip('routes', 'archived', 'Archived')}</div>
      <div class="chips">${chip('rdisc', 'all', 'Everything')}${Object.keys(L.SCALES).map(k => chip('rdisc', k, L.SCALES[k].short)).join('')}</div>
      ${list.length ? `<div class="grid">${list.map(({ r, st }) => `<button class="card" data-act="route" data-id="${r.id}">
        ${r.photo ? `<img class="pic" src="${r.photo}" alt="">` : `<div class="pic blank" style="background:${COLORS[r.color]}">${esc(gradeOf(r))}</div>`}
        <div class="body"><div class="line1"><span class="dot" style="background:${COLORS[r.color]}"></span><span class="grade">${esc(gradeOf(r))}</span></div>
        <div class="name">${esc(label(r))}</div>${statusTag(st)}</div></button>`).join('')}</div>`
        : `<div class="empty">${f === 'projects' ? 'No open projects. Anything you log without sending lands here.' : 'Nothing here yet.'}</div>`}
      <div style="margin-top:14px"><button class="btn" data-act="newroute">${I.plus}Add a route</button></div>`;
  }

  function renderStats() {
    const d = state.disc, g = i => L.gradeName(d, i);
    const sum = L.summary(state.routes, state.logs, d), pyr = L.pyramid(state.routes, state.logs, d);
    const series = L.hardestBySession(state.sessions, state.routes, state.logs, d);
    const max = Math.max(1, ...pyr.map(p => p.n));
    return `<h1>Stats</h1>
      <div class="chips">${Object.keys(L.SCALES).map(k => `<button class="chip ${d === k ? 'on' : ''}" data-act="disc" data-v="${k}">${L.SCALES[k].name}</button>`).join('')}</div>
      <div class="tiles">
        <div class="tile"><b>${sum.hardest === null ? '–' : esc(g(sum.hardest))}</b><span>Hardest send</span></div>
        <div class="tile"><b>${sum.sends}</b><span>Routes sent</span></div>
        <div class="tile"><b>${sum.sends ? Math.round(sum.flashRate * 100) + '%' : '–'}</b><span>Flashed (${sum.flashes})</span></div>
        <div class="tile"><b>${sum.projects}</b><span>Open projects</span></div>
      </div>
      <h2>Grade pyramid</h2>
      ${pyr.length ? `<div class="pyr">${pyr.map(p => `<div class="bar ${p.n ? '' : 'zero'}"><b>${esc(p.label)}</b><i style="width:${p.n / max * 100}%"></i><em>${p.n}</em></div>`).join('')}</div>`
        : '<div class="empty">Send something and your pyramid starts here.</div>'}
      <h2>Hardest send per session</h2>
      ${series.length >= 2 ? lineChart(series, g) : '<div class="empty">Needs sends in two sessions or more.</div>'}
      <h2>All time</h2>
      <div class="tiles"><div class="tile"><b>${state.sessions.filter(s => s.end).length}</b><span>Sessions</span></div>
        <div class="tile"><b>${state.logs.reduce((a, l) => a + l.tries, 0)}</b><span>Attempts logged</span></div></div>`;
  }

  function lineChart(series, g) {
    const W = 320, H = 180, pl = 36, pr = 10, pt = 10, pb = 22;
    const lo = Math.min(...series.map(p => p.grade)), hi = Math.max(...series.map(p => p.grade)), span = Math.max(1, hi - lo);
    const x = i => pl + (W - pl - pr) * i / (series.length - 1), y = v => pt + (H - pt - pb) * (1 - (v - lo) / span);
    const ticks = []; for (let v = lo; v <= hi; v += Math.max(1, Math.ceil(span / 4))) ticks.push(v);
    return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Hardest send per session">
      ${ticks.map(v => `<line class="ax" x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}"/><text x="4" y="${y(v) + 4}">${esc(g(v))}</text>`).join('')}
      <polyline class="ln" points="${series.map((p, i) => `${x(i)},${y(p.grade)}`).join(' ')}"/>
      ${series.map((p, i) => `<circle class="pt" cx="${x(i)}" cy="${y(p.grade)}" r="4"><title>${fmtDate(p.start)}: ${esc(g(p.grade))}</title></circle>`).join('')}
      <text x="${pl}" y="${H - 4}">${fmtDate(series[0].start)}</text><text x="${W - pr}" y="${H - 4}" text-anchor="end">${fmtDate(series[series.length - 1].start)}</text>
    </svg></div>`;
  }

  function renderMore() {
    let bytes = 0; try { bytes = (localStorage.getItem(KEY) || '').length; } catch (e) {}
    return `<h1>More</h1>
      <h2>Backup</h2>
      <p class="muted">Your logbook lives only in this browser. Export a backup now and then.</p>
      <div class="row"><button class="btn" data-act="export">Export JSON</button><label class="btn">Import JSON<input type="file" accept="application/json,.json" id="import" hidden></label></div>
      <p class="muted">${state.routes.length} routes · ${state.logs.length} logs · about ${Math.round(bytes / 1024)} KB of ~5,000 KB used</p>`;
  }

  // ---------- sheets ----------
  const sheet = $('#sheet');
  const openSheet = html => { $('#sheet-body').innerHTML = html; if (!sheet.open) sheet.showModal(); };
  const closeSheet = () => { sheet.close(); render(); };
  sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });
  sheet.addEventListener('close', () => render());
  const head = (title, back) => `<div class="sheet-head">${back ? `<button class="icon-btn" data-act="${back}" aria-label="Back">${I.back}</button>` : ''}<h3>${title}</h3>
    <button class="icon-btn" data-act="close" aria-label="Close">${I.close}</button></div>`;

  let pick = { q: '', disc: null }, draft = null, tries = 1;
  function pickSheet() {
    const d = pick.disc || state.disc, q = pick.q.toLowerCase();
    const list = state.routes.filter(r => !r.archived && r.disc === d && (!q || label(r).toLowerCase().includes(q) || gradeOf(r).toLowerCase() === q || r.color.includes(q)))
      .map(r => ({ r, st: status(r) })).sort((a, b) => (a.st.sent - b.st.sent) || ((b.st.last || b.r.created) - (a.st.last || a.r.created)));
    openSheet(`${head('Log a climb')}
      <div class="chips">${Object.keys(L.SCALES).map(k => `<button class="chip ${d === k ? 'on' : ''}" data-act="pickdisc" data-v="${k}">${L.SCALES[k].short}</button>`).join('')}</div>
      <button class="btn primary big" data-act="newroute" style="margin-bottom:12px">${I.plus}New route</button>
      <input type="search" id="pickq" placeholder="Search name, colour or grade" value="${esc(pick.q)}" style="margin-bottom:10px">
      <div class="list">${list.map(({ r, st }) => `<button class="item" data-act="pickroute" data-id="${r.id}">${swatch(r)}<span class="grade">${esc(gradeOf(r))}</span>
        <div class="grow"><div class="title">${esc(label(r))}</div></div>${statusTag(st)}</button>`).join('') || '<div class="empty">No routes yet. Add the one you just tried.</div>'}</div>`);
  }

  function routeForm(fromLog) {
    const r = draft, sc = L.SCALES[r.disc];
    openSheet(`${head(r.id ? 'Edit route' : 'New route', fromLog ? 'backpick' : (r.id ? 'backroute' : null))}
      <div class="chips">${Object.keys(L.SCALES).map(k => `<button class="chip ${r.disc === k ? 'on' : ''}" data-act="ddisc" data-v="${k}">${L.SCALES[k].name}</button>`).join('')}</div>
      <div class="field-label">Grade</div><div class="grades" style="margin-bottom:14px">${sc.grades.map((g, i) =>
        `<button class="chip ${r.grade === i ? 'on' : ''}" data-act="dgrade" data-v="${i}">${esc(g)}</button>`).join('')}</div>
      <div class="field-label">Hold colour</div><div class="colors" style="margin-bottom:14px">${Object.entries(COLORS).map(([k, c]) =>
        `<button class="${r.color === k ? 'on' : ''}" style="background:${c}" data-act="dcolor" data-v="${k}" aria-label="${k}" title="${k}"></button>`).join('')}</div>
      <label class="field"><span>Name (optional)</span><input type="text" id="dname" maxlength="60" value="${esc(r.name)}" placeholder="e.g. Left of the arête"></label>
      <div class="field-label">Photo (optional)</div>
      ${r.photo ? `<img class="photo" src="${r.photo}" alt="Route photo">` : ''}
      <div class="row" style="margin-bottom:14px"><label class="btn">${I.camera}${r.photo ? 'Replace photo' : 'Add photo'}<input type="file" accept="image/*" capture="environment" id="dphoto" hidden></label>
        ${r.photo ? '<button class="btn" data-act="dnophoto">Remove</button>' : ''}</div>
      <label class="field"><span>Notes / beta</span><textarea id="dnotes" maxlength="2000" placeholder="Heel hook on the second volume…">${esc(r.notes)}</textarea></label>
      <button class="btn primary big" data-act="dsave" ${r.grade === null ? 'disabled' : ''}>${fromLog ? 'Next' : 'Save route'}</button>`);
  }
  const keepDraftText = () => { if ($('#dname')) { draft.name = $('#dname').value.trim(); draft.notes = $('#dnotes').value; } };

  function triesSheet(r) {
    openSheet(`${head(esc(label(r)), 'backpick')}
      <div class="item" style="margin-bottom:6px">${swatch(r)}<span class="grade">${esc(gradeOf(r))}</span><div class="grow"><div class="sub">${esc(L.SCALES[r.disc].name)}</div></div>${statusTag(status(r))}</div>
      <p class="muted" style="text-align:center;margin:18px 0 0">Attempts this time</p>
      <div class="stepper"><button data-act="tries" data-v="-1" aria-label="Fewer">−</button><output id="tries">${tries}</output><button data-act="tries" data-v="1" aria-label="More">+</button></div>
      <div class="row"><button class="btn big" data-act="savelog" data-id="${r.id}" data-sent="0">Not yet</button><button class="btn good big" data-act="savelog" data-id="${r.id}" data-sent="1">Sent it</button></div>`);
  }

  let confirmDel = false;
  function routeSheet(r) {
    const st = status(r), hist = state.logs.filter(l => l.routeId === r.id).sort((a, b) => b.ts - a.ts);
    openSheet(`${head(esc(label(r)))}
      ${r.photo ? `<img class="photo" src="${r.photo}" alt="Route photo">` : ''}
      <div class="item" style="margin-bottom:12px"><span class="swatch" style="background:${COLORS[r.color]}"></span><span class="grade">${esc(gradeOf(r))}</span>
        <div class="grow"><div class="sub">${esc(L.SCALES[r.disc].name)} · ${plural(st.tries, 'try')} over ${plural(st.sessions, 'session')}</div></div>${statusTag(st)}</div>
      ${r.notes ? `<div class="field-label">Notes / beta</div><p style="white-space:pre-wrap;margin-top:0">${esc(r.notes)}</p>` : ''}
      <div class="row" style="margin-bottom:8px"><button class="btn primary" data-act="logthis" data-id="${r.id}">Log a go</button><button class="btn" data-act="editroute" data-id="${r.id}">Edit</button></div>
      <h2>History</h2><div class="hist">${hist.map(l => `<div><span>${fmtDate(l.ts)}</span><span>${l.sent ? `<b>Sent</b> · ${plural(l.tries, 'try')}` : plural(l.tries, 'try')}</span></div>`).join('')
        || '<p class="muted">Not tried yet.</p>'}</div>
      <div class="row" style="margin-top:18px"><button class="btn" data-act="archive" data-id="${r.id}">${r.archived ? 'Unarchive' : 'Archive (reset / gone)'}</button>
        <button class="btn danger" data-act="delroute" data-id="${r.id}">${confirmDel ? 'Tap again to delete' : 'Delete'}</button></div>`);
  }

  // Shrinks a phone photo so a few hundred fit in localStorage.
  // shortcut: ~40KB JPEGs in localStorage (~5MB total, ~100 photos); move photos to IndexedDB if Ben hits the cap.
  function shrink(file) {
    return new Promise((res, rej) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, 640 / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        res(c.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('bad image')); };
      img.src = url;
    });
  }

  function startSession() {
    const s = { id: uid(), start: Date.now(), end: null };
    state.sessions.push(s); state.active = s.id; save();
  }
  function logClimb(routeId, n, sent) {
    if (!active()) startSession();
    state.logs.push({ id: uid(), routeId, sessionId: state.active, ts: Date.now(), tries: n, sent });
    if (save()) toast(sent ? (n === 1 && status(route(routeId)).flash ? 'Flashed it!' : 'Sent!') : 'Logged. It\'s in your projects.');
  }

  // ---------- events ----------
  let draftFromLog = false;
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act, id = b.dataset.id, v = b.dataset.v;
    if (act !== 'delroute') confirmDel = false;
    switch (act) {
      case 'start': startSession(); render(); break;
      case 'end': {
        const s = active(); s.end = Date.now(); state.active = null;
        if (!state.logs.some(l => l.sessionId === s.id)) state.sessions = state.sessions.filter(x => x !== s); // drop empty sessions
        save(); render(); break;
      }
      case 'log': pick = { q: '', disc: null }; pickSheet(); break;
      case 'pickdisc': pick.disc = v; pickSheet(); break;
      case 'backpick': pickSheet(); break;
      case 'pickroute': case 'logthis': tries = 1; triesSheet(route(id)); break;
      case 'tries': tries = Math.max(1, Math.min(99, tries + Number(v))); $('#tries').textContent = tries; break;
      case 'savelog': logClimb(id, tries, b.dataset.sent === '1'); closeSheet(); break;
      case 'unlog': state.logs = state.logs.filter(l => l.id !== id); save(); render(); break;
      case 'newroute':
        draftFromLog = sheet.open; draft = { id: null, disc: pick.disc || state.disc, grade: null, color: 'yellow', name: '', notes: '', photo: null };
        routeForm(draftFromLog); break;
      case 'editroute': draftFromLog = false; draft = { ...route(id) }; routeForm(false); break;
      case 'backroute': routeSheet(route(draft.id)); break;
      case 'ddisc': keepDraftText(); if (draft.disc !== v) { draft.disc = v; draft.grade = null; } routeForm(draftFromLog); break;
      case 'dgrade': keepDraftText(); draft.grade = Number(v); routeForm(draftFromLog); break;
      case 'dcolor': keepDraftText(); draft.color = v; routeForm(draftFromLog); break;
      case 'dnophoto': keepDraftText(); draft.photo = null; routeForm(draftFromLog); break;
      case 'dsave': {
        keepDraftText();
        if (draft.id) Object.assign(route(draft.id), draft);
        else { draft.id = uid(); draft.created = Date.now(); draft.archived = false; state.routes.push(draft); }
        state.disc = draft.disc;
        if (!save()) break;
        if (draftFromLog) { tries = 1; triesSheet(route(draft.id)); } else routeSheet(route(draft.id));
        break;
      }
      case 'route': routeSheet(route(id)); break;
      case 'archive': { const r = route(id); r.archived = !r.archived; save(); routeSheet(r); break; }
      case 'delroute':
        if (!confirmDel) { confirmDel = true; routeSheet(route(id)); break; }
        confirmDel = false; state.routes = state.routes.filter(r => r.id !== id); state.logs = state.logs.filter(l => l.routeId !== id);
        save(); closeSheet(); toast('Route deleted'); break;
      case 'filter': state.view[b.dataset.k] = v; save(); render(); break;
      case 'disc': state.disc = v; save(); render(); break;
      case 'close': closeSheet(); break;
      case 'export': {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' }));
        a.download = `crux-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(a.href); break;
      }
    }
  });

  document.addEventListener('input', e => {
    if (e.target.id === 'pickq') {
      pick.q = e.target.value; const pos = e.target.selectionStart; pickSheet();
      const q = $('#pickq'); q.focus(); q.setSelectionRange(pos, pos);
    }
  });

  document.addEventListener('change', async e => {
    if (e.target.id === 'dphoto' && e.target.files[0]) {
      keepDraftText();
      try { draft.photo = await shrink(e.target.files[0]); } catch (err) { toast('Couldn\'t read that image'); }
      routeForm(draftFromLog);
    }
    if (e.target.id === 'import' && e.target.files[0]) {
      try {
        const d = JSON.parse(await e.target.files[0].text());
        if (!Array.isArray(d.routes) || !Array.isArray(d.sessions) || !Array.isArray(d.logs)) throw new Error('shape');
        const prev = state; state = { ...fresh(), ...d, view: { ...fresh().view, ...d.view } };
        if (save()) toast(`Imported ${plural(state.routes.length, 'route')}`); else state = prev;
      } catch (err) { toast('That isn\'t a Crux backup'); }
      render();
    }
  });

  addEventListener('hashchange', render);
  setInterval(() => { const c = $('#clock'), s = active(); if (c && s) c.textContent = clock(s); }, 15000);
  render();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js');
})();
