// Archery client. A pseudo-3D 2D-canvas range: the 122 cm target sits on a straw boss 70 m
// down-range, wind flags flutter beside it and a wind badge shows each arrow's wind. On your
// turn press & hold anywhere on the range to draw: the view zooms into the scope, the sight pin
// sways (wide at first, steadiest after ~1.3 s, then the arm tires) and dragging moves it. Let go
// to loose. The sway comes from the shared sim (sim.js) with the per-arrow seed the server sent,
// so the pin you watched is where the arrow is aimed; the wind then carries it half a ring per
// mph downwind. Arrows fly in with perspective, thud into the face and stay for the end.
import { sfx } from '../sfx.js';
import { preferredLevel, levelSelect } from '../botLevel.js';
import { createResults } from '../resultsPanel.js';
import { changeTracker } from '../boardFx.js';

const SEAT_COLOR = { p1: '#3ad7ff', p2: '#ffb000' };
const REJECT_MESSAGES = {
  not_your_turn: "It's not your turn",
  not_playing: 'The game is not in progress',
  invalid: 'Invalid shot',
  stale: 'Too quick. Wait for the last arrow',
  busy: 'Wait for the arrow to land',
};
const FLIGHT_MS = 900; // matches the server's timing.flight
const MIN_HOLD_MS = 200;
const ZMAX = 2.1; // scope zoom while drawing / watching an arrow land
const BOSS_HALF_CM = 74; // straw boss half-size: outside it the arrow sails past
const RING_COLORS = ['#f4f1e6', '#f4f1e6', '#1d1d1f', '#1d1d1f', '#2aa2dc', '#2aa2dc', '#e3302b', '#e3302b', '#f8d21c', '#f8d21c'];

const CSS = `
.ar-root { display: flex; flex-direction: column; align-items: center; gap: 8px; width: 100%; }
.ar-status { font-size: 18px; font-weight: bold; padding: 6px 14px; border-radius: 6px; border: 2px solid transparent; text-align: center; }
.ar-status.mine { background: rgba(57,255,20,.15); border-color: #39ff14; }
.ar-err { color: #ff4d4d; min-height: 1.2em; font-size: 14px; }
.ar-seats { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; align-items: center; }
.ar-seat { display: flex; gap: 6px; align-items: center; padding: 4px 8px; border: 1px solid #1f8f0c; border-radius: 6px; }
.ar-seat.turn { border-color: #39ff14; box-shadow: 0 0 10px -2px #39ff14; }
.ar-chip { width: 12px; height: 12px; border-radius: 50%; display: inline-block; flex: none; box-shadow: 0 0 6px currentColor; }
.ar-main { display: flex; gap: 14px; align-items: flex-start; justify-content: center; flex-wrap: wrap; width: 100%; }
.ar-stage { position: relative; touch-action: none; user-select: none; -webkit-user-select: none; flex: 0 1 auto; }
.ar-canvas { display: block; border-radius: 12px; border: 1px solid #1f8f0c; cursor: default; }
.ar-canvas.can-aim { cursor: crosshair; }
.ar-steady { height: 6px; border-radius: 3px; background: #0b1a0b; border: 1px solid #1f8f0c; overflow: hidden; margin-top: 6px; position: relative; }
.ar-steady i { position: absolute; left: 0; top: 0; bottom: 0; background: #39ff14; }
.ar-hint { font-size: 12px; color: #6fae5f; text-align: center; margin-top: 4px; min-height: 1.3em; }
.ar-panel { display: flex; flex-direction: column; gap: 8px; min-width: 230px; flex: 0 1 280px; }
.ar-meta { display: flex; justify-content: space-between; font-size: 12px; color: #6fae5f; letter-spacing: 1px; }
.ar-card { border: 1px solid #1f8f0c; border-radius: 8px; padding: 8px 10px; background: rgba(8,20,8,.6); transition: box-shadow .2s, border-color .2s; }
.ar-card.turn { box-shadow: 0 0 14px -3px var(--c); border-color: var(--c); }
.ar-card .nm { display: flex; align-items: center; gap: 6px; font-size: 14px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ar-card .big { font-size: 40px; font-weight: bold; line-height: 1.05; color: var(--c); text-shadow: 0 0 12px var(--c); font-variant-numeric: tabular-nums; }
.ar-card .big.bump { animation: ar-bump .4s ease-out; }
@keyframes ar-bump { 40% { transform: scale(1.12); } }
.ar-card .sub { font-size: 12px; color: #8fcf7f; display: flex; justify-content: space-between; gap: 8px; }
.ar-slots { display: flex; gap: 5px; margin-top: 6px; }
.ar-slot { flex: 1; text-align: center; border: 1px dashed #1f8f0c; border-radius: 4px; padding: 3px 0; font-size: 14px; font-weight: bold; min-height: 1.3em; color: #cfe; }
.ar-slot.hit { border-style: solid; border-color: var(--c); }
.ar-slot.x { color: #f8d21c; text-shadow: 0 0 6px #f8d21c; }
.ar-slot.m { color: #ff4d4d; }
.ar-card-tbl { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
.ar-card-tbl th { color: #6fae5f; font-weight: normal; font-size: 11px; padding: 2px; }
.ar-card-tbl td { text-align: center; padding: 3px 2px; border-top: 1px solid #143d0b; }
.ar-card-tbl td.cur { background: rgba(57,255,20,.1); }
.ar-card-tbl td.part { color: #6fae5f; }
.ar-card-tbl td.tot { font-weight: bold; }
.ar-so { font-size: 12px; color: #ffb000; letter-spacing: 1px; }
.ar-callout {
  position: absolute; left: 50%; top: 30%; transform: translate(-50%, -50%); z-index: 5; pointer-events: none;
  background: rgba(5,8,10,.9); border: 2px solid var(--c); color: var(--c); border-radius: 8px;
  padding: 10px 18px; font-weight: bold; font-size: 20px; letter-spacing: 2px; white-space: nowrap;
  box-shadow: 0 0 26px -4px var(--c); animation: ar-callout 2.2s ease-in-out forwards;
}
@keyframes ar-callout { 0% { opacity: 0; transform: translate(-50%, -50%) scale(.5); } 12% { opacity: 1; transform: translate(-50%, -50%) scale(1.08); } 20% { transform: translate(-50%, -50%) scale(1); } 80% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -70%); } }
.ar-btn-row { display: flex; gap: 8px; }
@media (prefers-reduced-motion: reduce) { .ar-callout, .ar-card .big.bump { animation: none; } }
`;

let styled = false;
function ensureStyles() {
  if (styled) return;
  styled = true;
  const tag = document.createElement('style');
  tag.textContent = CSS;
  document.head.appendChild(tag);
}

function loadSim() {
  if (window.ArcherySim) return Promise.resolve(window.ArcherySim);
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = 'games/archery/sim.js';
    el.onload = () => resolve(window.ArcherySim);
    el.onerror = () => reject(new Error('Failed to load archery sim'));
    document.head.appendChild(el);
  });
}

