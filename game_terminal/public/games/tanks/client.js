// Tanks client. 2D canvas side view of the hillside; the shared physics (sim.js) is loaded as a
// plain script. On your turn: drag/tap anywhere on the battlefield to point the barrel (direction =
// angle, distance from your tank = power), fine-tune with the − / + buttons or the arrow keys,
// hold ◀ / ▶ (or A / D) to drive with this turn's fuel, pick a weapon (1-4) and FIRE (Space).
// The server simulates the shot; every viewer replays its frames, carving the craters with the
// same sim code as each blast lands, then the tanks drop onto the new ground.
//
// The canvas is redrawn every frame; the control panel is built once and patched in place (never
// re-rendered under the pointer), and only the seat row is rebuilt, on state changes.

import { sfx } from '../sfx.js';
import { preferredLevel, levelSelect, levelLabel } from '../botLevel.js';
import { createResults, duelResults } from '../resultsPanel.js';
import { makeServerClock } from '../serverClock.js';
import { createFx } from '../canvasFx.js';

const COLORS = ['red', 'blue'];
const TEAM = {
  red: { body: '#e0353f', light: '#ff7a7f', dark: '#7a1218', text: '#ff5a6a' },
  blue: { body: '#2f74f0', light: '#7fb0ff', dark: '#12306e', text: '#5aa0ff' },
};
const SHELL_COLOR = { shell: '#ffe14d', big: '#ff7b39', triple: '#4dd2ff', bouncer: '#ff4dd2' };
const WEAPON_ICON = { shell: '●', big: '⬤', triple: '⁂', bouncer: '◎' };
const SETTLE_FRAMES = 36;
const FALL_DMG_FRAME = 12; // frames after the last blast when fall damage pops
const DRIVE_SPEED = 42; // units/s while holding drive
const DRIVE_FLUSH_MS = 90;
const AIM_SEND_MS = 110;

const REJECT_MESSAGES = {
  not_your_turn: "It's not your turn.",
  busy: 'Wait for the smoke to clear.',
  not_playing: 'The game is not running.',
  invalid: 'Invalid shot.',
  no_ammo: 'Out of that ammo.',
};

const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function loadSim() {
  if (window.TanksSim) return Promise.resolve(window.TanksSim);
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = 'games/tanks/sim.js';
    el.onload = () => resolve(window.TanksSim);
    el.onerror = () => reject(new Error('Failed to load tanks sim'));
    document.head.appendChild(el);
  });
}

const CSS = `
.tk-root { display: flex; flex-direction: column; align-items: center; gap: 8px; font-family: monospace; color: #b8ffb0; width: 100%; }
.tk-status { font-size: 16px; font-weight: bold; letter-spacing: 1px; text-align: center; min-height: 20px; padding: 4px 12px; border-radius: 6px; border: 2px solid transparent; }
.tk-status.mine { color: #39ff14; background: rgba(57,255,20,.12); border-color: #39ff14; text-shadow: 0 0 8px #39ff14; }
.tk-err { color: #ff5a5a; font-size: 12px; min-height: 14px; }
.tk-seats { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; align-items: center; }
.tk-seat { display: flex; align-items: center; gap: 6px; padding: 5px 8px; border: 1px solid #1d5c1d; border-radius: 6px; background: #071107; font-size: 13px; }
.tk-seat.turn { border-color: #39ff14; box-shadow: 0 0 10px -2px #39ff14; }
.tk-seat button { font: inherit; font-size: 12px; }
.tk-chip { width: 14px; height: 9px; border-radius: 3px 3px 1px 1px; display: inline-block; }
.tk-stage { position: relative; width: 100%; max-width: 980px; border: 1px solid #1d5c1d; border-radius: 10px; overflow: hidden; background: #020a10;
  touch-action: none; user-select: none; -webkit-user-select: none; }
.tk-stage canvas { display: block; }
.tk-stage.can-aim canvas { cursor: crosshair; }
.tk-callout { position: absolute; left: 50%; top: 40%; transform: translate(-50%, -50%); font-size: 30px; font-weight: bold; letter-spacing: 3px; white-space: nowrap; pointer-events: none;
  text-shadow: 0 0 14px currentColor, 0 2px 3px #000; animation: tk-call 1.5s cubic-bezier(.2,1.4,.4,1) forwards; }
.tk-callout.small { font-size: 18px; top: 52%; }
@keyframes tk-call { 0% { opacity: 0; transform: translate(-50%, -50%) scale(.4); } 15% { opacity: 1; transform: translate(-50%, -50%) scale(1.08); }
  25% { transform: translate(-50%, -50%) scale(1); } 80% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -70%) scale(1); } }
.tk-ctrl { display: flex; flex-direction: column; gap: 8px; align-items: center; width: 100%; max-width: 980px; }
.tk-ctrl.off { opacity: .45; }
.tk-row { display: flex; gap: 10px; align-items: center; justify-content: center; flex-wrap: wrap; }
.tk-weap { display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; }
.tk-weap button { font: inherit; font-size: 13px; padding: 6px 10px; border-radius: 6px; background: #071107; color: #b8ffb0; border: 1px solid #1d5c1d; cursor: pointer; display: flex; gap: 6px; align-items: center; }
.tk-weap button .ic { font-size: 15px; }
.tk-weap button .am { font-size: 11px; opacity: .75; padding: 1px 5px; border-radius: 8px; background: rgba(57,255,20,.12); }
.tk-weap button.on { border-color: var(--c); color: var(--c); box-shadow: 0 0 10px -2px var(--c); background: #0b180b; }
.tk-weap button:disabled { opacity: .35; cursor: default; }
.tk-group { display: flex; align-items: center; gap: 4px; padding: 4px 6px; border: 1px solid #1d5c1d; border-radius: 6px; background: #050d05; }
.tk-group .lab { font-size: 11px; opacity: .7; letter-spacing: 1px; margin-right: 2px; }
.tk-group .val { min-width: 40px; text-align: center; font-size: 17px; font-weight: bold; color: #e8ffe0; font-variant-numeric: tabular-nums; }
.tk-group button { font: inherit; font-size: 15px; width: 34px; height: 32px; border-radius: 5px; background: #0b1a0b; color: #39ff14; border: 1px solid #2a7a1a; cursor: pointer; touch-action: none; }
.tk-group button:disabled { opacity: .35; cursor: default; }
.tk-fuel { width: 80px; height: 10px; border: 1px solid #2a7a1a; border-radius: 5px; overflow: hidden; background: #020602; position: relative; }
.tk-fuel > i { position: absolute; left: 0; top: 0; bottom: 0; background: linear-gradient(90deg, #ffb000, #39ff14); }
.tk-fire { font: inherit; font-size: 18px; font-weight: bold; letter-spacing: 2px; padding: 8px 22px; border-radius: 8px; cursor: pointer;
  background: #ff3b2f; color: #fff; border: 2px solid #ff8a7f; box-shadow: 0 0 16px -2px #ff3b2f; }
.tk-fire:not(:disabled) { animation: tk-pulse 1.3s ease-in-out infinite; }
.tk-fire:disabled { background: #2a1210; color: #8a6a66; border-color: #4a2a26; box-shadow: none; cursor: default; }
@keyframes tk-pulse { 50% { box-shadow: 0 0 26px 2px #ff3b2f; } }
.tk-help { font-size: 11px; opacity: .7; text-align: center; max-width: 640px; }
.tk-fail { padding: 30px; text-align: center; color: #ff8080; }
@media (prefers-reduced-motion: reduce) { .tk-callout, .tk-fire:not(:disabled) { animation: none; } }
`;
let styled = false;
function ensureStyles() {
  if (styled) return;
  styled = true;
  const tag = document.createElement('style');
  tag.textContent = CSS;
  document.head.appendChild(tag);
}

