// Rise app. Views: home (next alarm, week, streak), night (checklist -> sunrise -> morning), setup (#setup).
// URL flags: ?k=KEY (saved), ?night=1 (opened by the charger automation), ?up=1 (opened by "I'm up"),
// ?at=HH:MM&ramp=MIN (try night mode with a fake alarm).
const q = new URLSearchParams(location.search);
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};
let KEY = q.get('k') || store.get('rise-key') || '';
if (q.get('k')) store.set('rise-key', KEY);

const app = document.getElementById('app'), nightEl = document.getElementById('night'), sheet = document.getElementById('sheet');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const toMin = (t) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
const hm = (d = new Date()) => d.toTimeString().slice(0, 5);
const at = (date, time) => new Date(`${date}T${time}:00`); // the phone is in the same zone as the schedule
const addMin = (t, m) => hm(new Date(at('2000-01-01', t).getTime() + m * 60e3));
const dur = (min) => { min = Math.max(0, Math.round(min)); return min < 60 ? `${min} min` : `${min / 60 | 0}h ${String(min % 60).padStart(2, '0')}m`; };
const countdown = (ms) => { const s = Math.ceil(ms / 1000); return `${s / 60 | 0}:${String(s % 60).padStart(2, '0')}`; };
const shortDate = (date) => new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const link = (extra = '') => `${location.origin}/?k=${encodeURIComponent(KEY)}${extra}`;

