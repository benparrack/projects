// Darts client. Press and hold on the board to raise the dart: a reticle appears where you point
// and wobbles (wide at first, steadiest after ~1-2s, then the arm tires). Drag to adjust, release
// to throw. The wobble comes from the shared sim (sim.js) with the per-dart seed the server sent,
// so where the reticle is when you let go is where the server lands the dart (plus a hair of
// release jitter). Darts fly in, stick, and pop their score; the side panel keeps the 01 or
// cricket scoreboard, checkout hints and the turn's three darts.
import { sfx } from '../sfx.js';
import { preferredLevel, levelSelect } from '../botLevel.js';
import { createResults } from '../resultsPanel.js';
import { changeTracker } from '../boardFx.js';

const SEAT_COLOR = { p1: '#3ad7ff', p2: '#ffb000' };
const MODE_LABEL = { 501: '501 · DOUBLE OUT', 301: '301 · STRAIGHT OUT', cricket: 'CRICKET' };
const REJECT_MESSAGES = {
  not_your_turn: "It's not your turn",
  not_playing: 'The game is not in progress',
  invalid: 'Invalid throw',
  stale: 'Too quick — wait for the last dart',
};
const VIEW_MM = 236; // half-width of the canvas in board millimetres
const FLIGHT_MS = 260;
const TOUCH_LIFT = 70; // px the reticle sits above a finger so it isn't hidden under it
const MIN_HOLD_MS = 150;

