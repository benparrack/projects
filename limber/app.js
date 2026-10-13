// Limber: the UI. State lives in localStorage; all the routine/streak maths is in logic.js.
(function () {
  const L = Logic, $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const KEY = 'limber.v1', COUNTS_SEC = 120, CHECK_EVERY = 14;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => window.__today || L.dayKey();
  const fmtDay = (k, o = { weekday: 'short', day: 'numeric', month: 'short' }) => L.fromKey(k).toLocaleDateString('en-GB', o);
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const FEEL = ['', 'Tight', 'Stiff', 'Okay', 'Loose', 'Great'];
  const CHECKS = [
    { key: 'reach', name: 'Sit and reach', pose: 'seated-fold', up: true,
      how: 'Sit with legs straight and together, feet flexed. Reach forward slowly and measure fingertips to toes: past your toes is positive, short of them is negative.' },
    { key: 'butterfly', name: 'Butterfly knee height', pose: 'butterfly', up: false,
      how: 'Sit tall in butterfly with heels a fist away from your groin. Let your knees drop, then measure from the floor to the outside of one knee.' },
    { key: 'straddle', name: 'Straddle width', pose: 'straddle', up: true,
      how: 'Sit with legs straight and as wide as is comfortable, back tall against a wall if you like. Measure heel to heel.' },
  ];
  const I = {
    swap: '<svg viewBox="0 0 24 24"><path d="M7 4 4 7l3 3"/><path d="M4 7h12a4 4 0 0 1 4 4"/><path d="m17 20 3-3-3-3"/><path d="M20 17H8a4 4 0 0 1-4-4"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13a.8.8 0 0 0 1.2.7l10.4-6.5a.8.8 0 0 0 0-1.4L9.2 4.8A.8.8 0 0 0 8 5.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><rect x="6.5" y="5" width="4" height="14" rx="1"/><rect x="13.5" y="5" width="4" height="14" rx="1"/></svg>',
    prev: '<svg viewBox="0 0 24 24"><path d="M18 6 10 12l8 6z"/><path d="M6 6v12"/></svg>',
    next: '<svg viewBox="0 0 24 24"><path d="m6 6 8 6-8 6z"/><path d="M18 6v12"/></svg>',
    shuffle: '<svg viewBox="0 0 24 24"><path d="M3 7h3.5c4.5 0 6.5 10 11 10H21"/><path d="M3 17h3.5c1.8 0 3-1.6 4.1-3.6M13.4 9.6C14.5 8 15.7 7 17.5 7H21"/><path d="m18.5 4.5 2.5 2.5-2.5 2.5M18.5 14.5l2.5 2.5-2.5 2.5"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  };

  // ---------- state ----------
  const fresh = () => ({
    sessions: [], checks: [], onboarded: false, plan: null, shuffle: { date: '', salt: 0 }, notified: '',
    settings: { name: '', focus: { ...L.DEFAULT_FOCUS }, goal: 6, voice: true, sound: true, theme: 'auto', mode: 'mat',
      minutes: { mat: 20, couch: 20, quick: 5 }, excluded: [], ntfy: '', remindAt: '19:30', browserNotify: false },
  });
  function load() {
    const d = fresh();
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (s && typeof s === 'object') return { ...d, ...s, settings: { ...d.settings, ...s.settings, minutes: { ...d.settings.minutes, ...(s.settings || {}).minutes } } };
    } catch (e) { /* private mode or bad JSON: start fresh */ }
    return d;
  }
  let state = load();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { toast('Couldn\'t save. Is storage blocked?'); } };

  // ---------- derived ----------
  const daySet = () => L.sessionDays(state.sessions);
  const daysDone = () => daySet().size;
  const phase = () => L.phaseFor(daysDone());
  const lastDone = () => { const m = {}; for (const s of state.sessions) for (const it of s.items || []) if (!m[it.id] || m[it.id] < s.date) m[it.id] = s.date; return m; };
  const set = () => state.settings;
  const salt = () => state.shuffle.date === today() ? state.shuffle.salt : 0;

  function plan() {
    const mode = set().mode, minutes = set().minutes[mode], key = `${today()}|${mode}|${minutes}|${salt()}`;
    if (!state.plan || state.plan.key !== key || !state.plan.items.every(i => stretchById[i.id])) {
      state.plan = { key, items: L.buildRoutine(STRETCHES, { mode, minutes, focus: set().focus, last: lastDone(), excluded: set().excluded,
        today: today(), daysDone: daysDone(), salt: salt() }) };
      save();
    }
    return state.plan.items;
  }
  const replan = () => { state.plan = null; save(); };

  // ---------- small UI helpers ----------
  let toastT;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600);
  }
  const fig = (id, extra = {}) => Figure.svg({ ...stretchById[id].pose, ...extra }, {});
  const areaNames = s => s.areas.map(a => AREAS[a].name);
  const effortDots = n => `<span class="effort" title="Effort ${n} of 3">${[1, 2, 3].map(i => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;
  const holdText = it => `${L.fmtTime(it.hold).replace(/^0:/, '')}${it.hold < 60 ? 's' : ''}${it.sides > 1 ? ' each side' : ''}`;

  let sheetDone = null;
  function openSheet(html, onClose) {
    const w = $('#sheet'), s = $('.sheet', w);
    s.innerHTML = `<button class="icon-btn sheet-close" data-close aria-label="Close">${I.close}</button>${html}`;
    w.hidden = false; sheetDone = onClose || null; s.scrollTop = 0; s.focus();
    return s;
  }
  function closeSheet() {
    const w = $('#sheet'); if (w.hidden) return;
    w.hidden = true; const f = sheetDone; sheetDone = null; if (f) f();
  }
  $('#sheet').addEventListener('click', e => { if (e.target.closest('[data-close]')) closeSheet(); });

  // ---------- routing ----------
  const VIEWS = ['today', 'progress', 'library', 'settings'];
  let view = 'today';
  function go(v) {
    view = VIEWS.includes(v) ? v : 'today';
    for (const n of VIEWS) $('#view-' + n).hidden = n !== view;
    $$('.tabs a').forEach(a => a.dataset.view === view ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
    render();
    window.scrollTo(0, 0);
  }
  const render = () => ({ today: renderToday, progress: renderProgress, library: renderLibrary, settings: renderSettings })[view]();
  window.addEventListener('hashchange', () => go(location.hash.slice(1)));

  function applyTheme() {
    const t = set().theme;
    if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  }

  // ======================================================================
  // TODAY
  // ======================================================================
  function renderToday() {
    const t = today(), days = daySet(), st = L.streak(days, t), ph = phase(), mode = set().mode, M = L.MODES[mode];
    const items = plan(), total = L.totalSeconds(items, mode), hour = new Date().getHours();
    const name = set().name ? `, ${esc(set().name)}` : '';
    const greet = hour < 5 ? 'Up late' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const todays = state.sessions.filter(s => s.date === t);
    let head, lede;
    if (st.doneToday) {
      head = 'Done for today. <em>Well stretched.</em>';
      lede = `${L.fmtMin(todays.reduce((a, s) => a + s.sec, 0))} logged today. Fancy more? Couch mode is a good way to spend an episode.`;
    } else if (st.atRisk) {
      head = `Keep your <em>${st.current}-day</em> streak going.`;
      lede = hour >= 21 ? 'Late one? Couch mode counts just as much. Get on the bed and put something on.' : 'Even a five-minute quick reset keeps it alive.';
    } else if (!state.sessions.length) {
      head = 'Let\'s get those hips <em>moving</em>.';
      lede = 'Pick how much effort you\'ve got today. Every option counts toward your streak, from a full mat session to stretching in bed.';
    } else {
      head = 'Fresh start. <em>Ten minutes</em> counts.';
      lede = 'Streaks break. What matters is the days you stack up over months, and you\'ve got ' + plural(days.size, 'day') + ' already.';
    }
    const wk = L.week(days, t), weekDone = wk.filter(d => d.done).length, goal = set().goal;
    const lastCheck = state.checks.map(c => c.date).sort().pop();
    const checkDue = !lastCheck ? state.sessions.length > 0 : L.daysBetween(lastCheck, t) >= CHECK_EVERY;

    $('#view-today').innerHTML = `
      <div class="today-grid">
        <div class="side-col">
          <div class="today-intro">
            <p class="eyebrow">${esc(fmtDay(t, { weekday: 'long', day: 'numeric', month: 'long' }))} · ${greet}${name}</p>
            <h1 class="display">${head}</h1>
            <p class="lede">${lede}</p>
          </div>
          <div class="streak">
            <div class="streak-n num ${st.current ? '' : 'zero'}">${st.current}</div>
            <div class="streak-label"><b>day streak</b><span>${st.best > st.current ? `Best so far: ${st.best}` : st.current ? 'Your best yet' : 'Stretch today to start one'}</span></div>
          </div>
          <div class="week" aria-label="This week">
            ${wk.map(d => `<div class="${d.done ? 'done' : ''} ${d.today ? 'today' : ''} ${d.future ? 'future' : ''}" title="${esc(fmtDay(d.key))}${d.done ? ': stretched' : ''}">
              <span class="d">${fmtDay(d.key, { weekday: 'narrow' })}</span><span class="pip"></span></div>`).join('')}
          </div>
          <p class="week-note">${weekDone >= goal ? `<b>Weekly goal met.</b> ${weekDone} of ${goal} days.` : `${weekDone} of ${goal} days this week.`}</p>
          ${checkDue ? `<div class="nudge"><span class="nudge-mark">✓</span><div><b>${lastCheck ? 'Time for a check-in' : 'Take your baseline'}</b>
            <p>${lastCheck ? `It's been ${L.daysBetween(lastCheck, t)} days. Three quick measurements show how far you've come.` : 'Three quick measurements, so in a few weeks you can see the difference in numbers.'}</p>
            <button class="btn small" data-act="checkin">Measure now</button></div></div>` : ''}
          <div class="phase">
            <div class="phase-top"><p class="eyebrow" style="margin:0">Your program</p><span class="muted num" style="font-size:13px">Day ${days.size + (st.doneToday ? 0 : 1)}</span></div>
            <div class="phase-name" style="margin-top:6px">${ph.name}</div>
            <div class="phase-steps">${L.PHASES.map((p, i) => `<i class="${i < ph.index ? 'on' : i === ph.index ? 'cur' : ''}" style="--p:${Math.round(ph.progress * 100)}%"></i>`).join('')}</div>
            <p>${ph.note}</p>
            <p class="small">${ph.next ? `${plural(ph.toNext, 'more day')} of stretching to ${ph.next.name}, where holds go up to ${ph.next.hold}s.` : 'Final phase. Holds stay long; just keep showing up.'}</p>
          </div>
        </div>

        <div>
          <p class="eyebrow">How much have you got?</p>
          <div class="modes" role="group" aria-label="Session type">
            ${Object.entries(L.MODES).map(([k, m]) => `<button class="mode" data-mode="${k}" aria-pressed="${k === mode}">
              <small>${m.minutes[0]}–${m.minutes[m.minutes.length - 1]} min</small><b>${m.name}</b><span>${m.blurb}</span></button>`).join('')}
          </div>
          <div class="lengths" role="group" aria-label="Length"><span class="label">Length</span>
            ${M.minutes.map(n => `<button class="chip" data-min="${n}" aria-pressed="${n === set().minutes[mode]}">${n} min</button>`).join('')}
          </div>

          <section class="card plan-card" aria-label="Today's routine">
            <div class="plan-head"><h2>Today's ${M.short.toLowerCase()} routine</h2><span class="meta num">${plural(items.length, 'stretch').replace('stretchs', 'stretches')} · ${L.fmtMin(total)}</span></div>
            <ol class="plan-list">
              ${items.map((it, i) => { const s = stretchById[it.id], tag = s.kind === 'warm' ? 'Warm-up' : i === items.length - 1 && mode === 'mat' ? 'Cool-down' : '';
                return `<li class="plan-item">${fig(it.id)}<div class="t"><button data-info="${s.id}">${esc(s.name)}${tag ? `<span class="tag">${tag}</span>` : ''}</button>
                  <small>${holdText(it)} · ${esc(areaNames(s).slice(0, 2).join(', '))}</small></div>
                  <button class="icon-btn" data-swap="${i}" aria-label="Swap ${esc(s.name)}" title="Swap for another">${I.swap}</button></li>`; }).join('')}
            </ol>
            <div class="plan-foot">
              <button class="btn ghost" data-act="shuffle">${I.shuffle} Shuffle</button>
              <button class="btn ${st.doneToday ? '' : 'clay'} big" data-act="start">${st.doneToday ? 'Go again' : 'Start'} · ${L.fmtMin(total)}</button>
            </div>
          </section>
        </div>
      </div>`;
  }

  $('#view-today').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.mode) { set().mode = b.dataset.mode; save(); renderToday(); }
    else if (b.dataset.min) { set().minutes[set().mode] = +b.dataset.min; save(); renderToday(); }
    else if (b.dataset.info) showStretch(b.dataset.info);
    else if (b.dataset.swap) showSwap(+b.dataset.swap);
    else if (b.dataset.act === 'shuffle') { state.shuffle = { date: today(), salt: salt() + 1 }; save(); renderToday(); toast('New routine, same focus.'); }
    else if (b.dataset.act === 'start') startPlayer(plan(), set().mode);
    else if (b.dataset.act === 'checkin') showCheckin();
  });

  function showSwap(index) {
    const items = plan(), cur = stretchById[items[index].id];
    const opts = L.swapOptions(STRETCHES, items, index, { mode: set().mode, excluded: set().excluded }).slice(0, 8);
    const s = openSheet(`<div class="sheet-body"><p class="eyebrow">Swap</p><h2>Instead of ${esc(cur.name)}</h2>
      ${opts.length ? `<ul class="swap-list">${opts.map(o => `<li><button data-pick="${o.id}">${fig(o.id)}<span><b>${esc(o.name)}</b><small>${esc(areaNames(o).join(', '))} ${effortDots(o.effort)}</small></span></button></li>`).join('')}</ul>`
        : '<p class="empty">Nothing else fits this session type. Try another mode.</p>'}</div>`);
    s.addEventListener('click', e => {
      const b = e.target.closest('[data-pick]'); if (!b) return;
      const n = stretchById[b.dataset.pick], old = items[index];
      items[index] = { id: n.id, hold: n.kind === 'warm' ? L.WARM_SEC : old.hold, sides: n.sides ? 2 : 1 };
      save(); closeSheet(); renderToday(); toast(`Swapped in ${n.name}.`);
    });
  }

  // ======================================================================
  // STRETCH DETAIL
  // ======================================================================
  function showStretch(id) {
    const s = stretchById[id], off = set().excluded.includes(id);
    const where = { mat: 'Mat', bed: 'Bed or sofa', stand: 'Standing' };
    const sh = openSheet(`
      <div class="fig-hero">${fig(id)}</div>
      <div class="sheet-body">
        <p class="eyebrow">${s.kind === 'warm' ? 'Warm-up' : 'Stretch'} · ${esc(areaNames(s)[0])}</p>
        <h2>${esc(s.name)}</h2>${s.alt ? `<p class="muted" style="margin:4px 0 0;font-style:italic">${esc(s.alt)}</p>` : ''}
        <div class="tags">
          ${s.areas.map((a, i) => `<span class="tag-pill ${i ? '' : 'clay'}">${esc(AREAS[a].name)}</span>`).join('')}
          ${s.spots.map(p => `<span class="tag-pill">${where[p]}</span>`).join('')}
          <span class="tag-pill">Effort ${effortDots(s.effort)}</span>
          ${s.sides ? '<span class="tag-pill">Both sides</span>' : ''}
        </div>
        ${s.equipment ? `<p class="muted" style="margin:14px 0 0;font-size:14px">You'll need: ${esc(s.equipment)}</p>` : ''}
        <ol class="howto">${s.steps.map(x => `<li>${esc(x)}</li>`).join('')}</ol>
        <div class="notes">
          <div><h4>Cue</h4><p>${esc(s.cue)}</p></div>
          <div><h4>You should feel</h4><p>${esc(s.feel)}</p></div>
          <div><h4>Avoid</h4><p>${esc(s.avoid)}</p></div>
          <div><h4>Make it easier</h4><p>${esc(s.easier)}</p></div>
          <div><h4>Make it harder</h4><p>${esc(s.harder)}</p></div>
        </div>
        <div class="sheet-actions">
          <button class="btn primary" data-try>${I.play.replace('<svg', '<svg style="fill:currentColor;stroke:none"')} Try it now</button>
          <button class="btn ghost" data-excl>${off ? 'Allow in routines again' : 'Don\'t put this in my routines'}</button>
        </div>
      </div>`);
    sh.addEventListener('click', e => {
      if (e.target.closest('[data-try]')) {
        closeSheet();
        const mode = s.spots.includes('mat') ? 'mat' : s.spots.includes('bed') ? 'couch' : 'quick';
        startPlayer([{ id, hold: L.holdFor(s, phase(), mode), sides: s.sides ? 2 : 1 }], mode, 'Single stretch');
      } else if (e.target.closest('[data-excl]')) {
        const ex = set().excluded;
        set().excluded = off ? ex.filter(x => x !== id) : [...ex, id];
        replan(); closeSheet(); render(); toast(off ? `${s.name} is back in the mix.` : `${s.name} won't come up again.`);
      }
    });
  }

  // ======================================================================
  // PLAYER
  // ======================================================================
  let P = null, audio = null, wake = null;
  const C = 2 * Math.PI * 47;

  function sound(kind) {
    if (!set().sound) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      const notes = { tick: [[880, 0, .05, .05]], start: [[523.25, 0, .9, .16], [783.99, .12, 1.1, .12]],
        end: [[783.99, 0, .7, .14], [659.25, .14, .9, .12], [523.25, .28, 1.2, .12]], done: [[523.25, 0, 1, .14], [659.25, .15, 1, .12], [783.99, .3, 1.2, .12], [1046.5, .45, 1.6, .1]] }[kind];
      const t0 = audio.currentTime;
      for (const [f, at, dur, vol] of notes) {
        const o = audio.createOscillator(), g = audio.createGain();
        o.type = kind === 'tick' ? 'triangle' : 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t0 + at); g.gain.exponentialRampToValueAtTime(vol, t0 + at + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
        o.connect(g).connect(audio.destination); o.start(t0 + at); o.stop(t0 + at + dur + 0.05);
      }
    } catch (e) { /* no audio, carry on */ }
  }
  function say(text) {
    // Couch mode stays quiet (chimes only) so it doesn't talk over whatever you're watching.
    if (!set().voice || P.mode === 'couch' || !window.speechSynthesis) return;
    try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.rate = 0.98; u.lang = 'en-GB'; speechSynthesis.speak(u); } catch (e) { /* ignore */ }
  }
  async function lockScreen(on) {
    try {
      if (on && 'wakeLock' in navigator) wake = await navigator.wakeLock.request('screen');
      else if (!on && wake) { await wake.release(); wake = null; }
    } catch (e) { /* not supported or denied */ }
  }
  document.addEventListener('visibilitychange', () => { if (P && !P.finished && document.visibilityState === 'visible') lockScreen(true); });

  function startPlayer(items, mode, label) {
    P = { items, mode, label: label || L.MODES[mode].name, steps: L.steps(items, mode), i: 0, el: 0, paused: false,
      held: items.map(() => 0), last: performance.now(), half: false, ticked: 0, finished: false };
    const el = $('#player'); el.hidden = false; el.classList.toggle('night', mode === 'couch');
    document.body.style.overflow = 'hidden';
    lockScreen(true); enterStep(true);
    P.timer = setInterval(tick, 200);
  }
  const curStep = () => P.steps[P.i];

  function enterStep(first) {
    const st = curStep(), s = stretchById[P.items[st.item].id];
    P.el = 0; P.half = false; P.ticked = 0; P.last = performance.now();
    if (st.type === 'prep') { if (!first) sound('end'); say(`${first ? '' : 'Next: '}${s.name}.${st.side ? ' First side.' : ''}`); }
    else if (st.type === 'hold') { sound('start'); if (st.side === 2) say('Other side. Hold.'); else say('Hold. ' + s.cue); }
    else if (st.type === 'switch') { sound('end'); say('Switch sides.'); }
    renderPlayer();
  }

  function tick() {
    if (!P || P.paused || P.finished) return;
    const now = performance.now(), dt = Math.min(60, (now - P.last) / 1000); P.last = now;
    P.el += dt;
    const st = curStep();
    if (st.type === 'hold') {
      P.held[st.item] += dt;
      if (!P.half && st.sec >= 60 && P.el >= st.sec / 2) { P.half = true; say('Halfway. Breathe out and sink a little deeper.'); }
    }
    const left = Math.ceil(st.sec - P.el);
    if (left <= 3 && left >= 1 && P.ticked !== left && st.type !== 'switch') { P.ticked = left; sound('tick'); }
    if (P.el >= st.sec) { if (P.i + 1 >= P.steps.length) return finish(true); P.i++; enterStep(); return; }
    updateClock();
  }

  function updateClock() {
    const st = curStep(), el = $('#player');
    const c = $('.p-clock', el); if (!c) return;
    c.textContent = L.fmtTime(Math.ceil(st.sec - P.el));
    $('.arc', el).style.strokeDashoffset = (C * Math.min(1, P.el / st.sec)).toFixed(1);
    const cur = $('.p-bar i.cur', el);
    if (cur) {
      const item = P.items[curStep().item], tot = L.itemSeconds(item, P.mode);
      const before = P.steps.slice(0, P.i).filter(s => s.item === st.item).reduce((a, s) => a + s.sec, 0);
      cur.style.setProperty('--p', Math.min(100, (before + P.el) / tot * 100).toFixed(1) + '%');
    }
  }

  function renderPlayer() {
    const st = curStep(), it = P.items[st.item], s = stretchById[it.id], el = $('#player');
    const phaseLabel = { prep: 'Get into position', hold: 'Hold', switch: 'Switch sides' }[st.type];
    const side = st.side ? (st.side === 1 ? 'First side' : 'Other side') : '';
    const nextItem = P.items[st.item + 1];
    el.classList.toggle('p-paused', P.paused);
    el.innerHTML = `
      <div class="p-top"><div class="p-title">${esc(P.label)} · <b class="num">${st.item + 1}</b> of ${P.items.length}</div>
        <button class="icon-btn" data-p="quit" aria-label="End session" title="End session (Esc)">${I.close}</button></div>
      <div class="p-bar">${P.items.map((_, i) => `<i class="${i < st.item ? 'done' : i === st.item ? 'cur' : ''}"></i>`).join('')}</div>
      <div class="p-stage">
        <div class="p-ring ${st.type === 'hold' ? '' : 'prep'}">
          <svg class="ring" viewBox="0 0 100 100"><circle class="track" cx="50" cy="50" r="47"/><circle class="arc" cx="50" cy="50" r="47" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="0"/></svg>
          ${fig(it.id).replace('class="fig"', `class="fig${st.side === 2 ? ' mirror' : ''}"`)}
          <div class="p-clock" aria-live="off">${L.fmtTime(st.sec)}</div>
        </div>
        <div class="p-phase ${st.type === 'hold' ? '' : 'prep'}">${P.paused ? 'Paused' : phaseLabel}</div>
        <h2 class="p-name">${esc(s.name)}</h2>
        <div class="p-side">${side}</div>
        <div class="p-cue">${st.type === 'prep' && st.side !== 2 ? `<ol>${s.steps.map(x => `<li>${esc(x)}</li>`).join('')}</ol>` : esc(st.type === 'switch' ? 'Come out slowly, then set up on the other side.' : s.cue)}</div>
      </div>
      <div class="p-controls">
        <button class="round" data-p="prev" aria-label="Back" title="Back (←)">${I.prev}</button>
        <button class="round main" data-p="pause" aria-label="${P.paused ? 'Resume' : 'Pause'}" title="Pause (Space)">${P.paused ? I.play : I.pause}</button>
        <button class="round" data-p="next" aria-label="Skip ahead" title="Skip (→)">${I.next}</button>
      </div>
      <div class="p-next">${st.type === 'hold' ? `<button class="btn ghost small" data-p="more">+15 seconds</button> · ` : ''}${nextItem ? `Up next: <b>${esc(stretchById[nextItem.id].name)}</b>` : 'Last one'}</div>`;
    updateClock();
  }

  function move(dir) {
    if (!P || P.finished) return;
    let i = P.i;
    if (dir > 0) { i++; while (i < P.steps.length && P.steps[i].type === 'switch') i++; if (i >= P.steps.length) return finish(true); }
    else { if (P.el < 3) i--; while (i > 0 && P.steps[i].type === 'switch') i--; i = Math.max(0, i); }
    P.i = i; enterStep();
  }
  function togglePause(force) {
    P.paused = force ?? !P.paused; P.last = performance.now();
    if (P.paused) { try { speechSynthesis.cancel(); } catch (e) { /* ignore */ } }
    renderPlayer();
  }

  function quit() {
    const held = P.held.reduce((a, b) => a + b, 0), wasPaused = P.paused;
    togglePause(true);
    const counts = held >= COUNTS_SEC;
    const sh = openSheet(`<div class="sheet-body"><p class="eyebrow">End session</p><h2>Stop here?</h2>
      <p class="lede" style="font-size:15px">${counts ? `You've held stretches for ${L.fmtMin(held)}. That counts for today, so we'll log what you did.` : 'Less than two minutes of holding so far, so this won\'t count toward your streak yet.'}</p>
      <div class="sheet-actions"><button class="btn primary" data-keep>Keep going</button><button class="btn" data-stop>${counts ? 'Finish early' : 'Leave anyway'}</button></div></div>`,
    () => { if (P && !P.finished && !wasPaused) togglePause(false); });
    sh.addEventListener('click', e => {
      if (e.target.closest('[data-keep]')) closeSheet();
      else if (e.target.closest('[data-stop]')) { sheetDone = null; closeSheet(); finish(false); }
    });
  }

  function finish(completed) {
    if (!P || P.finished) return;
    clearInterval(P.timer); P.finished = true; lockScreen(false);
    const sec = Math.round(P.held.reduce((a, b) => a + b, 0));
    const items = P.items.map((it, i) => ({ id: it.id, sec: Math.round(P.held[i]) })).filter(i => i.sec > 0);
    if (sec < COUNTS_SEC) { /* skipping straight through doesn't count either */ closePlayer(); toast('Not logged. Under two minutes of holds.'); return; }
    const wasDone = daySet().has(today());
    const ses = { id: Date.now().toString(36), date: today(), at: new Date().toISOString(), mode: P.mode, label: P.label,
      planned: L.totalSeconds(P.items, P.mode), sec, items, completed, feel: null, note: '' };
    state.sessions.push(ses); save();
    if (!wasDone) pingDone(ses);
    sound('done'); say(completed ? 'Session done. Nice work.' : 'Logged. Nice work.');
    const st = L.streak(daySet(), today()), ph = phase();
    const el = $('#player');
    el.innerHTML = `<div class="finish">
      <div class="big-mark">${I.check}</div>
      <p class="eyebrow">${wasDone ? 'Extra session' : `Day ${daySet().size} of stretching`}</p>
      <h2>${completed ? 'Nice work' : 'Logged'}${set().name ? ', ' + esc(set().name) : ''}.</h2>
      ${ph.from === daySet().size && ph.index > 0 && !wasDone ? `<p class="lede" style="margin:10px auto 0">You've reached <b>${ph.name}</b>. Holds get longer from tomorrow.</p>` : ''}
      <div class="stats"><div><b class="num">${Math.max(1, Math.round(sec / 60))}</b><span>minutes held</span></div>
        <div><b class="num">${items.length}</b><span>stretches</span></div><div><b class="num">${st.current}</b><span>day streak</span></div></div>
      <p class="eyebrow">How do your hips feel?</p>
      <div class="feel" role="group" aria-label="How it felt">${[1, 2, 3, 4, 5].map(n => `<button data-feel="${n}" aria-pressed="false"><b>${n}</b>${FEEL[n]}</button>`).join('')}</div>
      <textarea id="f-note" placeholder="Anything to remember? (optional)" rows="2"></textarea>
      <div class="sheet-actions" style="justify-content:center"><button class="btn clay big" data-p="save">Save and close</button></div>
    </div>`;
    el.onclick = e => {
      const f = e.target.closest('[data-feel]');
      if (f) { ses.feel = +f.dataset.feel; $$('[data-feel]', el).forEach(b => b.setAttribute('aria-pressed', b === f)); }
      if (e.target.closest('[data-p="save"]')) { ses.note = $('#f-note').value.trim(); save(); closePlayer(); toast(st.current > 1 ? `${st.current} days in a row.` : 'Saved. See you tomorrow.'); }
    };
  }

  function closePlayer() {
    if (P && P.timer) clearInterval(P.timer);
    try { speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    lockScreen(false); P = null;
    const el = $('#player'); el.hidden = true; el.onclick = null; el.innerHTML = '';
    document.body.style.overflow = ''; render();
  }

  $('#player').addEventListener('click', e => {
    const b = e.target.closest('[data-p]'); if (!b || !P || P.finished) return;
    const a = b.dataset.p;
    if (a === 'pause') togglePause();
    else if (a === 'next') move(1);
    else if (a === 'prev') move(-1);
    else if (a === 'quit') quit();
    else if (a === 'more') { curStep().sec += 15; updateClock(); toast('+15 seconds'); }
  });

  document.addEventListener('keydown', e => {
    if (!$('#sheet').hidden) { if (e.key === 'Escape') closeSheet(); return; }
    if (!P || P.finished || e.target.matches('input, textarea')) return;
    if (e.key === ' ') { e.preventDefault(); togglePause(); }
    else if (e.key === 'ArrowRight') move(1);
    else if (e.key === 'ArrowLeft') move(-1);
    else if (e.key === 'Escape') quit();
  });

  // ---------- reminders: tell the reminder script you've done today ----------
  function pingDone(ses) {
    const topic = set().ntfy; if (!topic) return;
    // Plain text body, no custom headers: a "simple" CORS request, so no preflight.
    fetch(`https://ntfy.sh/${encodeURIComponent(topic)}-done`, { method: 'POST', body: `done ${ses.date} ${ses.mode} ${Math.round(ses.sec / 60)}` }).catch(() => {});
  }
  // shortcut: browser notifications only fire while Limber is open in a tab; the ntfy script covers the rest.
  function checkBrowserReminder() {
    const s = set(); if (!s.browserNotify || !('Notification' in window) || Notification.permission !== 'granted') return;
    const now = new Date(), [h, m] = (s.remindAt || '19:30').split(':').map(Number);
    if (now.getHours() * 60 + now.getMinutes() < h * 60 + m || state.notified === today() || daySet().has(today())) return;
    state.notified = today(); save();
    const st = L.streak(daySet(), today());
    try { new Notification('Time to stretch', { body: st.atRisk ? `Keep your ${st.current}-day streak alive. Even 5 minutes counts.` : 'Ten minutes for your hips. Couch mode counts.', icon: 'icon-192.png', tag: 'limber' }); } catch (e) { /* ignore */ }
  }

  // ======================================================================
  // CHECK-IN
  // ======================================================================
  function showCheckin() {
    const prev = {};
    for (const c of CHECKS) { const t = L.trend(state.checks, c.key, c.up); if (t) prev[c.key] = t.last; }
    const sh = openSheet(`<div class="sheet-body"><p class="eyebrow">Check-in</p><h2>Measure your range</h2>
      <p class="lede" style="font-size:15px">Warm up a little first (a few leg swings is enough), and use a tape measure or ruler. Skip any you can't do right now.</p>
      <form id="ck" style="margin-top:18px">
        ${CHECKS.map(c => `<div class="check-item">${fig(c.pose)}<div><h4>${c.name}</h4><p>${c.how}</p>
          <div class="unit-input"><input type="text" inputmode="decimal" pattern="-?[0-9]+([.,][0-9]+)?" autocomplete="off" name="${c.key}" aria-label="${c.name} in centimetres" placeholder="${prev[c.key] ?? ''}"><span>cm</span></div></div></div>`).join('')}
        <div class="sheet-actions"><button class="btn clay" type="submit">Save check-in</button><button class="btn ghost" type="button" data-close>Later</button></div>
      </form></div>`);
    $('#ck', sh).addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(e.target), rec = { date: today() };
      for (const c of CHECKS) { const v = parseFloat(String(fd.get(c.key)).replace(',', '.')); if (Number.isFinite(v) && Math.abs(v) < 300) rec[c.key] = v; }
      if (Object.keys(rec).length < 2) { toast('Enter at least one measurement.'); return; }
      state.checks = state.checks.filter(c => c.date !== rec.date).concat(rec); save();
      closeSheet(); render(); toast('Check-in saved. Next one in two weeks.');
    });
  }

  // ======================================================================
  // PROGRESS
  // ======================================================================
  function spark(pts, up) {
    if (pts.length < 2) return '';
    const W = 240, H = 60, vs = pts.map(p => p.v), lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
    const t0 = L.fromKey(pts[0].date), t1 = L.fromKey(pts[pts.length - 1].date), tt = (t1 - t0) || 1;
    const xy = pts.map(p => [6 + (L.fromKey(p.date) - t0) / tt * (W - 12), 6 + (1 - (p.v - lo) / span) * (H - 14)]);
    if (!up) xy.forEach(q => { q[1] = H - 2 - q[1]; }); // lower is better: flip so "up" always reads as progress
    const line = xy.map(q => q.map(n => n.toFixed(1)).join(',')).join(' ');
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" aria-hidden="true"><line class="base" x1="0" x2="${W}" y1="${H - 1}" y2="${H - 1}"/>
      <polygon class="area" points="6,${H - 1} ${line} ${xy[xy.length - 1][0].toFixed(1)},${H - 1}"/><polyline class="ln" points="${line}"/>
      ${xy.map((q, i) => `<circle class="pt ${i === xy.length - 1 ? 'last' : ''}" cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="3"/>`).join('')}</svg>`;
  }

  function renderProgress() {
    const t = today(), days = daySet(), st = L.streak(days, t), totalSec = state.sessions.reduce((a, s) => a + s.sec, 0);
    const perDay = {}; for (const s of state.sessions) perDay[s.date] = (perDay[s.date] || 0) + s.sec;
    // heatmap: 18 Monday-first weeks ending this week
    const WEEKS = 18, start = L.addDays(L.week(days, t)[0].key, -7 * (WEEKS - 1));
    let heat = ['', 'Mon', '', 'Wed', '', 'Fri', '', 'Sun'].map(d => `<span class="dl">${d}</span>`).join('');
    for (let w = 0; w < WEEKS; w++) {
      const wk0 = L.addDays(start, w * 7);
      const firstOfMonth = w === 0 || Array.from({ length: 7 }, (_, i) => L.addDays(wk0, i)).some(k => k.endsWith('-01'));
      const mk = Array.from({ length: 7 }, (_, i) => L.addDays(wk0, i)).find(k => k.endsWith('-01')) || wk0;
      heat += `<span class="m">${firstOfMonth ? L.fromKey(mk).toLocaleDateString('en-GB', { month: 'short' }) : ''}</span>`;
      for (let i = 0; i < 7; i++) {
        const k = L.addDays(wk0, i), sec = perDay[k] || 0;
        const lv = k > t ? 'out' : !sec ? '' : sec < 300 ? 'l1' : sec < 720 ? 'l2' : sec < 1500 ? 'l3' : 'l4';
        heat += `<span class="c ${lv} ${k === t ? 'now' : ''}" title="${esc(fmtDay(k))}${sec ? ': ' + L.fmtMin(sec) : ''}"></span>`;
      }
    }
    const area = L.areaSeconds(state.sessions, STRETCHES, t, 14), maxA = Math.max(1, ...Object.values(area));
    const topF = Math.max(...Object.values(set().focus));
    const feels = state.sessions.filter(s => s.feel).slice(-30);
    const recent = state.sessions.slice(-8).reverse();
    const sessionsWord = state.sessions.length;

    $('#view-progress').innerHTML = `
      <p class="eyebrow">Progress</p>
      <h1 class="display">${days.size ? `${plural(days.size, 'day')} <em>stretched.</em>` : 'Nothing yet. <em>Day one</em> is today.'}</h1>
      <div class="stat-row">
        <div><b class="num">${st.current}</b><span>current streak</span></div>
        <div><b class="num">${st.best}</b><span>best streak</span></div>
        <div><b class="num">${sessionsWord}</b><span>sessions</span></div>
        <div><b class="num">${totalSec >= 6000 ? (totalSec / 3600).toFixed(1) : Math.round(totalSec / 60)}</b><span>${totalSec >= 6000 ? 'hours' : 'minutes'} held</span></div>
      </div>
      <div class="prog-grid">
        <section class="card wide"><div class="section-head"><h3>The last 18 weeks</h3><span class="muted" style="font-size:13px">Darker = longer</span></div>
          <div class="heat-wrap"><div class="heat">${heat}</div></div>
          <div class="heat-key">Less <span class="c" style="background:var(--heat-0)"></span><span class="c" style="background:var(--heat-1)"></span><span class="c" style="background:var(--heat-2)"></span><span class="c" style="background:var(--heat-3)"></span><span class="c" style="background:var(--heat-4)"></span> More</div>
        </section>
        <section class="card wide"><div class="section-head"><h3>Range check-ins</h3><button class="link" data-act="checkin">${state.checks.length ? 'New check-in' : 'Take your baseline'}</button></div>
          <div class="measures">${CHECKS.map(c => { const tr = L.trend(state.checks, c.key, c.up);
            if (!tr) return `<div class="measure"><h4>${c.name}</h4><p class="empty">No measurement yet.</p></div>`;
            const better = tr.pts.length > 1 && tr.delta !== 0 ? tr.improved : null;
            return `<div class="measure"><h4>${c.name}</h4><div class="v num">${tr.last > 0 && c.key === 'reach' ? '+' : ''}${tr.last}<small>cm</small></div>
              <div class="d ${better === true ? 'up' : better === false ? 'down' : ''}">${tr.pts.length > 1 ? `${tr.delta > 0 ? '+' : ''}${tr.delta} cm since ${esc(fmtDay(tr.pts[0].date, { day: 'numeric', month: 'short' }))}${better ? ', better' : ''}` : 'Baseline. Check again in two weeks.'}</div>
              ${spark(tr.pts, c.up)}</div>`; }).join('')}</div>
          <p class="muted" style="font-size:13px;margin:16px 0 0">${CHECKS.map(c => `${c.name}: ${c.up ? 'higher' : 'lower'} is better`).join(' · ')}.</p>
        </section>
        <section class="card"><div class="section-head"><h3>Where the time went</h3><span class="muted" style="font-size:13px">Last 14 days</span></div>
          ${Object.keys(area).length ? `<div class="bars">${Object.keys(AREAS).map(a => `<div class="bar ${set().focus[a] === topF ? 'focus' : ''}"><span>${AREAS[a].name}</span>
            <span class="track"><span class="fill" style="width:${((area[a] || 0) / maxA * 100).toFixed(1)}%;display:block"></span></span><span class="val">${L.fmtMin(area[a] || 0).replace(' min', 'm').replace('<1m', '–')}</span></div>`).join('')}</div>
            <p class="muted" style="font-size:13px;margin:14px 0 0"><span style="color:var(--clay)">■</span> your priority areas</p>` : '<p class="empty">Stretch for a few days and this fills in.</p>'}
        </section>
        <section class="card"><div class="section-head"><h3>How it's felt</h3><span class="muted" style="font-size:13px">Last ${feels.length || ''} sessions</span></div>
          ${feels.length ? `<div class="feel-chart">${feels.map(s => `<i class="f${s.feel}" style="height:${s.feel * 20}%" title="${esc(fmtDay(s.date))}: ${FEEL[s.feel]}"></i>`).join('')}</div>
            <p class="muted" style="font-size:13px;margin:12px 0 0">Average ${(feels.reduce((a, s) => a + s.feel, 0) / feels.length).toFixed(1)} of 5. Taller is looser.</p>` : '<p class="empty">Rate how you feel after each session and the trend shows up here.</p>'}
        </section>
        <section class="card wide"><div class="section-head"><h3>Recent sessions</h3></div>
          ${recent.length ? `<ul class="log">${recent.map(s => `<li><span class="when">${esc(fmtDay(s.date))}</span>
            <span>${esc(s.label || L.MODES[s.mode].name)}${s.completed ? '' : ' <span class="muted">(ended early)</span>'}${s.feel ? ` · <span class="muted">${FEEL[s.feel]}</span>` : ''}${s.note ? `<span class="note">“${esc(s.note)}”</span>` : ''}</span>
            <span class="mins">${L.fmtMin(s.sec)}</span></li>`).join('')}</ul>` : '<p class="empty">Your sessions will be listed here.</p>'}
        </section>
      </div>`;
  }
  $('#view-progress').addEventListener('click', e => { if (e.target.closest('[data-act="checkin"]')) showCheckin(); });

  // ======================================================================
  // LIBRARY
  // ======================================================================
  const lib = { area: 'all', spot: 'all' };
  function renderLibrary() {
    const list = STRETCHES.filter(s => (lib.area === 'all' || s.areas.includes(lib.area)) && (lib.spot === 'all' || s.spots.includes(lib.spot)))
      .sort((a, b) => (a.kind === 'warm') - (b.kind === 'warm') || (lib.area === 'all' ? 0 : (b.areas[0] === lib.area) - (a.areas[0] === lib.area)));
    const chip = (k, v, label) => `<button class="chip" data-${k}="${v}" aria-pressed="${lib[k] === v}">${label}</button>`;
    $('#view-library').innerHTML = `
      <p class="eyebrow">The library</p>
      <h1 class="display">${STRETCHES.length} stretches, <em>explained.</em></h1>
      <p class="lede">Every stretch in your routines, with how to do it, what you should feel, and how to make it easier or harder.</p>
      <div class="filters" role="group" aria-label="Filter">
        ${chip('area', 'all', 'Everything')}${Object.entries(AREAS).map(([k, a]) => chip('area', k, a.name)).join('')}
        <span class="sep"></span>${chip('spot', 'all', 'Anywhere')}${chip('spot', 'mat', 'Mat')}${chip('spot', 'bed', 'Bed or sofa')}${chip('spot', 'stand', 'Standing')}
      </div>
      <div class="lib">${list.map(s => `<button class="lib-card ${set().excluded.includes(s.id) ? 'off' : ''}" data-info="${s.id}">${fig(s.id)}
        <span class="body"><b>${esc(s.name)}</b><small>${s.kind === 'warm' ? 'Warm-up · ' : ''}${esc(areaNames(s).slice(0, 2).join(', '))} ${effortDots(s.effort)}</small>
        ${set().excluded.includes(s.id) ? '<span class="off-tag">Not in routines</span>' : ''}</span></button>`).join('') || '<p class="empty">No stretches match both filters.</p>'}</div>`;
  }
  $('#view-library').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.info) showStretch(b.dataset.info);
    else if (b.dataset.area) { lib.area = b.dataset.area; renderLibrary(); }
    else if (b.dataset.spot) { lib.spot = b.dataset.spot; renderLibrary(); }
  });

  // ======================================================================
  // SETTINGS
  // ======================================================================
  function renderSettings() {
    const s = set(), FL = [[0, 'Skip'], [1, 'Light'], [2, 'Normal'], [3, 'Priority']];
    const seg = (name, val, opts) => `<div class="seg" role="group">${opts.map(([v, l]) => `<button data-set="${name}" data-v="${v}" aria-pressed="${String(val) === String(v)}">${l}</button>`).join('')}</div>`;
    const sw = (name, on, label, small) => `<label class="toggle-row"><span>${label}${small ? `<small>${small}</small>` : ''}</span><span class="switch"><input type="checkbox" data-toggle="${name}" ${on ? 'checked' : ''}><span></span></span></label>`;
    const notifState = !('Notification' in window) ? 'unsupported' : Notification.permission;
    $('#view-settings').innerHTML = `
      <p class="eyebrow">Settings</p>
      <h1 class="display" style="margin-bottom:30px">Make it <em>yours.</em></h1>
      <div class="settings">
        <section class="set-group"><header><h3>Focus areas</h3><p>Priority areas show up more and get the longest holds. Skip leaves an area out unless a stretch covers it on the side.</p></header>
          <div class="focus-rows">${Object.entries(AREAS).map(([k, a]) => `<div class="focus-row"><span>${a.name}<small>${a.long}</small></span>${seg('focus.' + k, s.focus[k] ?? 1, FL)}</div>`).join('')}</div></section>
        <section class="set-group"><header><h3>You</h3><p>Your weekly goal is how many days you're aiming for. The streak still counts every day.</p></header>
          <div><div class="field"><label for="s-name">Name (optional)</label><input id="s-name" type="text" value="${esc(s.name)}" maxlength="30" autocomplete="given-name"></div>
            <div class="field"><label>Days per week</label>${seg('goal', s.goal, [[3, '3'], [4, '4'], [5, '5'], [6, '6'], [7, 'Every day']])}</div></div></section>
        <section class="set-group"><header><h3>During a session</h3><p>Couch mode always uses chimes only, so it doesn't talk over your show.</p></header>
          <div>${sw('voice', s.voice, 'Voice guidance', 'Reads out each stretch and when to switch sides')}${sw('sound', s.sound, 'Chimes', 'A soft tone at the start and end of each hold')}
            <div class="toggle-row"><span>Appearance</span>${seg('theme', s.theme, [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']])}</div></div></section>
        <section class="set-group" id="reminders"><header><h3>Reminders</h3><p>Phone notifications via the free ntfy app. They only nag on days you haven't stretched yet.</p></header>
          <div>
            <ol class="steps-list">
              <li>Install <b>ntfy</b> on your phone (Android or iOS) and subscribe to the topic below.</li>
              <li>Run the reminder script on your computer (see <code>reminders/README.md</code>). It checks in the evening and pings you if today isn't done.</li>
              <li>Finishing a session here tells the script you're done, so it stays quiet.</li>
            </ol>
            <div class="field"><label for="s-ntfy">Your private topic</label><div class="row"><input id="s-ntfy" type="text" value="${esc(s.ntfy)}" placeholder="limber-…" spellcheck="false" autocomplete="off">
              <button class="btn small" data-act="gen">${s.ntfy ? 'New' : 'Generate'}</button>${s.ntfy ? '<button class="btn small" data-act="test">Send test</button>' : ''}</div>
              <small class="muted" style="font-size:12.5px">Anyone who knows the topic name can read it, so keep it random.</small></div>
            <div class="toggle-row"><span>Browser reminder too<small>${notifState === 'denied' ? 'Notifications are blocked for this site in your browser settings.' : notifState === 'unsupported' ? 'Not supported in this browser.' : 'Only fires while Limber is open in a tab.'}</small></span>
              <span style="display:flex;gap:10px;align-items:center"><input type="time" id="s-time" value="${esc(s.remindAt)}" style="width:auto;padding:6px 8px" aria-label="Reminder time">
              <span class="switch"><input type="checkbox" data-toggle="browserNotify" ${s.browserNotify ? 'checked' : ''} ${notifState === 'unsupported' || notifState === 'denied' ? 'disabled' : ''}><span></span></span></span></div>
          </div></section>
        <section class="set-group"><header><h3>Your data</h3><p>Everything is stored in this browser only. Export a backup now and then, or to move to another device.</p></header>
          <div><div class="sheet-actions" style="margin-top:0"><button class="btn" data-act="export">Export backup</button><button class="btn" data-act="import">Import backup</button>
            <button class="btn ghost" data-act="reset" style="color:var(--clay-ink)">Erase everything</button></div>
            <input type="file" id="s-file" accept="application/json,.json" hidden>
            <p class="muted" style="font-size:13px;margin:14px 0 0">${plural(state.sessions.length, 'session')}, ${plural(state.checks.length, 'check-in')}${set().excluded.length ? `, ${set().excluded.length} hidden stretch${set().excluded.length > 1 ? 'es' : ''}` : ''}.</p></div></section>
      </div>`;
  }

  const vs = $('#view-settings');
  vs.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const s = set();
    if (b.dataset.set) {
      const [k, sub] = b.dataset.set.split('.'), v = isNaN(+b.dataset.v) ? b.dataset.v : +b.dataset.v;
      if (sub) s[k][sub] = v; else s[k] = v;
      if (k === 'focus') replan();
      if (k === 'theme') applyTheme();
      save(); renderSettings();
    } else if (b.dataset.act === 'gen') {
      s.ntfy = 'limber-' + Array.from(crypto.getRandomValues(new Uint8Array(8)), x => 'abcdefghjkmnpqrstuvwxyz23456789'[x % 31]).join('');
      save(); renderSettings(); toast('New topic. Subscribe to it in the ntfy app.');
    } else if (b.dataset.act === 'test') {
      fetch(`https://ntfy.sh/${encodeURIComponent(s.ntfy)}`, { method: 'POST', body: 'Limber test: reminders will arrive here.' })
        .then(r => toast(r.ok ? 'Sent. Check your phone.' : 'ntfy said no (' + r.status + ').')).catch(() => toast('Couldn\'t reach ntfy.sh.'));
    } else if (b.dataset.act === 'export') {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' }));
      a.download = `limber-backup-${today()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } else if (b.dataset.act === 'import') $('#s-file').click();
    else if (b.dataset.act === 'reset') {
      const sh = openSheet(`<div class="sheet-body"><p class="eyebrow">Erase everything</p><h2>Start over?</h2>
        <p class="lede" style="font-size:15px">This deletes ${plural(state.sessions.length, 'session')}, your check-ins and your settings from this browser. Export a backup first if you might want them.</p>
        <div class="sheet-actions"><button class="btn clay" data-yes>Erase</button><button class="btn ghost" data-close>Cancel</button></div></div>`);
      $('[data-yes]', sh).onclick = () => { state = fresh(); save(); closeSheet(); applyTheme(); location.hash = '#today'; go('today'); onboard(); };
    }
  });
  vs.addEventListener('change', e => {
    const t = e.target, s = set();
    if (t.dataset.toggle === 'browserNotify' && t.checked && Notification.permission !== 'granted') {
      Notification.requestPermission().then(p => { s.browserNotify = p === 'granted'; save(); renderSettings(); if (p !== 'granted') toast('Permission not granted.'); });
      return;
    }
    if (t.dataset.toggle) { s[t.dataset.toggle] = t.checked; save(); }
    else if (t.id === 's-name') { s.name = t.value.trim().slice(0, 30); save(); }
    else if (t.id === 's-ntfy') { s.ntfy = t.value.trim().replace(/[^\w-]/g, ''); save(); renderSettings(); }
    else if (t.id === 's-time') { s.remindAt = t.value || '19:30'; state.notified = ''; save(); }
    else if (t.id === 's-file' && t.files[0]) {
      t.files[0].text().then(txt => {
        const d = JSON.parse(txt);
        if (!d || !Array.isArray(d.sessions) || !d.settings) throw new Error('shape');
        d.sessions = d.sessions.filter(x => x && /^\d{4}-\d\d-\d\d$/.test(x.date) && Number.isFinite(x.sec));
        d.checks = Array.isArray(d.checks) ? d.checks.filter(x => x && /^\d{4}-\d\d-\d\d$/.test(x.date)) : [];
        localStorage.setItem(KEY, JSON.stringify(d)); state = load(); state.plan = null; save(); applyTheme(); renderSettings();
        toast(`Imported ${plural(state.sessions.length, 'session')}.`);
      }).catch(() => toast('That doesn\'t look like a Limber backup.'));
      t.value = '';
    }
  });

  // ======================================================================
  // ONBOARDING
  // ======================================================================
  function onboard() {
    const picked = new Set(['adductors', 'abductors', 'hamstrings']);
    const sh = openSheet(`<div class="sheet-body">
      <p class="eyebrow">Welcome to Limber</p>
      <h2 style="font-size:32px">A little stretching, <em style="color:var(--clay)">every day.</em></h2>
      <p class="lede" style="font-size:15.5px">Limber builds you a fresh routine each day and walks you through it with a timer. Holds get longer as you stack up days. Pick how much effort you've got each day:</p>
      <ul class="steps-list" style="margin-top:14px"><li><b>Mat session.</b> A proper floor routine with a warm-up and cool-down.</li>
        <li><b>Couch mode.</b> Long, lazy holds on the bed or sofa while you watch something.</li><li><b>Quick reset.</b> Five minutes standing, anywhere.</li></ul>
      <p class="eyebrow" style="margin-top:22px">Where are you tightest?</p>
      <div class="area-picks">${Object.entries(AREAS).map(([k, a]) => `<button class="chip" data-a="${k}" aria-pressed="${picked.has(k)}">${a.name}</button>`).join('')}</div>
      <div class="field" style="margin-top:18px;max-width:280px"><label for="o-name">Your name (optional)</label><input id="o-name" type="text" maxlength="30" autocomplete="given-name"></div>
      <div class="sheet-actions"><button class="btn clay big" data-go>Build my first routine</button></div>
    </div>`, () => { state.onboarded = true; save(); });
    sh.addEventListener('click', e => {
      const a = e.target.closest('[data-a]');
      if (a) { picked.has(a.dataset.a) ? picked.delete(a.dataset.a) : picked.add(a.dataset.a); a.setAttribute('aria-pressed', picked.has(a.dataset.a)); }
      if (e.target.closest('[data-go]')) {
        if (picked.size) set().focus = Object.fromEntries(Object.keys(AREAS).map(k => [k, picked.has(k) ? 3 : 1]));
        set().name = $('#o-name', sh).value.trim().slice(0, 30);
        state.onboarded = true; replan(); closeSheet(); render();
      }
    });
  }

  // ---------- boot ----------
  $$('[data-view]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); history.replaceState(null, '', '#' + a.dataset.view); go(a.dataset.view); }));
  applyTheme();
  go(location.hash.slice(1));
  if (!state.onboarded) onboard();
  // When served next to the reminder script, pick up its topic so there's nothing to copy across.
  if (!set().ntfy && location.protocol.startsWith('http')) fetch('reminders/config.json').then(r => r.ok ? r.json() : null).then(c => { if (c && c.topic && !set().ntfy) { set().ntfy = c.topic; save(); } }).catch(() => {});
  checkBrowserReminder(); setInterval(checkBrowserReminder, 60e3);
  // Re-render at midnight-ish so "today" rolls over if the tab stays open.
  let shownDay = today();
  setInterval(() => { if (today() !== shownDay && !P) { shownDay = today(); render(); } }, 60e3);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});

  // debug/test hook
  window.limber = { get state() { return state; }, set state(s) { state = s; save(); render(); }, save, render, go, plan, startPlayer, move, finish: () => P && finish(true), get player() { return P; } };
})();
