(() => {
const { DAY, TAU, RUN_DAYS, currentRun, dayIndex, buildPool, interleave, indexAt, ease, streak } = Logic;
const $ = s => document.querySelector(s);
const byId = Object.fromEntries(SKILLS.map(k => [k.id, k]));
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
let nowOffset = 0;
const now = () => Date.now() + nowOffset;

// ───────────────────────── State ─────────────────────────
const KEY = 'skillwheel.v1';
const DEFAULT_SETTINGS = { cats: {}, sound: true, quickOnly: false, freeOnly: false, allowRepeats: false, excluded: [] };
let state = load();
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.runs)) {
      s.runs.forEach(r => { delete r.pending; }); // a reload counts as accepting
      return { runs: s.runs.filter(r => byId[r.id]), settings: { ...DEFAULT_SETTINGS, ...s.settings } };
    }
  } catch {}
  return { runs: [], settings: { ...DEFAULT_SETTINGS } };
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} }
const cur = () => currentRun(state.runs, now());
const lastRun = () => state.runs[state.runs.length - 1];
const weekNo = () => state.runs.filter(r => !r.pending).length + 1;

// ───────────────────────── Helpers ─────────────────────────
const catOf = k => CATS[k.cat];
const wkText = k => k.wk[0] === k.wk[1] ? `${k.wk[0]} week${k.wk[0] > 1 ? 's' : ''}` : `${k.wk[0]}–${k.wk[1]} weeks`;
const costText = k => k.cost ? `~$${k.cost}` : 'Free';
const levelText = k => ['Easy', 'Medium', 'Hard'][k.level - 1];
const factsHTML = k => `
  <span class="fact" title="Time to a solid beginner level">⏱ ${wkText(k)}</span>
  <span class="fact" title="Daily practice">🕐 ${k.daily}/day</span>
  <span class="fact" title="Setup cost">💸 ${costText(k)}</span>
  <span class="fact" title="Difficulty">${'●'.repeat(k.level)}${'○'.repeat(3 - k.level)} ${levelText(k)}</span>`;
function resLink(r) {
  const [kind, q] = [r.slice(0, 1), r.slice(2)];
  const url = kind === 'v' ? 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q)
                           : 'https://www.google.com/search?q=' + encodeURIComponent(q);
  return `<a href="${url}" target="_blank" rel="noopener">${{ v: '▶', w: '🔎', a: '📱' }[kind] || '🔎'} ${q}</a>`;
}
function fmtLeft(ms) {
  const d = Math.floor(ms / DAY), h = Math.floor(ms % DAY / 36e5), m = Math.ceil(ms % 36e5 / 6e4);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}
const fmtDate = t => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 2600);
}

// ───────────────────────── Sound ─────────────────────────
let ac;
function audio() {
  if (!state.settings.sound) return null;
  try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
  if (ac.state === 'suspended') ac.resume();
  return ac;
}
function tone(a, t, freq, dur, type = 'sine', vol = .2, end) {
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (end) o.frequency.exponentialRampToValueAtTime(end, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + .02);
}
let lastTick = 0;
function tick(speed) {
  const a = audio(); if (!a) return;
  const t = a.currentTime;
  if (t - lastTick < .028) return; // above ~35 ticks/s it turns to buzz
  lastTick = t;
  tone(a, t, 1500 + Math.random() * 400, .04, 'triangle', Math.min(.16, .06 + speed * .01), 600);
}
function chime() {
  const a = audio(); if (!a) return;
  const t = a.currentTime;
  [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => {
    tone(a, t + i * .085, f, 1.3, 'sine', .14);
    tone(a, t + i * .085, f * 2, .5, 'sine', .04);
  });
}
function whoosh() {
  const a = audio(); if (!a) return;
  const t = a.currentTime, len = .7, buf = a.createBuffer(1, a.sampleRate * len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  src.buffer = buf; f.type = 'bandpass'; f.Q.value = 1.2;
  f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(2200, t + .25); f.frequency.exponentialRampToValueAtTime(400, t + len);
  g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.25, t + .12); g.gain.exponentialRampToValueAtTime(.0001, t + len);
  src.connect(f).connect(g).connect(a.destination); src.start(t);
}
function pop() { const a = audio(); if (a) tone(a, a.currentTime, 520, .12, 'sine', .15, 980); }

// ───────────────────────── Wheel ─────────────────────────
const cv = $('#wheel'), ctx = cv.getContext('2d');
let order = [], disc = null, frame = null, S = 0;
let rot = 0, spinning = null, settle = null, winner = -1, winT = 0, lastPeg = null;
let flap = 0, flapV = 0, bulbT = 0, flashUntil = 0, idleAt = 0;
const BULBS = 28;

function shade(hex, amt) { // amt -1..1 → darker/lighter
  const n = parseInt(hex.slice(1), 16), c = [n >> 16, n >> 8 & 255, n & 255];
  return 'rgb(' + c.map(v => Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)).join(',') + ')';
}

function refreshPool() {
  const pool = buildPool(SKILLS, state.runs, state.settings);
  order = interleave(pool);
  winner = -1;
  buildImages();
  renderLegend();
  return order.length;
}