let H = null; // last /api/home
async function api(path, body) {
  const res = await fetch(`${path}?k=${encodeURIComponent(KEY)}`, body === undefined ? { cache: 'no-store' } : { method: 'POST', body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
  return (H = await res.json());
}
const nextPlan = () => H.week.find((d) => d.date === H.next);
const todayPlan = () => H.week.find((d) => d.date === H.now.date);

// ---------- weather (open-meteo, free, no key) ----------
let wxP = null;
const weather = () => (wxP ||= fetch(`https://api.open-meteo.com/v1/forecast?latitude=${H.cfg.lat}&longitude=${H.cfg.lon}&hourly=temperature_2m,precipitation_probability,weather_code&timezone=auto&forecast_days=3`)
  .then((r) => r.json()).then((j) => j.hourly).catch(() => null));
async function wxAt(date, time) {
  const w = await weather(), i = w ? w.time.indexOf(`${date}T${time.slice(0, 2)}:00`) : -1;
  if (i < 0) return null;
  const t = Math.round(w.temperature_2m[i]), p = w.precipitation_probability[i], c = w.weather_code[i];
  const sky = c >= 95 ? 'storms' : c >= 85 ? 'snow showers' : c >= 80 ? 'showers' : c >= 71 ? 'snow' : c >= 51 ? 'rain' : c >= 45 ? 'fog' : c >= 2 ? 'cloudy' : 'clear';
  const tip = t <= 0 ? 'Below freezing: hat and gloves.' : p >= 50 ? 'Bring an umbrella.' : t <= 6 ? 'Cold out: warm jacket.' : '';
  return { text: `${t}° ${sky}${p >= 20 ? `, ${p}% chance` : ''}`, tip };
}

// ---------- is the alarm actually on the phone? ----------
function phoneCheck(plan) {
  const got = H.log[plan.date], now = new Date();
  if (!plan.alarms.length) {
    return got?.alarms?.length ? { cls: 'warn', text: 'Your phone still has the old alarms. Run the <b>Rise</b> shortcut (or re-plug the charger) to clear them.' } : null;
  }
  if (!got?.fetched) {
    const late = now.getHours() >= 22 || plan.date === H.now.date;
    return late
      ? { cls: 'warn', text: "Your phone hasn't set this alarm yet. Run the <b>Rise</b> shortcut now, or plug in the charger." }
      : { cls: 'wait', text: 'Your phone sets this alarm at 22:00, or when you plug in.' };
  }
  if (got.alarms.join() !== plan.alarms.join()) return { cls: 'warn', text: 'Changed since your phone set it. Run the <b>Rise</b> shortcut (or re-plug the charger).' };
  return { cls: 'ok', text: `Set on your phone at ${got.fetched.slice(11)}.` };
}
const statusHTML = (s) => s ? `<div class="status ${s.cls}"><b>${s.cls === 'ok' ? '✓' : s.cls === 'warn' ? '!' : '…'}</b><div>${s.text}</div></div>` : '';

// ---------- home ----------
async function home() {
  if (!KEY) return setup();
  try { await api('/api/home'); } catch (e) { return fail(e); }
  const p = nextPlan(), s = H.stats, tomorrow = p.date !== H.now.date;
  const wx = p.wake && await wxAt(p.date, p.leave || p.wake);
  const toBed = p.lightsOut && (() => {
    const lo = at(p.date, p.lightsOut); // lights out is usually the evening before the alarm
    if (toMin(p.lightsOut) > toMin(p.wake)) lo.setDate(lo.getDate() - 1);
    const m = (lo - new Date()) / 60e3;
    return m > 0 ? `Lights out by ${p.lightsOut}, in ${dur(m)}` : `Past lights out: sleep now for ${dur((at(p.date, p.wake) - new Date()) / 60e3)} of sleep`;
  })();
  app.innerHTML = `
    <div class="top"><div class="brand"><i></i>Rise</div>${s.streak ? `<span class="chip hot">${s.streak} in a row</span>` : ''}</div>
    ${H.stale ? `<div class="banner">Couldn't reach your calendar (${esc(H.stale)}). Using the last copy that worked.</div>` : ''}
    ${H.repeating ? `<div class="banner bad">Your calendar has repeating events Rise can't read (monthly or yearly). Check those days by hand.</div>` : ''}
    <section class="hero ${p.wake ? '' : 'off'}">
      <div class="when">${tomorrow ? 'Tomorrow' : 'This morning'} · ${p.day} ${shortDate(p.date)}</div>
      <div class="big num" ${p.wake ? '' : 'style="font-size:56px"'}>${p.wake ? esc(p.wake) : 'Sleep in'}${p.override?.time ? '<small>your time</small>' : ''}</div>
      <div class="cls">${p.first ? `${esc(p.first.summary)} <span>· ${p.first.time}${p.first.location ? ` · ${esc(p.first.location)}` : ''}</span>` : p.override?.skip ? 'You switched this alarm off.' : 'No morning class.'}</div>
      ${p.wake ? `<div class="pills">
        ${p.leave ? `<span class="pill">Leave ${p.leave}</span>` : ''}
        ${p.alarms.length > 1 ? `<span class="pill">Backups to ${p.alarms.at(-1)}</span>` : ''}
        ${wx ? `<span class="pill">${esc(wx.text)}</span>` : ''}
        ${toBed ? `<span class="pill">${toBed}</span>` : ''}
      </div>` : '<div style="height:16px"></div>'}
      <div class="row">
        ${p.wake ? '<button class="primary" id="sleep">Night mode</button>' : ''}
        <button id="change">Change</button>
      </div>
    </section>
    ${statusHTML(phoneCheck(p))}

    <h2>Your mornings</h2>
    <div class="tiles">
      <div class="tile"><div class="v num">${s.streak}</div><div class="l">in a row</div></div>
      <div class="tile"><div class="v num">${s.best}</div><div class="l">best streak</div></div>
      <div class="tile"><div class="v num">${s.rate == null ? '–' : Math.round(s.rate * 100) + '%'}</div><div class="l">on time, last 30</div></div>
      <div class="tile"><div class="v num">${s.avgUp == null ? '–' : s.avgUp + 'm'}</div><div class="l">alarm to up</div></div>
    </div>
    ${historyHTML()}

    <h2>Next 7 days</h2>
    <div class="week">${H.week.map(dayHTML).join('')}</div>

    <h2>Setup</h2>
    <div class="row"><a class="btn" href="#setup">Setup guide</a><button id="preview">Preview sunrise</button></div>`;
  app.querySelector('#sleep')?.addEventListener('click', () => night(p));
  app.querySelector('#change').onclick = () => edit(p);
  app.querySelector('#preview').onclick = () => night(preview());
  app.querySelectorAll('.day').forEach((b) => (b.onclick = () => edit(H.week.find((d) => d.date === b.dataset.date))));
}

function historyHTML() {
  const by = Object.fromEntries(H.stats.days.map((d) => [d.date, d.status]));
  const t = new Date(`${H.now.date}T12:00:00`), start = new Date(t);
  start.setDate(t.getDate() - ((t.getDay() + 6) % 7) - 35); // Monday, 5 weeks back
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const key = d.toLocaleDateString('en-CA');
    return `<div class="dot ${by[key] || ''} ${key > H.now.date ? 'future' : ''} ${key === H.now.date ? 'today' : ''}" title="${key} ${by[key] || ''}"></div>`;
  });
  return `<div class="grid">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => `<div class="h">${x}</div>`).join('')}${cells.join('')}</div>
    <div class="legend"><span><i style="background:var(--ok)"></i>On time</span><span><i style="background:var(--warn)"></i>Late</span><span><i style="background:var(--bad)"></i>Missed</span></div>
    ${H.stats.days.length ? '' : '<p class="empty">Each morning you scan the QR shows up here.</p>'}`;
}

function dayHTML(p) {
  const past = p.date === H.now.date && p.date !== H.next;
  return `<button class="day ${past ? 'past' : ''}" data-date="${p.date}">
    <span class="d">${p.day.slice(0, 3)}<small>${shortDate(p.date)}</small></span>
    <span class="t num ${p.wake ? '' : 'none'}">${p.wake || 'off'}</span>
    <span class="c">${p.first ? `${p.first.time} ${esc(p.first.summary)}` : 'No class'}</span>
    ${p.override ? `<span class="tag">${p.override.skip ? 'skipped' : 'custom'}</span>` : '<span></span>'}
  </button>`;
}

function edit(p) {
  const sched = p.first && addMin(p.first.time, -H.cfg.prep);
  sheet.innerHTML = `
    <h3>${p.day} ${shortDate(p.date)}</h3>
    <p>${p.first ? `First class ${p.first.time}: ${esc(p.first.summary)}` : 'No class this morning.'}</p>
    <div class="stack">
      ${p.override && sched ? `<button data-a="clear">Back to schedule (${sched})</button>` : ''}
      ${p.override && !sched ? '<button data-a="clear">Remove my alarm</button>' : ''}
      <div class="row"><input type="time" id="t" value="${p.wake || sched || '08:00'}"><button class="primary" data-a="time">Set alarm</button></div>
      ${p.wake ? '<button data-a="skip">No alarm this morning</button>' : ''}
      <button class="ghost" data-a="close">Cancel</button>
    </div>`;
  sheet.querySelectorAll('[data-a]').forEach((b) => (b.onclick = async () => {
    const a = b.dataset.a, time = sheet.querySelector('#t').value;
    if (a !== 'close') {
      const body = a === 'skip' ? { date: p.date, skip: true } : a === 'time' && time !== sched ? { date: p.date, time } : { date: p.date };
      try { await api('/api/override', body); } catch (e) { return alert(e.message); }
    }
    sheet.close(); home();
  }));
  sheet.showModal();
}

// ---------- night: checklist, then black, then sunrise, then the morning screen ----------
const STOPS = [[0, 0, 0], [70, 4, 0], [190, 45, 10], [255, 140, 55], [255, 232, 205]];
const color = (f) => {
  const x = Math.min(Math.max(f, 0), 1) * (STOPS.length - 1), i = Math.min(x | 0, STOPS.length - 2), k = x - i;
  return `rgb(${STOPS[i].map((c, j) => Math.round(c + (STOPS[i + 1][j] - c) * k))})`;
};
let lock = null, timer = null, poll = null;
async function keepAwake() { try { lock = await navigator.wakeLock.request('screen'); return true; } catch { return false; } }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && lock?.released) keepAwake(); });

function preview() {
  const wake = hm(new Date(Date.now() + 2 * 60e3)), p = nextPlan();
  return { ...p, date: new Date(Date.now() + 2 * 60e3).toLocaleDateString('en-CA'), wake, alarms: [0, 5, 10].map((m) => addMin(wake, m)), ramp: 1.5, preview: true };
}

function night(p) {
  nightEl.hidden = false; nightEl.className = ''; nightEl.style.background = '#000';
  const ramp = (p.ramp || +(q.get('ramp') || 20)) * 60e3, alarm = at(p.date, p.wake);
  const sleepFor = (alarm - new Date()) / 60e3;
  const draw = async () => {
    const pc = p.preview ? { cls: 'ok', text: `Preview with a pretend alarm at ${p.wake}.` } : phoneCheck(p);
    nightEl.innerHTML = `<div class="pre">
      <div class="big num">${p.wake}</div>
      <div class="sub">${p.first ? `${esc(p.first.summary)} at ${p.first.time}` : p.day} · ${dur(sleepFor)} of sleep if you sleep now</div>
      <div class="checks">
        <div class="${pc?.cls === 'ok' ? 'ok' : 'warn'}"><b>${pc?.cls === 'ok' ? '✓' : '!'}</b><span>${pc?.text || ''}</span></div>
        <div><b>☀</b><span>Turn brightness all the way up and leave the phone face up. The screen stays black until ${addMin(p.wake, -ramp / 60e3)}.</span></div>
        <div><b>🔔</b><span>Ringer volume up (alarms use it) and the phone plugged in.</span></div>
        <div><b>▣</b><span>The QR is in the kitchen. Backups ring until ${p.alarms.at(-1)} unless you scan it.</span></div>
      </div>
      <button class="primary" id="go">Good night</button>
      <div style="margin-top:12px"><button class="ghost" id="exit">Back</button></div>
    </div>`;
    nightEl.querySelector('#exit').onclick = stop;
    nightEl.querySelector('#go').onclick = async () => {
      clearInterval(poll);
      const ok = await keepAwake();
      nightEl.innerHTML = `<div class="peek num hidden">${hm()}<small>${ok ? `alarm ${p.wake}` : 'Screen may sleep: set Auto-Lock to Never tonight'}</small></div>`;
      const peek = nightEl.querySelector('.peek');
      const show = () => { peek.firstChild.textContent = hm(); peek.classList.remove('hidden'); setTimeout(() => peek.classList.add('hidden'), 5000); };
      nightEl.onclick = show; show();
      timer = setInterval(tick, 1000); tick();
    };
  };
  let phase = 'night';
  const tick = () => {
    const left = alarm - Date.now();
    if (left > 0) { nightEl.style.background = color(1 - left / ramp); return; }
    if (phase === 'night') { phase = 'morning'; nightEl.onclick = null; morning(p); }
  };
  draw();
  if (!p.preview) poll = setInterval(() => api('/api/home').then(() => { if (nightEl.querySelector('.pre')) draw(); }).catch(() => {}), 30e3);
}

function stop() {
  clearInterval(timer); clearInterval(poll); lock?.release?.(); lock = null;
  nightEl.hidden = true; nightEl.onclick = null; home();
}

// The morning screen: what you need to get out of the door, and a countdown to the next backup alarm
// until the QR is scanned.
async function morning(p, justUp = false) {
  nightEl.hidden = false; nightEl.className = 'morning'; nightEl.style.background = 'linear-gradient(180deg, #ffe8cd, #ffc98f 60%, #ff9f6b)';
  const wx = await wxAt(p.date, p.leave || p.wake || hm()).catch(() => null);
  let first = true; // animate only on the first draw; the clock redraws every second
  const render = () => {
    const up = p.preview ? null : H.log[p.date]?.up, now = new Date();
    const next = p.alarms.map((t) => at(p.date, t)).find((d) => d > now);
    const leave = p.leave && (at(p.date, p.leave) - now) / 60e3;
    const s = H.stats;
    nightEl.innerHTML = `<div class="morn ${first ? 'anim' : ''}">
      ${justUp ? `<div class="burst ${first ? 'anim' : ''}"></div>` : ''}
      <div class="hello">${up ? "You're up" : 'Good morning'}</div>
      <div class="clock num">${hm()}</div>
      ${up ? `<div class="card done"><div class="k">Up at ${up}</div><div class="v">${s.streak > 1 ? `${s.streak} mornings in a row` : 'Day one of the streak'}</div>${s.best > s.streak ? `<div class="s">Best: ${s.best}</div>` : s.streak > 1 ? '<div class="s">Your best streak yet</div>' : ''}</div>`
        : next ? `<div class="card nag"><div class="k">Next alarm ${hm(next)} in</div><div class="v num">${countdown(next - now)}</div><div class="s">Go scan the QR in the kitchen to stop it.</div></div>`
        : p.alarms.length ? `<div class="card nag"><div class="k">That was the last alarm</div><div class="v">Up you get</div><div class="s">Scan the QR so the morning counts.</div></div>` : ''}
      ${p.first ? `<div class="card"><div class="k">First class</div><div class="v">${p.first.time} · ${esc(p.first.summary)}</div>${p.first.location ? `<div class="s">${esc(p.first.location)}</div>` : ''}</div>` : ''}
      ${p.leave ? `<div class="card"><div class="k">Leave by</div><div class="v">${p.leave}${leave > 0 ? ` · in ${dur(leave)}` : leave > -30 ? ' · now!' : ''}</div></div>` : ''}
      ${wx ? `<div class="card"><div class="k">Outside</div><div class="v">${esc(wx.text)}</div>${wx.tip ? `<div class="s">${wx.tip}</div>` : ''}</div>` : ''}
      <button id="exit">Close</button>
    </div>`;
    nightEl.querySelector('#exit').onclick = stop;
    if (up) clearInterval(poll);
    first = false;
  };
  clearInterval(poll); if (!p.preview) poll = setInterval(() => api('/api/home').catch(() => {}), 20e3);
  clearInterval(timer); timer = setInterval(render, 1000);
  render();
}

// "I'm up": the Shortcut opens ?up=1 after switching the alarms off.
async function imUp() {
  history.replaceState(null, '', link());
  try { await api('/api/up', {}); } catch (e) { return fail(e); }
  morning(todayPlan() || { date: H.now.date, alarms: [] }, true);
}

// ---------- setup ----------
function setup() {
  const done = JSON.parse(store.get('rise-setup') || '{}');
  const copy = (v) => `<div class="copy"><code>${esc(v)}</code><button data-copy="${esc(v)}">Copy</button></div>`;
  const step = (id, title, body) => `<section class="step ${done[id] ? 'done' : ''}"><h3><input type="checkbox" data-step="${id}" ${done[id] ? 'checked' : ''}>${title}</h3>${body}</section>`;
  const base = location.origin;
  app.innerHTML = `
    <a class="btn ghost back" href="#">← Back</a>
    <div class="top"><div class="brand"><i></i>Setup</div></div>
    ${!KEY ? `<section class="step"><h3>Your key</h3><p>Open Rise with your key in the link (<code>/?k=…</code>) or paste it here.</p>
      <div class="row"><input type="text" id="key" placeholder="key" autocapitalize="off"><button class="primary" id="savekey">Save</button></div></section>` : ''}
    ${step('cal', '1. Check your schedule', `<p>Rise reads the class-schedule link set with <code>npx wrangler secret put FEED_URL</code> (TimeEdit's "subscribe" link, or any iCal link; several links can go in, separated by spaces).</p>
      <button id="check">Check now</button><div class="out" id="checkout"></div>`)}
    ${step('rise', '2. Shortcut: "Rise"', `<p>Shortcuts app → + → name it <kbd>Rise</kbd>. Add these actions in order:</p><ol>
      <li><b>Get Contents of URL</b>:${copy(`${base}/alarms?k=${KEY}`)}</li>
      <li><b>Find Alarms</b> where <i>Label</i> is <kbd>Rise</kbd>, then <b>Delete Alarms</b> (turn off "Confirm" if you see it).</li>
      <li><b>Split Text</b> (the URL contents) by <i>New Lines</i>, then <b>Repeat with Each</b>: <b>If</b> <i>Repeat Item</i> has any value → <b>Create Alarm</b> at <i>Repeat Item</i>, label <kbd>Rise</kbd>.</li>
      <li><b>Get Contents of URL</b>:${copy(`${base}/note?k=${KEY}`)} then <b>Show Notification</b> with it.</li></ol>
      <p>Run it once by hand: the Clock app should now show your Rise alarms, and the home screen here says "Set on your phone".</p>`)}
    ${step('up', `3. Shortcut: "I'm up"`, `<p>New shortcut named exactly <kbd>I'm up</kbd>:</p><ol>
      <li><b>Find Alarms</b> where <i>Label</i> is <kbd>Rise</kbd> and <i>Is Enabled</i> is on → <b>Toggle Alarm</b> → <i>Turn Off</i>.</li>
      <li><b>Open URLs</b>:${copy(link('&up=1'))}</li></ol>`)}
    ${step('auto', '4. Automations', `<p>Shortcuts → Automation → +. Set each to <b>Run Immediately</b>.</p><ul>
      <li><b>Time of Day</b> 22:00, daily → Run Shortcut <kbd>Rise</kbd>. The bedtime note, and the alarm is set even if you forget to charge.</li>
      <li><b>Charger</b> is connected → Run Shortcut <kbd>Rise</kbd>, then <b>Open URLs</b>:${copy(link('&night=1'))}</li></ul>`)}
    ${step('qr', '5. Print the QR', `<p>Tape it somewhere you have to walk to: the kitchen, or the bathroom mirror. Scanning it with the Camera runs "I'm up".</p>
      <a class="btn" href="/qr.html" target="_blank">Open the QR page</a>`)}
    ${step('phone', '6. iPhone settings', `<ul>
      <li><b>Settings → Sounds & Haptics</b>: Ringer volume up. iPhone alarms ring at this volume.</li>
      <li><b>Settings → Face ID & Attention</b>: turn off <i>Attention Aware Features</i>, which turns the alarm down as soon as you look at the phone.</li>
      <li>Pick a loud alarm sound in Clock for the Rise alarms (Shortcuts uses the default sound).</li>
      <li>Optional: open this page in Safari → Share → <b>Add to Home Screen</b>.</li></ul>`)}
    ${step('test', '7. Dress rehearsal', `<p>Try the whole thing before relying on it:</p>
      <ol><li>Tap <b>Preview sunrise</b>: the fade takes about 2 minutes.</li><li>Plug the phone in: night mode should open.</li><li>Scan the QR: you get the "You're up" screen and the Rise alarms switch off.</li></ol>
      <button id="prev">Preview sunrise</button>`)}`;
  app.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'Copied'; } catch { b.textContent = 'Select it'; } }));
  app.querySelectorAll('[data-step]').forEach((c) => (c.onchange = () => { done[c.dataset.step] = c.checked; store.set('rise-setup', JSON.stringify(done)); c.closest('.step').classList.toggle('done', c.checked); }));
  app.querySelector('#savekey')?.addEventListener('click', () => { KEY = app.querySelector('#key').value.trim(); store.set('rise-key', KEY); setup(); });
  app.querySelector('#prev').onclick = async () => { try { H || await api('/api/home'); night(preview()); } catch (e) { alert(e.message); } };
  app.querySelector('#check').onclick = async () => {
    const out = app.querySelector('#checkout');
    out.textContent = 'Checking…';
    try {
      await api('/api/home');
      const days = H.week.filter((d) => d.first);
      out.innerHTML = [
        H.stale ? `⚠ Couldn't reach the calendar (${esc(H.stale)}); using the last saved copy.` : '✓ Calendar link works.',
        days.length ? `✓ Classes found on ${days.length} of the next 8 days. Next: ${days[0].day} ${days[0].first.time} ${esc(days[0].first.summary)}.` : '⚠ No classes in the next 8 days. Is this the schedule link (TimeEdit), not just assignments (Canvas)?',
        H.repeating ? '⚠ Some repeating events use rules Rise ignores (monthly/yearly).' : '',
      ].filter(Boolean).join('\n');
    } catch (e) { out.textContent = `⚠ ${e.message}`; }
  };
}

function fail(e) {
  app.innerHTML = `<div class="top"><div class="brand"><i></i>Rise</div></div>
    <div class="banner bad">${e.message.includes('key') ? 'This link is missing your key.' : `Couldn't load: ${esc(e.message)}`}</div>
    <a class="btn" href="#setup">Setup guide</a>`;
}

// ---------- routing ----------
async function route() {
  if (location.hash === '#setup') return setup();
  if (q.has('up')) return imUp();
  if (q.has('night') || q.has('at')) {
    history.replaceState(null, '', link());
    try { await api('/api/home'); } catch (e) { return fail(e); }
    const p = q.get('at') ? { ...nextPlan(), date: at(H.now.date, q.get('at')) > new Date() ? H.now.date : H.next, wake: q.get('at'), alarms: [0, 5, 10].map((m) => addMin(q.get('at'), m)), preview: true } : nextPlan();
    if (!p.wake) { home(); return; }
    return night(p);
  }
  home();
}
window.addEventListener('hashchange', () => (location.hash === '#setup' ? setup() : home()));
route();