const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const ringColor = (label) => (label === 'X' || label === '10' || label === '9' ? '#f8d21c' : label === '8' || label === '7' ? '#ff5a4f' : label === '6' || label === '5' ? '#3ab8ff' : label === 'M' ? '#ff4d4d' : '#ffffff');
const ptsOf = (l) => (l === 'X' ? 10 : l === 'M' ? 0 : Number(l));

// Scene geometry (CSS px) for a W x H canvas.
function geom(W, H) {
  const R0 = W * 0.135;
  const C = { x: W / 2, y: H * 0.46 };
  return { W, H, R0, C, hy: H * 0.34, B: R0 * (BOSS_HALF_CM / 61), groundT: C.y + R0 * 1.95 };
}

// Static backdrop: sky, hills, mown range, stand and straw boss (the face is drawn live).
function paintBackground(g, scale) {
  const { W, H, R0, C, hy, B, groundT } = g;
  const cv = document.createElement('canvas');
  cv.width = Math.round(W * scale);
  cv.height = Math.round(H * scale);
  const ctx = cv.getContext('2d');
  ctx.scale(scale, scale);
  let seed = 11;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

  const sky = ctx.createLinearGradient(0, 0, 0, hy);
  sky.addColorStop(0, '#12304a');
  sky.addColorStop(0.6, '#4b819c');
  sky.addColorStop(1, '#c4dccb');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, hy + 2);
  const sun = ctx.createRadialGradient(W * 0.8, hy * 0.5, 2, W * 0.8, hy * 0.5, W * 0.25);
  sun.addColorStop(0, 'rgba(255,246,210,0.9)');
  sun.addColorStop(0.08, 'rgba(255,240,190,0.5)');
  sun.addColorStop(1, 'rgba(255,240,190,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, W, hy);
  for (let i = 0; i < 6; i++) {
    const cx = rand() * W;
    const cy = hy * (0.15 + rand() * 0.45);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      ctx.ellipse(cx + (k - 1.5) * W * 0.03, cy + (k % 2) * 3, W * (0.04 + rand() * 0.03), H * 0.018, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Hills and treeline.
  ctx.fillStyle = '#3f6e5f';
  ctx.beginPath();
  ctx.moveTo(0, hy);
  for (let x = 0; x <= W; x += W / 40) ctx.lineTo(x, hy - H * 0.05 - Math.sin(x / W * 5 + 1) * H * 0.025);
  ctx.lineTo(W, hy);
  ctx.fill();
  ctx.fillStyle = '#1f4330';
  for (let x = -10; x < W + 10; x += 6 + rand() * 8) {
    ctx.beginPath();
    ctx.arc(x, hy - H * 0.01, H * (0.015 + rand() * 0.02), Math.PI, 0);
    ctx.fill();
  }
  ctx.fillRect(0, hy - H * 0.012, W, H * 0.014);
  // Range grass with mown stripes converging on the vanishing point.
  const grass = ctx.createLinearGradient(0, hy, 0, H);
  grass.addColorStop(0, '#5b9443');
  grass.addColorStop(1, '#2c6522');
  ctx.fillStyle = grass;
  ctx.fillRect(0, hy, W, H - hy);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, hy, W, H - hy);
  ctx.clip();
  const vx = W / 2;
  const vy = hy - H * 0.04;
  for (let i = -12; i < 12; i++) {
    if (i % 2) continue;
    const b0 = W / 2 + i * W * 0.14;
    ctx.beginPath();
    ctx.moveTo(vx, vy);
    ctx.lineTo(b0, H);
    ctx.lineTo(b0 + W * 0.14, H);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fill();
  }
  // Distance lines and the shooting line.
  for (let i = 1; i <= 4; i++) {
    const y = groundT + (H - groundT) * (1 - Math.pow(0.62, i));
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(0, y, W, 1 + i * 0.4);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillRect(0, H * 0.95, W, 3);
  // Grass flecks.
  for (let n = 0; n < 900; n++) {
    const y = hy + Math.pow(rand(), 0.7) * (H - hy);
    const f = (y - hy) / (H - hy);
    ctx.fillStyle = rand() < 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.1)';
    ctx.fillRect(rand() * W, y, 0.6 + f * 1.4, 1 + f * 3);
  }
  ctx.restore();

  // Stand shadow and A-frame legs.
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(C.x + R0 * 0.2, groundT + R0 * 0.02, B * 1.35, R0 * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#4a321c';
  ctx.lineWidth = R0 * 0.08;
  ctx.beginPath();
  ctx.moveTo(C.x, C.y);
  ctx.lineTo(C.x + R0 * 0.1, groundT - R0 * 0.12);
  ctx.stroke();
  ctx.strokeStyle = '#7a5530';
  ctx.lineWidth = R0 * 0.1;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(C.x + s * B * 0.75, C.y + B * 0.9);
    ctx.lineTo(C.x + s * B * 1.05, groundT);
    ctx.stroke();
  }
  // Boss: side thickness, straw face, texture.
  const d = R0 * 0.12;
  ctx.fillStyle = '#8a6a32';
  ctx.beginPath();
  ctx.moveTo(C.x + B, C.y - B);
  ctx.lineTo(C.x + B + d, C.y - B + d * 0.5);
  ctx.lineTo(C.x + B + d, C.y + B + d * 0.5);
  ctx.lineTo(C.x + B, C.y + B);
  ctx.fill();
  const straw = ctx.createLinearGradient(C.x - B, C.y - B, C.x + B, C.y + B);
  straw.addColorStop(0, '#e2c27c');
  straw.addColorStop(1, '#b48d48');
  ctx.fillStyle = straw;
  ctx.fillRect(C.x - B, C.y - B, B * 2, B * 2);
  ctx.save();
  ctx.beginPath();
  ctx.rect(C.x - B, C.y - B, B * 2, B * 2);
  ctx.clip();
  ctx.lineWidth = 0.6;
  for (let n = 0; n < 700; n++) {
    const x = C.x - B + rand() * B * 2;
    const y = C.y - B + rand() * B * 2;
    const a = rand() * Math.PI;
    const l = R0 * (0.04 + rand() * 0.08);
    ctx.strokeStyle = rand() < 0.5 ? 'rgba(90,60,20,0.35)' : 'rgba(255,240,190,0.35)';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  // Binding twine.
  ctx.strokeStyle = 'rgba(80,50,20,0.5)';
  ctx.lineWidth = R0 * 0.025;
  for (const f of [-0.6, 0.6]) {
    ctx.beginPath();
    ctx.moveTo(C.x - B, C.y + f * B);
    ctx.lineTo(C.x + B, C.y + f * B);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(60,40,15,0.6)';
  ctx.lineWidth = 1;
  ctx.strokeRect(C.x - B, C.y - B, B * 2, B * 2);
  return cv;
}

export function mount(container, api) {
  ensureStyles();
  let Sim = null;
  let view = null;
  let roster = [];
  let flashError = null;
  let flashTimer = null;
  let renderTimer = null;
  let raf = 0;
  let destroyed = false;
  let pendingShot = null; // shotNo we're waiting to see advance
  let aim = null; // { pointerId, start, sx, sy, x, y } (x, y = sight in cm)
  let g = null;
  let bgImg = null;
  let zoom = 1;
  let zoomHoldUntil = 0;
  let lastFrame = 0;
  let readyAt = 0; // local: no drawing until the last arrow has landed
  let shake = { until: 0, amp: 0 };
  let release = null; // { at } string snap animation
  let windShown = null; // { angle, speed } eased toward the current wind
  const seen = new Map(); // arrow n -> { start, landed, landedAt }
  const popups = []; // { x, y (cm), text, color, start }
  const bits = []; // straw particles in face cm: { x, y, vx, vy, start }
  const bursts = []; // X ring bursts { x, y, start }
  const calloutChanged = changeTracker();
  let prevTotals = null;

  const root = document.createElement('div');
  root.className = 'ar-root';
  container.appendChild(root);
  const results = createResults(container);

  const status = document.createElement('div');
  status.className = 'ar-status';
  const err = document.createElement('div');
  err.className = 'ar-err';
  const seats = document.createElement('div');
  seats.className = 'ar-seats';
  const main = document.createElement('div');
  main.className = 'ar-main';
  const stage = document.createElement('div');
  stage.className = 'ar-stage';
  const canvas = document.createElement('canvas');
  canvas.className = 'ar-canvas';
  const steady = document.createElement('div');
  steady.className = 'ar-steady';
  const steadyFill = document.createElement('i');
  steady.appendChild(steadyFill);
  const hint = document.createElement('div');
  hint.className = 'ar-hint';
  stage.append(canvas, steady, hint);
  const panel = document.createElement('div');
  panel.className = 'ar-panel';
  main.append(stage, panel);
  const btnRow = document.createElement('div');
  btnRow.className = 'ar-btn-row';
  root.append(status, err, seats, main, btnRow);

  function nicknameFor(clientId) {
    if (!clientId) return null;
    if (clientId === 'BOT') return '(bot)';
    const entry = roster.find((r) => r.clientId === clientId);
    return entry ? entry.nickname : 'someone';
  }
  const seatName = (seat) => {
    const id = view.players[seat];
    if (id === 'BOT') return `Bot (${((view.botLevels || {})[seat] || 'hard').replace(/^./, (c) => c.toUpperCase())})`;
    return nicknameFor(id) || '(empty)';
  };
  function mySeat() {
    const me = api.getClientId();
    if (!view) return null;
    if (view.players.p1 === me) return 'p1';
    if (view.players.p2 === me) return 'p2';
    return null;
  }
  const anyFlying = () => [...seen.values()].some((s) => !s.landed);
  const canShoot = () => view && Sim && g && view.phase === 'playing' && mySeat() === view.turn && pendingShot == null
    && !anyFlying() && performance.now() >= readyAt;

  // --- sizing / transforms ---
  function resize() {
    const cw = container.clientWidth || 800;
    const narrow = cw < 820;
    const W = Math.floor(Math.max(260, Math.min(600, narrow ? cw - 8 : cw - 310, window.innerWidth - 24)));
    const H = Math.round(W * 0.75);
    if (g && g.W === W && bgImg) return;
    g = geom(W, H);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    steady.style.width = `${W}px`;
    hint.style.width = `${W}px`;
    bgImg = paintBackground(g, Math.min(3, dpr * 1.6));
  }
  const zf = () => (zoom - 1) / (ZMAX - 1);
  function focus() {
    return { x: g.W / 2, y: g.C.y + (g.H * 0.5 - g.C.y) * zf() };
  }
  let shakeOff = { x: 0, y: 0 };
  // Scene px -> screen px.
  function toScreen(sx, sy) {
    const F = focus();
    return { x: F.x + (sx - g.C.x) * zoom + shakeOff.x, y: F.y + (sy - g.C.y) * zoom + shakeOff.y };
  }
  const k = () => g.R0 / Sim.FACE_R; // scene px per cm
  const faceToScreen = (x, y) => toScreen(g.C.x + x * k(), g.C.y + y * k());
  const pxPerCmScreen = () => k() * zoom;

  // --- aiming ---
  function localXY(e) {
    const r = canvas.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (!canShoot() || aim) return;
    e.preventDefault();
    const { px, py } = localXY(e);
    aim = { pointerId: e.pointerId, start: performance.now(), sx: px, sy: py, x: 0, y: 0 };
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    sfx.play('slide', { vol: 0.5 });
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!aim || e.pointerId !== aim.pointerId || !g) return;
    const { px, py } = localXY(e);
    // Relative drag at full-zoom scale: the finger never covers the sight.
    const s = k() * ZMAX;
    aim.x = Math.max(-Sim.MAX_AIM, Math.min(Sim.MAX_AIM, (px - aim.sx) / s));
    aim.y = Math.max(-Sim.MAX_AIM, Math.min(Sim.MAX_AIM, (py - aim.sy) / s));
  });
  const loose = (e) => {
    if (!aim || (e && e.pointerId !== aim.pointerId)) return;
    const held = performance.now() - aim.start;
    const p = { x: aim.x, y: aim.y };
    aim = null;
    if (held < MIN_HOLD_MS) {
      hint.textContent = 'Hold to draw the bow. Let go when the sight is steady';
      delete hint.dataset.auto;
      return;
    }
    if (!canShoot()) return;
    pendingShot = view.shotNo;
    release = { at: performance.now() };
    api.sendAction({ kind: 'shoot', x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100, t: Math.round(held), seed: view.shotSeed });
    sfx.play('whoosh');
  };
  canvas.addEventListener('pointerup', loose);
  canvas.addEventListener('pointercancel', (e) => { if (aim && e.pointerId === aim.pointerId) aim = null; });
  const onKey = (e) => { if (e.key === 'Escape' && aim) { aim = null; hint.textContent = 'Shot cancelled'; delete hint.dataset.auto; } };
  window.addEventListener('keydown', onKey);

  // --- arrows ---
  function arrowsOnTarget(now) {
    if (!view) return [];
    const cur = view.endArrows || [];
    const last = view.lastEndArrows || [];
    if (!cur.length) return last.map((a) => ({ a, alpha: 1 }));
    const out = cur.map((a) => ({ a, alpha: 1 }));
    // The previous end's arrows are pulled once the new end's first arrow has landed.
    if (cur.length === 1) {
      const s = seen.get(cur[0].n);
      const t = !s || !s.landed ? 1 : 1 - (now - s.landedAt) / 500;
      if (t > 0) for (const a of last) out.unshift({ a, alpha: t });
    }
    return out;
  }
  const inBoss = (a) => Math.abs(a.x) <= BOSS_HALF_CM && Math.abs(a.y) <= BOSS_HALF_CM;

  function onLanded(a, now) {
    const s = seen.get(a.n);
    s.landed = true;
    s.landedAt = now;
    readyAt = now + 250;
    zoomHoldUntil = now + 1000;
    let text = a.label === 'M' ? 'MISS' : a.label;
    if (a.so) text = a.label === 'M' ? 'MISS' : `${a.dist.toFixed(1)} cm`;
    popups.push({ x: a.x, y: a.y, text, color: ringColor(a.label), start: now });
    if (!inBoss(a)) { sfx.play('dry'); return; }
    if (!reduced()) shake = { until: now + 160, amp: 2.5 };
    for (let i = 0; i < 9; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = 8 + Math.random() * 22;
      bits.push({ x: a.x, y: a.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 10, start: now });
    }
    if (a.label === 'M') sfx.play('move');
    else sfx.play(a.pts >= 9 ? 'capture' : 'move');
    if (a.label === 'X') { bursts.push({ x: a.x, y: a.y, start: now }); setTimeout(() => sfx.play('chime'), 90); } else if (a.pts === 10) setTimeout(() => sfx.play('point'), 90);
  }

  // Stuck arrow at screen point p: shaft toward the viewer, fletched in the archer's colour.
  function drawStuck(ctx, p, a, alpha) {
    const sc = pxPerCmScreen() * 1.6;
    const jitter = ((a.n * 37) % 11) / 11 - 0.5;
    const dx = (g.W / 2 - p.x) / g.W * 7 * sc + jitter * 2 * sc;
    const dy = 4.5 * sc + jitter * sc;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = Math.max(1.2, 0.5 * sc);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 4 * sc, p.y + 2.5 * sc);
    ctx.stroke();
    ctx.strokeStyle = '#1b1d22';
    ctx.lineWidth = Math.max(1.4, 0.55 * sc);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + dx, p.y + dy);
    ctx.stroke();
    const col = SEAT_COLOR[a.seat] || '#fff';
    ctx.fillStyle = col;
    for (const s of [-1, 1, 0]) {
      ctx.beginPath();
      ctx.moveTo(p.x + dx * 0.7, p.y + dy * 0.7);
      ctx.lineTo(p.x + dx + s * 1.3 * sc, p.y + dy + (s ? 0.3 : 1.4) * sc);
      ctx.lineTo(p.x + dx, p.y + dy);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(p.x + dx, p.y + dy, Math.max(1, 0.35 * sc), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Arrow in flight: perspective shrink from the bow toward the landing point, curling downwind.
  function flightPos(a, t) {
    const L = faceToScreen(a.x, a.y);
    const d = Sim.windDrift(a.wind);
    const s = pxPerCmScreen();
    const L0 = { x: L.x - d.dx * s, y: L.y - d.dy * s };
    const P0 = bowGrip(); // leaves from the bow
    const w = (1 - t) / (1 + 13 * t);
    const arc = g.R0 * zoom * 0.9 * 4 * t * (1 - t);
    return { x: L0.x + (P0.x - L0.x) * w + d.dx * s * t * t, y: L0.y + (P0.y - L0.y) * w + d.dy * s * t * t - arc, w };
  }
  function drawFlying(ctx, a, t) {
    const head = flightPos(a, t);
    const tail = flightPos(a, Math.max(0, t - 0.05));
    const col = SEAT_COLOR[a.seat] || '#fff';
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#202329';
    ctx.lineWidth = 1 + 5 * head.w;
    ctx.beginPath();
    ctx.moveTo(tail.x, tail.y);
    ctx.lineTo(head.x, head.y);
    ctx.stroke();
    ctx.strokeStyle = col;
    ctx.lineWidth = 2 + 9 * head.w;
    ctx.beginPath();
    ctx.moveTo(tail.x, tail.y);
    ctx.lineTo(tail.x + (head.x - tail.x) * 0.25, tail.y + (head.y - tail.y) * 0.25);
    ctx.stroke();
    ctx.restore();
  }

  // --- HUD pieces ---
  function drawWind(ctx, wind) {
    const r = Math.max(20, g.W * 0.05);
    const cx = 12 + r;
    const cy = 12 + r;
    const col = wind.speed < 3 ? '#39ff14' : wind.speed < 6.5 ? '#ffb000' : '#ff4d4d';
    ctx.save();
    ctx.fillStyle = 'rgba(5,10,8,0.72)';
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.translate(cx, cy);
    ctx.rotate((wind.angle * Math.PI) / 180);
    const len = r * (0.35 + 0.5 * Math.min(1, wind.speed / 10));
    ctx.fillStyle = col;
    ctx.shadowColor = col;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(0, -len);
    ctx.lineTo(r * 0.28, -len + r * 0.36);
    ctx.lineTo(r * 0.09, -len + r * 0.3);
    ctx.lineTo(r * 0.09, len * 0.7);
    ctx.lineTo(-r * 0.09, len * 0.7);
    ctx.lineTo(-r * 0.09, -len + r * 0.3);
    ctx.lineTo(-r * 0.28, -len + r * 0.36);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.font = `bold ${Math.round(r * 0.55)}px "Courier New", monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.lineWidth = 3;
    const txt = `${wind.speed.toFixed(1)} MPH`;
    ctx.strokeText(txt, cx, cy + r + r * 0.6);
    ctx.fillText(txt, cx, cy + r + r * 0.6);
    ctx.font = `${Math.round(r * 0.36)}px "Courier New", monospace`;
    ctx.fillStyle = '#cfe';
    ctx.fillText('WIND', cx, cy - r - 2 > 8 ? cy - r - 2 : cy + r + r * 1.1);
    ctx.restore();
  }

  // Flags beside the target, streaming with the wind's horizontal component.
  function drawFlags(ctx, wind, now) {
    const sx = Math.sin((wind.angle * Math.PI) / 180) * wind.speed;
    for (const side of [-1, 1]) {
      const base = toScreen(g.C.x + side * g.R0 * 2.4, g.groundT);
      const top = toScreen(g.C.x + side * g.R0 * 2.4, g.C.y - g.R0 * 1.6);
      ctx.save();
      ctx.strokeStyle = '#ddd';
      ctx.lineWidth = Math.max(1, zoom * 1.2);
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.lineTo(top.x, top.y);
      ctx.stroke();
      const L = g.R0 * zoom * (0.25 + 0.55 * Math.min(1, Math.abs(sx) / 8));
      const droop = g.R0 * zoom * 0.45 * (1 - Math.min(1, Math.abs(sx) / 6));
      const dir = sx >= 0 ? 1 : -1;
      const hgt = g.R0 * zoom * 0.28;
      const wave = (u) => Math.sin(now / (130 - Math.min(80, wind.speed * 8)) + u * 5 + side) * hgt * 0.12 * u;
      ctx.fillStyle = side < 0 ? '#ff5a3c' : '#ffd23c';
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      for (let i = 1; i <= 6; i++) { const u = i / 6; ctx.lineTo(top.x + dir * L * u, top.y + droop * u + wave(u)); }
      for (let i = 6; i >= 0; i--) { const u = i / 6; ctx.lineTo(top.x + dir * L * u, top.y + hgt + droop * u + wave(u)); }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  function drawFace(ctx) {
    const c = faceToScreen(0, 0);
    const s = pxPerCmScreen();
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.scale(s, s);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.arc(1.5, 2, Sim.FACE_R + 1.5, 0, Math.PI * 2);
    ctx.fill();
    for (let kk = 10; kk >= 1; kk--) {
      ctx.beginPath();
      ctx.arc(0, 0, kk * Sim.RING_W, 0, Math.PI * 2);
      ctx.fillStyle = RING_COLORS[10 - kk];
      ctx.fill();
      ctx.lineWidth = 0.22;
      ctx.strokeStyle = kk === 3 || kk === 4 ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.55)';
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 0, Sim.X_R, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 0.15;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-0.8, 0); ctx.lineTo(0.8, 0); ctx.moveTo(0, -0.8); ctx.lineTo(0, 0.8);
    ctx.stroke();
    const light = ctx.createRadialGradient(-25, -30, 5, 0, 0, Sim.FACE_R * 1.1);
    light.addColorStop(0, 'rgba(255,255,255,0.14)');
    light.addColorStop(0.7, 'rgba(0,0,0,0)');
    light.addColorStop(1, 'rgba(0,0,0,0.2)');
    ctx.fillStyle = light;
    ctx.beginPath();
    ctx.arc(0, 0, Sim.FACE_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // The archer's recurve bow, in profile at the lower left, aimed toward the target. Local frame:
  // +x = shooting direction, +y = down the bow, grip at the origin, u = half the bow's length.
  const bowGrip = () => ({ x: g.W * 0.22, y: g.H * 0.67 });
  function drawBow(ctx, now, swayPx) {
    const W = g.W;
    const H = g.H;
    const u = H * 0.3;
    let draw = 0;
    let twang = 0;
    if (aim) draw = Math.min(1, (now - aim.start) / 350);
    else if (release) {
      const since = now - release.at;
      draw = Math.max(0, 1 - since / 70);
      if (since < 420) twang = Math.sin(since / 18) * (1 - since / 420); // string shudders after the snap
    }
    draw = draw * (2 - draw); // ease out
    const G = bowGrip();
    const col = view && view.phase === 'playing' ? SEAT_COLOR[view.turn] : '#888';
    ctx.save();
    ctx.translate(G.x + swayPx.x * 0.3, G.y + swayPx.y * 0.3);
    ctx.rotate(-0.17);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Limbs flex back toward the archer as the string comes back.
    const fx = -0.07 * u * draw;
    const fy = 0.025 * u * draw;
    const limb = (sg) => {
      ctx.moveTo(0, sg * 0.24 * u);
      ctx.bezierCurveTo(-0.03 * u + fx * 0.3, sg * 0.55 * u, -0.17 * u + fx, sg * (0.8 * u - fy), -0.15 * u + fx, sg * (0.93 * u - fy));
      ctx.quadraticCurveTo(-0.13 * u + fx, sg * (1.0 * u - fy), -0.06 * u + fx, sg * (1.0 * u - fy)); // recurve tip
    };
    // string: tip -> recurve contact -> nock -> contact -> tip
    const tipY = 1.0 * u - fy;
    const contact = { x: -0.16 * u + fx, y: 0.9 * u - fy };
    const nock = { x: draw > 0.01 ? -0.16 * u + (-0.66 * u - -0.16 * u) * draw : -0.16 * u + twang * 0.035 * u, y: 0 };
    ctx.strokeStyle = 'rgba(245,245,245,0.9)';
    ctx.lineWidth = Math.max(1, u * 0.008);
    ctx.beginPath();
    ctx.moveTo(-0.06 * u + fx, -tipY);
    ctx.lineTo(contact.x, -contact.y);
    ctx.lineTo(nock.x, nock.y);
    ctx.lineTo(contact.x, contact.y);
    ctx.lineTo(-0.06 * u + fx, tipY);
    ctx.stroke();
    // limbs (dark laminate with a seat-colour face stripe)
    ctx.strokeStyle = '#1b1e24';
    ctx.lineWidth = u * 0.045;
    ctx.beginPath(); limb(-1); limb(1); ctx.stroke();
    ctx.strokeStyle = col;
    ctx.lineWidth = u * 0.014;
    ctx.beginPath(); limb(-1); limb(1); ctx.stroke();
    // riser with the grip bulging back toward the archer
    ctx.fillStyle = '#3a3f48';
    ctx.strokeStyle = '#15171b';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-0.025 * u, -0.27 * u);
    ctx.lineTo(0.035 * u, -0.27 * u);
    ctx.quadraticCurveTo(0.05 * u, 0, 0.035 * u, 0.27 * u);
    ctx.lineTo(-0.025 * u, 0.27 * u);
    ctx.quadraticCurveTo(-0.09 * u, 0.12 * u, -0.05 * u, 0.02 * u); // grip
    ctx.lineTo(-0.02 * u, -0.01 * u); // arrow shelf
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // nocked arrow, resting on the shelf
    const loaded = draw > 0.01 || (canShoot() && (!release || now - release.at > 420));
    if (loaded) {
      const len = 0.74 * u;
      const tail = nock.x;
      ctx.strokeStyle = '#d7d9de';
      ctx.lineWidth = u * 0.018;
      ctx.beginPath(); ctx.moveTo(tail, -0.012 * u); ctx.lineTo(tail + len, -0.012 * u); ctx.stroke();
      ctx.fillStyle = '#9aa0a8'; // point
      ctx.beginPath(); ctx.moveTo(tail + len + 0.05 * u, -0.012 * u); ctx.lineTo(tail + len, -0.03 * u); ctx.lineTo(tail + len, 0.006 * u); ctx.closePath(); ctx.fill();
      ctx.fillStyle = col; // fletching
      for (const sg of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(tail + 0.03 * u, -0.012 * u);
        ctx.lineTo(tail + 0.16 * u, -0.012 * u);
        ctx.lineTo(tail + 0.05 * u, (-0.012 + sg * 0.05) * u);
        ctx.closePath();
        ctx.fill();
      }
    }
    // hands: bow hand wrapped round the grip, draw hand's fingers on the string at the nock
    ctx.fillStyle = '#d9a37e';
    ctx.strokeStyle = '#7a4f35';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.ellipse(-0.04 * u, 0.12 * u, 0.06 * u, 0.1 * u, 0.1, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (draw > 0.01) {
      ctx.beginPath(); ctx.ellipse(nock.x - 0.05 * u, 0.03 * u, 0.065 * u, 0.085 * u, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  // --- frame loop ---
  function frame(now) {
    if (destroyed) return;
    raf = requestAnimationFrame(frame);
    if (!Sim || !g || !bgImg) return;
    const dt = lastFrame ? Math.min(100, now - lastFrame) : 16;
    lastFrame = now;
    if (aim && now - aim.start > Sim.MAX_HOLD_MS) loose(null);
    const list = arrowsOnTarget(now);
    let flying = false;
    for (const { a } of list) {
      const s = seen.get(a.n);
      if (!s) seen.set(a.n, { start: now, landed: reduced(), landedAt: now });
      else if (!s.landed && now - s.start >= FLIGHT_MS) onLanded(a, now);
      if (!seen.get(a.n).landed) flying = true;
    }
    const zt = aim || flying || now < zoomHoldUntil ? ZMAX : 1;
    zoom += (zt - zoom) * (reduced() ? 1 : 1 - Math.exp(-dt / 140));
    if (Math.abs(zt - zoom) < 0.002) zoom = zt;
    shakeOff = now < shake.until ? { x: (Math.random() - 0.5) * shake.amp * zoom, y: (Math.random() - 0.5) * shake.amp * zoom } : { x: 0, y: 0 };

    const ctx = canvas.getContext('2d');
    const dpr = canvas.width / g.W;
    const F = focus();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, g.W, g.H);
    ctx.save();
    ctx.translate(F.x - g.C.x * zoom + shakeOff.x, F.y - g.C.y * zoom + shakeOff.y);
    ctx.scale(zoom, zoom);
    ctx.drawImage(bgImg, 0, 0, g.W, g.H);
    ctx.restore();

    // Wind shown: the flying arrow's wind, else the next arrow's (eased so the needle swings).
    const flyingArrow = list.find(({ a }) => !seen.get(a.n).landed);
    const wTarget = flyingArrow ? flyingArrow.a.wind : view && view.wind;
    if (wTarget) {
      if (!windShown) windShown = { ...wTarget };
      const da = ((wTarget.angle - windShown.angle + 540) % 360) - 180;
      const e = 1 - Math.exp(-dt / 160);
      windShown.angle = (windShown.angle + da * e + 360) % 360;
      windShown.speed += (wTarget.speed - windShown.speed) * e;
      drawFlags(ctx, windShown, now);
    }
    drawFace(ctx);

    // Arrows on the target, then the one in flight.
    for (const { a, alpha } of list) {
      const s = seen.get(a.n);
      if (s.landed && inBoss(a)) drawStuck(ctx, faceToScreen(a.x, a.y), a, alpha);
    }
    for (const { a } of list) {
      const s = seen.get(a.n);
      if (!s.landed) drawFlying(ctx, a, Math.min(1, (now - s.start) / FLIGHT_MS));
    }

    // Straw bits and X bursts.
    for (let i = bits.length - 1; i >= 0; i--) {
      const b = bits[i];
      const t = (now - b.start) / 1000;
      if (t > 0.6) { bits.splice(i, 1); continue; }
      const p = faceToScreen(b.x + b.vx * t, b.y + b.vy * t + 60 * t * t);
      ctx.fillStyle = `rgba(226,194,124,${1 - t / 0.6})`;
      ctx.fillRect(p.x, p.y, 2 * zoom, 1 * zoom);
    }
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i];
      const t = (now - b.start) / 700;
      if (t >= 1) { bursts.splice(i, 1); continue; }
      const p = faceToScreen(b.x, b.y);
      ctx.save();
      ctx.strokeStyle = `rgba(248,210,28,${1 - t})`;
      ctx.lineWidth = 3 * (1 - t) + 1;
      ctx.shadowColor = '#f8d21c';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4 + t * pxPerCmScreen() * 20, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Popups.
    for (let i = popups.length - 1; i >= 0; i--) {
      const p = popups[i];
      const age = (now - p.start) / 1300;
      if (age >= 1) { popups.splice(i, 1); continue; }
      const sp = faceToScreen(Math.max(-70, Math.min(70, p.x)), Math.max(-70, Math.min(70, p.y)));
      ctx.save();
      ctx.globalAlpha = 1 - age * age;
      const size = Math.round(Math.max(16, g.W * 0.045) * (age < 0.1 ? 0.6 + age * 4 : 1));
      ctx.font = `bold ${size}px "Courier New", monospace`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      const y = sp.y - 18 - age * 34;
      ctx.strokeText(p.text, sp.x, y);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, sp.x, y);
      ctx.restore();
    }

    // Scope vignette.
    if (zoom > 1.01) {
      const vg = ctx.createRadialGradient(g.W / 2, g.H / 2, g.H * 0.35, g.W / 2, g.H / 2, g.W * 0.7);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, `rgba(0,0,0,${0.55 * zf()})`);
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, g.W, g.H);
    }

    // Sight pin.
    let swayPx = { x: 0, y: 0 };
    if (aim) {
      const held = now - aim.start;
      const w = Sim.sway(view.shotSeed, held);
      const c = faceToScreen(aim.x + w.dx, aim.y + w.dy);
      swayPx = { x: w.dx * pxPerCmScreen(), y: w.dy * pxPerCmScreen() };
      const ampPx = w.amp * pxPerCmScreen();
      const col = w.amp < 7 ? '#39ff14' : w.amp < 14 ? '#ffb000' : '#ff4d4d';
      ctx.save();
      ctx.strokeStyle = col;
      ctx.fillStyle = col;
      ctx.shadowColor = col;
      ctx.shadowBlur = 8;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      ctx.arc(c.x, c.y, Math.max(5, ampPx), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 10, 0, Math.PI * 2);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        ctx.moveTo(c.x + dx * 13, c.y + dy * 13);
        ctx.lineTo(c.x + dx * 22, c.y + dy * 22);
      }
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(c.x, c.y, 2.4, 0, Math.PI * 2);
      ctx.fill();
      const on = Sim.scoreAt(aim.x + w.dx, aim.y + w.dy);
      ctx.font = 'bold 13px "Courier New", monospace';
      ctx.textAlign = 'left';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur = 0;
      const lbl = on.label === 'M' ? 'MISS' : on.label;
      ctx.strokeText(lbl, c.x + 24, c.y - 12);
      ctx.fillText(lbl, c.x + 24, c.y - 12);
      ctx.restore();
      const calm = Math.max(0, Math.min(1, (30 - w.amp) / 25));
      steadyFill.style.width = `${Math.round(calm * 100)}%`;
      steadyFill.style.background = col;
    } else {
      steadyFill.style.width = '0%';
    }

    drawBow(ctx, now, swayPx);
    if (windShown) drawWind(ctx, windShown);
    ctx.save();
    ctx.font = `bold ${Math.max(11, Math.round(g.W * 0.024))}px "Courier New", monospace`;
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText(`${Sim.DIST_M} M`, g.W - 12, 22);
    if (view && view.phase === 'playing') {
      ctx.fillStyle = SEAT_COLOR[view.turn];
      ctx.fillText(view.shootoff ? 'SHOOT-OFF' : `END ${view.end}/${view.ends}`, g.W - 12, 40);
    }
    ctx.restore();
    canvas.classList.toggle('can-aim', !!canShoot());
  }

  function showCallout() {
    const c = view && view.callout;
    const key = c ? `${c.seq}:${c.kind}:${c.seat}` : null;
    if (!calloutChanged(key) || !c) return;
    const el = document.createElement('div');
    el.className = 'ar-callout';
    el.style.setProperty('--c', c.kind === 'shootoff' ? '#ff4d4d' : c.kind === 'perfect' ? '#f8d21c' : c.seat ? SEAT_COLOR[c.seat] : '#39ff14');
    el.textContent = c.text;
    setTimeout(() => {
      if (destroyed) return;
      stage.appendChild(el);
      setTimeout(() => el.remove(), 2300);
      if (c.kind === 'shootoff') sfx.play('check');
      else if (c.kind === 'perfect') sfx.play('chime');
      else if (c.kind === 'end') sfx.play('point');
    }, reduced() ? 0 : 200);
  }

  // --- DOM ---
  function seatBox(seat) {
    const box = document.createElement('div');
    box.className = `ar-seat${view.phase === 'playing' && view.turn === seat ? ' turn' : ''}`;
    const chip = document.createElement('span');
    chip.className = 'ar-chip';
    chip.style.background = SEAT_COLOR[seat];
    chip.style.color = SEAT_COLOR[seat];
    const name = document.createElement('span');
    const occ = view.players[seat];
    name.textContent = `${seat.toUpperCase()}: ${occ ? (occ === 'BOT' ? '(bot)' : nicknameFor(occ)) : '(empty)'}${occ === api.getClientId() ? ' (you)' : ''}`;
    box.append(chip, name);
    const mine = mySeat();
    if (!occ && view.solo && view.phase !== 'waiting') {
      name.textContent = `${seat.toUpperCase()}: (solo run)`;
    } else if (!occ) {
      if (mine && view.phase !== 'playing') {
        const solo = document.createElement('button');
        solo.textContent = 'SHOOT SOLO';
        solo.title = 'Five ends on your own: chase your high score';
        solo.addEventListener('click', () => api.sendAction({ kind: 'startSolo' }));
        box.appendChild(solo);
      }
      if (!mine) {
        const btn = document.createElement('button');
        btn.textContent = `PLAY ${seat.toUpperCase()}`;
        btn.addEventListener('click', () => api.sendAction({ kind: 'sit', seat }));
        box.appendChild(btn);
      }
      const botBtn = document.createElement('button');
      botBtn.textContent = 'PLAY VS BOT';
      botBtn.addEventListener('click', () => api.sendAction({ kind: 'sit', seat, bot: true, level: preferredLevel() }));
      box.append(botBtn, levelSelect(preferredLevel()));
    } else if (occ === 'BOT') {
      box.appendChild(levelSelect((view.botLevels || {})[seat], (level) => api.sendAction({ kind: 'setBotLevel', seat, level })));
      const rm = document.createElement('button');
      rm.textContent = 'REMOVE BOT';
      rm.addEventListener('click', () => api.sendAction({ kind: 'removeBot', seat }));
      box.appendChild(rm);
    }
    return box;
  }

  // The seat's arrows in the current (or just-finished) end.
  function setFor(seat) {
    const cur = view.endArrows.filter((a) => a.seat === seat);
    if (cur.length || view.endArrows.length) return cur;
    return view.lastEndArrows.filter((a) => a.seat === seat);
  }

  function seatCard(seat) {
    const c = document.createElement('div');
    c.className = `ar-card${view.phase === 'playing' && view.turn === seat ? ' turn' : ''}`;
    c.style.setProperty('--c', SEAT_COLOR[seat]);
    const nm = document.createElement('div');
    nm.className = 'nm';
    const chip = document.createElement('span');
    chip.className = 'ar-chip';
    chip.style.background = SEAT_COLOR[seat];
    chip.style.color = SEAT_COLOR[seat];
    nm.append(chip, document.createTextNode(seatName(seat) + (view.players[seat] === api.getClientId() ? ' (you)' : '')));
    const big = document.createElement('div');
    big.className = 'big';
    big.textContent = view.totals[seat];
    if (prevTotals && prevTotals[seat] !== view.totals[seat] && !reduced()) big.classList.add('bump');
    const sub = document.createElement('div');
    sub.className = 'sub';
    const arrows = view.card[seat].reduce((n, e) => n + e.length, 0);
    for (const t of [`X ${view.xs[seat]}`, `10s ${view.tens[seat]}`, `AVG ${arrows ? (view.totals[seat] / arrows).toFixed(1) : '—'}`]) {
      const s = document.createElement('span');
      s.textContent = t;
      sub.appendChild(s);
    }
    const row = document.createElement('div');
    row.className = 'ar-slots';
    const set = setFor(seat);
    const n = view.shootoff || (set[0] && set[0].so) ? 1 : 3;
    for (let i = 0; i < n; i++) {
      const a = set[i];
      const sl = document.createElement('div');
      sl.className = 'ar-slot';
      if (a) {
        sl.classList.add('hit');
        if (a.label === 'X') sl.classList.add('x');
        if (a.label === 'M') sl.classList.add('m');
        sl.textContent = a.so ? `${a.dist.toFixed(1)}cm` : a.label;
      }
      row.appendChild(sl);
    }
    c.append(nm, big, sub, row);
    return c;
  }

  function scorecard() {
    const t = document.createElement('table');
    t.className = 'ar-card-tbl';
    const hr = document.createElement('tr');
    hr.appendChild(document.createElement('th'));
    for (let e = 1; e <= view.ends; e++) {
      const th = document.createElement('th');
      th.textContent = e;
      hr.appendChild(th);
    }
    for (const h of ['TOT', 'X']) {
      const th = document.createElement('th');
      th.textContent = h;
      hr.appendChild(th);
    }
    t.appendChild(hr);
    for (const seat of activeSeats()) {
      const tr = document.createElement('tr');
      const nm = document.createElement('td');
      nm.textContent = seat.toUpperCase();
      nm.style.color = SEAT_COLOR[seat];
      tr.appendChild(nm);
      view.card[seat].forEach((arr, i) => {
        const td = document.createElement('td');
        if (view.phase === 'playing' && !view.shootoff && i === view.end - 1) td.classList.add('cur');
        if (arr.length) {
          td.textContent = arr.reduce((n, l) => n + ptsOf(l), 0);
          td.title = arr.join(' · ');
          if (arr.length < view.arrowsPerEnd) td.classList.add('part');
        }
        tr.appendChild(td);
      });
      const tot = document.createElement('td');
      tot.className = 'tot';
      tot.style.color = SEAT_COLOR[seat];
      tot.textContent = view.totals[seat];
      const xs = document.createElement('td');
      xs.textContent = view.xs[seat];
      tr.append(tot, xs);
      t.appendChild(tr);
    }
    return t;
  }

  // A solo run only shows the one archer.
  const activeSeats = () => ['p1', 'p2'].filter((s) => !view.solo || view.players[s]);

  function resultsOpts() {
    if (!view || view.phase !== 'game_over') return null;
    const me = mySeat();
    const w = view.winner;
    if (view.solo) {
      return {
        title: `${view.totals[w]} POINTS`,
        subtitle: `SOLO · ${view.xs[w]}X · ${view.tens[w]} tens · ${view.ends * view.arrowsPerEnd} arrows`,
        outcome: 'win',
        rows: [{ name: seatName(w), value: `${view.totals[w]} · ${view.xs[w]}X`, win: true, you: w === me }],
        rematch: me ? { label: 'SHOOT AGAIN', onClick: () => api.sendAction({ kind: 'resetGame' }) } : null,
      };
    }
    const draw = !w || w === 'draw';
    const order = draw ? ['p1', 'p2'] : [w, w === 'p1' ? 'p2' : 'p1'];
    let subtitle = `${view.ends} ends · ${view.ends * view.arrowsPerEnd} arrows each`;
    const so = view.shootoffLog[view.shootoffLog.length - 1];
    if (view.endReason === 'shootoff' && so) {
      subtitle = draw ? 'Shoot-offs could not separate them' : `Shoot-off: ${so[w].toFixed(1)} cm vs ${so[w === 'p1' ? 'p2' : 'p1'].toFixed(1)} cm from the centre`;
    }
    return {
      title: draw ? "IT'S A DRAW" : me === w ? 'YOU WIN' : me ? 'YOU LOSE' : `${seatName(w)} WINS`,
      subtitle,
      outcome: draw ? 'draw' : me == null ? 'over' : me === w ? 'win' : 'lose',
      rows: order.map((seat) => ({ name: seatName(seat), value: `${view.totals[seat]} · ${view.xs[seat]}X`, win: !draw && seat === w, you: seat === me })),
      rematch: me ? { label: 'REMATCH', onClick: () => api.sendAction({ kind: 'resetGame' }) } : null,
    };
  }

  function render() {
    clearTimeout(renderTimer);
    renderTimer = null;
    results.update(resultsOpts());
    if (!view || !Sim) {
      status.textContent = 'Loading...';
      return;
    }
    const seat = mySeat();
    status.className = 'ar-status';
    status.style.color = '';
    if (view.phase === 'waiting') {
      status.textContent = seat ? 'SHOOT SOLO for a high score, or wait for an opponent / play a bot.' : 'Waiting for both archers.';
    } else if (view.phase === 'playing') {
      const mine = seat && seat === view.turn;
      const where = view.shootoff ? 'SHOOT-OFF · CLOSEST TO THE X WINS' : `END ${view.end}/${view.ends} · ARROW ${(view.shotsInEnd % view.arrowsPerEnd) + 1} OF ${view.arrowsPerEnd}`;
      status.textContent = mine ? `▶ YOUR SHOT. ${where}` : `${seatName(view.turn)} TO SHOOT. ${where}`;
      if (mine) status.classList.add('mine');
      status.style.color = SEAT_COLOR[view.turn];
    } else if (view.solo) {
      status.textContent = `FINAL SCORE: ${view.totals[view.winner]}`;
      status.style.color = '#ffb000';
    } else {
      status.textContent = view.winner === 'draw' ? "IT'S A DRAW" : `${seatName(view.winner)} WINS`;
      status.style.color = '#ffb000';
    }
    err.textContent = flashError ? REJECT_MESSAGES[flashError] || 'Shot rejected' : '';

    seats.innerHTML = '';
    seats.append(seatBox('p1'), seatBox('p2'));
    if (seat) {
      const leave = document.createElement('button');
      leave.textContent = 'LEAVE SEAT';
      leave.addEventListener('click', () => api.sendAction({ kind: 'leaveSeat' }));
      seats.appendChild(leave);
    }

    panel.innerHTML = '';
    const meta = document.createElement('div');
    meta.className = 'ar-meta';
    const ml = document.createElement('span');
    ml.textContent = `${Sim.DIST_M} M · 122 CM FACE`;
    const mr = document.createElement('span');
    mr.textContent = view.shootoff ? `SHOOT-OFF ${view.shootoff}` : `END ${view.end}/${view.ends}`;
    meta.append(ml, mr);
    panel.append(meta, ...activeSeats().map(seatCard), scorecard());
    for (const so of view.shootoffLog) {
      const d = document.createElement('div');
      d.className = 'ar-so';
      d.textContent = `SHOOT-OFF ${so.round}: P1 ${so.p1.toFixed(1)} cm · P2 ${so.p2.toFixed(1)} cm`;
      panel.appendChild(d);
    }
    prevTotals = { ...view.totals };

    if (view.phase === 'playing' && seat === view.turn) {
      if (!hint.textContent || hint.dataset.auto) {
        hint.textContent = 'Hold to draw · drag to aim · release when steady (green). Each mph of wind ≈ half a ring.';
        hint.dataset.auto = '1';
      }
    } else {
      hint.textContent = view.phase === 'playing' ? '' : view.phase === 'waiting' ? 'Fill both seats (or SHOOT SOLO) to start: 5 ends of 3 arrows.' : '';
      hint.dataset.auto = '1';
    }

    btnRow.innerHTML = '';
    if (view.phase === 'game_over' && seat) {
      const again = document.createElement('button');
      again.textContent = view.solo ? 'SHOOT AGAIN' : 'REMATCH (SWAP OPENER)';
      again.addEventListener('click', () => api.sendAction({ kind: 'resetGame' }));
      btnRow.appendChild(again);
    }
    showCallout();
  }

  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null;
  if (ro) ro.observe(container);
  window.addEventListener('resize', resize);

  loadSim().then((S) => {
    if (destroyed) return;
    Sim = S;
    resize();
    render();
  }).catch(() => { status.textContent = 'Failed to load archery.'; });
  raf = requestAnimationFrame(frame);
  render();

  function markAllSeen(v) {
    for (const a of [...(v.endArrows || []), ...(v.lastEndArrows || [])]) seen.set(a.n, { start: 0, landed: true, landedAt: -1e9 });
  }

  return {
    applySnapshot(snapshot) {
      view = snapshot;
      seen.clear();
      markAllSeen(view);
      calloutChanged(view.callout ? `${view.callout.seq}:${view.callout.kind}:${view.callout.seat}` : null);
      prevTotals = null;
      render();
    },
    applyEvent(data) {
      if (!data) return;
      if (data.kind === 'state') {
        const prev = view;
        view = data;
        if (pendingShot != null && (data.shotNo !== pendingShot || data.phase !== 'playing')) pendingShot = null;
        if (prev && (data.gameId !== prev.gameId || data.shotNo < prev.shotNo)) {
          // new game: arrow numbers restart
          seen.clear();
          markAllSeen(data);
          aim = null;
          if (data.phase === 'playing') sfx.play('go');
        }
        if (aim && (data.phase !== 'playing' || data.turn !== mySeat())) aim = null;
        flashError = null;
        const newArrow = prev && data.gameId === prev.gameId && data.shotNo > prev.shotNo && !reduced();
        if (prev && data.winner && !prev.winner) {
          const me = mySeat();
          setTimeout(() => sfx.play(data.winner === 'draw' || !me ? 'chime' : data.winner === me ? 'win' : 'lose'), newArrow ? FLIGHT_MS + 300 : 0);
        }
        if (prev && prev.phase === 'playing' && data.phase === 'playing' && data.turn === mySeat() && prev.turn !== data.turn) {
          setTimeout(() => sfx.play('turn'), newArrow ? FLIGHT_MS + 400 : 0);
        }
        // Hold the scoreboard until the arrow lands.
        if (newArrow) {
          clearTimeout(renderTimer);
          renderTimer = setTimeout(render, FLIGHT_MS);
        } else {
          render();
        }
      } else if (data.kind === 'moveRejected') {
        pendingShot = null;
        flashError = data.reason || 'invalid';
        sfx.play('error');
        clearTimeout(flashTimer);
        flashTimer = setTimeout(() => { flashError = null; render(); }, 2000);
        render();
      }
    },
    applyRoster(newRoster) {
      roster = newRoster;
      render();
    },
    unmount() {
      destroyed = true;
      cancelAnimationFrame(raf);
      clearTimeout(flashTimer);
      clearTimeout(renderTimer);
      if (ro) ro.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', onKey);
      results.destroy();
      container.innerHTML = '';
    },
  };
}