function buildImages() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  S = Math.round(cv.clientWidth * dpr);
  if (!S) return;
  cv.width = cv.height = S;
  const R = S / 2, n = order.length, seg = TAU / Math.max(n, 1), RD = R * .875;

  // Rotating disc
  disc = document.createElement('canvas'); disc.width = disc.height = S;
  const d = disc.getContext('2d');
  d.translate(R, R);
  if (!n) { d.fillStyle = '#444'; d.beginPath(); d.arc(0, 0, RD, 0, TAU); d.fill(); }
  order.forEach((k, i) => {
    const a0 = -Math.PI / 2 + i * seg, col = catOf(k).color;
    const g = d.createRadialGradient(0, 0, R * .15, 0, 0, RD);
    g.addColorStop(0, shade(col, .35)); g.addColorStop(.7, i % 2 ? shade(col, .06) : col); g.addColorStop(1, shade(col, -.3));
    d.fillStyle = g;
    d.beginPath(); d.moveTo(0, 0); d.arc(0, 0, RD, a0, a0 + seg + .002); d.closePath(); d.fill();
  });
  // separators
  d.strokeStyle = 'rgba(255,255,255,.45)'; d.lineWidth = Math.max(1, S / 700);
  if (n > 1) order.forEach((_, i) => {
    const a = -Math.PI / 2 + i * seg;
    d.beginPath(); d.moveTo(Math.cos(a) * R * .2, Math.sin(a) * R * .2); d.lineTo(Math.cos(a) * RD, Math.sin(a) * RD); d.stroke();
  });
  // labels: emoji near rim, name reading outward, right-aligned
  const fs = Math.min(R * .05, RD * .56 * seg * .5);
  order.forEach((k, i) => {
    d.save(); d.rotate(-Math.PI / 2 + (i + .5) * seg);
    d.textBaseline = 'middle'; d.textAlign = 'center';
    d.save(); d.shadowColor = 'rgba(0,0,0,.35)'; d.shadowBlur = fs * .3; d.shadowOffsetY = fs * .06;
    d.fillStyle = 'rgba(255,255,255,.88)'; d.beginPath(); d.arc(RD * .9, 0, fs * .98, 0, TAU); d.fill(); d.restore();
    d.font = `${fs * 1.2}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    d.save(); d.translate(RD * .9, 0); d.rotate(Math.PI / 2); d.fillText(k.emoji, 0, fs * .06); d.restore();
    d.font = `700 ${fs}px Inter, system-ui, sans-serif`;
    d.textAlign = 'right';
    let f = fs; const maxW = RD * .56;
    while (d.measureText(k.short).width > maxW && f > 8) { f -= 1; d.font = `700 ${f}px Inter, system-ui, sans-serif`; }
    d.shadowColor = 'rgba(0,0,0,.55)'; d.shadowBlur = fs * .35; d.shadowOffsetY = 1;
    d.fillStyle = '#fff'; d.fillText(k.short, RD * .8, 0);
    d.restore();
  });
  // pegs
  if (n > 1) order.forEach((_, i) => {
    const a = -Math.PI / 2 + i * seg, x = Math.cos(a) * RD * .975, y = Math.sin(a) * RD * .975, r = Math.max(2, S / 190);
    const pg = d.createRadialGradient(x - r * .3, y - r * .3, 0, x, y, r);
    pg.addColorStop(0, '#fffbe6'); pg.addColorStop(.6, '#e9b949'); pg.addColorStop(1, '#7a4f00');
    d.fillStyle = pg; d.beginPath(); d.arc(x, y, r, 0, TAU); d.fill();
  });
  // depth: dark vignette at rim
  const v = d.createRadialGradient(0, 0, RD * .55, 0, 0, RD);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.28)');
  d.fillStyle = v; d.beginPath(); d.arc(0, 0, RD, 0, TAU); d.fill();

  // Static frame: metallic ring + a light sheen over the disc
  frame = document.createElement('canvas'); frame.width = frame.height = S;
  const f = frame.getContext('2d');
  f.translate(R, R);
  const ring = f.createLinearGradient(-R, -R, R, R);
  ring.addColorStop(0, '#fff1c1'); ring.addColorStop(.25, '#e2a92b'); ring.addColorStop(.5, '#7a4a00');
  ring.addColorStop(.75, '#e7b33d'); ring.addColorStop(1, '#5c3600');
  f.fillStyle = ring; f.beginPath(); f.arc(0, 0, R * .995, 0, TAU); f.arc(0, 0, RD, 0, TAU, true); f.fill('evenodd');
  f.strokeStyle = 'rgba(40,20,0,.8)'; f.lineWidth = S / 300;
  f.beginPath(); f.arc(0, 0, RD, 0, TAU); f.stroke();
  f.beginPath(); f.arc(0, 0, R * .99, 0, TAU); f.stroke();
  const inner = f.createRadialGradient(0, 0, RD * .98, 0, 0, RD * 1.06);
  inner.addColorStop(0, 'rgba(0,0,0,.35)'); inner.addColorStop(1, 'rgba(0,0,0,0)');
  f.fillStyle = inner; f.beginPath(); f.arc(0, 0, R * .94, 0, TAU); f.arc(0, 0, RD * .98, 0, TAU, true); f.fill('evenodd');
  const sheen = f.createLinearGradient(-RD, -RD, RD * .3, RD * .3);
  sheen.addColorStop(0, 'rgba(255,255,255,.22)'); sheen.addColorStop(.5, 'rgba(255,255,255,.04)'); sheen.addColorStop(1, 'rgba(255,255,255,0)');
  f.fillStyle = sheen; f.beginPath(); f.arc(0, 0, RD, 0, TAU); f.fill();
}

function draw(t) {
  if (!disc) return;
  const R = S / 2, RD = R * .875, n = order.length, seg = TAU / Math.max(n, 1);
  ctx.clearRect(0, 0, S, S);
  ctx.save(); ctx.translate(R, R); ctx.rotate(rot); ctx.drawImage(disc, -R, -R);
  // motion blur: trail fading copies behind the disc, proportional to this frame's sweep
  const sweep = Math.max(-.3, Math.min(.3, (spinning ? spinning.speed : drag ? drag.w || 0 : 0) / 60));
  if (Math.abs(sweep) > .02 && !reduced) {
    for (let j = 1; j <= 4; j++) { ctx.globalAlpha = .28; ctx.rotate(-sweep / 4); ctx.drawImage(disc, -R, -R); }
    ctx.globalAlpha = 1; ctx.rotate(sweep);
  }
  if (winner >= 0) { // spotlight the winner: dim everything else, pulse a glow on it
    const a0 = -Math.PI / 2 + winner * seg, k = Math.min(1, (t - winT) / 400), pulse = .5 + .5 * Math.sin(t / 220);
    ctx.fillStyle = `rgba(5,3,15,${.5 * k})`;
    ctx.beginPath(); ctx.arc(0, 0, RD, 0, TAU); ctx.moveTo(0, 0); ctx.arc(0, 0, RD, a0, a0 + seg); ctx.closePath(); ctx.fill('evenodd');
    ctx.fillStyle = `rgba(255,255,255,${(.08 + .14 * pulse) * k})`;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, RD, a0, a0 + seg); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = `rgba(255,214,102,${k})`; ctx.lineWidth = S / 200; ctx.lineJoin = 'round';
    ctx.shadowColor = '#ffd166'; ctx.shadowBlur = S / 60 * (.6 + .4 * pulse); ctx.stroke(); ctx.shadowBlur = 0;
  }
  ctx.restore();
  ctx.drawImage(frame, 0, 0);
  // bulbs: chase while spinning, flash on a win, slow twinkle at rest
  ctx.save(); ctx.translate(R, R);
  const flashing = t < flashUntil, speed = spinning ? spinning.speed : 0;
  for (let i = 0; i < BULBS; i++) {
    const a = i / BULBS * TAU, x = Math.cos(a) * R * .935, y = Math.sin(a) * R * .935, r = S / 115;
    const on = flashing ? Math.floor(t / 120) % 2 === 0
      : spinning ? (i + Math.floor(bulbT)) % 4 === 0 || (i + Math.floor(bulbT)) % 4 === 1 && speed > 6
      : (i + Math.floor(t / 900)) % 2 === 0;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * (on ? 2.4 : 1));
    if (on) { g.addColorStop(0, '#fffef2'); g.addColorStop(.35, '#ffe08a'); g.addColorStop(1, 'rgba(255,190,60,0)'); }
    else { g.addColorStop(0, '#9a7a3a'); g.addColorStop(.8, '#5a3d0c'); g.addColorStop(1, 'rgba(60,40,0,0)'); }
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * (on ? 2.4 : 1), 0, TAU); ctx.fill();
  }
  ctx.restore();
}

// Ticks + pointer flap whenever a peg passes the pointer.
function pegCheck(speed) {
  const n = order.length; if (n < 2) return;
  const peg = Math.floor(rot / (TAU / n));
  if (lastPeg !== null && peg !== lastPeg) {
    tick(Math.abs(speed));
    flap = -Math.sign(speed || 1) * Math.min(32, 10 + Math.abs(speed) * 2.2);
    flapV = 0;
  }
  lastPeg = peg;
}

let prevT = performance.now();
function loop(t) {
  const dt = Math.min(.05, (t - prevT) / 1000); prevT = t;
  if (spinning) {
    const s = spinning, x = Math.min(1, (t - s.t0) / (s.T * 1000));
    const prev = rot;
    rot = s.from + s.D * ease(x);
    s.speed = (rot - prev) / Math.max(dt, 1e-3);
    bulbT += Math.abs(s.speed) * dt * 1.2;
    pegCheck(s.speed);
    if (x >= 1) land(t);
  } else if (settle) {
    const x = Math.min(1, (t - settle.t0) / 380);
    rot = settle.from + settle.by * Math.sin(x * Math.PI / 2);
    if (x >= 1) settle = null;
  } else if (!drag && winner < 0 && !reduced && t > idleAt) {
    rot += dt * .05; // idle drift keeps the wheel alive
    lastPeg = Math.floor(rot / (TAU / Math.max(order.length, 1)));
  }
  // pointer spring back to rest
  flapV += (-flap * 260 - flapV * 14) * dt; flap += flapV * dt;
  $('#pointer').style.setProperty('--flap', flap.toFixed(2) + 'deg');
  draw(t);
  requestAnimationFrame(loop);
}

function startSpin(D, T) {
  if (spinning || order.length < 2) return;
  closeModal('#reveal');
  if (reduced) T = Math.min(T, 1.6);
  whoosh();
  winner = -1; settle = null;
  spinning = { from: rot, D, T, t0: performance.now(), speed: 0, fun: !!(cur() && !cur().pending) };
  updateHub();
}
// Button spins pick a fair target, kept away from segment edges so it never looks like a coin-toss on a peg.
function spinRandom() {
  const n = order.length; if (n < 2) return;
  const i = Math.floor(Math.random() * n), seg = TAU / n;
  const target = -(i + .15 + Math.random() * .7) * seg;
  const turns = 5 + Math.floor(Math.random() * 3);
  const D = ((target - rot) % TAU + TAU) % TAU + turns * TAU;
  startSpin(D, 6.2 + Math.random() * 1.6);
}

function land(t) {
  const s = spinning; spinning = null;
  rot = s.from + s.D;
  winner = indexAt(rot, order.length); winT = t; flashUntil = t + 1600; idleAt = Infinity;
  // The flapper nudges the wheel back a touch, never far enough to leave the winning segment.
  const seg = TAU / order.length, frac = ((-rot % TAU + TAU) % TAU) / seg - winner;
  const room = s.D > 0 ? .95 - frac : frac - .05;
  if (!reduced && room > .02) { settle = { from: rot, by: -Math.sign(s.D) * Math.min(.12, room) * seg, t0: t }; flap = Math.sign(s.D) * 14; flapV = 0; }
  chime();
  const k = order[winner];
  const rect = cv.getBoundingClientRect();
  burst(rect.left + rect.width / 2, rect.top + rect.height * .1, [catOf(k).color, '#ffd166', '#ffffff', shade(catOf(k).color, .4)]);
  if (!s.fun) {
    const prev = lastRun()?.pending ? state.runs.pop() : null;
    state.runs.push({ id: k.id, start: now(), checks: Array(RUN_DAYS).fill(false), notes: '', status: 'active', rating: 0, rerolls: prev ? prev.rerolls : 0, pending: true });
    save();
  }
  setTimeout(() => showReveal(k, s.fun), reduced ? 200 : 750);
  updateHub();
}

// Drag & flick
let drag = null;
const angleAt = e => { const r = cv.getBoundingClientRect(); return Math.atan2(e.clientY - r.top - r.height / 2, e.clientX - r.left - r.width / 2); };
cv.addEventListener('pointerdown', e => {
  if (spinning || order.length < 2) return;
  const r = cv.getBoundingClientRect(), dx = e.clientX - r.left - r.width / 2, dy = e.clientY - r.top - r.height / 2;
  if (Math.hypot(dx, dy) > r.width / 2) return;
  cv.setPointerCapture(e.pointerId); cv.classList.add('dragging');
  winner = -1; settle = null; audio();
  drag = { a: angleAt(e), samples: [{ t: performance.now(), r: rot }] };
});
const dragMove = e => {
  if (!drag) return;
  const a = angleAt(e); let da = a - drag.a;
  if (da > Math.PI) da -= TAU; if (da < -Math.PI) da += TAU;
  drag.a = a; rot += da;
  const t = performance.now();
  drag.samples.push({ t, r: rot }); drag.samples = drag.samples.filter(s => t - s.t < 120);
  const s0 = drag.samples[0];
  drag.w = t > s0.t ? (rot - s0.r) / ((t - s0.t) / 1000) : 0;
  pegCheck(drag.w);
};
cv.addEventListener('pointermove', dragMove);
const endDrag = e => {
  if (!drag) return;
  if (e.type === 'pointerup') dragMove(e); // moves can be coalesced away under load; the release point is the truth
  cv.classList.remove('dragging');
  // Velocity comes from the last moves themselves, so a late pointerup on a busy device still flicks;
  // only a real pause before letting go (no moves for 180ms) counts as holding still.
  const s = drag.samples, last = s[s.length - 1], s0 = s.find(x => last.t - x.t < 120);
  drag = null; idleAt = performance.now() + 3000;
  if (performance.now() - last.t > 180 || last.t - s0.t < 5) return;
  const w = (last.r - s0.r) / ((last.t - s0.t) / 1000);
  if (Math.abs(w) < 4) { if (Math.abs(w) > 1) toast('Give it a harder flick! 💪'); return; }
  // ease-out cubic starts at speed 3D/T, so pick D and T to match the flick's speed
  const D = Math.sign(w) * Math.max(Math.abs(w) * 2.2, 2.5 * TAU);
  startSpin(D, Math.min(10, 3 * Math.abs(D) / Math.abs(w)));
};
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', endDrag);

// ───────────────────────── Confetti ─────────────────────────
const cc = $('#confetti'), cx = cc.getContext('2d');
let parts = [], confettiOn = false;
function burst(x, y, colors, count = 160) {
  if (reduced) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cc.width = innerWidth * dpr; cc.height = innerHeight * dpr; cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (Math.random() - .5) * Math.PI * 1.3, v = 6 + Math.random() * 11;
    parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, w: 6 + Math.random() * 6, h: 4 + Math.random() * 6,
      r: Math.random() * TAU, vr: (Math.random() - .5) * .4, c: colors[i % colors.length], life: 0, shape: i % 5 === 0 ? 'c' : 'r' });
  }
  if (!confettiOn) { confettiOn = true; requestAnimationFrame(confettiLoop); }
}
function confettiLoop() {
  cx.clearRect(0, 0, innerWidth, innerHeight);
  parts = parts.filter(p => p.y < innerHeight + 40 && p.life < 340);
  parts.forEach(p => {
    p.life++; p.vy += .28; p.vx *= .985; p.vy *= .985; p.x += p.vx + Math.sin(p.life / 9 + p.w) * .6; p.y += p.vy; p.r += p.vr;
    cx.save(); cx.translate(p.x, p.y); cx.rotate(p.r); cx.globalAlpha = Math.min(1, (340 - p.life) / 60);
    cx.fillStyle = p.c;
    if (p.shape === 'c') { cx.beginPath(); cx.arc(0, 0, p.h / 2, 0, TAU); cx.fill(); }
    else cx.fillRect(-p.w / 2, -p.h / 2 * Math.abs(Math.cos(p.life / 6)), p.w, p.h * Math.abs(Math.cos(p.life / 6)) + .5);
    cx.restore();
  });
  if (parts.length) requestAnimationFrame(confettiLoop);
  else { confettiOn = false; cx.clearRect(0, 0, innerWidth, innerHeight); }
}

// ───────────────────────── Modals ─────────────────────────
let lastFocus = null;
function openModal(sel) { lastFocus = document.activeElement; const m = $(sel); m.hidden = false; setTimeout(() => (m.querySelector('[data-autofocus]') || m.querySelector('button'))?.focus(), 30); }
function closeModal(sel) {
  const m = $(sel); if (m.hidden) return;
  m.hidden = true; lastFocus?.focus?.();
  if (sel === '#reveal') { winner = -1; idleAt = performance.now() + 1500; acceptPending(); }
}
document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', e => {
  if (e.target === m || e.target.closest('[data-close]')) closeModal('#' + m.id);
}));
// Closing the reveal without choosing still locks in the skill.
function acceptPending() { const r = lastRun(); if (r?.pending) { delete r.pending; save(); refreshPool(); renderAll(); } }

function showReveal(k, fun) {
  const card = $('#reveal .modal-card');
  card.style.setProperty('--ray', catOf(k).color);
  $('#revealEyebrow').textContent = fun ? 'Just for fun · not your weekly pick' : `Week ${weekNo()} · your new skill`;
  $('#revealEmoji').textContent = k.emoji;
  $('#revealName').textContent = k.name;
  $('#revealPitch').textContent = k.pitch;
  $('#revealFacts').innerHTML = factsHTML(k);
  const r = lastRun();
  $('#revealActions').innerHTML = fun
    ? `<button class="btn primary" data-act="view" data-autofocus>See the full rundown</button><button class="btn ghost" data-close>Close</button>`
    : `<button class="btn primary" data-act="accept" data-autofocus>Let's do it! →</button>
       <button class="btn" data-act="reroll" ${r.rerolls >= 1 || order.length < 2 ? 'disabled' : ''}>↻ Re-spin <small>(${1 - r.rerolls} left)</small></button>`;
  $('#revealActions').onclick = e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'accept') { closeModal('#reveal'); go('week'); toast(`Locked in: ${k.name}. Day 1 starts now!`); }
    if (act === 'reroll') { r.rerolls++; save(); $('#reveal').hidden = true; refreshPool(); setTimeout(spinRandom, 150); }
    if (act === 'view') { closeModal('#reveal'); openSkill(k.id); }
  };
  openModal('#reveal');
}

// ───────────────────────── Skill detail ─────────────────────────
function skillBody(k, run) {
  const today = run ? dayIndex(run, now()) : -1;
  const plan = k.plan.map(([title, desc], i) => run
    ? `<li><label class="day ${i === today ? 'today' : ''}"><input type="checkbox" data-day="${i}" ${run.checks[i] ? 'checked' : ''}>
         <span class="num">${i + 1}</span><span><b>${title}${i === today ? '<span class="today-tag">Today</span>' : ''}</b><span class="d">${desc}</span></span></label></li>`
    : `<li><div class="day"><span class="num">${i + 1}</span><span><b>${title}</b><span class="d">${desc}</span></span></div></li>`).join('');
  return `
    <div class="sec"><h3>What it is</h3><p>${k.what}</p></div>
    <div class="sec"><h3>Why it's worth it</h3><p>${k.why}</p></div>
    <div class="two">
      <div class="sec"><h3>What you'll need</h3><ul>${k.need.map(x => `<li>${x}</li>`).join('')}</ul></div>
      <div class="sec"><h3>How to learn it</h3><ol>${k.how.map(x => `<li>${x}</li>`).join('')}</ol></div>
    </div>
    <div class="sec"><h3>7-day training plan</h3><ol class="plan">${plan}</ol></div>
    <div class="sec"><h3>You've got it when…</h3><div class="goal">🎯 ${k.goal}</div></div>
    <div class="sec"><h3>Tips & pitfalls</h3><ul>${k.tips.map(x => `<li>${x}</li>`).join('')}</ul></div>
    <div class="sec"><h3>Resources</h3><div class="res">${k.res.map(resLink).join('')}</div></div>
    <div class="sec"><h3>After this week</h3><p>${k.next}</p></div>`;
}
function skillHero(k) {
  return `<div class="skill-hero" style="--cat:${catOf(k).color}">
    <span class="cat-chip">${catOf(k).emoji} ${catOf(k).name}</span>
    <div class="emoji" style="margin-top:14px">${k.emoji}</div>
    <h2>${k.name}</h2><p class="pitch">${k.pitch}</p><div class="facts">${factsHTML(k)}</div></div>`;
}
function openSkill(id) {
  const k = byId[id], s = state.settings;
  const onWheel = !s.excluded.includes(id);
  const canStart = !cur();
  $('#sheetBody').innerHTML = `${skillHero(k)}<div class="skill-body" style="--cat:${catOf(k).color}">
    <div class="toggle-row" style="margin-top:8px"><div><b>On the wheel</b><small>Turn off if this one doesn't appeal to you.</small></div>
      <label class="switch"><input type="checkbox" id="onWheel" ${onWheel ? 'checked' : ''} aria-label="Keep on the wheel"><span></span></label></div>
    ${skillBody(k, null)}
    <div class="week-actions">${canStart ? `<button class="btn primary" id="startThis">Skip the spin — start this skill now</button>` : ''}
      <button class="btn ghost" data-close>Close</button></div></div>`;
  $('#sheet .modal-card').style.setProperty('--cat', catOf(k).color);
  $('#onWheel').onchange = e => {
    s.excluded = e.target.checked ? s.excluded.filter(x => x !== id) : [...s.excluded, id];
    save(); if (!spinning) refreshPool(); renderLibrary();
  };
  const st = $('#startThis');
  if (st) st.onclick = () => {
    state.runs.push({ id, start: now(), checks: Array(RUN_DAYS).fill(false), notes: '', status: 'active', rating: 0, rerolls: 1 });
    save(); closeModal('#sheet'); refreshPool(); renderAll(); go('week'); toast(`Locked in: ${k.name}. Day 1 starts now!`);
  };
  $('#sheet .modal-card').scrollTop = 0;
  openModal('#sheet');
}

// ───────────────────────── Views ─────────────────────────
const VIEWS = ['wheel', 'week', 'library', 'journey'];
function go(v) {
  if (!VIEWS.includes(v)) v = 'wheel';
  VIEWS.forEach(x => { $('#view-' + x).hidden = x !== v; });
  document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.view === v));
  if (location.hash !== '#' + v) history.replaceState(null, '', '#' + v);
  if (v === 'week') renderWeek(); if (v === 'journey') renderJourney();
  if (v === 'wheel') requestAnimationFrame(() => { if (cv.clientWidth && Math.round(cv.clientWidth * Math.min(devicePixelRatio || 1, 2)) !== S) buildImages(); });
  window.scrollTo({ top: 0 });
}
document.querySelector('.tabs').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (b) go(b.dataset.view); });

function updateHub() {
  const c = cur(), btn = $('#spinBtn');
  btn.disabled = !!spinning || order.length < 2;
  btn.classList.toggle('ready', !c && !spinning && order.length >= 2);
  $('#hubSub').textContent = spinning ? '' : order.length < 2 ? 'no skills' : c && !c.pending ? 'for fun' : '';
  btn.setAttribute('aria-label', c && !c.pending ? 'Spin just for fun' : 'Spin the wheel for this week\'s skill');
  const st = $('#status');
  if (order.length < 2) {
    st.innerHTML = `<div class="big">Not enough skills on the wheel</div><div class="small">Loosen your <button class="linkish" data-open-settings>wheel settings</button> to add more.</div>`;
  } else if (c && !c.pending) {
    const k = byId[c.id], left = c.start + RUN_DAYS * DAY - now(), done = c.checks.filter(Boolean).length;
    st.innerHTML = `<div class="big">Week ${weekNo() - 1}: ${k.emoji} ${k.name}</div>
      <div class="small">Day ${dayIndex(c, now()) + 1} of 7 · ${done}/7 sessions done · next spin in ${fmtLeft(left)} · <button class="linkish" data-go="week">open plan →</button></div>`;
  } else {
    const l = lastRun();
    const expired = l && !l.pending && l.status === 'active';
    st.innerHTML = `<div class="big">${expired ? `Time's up on ${byId[l.id].emoji} ${byId[l.id].name}!` : state.runs.length ? `Week ${weekNo()} is ready to spin` : 'Your first skill is waiting'}</div>
      <div class="small">${expired ? `Did you nail it? <button class="linkish" data-finish>Mark it learned</button> · or spin for a new one.` : `${order.length} skills on the wheel. Spin to pick your skill for the next 7 days.`}</div>`;
  }
}
document.addEventListener('click', e => {
  if (e.target.closest('[data-open-settings]')) openSettings();
  const g = e.target.closest('[data-go]'); if (g) go(g.dataset.go);
  if (e.target.closest('[data-finish]')) finishRun(lastRun());
});
$('#spinBtn').addEventListener('click', () => { audio(); spinRandom(); });

function renderLegend() {
  const counts = {}; order.forEach(k => counts[k.cat] = (counts[k.cat] || 0) + 1);
  $('#legend').innerHTML = Object.entries(CATS).filter(([c]) => counts[c])
    .map(([c, v]) => `<span><i style="background:${v.color}"></i>${v.name} ${counts[c]}</span>`).join('');
}

// This week
function renderWeek() {
  const el = $('#view-week'), c = cur() || (lastRun()?.status === 'active' ? lastRun() : null);
  if (!c) {
    const l = lastRun();
    el.innerHTML = `<div class="empty"><div class="emoji">${l ? (l.status === 'done' ? '🏆' : '🌱') : '🎡'}</div>
      <h2>${l ? (l.status === 'done' ? `You learned ${byId[l.id].name}!` : 'Ready for a fresh start?') : 'No skill yet'}</h2>
      <p>${l ? 'Spin the wheel to pick what comes next.' : 'Spin the wheel to get your first skill and its 7-day plan.'}</p>
      <button class="btn primary" data-go="wheel">Go to the wheel</button></div>`;
    return;
  }
  const k = byId[c.id], live = c === cur(), di = dayIndex(c, now()), done = c.checks.filter(Boolean).length;
  const [tTitle, tDesc] = k.plan[di];
  el.innerHTML = `
    <div class="week-top" style="--cat:${catOf(k).color}">
      <div>
        <span class="cat-chip">${catOf(k).emoji} ${catOf(k).name}</span>
        <div style="display:flex;gap:14px;align-items:center;margin-top:12px"><div class="emoji">${k.emoji}</div>
          <div><h2>${k.name}</h2><div class="small" style="color:var(--muted)">Week ${state.runs.indexOf(c) + 1} · started ${fmtDate(c.start)} · ${live ? `${fmtLeft(c.start + RUN_DAYS * DAY - now())} left` : 'week over'}</div></div></div>
        <div class="today-box"><small>${live ? `Today · Day ${di + 1}` : 'Final day'}</small><div><b>${tTitle}</b> — ${tDesc}</div></div>
        <div class="facts" style="justify-content:flex-start;margin-top:12px">${factsHTML(k)}</div>
      </div>
      <div class="ring" style="--p:${done / 7 * 100}"><div><b>${done}/7</b><small>sessions</small></div></div>
    </div>
    <div class="week-panel" style="--cat:${catOf(k).color}"><div class="skill-body">
      <div class="sec" style="margin-top:14px"><h3>The pitch</h3><p>${k.pitch}</p></div>
      ${skillBody(k, c)}
      <div class="sec"><h3>Your notes</h3><textarea id="notes" placeholder="What clicked, what didn't, what to try next…"></textarea></div>
      <div class="week-actions">
        <button class="btn primary" data-finish-cur>🎉 I've learned it!</button>
        <button class="btn ghost" onclick="window.print()">🖨 Print plan</button>
        <button class="btn ghost danger" data-skip-cur>Skip this skill</button>
      </div>
    </div></div>`;
  $('#notes').value = c.notes || '';
  $('#notes').oninput = e => { c.notes = e.target.value; save(); };
  el.querySelectorAll('[data-day]').forEach(cb => cb.onchange = () => {
    c.checks[+cb.dataset.day] = cb.checked; save();
    const n = c.checks.filter(Boolean).length;
    el.querySelector('.ring').style.setProperty('--p', n / 7 * 100);
    el.querySelector('.ring b').textContent = `${n}/7`;
    if (cb.checked) {
      pop();
      const r = cb.closest('.day').getBoundingClientRect();
      burst(r.left + 30, r.top + 20, [catOf(k).color, '#34d399', '#ffd166'], n === 7 ? 220 : 26);
      if (n === 7) { chime(); toast('All 7 sessions done! Mark it learned when you hit the goal 🎯'); }
    }
    updateHub(); updateTabDot();
  });
  el.querySelector('[data-finish-cur]').onclick = () => finishRun(c);
  el.querySelector('[data-skip-cur]').onclick = () => confirmSheet(`Skip ${k.name}?`, 'It goes into your journey as skipped, and the wheel unlocks for a new spin.', 'Skip it', () => {
    c.status = 'skipped'; c.end = now(); save(); refreshPool(); renderAll(); go('wheel');
  });
}

function finishRun(run) {
  const k = byId[run.id];
  let rating = run.rating || 0;
  $('#sheetBody').innerHTML = `<div class="settings" style="text-align:center">
    <div style="font-size:64px">🏆</div><h2>You learned ${k.name}!</h2>
    <p class="sub">How was it? Your rating is for your own journey log.</p>
    <div class="rate" id="rate">${[1, 2, 3, 4, 5].map(i => `<button aria-label="${i} stars" data-r="${i}">★</button>`).join('')}</div>
    <textarea id="reflect" placeholder="One line to remember: what surprised you?" style="margin-top:12px"></textarea>
    <div class="reveal-actions"><button class="btn primary" id="doneBtn" data-autofocus>Add to my journey</button><button class="btn ghost" data-close>Not yet</button></div></div>`;
  const paint = () => $('#rate').querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.r <= rating));
  paint();
  $('#reflect').value = run.reflection || '';
  $('#rate').onclick = e => { const b = e.target.closest('[data-r]'); if (b) { rating = +b.dataset.r; paint(); pop(); } };
  $('#doneBtn').onclick = () => {
    Object.assign(run, { status: 'done', rating, reflection: $('#reflect').value, end: now() });
    delete run.pending; save(); closeModal('#sheet'); chime();
    burst(innerWidth / 2, innerHeight * .35, ['#ffd166', '#34d399', catOf(k).color, '#fff'], 260);
    refreshPool(); renderAll(); go('journey');
    toast(`${k.emoji} ${k.name} added to your journey!`);
  };
  openModal('#sheet');
}

function confirmSheet(title, text, label, fn) {
  $('#sheetBody').innerHTML = `<div class="settings"><h2>${title}</h2><p class="sub">${text}</p>
    <div class="week-actions"><button class="btn primary" id="okBtn">${label}</button><button class="btn ghost" data-close data-autofocus>Cancel</button></div></div>`;
  $('#okBtn').onclick = () => { closeModal('#sheet'); fn(); };
  openModal('#sheet');
}

// Library
let libCat = 'all';
function renderLibrary() {
  const q = $('#libSearch').value.trim().toLowerCase();
  const learned = new Set(state.runs.filter(r => r.status === 'done').map(r => r.id)), c = cur();
  const counts = {}; SKILLS.forEach(k => counts[k.cat] = (counts[k.cat] || 0) + 1);
  $('#libChips').innerHTML = [['all', { emoji: '✨', name: 'All' }], ...Object.entries(CATS)].map(([id, v]) =>
    `<button class="chip" data-cat="${id}" aria-pressed="${libCat === id}">${v.emoji} ${v.name} <small>${id === 'all' ? SKILLS.length : counts[id]}</small></button>`).join('');
  const list = SKILLS.filter(k => (libCat === 'all' || k.cat === libCat) &&
    (!q || (k.name + ' ' + k.pitch + ' ' + catOf(k).name).toLowerCase().includes(q)));
  $('#libGrid').innerHTML = list.map(k => {
    const badge = c?.id === k.id ? '<span class="badge now">Now</span>' : learned.has(k.id) ? '<span class="badge">Learned ✓</span>'
      : state.settings.excluded.includes(k.id) ? '<span class="badge off">Off wheel</span>' : '';
    return `<button class="card ${learned.has(k.id) ? 'learned' : ''}" style="--cat:${catOf(k).color}" data-skill="${k.id}">${badge}
      <div class="emoji">${k.emoji}</div><h3>${k.name}</h3><p>${k.pitch}</p>
      <div class="meta"><span>⏱ ${wkText(k)}</span><span>💸 ${costText(k)}</span><span>${'●'.repeat(k.level)}${'○'.repeat(3 - k.level)}</span></div></button>`;
  }).join('') || '<p class="empty">No skills match that search.</p>';
}
$('#libChips').addEventListener('click', e => { const b = e.target.closest('[data-cat]'); if (b) { libCat = b.dataset.cat; renderLibrary(); } });
$('#libSearch').addEventListener('input', renderLibrary);
document.addEventListener('click', e => { const s = e.target.closest('[data-skill]'); if (s) openSkill(s.dataset.skill); });

// Journey
function renderJourney() {
  const runs = state.runs.filter(r => !r.pending), learned = runs.filter(r => r.status === 'done');
  const learnedIds = new Set(learned.map(r => r.id));
  const sessions = runs.reduce((n, r) => n + r.checks.filter(Boolean).length, 0);
  const c = cur();
  const stateOf = r => r === c ? ['active', 'In progress'] : r.status === 'done' ? ['done', 'Learned ✓'] : r.status === 'skipped' ? ['skipped', 'Skipped'] : ['ended', 'Week over'];
  $('#view-journey').innerHTML = `
    <div class="lib-head"><h2>Your journey</h2></div>
    <div class="stats">
      <div class="stat"><b>${learned.length}</b><span>skills learned</span></div>
      <div class="stat"><b>${streak(runs, now())}🔥</b><span>skill streak</span></div>
      <div class="stat"><b>${sessions}</b><span>practice sessions</span></div>
      <div class="stat"><b>${SKILLS.length - learnedIds.size}</b><span>still to discover</span></div>
    </div>
    <div class="sec"><h3>Collection · ${learnedIds.size}/${SKILLS.length}</h3>
      <div class="shelf">${SKILLS.map(k => `<button class="shelf-item ${learnedIds.has(k.id) ? 'got' : ''}" style="--cat:${catOf(k).color}" data-skill="${k.id}" title="${k.name}${learnedIds.has(k.id) ? ' · learned' : ''}" aria-label="${k.name}${learnedIds.has(k.id) ? ', learned' : ''}">${k.emoji}</button>`).join('')}</div></div>
    <div class="sec"><h3>Timeline</h3>
    <div class="timeline">${runs.length ? runs.slice().reverse().map(r => {
      const k = byId[r.id], [cls, label] = stateOf(r);
      return `<button class="run" style="--cat:${catOf(k).color}" data-skill="${k.id}">
        <span class="emoji">${k.emoji}</span>
        <span><h3>Week ${state.runs.indexOf(r) + 1} · ${k.name}</h3>
          <small>${fmtDate(r.start)}${r.status === 'done' && r.rating ? ` · <span class="stars">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span>` : ''}${r.reflection ? ` · “${r.reflection.replace(/</g, '&lt;')}”` : ''}</small>
          <span class="pips">${r.checks.map(x => `<i class="${x ? 'on' : ''}"></i>`).join('')}</span></span>
        <span class="state ${cls}">${label}</span></button>`;
    }).join('') : '<div class="empty" style="padding:30px">Nothing here yet — your first spin starts the story.</div>'}</div></div>
    <div class="backup">
      <button class="btn" id="exportBtn">⬇ Export backup</button>
      <label class="btn" style="cursor:pointer">⬆ Import backup<input type="file" accept="application/json" id="importIn" hidden></label>
      <button class="btn ghost danger" id="resetBtn">Reset everything</button>
    </div>`;
  $('#exportBtn').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
    a.download = `skill-wheel-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('#importIn').onchange = async e => {
    try {
      const s = JSON.parse(await e.target.files[0].text());
      if (!Array.isArray(s.runs) || !s.runs.every(r => byId[r.id] && Array.isArray(r.checks) && typeof r.start === 'number')) throw 0;
      state = { runs: s.runs, settings: { ...DEFAULT_SETTINGS, ...s.settings } };
      save(); refreshPool(); renderAll(); toast('Backup restored ✓');
    } catch { toast('That file doesn\'t look like a Skill Wheel backup.'); }
  };
  $('#resetBtn').onclick = () => confirmSheet('Reset everything?', 'This deletes your whole journey and settings on this device. Export a backup first if you might want it back.', 'Delete everything', () => {
    state = { runs: [], settings: { ...DEFAULT_SETTINGS } }; save(); refreshPool(); renderAll(); go('wheel');
  });
}

// Settings
function openSettings() {
  const s = state.settings;
  const sw = (id, on, title, sub, extra = '') => `<div class="toggle-row"><div><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</div>
    <label class="switch"><input type="checkbox" data-set="${id}" ${on ? 'checked' : ''} aria-label="${title.replace(/<[^>]*>/g, '').trim()}" ${extra}><span></span></label></div>`;
  $('#sheetBody').innerHTML = `<div class="settings"><h2>Wheel settings</h2><p class="sub">Shape what can come up. Changes apply on the next spin.</p>
    <div class="sec"><h3>Categories</h3>${Object.entries(CATS).map(([id, v]) => sw('cat:' + id, s.cats[id] !== false, `<span style="color:${v.color}">●</span> ${v.emoji} ${v.name}`, '')).join('')}</div>
    <div class="sec"><h3>Filters</h3>
      ${sw('quickOnly', s.quickOnly, 'Quick wins only', 'Only skills you can get solid at in 2 weeks or less.')}
      ${sw('freeOnly', s.freeOnly, 'Free only', 'Hide anything that needs a purchase, even a cheap one.')}
      ${sw('allowRepeats', s.allowRepeats, 'Allow learned skills', 'Put skills you\'ve already finished back on the wheel.')}
      ${sw('sound', s.sound, 'Sound effects', 'Ticks, chimes and whooshes. Shortcut: M.')}</div>
    <p class="pool-count" id="poolCount"></p>
    ${s.excluded.length ? `<p class="small" style="color:var(--muted)">${s.excluded.length} skill${s.excluded.length > 1 ? 's' : ''} turned off individually · <button class="linkish" id="clearEx">put them back</button></p>` : ''}
    <div class="week-actions"><button class="btn primary" data-close data-autofocus>Done</button></div></div>`;
  const count = () => { $('#poolCount').textContent = `🎡 ${buildPool(SKILLS, state.runs, s).length} skills on the wheel`; };
  count();
  $('#sheetBody').onchange = e => {
    const key = e.target.dataset.set; if (!key) return;
    if (key.startsWith('cat:')) s.cats[key.slice(4)] = e.target.checked; else s[key] = e.target.checked;
    save(); count(); updateSound();
    if (!spinning) { refreshPool(); updateHub(); }
  };
  const ce = $('#clearEx'); if (ce) ce.onclick = () => { s.excluded = []; save(); refreshPool(); updateHub(); renderLibrary(); openSettings(); };
  openModal('#sheet');
}
$('#settingsBtn').onclick = openSettings;

function updateSound() { $('#soundBtn').textContent = state.settings.sound ? '🔊' : '🔇'; }
$('#soundBtn').onclick = () => { state.settings.sound = !state.settings.sound; save(); updateSound(); toast(state.settings.sound ? 'Sound on' : 'Sound off'); };

function updateTabDot() {
  const c = cur(), b = document.querySelector('[data-view="week"]');
  b.querySelector('.dot')?.remove();
  if (c && !c.pending && !c.checks[dayIndex(c, now())]) b.insertAdjacentHTML('beforeend', '<span class="dot" title="Today\'s session isn\'t ticked off yet"></span>');
}

function renderAll() { updateHub(); renderWeek(); renderLibrary(); renderJourney(); updateTabDot(); updateSound(); }

// ───────────────────────── Keys, boot ─────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeModal('#sheet'); closeModal('#reveal'); return; }
  if (e.target.closest('input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  const modalOpen = !$('#sheet').hidden || !$('#reveal').hidden;
  if (e.key === ' ' && !modalOpen && !$('#view-wheel').hidden && !e.target.closest('button:not([role=tab])')) { e.preventDefault(); audio(); spinRandom(); }
  if (e.key.toLowerCase() === 'm') $('#soundBtn').click();
  if (!modalOpen && '1234'.includes(e.key)) go(VIEWS[+e.key - 1]);
});
let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(buildImages, 120); });
setInterval(() => { updateHub(); updateTabDot(); }, 30000);

refreshPool();
go(location.hash.slice(1) || 'wheel');
renderAll();
// Fonts change label metrics; rebuild once they're in.
document.fonts?.ready.then(() => buildImages());
requestAnimationFrame(loop);

// Debug/test hook.
window.skillWheel = {
  get state() { return state; }, get order() { return order; }, get rot() { return rot; }, get spinning() { return !!spinning; },
  setNowOffset(ms) { nowOffset = ms; renderAll(); },
  spinTo(id) { const i = order.findIndex(k => k.id === id); if (i < 0) return false; const seg = TAU / order.length;
    startSpin(((-(i + .5) * seg - rot) % TAU + TAU) % TAU + 5 * TAU, 1); return true; },
};
})();