function hpColor(f) {
  return f > 0.6 ? '#39ff14' : f > 0.3 ? '#ffd23f' : '#ff4d4d';
}

export function mount(container, api) {
  ensureStyles();
  let S = null;
  let view = null;
  let roster = [];
  let flashError = null;
  let flashTimer = null;
  let destroyed = false;
  let raf = 0;
  const clock = makeServerClock();
  const fx = createFx();

  // ---- DOM skeleton (persistent) ----
  const root = document.createElement('div');
  root.className = 'tk-root';
  container.appendChild(root);
  const results = createResults(container);
  const status = document.createElement('div');
  status.className = 'tk-status';
  const err = document.createElement('div');
  err.className = 'tk-err';
  const seats = document.createElement('div');
  seats.className = 'tk-seats';
  const stage = document.createElement('div');
  stage.className = 'tk-stage';
  const canvas = document.createElement('canvas');
  stage.appendChild(canvas);

  const ctrl = document.createElement('div');
  ctrl.className = 'tk-ctrl';
  const weapRow = document.createElement('div');
  weapRow.className = 'tk-weap';
  const mainRow = document.createElement('div');
  mainRow.className = 'tk-row';
  ctrl.append(weapRow, mainRow);
  const help = document.createElement('div');
  help.className = 'tk-help';
  help.textContent = 'Tap or drag on the battlefield to aim (direction = angle, distance = power) · ← → angle · ↑ ↓ power · hold A / D or ◀ ▶ to drive · 1-4 weapon · SPACE fires. Mind the wind!';
  root.append(status, err, seats, stage, ctrl, help);

  // ---- local state ----
  let cw = 0; let ch = 0; let k = 1; let dpr = 1;
  let ctx = null;
  const bg = document.createElement('canvas');
  let bgKey = '';
  const terrCv = document.createElement('canvas');
  let dispTerrain = null;
  let terrainDirty = true;
  const disp = {
    red: { x: 0, y: 0, vy: 0, angle: 45, hp: 100, recoil: 0, dead: false },
    blue: { x: 0, y: 0, vy: 0, angle: 135, hp: 100, recoil: 0, dead: false },
  };
  let dispWind = 0;
  const queue = [];
  let anim = null; // { rec, start, fired: Set, fallDone, endCalled }
  let lastSeqSeen = 0;
  const booms = []; // { x, y, r, t0, color }
  // own turn
  let myAim = null; // { angle, power, weapon }
  let local = null; // { x, fuel } predicted own tank while driving
  let turnKey = '';
  let holdDir = 0;
  let driveAcc = 0;
  let pendingSteps = 0;
  let pendingDir = 0;
  let driveSeq = 0;
  let lastAck = 0;
  let lastFlush = 0;
  let lastDriveSfx = 0;
  let blockedSfx = false;
  let aimTimer = null;
  let firePending = false;
  let fireTimer = null;
  let drag = null;
  let pendingWinSfx = false;
  let lastT = performance.now();

  // ---- helpers ----
  function nicknameFor(id) {
    if (!id) return null;
    if (id === 'BOT') return '(bot)';
    const e = roster.find((r) => r.clientId === id);
    return e ? e.nickname : 'someone';
  }
  function seatName(seat) {
    if (!view) return seat.toUpperCase();
    const id = view.players[seat];
    if (id === 'BOT') return `Bot (${levelLabel((view.botLevels || {})[seat])})`;
    return nicknameFor(id) || seat.toUpperCase();
  }
  function mySeat() {
    if (!view) return null;
    const me = api.getClientId();
    return view.players.red === me ? 'red' : view.players.blue === me ? 'blue' : null;
  }
  const busy = () => !!(anim || queue.length);
  function myTurnIdle() {
    const seat = mySeat();
    return !!(S && view && seat && view.phase === 'playing' && view.turn === seat && !busy() && !firePending
      && clock.now() >= view.busyUntil - 150);
  }
  const sx = (x) => x * k;
  const sy = (y) => (S.H - y) * k;

  function callout(text, color, small) {
    if (reduced() && small) return;
    const el = document.createElement('div');
    el.className = `tk-callout${small ? ' small' : ''}`;
    el.style.color = color || '#39ff14';
    el.textContent = text;
    stage.appendChild(el);
    setTimeout(() => el.remove(), 1600);
  }

  // ---- sizing ----
  function resize() {
    if (!S) return;
    const w = Math.max(280, Math.min(980, stage.clientWidth || container.clientWidth || 800));
    const h = Math.round((w * S.H) / S.W);
    const d = Math.min(2.5, window.devicePixelRatio || 1);
    if (w === cw && d === dpr && ctx) return;
    cw = w; ch = h; dpr = d; k = w / S.W;
    canvas.width = Math.round(w * d);
    canvas.height = Math.round(h * d);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx = canvas.getContext('2d');
    for (const c of [bg, terrCv]) { c.width = canvas.width; c.height = canvas.height; }
    bgKey = '';
    terrainDirty = true;
  }

  // ---- background (sky, stars, far ridges) cached per game ----
  function paintBg() {
    const key = `${view ? view.gameId : 0}:${cw}:${dpr}`;
    if (key === bgKey) return;
    bgKey = key;
    const g = bg.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sky = g.createLinearGradient(0, 0, 0, ch);
    sky.addColorStop(0, '#01040a');
    sky.addColorStop(0.55, '#06172a');
    sky.addColorStop(1, '#0c2a2e');
    g.fillStyle = sky;
    g.fillRect(0, 0, cw, ch);
    const rand = S.mulberry(((view ? view.gameId : 1) * 7919) >>> 0);
    for (let i = 0; i < 110; i++) {
      const x = rand() * cw;
      const y = rand() * ch * 0.7;
      const r = rand() < 0.1 ? 1.4 : 0.7;
      g.globalAlpha = 0.25 + rand() * 0.6;
      g.fillStyle = rand() < 0.15 ? '#bfe9ff' : '#ffffff';
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    // moon
    const mx = cw * ((rand() < 0.5 ? 0.12 : 0.66) + rand() * 0.22); // clear of the centred wind readout
    const my = ch * (0.12 + rand() * 0.1);
    const mr = 14 * k + 6;
    const glow = g.createRadialGradient(mx, my, mr * 0.5, mx, my, mr * 4);
    glow.addColorStop(0, 'rgba(200,255,220,.18)');
    glow.addColorStop(1, 'rgba(200,255,220,0)');
    g.fillStyle = glow;
    g.fillRect(mx - mr * 4, my - mr * 4, mr * 8, mr * 8);
    g.fillStyle = '#e6ffe8';
    g.beginPath(); g.arc(mx, my, mr, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(0,0,0,.12)';
    g.beginPath(); g.arc(mx - mr * 0.3, my - mr * 0.2, mr * 0.25, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(mx + mr * 0.35, my + mr * 0.3, mr * 0.18, 0, Math.PI * 2); g.fill();
    // two far ridge layers
    for (const [base, amp, col] of [[0.42, 0.16, '#0a2230'], [0.55, 0.12, '#0b2a26']]) {
      const ph = rand() * 10;
      const f1 = 2 + rand() * 3;
      const f2 = 6 + rand() * 5;
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(0, ch);
      for (let x = 0; x <= cw; x += 4) {
        const t = x / cw;
        const y = ch * base - Math.sin(t * f1 + ph) * ch * amp * 0.6 - Math.sin(t * f2 + ph * 2) * ch * amp * 0.3;
        g.lineTo(x, y);
      }
      g.lineTo(cw, ch);
      g.closePath();
      g.fill();
    }
  }

  // ---- terrain layer, repainted when the heightmap changes ----
  function paintTerrain() {
    if (!terrainDirty || !dispTerrain) return;
    terrainDirty = false;
    const g = terrCv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cw, ch);
    const t = dispTerrain;
    const path = new Path2D();
    path.moveTo(0, ch + 2);
    for (let x = 0; x < S.W; x += 2) path.lineTo(sx(x), sy(t[x]));
    path.lineTo(sx(S.W - 1), sy(t[S.W - 1]));
    path.lineTo(cw, ch + 2);
    path.closePath();
    const grad = g.createLinearGradient(0, sy(S.H * 0.75), 0, ch);
    grad.addColorStop(0, '#1d4a16');
    grad.addColorStop(0.45, '#12300f');
    grad.addColorStop(1, '#040b04');
    g.fillStyle = grad;
    g.fill(path);
    // strata + pebbles, clipped to the dirt
    g.save();
    g.clip(path);
    g.strokeStyle = 'rgba(57,255,20,.06)';
    g.lineWidth = 1;
    for (let y = ch; y > 0; y -= 14 * k + 4) {
      g.beginPath();
      for (let x = 0; x <= cw; x += 20) g.lineTo(x, y + Math.sin(x * 0.02 + y) * 3);
      g.stroke();
    }
    const rand = S.mulberry(((view ? view.gameId : 1) * 104729) >>> 0);
    g.fillStyle = 'rgba(150,200,120,.10)';
    for (let i = 0; i < 160; i++) {
      g.beginPath();
      g.arc(rand() * cw, ch * 0.3 + rand() * ch * 0.7, 0.8 + rand() * 2.2 * k, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
    // glowing ground line
    const top = new Path2D();
    top.moveTo(0, sy(t[0]));
    for (let x = 2; x < S.W; x += 2) top.lineTo(sx(x), sy(t[x]));
    top.lineTo(sx(S.W - 1), sy(t[S.W - 1]));
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(57,255,20,.22)';
    g.lineWidth = 7 * k + 1;
    g.stroke(top);
    g.shadowColor = '#39ff14';
    g.shadowBlur = 8;
    g.strokeStyle = '#39ff14';
    g.lineWidth = 2;
    g.stroke(top);
    g.shadowBlur = 0;
  }

  // ---- tanks ----
  function drawTank(g, seat, now) {
    const d = disp[seat];
    const T = TEAM[seat];
    const tilt = S.tiltAt(dispTerrain, Math.round(d.x));
    const px = sx(d.x);
    const py = sy(d.y);
    const active = view && view.phase === 'playing' && (anim ? anim.rec.by === seat : view.turn === seat);
    // barrel (absolute angle around the pivot)
    const a = (d.angle * Math.PI) / 180;
    const pvx = px;
    const pvy = sy(d.y + S.PIVOT_Y);
    const rl = (S.BARREL - d.recoil * 4) * k;
    g.save();
    g.lineCap = 'round';
    g.strokeStyle = d.dead ? '#2a2a2a' : '#c9d6c9';
    g.lineWidth = Math.max(2, 3.4 * k);
    g.beginPath();
    g.moveTo(pvx, pvy);
    g.lineTo(pvx + Math.cos(a) * rl, pvy - Math.sin(a) * rl);
    g.stroke();
    g.strokeStyle = d.dead ? '#222' : T.light;
    g.lineWidth = Math.max(2.4, 4.2 * k);
    g.beginPath();
    g.moveTo(pvx + Math.cos(a) * rl * 0.82, pvy - Math.sin(a) * rl * 0.82);
    g.lineTo(pvx + Math.cos(a) * rl, pvy - Math.sin(a) * rl);
    g.stroke();
    g.restore();
    // body, tilted with the ground
    g.save();
    g.translate(px, py);
    g.rotate(-tilt);
    g.scale(k, k);
    if (active && !d.dead) {
      g.shadowColor = T.body;
      g.shadowBlur = 10 + Math.sin(now / 220) * 5;
    }
    // treads
    g.fillStyle = d.dead ? '#151515' : '#1c221c';
    g.beginPath();
    g.roundRect(-14, -6.5, 28, 7, 3.5);
    g.fill();
    g.shadowBlur = 0;
    g.fillStyle = d.dead ? '#2a2a2a' : '#5b675b';
    for (let i = -10; i <= 10; i += 5) { g.beginPath(); g.arc(i, -3, 2, 0, Math.PI * 2); g.fill(); }
    // hull
    const hull = g.createLinearGradient(0, -13, 0, -6);
    hull.addColorStop(0, d.dead ? '#3a3a3a' : T.light);
    hull.addColorStop(1, d.dead ? '#1a1a1a' : T.body);
    g.fillStyle = hull;
    g.beginPath();
    g.moveTo(-13, -6.5); g.lineTo(13, -6.5); g.lineTo(10, -12.5); g.lineTo(-10, -12.5);
    g.closePath();
    g.fill();
    g.strokeStyle = d.dead ? '#111' : T.dark;
    g.lineWidth = 1;
    g.stroke();
    // turret dome
    g.fillStyle = d.dead ? '#2c2c2c' : T.body;
    g.beginPath();
    g.arc(0, -12.5, 6, Math.PI, 0);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,.35)';
    g.beginPath(); g.arc(-2, -15, 1.6, 0, Math.PI * 2); g.fill();
    g.restore();
    // HP bar + name
    const f = Math.max(0, d.hp) / S.MAX_HP;
    const bw = Math.max(34, 44 * k);
    const by = sy(d.y + 30) ;
    g.save();
    g.fillStyle = 'rgba(0,0,0,.65)';
    g.fillRect(px - bw / 2 - 1, by - 1, bw + 2, 7);
    g.fillStyle = hpColor(f);
    g.fillRect(px - bw / 2, by, bw * f, 5);
    g.font = 'bold 11px monospace';
    g.textAlign = 'center';
    g.fillStyle = T.text;
    g.shadowColor = '#000';
    g.shadowBlur = 3;
    g.fillText(`${Math.max(0, Math.round(d.hp))}`, px, by - 4);
    if (active && !anim) {
      const bob = Math.sin(now / 180) * 3;
      g.fillStyle = T.light;
      g.beginPath();
      g.moveTo(px, by - 16 + bob); g.lineTo(px - 6, by - 24 + bob); g.lineTo(px + 6, by - 24 + bob);
      g.closePath();
      g.fill();
    }
    g.restore();
  }

  // ---- HUD (canvas) ----
  function drawHud(g) {
    if (!view) return;
    const pad = 10;
    for (const seat of COLORS) {
      const right = seat === 'blue';
      const T = TEAM[seat];
      const w = Math.min(200, cw * 0.3);
      const x = right ? cw - pad - w : pad;
      const f = Math.max(0, disp[seat].hp) / S.MAX_HP;
      g.save();
      g.font = 'bold 12px monospace';
      g.textAlign = right ? 'right' : 'left';
      g.fillStyle = T.text;
      g.shadowColor = '#000';
      g.shadowBlur = 4;
      let name = view.players[seat] ? seatName(seat) : `${seat.toUpperCase()} (empty)`;
      if (name.length > 22) name = `${name.slice(0, 21)}…`;
      g.fillText(name, right ? cw - pad : pad, pad + 10);
      g.shadowBlur = 0;
      g.fillStyle = 'rgba(0,0,0,.55)';
      g.fillRect(x, pad + 16, w, 10);
      g.fillStyle = hpColor(f);
      g.fillRect(right ? x + w * (1 - f) : x, pad + 16, w * f, 10);
      g.strokeStyle = T.body;
      g.lineWidth = 1;
      g.strokeRect(x + 0.5, pad + 16.5, w - 1, 9);
      g.font = 'bold 11px monospace';
      g.fillStyle = '#e8ffe0';
      g.fillText(`HP ${Math.max(0, Math.round(disp[seat].hp))}`, right ? cw - pad : pad, pad + 40);
      g.restore();
    }
    // wind
    const wx = cw / 2;
    const wv = dispWind;
    g.save();
    g.textAlign = 'center';
    g.font = 'bold 11px monospace';
    g.fillStyle = '#9fdc98';
    g.fillText(wv === 0 ? 'WIND · CALM' : `WIND ${Math.abs(wv)}`, wx, 18);
    if (wv !== 0) {
      const len = 10 + Math.abs(wv) * 7;
      const dir = Math.sign(wv);
      const y = 30;
      g.strokeStyle = Math.abs(wv) >= 7 ? '#ff7b39' : Math.abs(wv) >= 4 ? '#ffd23f' : '#39ff14';
      g.fillStyle = g.strokeStyle;
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(wx - (len / 2) * dir, y);
      g.lineTo(wx + (len / 2) * dir, y);
      g.stroke();
      g.beginPath();
      g.moveTo(wx + (len / 2 + 6) * dir, y);
      g.lineTo(wx + (len / 2 - 2) * dir, y - 6);
      g.lineTo(wx + (len / 2 - 2) * dir, y + 6);
      g.closePath();
      g.fill();
    }
    if (view.phase === 'playing' || view.phase === 'game_over') {
      g.fillStyle = 'rgba(159,220,152,.6)';
      g.font = '10px monospace';
      const tn = Math.min(view.maxTurns, (anim ? anim.rec.seq : view.turnNo) + (anim ? 0 : 1));
      g.fillText(view.phase === 'playing' ? `SHOT ${tn} / ${view.maxTurns}` : '', wx, 48);
    }
    g.restore();
  }

  // ---- aim preview (short arc) ----
  function drawPreview(g, now) {
    const seat = mySeat();
    if (!myAim || !myTurnIdle()) return;
    const d = disp[seat];
    const x = Math.round(d.x);
    const pts = S.previewArc(dispTerrain, x, myAim.angle, myAim.power, 16, 0.035);
    g.save();
    for (let i = 1; i < pts.length; i++) {
      const [px, py] = pts[i];
      if (px < 0 || px >= S.W || py < S.groundAt(dispTerrain, px)) break;
      const fade = 1 - i / pts.length;
      g.globalAlpha = 0.25 + 0.75 * fade;
      g.fillStyle = SHELL_COLOR[myAim.weapon] || '#39ff14';
      g.beginPath();
      g.arc(sx(px), sy(py), Math.max(1.5, (2.6 - i * 0.08) * k + 0.6), 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    // readout next to the barrel
    const m = S.muzzle(dispTerrain, x, myAim.angle);
    g.font = 'bold 12px monospace';
    g.textAlign = 'center';
    g.fillStyle = '#e8ffe0';
    g.shadowColor = '#000';
    g.shadowBlur = 4;
    const lx = Math.min(cw - 40, Math.max(40, sx(d.x)));
    g.fillText(`${myAim.angle > 90 ? 180 - myAim.angle : myAim.angle}° · ${myAim.power}`, lx, sy(d.y) + 22);
    if (drag) {
      g.strokeStyle = 'rgba(57,255,20,.35)';
      g.setLineDash([4, 5]);
      g.beginPath();
      g.moveTo(sx(m.x), sy(m.y));
      g.lineTo(sx(drag.wx), sy(drag.wy));
      g.stroke();
      g.setLineDash([]);
      g.beginPath();
      g.arc(sx(drag.wx), sy(drag.wy), 6 + Math.sin(now / 120) * 1.5, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
  }

  // ---- projectiles in flight ----
  function drawShells(g, f) {
    const rec = anim.rec;
    const col = SHELL_COLOR[rec.input.weapon] || '#ffe14d';
    const rad = rec.input.weapon === 'big' ? 4.6 : 3.2;
    for (const p of rec.projectiles) {
      if (f >= p.end.f || !p.frames) continue;
      const n = p.frames.length;
      const i = Math.min(n - 1, Math.floor(f));
      const t = Math.min(1, f - i);
      const a = p.frames[i];
      const b = p.frames[Math.min(n - 1, i + 1)];
      const x = a[0] + (b[0] - a[0]) * t;
      const y = a[1] + (b[1] - a[1]) * t;
      // trail
      g.save();
      g.lineCap = 'round';
      for (let j = Math.max(0, i - 14); j < i; j++) {
        const q0 = p.frames[j];
        const q1 = p.frames[j + 1];
        g.globalAlpha = ((j - (i - 14)) / 14) * 0.55;
        g.strokeStyle = col;
        g.lineWidth = Math.max(1, rad * k * ((j - (i - 14)) / 14));
        g.beginPath();
        g.moveTo(sx(q0[0]), sy(q0[1]));
        g.lineTo(sx(q1[0]), sy(q1[1]));
        g.stroke();
      }
      g.globalAlpha = 1;
      if (y > S.H) {
        // above the screen: marker at the top edge
        g.fillStyle = col;
        g.beginPath();
        g.moveTo(sx(x), 4); g.lineTo(sx(x) - 5, 12); g.lineTo(sx(x) + 5, 12);
        g.closePath();
        g.fill();
        g.font = '10px monospace';
        g.textAlign = 'center';
        g.fillText(`${Math.round(y - S.H)}`, sx(x), 24);
      } else {
        g.shadowColor = col;
        g.shadowBlur = 12;
        g.fillStyle = '#fff';
        g.beginPath();
        g.arc(sx(x), sy(y), Math.max(2, rad * k), 0, Math.PI * 2);
        g.fill();
        g.fillStyle = col;
        g.beginPath();
        g.arc(sx(x), sy(y), Math.max(1.2, rad * k * 0.6), 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    }
  }

  function drawBooms(g, now) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let i = booms.length - 1; i >= 0; i--) {
      const b = booms[i];
      const a = (now - b.t0) / 1000;
      if (a > 0.75) { booms.splice(i, 1); continue; }
      if (a < 0) continue;
      const grow = Math.min(1, a / 0.16);
      const r = Math.max(1, b.r * k * (0.35 + 0.75 * grow));
      const alpha = a < 0.16 ? 1 : Math.max(0, 1 - (a - 0.16) / 0.59);
      const gr = g.createRadialGradient(sx(b.x), sy(b.y), 0, sx(b.x), sy(b.y), r);
      gr.addColorStop(0, `rgba(255,255,230,${alpha})`);
      gr.addColorStop(0.3, `rgba(255,220,80,${alpha * 0.95})`);
      gr.addColorStop(0.65, `rgba(255,110,30,${alpha * 0.7})`);
      gr.addColorStop(1, 'rgba(255,40,10,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(sx(b.x), sy(b.y), r, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  // ---- shot playback ----
  function startAnim(rec) {
    anim = { rec, start: performance.now(), fired: new Set(), fallDone: false, launched: false };
    dispWind = rec.wind;
    for (const c of COLORS) {
      disp[c].hp = rec.hpBefore[c];
      if (rec.tankXs) disp[c].x = rec.tankXs[c];
      disp[c].dead = disp[c].hp <= 0;
    }
    disp[rec.by].angle = rec.input.angle;
    if (rec.by === mySeat() && myAim) { myAim.angle = rec.input.angle; myAim.power = rec.input.power; }
    renderDom();
  }

  function onLaunch(rec) {
    const d = disp[rec.by];
    d.recoil = 1;
    const m = S.muzzle(dispTerrain, Math.round(d.x), rec.input.angle);
    const ang = -(rec.input.angle * Math.PI) / 180;
    fx.burst(sx(m.x), sy(m.y), '#ffd23f', { count: 14, speed: 140, life: 0.3, size: 2.5, spread: 0.9, angle: ang });
    fx.burst(sx(m.x), sy(m.y), '#888', { count: 8, speed: 40, life: 0.8, size: 3, gravity: -40 });
    const w = rec.input.weapon;
    if (w === 'big') { sfx.play('shotgun'); sfx.play('crash', { vol: 0.35 }); } else if (w === 'triple') sfx.play('shotgun', { vol: 0.8 });
    else sfx.play('pistol');
    fx.shake(w === 'big' ? 4 : 2);
  }

  function onExplosion(rec, ev) {
    S.carve(dispTerrain, ev.x, ev.y, ev.r);
    terrainDirty = true;
    const big = ev.r >= 40;
    booms.push({ x: ev.x, y: ev.y, r: ev.r * 1.25, t0: performance.now() });
    const X = sx(ev.x);
    const Y = sy(ev.y);
    if (!reduced()) {
      fx.burst(X, Y, '#ffb000', { count: big ? 40 : 24, speed: big ? 320 : 220, life: 0.5, size: 2.4 });
      fx.burst(X, Y, '#4f8a2a', { count: big ? 36 : 20, speed: big ? 260 : 190, life: 1.0, size: 3, gravity: 520, spread: Math.PI * 0.9, angle: -Math.PI / 2 });
      fx.burst(X, Y, '#2a3a2a', { count: 10, speed: 30, life: 1.4, size: 6, gravity: -50 });
    }
    fx.ring(X, Y, '#ffe14d', { radius: ev.r * k * 1.6, life: 0.45, width: 3 });
    fx.shake(big ? 11 : 6);
    sfx.play('crash', { vol: big ? 1 : 0.75 });
    let anyHit = false;
    for (const c of COLORS) {
      const dmg = ev.dmg[c] || 0;
      if (!dmg) continue;
      anyHit = true;
      const before = disp[c].hp;
      disp[c].hp = Math.max(0, disp[c].hp - dmg);
      const d = disp[c];
      fx.text(sx(d.x), sy(d.y + 42), `-${dmg}`, '#ff5a5a', { life: 1.2, size: 18 });
      if (before > 0 && disp[c].hp <= 0) killTank(c);
    }
    if (anyHit) setTimeout(() => sfx.play('hurt'), 60);
    const proj = rec.projectiles[ev.p];
    if (proj && proj.end && proj.end.type === 'tank') {
      const victim = COLORS.find((c) => (ev.dmg[c] || 0) > 0 && c !== rec.by) ;
      if (victim) callout('DIRECT HIT!', '#ffd23f', false);
    }
  }

  function killTank(c) {
    const d = disp[c];
    d.dead = true;
    const X = sx(d.x);
    const Y = sy(d.y + 8);
    booms.push({ x: d.x, y: d.y + 8, r: 60, t0: performance.now() + 120 });
    fx.burst(X, Y, '#ff7b39', { count: 50, speed: 340, life: 0.8, size: 3 });
    fx.burst(X, Y, TEAM[c].body, { count: 24, speed: 260, life: 1.2, size: 3.5, gravity: 500, spread: Math.PI, angle: -Math.PI / 2 });
    fx.shake(16);
    setTimeout(() => sfx.play('kill'), 150);
    callout('DESTROYED!', TEAM[c].text, false);
  }

  function stepAnim(now) {
    const rec = anim.rec;
    const f = Math.max(0, (now - anim.start) / (1000 / S.FPS));
    if (!anim.launched) { anim.launched = true; onLaunch(rec); }
    for (let i = 0; i < rec.explosions.length; i++) {
      const ev = rec.explosions[i];
      if (f >= ev.f && !anim.fired.has(`x${i}`)) { anim.fired.add(`x${i}`); onExplosion(rec, ev); }
    }
    rec.projectiles.forEach((p, pi) => {
      for (const bf of p.bounces || []) {
        const key = `b${pi}:${bf}`;
        if (f >= bf && !anim.fired.has(key)) {
          anim.fired.add(key);
          sfx.play('blip');
          const fr = p.frames && p.frames[Math.min(p.frames.length - 1, bf)];
          if (fr) fx.burst(sx(fr[0]), sy(fr[1]), '#ff4dd2', { count: 10, speed: 120, life: 0.35, size: 2 });
        }
      }
      if (p.end.type === 'off' && f >= p.end.f && !anim.fired.has(`o${pi}`)) {
        anim.fired.add(`o${pi}`);
        if (rec.projectiles.length === 1) callout('OUT OF BOUNDS', '#9fb39c', true);
      }
    });
    if (!anim.fallDone && f >= rec.frames + FALL_DMG_FRAME) {
      anim.fallDone = true;
      for (const c of COLORS) {
        const dmg = (rec.fallDmg && rec.fallDmg[c]) || 0;
        if (!dmg) continue;
        const before = disp[c].hp;
        disp[c].hp = Math.max(0, disp[c].hp - dmg);
        fx.text(sx(disp[c].x), sy(disp[c].y + 42), `-${dmg} FALL`, '#ffb000', { life: 1.2, size: 14 });
        sfx.play('hurt');
        if (before > 0 && disp[c].hp <= 0) killTank(c);
      }
      const opp = rec.by === 'red' ? 'blue' : 'red';
      const dealt = rec.hpBefore[opp] - rec.hpAfter[opp];
      const self = rec.hpBefore[rec.by] - rec.hpAfter[rec.by];
      const allOff = rec.projectiles.every((p) => p.end.type === 'off');
      if (!dealt && !allOff) callout(self ? 'OUCH!' : 'MISS', self ? '#ff8a3d' : '#9fb39c', true);
      else if (dealt >= 40 && rec.hpAfter[opp] > 0) callout(`-${dealt}!`, '#ffd23f', false);
    }
    if (f >= rec.frames + SETTLE_FRAMES) finishAnim();
    return f;
  }

  function finishAnim() {
    anim = null;
    if (queue.length) {
      startAnim(queue.shift());
      return;
    }
    syncFromView();
    if (view.phase === 'playing') {
      const seat = mySeat();
      if (seat && view.turn === seat) {
        setTimeout(() => sfx.play('turn'), 120);
        callout('YOUR TURN', '#39ff14', false);
      }
    }
    if (pendingWinSfx) playEndSfx();
    renderDom();
  }

  function playEndSfx() {
    pendingWinSfx = false;
    const seat = mySeat();
    const w = view.winner;
    setTimeout(() => sfx.play(!seat || w === 'draw' ? 'chime' : w === seat ? 'win' : 'lose'), 250);
  }

  // Display state <- authoritative state (no animation in progress).
  function syncFromView(instant) {
    if (!view || !S) return;
    dispTerrain = view.terrain.slice();
    terrainDirty = true;
    dispWind = view.wind;
    for (const c of COLORS) {
      const t = view.tanks[c];
      const d = disp[c];
      d.hp = t.hp;
      d.dead = t.hp <= 0;
      if (instant) {
        d.x = t.x;
        d.y = S.groundAt(dispTerrain, t.x);
        d.vy = 0;
        d.angle = t.angle;
      }
    }
    maybeInitTurn();
  }

  function maybeInitTurn() {
    const seat = mySeat();
    if (!view || !seat || view.phase !== 'playing' || view.turn !== seat) {
      myAim = null; local = null; turnKey = ''; holdDir = 0;
      return;
    }
    const key = `${view.gameId}:${view.shotSeq}`;
    if (key === turnKey) return;
    turnKey = key;
    const t = view.tanks[seat];
    myAim = { angle: t.angle, power: t.power, weapon: hasAmmo(seat, t.weapon) ? t.weapon : 'shell' };
    local = { x: t.x, fuel: t.fuel };
    pendingSteps = 0;
    driveAcc = 0;
  }

  function hasAmmo(seat, w) {
    if (!view || !S.WEAPONS[w]) return false;
    return S.WEAPONS[w].ammo == null || (view.tanks[seat].ammo[w] || 0) > 0;
  }

  // ---- own-turn input ----
  function sendAimSoon() {
    if (aimTimer) return;
    aimTimer = setTimeout(() => {
      aimTimer = null;
      if (myAim && myTurnIdle()) api.sendAction({ kind: 'aim', angle: myAim.angle, power: myAim.power, weapon: myAim.weapon });
    }, AIM_SEND_MS);
  }
  function setAim(angle, power, quiet) {
    if (!myAim) return;
    const na = Math.max(0, Math.min(180, Math.round(angle)));
    const np = Math.max(0, Math.min(100, Math.round(power)));
    if (na === myAim.angle && np === myAim.power) return;
    myAim.angle = na;
    myAim.power = np;
    disp[mySeat()].angle = na;
    if (!quiet) sfx.play('tick', { vol: 0.5 });
    sendAimSoon();
    updateControls();
  }
  function setWeapon(w) {
    const seat = mySeat();
    if (!myAim || !myTurnIdle() || !hasAmmo(seat, w) || myAim.weapon === w) return;
    myAim.weapon = w;
    sfx.play('select');
    sendAimSoon();
    updateControls();
  }
  function flushDrive() {
    if (!pendingSteps) return;
    driveSeq++;
    api.sendAction({ kind: 'drive', dir: pendingDir, steps: pendingSteps, seq: driveSeq });
    pendingSteps = 0;
    lastFlush = performance.now();
  }
  function startDrive(dir) {
    if (!myTurnIdle() || !local) return;
    if (holdDir !== dir) flushDrive();
    holdDir = dir;
    blockedSfx = false;
    driveAcc = 0.99; // first unit right away
  }
  function stopDrive(dir) {
    if (dir != null && holdDir !== dir) return;
    holdDir = 0;
    flushDrive();
  }
  function stepDrive(dt, now) {
    if (!holdDir || !local) return;
    if (!myTurnIdle()) { stopDrive(); return; }
    const seat = mySeat();
    const other = view.tanks[seat === 'red' ? 'blue' : 'red'].x;
    driveAcc += DRIVE_SPEED * dt;
    let moved = false;
    while (driveAcc >= 1) {
      driveAcc -= 1;
      const s = S.driveStep(view.terrain, local.x, holdDir, other);
      if (!s || s.cost > local.fuel) {
        driveAcc = 0;
        if (!blockedSfx) { blockedSfx = true; sfx.play('error', { vol: 0.6 }); }
        break;
      }
      if (pendingSteps && pendingDir !== holdDir) flushDrive();
      local.x = s.x;
      local.fuel -= s.cost;
      pendingDir = holdDir;
      pendingSteps++;
      moved = true;
      if (pendingSteps >= 40) flushDrive();
    }
    if (moved && now - lastDriveSfx > 150) { lastDriveSfx = now; sfx.play('move', { vol: 0.35 }); }
    if (pendingSteps && now - lastFlush > DRIVE_FLUSH_MS) flushDrive();
    if (moved) updateControls();
  }
  function fire() {
    if (!myTurnIdle() || !myAim) return;
    const seat = mySeat();
    if (!hasAmmo(seat, myAim.weapon)) myAim.weapon = 'shell';
    holdDir = 0;
    flushDrive();
    clearTimeout(aimTimer);
    aimTimer = null;
    firePending = true;
    clearTimeout(fireTimer);
    fireTimer = setTimeout(() => { firePending = false; renderDom(); }, 4000);
    api.sendAction({ kind: 'fire', angle: myAim.angle, power: myAim.power, weapon: myAim.weapon });
    renderDom();
  }

  function worldFromEvent(e) {
    const r = canvas.getBoundingClientRect();
    return { wx: (e.clientX - r.left) / k, wy: S.H - (e.clientY - r.top) / k };
  }
  function aimAt(wx, wy) {
    const seat = mySeat();
    const d = disp[seat];
    const px = d.x;
    const py = d.y + S.PIVOT_Y;
    let ang = (Math.atan2(wy - py, wx - px) * 180) / Math.PI;
    if (ang < 0) ang = ang < -90 ? 180 : 0; // pointing below the horizon: flat
    const dist = Math.hypot(wx - px, wy - py);
    setAim(ang, (dist / 300) * 100, true);
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (!myTurnIdle() || !myAim) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const w = worldFromEvent(e);
    drag = { id: e.pointerId, ...w };
    aimAt(w.wx, w.wy);
    sfx.play('select');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const w = worldFromEvent(e);
    drag.wx = w.wx;
    drag.wy = w.wy;
    if (myTurnIdle()) aimAt(w.wx, w.wy);
  });
  const endDrag = (e) => { if (drag && e.pointerId === drag.id) drag = null; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // ---- control panel (built once, patched in place) ----
  const weapBtns = {};
  function buildControls() {
    for (const kk of S.WEAPON_KEYS) {
      const b = document.createElement('button');
      b.style.setProperty('--c', SHELL_COLOR[kk]);
      const ic = document.createElement('span');
      ic.className = 'ic';
      ic.textContent = WEAPON_ICON[kk];
      ic.style.color = SHELL_COLOR[kk];
      const nm = document.createElement('span');
      nm.textContent = S.WEAPONS[kk].name;
      const am = document.createElement('span');
      am.className = 'am';
      b.append(ic, nm, am);
      b.title = `${S.WEAPONS[kk].name} (key ${S.WEAPON_KEYS.indexOf(kk) + 1})`;
      b.addEventListener('click', () => setWeapon(kk));
      weapRow.appendChild(b);
      weapBtns[kk] = { b, am };
    }
    // drive
    const dg = document.createElement('div');
    dg.className = 'tk-group';
    const dl = document.createElement('span');
    dl.className = 'lab';
    dl.textContent = 'FUEL';
    const dLeft = holdButton('◀', () => startDrive(-1), () => stopDrive(-1));
    const fuel = document.createElement('div');
    fuel.className = 'tk-fuel';
    const fuelFill = document.createElement('i');
    fuel.appendChild(fuelFill);
    const dRight = holdButton('▶', () => startDrive(1), () => stopDrive(1));
    dg.append(dl, dLeft, fuel, dRight);
    // angle / power
    const mk = (label, get, set) => {
      const gEl = document.createElement('div');
      gEl.className = 'tk-group';
      const l = document.createElement('span');
      l.className = 'lab';
      l.textContent = label;
      const v = document.createElement('span');
      v.className = 'val';
      const minus = repeatButton('−', () => set(get() - 1));
      const plus = repeatButton('+', () => set(get() + 1));
      gEl.append(l, minus, v, plus);
      return { el: gEl, v, minus, plus };
    };
    // ANGLE shows elevation (0-90 above the horizon on the side the barrel faces); + raises it.
    const side = () => (myAim && (myAim.angle > 90 || (myAim.angle === 90 && mySeat() === 'blue')) ? -1 : 1);
    const elev = () => (myAim ? (myAim.angle > 90 ? 180 - myAim.angle : myAim.angle) : 0);
    const ang = mk('ANGLE', elev, (e) => {
      if (!myAim) return;
      const ee = Math.max(0, Math.min(90, e));
      setAim(side() === 1 ? ee : 180 - ee, myAim.power);
    });
    const pow = mk('POWER', () => (myAim ? myAim.power : 0), (p) => myAim && setAim(myAim.angle, p));
    const fireBtn = document.createElement('button');
    fireBtn.className = 'tk-fire';
    fireBtn.textContent = 'FIRE!';
    fireBtn.addEventListener('click', fire);
    mainRow.append(dg, ang.el, pow.el, fireBtn);
    controls = { dLeft, dRight, fuelFill, ang, pow, fireBtn };
  }
  let controls = null;
  function holdButton(label, onDown, onUp) {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('pointerdown', (e) => {
      if (b.disabled) return;
      e.preventDefault();
      try { b.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      onDown();
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, () => onUp());
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    return b;
  }
  function repeatButton(label, fn) {
    let t1 = null; let t2 = null;
    const stop = () => { clearTimeout(t1); clearInterval(t2); t1 = t2 = null; };
    const b = holdButton(label, () => {
      stop();
      fn();
      sfx.play('tick', { vol: 0.5 });
      t1 = setTimeout(() => { t2 = setInterval(() => { if (b.disabled) stop(); else fn(); }, 55); }, 380);
    }, stop);
    return b;
  }

  function updateControls() {
    if (!controls || !view) return;
    const seat = mySeat();
    ctrl.style.display = seat ? '' : 'none';
    if (!seat) return;
    const can = myTurnIdle() && !!myAim;
    ctrl.classList.toggle('off', !can);
    const tank = view.tanks[seat];
    for (const kk of S.WEAPON_KEYS) {
      const { b, am } = weapBtns[kk];
      const ammo = S.WEAPONS[kk].ammo == null ? '∞' : `×${tank.ammo[kk] || 0}`;
      if (am.textContent !== ammo) am.textContent = ammo;
      b.disabled = !can || !hasAmmo(seat, kk);
      b.classList.toggle('on', !!(myAim ? myAim.weapon === kk : tank.weapon === kk));
    }
    const a = myAim ? myAim.angle : tank.angle;
    const p = myAim ? myAim.power : tank.power;
    const angTxt = `${a > 90 ? 180 - a : a}°`;
    if (controls.ang.v.textContent !== angTxt) controls.ang.v.textContent = angTxt;
    if (controls.pow.v.textContent !== String(p)) controls.pow.v.textContent = String(p);
    const fuel = local && can ? local.fuel : tank.fuel;
    controls.fuelFill.style.width = `${Math.round((fuel / S.FUEL) * 100)}%`;
    for (const b of [controls.dLeft, controls.dRight]) b.disabled = !can || fuel <= 0;
    for (const b of [controls.ang.minus, controls.ang.plus, controls.pow.minus, controls.pow.plus]) b.disabled = !can;
    controls.fireBtn.disabled = !can;
    controls.fireBtn.textContent = firePending ? 'FIRING…' : 'FIRE!';
    stage.classList.toggle('can-aim', can);
  }

  // ---- keyboard ----
  const held = new Set();
  function onKey(e) {
    if (!view || !S) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!myTurnIdle() || !myAim) return;
    const step = e.shiftKey ? 5 : 1;
    const key = e.key;
    let handled = true;
    if (key === 'ArrowLeft') setAim(myAim.angle + step, myAim.power);
    else if (key === 'ArrowRight') setAim(myAim.angle - step, myAim.power);
    else if (key === 'ArrowUp') setAim(myAim.angle, myAim.power + step);
    else if (key === 'ArrowDown') setAim(myAim.angle, myAim.power - step);
    else if (key === 'a' || key === 'A') { if (!held.has('a')) { held.add('a'); startDrive(-1); } }
    else if (key === 'd' || key === 'D') { if (!held.has('d')) { held.add('d'); startDrive(1); } }
    else if (key === ' ' || key === 'Enter') { if (!e.repeat) fire(); }
    else if (key >= '1' && key <= '4') setWeapon(S.WEAPON_KEYS[Number(key) - 1]);
    else handled = false;
    if (handled) e.preventDefault();
  }
  function onKeyUp(e) {
    const key = e.key.toLowerCase();
    if (key === 'a' && held.delete('a')) stopDrive(-1);
    if (key === 'd' && held.delete('d')) stopDrive(1);
  }
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);
  const onBlur = () => { held.clear(); stopDrive(); };
  window.addEventListener('blur', onBlur);

  // ---- frame loop ----
  function frame(now) {
    if (destroyed) return;
    raf = requestAnimationFrame(frame);
    if (!S || !view || !ctx || !dispTerrain) return;
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    stepDrive(dt, now);
    if (anim) stepAnim(now);

    // tank display: x eases toward the authoritative / predicted column, y falls onto the ground
    const seat = mySeat();
    for (const c of COLORS) {
      const d = disp[c];
      let tx = anim ? anim.rec.tankXs[c] : view.tanks[c].x;
      if (!anim && c === seat && local && myAim) tx = local.x;
      const dx = tx - d.x;
      if (Math.abs(dx) > 160) d.x = tx;
      else d.x += Math.sign(dx) * Math.min(Math.abs(dx), (c === seat && local ? 400 : 70) * dt);
      const gy = S.groundAt(dispTerrain, d.x);
      if (d.y > gy + 0.5) {
        d.vy += S.G * 1.4 * dt;
        d.y = Math.max(gy, d.y - d.vy * dt);
      } else { d.y = gy; d.vy = 0; }
      // barrel eases toward the shown aim
      let ta = view.tanks[c].angle;
      if (anim && anim.rec.by === c) ta = anim.rec.input.angle;
      else if (c === seat && myAim) ta = myAim.angle;
      const da = ta - d.angle;
      d.angle += Math.abs(da) < 0.5 ? da : da * Math.min(1, dt * (c === seat ? 30 : 7));
      d.recoil = Math.max(0, d.recoil - dt * 3);
      if (d.dead && !reduced() && Math.random() < dt * 6) {
        fx.burst(sx(d.x + (Math.random() - 0.5) * 10), sy(d.y + 12), '#3a3a3a', { count: 2, speed: 18, life: 1.6, size: 5, gravity: -40 });
      }
    }

    paintBg();
    paintTerrain();
    const g = ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    fx.applyShake(g);
    g.drawImage(bg, 0, 0, cw, ch);
    g.drawImage(terrCv, 0, 0, cw, ch);
    for (const c of COLORS) drawTank(g, c, now);
    drawPreview(g, now);
    if (anim) drawShells(g, Math.max(0, (now - anim.start) / (1000 / S.FPS)));
    drawBooms(g, now);
    fx.draw(g);
    g.restore();
    drawHud(g);
    if (view.phase === 'waiting') {
      g.save();
      g.fillStyle = 'rgba(0,0,0,.45)';
      g.fillRect(0, ch / 2 - 26, cw, 52);
      g.font = 'bold 18px monospace';
      g.textAlign = 'center';
      g.fillStyle = '#39ff14';
      g.shadowColor = '#39ff14';
      g.shadowBlur = 10;
      g.fillText('WAITING FOR TANKS — TAKE A SEAT OR ADD A BOT', cw / 2, ch / 2 + 6);
      g.restore();
    }
    // keep the panel's enabled state honest as busy windows expire
    const can = myTurnIdle();
    if (can !== lastCan) { lastCan = can; renderDom(); }
  }
  let lastCan = null;

  // ---- DOM ----
  function seatBox(color) {
    const box = document.createElement('div');
    box.className = `tk-seat${view.phase === 'playing' && view.turn === color ? ' turn' : ''}`;
    const chip = document.createElement('span');
    chip.className = 'tk-chip';
    chip.style.background = TEAM[color].body;
    const name = document.createElement('span');
    const occ = view.players[color];
    name.textContent = `${color.toUpperCase()}: ${occ ? seatName(color) : '(empty)'}${occ && occ === api.getClientId() ? ' (you)' : ''}`;
    name.style.color = TEAM[color].text;
    box.append(chip, name);
    const seat = mySeat();
    if (!occ) {
      if (!seat) {
        const btn = document.createElement('button');
        btn.textContent = `PLAY ${color.toUpperCase()}`;
        btn.addEventListener('click', () => api.sendAction({ kind: 'sit', seat: color }));
        box.appendChild(btn);
      }
      const bot = document.createElement('button');
      bot.textContent = 'PLAY VS BOT';
      bot.addEventListener('click', () => api.sendAction({ kind: 'sit', seat: color, bot: true, level: preferredLevel() }));
      box.append(bot, levelSelect(preferredLevel()));
    } else if (occ === 'BOT') {
      box.appendChild(levelSelect((view.botLevels || {})[color], (level) => api.sendAction({ kind: 'setBotLevel', seat: color, level })));
      const rm = document.createElement('button');
      rm.textContent = 'REMOVE BOT';
      rm.addEventListener('click', () => api.sendAction({ kind: 'removeBot', seat: color }));
      box.appendChild(rm);
    }
    return box;
  }

  let seatsKey = '';
  function renderDom() {
    if (destroyed) return;
    const seat = mySeat();
    const over = !!(view && view.phase === 'game_over' && !busy());
    results.update(over ? duelResults({
      winner: view.winner === 'draw' ? null : view.winner, colors: COLORS, players: view.players, me: seat, nameFor: (id) => (id === 'BOT' ? 'Bot' : nicknameFor(id)),
      subtitle: `${view.endReason === 'turns' ? 'Out of shots — most HP wins · ' : ''}HP ${view.tanks.red.hp} – ${view.tanks.blue.hp} · hits ${view.stats.red.hits}/${view.stats.red.shots} vs ${view.stats.blue.hits}/${view.stats.blue.shots}`,
      onRematch: () => api.sendAction({ kind: 'resetGame' }),
    }) : null);
    if (!view || !S) {
      status.textContent = 'Loading...';
      return;
    }
    const showTurn = anim ? anim.rec.by : view.turn;
    status.className = 'tk-status';
    status.style.color = '';
    if (view.phase === 'waiting') {
      status.textContent = 'Waiting for both tanks to be crewed.';
    } else if (over) {
      status.textContent = view.winner === 'draw' ? "IT'S A DRAW!" : `${seatName(view.winner)} WINS!`;
      status.style.color = '#ffb000';
    } else if (anim) {
      status.textContent = `${anim.rec.by === seat ? 'YOUR' : `${seatName(anim.rec.by)}'s`} ${S.WEAPONS[anim.rec.input.weapon].name.toUpperCase()} — INCOMING!`;
      status.style.color = TEAM[anim.rec.by].text;
    } else if (seat && showTurn === seat) {
      status.textContent = firePending ? '▶ FIRING…' : '▶ YOUR TURN — AIM, DRIVE & FIRE';
      status.classList.add('mine');
    } else {
      status.textContent = `${seatName(showTurn)} IS AIMING…`;
      status.style.color = TEAM[showTurn].text;
    }
    err.textContent = flashError ? REJECT_MESSAGES[flashError] || 'Action rejected' : '';

    // seat row: rebuild only when what it shows changes
    const key = JSON.stringify([view.players, view.botLevels, view.phase, view.turn, seat, COLORS.map((c) => seatName(c))]);
    if (key !== seatsKey) {
      seatsKey = key;
      seats.innerHTML = '';
      seats.append(seatBox('red'), seatBox('blue'));
      if (seat) {
        const leave = document.createElement('button');
        leave.textContent = 'LEAVE SEAT';
        leave.addEventListener('click', () => api.sendAction({ kind: 'leaveSeat' }));
        seats.appendChild(leave);
      }
      if (view.phase === 'game_over' && seat) {
        const again = document.createElement('button');
        again.textContent = 'REMATCH (SWAP SIDES)';
        again.addEventListener('click', () => api.sendAction({ kind: 'resetGame' }));
        seats.appendChild(again);
      }
    }
    updateControls();
  }

  // ---- state ----
  function onNewShot(rec) {
    if (rec.seq <= lastSeqSeen) return;
    lastSeqSeen = rec.seq;
    if (anim) {
      // a backlog (e.g. tab was hidden): skip straight through older shots
      while (queue.length >= 1) {
        const old = queue.shift();
        for (const ev of old.explosions) S.carve(dispTerrain, ev.x, ev.y, ev.r);
        terrainDirty = true;
      }
      queue.push(rec);
    } else startAnim(rec);
  }

  function applyState(data, fromSnapshot) {
    const prev = view;
    view = data;
    clock.sync(data.serverNow);
    if (!S) { renderDom(); return; }
    if (firePending && (!prev || data.shotSeq !== prev.shotSeq || data.gameId !== prev.gameId || data.phase !== 'playing')) {
      firePending = false;
      clearTimeout(fireTimer);
    }
    if (fromSnapshot || !prev || prev.gameId !== data.gameId) {
      anim = null;
      queue.length = 0;
      booms.length = 0;
      lastSeqSeen = data.lastShot ? data.lastShot.seq : 0;
      turnKey = '';
      pendingWinSfx = false;
      syncFromView(true);
      if (prev && prev.phase !== 'playing' && data.phase === 'playing') {
        sfx.play('go');
        fx.bigLabel('FIGHT!', '#39ff14');
      }
    } else if (data.lastShot && data.lastShot.seq > lastSeqSeen) {
      onNewShot(data.lastShot);
      if (data.winner && !prev.winner) pendingWinSfx = true;
    } else if (!busy()) {
      syncFromView(false);
    }
    if (!busy()) maybeInitTurn();
    flashError = null;
    renderDom();
  }

  function applyTank(data) {
    if (!view || data.gameId !== view.gameId || data.shotSeq !== view.shotSeq || !COLORS.includes(data.seat)) return;
    const t = view.tanks[data.seat];
    t.x = data.x;
    t.fuel = data.fuel;
    t.angle = data.angle;
    t.power = data.power;
    t.weapon = data.weapon;
    if (data.seat === mySeat() && local && data.ack != null) {
      lastAck = data.ack;
      if (lastAck === driveSeq && !pendingSteps && !holdDir) local = { x: data.x, fuel: data.fuel };
    }
    updateControls();
  }

  // ---- boot ----
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null;
  if (ro) ro.observe(stage);
  window.addEventListener('resize', resize);
  loadSim().then((Sim) => {
    if (destroyed) return;
    S = Sim;
    buildControls();
    resize();
    if (view) applyState(view, true);
    renderDom();
    raf = requestAnimationFrame(frame);
  }).catch(() => {
    stage.innerHTML = '<div class="tk-fail">Could not load the tank physics.</div>';
  });
  renderDom();

  return {
    applySnapshot(snapshot) {
      applyState(snapshot, true);
    },
    applyEvent(data) {
      if (!data) return;
      if (data.kind === 'state') applyState(data, false);
      else if (data.kind === 'tank') applyTank(data);
      else if (data.kind === 'moveRejected') {
        firePending = false;
        clearTimeout(fireTimer);
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
      clearTimeout(fireTimer);
      clearTimeout(aimTimer);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', resize);
      if (ro) ro.disconnect();
      results.destroy();
      container.innerHTML = '';
    },
  };
}
