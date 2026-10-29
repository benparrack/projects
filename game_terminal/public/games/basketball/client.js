// Basketball client. A 2D canvas court in perspective (fixed camera behind the shooter, hoop seen
// from the front) + the shared shot physics (sim.js). On your run, drag/flick up from anywhere on
// the court and let go: sideways = aim, length of the flick = power. Balls roll in from the rack
// every COOLDOWN_MS, so you can have several in the air at once. Your own shot starts flying
// instantly from a local run of the same sim; the server's authoritative record (identical in
// practice) replaces it when it arrives. Every ball and the moving hoop are drawn from the shared
// run clock, so a ball touches the rim exactly where everyone sees the rim.

import { sfx } from '../sfx.js';
import { preferredLevel, levelSelect, levelLabel } from '../botLevel.js';
import { createResults, duelResults } from '../resultsPanel.js';
import { makeServerClock } from '../serverClock.js';
import { loadScript } from '../loadScript.js';
import { injectStyle, reduced, fmtClock } from '../dom.js';

const COLORS = ['red', 'blue'];
const TEXT_COLOR = { red: '#ff5a6a', blue: '#5aa0ff' };
const CAM = { y: 1.55, z: -2.2 }; // far enough back that the ball in hand doesn't hide the lane
const REJECT_MESSAGES = {
  not_your_turn: "It's not your run.",
  busy: 'Wait for the next ball.',
  not_playing: 'The game is not running.',
  not_started: 'Wait for the whistle.',
  time_up: "Time's up.",
  invalid: 'Invalid shot.',
};

const CSS = `
.bb-root { display: flex; flex-direction: column; align-items: center; gap: 8px; font-family: monospace; color: #b8ffb0; width: 100%; }
.bb-status { font-size: 15px; font-weight: bold; letter-spacing: 1px; text-align: center; min-height: 20px; }
.bb-status.mine { color: #39ff14; text-shadow: 0 0 8px #39ff14; }
.bb-err { color: #ff5a5a; font-size: 12px; min-height: 14px; }
.bb-seats { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; align-items: center; }
.bb-seat { display: flex; align-items: center; gap: 6px; padding: 5px 8px; border: 1px solid #1d5c1d; border-radius: 6px; background: #071107; font-size: 13px; }
.bb-seat.turn { border-color: #39ff14; box-shadow: 0 0 10px -2px #39ff14; }
.bb-seat button, .bb-row button { font: inherit; font-size: 12px; }
.bb-chip { width: 12px; height: 12px; border-radius: 50%; display: inline-block; flex: none; box-shadow: 0 0 6px currentColor; }
.bb-chip.red { background: #e0283c; color: #e0283c; } .bb-chip.blue { background: #2a6cf0; color: #2a6cf0; }
.bb-stage { position: relative; width: min(100%, 480px); aspect-ratio: 3 / 4; max-height: 74vh; border: 1px solid #1d5c1d; border-radius: 10px; overflow: hidden;
  background: #030805; touch-action: none; user-select: none; -webkit-user-select: none; }
.bb-stage canvas { display: block; width: 100%; height: 100%; }
.bb-stage.can-shoot { cursor: grab; } .bb-stage.dragging { cursor: grabbing; }
.bb-hud { position: absolute; left: 0; right: 0; top: 0; display: grid; grid-template-columns: 1fr auto 1fr; align-items: start; gap: 6px; padding: 7px 8px; pointer-events: none; text-shadow: 0 1px 2px #000; }
.bb-side { display: flex; flex-direction: column; gap: 1px; padding: 4px 8px; border-radius: 7px; border: 1px solid rgba(57,255,20,.18); background: rgba(0,0,0,.45); min-width: 0; transition: box-shadow .2s, border-color .2s; }
.bb-side.right { text-align: right; align-items: flex-end; }
.bb-side.active { border-color: var(--c); box-shadow: 0 0 12px -3px var(--c); }
.bb-name { font-size: 11px; color: var(--c); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.bb-score { font-size: 26px; font-weight: bold; line-height: 1; color: #fff; font-variant-numeric: tabular-nums; text-shadow: 0 0 10px var(--c); }
.bb-score.bump { animation: bb-bump .35s ease-out; }
@keyframes bb-bump { 40% { transform: scale(1.22); color: #ffe14d; } }
.bb-tag { font-size: 10px; min-height: 12px; color: #ffb000; letter-spacing: 1px; white-space: nowrap; }
.bb-tag.fire { color: #ff7b1c; text-shadow: 0 0 6px #ff4d00; animation: bb-flick .25s steps(2) infinite alternate; }
@keyframes bb-flick { to { color: #ffd23f; } }
.bb-clockbox { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.bb-clock { font-size: 26px; font-weight: bold; line-height: 1; padding: 3px 9px; border-radius: 6px; background: #000; border: 1px solid #3a2a00; color: #ffb000;
  text-shadow: 0 0 10px #ff8a00; font-variant-numeric: tabular-nums; letter-spacing: 2px; }
.bb-clock.low { color: #ff3b3b; border-color: #5a0000; text-shadow: 0 0 12px #ff0000; animation: bb-pulse .5s ease-in-out infinite alternate; }
@keyframes bb-pulse { to { opacity: .55; } }
.bb-period { font-size: 10px; letter-spacing: 2px; color: #9fdc98; white-space: nowrap; }
.bb-hint { position: absolute; left: 0; right: 0; bottom: 24%; text-align: center; font-size: 12px; color: #c8ffc0; pointer-events: none; text-shadow: 0 1px 3px #000; animation: bb-hint 1.6s ease-in-out infinite alternate; }
@keyframes bb-hint { from { opacity: .4; } to { opacity: 1; } }
.bb-power { position: absolute; right: 10px; top: 50%; width: 10px; height: 40%; transform: translateY(-30%); border: 1px solid #39ff14; border-radius: 6px; background: rgba(0,0,0,.45); overflow: hidden; pointer-events: none; opacity: 0; transition: opacity .15s; }
.bb-power.on { opacity: 1; }
.bb-power > div { position: absolute; left: 0; right: 0; bottom: 0; background: linear-gradient(0deg, #39ff14, #ffe14d 60%, #ff4d4d); }
.bb-callout { position: absolute; left: 50%; top: 44%; transform: translate(-50%, -50%); font-size: 30px; font-weight: bold; letter-spacing: 3px; white-space: nowrap; pointer-events: none;
  text-shadow: 0 0 14px currentColor, 0 2px 3px #000; animation: bb-call 1.4s cubic-bezier(.2,1.4,.4,1) forwards; }
.bb-callout.small { font-size: 18px; top: 52%; }
@keyframes bb-call { 0% { opacity: 0; transform: translate(-50%, -50%) scale(.4); } 15% { opacity: 1; transform: translate(-50%, -50%) scale(1.08); }
  25% { transform: translate(-50%, -50%) scale(1); } 80% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -70%) scale(1); } }
.bb-row { display: flex; gap: 8px; align-items: center; justify-content: center; flex-wrap: wrap; font-size: 12px; min-height: 4px; }
.bb-help { font-size: 11px; opacity: .7; text-align: center; max-width: 520px; }
.bb-fail { padding: 30px; text-align: center; color: #ff8080; }
@media (prefers-reduced-motion: reduce) { .bb-callout, .bb-score.bump, .bb-clock.low, .bb-tag.fire, .bb-hint { animation: none; } }
`;