const CSS = `
.dt-root { display: flex; flex-direction: column; align-items: center; gap: 8px; width: 100%; }
.dt-status { font-size: 18px; font-weight: bold; padding: 6px 14px; border-radius: 6px; border: 2px solid transparent; text-align: center; }
.dt-status.mine { background: rgba(57,255,20,.15); border-color: #39ff14; }
.dt-err { color: #ff4d4d; min-height: 1.2em; font-size: 14px; }
.dt-seats { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; align-items: center; }
.dt-seat { display: flex; gap: 6px; align-items: center; padding: 4px 8px; border: 1px solid #1f8f0c; border-radius: 6px; }
.dt-seat.turn { border-color: #39ff14; box-shadow: 0 0 10px -2px #39ff14; }
.dt-chip { width: 12px; height: 12px; border-radius: 50%; display: inline-block; flex: none; box-shadow: 0 0 6px currentColor; }
.dt-modes { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; justify-content: center; }
.dt-modes button.on { background: #39ff14; color: #000; }
.dt-main { display: flex; gap: 14px; align-items: flex-start; justify-content: center; flex-wrap: wrap; width: 100%; }
.dt-boardwrap { position: relative; touch-action: none; user-select: none; -webkit-user-select: none; flex: 0 1 auto; }
.dt-canvas { display: block; border-radius: 12px; cursor: default; }
.dt-canvas.can-aim { cursor: crosshair; }
.dt-steady { height: 6px; border-radius: 3px; background: #0b1a0b; border: 1px solid #1f8f0c; overflow: hidden; margin-top: 6px; position: relative; }
.dt-steady i { position: absolute; left: 0; top: 0; bottom: 0; background: #39ff14; transition: none; }
.dt-hint { font-size: 12px; color: #6fae5f; text-align: center; margin-top: 4px; min-height: 1.3em; }
.dt-panel { display: flex; flex-direction: column; gap: 8px; min-width: 220px; flex: 0 1 260px; }
.dt-meta { display: flex; justify-content: space-between; font-size: 12px; color: #6fae5f; letter-spacing: 1px; }
.dt-card { border: 1px solid #1f8f0c; border-radius: 8px; padding: 8px 10px; background: rgba(8,20,8,.6); transition: box-shadow .2s, border-color .2s; }
.dt-card.turn { box-shadow: 0 0 14px -3px var(--c); border-color: var(--c); }
.dt-card .nm { display: flex; align-items: center; gap: 6px; font-size: 14px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.dt-card .big { font-size: 44px; font-weight: bold; line-height: 1.05; color: var(--c); text-shadow: 0 0 12px var(--c); font-variant-numeric: tabular-nums; }
.dt-card .big.bump { animation: dt-bump .4s ease-out; }
@keyframes dt-bump { 40% { transform: scale(1.12); } }
.dt-card .sub { font-size: 12px; color: #8fcf7f; display: flex; justify-content: space-between; gap: 8px; }
.dt-slots { display: flex; gap: 5px; margin-top: 6px; }
.dt-slot { flex: 1; text-align: center; border: 1px dashed #1f8f0c; border-radius: 4px; padding: 3px 0; font-size: 13px; min-height: 1.3em; color: #cfe; }
.dt-slot.hit { border-style: solid; border-color: var(--c); }
.dt-slot.bust { border-color: #ff4d4d; color: #ff4d4d; text-decoration: line-through; }
.dt-checkout { margin-top: 6px; font-size: 12px; color: #ffb000; letter-spacing: 1px; }
.dt-cricket { width: 100%; border-collapse: collapse; font-size: 15px; }
.dt-cricket td { text-align: center; padding: 3px 4px; border-bottom: 1px solid #143d0b; }
.dt-cricket td.num { color: #e8e8e8; font-weight: bold; width: 34%; }
.dt-cricket tr.dead td { opacity: .35; }
.dt-cricket td.mk { font-size: 20px; line-height: 1; }
.dt-cricket .pts td { font-size: 22px; font-weight: bold; border-bottom: 2px solid #1f8f0c; }
.dt-callout {
  position: absolute; left: 50%; top: 42%; transform: translate(-50%, -50%); z-index: 5; pointer-events: none;
  background: rgba(5,8,10,.9); border: 2px solid var(--c); color: var(--c); border-radius: 8px;
  padding: 10px 18px; font-weight: bold; font-size: 22px; letter-spacing: 2px; white-space: nowrap;
  box-shadow: 0 0 26px -4px var(--c); animation: dt-callout 2s ease-in-out forwards;
}
.dt-callout.big { font-size: 28px; }
@keyframes dt-callout { 0% { opacity: 0; transform: translate(-50%, -50%) scale(.5); } 12% { opacity: 1; transform: translate(-50%, -50%) scale(1.08); } 20% { transform: translate(-50%, -50%) scale(1); } 80% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -70%); } }
.dt-btn-row { display: flex; gap: 8px; }
@media (prefers-reduced-motion: reduce) { .dt-callout, .dt-card .big.bump { animation: none; } }
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
  if (window.DartsSim) return Promise.resolve(window.DartsSim);
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = 'games/darts/sim.js';
    el.onload = () => resolve(window.DartsSim);
    el.onerror = () => reject(new Error('Failed to load darts sim'));
    document.head.appendChild(el);
  });
}

const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const rad = (deg) => (deg * Math.PI) / 180;

// --- board painting ---------------------------------------------------------------------------

// Path of one scoring area (in board mm, caller has set the mm transform).
function segmentPath(ctx, Sim, ring, num) {
  const { R } = Sim;
  ctx.beginPath();
  if (ring === 'DB') { ctx.arc(0, 0, R.innerBull, 0, Math.PI * 2); return; }
  if (ring === 'SB') { ctx.arc(0, 0, R.outerBull, 0, Math.PI * 2); ctx.arc(0, 0, R.innerBull, 0, Math.PI * 2, true); return; }
  const i = Sim.ORDER.indexOf(num);
  const a0 = rad(-90 + i * 18 - 9);
  const a1 = rad(-90 + i * 18 + 9);
  const [r0, r1] = ring === 'T' ? [R.trebleIn, R.trebleOut] : ring === 'D' ? [R.doubleIn, R.doubleOut] : [R.trebleOut, R.doubleIn];
  ctx.arc(0, 0, r1, a0, a1);
  ctx.arc(0, 0, r0, a1, a0, true);
  ctx.closePath();
}

function paintBoard(Sim, sizePx, dpr) {
  const { R, ORDER } = Sim;
  const cv = document.createElement('canvas');
  cv.width = Math.round(sizePx * dpr);
  cv.height = Math.round(sizePx * dpr);
  const ctx = cv.getContext('2d');
  const k = (sizePx * dpr) / 2 / VIEW_MM;
  ctx.translate(cv.width / 2, cv.height / 2);
  ctx.scale(k, k);

  // Cabinet glow + surround.
  const glow = ctx.createRadialGradient(0, 0, R.frame * 0.8, 0, 0, VIEW_MM);
  glow.addColorStop(0, 'rgba(57,255,20,0.10)');
  glow.addColorStop(1, 'rgba(57,255,20,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(-VIEW_MM, -VIEW_MM, VIEW_MM * 2, VIEW_MM * 2);
  const sur = ctx.createRadialGradient(-40, -60, 40, 0, 0, R.frame);
  sur.addColorStop(0, '#2a2a2a');
  sur.addColorStop(1, '#0c0c0c');
  ctx.beginPath();
  ctx.arc(0, 0, R.frame, 0, Math.PI * 2);
  ctx.fillStyle = sur;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#3a3a3a';
  ctx.stroke();

  // Segments.
  const SINGLE = ['#1d1b19', '#eadcb6'];
  const RING = ['#d3242b', '#14843c'];
  for (let i = 0; i < 20; i++) {
    const num = ORDER[i];
    const par = i % 2;
    for (const [ring, col] of [['D', RING[par]], ['S', SINGLE[par]], ['T', RING[par]]]) {
      segmentPath(ctx, Sim, ring, num);
      ctx.fillStyle = col;
      ctx.fill();
    }
    // inner single
    const a0 = rad(-90 + i * 18 - 9);
    const a1 = rad(-90 + i * 18 + 9);
    ctx.beginPath();
    ctx.arc(0, 0, R.trebleIn, a0, a1);
    ctx.arc(0, 0, R.outerBull, a1, a0, true);
    ctx.closePath();
    ctx.fillStyle = SINGLE[par];
    ctx.fill();
  }
  segmentPath(ctx, Sim, 'SB');
  ctx.fillStyle = '#14843c';
  ctx.fill();
  segmentPath(ctx, Sim, 'DB');
  ctx.fillStyle = '#d3242b';
  ctx.fill();

  // Sisal fibre speckle + soft lighting, clipped to the playing area.
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, R.doubleOut, 0, Math.PI * 2);
  ctx.clip();
  const rand = Sim.mulberry32(7);
  for (let n = 0; n < 9000; n++) {
    const r = Math.sqrt(rand()) * R.doubleOut;
    const a = rand() * Math.PI * 2;
    ctx.fillStyle = rand() < 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.13)';
    ctx.fillRect(r * Math.cos(a), r * Math.sin(a), 0.9 + rand() * 1.2, 0.6);
  }
  const light = ctx.createRadialGradient(-60, -80, 10, 0, 0, R.doubleOut * 1.1);
  light.addColorStop(0, 'rgba(255,255,255,0.10)');
  light.addColorStop(0.6, 'rgba(0,0,0,0)');
  light.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = light;
  ctx.fillRect(-R.doubleOut, -R.doubleOut, R.doubleOut * 2, R.doubleOut * 2);
  ctx.restore();

  // Spider wires.
  ctx.strokeStyle = 'rgba(214,218,226,0.85)';
  ctx.lineWidth = 0.9;
  for (const r of [R.innerBull, R.outerBull, R.trebleIn, R.trebleOut, R.doubleIn, R.doubleOut]) {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let i = 0; i < 20; i++) {
    const a = rad(-90 + i * 18 - 9);
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * R.outerBull, Math.sin(a) * R.outerBull);
    ctx.lineTo(Math.cos(a) * R.doubleOut, Math.sin(a) * R.doubleOut);
    ctx.stroke();
  }

  // Number ring.
  ctx.fillStyle = '#f4f4f4';
  ctx.font = 'bold 24px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 3;
  for (let i = 0; i < 20; i++) {
    const a = rad(-90 + i * 18);
    ctx.fillText(String(ORDER[i]), Math.cos(a) * 196, Math.sin(a) * 196 + 1);
  }
  ctx.shadowBlur = 0;
  // Number-ring wire.
  ctx.strokeStyle = 'rgba(214,218,226,0.35)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(0, 0, 214, 0, Math.PI * 2);
  ctx.stroke();
  return cv;
}

// A dart stuck in the board at (px, py), drawn leaning toward the viewer. s = scale, t in [0,1]
// is the flight progress (1 = stuck).
function drawDart(ctx, px, py, color, s, t = 1) {
  const fly = 1 - t;
  const lift = fly * 120 * s;
  const tipX = px;
  const tipY = py;
  const grow = 1 + fly * 1.4;
  const dx = 11 * s * grow;
  const dy = 28 * s * grow;
  ctx.save();
  ctx.globalAlpha = 0.35 * t;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(tipX + dx * 0.9 + 4 * s, tipY + dy * 0.45 + 6 * s, 3.5 * s * grow, 8 * s * grow, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.translate(0, lift);
  // tip + barrel
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#c9ccd2';
  ctx.lineWidth = 1.6 * s * grow;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX + dx * 0.25, tipY + dy * 0.25);
  ctx.stroke();
  ctx.strokeStyle = '#7f858f';
  ctx.lineWidth = 4 * s * grow;
  ctx.beginPath();
  ctx.moveTo(tipX + dx * 0.25, tipY + dy * 0.25);
  ctx.lineTo(tipX + dx * 0.62, tipY + dy * 0.62);
  ctx.stroke();
  ctx.strokeStyle = '#2b2f36';
  ctx.lineWidth = 2 * s * grow;
  ctx.beginPath();
  ctx.moveTo(tipX + dx * 0.62, tipY + dy * 0.62);
  ctx.lineTo(tipX + dx, tipY + dy);
  ctx.stroke();
  // flights
  const fx = tipX + dx;
  const fy = tipY + dy;
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 6 * s;
  ctx.beginPath();
  ctx.moveTo(tipX + dx * 0.72, tipY + dy * 0.72);
  ctx.lineTo(fx - 7 * s * grow, fy + 3 * s * grow);
  ctx.lineTo(fx + 1 * s * grow, fy + 4 * s * grow);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(tipX + dx * 0.72, tipY + dy * 0.72);
  ctx.lineTo(fx + 7 * s * grow, fy - 1 * s * grow);
  ctx.lineTo(fx + 1 * s * grow, fy + 4 * s * grow);
  ctx.closePath();
  ctx.globalAlpha = 0.8;
  ctx.fill();
  ctx.restore();
}

function markGlyph(n) {
  if (n <= 0) return '';
  if (n === 1) return '/';
  if (n === 2) return '✕';
  return 'Ⓧ';
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
  let pendingThrow = null; // throwNo we're waiting to see advance
  let aim = null; // { pointerId, start, px, py, touch } in canvas CSS px
  let sizePx = 0;
  let boardImg = null;
  const seenDarts = new Map(); // n -> { start } flight start time
  const popups = []; // { x, y, text, color, start }
  const calloutChanged = changeTracker();
  let prevBig = null;

  const root = document.createElement('div');
  root.className = 'dt-root';
  container.appendChild(root);
  const results = createResults(container);

  // Persistent pieces (the canvas must survive DOM re-renders).
  const status = document.createElement('div');
  status.className = 'dt-status';
  const err = document.createElement('div');
  err.className = 'dt-err';
  const seats = document.createElement('div');
  seats.className = 'dt-seats';
  const modes = document.createElement('div');
  modes.className = 'dt-modes';
  const main = document.createElement('div');
  main.className = 'dt-main';
  const wrap = document.createElement('div');
  wrap.className = 'dt-boardwrap';
  const canvas = document.createElement('canvas');
  canvas.className = 'dt-canvas';
  const steady = document.createElement('div');
  steady.className = 'dt-steady';
  const steadyFill = document.createElement('i');
  steady.appendChild(steadyFill);
  const hint = document.createElement('div');
  hint.className = 'dt-hint';
  wrap.append(canvas, steady, hint);
  const panel = document.createElement('div');
  panel.className = 'dt-panel';
  main.append(wrap, panel);
  const btnRow = document.createElement('div');
  btnRow.className = 'dt-btn-row';
  root.append(status, err, seats, modes, main, btnRow);

  function nicknameFor(clientId) {
    if (!clientId) return null;
    if (clientId === 'BOT') return '(bot)';
    const entry = roster.find((r) => r.clientId === clientId);
    return entry ? entry.nickname : 'someone';
  }
  const seatName = (seat) => {
    const id = view.players[seat];
    if (id === 'BOT') return `🤖 Bot (${((view.botLevels || {})[seat] || 'hard').replace(/^./, (c) => c.toUpperCase())})`;
    return nicknameFor(id) || '(empty)';
  };

  function mySeat() {
    const me = api.getClientId();
    if (!view) return null;
    if (view.players.p1 === me) return 'p1';
    if (view.players.p2 === me) return 'p2';
    return null;
  }
  const canThrow = () => view && Sim && view.phase === 'playing' && mySeat() === view.turn && pendingThrow == null;

  // --- sizing / coordinates ---
  function resize() {
    const avail = Math.max(240, Math.min(520, (container.clientWidth || 520) - 8, window.innerWidth - 24));
    const narrow = (container.clientWidth || 800) < 760;
    const size = Math.floor(narrow ? avail : Math.min(avail, (container.clientWidth || 800) - 290));
    if (size === sizePx && boardImg) return;
    sizePx = Math.max(240, size);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(sizePx * dpr);
    canvas.height = Math.round(sizePx * dpr);
    canvas.style.width = `${sizePx}px`;
    canvas.style.height = `${sizePx}px`;
    steady.style.width = `${sizePx}px`;
    hint.style.width = `${sizePx}px`;
    if (Sim) boardImg = paintBoard(Sim, sizePx, dpr);
  }
  const mmPerPx = () => (VIEW_MM * 2) / sizePx;
  const toMm = (px, py) => ({ x: (px - sizePx / 2) * mmPerPx(), y: (py - sizePx / 2) * mmPerPx() });
  const toPx = (x, y) => ({ px: x / mmPerPx() + sizePx / 2, py: y / mmPerPx() + sizePx / 2 });

  // --- aiming ---
  function aimPoint() {
    if (!aim) return null;
    const lift = aim.touch ? TOUCH_LIFT : 0;
    return toMm(aim.px, aim.py - lift);
  }
  function localXY(e) {
    const r = canvas.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (!canThrow() || aim) return;
    e.preventDefault();
    const { px, py } = localXY(e);
    aim = { pointerId: e.pointerId, start: performance.now(), px, py, touch: e.pointerType === 'touch' };
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    sfx.play('select');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!aim || e.pointerId !== aim.pointerId) return;
    const { px, py } = localXY(e);
    aim.px = px;
    aim.py = py;
  });
  const release = (e) => {
    if (!aim || (e && e.pointerId !== aim.pointerId)) return;
    const held = performance.now() - aim.start;
    const p = aimPoint();
    aim = null;
    if (held < MIN_HOLD_MS) {
      hint.textContent = 'Hold to raise the dart — let go when the reticle is steady';
      delete hint.dataset.auto;
      return;
    }
    if (!canThrow()) return;
    pendingThrow = view.throwNo;
    api.sendAction({ kind: 'throw', x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100, t: Math.round(held), seed: view.dartSeed });
    sfx.play('whoosh');
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', (e) => { if (aim && e.pointerId === aim.pointerId) aim = null; });

  // --- canvas frame loop ---
  function boardDarts() {
    if (!view) return [];
    if (view.turnDarts.length) return view.turnDarts.map((d) => ({ d, seat: view.turn }));
    if (view.prevTurn) return view.prevTurn.darts.map((d) => ({ d, seat: view.prevTurn.seat }));
    return [];
  }

  function currentHintTarget() {
    if (!view || view.phase !== 'playing' || !Sim) return null;
    const seat = view.turn;
    const left = 3 - view.turnDarts.length;
    if (view.mode === 'cricket') return null;
    const plan = Sim.planCheckout(view.scores[seat], left, view.mode === '501');
    return plan ? plan[0] : null;
  }

  function frame(now) {
    if (destroyed) return;
    raf = requestAnimationFrame(frame);
    if (!Sim || !boardImg) return;
    if (aim && performance.now() - aim.start > Sim.MAX_HOLD_MS) release(null);
    const ctx = canvas.getContext('2d');
    const dpr = canvas.width / sizePx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(boardImg, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const k = 1 / mmPerPx();

    // Checkout target glow for my turn.
    const target = mySeat() === (view && view.turn) ? currentHintTarget() : null;
    if (target) {
      ctx.save();
      ctx.translate(sizePx / 2, sizePx / 2);
      ctx.scale(k, k);
      const ring = target === 'DB' ? 'DB' : target === 'SB' ? 'SB' : target[0];
      segmentPath(ctx, Sim, ring, Number(target.slice(1)) || 25);
      const pulse = 0.35 + 0.25 * Math.sin(now / 260);
      ctx.fillStyle = `rgba(255,176,0,${pulse})`;
      ctx.fill();
      ctx.restore();
    }

    // Darts.
    const s = Math.max(0.7, sizePx / 470);
    for (const { d, seat } of boardDarts()) {
      const seen = seenDarts.get(d.n);
      let t = 1;
      if (!seen) {
        seenDarts.set(d.n, { start: now });
        t = 0;
      } else if (!seen.landed) {
        t = reduced() ? 1 : Math.min(1, (now - seen.start) / FLIGHT_MS);
        if (t >= 1) {
          seen.landed = true;
          onLanded(d, seat);
        }
      }
      const { px, py } = toPx(d.x, d.y);
      drawDart(ctx, px, py, SEAT_COLOR[seat], s, t * t);
    }

    // Score popups.
    for (let i = popups.length - 1; i >= 0; i--) {
      const p = popups[i];
      const age = (now - p.start) / 1100;
      if (age >= 1) { popups.splice(i, 1); continue; }
      ctx.save();
      ctx.globalAlpha = 1 - age * age;
      ctx.font = `bold ${Math.round(18 * s)}px "Courier New", monospace`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      const y = p.y - 26 * s - age * 30 * s;
      ctx.strokeText(p.text, p.x, y);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, y);
      ctx.restore();
    }

    // Reticle.
    if (aim) {
      const held = now - aim.start;
      const a = aimPoint();
      const w = Sim.wobble(view.dartSeed, held);
      const c = toPx(a.x + w.dx, a.y + w.dy);
      const ampPx = w.amp * k;
      const col = w.amp < 8 ? '#39ff14' : w.amp < 16 ? '#ffb000' : '#ff4d4d';
      ctx.save();
      ctx.strokeStyle = col;
      ctx.fillStyle = col;
      ctx.shadowColor = col;
      ctx.shadowBlur = 8;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.arc(c.px, c.py, Math.max(4, ampPx), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        ctx.moveTo(c.px + dx * 5, c.py + dy * 5);
        ctx.lineTo(c.px + dx * 12, c.py + dy * 12);
      }
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(c.px, c.py, 2.2, 0, Math.PI * 2);
      ctx.fill();
      // What it's on right now.
      const m = toMm(c.px, c.py);
      const on = Sim.scoreAt(m.x, m.y);
      ctx.font = 'bold 13px "Courier New", monospace';
      ctx.textAlign = 'left';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur = 0;
      ctx.strokeText(on.label, c.px + 14, c.py - 10);
      ctx.fillText(on.label, c.px + 14, c.py - 10);
      ctx.restore();
      // Steadiness meter: full when calm.
      const calm = Math.max(0, Math.min(1, (32 - w.amp) / 26));
      steadyFill.style.width = `${Math.round(calm * 100)}%`;
      steadyFill.style.background = col;
    } else {
      steadyFill.style.width = '0%';
    }
    canvas.classList.toggle('can-aim', !!canThrow());
  }

  function onLanded(d, seat) {
    const { px, py } = toPx(d.x, d.y);
    let text = d.ring === 'MISS' ? 'MISS' : d.label;
    let color = '#ffffff';
    if (d.bust) { text = 'BUST'; color = '#ff4d4d'; }
    else if (d.ring === 'T' || d.ring === 'DB') color = '#ffb000';
    else if (d.ring === 'D') color = '#39ff14';
    if (view && view.mode === 'cricket' && d.scored) text = `${d.label} +${d.scored}`;
    popups.push({ x: px, y: py, text, color, start: performance.now() });
    if (d.ring === 'MISS') sfx.play('dry');
    else sfx.play(d.ring === 'T' || d.ring === 'DB' ? 'capture' : 'move');
    if (d.ring === 'T' || d.ring === 'DB') setTimeout(() => sfx.play('point'), 90);
  }

  function showCallout() {
    const c = view && view.callout;
    const key = c ? `${c.seq}:${c.kind}:${c.seat}` : null;
    if (!calloutChanged(key) || !c) return;
    const el = document.createElement('div');
    el.className = `dt-callout${c.kind === '180' || c.kind === 'checkout' ? ' big' : ''}`;
    el.style.setProperty('--c', c.kind === 'bust' ? '#ff4d4d' : c.kind === 'checkout' ? '#39ff14' : c.kind === 'closed' ? SEAT_COLOR[c.seat] : '#ffb000');
    el.textContent = c.text;
    // Let the dart land first.
    setTimeout(() => {
      if (destroyed) return;
      wrap.appendChild(el);
      setTimeout(() => el.remove(), 2100);
      if (c.kind === 'bust') sfx.play('error');
      if (c.kind === '180') sfx.play('chime');
    }, reduced() ? 0 : FLIGHT_MS + 60);
  }

  // --- DOM ---
  function seatBox(seat) {
    const box = document.createElement('div');
    box.className = `dt-seat${view.phase === 'playing' && view.turn === seat ? ' turn' : ''}`;
    const chip = document.createElement('span');
    chip.className = 'dt-chip';
    chip.style.background = SEAT_COLOR[seat];
    chip.style.color = SEAT_COLOR[seat];
    const name = document.createElement('span');
    const occ = view.players[seat];
    name.textContent = `${seat === 'p1' ? 'P1' : 'P2'}: ${occ ? (occ === 'BOT' ? '(bot)' : nicknameFor(occ)) : '(empty)'}${occ === api.getClientId() ? ' (you)' : ''}`;
    box.append(chip, name);
    const mine = mySeat();
    if (!occ) {
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

  function card01(seat) {
    const c = document.createElement('div');
    c.className = `dt-card${view.phase === 'playing' && view.turn === seat ? ' turn' : ''}`;
    c.style.setProperty('--c', SEAT_COLOR[seat]);
    const nm = document.createElement('div');
    nm.className = 'nm';
    const chip = document.createElement('span');
    chip.className = 'dt-chip';
    chip.style.background = SEAT_COLOR[seat];
    chip.style.color = SEAT_COLOR[seat];
    nm.append(chip, document.createTextNode(seatName(seat) + (view.players[seat] === api.getClientId() ? ' (you)' : '')));
    const big = document.createElement('div');
    big.className = 'big';
    big.textContent = view.scores[seat];
    if (prevBig && prevBig[seat] !== view.scores[seat] && !reduced()) big.classList.add('bump');
    const st = view.stats[seat];
    const avg = st.darts ? ((st.scored / st.darts) * 3).toFixed(1) : '—';
    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.innerHTML = '';
    const s1 = document.createElement('span');
    s1.textContent = `AVG ${avg}`;
    const s2 = document.createElement('span');
    s2.textContent = `DARTS ${st.darts}`;
    const s3 = document.createElement('span');
    s3.textContent = `BEST ${st.best}`;
    sub.append(s1, s2, s3);
    c.append(nm, big, sub);
    c.appendChild(slotsFor(seat));
    if (view.phase === 'playing' && view.turn === seat) {
      const plan = Sim && Sim.planCheckout(view.scores[seat], 3 - view.turnDarts.length, view.mode === '501');
      if (plan) {
        const co = document.createElement('div');
        co.className = 'dt-checkout';
        co.textContent = `CHECKOUT: ${plan.map((l) => (l.startsWith('S') ? l.slice(1) : l)).join(' · ')}`;
        c.appendChild(co);
      }
    }
    return c;
  }

  function slotsFor(seat) {
    const row = document.createElement('div');
    row.className = 'dt-slots';
    let darts = [];
    if (view.turn === seat && view.turnDarts.length) darts = view.turnDarts;
    else if (view.prevTurn && view.prevTurn.seat === seat) darts = view.prevTurn.darts;
    for (let i = 0; i < 3; i++) {
      const d = darts[i];
      const sl = document.createElement('div');
      sl.className = 'dt-slot';
      if (d) {
        sl.classList.add(d.bust ? 'bust' : 'hit');
        sl.textContent = d.ring === 'MISS' ? '—' : d.label;
      }
      row.appendChild(sl);
    }
    return row;
  }

  function cricketBoard() {
    const t = document.createElement('table');
    t.className = 'dt-cricket';
    const pts = document.createElement('tr');
    pts.className = 'pts';
    const head = (seat) => {
      const td = document.createElement('td');
      td.style.color = SEAT_COLOR[seat];
      td.textContent = view.cricket[seat].points;
      return td;
    };
    const mid = document.createElement('td');
    mid.textContent = 'PTS';
    mid.style.fontSize = '12px';
    mid.style.color = '#6fae5f';
    pts.append(head('p1'), mid, head('p2'));
    t.appendChild(pts);
    for (const n of Sim.CRICKET_NUMS) {
      const tr = document.createElement('tr');
      const a = view.cricket.p1.marks[n];
      const b = view.cricket.p2.marks[n];
      if (a >= 3 && b >= 3) tr.className = 'dead';
      const cell = (m, seat) => {
        const td = document.createElement('td');
        td.className = 'mk';
        td.style.color = SEAT_COLOR[seat];
        td.textContent = markGlyph(Math.min(3, m));
        return td;
      };
      const num = document.createElement('td');
      num.className = 'num';
      num.textContent = n === 25 ? 'BULL' : n;
      tr.append(cell(a, 'p1'), num, cell(b, 'p2'));
      t.appendChild(tr);
    }
    return t;
  }

  function cricketCard(seat) {
    const c = document.createElement('div');
    c.className = `dt-card${view.phase === 'playing' && view.turn === seat ? ' turn' : ''}`;
    c.style.setProperty('--c', SEAT_COLOR[seat]);
    const nm = document.createElement('div');
    nm.className = 'nm';
    const chip = document.createElement('span');
    chip.className = 'dt-chip';
    chip.style.background = SEAT_COLOR[seat];
    chip.style.color = SEAT_COLOR[seat];
    nm.append(chip, document.createTextNode(seatName(seat) + (view.players[seat] === api.getClientId() ? ' (you)' : '')));
    c.append(nm, slotsFor(seat));
    return c;
  }

  function resultsOpts() {
    if (!view || view.phase !== 'game_over') return null;
    const me = mySeat();
    const w = view.winner;
    const draw = !w || w === 'draw';
    const val = (seat) => (view.mode === 'cricket' ? `${view.cricket[seat].points} pts` : `${view.scores[seat]} left`);
    const order = draw ? ['p1', 'p2'] : [w, w === 'p1' ? 'p2' : 'p1'];
    let subtitle = view.endReason === 'rounds' ? `Round limit (${view.maxRounds}) reached` : '';
    if (view.endReason === 'checkout' && view.prevTurn) {
      const st = view.stats[w];
      subtitle = `Checked out on ${view.prevTurn.darts[view.prevTurn.darts.length - 1].label} · ${st.darts} darts · avg ${((st.scored / st.darts) * 3).toFixed(1)}`;
    }
    if (view.endReason === 'closed') subtitle = 'Closed everything with the lead';
    return {
      title: draw ? "IT'S A DRAW" : me === w ? 'YOU WIN!' : me ? 'YOU LOSE' : `${seatName(w)} WINS!`,
      subtitle,
      outcome: draw ? 'draw' : me == null ? 'over' : me === w ? 'win' : 'lose',
      rows: order.map((seat) => ({ name: seatName(seat), value: val(seat), win: !draw && seat === w, you: seat === me })),
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
    status.className = 'dt-status';
    status.style.color = '';
    if (view.phase === 'waiting') {
      status.textContent = 'Waiting for both throwers.';
    } else if (view.phase === 'playing') {
      const mine = seat && seat === view.turn;
      const dartNo = view.turnDarts.length + 1;
      status.textContent = mine ? `▶ YOUR THROW — DART ${dartNo} OF 3` : `${seatName(view.turn)} TO THROW — DART ${dartNo}`;
      if (mine) status.classList.add('mine');
      status.style.color = SEAT_COLOR[view.turn];
    } else {
      status.textContent = view.winner === 'draw' ? "IT'S A DRAW!" : `${seatName(view.winner)} WINS!`;
      status.style.color = '#ffb000';
    }
    err.textContent = flashError ? REJECT_MESSAGES[flashError] || 'Throw rejected' : '';

    seats.innerHTML = '';
    seats.append(seatBox('p1'), seatBox('p2'));
    if (seat) {
      const leave = document.createElement('button');
      leave.textContent = 'LEAVE SEAT';
      leave.addEventListener('click', () => api.sendAction({ kind: 'leaveSeat' }));
      seats.appendChild(leave);
    }

    modes.innerHTML = '';
    if (view.phase !== 'playing') {
      const humans = ['p1', 'p2'].some((s) => view.players[s] && view.players[s] !== 'BOT');
      const canSet = !!seat || !humans;
      for (const m of ['501', '301', 'cricket']) {
        const b = document.createElement('button');
        b.textContent = m.toUpperCase();
        if (view.mode === m) b.classList.add('on');
        b.disabled = !canSet;
        b.addEventListener('click', () => { sfx.play('click'); api.sendAction({ kind: 'setMode', mode: m }); });
        modes.appendChild(b);
      }
    }

    panel.innerHTML = '';
    const meta = document.createElement('div');
    meta.className = 'dt-meta';
    const ml = document.createElement('span');
    ml.textContent = MODE_LABEL[view.mode];
    const mr = document.createElement('span');
    mr.textContent = `ROUND ${Math.min(view.round, view.maxRounds)}/${view.maxRounds}`;
    meta.append(ml, mr);
    panel.appendChild(meta);
    if (view.mode === 'cricket') {
      panel.append(cricketCard('p1'), cricketCard('p2'), cricketBoard());
    } else {
      panel.append(card01('p1'), card01('p2'));
    }
    prevBig = { ...view.scores };

    if (view.phase === 'playing' && seat === view.turn) {
      if (!hint.textContent || hint.dataset.auto) {
        hint.textContent = 'Press & hold to aim · release when the reticle is steady (green)';
        hint.dataset.auto = '1';
      }
    } else {
      hint.textContent = view.phase === 'playing' ? '' : 'Pick a mode, then fill both seats to play.';
      hint.dataset.auto = '1';
    }

    btnRow.innerHTML = '';
    if (view.phase === 'game_over' && seat) {
      const again = document.createElement('button');
      again.textContent = 'REMATCH (SWAP THROW)';
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
  }).catch(() => { status.textContent = 'Failed to load darts.'; });
  raf = requestAnimationFrame(frame);
  render();

  function markAllSeen(v) {
    for (const d of v.turnDarts || []) seenDarts.set(d.n, { start: 0, landed: true });
    for (const d of (v.prevTurn && v.prevTurn.darts) || []) seenDarts.set(d.n, { start: 0, landed: true });
  }

  return {
    applySnapshot(snapshot) {
      view = snapshot;
      markAllSeen(view);
      calloutChanged(view.callout ? `${view.callout.seq}:${view.callout.kind}:${view.callout.seat}` : null);
      prevBig = null;
      render();
    },
    applyEvent(data) {
      if (!data) return;
      if (data.kind === 'state') {
        const prev = view;
        view = data;
        if (pendingThrow != null && (data.throwNo !== pendingThrow || data.phase !== 'playing')) pendingThrow = null;
        if (prev && data.throwNo < prev.throwNo) seenDarts.clear(); // new game: dart numbers restart
        flashError = null;
        if (prev && data.winner && !prev.winner) {
          const me = mySeat();
          setTimeout(() => sfx.play(data.winner === 'draw' || !me ? 'chime' : data.winner === me ? 'win' : 'lose'), FLIGHT_MS + 200);
        }
        if (prev && prev.phase === 'playing' && data.phase === 'playing' && data.turn === mySeat() && prev.turn !== data.turn) {
          setTimeout(() => sfx.play('turn'), 500);
        }
        // Hold the scoreboard until the dart lands.
        const newDart = prev && data.throwNo > prev.throwNo && !reduced();
        if (newDart) {
          clearTimeout(renderTimer);
          renderTimer = setTimeout(render, FLIGHT_MS);
        } else {
          render();
        }
      } else if (data.kind === 'moveRejected') {
        pendingThrow = null;
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
      results.destroy();
      container.innerHTML = '';
    },
  };
}