export function mount(container, api) {
  injectStyle(CSS);
  let view = null;
  let roster = [];
  let flashError = null;
  let flashTimer = null;
  let destroyed = false;
  let S = null;
  let raf = 0;
  const clock = makeServerClock();

  const root = document.createElement('div');
  root.className = 'bb-root';
  container.appendChild(root);
  const results = createResults(container);

  const status = document.createElement('div');
  status.className = 'bb-status';
  const err = document.createElement('div');
  err.className = 'bb-err';
  const seats = document.createElement('div');
  seats.className = 'bb-seats';
  const stage = document.createElement('div');
  stage.className = 'bb-stage';
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  // HUD: two score boxes and the shot clock — built once, patched in place.
  const hud = document.createElement('div');
  hud.className = 'bb-hud';
  const side = {};
  for (const c of COLORS) {
    const box = document.createElement('div');
    box.className = `bb-side${c === 'blue' ? ' right' : ''}`;
    box.style.setProperty('--c', TEXT_COLOR[c]);
    const name = document.createElement('div');
    name.className = 'bb-name';
    const score = document.createElement('div');
    score.className = 'bb-score';
    score.textContent = '0';
    const tag = document.createElement('div');
    tag.className = 'bb-tag';
    box.append(name, score, tag);
    side[c] = { box, name, score, tag, shown: null };
  }
  const clockBox = document.createElement('div');
  clockBox.className = 'bb-clockbox';
  const clockEl = document.createElement('div');
  clockEl.className = 'bb-clock';
  clockEl.textContent = '0:30';
  const periodEl = document.createElement('div');
  periodEl.className = 'bb-period';
  clockBox.append(clockEl, periodEl);
  hud.append(side.red.box, clockBox, side.blue.box);
  const hint = document.createElement('div');
  hint.className = 'bb-hint';
  const power = document.createElement('div');
  power.className = 'bb-power';
  const powerFill = document.createElement('div');
  power.appendChild(powerFill);
  stage.append(canvas, hud, hint, power);
  const options = document.createElement('div');
  options.className = 'bb-row';
  const help = document.createElement('div');
  help.className = 'bb-help';
  help.textContent = 'Flick up from anywhere on the court and let go. Sideways aims, a longer flick shoots harder. '
    + 'Make = 2, swish = 3. Every 5th ball is a MONEY BALL (x2); 3 in a row and you are ON FIRE (x2 until you miss). '
    + 'After 5 makes the hoop starts moving. 30 s each. Highest score wins, ties go to sudden-death overtime.';
  root.append(status, err, seats, stage, options, help);

  // ---- helpers ----
  function nicknameFor(id, color) {
    if (!id) return null;
    if (id === 'BOT') return `BOT (${levelLabel(((view && view.botLevels) || {})[color])})`;
    const e = roster.find((r) => r.clientId === id);
    return e ? e.nickname : 'someone';
  }
  function mySeat() {
    if (!view) return null;
    const me = api.getClientId();
    return view.players.red === me ? 'red' : view.players.blue === me ? 'blue' : null;
  }
  const curRun = () => (view && view.phase === 'playing' ? view.run : null);
  const runTime = (run) => clock.now() - run.startAt;

  // ---- animation state ----
  let anims = []; // balls in the air: { rec, local, runIdx, startAt, fired:Set, by, missF }
  let localQueue = []; // my shots predicted locally, waiting for the server's record
  let lastSeq = 0;
  let local = { runIdx: -1, lastAt: -1e9, ballNo: 0 }; // my run's ball clock incl. unconfirmed shots
  const runInfo = new Map(); // runIdx -> { startAt, sched } (the hoop each ball was shot at)
  let landed = { runIdx: -1, streak: 0 }; // streak as the balls have visibly landed
  let levelCallouts = []; // { wall, level }
  let popups = []; // canvas text: { x, y, text, color, born, size }
  let parts = []; // particles: { x, y, vx, vy, life, max, color, r, g }
  let netPulse = 0;
  let netSway = 0;
  let rimShake = 0;
  let boardFlash = 0;
  let dispHx = 0;
  let lastHx = 0;
  let drag = null; // { id, x0, y0, aim, power }
  let lastCount = null; // countdown second last beeped
  let buzzed = -1; // run idx the buzzer sounded for
  let lastTickSec = null;
  let lastFrame = performance.now();

  // ---- projection (device px) ----
  let W = 0;
  let H = 0;
  let F = 1;
  let HOR = 0;
  let bg = null; // static background (arena, floor, court lines)
  function proj(x, y, z) {
    const d = Math.max(0.15, z - CAM.z);
    const s = F / d;
    return [W / 2 + x * s, HOR - (y - CAM.y) * s, s];
  }

  function buildBackground() {
    bg = document.createElement('canvas');
    bg.width = W;
    bg.height = H;
    const g = bg.getContext('2d');
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#02060a');
    sky.addColorStop(0.45, '#071a12');
    sky.addColorStop(0.62, '#0a2416');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    // stadium lights + crowd bokeh
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 140; i++) {
      const x = rnd() * W;
      const y = H * (0.2 + rnd() * 0.42);
      const r = (1 + rnd() * 2.6) * (W / 480);
      const hue = rnd() < 0.5 ? '57,255,20' : rnd() < 0.5 ? '255,180,0' : '120,200,255';
      g.fillStyle = `rgba(${hue},${0.05 + rnd() * 0.12})`;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    for (const lx of [0.12, 0.88]) {
      const lg = g.createRadialGradient(W * lx, H * 0.05, 0, W * lx, H * 0.05, W * 0.45);
      lg.addColorStop(0, 'rgba(200,255,200,0.16)');
      lg.addColorStop(1, 'rgba(200,255,200,0)');
      g.fillStyle = lg;
      g.fillRect(0, 0, W, H * 0.6);
    }
    // floor (y = 0), from the far wall to below the screen
    const [, farY] = proj(0, 0, 14);
    const wood = g.createLinearGradient(0, farY, 0, H);
    wood.addColorStop(0, '#1b1206');
    wood.addColorStop(0.3, '#3a2610');
    wood.addColorStop(1, '#5a3a18');
    g.fillStyle = wood;
    g.fillRect(0, farY, W, H - farY);
    // boards
    g.strokeStyle = 'rgba(0,0,0,0.18)';
    g.lineWidth = Math.max(1, W / 480);
    for (let x = -8; x <= 8; x += 0.4) {
      const [ax, ay] = proj(x, 0, 14);
      const [bx, by] = proj(x, 0, -0.9);
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
    }
    // wall line glow
    g.fillStyle = 'rgba(57,255,20,0.35)';
    g.fillRect(0, farY - 1, W, Math.max(1, W / 320));
    // court lines
    const line = (pts, close) => {
      g.beginPath();
      pts.forEach(([x, z], i) => { const [sx, sy] = proj(x, 0, z); if (i) g.lineTo(sx, sy); else g.moveTo(sx, sy); });
      if (close) g.closePath();
      g.stroke();
    };
    const baseZ = S.BOARD_Z + 1.2;
    g.save();
    g.shadowColor = '#39ff14';
    g.shadowBlur = 10 * (W / 480);
    g.strokeStyle = 'rgba(120,255,90,0.75)';
    g.lineWidth = 3 * (W / 480);
    line([[-9, baseZ], [9, baseZ]]);
    // the paint
    g.fillStyle = 'rgba(57,255,20,0.07)';
    g.beginPath();
    [[-1.7, baseZ], [1.7, baseZ], [1.7, 0.6], [-1.7, 0.6]].forEach(([x, z], i) => { const [sx, sy] = proj(x, 0, z); if (i) g.lineTo(sx, sy); else g.moveTo(sx, sy); });
    g.closePath();
    g.fill();
    line([[-1.7, baseZ], [-1.7, 0.6], [1.7, 0.6], [1.7, baseZ]]);
    // free-throw circle (half toward the shooter)
    const arc = [];
    for (let a = 0; a <= Math.PI; a += Math.PI / 30) arc.push([Math.cos(a) * 1.7, 0.6 - Math.sin(a) * 1.7]);
    line(arc);
    // restricted-area arc under the hoop
    const ra = [];
    for (let a = 0; a <= Math.PI; a += Math.PI / 24) ra.push([Math.cos(a) * 1.25, S.RIM_Z - Math.sin(a) * 1.25]);
    line(ra);
    // three-point arc
    const tp = [];
    for (let a = 0.05; a <= Math.PI - 0.05; a += Math.PI / 60) tp.push([Math.cos(a) * 6.75, S.RIM_Z - Math.sin(a) * 6.75]);
    line(tp);
    g.restore();
    // centre logo on the floor
    g.save();
    const [lx, ly, ls] = proj(0, 0, 2.3);
    g.translate(lx, ly);
    g.scale(1, 0.32);
    g.fillStyle = 'rgba(57,255,20,0.16)';
    g.font = `bold ${Math.round(0.42 * ls)}px monospace`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('GAME TERMINAL', 0, 0);
    g.restore();
    // vignette
    const vg = g.createRadialGradient(W / 2, H * 0.45, H * 0.25, W / 2, H * 0.5, H * 0.8);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(stage.clientWidth * dpr);
    const h = Math.round(stage.clientHeight * dpr);
    if (!w || !h) return false;
    if (w === W && h === H && bg) return true;
    W = w; H = h;
    canvas.width = W;
    canvas.height = H;
    F = Math.min(H, (W * 4) / 3) * 1.16;
    HOR = H * 0.52;
    buildBackground();
    return true;
  }

  // ---- juice ----
  function callout(text, color, small) {
    if (reduced() && small) return;
    const el = document.createElement('div');
    el.className = `bb-callout${small ? ' small' : ''}`;
    el.style.color = color || '#39ff14';
    el.textContent = text;
    stage.appendChild(el);
    setTimeout(() => el.remove(), 1500);
  }
  function popup(x, y, text, color, size) {
    popups.push({ x, y, text, color, born: performance.now(), size: size || 1 });
    if (popups.length > 12) popups.shift();
  }
  function burst(x, y, n, colors, speed, glow) {
    if (reduced()) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (0.3 + Math.random()) * speed;
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.6, life: 1, max: 0.6 + Math.random() * 0.6,
        color: colors[i % colors.length], r: (1.5 + Math.random() * 2.5) * (W / 480), g: glow ? 1 : 0, grav: 1 });
    }
    if (parts.length > 500) parts.splice(0, parts.length - 500);
  }

  // ---- shots ----
  function infoFor(runIdx) {
    return runInfo.get(runIdx) || (view && view.run ? { startAt: view.run.startAt, sched: view.run.sched } : { startAt: 0, sched: [] });
  }
  function missFrame(rec) {
    // the moment a miss is "decided": falling back below the rim after the apex, or the end
    let apex = false;
    for (let i = 1; i < rec.frames.length; i++) {
      if (rec.frames[i][1] < rec.frames[i - 1][1]) apex = true;
      if (apex && rec.frames[i][1] < S.RIM_Y - 0.7) return i;
    }
    return rec.frames.length - 1;
  }
  function addAnim(rec, isLocal) {
    const info = infoFor(rec.runIdx);
    const a = { rec, local: isLocal, runIdx: rec.runIdx, startAt: info.startAt, fired: new Set(), by: rec.by, missF: missFrame(rec) };
    // joining mid-flight: don't replay what already happened
    const f = (clock.now() - a.startAt - rec.at) / S.FRAME_MS;
    rec.events.forEach((ev, i) => { if (ev.f < f - 3) a.fired.add(i); });
    if (a.missF < f - 3) a.fired.add('miss');
    if (rec.levelUp && !isLocal) levelCallouts.push({ wall: a.startAt + rec.levelAt, level: rec.levelUp, runIdx: rec.runIdx });
    anims.push(a);
    return a;
  }
  function onNewShot(rec) {
    if (rec.seq <= lastSeq) return;
    lastSeq = rec.seq;
    if (rec.by === mySeat() && localQueue.length) {
      const a = localQueue.shift();
      a.rec = rec;
      a.local = false;
      a.missF = missFrame(rec);
      if (rec.levelUp) levelCallouts.push({ wall: a.startAt + rec.levelAt, level: rec.levelUp, runIdx: rec.runIdx });
      return;
    }
    addAnim(rec, false);
  }

  function landTime(a) {
    const r = a.rec;
    return a.startAt + r.at + (r.made ? r.makeFrame : a.missF) * S.FRAME_MS;
  }
  // points the server already counted but whose ball hasn't dropped yet (per colour)
  function pendingPoints(color) {
    const now = clock.now();
    let p = 0;
    for (const a of anims) if (!a.local && a.by === color && a.rec.points && landTime(a) > now) p += a.rec.points;
    return p;
  }

  // ---- input ----
  function canShoot() {
    const run = curRun();
    const seat = mySeat();
    if (!S || !run || !seat || run.shooter !== seat) return false;
    const t = runTime(run);
    if (local.runIdx !== run.idx) syncLocal();
    return t >= 0 && t <= run.length && t >= local.lastAt + S.COOLDOWN_MS;
  }
  function syncLocal() {
    const run = curRun();
    if (!run) return;
    if (local.runIdx !== run.idx) {
      local = { runIdx: run.idx, lastAt: run.lastAt, ballNo: run.ballNo };
      for (const a of localQueue) anims = anims.filter((x) => x !== a);
      localQueue = [];
    } else if (!localQueue.length) {
      local.lastAt = run.lastAt;
      local.ballNo = run.ballNo;
    }
  }

  function dragInput(dx, dy) {
    const r = stage.getBoundingClientRect();
    return { aim: Math.max(-1, Math.min(1, dx / (r.width * 0.42))), power: Math.max(0, Math.min(1, dy / (r.height * 0.6))) };
  }
  stage.addEventListener('pointerdown', (e) => {
    if (drag || !curRun() || mySeat() !== curRun().shooter) return;
    e.preventDefault();
    try { stage.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, aim: 0, power: 0 };
    stage.classList.add('dragging');
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const inp = dragInput(e.clientX - drag.x0, drag.y0 - e.clientY);
    drag.aim = inp.aim;
    drag.power = inp.power;
    power.classList.toggle('on', inp.power > 0.02);
    powerFill.style.height = `${Math.round(inp.power * 100)}%`;
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    stage.classList.remove('dragging');
    power.classList.remove('on');
    if (e.type === 'pointercancel' || d.power < 0.06) return; // a tap / tiny drag isn't a shot
    if (!canShoot()) return;
    const run = curRun();
    const at = Math.round(runTime(run));
    const input = S.normInput({ aim: d.aim, power: d.power });
    const res = S.simulate(run.sched, input, at);
    if (!res) return;
    const rec = { at, input, frames: res.frames, events: res.events, made: res.made, swish: res.swish, makeFrame: res.makeFrame,
      ballNo: local.ballNo, money: S.isMoneyBall(local.ballNo), fire: run.streak >= S.FIRE_AT, points: 0, streak: 0,
      levelUp: 0, levelAt: 0, by: run.shooter, runIdx: run.idx, seq: -1 };
    local.lastAt = at;
    local.ballNo++;
    localQueue.push(addAnim(rec, true));
    sfx.play('whoosh', { vol: 0.5 });
    api.sendAction({ kind: 'shoot', aim: input.aim, power: input.power, at });
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  // ---- drawing ----
  function drawBall(x, y, r, spin, money, alpha, fire) {
    if (r < 0.5) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (fire && !reduced()) {
      const fg = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 2.1);
      fg.addColorStop(0, 'rgba(255,140,0,0.75)');
      fg.addColorStop(1, 'rgba(255,40,0,0)');
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.arc(x, y, r * 2.1, 0, Math.PI * 2); ctx.fill();
    }
    ctx.translate(x, y);
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.save();
    ctx.clip();
    ctx.rotate(spin);
    if (money) {
      ctx.fillStyle = '#e0283c'; ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.fillStyle = '#f4f4f4'; ctx.fillRect(-r / 3, -r, (r * 2) / 3, r * 2);
      ctx.fillStyle = '#2a6cf0'; ctx.fillRect(r / 3, -r, r, r * 2);
    } else {
      ctx.fillStyle = '#e8701f';
      ctx.fillRect(-r, -r, r * 2, r * 2);
    }
    ctx.strokeStyle = 'rgba(30,12,0,0.85)';
    ctx.lineWidth = Math.max(1, r * 0.07);
    ctx.beginPath();
    ctx.moveTo(-r, 0); ctx.lineTo(r, 0);
    ctx.moveTo(0, -r); ctx.lineTo(0, r);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(-r * 1.45, 0, r * 1.05, -0.9, 0.9); ctx.stroke();
    ctx.beginPath(); ctx.arc(r * 1.45, 0, r * 1.05, Math.PI - 0.9, Math.PI + 0.9); ctx.stroke();
    ctx.restore();
    // shading
    const sh = ctx.createRadialGradient(-r * 0.4, -r * 0.45, r * 0.1, 0, 0, r * 1.05);
    sh.addColorStop(0, 'rgba(255,255,255,0.35)');
    sh.addColorStop(0.45, 'rgba(255,255,255,0)');
    sh.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = sh;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function shadow(x, z, y, alpha) {
    const [sx, sy, s] = proj(x, 0, z);
    const k = Math.max(0, 1 - y / 4.5);
    ctx.fillStyle = `rgba(0,0,0,${(0.45 * k * alpha).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(sx, sy, S.BALL_R * s * (1.3 - 0.5 * k), S.BALL_R * s * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function ringPts(hx, y, z, r, n, a0 = 0, a1 = Math.PI * 2) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push(proj(hx + Math.cos(a) * r, y, z + Math.sin(a) * r));
    }
    return pts;
  }
  function strokePts(pts) {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
  }

  function drawBoardAndPole(hx, fire) {
    const px = hx;
    const pz = S.BOARD_Z + 0.9;
    // pole + arm + base
    const [b0x, b0y, b0s] = proj(px, 0, pz);
    const [t0x, t0y] = proj(px, 3.25, pz);
    ctx.fillStyle = '#1a2a22';
    const pw = 0.09 * b0s;
    ctx.fillRect(b0x - pw / 2, t0y, pw, b0y - t0y);
    ctx.fillStyle = 'rgba(57,255,20,0.25)';
    ctx.fillRect(b0x - pw / 2, t0y, pw * 0.25, b0y - t0y);
    const [a1x, a1y] = proj(px, 3.25, S.BOARD_Z + 0.05);
    ctx.strokeStyle = '#1a2a22';
    ctx.lineWidth = pw * 0.8;
    ctx.beginPath(); ctx.moveTo(t0x, t0y); ctx.lineTo(a1x, a1y); ctx.stroke();
    ctx.fillStyle = '#0d1a12';
    ctx.beginPath(); ctx.ellipse(b0x, b0y, 0.5 * b0s, 0.12 * b0s, 0, 0, Math.PI * 2); ctx.fill();
    // backboard
    const hw = S.BOARD_W / 2;
    const [lx, ty] = proj(hx - hw, S.BOARD_TOP, S.BOARD_Z);
    const [rx, by] = proj(hx + hw, S.BOARD_BOTTOM, S.BOARD_Z);
    const [, , bs] = proj(hx, 3, S.BOARD_Z);
    ctx.save();
    const glass = ctx.createLinearGradient(lx, ty, rx, by);
    glass.addColorStop(0, 'rgba(210,240,255,0.30)');
    glass.addColorStop(0.5, 'rgba(160,210,255,0.14)');
    glass.addColorStop(1, 'rgba(210,240,255,0.26)');
    ctx.fillStyle = glass;
    ctx.fillRect(lx, ty, rx - lx, by - ty);
    if (boardFlash > 0.01) {
      ctx.fillStyle = `rgba(255,255,255,${(boardFlash * 0.35).toFixed(3)})`;
      ctx.fillRect(lx, ty, rx - lx, by - ty);
    }
    ctx.shadowColor = fire ? '#ff6a00' : '#39ff14';
    ctx.shadowBlur = (fire ? 22 : 10) * (W / 480);
    ctx.strokeStyle = fire ? '#ffb347' : '#e8ffe8';
    ctx.lineWidth = Math.max(2, 0.05 * bs);
    ctx.strokeRect(lx, ty, rx - lx, by - ty);
    // shooter's square
    const [qx0, qy0] = proj(hx - 0.295, S.RIM_Y + 0.45, S.BOARD_Z);
    const [qx1, qy1] = proj(hx + 0.295, S.RIM_Y + 0.02, S.BOARD_Z);
    ctx.shadowColor = '#ff4d2a';
    ctx.strokeStyle = '#ff5a3a';
    ctx.lineWidth = Math.max(1.5, 0.035 * bs);
    ctx.strokeRect(qx0, qy0, qx1 - qx0, qy1 - qy0);
    ctx.restore();
    // bracket to the rim
    const [k0x, k0y] = proj(hx, S.RIM_Y - 0.02, S.BOARD_Z);
    const [k1x, k1y] = proj(hx, S.RIM_Y - 0.02, S.RIM_Z + S.RIM_R);
    ctx.strokeStyle = '#7a3a10';
    ctx.lineWidth = Math.max(2, 0.05 * bs);
    ctx.beginPath(); ctx.moveTo(k0x, k0y); ctx.lineTo(k1x, k1y); ctx.stroke();
  }

  function drawRimHalf(hx, front) {
    const shake = rimShake * 0.012 * Math.sin(performance.now() / 18);
    const pts = front ? ringPts(hx, S.RIM_Y + shake, S.RIM_Z, S.RIM_R, 20, Math.PI, Math.PI * 2)
      : ringPts(hx, S.RIM_Y + shake, S.RIM_Z, S.RIM_R, 20, 0, Math.PI);
    const [, , s] = proj(hx, S.RIM_Y, S.RIM_Z);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = front ? '#ff6a10' : '#b84a08';
    ctx.lineWidth = Math.max(2.5, S.TUBE * 2.4 * s);
    if (front) { ctx.shadowColor = '#ff6a10'; ctx.shadowBlur = 8 * (W / 480); }
    strokePts(pts);
    if (front) {
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,220,160,0.7)';
      ctx.lineWidth = Math.max(1, S.TUBE * 0.8 * s);
      strokePts(pts.map(([x, y]) => [x, y - S.TUBE * 0.8 * s]));
    }
    ctx.restore();
  }

  function drawNet(hx) {
    const n = 14;
    const drop = S.NET_DEPTH + netPulse * 0.14;
    const top = [];
    const mid = [];
    const bot = [];
    const sway = netSway;
    const rMid = 0.185 * (1 - netPulse * 0.2);
    const rBot = 0.13 * (1 - netPulse * 0.35);
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      top.push(proj(hx + Math.cos(a) * S.RIM_R, S.RIM_Y, S.RIM_Z + Math.sin(a) * S.RIM_R));
      mid.push(proj(hx + sway * 0.5 + Math.cos(a + 0.22) * rMid, S.RIM_Y - drop * 0.5, S.RIM_Z + Math.sin(a + 0.22) * rMid));
      bot.push(proj(hx + sway + Math.cos(a) * rBot, S.RIM_Y - drop, S.RIM_Z + Math.sin(a) * rBot));
    }
    const [, , s] = proj(hx, S.RIM_Y, S.RIM_Z);
    ctx.save();
    ctx.strokeStyle = 'rgba(240,255,240,0.78)';
    ctx.lineWidth = Math.max(1, 0.012 * s);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      ctx.moveTo(top[i][0], top[i][1]); ctx.lineTo(mid[i + 1][0], mid[i + 1][1]);
      ctx.moveTo(top[i + 1][0], top[i + 1][1]); ctx.lineTo(mid[i][0], mid[i][1]);
      ctx.moveTo(mid[i][0], mid[i][1]); ctx.lineTo(bot[i + 1][0], bot[i + 1][1]);
      ctx.moveTo(mid[i + 1][0], mid[i + 1][1]); ctx.lineTo(bot[i][0], bot[i][1]);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(240,255,240,0.55)';
    strokePts(mid);
    strokePts(bot);
    ctx.restore();
  }

  function ballAt(a, now) {
    const r = a.rec;
    const f = (now - a.startAt - r.at) / S.FRAME_MS;
    const n = r.frames.length;
    if (f < 0) return null;
    const i = Math.min(n - 1, Math.floor(f));
    const t = Math.min(1, f - i);
    const p = r.frames[i];
    const q = r.frames[Math.min(n - 1, i + 1)];
    return { f, x: p[0] + (q[0] - p[0]) * t, y: p[1] + (q[1] - p[1]) * t, z: p[2] + (q[2] - p[2]) * t, n };
  }

  function handleEvents(a, f, hx) {
    const r = a.rec;
    const mine = a.by === mySeat();
    r.events.forEach((ev, i) => {
      if (f < ev.f || a.fired.has(i)) return;
      if (ev.type === 'make' && a.local) return; // wait for the server's points
      a.fired.add(i);
      const vol = mine ? 1 : 0.7;
      if (ev.type === 'rim') { sfx.play('blip', { vol }); sfx.play('tick', { vol: vol * 0.7 }); rimShake = 1; }
      else if (ev.type === 'board') { sfx.play('move', { vol: vol * 0.8 }); boardFlash = 1; }
      else if (ev.type === 'floor') sfx.play('tick', { vol: 0.25 });
      else if (ev.type === 'make') {
        netPulse = 1;
        const [nx, ny] = proj(hx, S.RIM_Y - 0.25, S.RIM_Z);
        if (r.swish) { sfx.play('whoosh', { vol: 0.35 }); sfx.play('chime', { vol }); } else { sfx.play('pop', { vol }); sfx.play('point', { vol: vol * 0.8 }); }
        if (r.money) sfx.play('chips');
        const col = r.money ? '#ffd23f' : r.fire ? '#ff8a1c' : TEXT_COLOR[a.by];
        popup(nx, ny - 0.4 * F / 5, `+${r.points}`, col, r.mult > 1 ? 1.35 : 1.05);
        if (r.swish) popup(nx, ny - 0.75 * F / 5, 'SWISH', '#9fffe0', 0.75);
        else if (r.events.some((e) => e.type === 'board' && e.f < ev.f)) popup(nx, ny - 0.75 * F / 5, 'BANK', '#c8d8ff', 0.7);
        if (r.money) popup(nx, ny - 1.05 * F / 5, 'MONEY BALL x2', '#ffd23f', 0.7);
        burst(nx, ny, r.swish ? 26 : 16, r.fire ? ['#ffb000', '#ff4d00', '#ffe14d'] : r.money ? ['#ffd23f', '#ffffff', '#e0283c', '#2a6cf0'] : ['#39ff14', '#ffffff', TEXT_COLOR[a.by]],
          5 * (W / 480), true);
        if (r.runIdx === landed.runIdx) landed.streak = r.streak;
        if (r.streak === S.FIRE_AT) { callout('ON FIRE', '#ff7b1c'); sfx.play('kill'); }
        bumpScore(a.by);
      }
    });
    if (!r.made && f >= a.missF && !a.fired.has('miss')) {
      a.fired.add('miss');
      if (r.runIdx === landed.runIdx) {
        if (landed.streak >= S.FIRE_AT && !a.local) callout('FIRE OUT', '#9fb39c', true);
        landed.streak = 0;
      }
      if (!r.events.some((e) => e.type !== 'floor') && mine) {
        const [mx, my] = proj(hx, S.RIM_Y + 0.6, S.RIM_Z);
        popup(mx, my, 'AIRBALL', '#9fb39c', 0.8);
      }
    }
  }

  function bumpScore(color) {
    const el = side[color].score;
    if (reduced()) return;
    el.classList.remove('bump');
    void el.offsetWidth; // restart the animation
    el.classList.add('bump');
  }

  function frame(nowPerf) {
    raf = requestAnimationFrame(frame);
    if (!S || destroyed) return;
    const dt = Math.min(0.05, (nowPerf - lastFrame) / 1000);
    lastFrame = nowPerf;
    if (!resize()) return;
    const now = clock.now();
    const run = view && view.run;
    const seat = mySeat();

    // which run's hoop is on screen: the one the newest airborne ball was shot at, else the current
    let hoopRun = run ? { idx: run.idx, startAt: run.startAt, sched: run.sched } : null;
    const flying = anims.filter((a) => { const f = (now - a.startAt - a.rec.at) / S.FRAME_MS; return f < a.rec.frames.length; });
    if (flying.length) {
      const last = flying[flying.length - 1];
      const info = infoFor(last.runIdx);
      hoopRun = { idx: last.runIdx, startAt: info.startAt, sched: info.sched };
    }
    const target = hoopRun && view.phase !== 'waiting' ? S.hoopX(hoopRun.sched, now - hoopRun.startAt) : 0;
    if (flying.length || (run && view.phase === 'playing' && now >= run.startAt && now <= run.endAt)) dispHx = target;
    else dispHx += (target - dispHx) * Math.min(1, dt * 3);
    const hx = dispHx;
    const hoopV = (hx - lastHx) / Math.max(dt, 1e-3);
    lastHx = hx;
    netSway += ((-hoopV * 0.07) - netSway) * Math.min(1, dt * 6);
    netPulse *= Math.pow(0.04, dt);
    rimShake *= Math.pow(0.01, dt);
    boardFlash *= Math.pow(0.02, dt);

    const onFire = !!(run && view.phase === 'playing' && landed.runIdx === run.idx && landed.streak >= S.FIRE_AT);

    // ---- scene ----
    ctx.drawImage(bg, 0, 0);

    // collect balls
    const balls = [];
    for (const a of anims) {
      const b = ballAt(a, now);
      if (!b) continue;
      handleEvents(a, b.f, hx);
      const fade = Math.max(0, Math.min(1, (b.n + 8 - b.f) / 14));
      balls.push({ ...b, a, alpha: fade });
    }
    anims = anims.filter((a) => {
      const f = (now - a.startAt - a.rec.at) / S.FRAME_MS;
      if (a.local && f > a.rec.frames.length + 300) { localQueue = localQueue.filter((x) => x !== a); return false; } // server never answered
      return a.local || f < a.rec.frames.length + 10 || (a.rec.made && !a.fired.has(a.rec.events.findIndex((e) => e.type === 'make')));
    });

    // floor shadows
    for (const b of balls) shadow(b.x, b.z, b.y, b.alpha);
    { const [sx, sy, s] = proj(hx, 0, S.RIM_Z); ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(sx, sy, S.RIM_R * 1.3 * s, S.RIM_R * 0.35 * s, 0, 0, Math.PI * 2); ctx.fill(); }

    // painter's order: far balls, board, balls between board and rim, back rim, balls in the ring,
    // net + front rim, near balls
    balls.sort((p, q) => q.z - p.z);
    const drawB = (b) => {
      const [sx, sy, s] = proj(b.x, b.y, b.z);
      const spin = -b.f * 0.2;
      drawBall(sx, sy, S.BALL_R * s, spin, b.a.rec.money, b.alpha, b.a.rec.fire);
      if (b.a.rec.fire && !reduced() && b.f < b.n && Math.random() < 0.8) {
        parts.push({ x: sx + (Math.random() - 0.5) * S.BALL_R * s, y: sy + (Math.random() - 0.5) * S.BALL_R * s, vx: (Math.random() - 0.5) * 0.6, vy: -0.6 - Math.random(),
          life: 1, max: 0.35 + Math.random() * 0.3, color: Math.random() < 0.5 ? '#ff7b1c' : '#ffd23f', r: S.BALL_R * s * (0.25 + Math.random() * 0.3), g: 1, grav: -0.5 });
      }
    };
    let bi = 0;
    while (bi < balls.length && balls[bi].z > S.BOARD_Z) drawB(balls[bi++]);
    drawBoardAndPole(hx, onFire);
    while (bi < balls.length && balls[bi].z > S.RIM_Z + S.RIM_R * 0.6) drawB(balls[bi++]);
    drawRimHalf(hx, false);
    while (bi < balls.length && balls[bi].z > S.RIM_Z - S.RIM_R * 0.6) drawB(balls[bi++]);
    drawNet(hx);
    drawRimHalf(hx, true);
    while (bi < balls.length) drawB(balls[bi++]);

    // ball in hand / rack
    const shooting = run && view.phase === 'playing' && now <= run.endAt;
    if (run && shooting) {
      const mineRun = seat && run.shooter === seat;
      const lastAt = mineRun && local.runIdx === run.idx ? local.lastAt : run.lastAt;
      const ballNo = mineRun && local.runIdx === run.idx ? local.ballNo : run.ballNo;
      const t = now - run.startAt;
      const k = Math.max(0, Math.min(1, (t - lastAt) / S.COOLDOWN_MS));
      // the rack (bottom-right): balls left in this set of five
      const used = ballNo % S.MONEY_EVERY;
      const rr = H * 0.022;
      const rackX = W - rr * 2.6 * S.MONEY_EVERY - W * 0.03;
      const rackY = H - rr * 1.8;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.strokeStyle = 'rgba(57,255,20,0.45)';
      ctx.lineWidth = Math.max(1, W / 480);
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(rackX - rr * 1.4, rackY - rr * 1.4, rr * 2.6 * S.MONEY_EVERY + rr * 0.2, rr * 2.8, rr) : ctx.rect(rackX - rr * 1.4, rackY - rr * 1.4, rr * 2.6 * S.MONEY_EVERY + rr * 0.2, rr * 2.8);
      ctx.fill(); ctx.stroke();
      for (let i = 0; i < S.MONEY_EVERY; i++) {
        const cx = rackX + i * rr * 2.6;
        if (i < used + (k < 1 ? 0 : 1) && !(i === used && k < 1)) {
          ctx.strokeStyle = 'rgba(57,255,20,0.25)';
          ctx.beginPath(); ctx.arc(cx, rackY, rr * 0.8, 0, Math.PI * 2); ctx.stroke();
        } else drawBall(cx, rackY, rr, 0.6, i === S.MONEY_EVERY - 1, 1, false);
      }
      // the next ball rolls from the rack into the hand
      if (t >= 0 || t > -3000) {
        const dragging = drag && mineRun;
        const p = dragging ? drag.power : 0;
        const ax = dragging ? drag.aim * 0.06 : 0;
        let [hxs, hys, hs] = proj(S.LAUNCH.x + ax, S.LAUNCH.y - p * 0.08 + Math.sin(nowPerf / 300) * 0.006, S.LAUNCH.z - p * 0.05);
        let rad = S.BALL_R * hs;
        if (k < 1) {
          const e = 1 - Math.pow(1 - k, 3);
          const fx = rackX + used * rr * 2.6;
          hxs = fx + (hxs - fx) * e;
          hys = rackY + (hys - rackY) * e - Math.sin(e * Math.PI) * H * 0.05;
          rad = rr + (rad - rr) * e;
        }
        if (t <= run.length) {
          const fireNext = run.streak >= S.FIRE_AT;
          drawBall(hxs, hys, rad, k < 1 ? k * 6 : nowPerf / 2400, S.isMoneyBall(ballNo), t < 0 ? 0.6 : 1, fireNext);
          if (S.isMoneyBall(ballNo) && k >= 1) {
            ctx.fillStyle = '#ffd23f';
            ctx.font = `bold ${Math.round(H * 0.022)}px monospace`;
            ctx.textAlign = 'center';
            ctx.fillText('MONEY BALL', hxs, hys - rad - H * 0.015);
          }
        }
      }
      // aim preview: the start of the arc
      if (drag && mineRun && drag.power >= 0.06) {
        const v = S.launchVelocity(S.normInput({ aim: drag.aim, power: drag.power }));
        ctx.fillStyle = 'rgba(57,255,20,0.9)';
        for (let i = 1; i <= 8; i++) {
          const tt = 0.045 * i;
          const [dx, dy, ds] = proj(S.LAUNCH.x + v.x * tt, S.LAUNCH.y + v.y * tt - 0.5 * S.G * tt * tt, S.LAUNCH.z + v.z * tt);
          ctx.globalAlpha = 0.85 * (1 - i / 9);
          ctx.beginPath(); ctx.arc(dx, dy, Math.max(1.5, 0.025 * ds), 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    }

    // particles
    ctx.save();
    for (const p of parts) {
      p.life -= dt / p.max;
      p.vy += 0.25 * p.grav * (W / 480) * dt * 60;
      p.x += p.vx * dt * 60;
      p.y += p.vy * dt * 60;
      if (p.life <= 0) continue;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.globalCompositeOperation = p.g ? 'lighter' : 'source-over';
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.4 + 0.6 * p.life), 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    parts = parts.filter((p) => p.life > 0);

    // popups
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    popups = popups.filter((p) => nowPerf - p.born < 1100);
    for (const p of popups) {
      const age = (nowPerf - p.born) / 1100;
      const sc = age < 0.15 ? 0.6 + (age / 0.15) * 0.5 : 1.1 - Math.min(0.1, (age - 0.15));
      ctx.globalAlpha = age < 0.7 ? 1 : 1 - (age - 0.7) / 0.3;
      ctx.font = `bold ${Math.round(H * 0.05 * p.size * sc)}px monospace`;
      ctx.lineWidth = Math.max(2, H * 0.006);
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      const y = p.y - age * H * 0.06;
      ctx.strokeText(p.text, p.x, y);
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 12 * (W / 480);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, y);
      ctx.shadowBlur = 0;
    }
    ctx.restore();

    // level-up callouts (when the hoop actually starts moving)
    levelCallouts = levelCallouts.filter((l) => {
      if (now < l.wall) return true;
      if (now - l.wall < 1500) {
        callout(l.level === 1 ? 'HOOP IS MOVING' : 'FASTER', '#3ad7ff');
        sfx.play('slide');
      }
      return false;
    });

    // countdown / buzzer overlays + sounds
    if (run && view.phase === 'playing') {
      const t = now - run.startAt;
      if (t < 0) {
        const sec = Math.ceil(-t / 1000);
        if (sec !== lastCount && sec <= 3) { lastCount = sec; sfx.play('beep'); }
        bigText(sec <= 3 ? String(sec) : '', TEXT_COLOR[run.shooter], 1 - ((-t % 1000) / 1000));
        const who = run.shooter === seat ? 'YOUR RUN' : `${nicknameFor(view.players[run.shooter], run.shooter) || run.shooter.toUpperCase()}`;
        subText(run.ot ? `SUDDEN DEATH · ${who}` : who, TEXT_COLOR[run.shooter]);
        if (run.idx % 2 === 1) {
          const prev = view.runs[view.runs.length - 1];
          if (prev) subText(`SCORE TO BEAT: ${view.scores[prev.shooter] - view.scores[run.shooter]}`, '#ffd23f', 1);
        }
      } else {
        if (lastCount !== 0 && lastCount !== null && t < 1200) { lastCount = 0; sfx.play('go'); callout('GO', '#39ff14'); }
        if (t < 0 || t > 1500) lastCount = null;
        const left = run.endAt - now;
        const sec = Math.ceil(left / 1000);
        if (left > 0 && sec <= 5 && sec !== lastTickSec) { lastTickSec = sec; sfx.play('tick', { vol: 0.8 }); }
        if (left <= 0 && buzzed !== run.idx + view.gameId * 1000) {
          buzzed = run.idx + view.gameId * 1000;
          if (left > -800) { sfx.play('error'); setTimeout(() => sfx.play('error'), 160); }
        }
        if (left <= 0) {
          bigText('TIME', '#ffb000', 1);
          subText(`${(nicknameFor(view.players[run.shooter], run.shooter) || run.shooter).toUpperCase()} · ${run.makes}/${run.shots} MADE`, TEXT_COLOR[run.shooter]);
        }
      }
    }
    if (!run && view && view.phase === 'waiting') {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(200,255,190,0.75)';
      ctx.font = `bold ${Math.round(H * 0.034)}px monospace`;
      ctx.fillText('TAKE A SEAT TO PLAY', W / 2, H * 0.62);
      ctx.restore();
    }

    patchHud(now);
    const ct = canShoot();
    if (stage.classList.contains('can-shoot') !== ct) stage.classList.toggle('can-shoot', ct);
  }

  function bigText(text, color, pulse) {
    if (!text) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const s = 1 + 0.25 * Math.max(0, pulse - 0.6);
    ctx.font = `bold ${Math.round(H * 0.16 * s)}px monospace`;
    ctx.lineWidth = H * 0.008;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeText(text, W / 2, H * 0.47);
    ctx.shadowColor = color;
    ctx.shadowBlur = 24 * (W / 480);
    ctx.fillStyle = color;
    ctx.fillText(text, W / 2, H * 0.47);
    ctx.restore();
  }
  function subText(text, color, line = 0) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `bold ${Math.round(H * 0.034)}px monospace`;
    ctx.lineWidth = H * 0.006;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    const y = H * (0.6 + line * 0.05);
    ctx.strokeText(text, W / 2, y);
    ctx.fillStyle = color;
    ctx.fillText(text, W / 2, y);
    ctx.restore();
  }

  // ---- HUD + DOM (patched in place, never rebuilt under the pointer) ----
  const setText = (el, t) => { if (el.textContent !== t) el.textContent = t; };
  function patchHud(now) {
    if (!view) return;
    const run = view.run;
    const playing = view.phase === 'playing';
    for (const c of COLORS) {
      const sd = side[c];
      sd.box.style.visibility = view.solo && !view.players[c] ? 'hidden' : ''; // a solo run shows one side
      setText(sd.name, `${nicknameFor(view.players[c], c) || c.toUpperCase()}${view.players[c] && view.players[c] === api.getClientId() ? ' (you)' : ''}`);
      const shown = Math.max(0, (view.scores[c] || 0) - pendingPoints(c));
      setText(sd.score, String(shown));
      const active = !!(playing && run && run.shooter === c);
      sd.box.classList.toggle('active', active);
      let tag = '';
      let fire = false;
      if (active && now >= run.startAt) {
        if (landed.runIdx === run.idx && landed.streak >= S.FIRE_AT) { tag = 'ON FIRE x2'; fire = true; }
        else if (landed.runIdx === run.idx && landed.streak > 0) tag = `STREAK ${landed.streak}`;
      } else if (view.runs.length) {
        const mine = view.runs.filter((r) => r.shooter === c);
        if (mine.length) tag = `${mine.reduce((s, r) => s + r.makes, 0)}/${mine.reduce((s, r) => s + r.shots, 0)} MADE`;
      }
      setText(sd.tag, tag);
      sd.tag.classList.toggle('fire', fire);
    }
    let clockText = '0:30';
    let low = false;
    if (run && playing) {
      const left = now < run.startAt ? run.length : run.endAt - now;
      clockText = fmtClock(left);
      low = now >= run.startAt && left <= 5000 && left > 0;
      setText(periodEl, run.ot ? `OVERTIME ${view.otRound}` : view.solo ? 'SOLO RUN' : `RUN ${run.idx + 1} / 2`);
    } else {
      clockText = view.phase === 'game_over' ? 'FINAL' : fmtClock(S.RUN_MS);
      setText(periodEl, view.phase === 'game_over' ? (view.otRound ? `AFTER ${view.otRound} OT` : 'FULL TIME') : 'SHOOTOUT');
    }
    setText(clockEl, clockText);
    clockEl.classList.toggle('low', low);
    const ct = canShoot();
    setText(hint, ct && run && run.shots === 0 && !anims.length ? 'FLICK UP TO SHOOT' : '');
    // status line
    const seat = mySeat();
    let st = '';
    let mine = false;
    let color = '';
    if (view.phase === 'waiting') st = seat ? 'SHOOT SOLO for a high score, or wait for an opponent / play a bot.' : 'Waiting for both seats. PLAY VS BOT to practise.';
    else if (view.phase === 'game_over') {
      if (anims.length) { st = 'FINAL BUZZER…'; }
      else if (view.solo) { st = `TIME! ${view.scores[view.winner]} POINTS`; color = '#ffb000'; }
      else if (view.winner === 'draw') { st = `DRAW ${view.scores.red}–${view.scores.blue}`; color = '#7fd7ff'; }
      else { st = `${view.winner.toUpperCase()} WINS ${Math.max(view.scores.red, view.scores.blue)}–${Math.min(view.scores.red, view.scores.blue)}`; color = '#ffb000'; }
    } else if (run) {
      const who = nicknameFor(view.players[run.shooter], run.shooter);
      const t = now - run.startAt;
      if (t < 0) {
        if (run.shooter === seat) { st = `▶ GET READY. YOUR ${run.ot ? 'OVERTIME ' : ''}RUN STARTS IN ${Math.ceil(-t / 1000)}`; mine = true; }
        else { st = `${run.shooter.toUpperCase()} SHOOTS NEXT. ${who}`; color = TEXT_COLOR[run.shooter]; }
      } else if (now <= run.endAt) {
        if (run.shooter === seat) { st = '▶ YOUR TURN. FLICK UP TO SHOOT'; mine = true; }
        else { st = `${run.shooter.toUpperCase()} SHOOTING. ${who}`; color = TEXT_COLOR[run.shooter]; }
      } else {
        st = `TIME! ${run.shooter.toUpperCase()} SCORED ${run.score}`;
        color = TEXT_COLOR[run.shooter];
      }
    }
    setText(status, st);
    status.classList.toggle('mine', mine);
    if (status.style.color !== color) status.style.color = color;
    const over = view.phase === 'game_over' && !anims.length;
    if (over !== lastOver) { lastOver = over; renderDom(); }
  }
  let lastOver = false;

  function seatBox(color) {
    const box = document.createElement('div');
    const run = view.run;
    box.className = `bb-seat${view.phase === 'playing' && run && run.shooter === color ? ' turn' : ''}`;
    const chip = document.createElement('span');
    chip.className = `bb-chip ${color}`;
    const name = document.createElement('span');
    const occ = view.players[color];
    name.textContent = `${color.toUpperCase()}: ${occ === 'BOT' ? '(bot)' : nicknameFor(occ, color) || '(empty)'}${occ && occ === api.getClientId() ? ' (you)' : ''}`;
    name.style.color = TEXT_COLOR[color];
    box.append(chip, name);
    const seat = mySeat();
    if (!occ && view.solo && view.phase !== 'waiting') {
      name.textContent = `${color.toUpperCase()}: (solo run)`;
    } else if (!occ) {
      if (seat && view.phase !== 'playing') {
        const solo = document.createElement('button');
        solo.textContent = 'SHOOT SOLO';
        solo.title = 'One 30-second run on your own: chase your high score';
        solo.addEventListener('click', () => api.sendAction({ kind: 'startSolo' }));
        box.appendChild(solo);
      }
      if (!seat) {
        const btn = document.createElement('button');
        btn.textContent = `PLAY ${color.toUpperCase()}`;
        btn.addEventListener('click', () => api.sendAction({ kind: 'sit', seat: color }));
        box.appendChild(btn);
      }
      const bot = document.createElement('button');
      bot.textContent = 'PLAY VS BOT';
      let level = preferredLevel();
      const sel = levelSelect(level, (l) => { level = l; });
      bot.addEventListener('click', () => api.sendAction({ kind: 'sit', seat: color, bot: true, level }));
      box.append(bot, sel);
    } else if (occ === 'BOT') {
      box.appendChild(levelSelect((view.botLevels || {})[color], (level) => api.sendAction({ kind: 'setBotLevel', seat: color, level })));
      const rm = document.createElement('button');
      rm.textContent = 'REMOVE BOT';
      rm.addEventListener('click', () => api.sendAction({ kind: 'removeBot', seat: color }));
      box.appendChild(rm);
    }
    return box;
  }

  let domSig = '';
  function renderDom() {
    if (destroyed) return;
    const seat = mySeat();
    const over = !!(view && view.phase === 'game_over' && !anims.length);
    if (view) {
      const subtitle = view.runs.length
        ? COLORS.filter((c) => !view.solo || view.players[c]).map((c) => {
          const rs = view.runs.filter((r) => r.shooter === c);
          return `${c.toUpperCase()} ${rs.reduce((s, r) => s + r.makes, 0)}/${rs.reduce((s, r) => s + r.shots, 0)}`;
        }).join(' · ') + ' made'
        : '';
      const w = view.winner;
      const res = over && view.solo ? {
        title: `${view.scores[w]} POINTS`,
        subtitle: `SOLO · ${subtitle}`,
        outcome: 'win',
        rows: [{ name: nicknameFor(view.players[w], w), value: `${view.scores[w]} PTS`, win: true, you: w === seat }],
        rematch: seat ? { label: 'SHOOT AGAIN', onClick: () => api.sendAction({ kind: 'resetGame' }) } : null,
      } : over ? duelResults({
        winner: view.winner, colors: COLORS, players: view.players, me: seat, nameFor: (id) => nicknameFor(id, COLORS.find((c) => view.players[c] === id)),
        subtitle, onRematch: () => api.sendAction({ kind: 'resetGame' }),
      }) : null;
      if (res) {
        for (const r of res.rows) {
          const c = COLORS.find((k) => r.value === k.toUpperCase());
          if (c) r.value = `${view.scores[c]} PTS`;
        }
      }
      results.update(res);
    }
    if (!view) { setText(status, 'Loading...'); return; }
    err.textContent = flashError ? REJECT_MESSAGES[flashError] || 'Shot rejected' : '';
    // seats + options: rebuild only when something they show changes
    const sig = JSON.stringify([view.players, view.botLevels, view.phase, view.solo, view.run && view.run.shooter, seat, over,
      COLORS.map((c) => nicknameFor(view.players[c], c))]);
    if (sig === domSig) return;
    domSig = sig;
    seats.innerHTML = '';
    seats.append(seatBox('red'), seatBox('blue'));
    if (seat) {
      const leave = document.createElement('button');
      leave.textContent = 'LEAVE SEAT';
      leave.addEventListener('click', () => api.sendAction({ kind: 'leaveSeat' }));
      seats.appendChild(leave);
    }
    options.innerHTML = '';
    if (over && seat) {
      const again = document.createElement('button');
      again.textContent = view.solo ? 'SHOOT AGAIN' : 'REMATCH (SWAP SIDES)';
      again.addEventListener('click', () => api.sendAction({ kind: 'resetGame' }));
      options.appendChild(again);
    }
  }

  // ---- state ----
  function applyState(data, fromSnapshot) {
    const prev = view;
    view = data;
    clock.sync(data.serverNow);
    if (data.run) runInfo.set(data.run.idx, { startAt: data.run.startAt, sched: data.run.sched });
    const fresh = fromSnapshot || !prev || prev.gameId !== data.gameId;
    if (fresh) {
      anims = [];
      localQueue = [];
      levelCallouts = [];
      runInfo.clear();
      if (data.run) runInfo.set(data.run.idx, { startAt: data.run.startAt, sched: data.run.sched });
      local = { runIdx: -1, lastAt: -1e9, ballNo: 0 };
      landed = { runIdx: data.run ? data.run.idx : -1, streak: data.run ? data.run.streak : 0 };
      lastSeq = data.lastShot ? data.lastShot.seq - 1 : 0;
      if (prev && prev.phase !== 'playing' && data.phase === 'playing') sfx.play('go');
    }
    if (data.run && landed.runIdx !== data.run.idx) landed = { runIdx: data.run.idx, streak: 0 };
    if (S) {
      syncLocal();
      if (data.lastShot && data.lastShot.seq > lastSeq) onNewShot(data.lastShot);
    }
    if (prev && prev.phase === 'playing' && data.phase === 'game_over') {
      const seat = mySeat();
      const last = anims.reduce((m, a) => Math.max(m, landTime(a)), clock.now());
      setTimeout(() => sfx.play(!seat ? 'point' : data.winner === 'draw' ? 'point' : data.winner === seat ? 'win' : 'lose'), Math.max(0, last - clock.now()) + 300);
    }
    if (prev && prev.phase === 'waiting' && data.phase === 'waiting') { /* seat change */ }
    flashError = null;
    renderDom();
  }

  // ---- boot ----
  loadScript('games/basketball/sim.js', 'BasketballSim')
    .then((Sim) => {
      if (destroyed) return;
      S = Sim;
      if (view) {
        syncLocal();
        if (view.lastShot && view.lastShot.seq > lastSeq) onNewShot(view.lastShot);
      }
      raf = requestAnimationFrame(frame);
      renderDom();
    })
    .catch(() => {
      stage.innerHTML = '<div class="bb-fail">Could not load the game physics.</div>';
    });

  renderDom();

  return {
    applySnapshot(snapshot) {
      applyState(snapshot, true);
    },
    applyEvent(data) {
      if (!data) return;
      if (data.kind === 'state') applyState(data, false);
      else if (data.kind === 'moveRejected') {
        // a rejected shot: drop its local preview and resync the ball clock
        const a = localQueue.shift();
        if (a) anims = anims.filter((x) => x !== a);
        if (!localQueue.length && view && view.run && local.runIdx === view.run.idx) {
          local.lastAt = view.run.lastAt;
          local.ballNo = view.run.ballNo;
        }
        flashError = data.reason || 'invalid';
        sfx.play('error');
        clearTimeout(flashTimer);
        flashTimer = setTimeout(() => { flashError = null; renderDom(); }, 2000);
        renderDom();
      }
    },
    applyRoster(newRoster) {
      roster = newRoster;
      renderDom();
    },
    unmount() {
      destroyed = true;
      cancelAnimationFrame(raf);
      clearTimeout(flashTimer);
      results.destroy();
      container.innerHTML = '';
    },
  };
}
