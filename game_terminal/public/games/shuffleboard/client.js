// Shuffleboard client. 2D canvas with a pinhole-perspective view down the table from the shooting
// end + the shared puck physics (sim.js). On your turn: drag sideways to slide your puck across
// the start line, then drag UP and let go — the drag's tilt aims, its length is power. Your shot
// plays instantly from a local run of the same sim; the server's authoritative frames (identical:
// the sim is bit-exact) take over when they arrive. Everyone else replays the server's frames.
// The camera dollies down the table after the lead puck and returns for the next shot.

import { sfx } from '../sfx.js';
import { preferredLevel, levelSelect } from '../botLevel.js';
import { createResults, duelResults } from '../resultsPanel.js';
import { makeServerClock } from '../serverClock.js';
import { createFx } from '../canvasFx.js';

const COLORS = ['red', 'blue'];
const PUCK = {
  red: { top: '#e0283c', light: '#ff7a86', side: '#7a0d18' },
  blue: { top: '#2a6cf0', light: '#86b4ff', side: '#0c2a6e' },
};
const TEXT_COLOR = { red: '#ff5a6a', blue: '#5aa0ff' };
const HOLD_FRAMES = 8; // 30 fps frames to linger after the pucks stop
const TALLY_MS = 2300;
const D0 = 60; // camera distance (table units) to the bottom edge of the view
const CAM_MAX = 58;

const REJECT_MESSAGES = {
  not_your_turn: "It's not your turn.",
  busy: 'Wait for the pucks to stop.',
  not_playing: 'The game is not running.',
  invalid: 'Invalid shot.',
};

const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function loadScript(src, global) {
  if (window[global]) return Promise.resolve(window[global]);
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => resolve(window[global]);
    el.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(el);
  });
}

const CSS = `
.sb-root { display: flex; flex-direction: column; align-items: center; gap: 8px; font-family: monospace; color: #b8ffb0; width: 100%; }
.sb-status { font-size: 15px; font-weight: bold; letter-spacing: 1px; text-align: center; min-height: 20px; }
.sb-status.mine { color: #39ff14; text-shadow: 0 0 8px #39ff14; }
.sb-err { color: #ff5a5a; font-size: 12px; min-height: 14px; }
.sb-seats { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; align-items: center; }
.sb-seat { display: flex; align-items: center; gap: 6px; padding: 5px 8px; border: 1px solid #1d5c1d; border-radius: 6px; background: #071107; font-size: 13px; }
.sb-seat.turn { border-color: #39ff14; box-shadow: 0 0 10px -2px #39ff14; }
.sb-seat button, .sb-row button, .sb-row select { font: inherit; font-size: 12px; }
.sb-chip { width: 13px; height: 13px; border-radius: 50%; display: inline-block; box-shadow: inset 0 0 0 2px rgba(255,255,255,.55); }
.sb-chip.red { background: #e0283c; } .sb-chip.blue { background: #2a6cf0; }
.sb-stage { position: relative; width: min(100%, 520px); aspect-ratio: 3 / 4; max-height: 74vh; border: 1px solid #1d5c1d; border-radius: 10px; overflow: hidden;
  background: #020604; touch-action: none; user-select: none; -webkit-user-select: none; }
.sb-stage canvas { display: block; width: 100%; height: 100%; }
.sb-stage.can-shoot { cursor: grab; } .sb-stage.dragging { cursor: grabbing; }
.sb-hud { position: absolute; left: 0; right: 0; top: 0; display: flex; justify-content: space-between; align-items: flex-start; padding: 8px 10px; pointer-events: none; font-size: 13px; text-shadow: 0 1px 2px #000; }
.sb-side { display: flex; flex-direction: column; gap: 3px; min-width: 0; max-width: 38%; }
.sb-side.right { align-items: flex-end; text-align: right; }
.sb-name { font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.sb-score { font-size: 26px; font-weight: bold; line-height: 1; text-shadow: 0 0 10px currentColor, 0 2px 2px #000; transition: transform .2s; }
.sb-score.bump { transform: scale(1.35); }
.sb-left { display: flex; gap: 3px; }
.sb-left i { width: 9px; height: 9px; border-radius: 50%; display: block; box-shadow: inset 0 0 0 1.5px rgba(255,255,255,.6); }
.sb-left i.used { opacity: .18; }
.sb-mid { text-align: center; font-size: 11px; color: #9fdc98; padding-top: 2px; letter-spacing: 1px; }
.sb-mid b { display: block; font-size: 13px; color: #d8ffd0; }
.sb-hint { position: absolute; left: 0; right: 0; bottom: 12px; text-align: center; font-size: 12px; color: #d8ffd0; pointer-events: none; text-shadow: 0 1px 3px #000, 0 0 4px #000; animation: sb-hint 1.6s ease-in-out infinite alternate; }
@keyframes sb-hint { from { opacity: .5; } to { opacity: 1; } }
.sb-power { position: absolute; right: 10px; top: 50%; width: 14px; height: 50%; transform: translateY(-50%); border: 1px solid #39ff14; border-radius: 7px; background: rgba(0,0,0,.55); overflow: hidden; pointer-events: none; opacity: 0; transition: opacity .15s; }
.sb-power.on { opacity: 1; }
.sb-power > div.fill { position: absolute; left: 0; right: 0; bottom: 0; background: linear-gradient(0deg, #39ff14, #ffe14d 70%, #ff4d4d); }
.sb-power > span { position: absolute; left: 0; right: 0; height: 2px; background: rgba(255,255,255,.75); }
.sb-callout { position: absolute; left: 50%; top: 40%; transform: translate(-50%, -50%); font-size: 30px; font-weight: bold; letter-spacing: 3px; white-space: nowrap; pointer-events: none;
  text-shadow: 0 0 14px currentColor, 0 2px 3px #000; animation: sb-call 1.5s cubic-bezier(.2,1.4,.4,1) forwards; }
.sb-callout.small { font-size: 18px; top: 50%; }
@keyframes sb-call { 0% { opacity: 0; transform: translate(-50%, -50%) scale(.4); } 15% { opacity: 1; transform: translate(-50%, -50%) scale(1.08); }
  25% { transform: translate(-50%, -50%) scale(1); } 80% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -70%) scale(1); } }
.sb-row { display: flex; gap: 8px; align-items: center; justify-content: center; flex-wrap: wrap; font-size: 12px; }
.sb-help { font-size: 11px; opacity: .7; text-align: center; max-width: 520px; }
.sb-fail { padding: 30px; text-align: center; color: #ff8080; }
`;
let styled = false;
function ensureStyles() {
  if (styled) return;
  styled = true;
  const tag = document.createElement('style');
  tag.textContent = CSS;
  document.head.appendChild(tag);
}

// Top-down texture of the playing surface, far end (y = L) at the top. PX px per table unit.
const PX = 10;
function tableTexture(S) {
  const c = document.createElement('canvas');
  c.width = S.TABLE_W * PX;
  c.height = S.TABLE_L * PX;
  const g = c.getContext('2d');
  const Y = (y) => (S.TABLE_L - y) * PX; // table y -> texture row
  const grad = g.createLinearGradient(0, 0, c.width, 0);
  grad.addColorStop(0, '#a8763c');
  grad.addColorStop(0.5, '#d2a463');
  grad.addColorStop(1, '#a8763c');
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  // grain: seeded wavy streaks along the table
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 140; i++) {
    const x = rnd() * c.width;
    g.strokeStyle = `rgba(${rnd() < 0.5 ? '90,50,15' : '255,225,170'},${0.05 + rnd() * 0.1})`;
    g.lineWidth = 0.6 + rnd() * 1.8;
    g.beginPath();
    g.moveTo(x, 0);
    for (let y = 0; y <= c.height; y += 40) g.lineTo(x + Math.sin(y / (60 + rnd() * 90) + i) * 2.5, y);
    g.stroke();
  }
  // plank seams
  g.fillStyle = 'rgba(60,30,8,.35)';
  for (let k = 1; k < 4; k++) g.fillRect((c.width * k) / 4 - 0.5, 0, 1, c.height);
  // zones (tinted bands, far end)
  const band = (y0, y1, col) => { g.fillStyle = col; g.fillRect(0, Y(y1), c.width, Y(y0) - Y(y1)); };
  band(S.LINE1, S.LINE2, 'rgba(57,255,20,.07)');
  band(S.LINE2, S.LINE3, 'rgba(255,225,77,.09)');
  band(S.LINE3, S.TABLE_L, 'rgba(255,77,77,.10)');
  const line = (y, col, w, dash) => {
    g.save();
    g.strokeStyle = col;
    g.lineWidth = w;
    if (dash) g.setLineDash(dash);
    g.beginPath(); g.moveTo(0, Y(y)); g.lineTo(c.width, Y(y)); g.stroke();
    g.restore();
  };
  for (const y of [S.LINE1, S.LINE2, S.LINE3]) line(y, 'rgba(255,255,255,.85)', 3);
  line(S.FOUL_Y, 'rgba(255,70,70,.85)', 3, [14, 10]);
  line(S.START_Y + S.R + 0.6, 'rgba(255,255,255,.35)', 2);
  // painted numbers, upright for the shooter (stretched tall: the view squashes them)
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const num = (n, y0, y1, col) => {
    g.save();
    g.translate(c.width / 2, (Y(y0) + Y(y1)) / 2);
    g.scale(1, 2.2);
    g.font = `bold ${Math.round(PX * 3.4)}px monospace`;
    g.fillStyle = col;
    g.fillText(String(n), 0, 0);
    g.restore();
  };
  num(1, S.LINE1, S.LINE2, 'rgba(40,20,5,.55)');
  num(2, S.LINE2, S.LINE3, 'rgba(40,20,5,.55)');
  num(3, S.LINE3, S.TABLE_L, 'rgba(120,10,10,.6)');
  g.save();
  g.translate(c.width / 2, (Y(S.FOUL_Y) + Y(S.FOUL_Y - 8)) / 2);
  g.scale(1, 2.2);
  g.font = `bold ${PX * 1.6}px monospace`;
  g.fillStyle = 'rgba(120,10,10,.45)';
  g.fillText('FOUL LINE', 0, 0);
  g.restore();
  // varnish sheen
  const sheen = g.createLinearGradient(0, 0, 0, c.height);
  sheen.addColorStop(0, 'rgba(255,255,255,.10)');
  sheen.addColorStop(0.5, 'rgba(255,255,255,0)');
  sheen.addColorStop(1, 'rgba(0,0,0,.12)');
  g.fillStyle = sheen;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

export function mount(container, api) {
  ensureStyles();
  let view = null;
  let roster = [];
  let flashError = null;
  let flashTimer = null;
  let destroyed = false;
  let S = null;
  let tex = null;
  let raf = 0;
  const clock = makeServerClock();
  const fx = createFx();

  const root = document.createElement('div');
  root.className = 'sb-root';
  container.appendChild(root);
  const results = createResults(container);

  const status = document.createElement('div');
  status.className = 'sb-status';
  const err = document.createElement('div');
  err.className = 'sb-err';
  const seats = document.createElement('div');
  seats.className = 'sb-seats';
  const stage = document.createElement('div');
  stage.className = 'sb-stage';
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  // HUD, built once and patched in place
  const hud = document.createElement('div');
  hud.className = 'sb-hud';
  const hudSide = {};
  for (const c of COLORS) {
    const side = document.createElement('div');
    side.className = `sb-side${c === 'blue' ? ' right' : ''}`;
    side.style.color = TEXT_COLOR[c];
    const name = document.createElement('div');
    name.className = 'sb-name';
    const score = document.createElement('div');
    score.className = 'sb-score';
    const left = document.createElement('div');
    left.className = 'sb-left';
    const dots = [];
    for (let i = 0; i < 4; i++) {
      const d = document.createElement('i');
      d.style.background = PUCK[c].top;
      left.appendChild(d);
      dots.push(d);
    }
    side.append(name, score, left);
    hudSide[c] = { side, name, score, dots, shown: null };
  }
  const mid = document.createElement('div');
  mid.className = 'sb-mid';
  hud.append(hudSide.red.side, mid, hudSide.blue.side);
  const hint = document.createElement('div');
  hint.className = 'sb-hint';
  const power = document.createElement('div');
  power.className = 'sb-power';
  const powerFill = document.createElement('div');
  powerFill.className = 'fill';
  power.appendChild(powerFill);
  stage.append(canvas, hud, hint, power);

  const options = document.createElement('div');
  options.className = 'sb-row';
  const help = document.createElement('div');
  help.className = 'sb-help';
  help.textContent = 'Drag sideways to place your puck, then drag UP and let go — tilt aims, length is power. '
    + 'Only the furthest puck\'s owner scores: 1/2/3 by zone, 4 for a HANGER over the edge, for every puck past the opponent\'s best. '
    + 'Pucks short of the red foul line are removed.';
  root.append(status, err, seats, stage, options, help);

  function nicknameFor(id) {
    if (!id) return null;
    if (id === 'BOT') return '(bot)';
    const e = roster.find((r) => r.clientId === id);
    return e ? e.nickname : 'someone';
  }
  function mySeat() {
    if (!view) return null;
    const me = api.getClientId();
    return view.players.red === me ? 'red' : view.players.blue === me ? 'blue' : null;
  }

  // ---- animation state ----
  const queue = []; // shot records waiting to play
  let anim = null; // { rec, start, fired:Set, local }
  let tally = null; // { rec, start } round-end scoring display
  let localPending = false;
  let lastSeqSeen = 0;
  let camY = 0;
  let aimX = 0; // start position across the table (table units)
  let drag = null; // { id, x0, y0, sx, mode:'slide'|'shot', ax, ay, aim, power }
  let fading = []; // [{ owner, x, y, born }] pucks cleared from the table
  const hudScores = { red: null, blue: null }; // shown scores (lag the state during replays)

  // ---- projection ----
  const P = { w: 1, h: 1, kx: 1, kH: 1, hz: 0, dpr: 1 };
  function layout(w, h) {
    P.w = w;
    P.h = h;
    P.kx = (0.86 * w * D0) / S.TABLE_W;
    const farZ = S.TABLE_L + 4 + D0;
    P.kH = (h * 0.84) / (1 / D0 - 1 / farZ);
    P.hz = h * 0.1 - P.kH / farZ;
  }
  const zOf = (y) => y - camY + D0;
  function proj(x, y) {
    const z = zOf(y);
    return { x: P.w / 2 + (P.kx * x) / z, y: P.hz + P.kH / z, z };
  }

  function callout(text, color, small) {
    if (reduced() && small) return;
    const el = document.createElement('div');
    el.className = `sb-callout${small ? ' small' : ''}`;
    el.style.color = color || '#39ff14';
    el.textContent = text;
    stage.appendChild(el);
    setTimeout(() => el.remove(), 1600);
  }

  // ---- shots ----
  function startAnim(rec, start, local) {
    anim = { rec, start, fired: new Set(), local };
    if (!local) sfx.play('whoosh', { vol: 0.6 });
  }

  function finishAnim() {
    const rec = anim.rec;
    anim = null;
    const me = rec.after.find((p) => p.id === rec.shotId);
    if (me && S.zoneValue(me) === 4) {
      callout('HANGER!', '#ffe14d');
      sfx.play('chime');
    }
    if (rec.roundEnd) {
      tally = { rec, start: performance.now(), fired: false };
    } else {
      afterShot();
    }
    renderDom();
  }

  function afterShot() {
    if (queue.length) {
      startAnim(queue.shift(), performance.now(), false);
      return;
    }
    for (const c of COLORS) hudScores[c] = view.scores[c];
    if (view.phase === 'playing') {
      const seat = mySeat();
      if (seat && view.turn === seat) setTimeout(() => sfx.play('turn'), 150);
    }
  }

  function finishTally() {
    const rec = tally.rec;
    tally = null;
    const now = performance.now();
    fading = rec.after.map((p) => ({ owner: p.owner, x: p.x, y: p.y, born: now }));
    afterShot();
    renderDom();
  }

  function onNewShot(rec) {
    if (rec.seq <= lastSeqSeen) return;
    lastSeqSeen = rec.seq;
    if (anim && anim.local && localPending && rec.by === mySeat()) {
      anim.rec = rec; // same frames — the sim is bit-exact — but now with the round result
      anim.local = false;
      localPending = false;
      return;
    }
    localPending = false;
    if (anim || tally) queue.push(rec);
    else startAnim(rec, performance.now(), false);
  }

  // ---- input ----
  function canShoot() {
    const seat = mySeat();
    return !!(S && view && seat && view.phase === 'playing' && view.turn === seat && !anim && !tally && !queue.length
      && !localPending && clock.now() >= view.busyUntil - 150);
  }

  stage.addEventListener('pointerdown', (e) => {
    if (!canShoot()) return;
    e.preventDefault();
    stage.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, sx: aimX, mode: 'slide', ax: 0, ay: 0, aim: 0, power: 0 };
    stage.classList.add('dragging');
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const r = stage.getBoundingClientRect();
    const scale = P.w / r.width; // CSS px -> canvas layout px
    if (drag.mode === 'slide') {
      if (drag.y0 - e.clientY > 16) {
        drag.mode = 'shot';
        drag.ax = e.clientX;
        drag.ay = drag.y0;
      } else {
        const unitsPerPx = zOf(S.START_Y) / P.kx;
        aimX = Math.max(-S.X_MAX, Math.min(S.X_MAX, drag.sx + (e.clientX - drag.x0) * scale * unitsPerPx));
        return;
      }
    }
    const ddx = (e.clientX - drag.ax) * scale;
    const ddy = (drag.ay - e.clientY) * scale;
    if (ddy > 10) drag.aim = Math.max(-1, Math.min(1, ddx / ddy / 0.48));
    drag.power = Math.max(0, Math.min(1, (ddy - 10) / (P.h * 0.5)));
    power.classList.add('on');
    powerFill.style.height = `${(drag.power * 100).toFixed(1)}%`;
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    stage.classList.remove('dragging');
    power.classList.remove('on');
    if (e.type === 'pointercancel' || d.mode !== 'shot' || d.power < 0.01) return;
    if (!canShoot()) return;
    const seat = mySeat();
    const input = S.normInput({ x: aimX / S.X_MAX, aim: d.aim, power: d.power });
    const res = S.simulate(view.pucks, input, seat, view.nextId);
    if (!res) return;
    localPending = true;
    startAnim({ seq: -1, by: seat, shotId: view.nextId, input, order: res.order, owners: res.owners, frames: res.frames,
      events: res.events, before: view.pucks, after: res.after, removed: res.removed, roundEnd: null }, performance.now(), true);
    sfx.play('whoosh', { vol: 0.6 });
    api.sendAction({ kind: 'shoot', x: input.x, aim: input.aim, power: input.power });
    renderDom();
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  // Power-meter tick marks where an unobstructed straight shot stops in each zone.
  function powerTicks() {
    for (const el of [...power.querySelectorAll('span')]) el.remove();
    for (const y of [S.LINE1 + S.R, S.LINE2 + S.R, S.LINE3 + S.R, S.TABLE_L - S.R / 2]) {
      const t = document.createElement('span');
      t.style.bottom = `${(S.powerFor(y - S.START_Y) * 100).toFixed(1)}%`;
      if (y > S.TABLE_L - S.R) t.style.background = '#ffe14d';
      power.appendChild(t);
    }
  }

  // ---- drawing ----
  function drawTable() {
    const L = S.TABLE_L;
    const W2 = S.TABLE_W / 2;
    const y0 = Math.max(0, camY - 6);
    const g = ctx;
    // floor glow + grid
    const bg = g.createRadialGradient(P.w / 2, P.h * 0.35, 10, P.w / 2, P.h * 0.4, P.h * 0.9);
    bg.addColorStop(0, '#10261a');
    bg.addColorStop(1, '#020604');
    g.fillStyle = bg;
    g.fillRect(0, 0, P.w, P.h);
    g.strokeStyle = 'rgba(57,255,20,.07)';
    g.lineWidth = 1;
    for (let y = Math.ceil(y0 / 8) * 8; y < L + 40; y += 8) {
      const a = proj(-60, y); const b = proj(60, y);
      if (a.z < 4) continue;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }
    // gutters (dark troughs) + rail
    const quad = (x0, x1, ya, yb, fill) => {
      const a = proj(x0, ya); const b = proj(x1, ya); const c = proj(x1, yb); const d = proj(x0, yb);
      g.fillStyle = fill;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(c.x, c.y); g.lineTo(d.x, d.y); g.closePath(); g.fill();
    };
    quad(-W2 - 2.2, W2 + 2.2, y0, L + 3, '#0b0f0b');
    quad(-W2 - 1.6, -W2, y0, L + 2.4, '#050705');
    quad(W2, W2 + 1.6, y0, L + 2.4, '#050705');
    quad(-W2 - 1.6, W2 + 1.6, L, L + 2.4, '#050705');
    // wood surface, drawn as thin strips of the texture (affine per strip ~ exact perspective)
    const step = 1;
    for (let y = y0; y < L; y += step) {
      const yb = Math.min(L, y + step);
      const a = proj(-W2, y); const b = proj(W2, yb);
      const top = b.y; const bot = a.y;
      if (bot - top <= 0) continue;
      const wMid = (P.kx * S.TABLE_W) / zOf((y + yb) / 2);
      const sy = (L - yb) * PX;
      g.drawImage(tex, 0, sy, tex.width, (yb - y) * PX, P.w / 2 - wMid / 2, top, wMid, bot - top + 0.6);
    }
    // neon edges
    g.save();
    g.strokeStyle = '#39ff14';
    g.shadowColor = '#39ff14';
    g.shadowBlur = 10;
    g.lineWidth = 2;
    const pl = (pts) => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.stroke(); };
    pl([proj(-W2 - 2.2, y0), proj(-W2 - 2.2, L + 3), proj(W2 + 2.2, L + 3), proj(W2 + 2.2, y0)]);
    g.strokeStyle = 'rgba(255,225,77,.9)';
    g.shadowColor = '#ffe14d';
    pl([proj(-W2, L), proj(W2, L)]);
    g.restore();
    // "4" hanger label on the end rail
    const lab = proj(0, L + 1.2);
    g.save();
    g.font = `bold ${Math.max(9, Math.round((P.kx * 1.6) / lab.z))}px monospace`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffe14d';
    g.shadowColor = '#ffe14d';
    g.shadowBlur = 8;
    g.fillText('4 · HANGER · 4', lab.x, lab.y);
    g.restore();
  }

  function drawPuck(owner, x, y, { alpha = 1, scale = 1, drop = 0, glow = null } = {}) {
    const p = proj(x, y);
    if (p.z < 3) return;
    const rx = ((P.kx * S.R) / p.z) * scale;
    const ry = rx * Math.max(0.28, (P.kH / P.kx) / p.z);
    const th = ((P.kx * 0.55) / p.z) * scale;
    const cy = p.y - th + drop;
    const col = PUCK[owner];
    const g = ctx;
    g.save();
    g.globalAlpha = alpha;
    if (!drop) { // shadow
      g.fillStyle = 'rgba(0,0,0,.35)';
      g.beginPath(); g.ellipse(p.x + rx * 0.12, p.y + ry * 0.25, rx * 1.05, ry * 1.05, 0, 0, Math.PI * 2); g.fill();
    }
    if (glow) {
      g.shadowColor = glow;
      g.shadowBlur = 16;
    }
    // side band
    g.fillStyle = '#9aa3ad';
    g.beginPath();
    g.ellipse(p.x, cy + th, rx, ry, 0, 0, Math.PI);
    g.lineTo(p.x - rx, cy);
    g.ellipse(p.x, cy, rx, ry, 0, Math.PI, 0, true);
    g.closePath();
    g.fill();
    g.shadowBlur = 0;
    // chrome rim + coloured top
    const rim = g.createLinearGradient(p.x - rx, cy, p.x + rx, cy);
    rim.addColorStop(0, '#cfd6de'); rim.addColorStop(0.5, '#ffffff'); rim.addColorStop(1, '#8b939c');
    g.fillStyle = rim;
    g.beginPath(); g.ellipse(p.x, cy, rx, ry, 0, 0, Math.PI * 2); g.fill();
    const top = g.createRadialGradient(p.x - rx * 0.3, cy - ry * 0.4, rx * 0.05, p.x, cy, rx * 0.8);
    top.addColorStop(0, col.light); top.addColorStop(0.6, col.top); top.addColorStop(1, col.side);
    g.fillStyle = top;
    g.beginPath(); g.ellipse(p.x, cy, rx * 0.78, ry * 0.78, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.35)';
    g.lineWidth = Math.max(0.5, rx * 0.06);
    g.beginPath(); g.ellipse(p.x, cy, rx * 0.45, ry * 0.45, 0, 0, Math.PI * 2); g.stroke();
    g.restore();
    return { x: p.x, y: cy, rx };
  }

  // Current puck positions to draw: [{ owner, x, y, opts }]
  function scenePucks(now) {
    const list = [];
    if (anim) {
      const rec = anim.rec;
      const f = (now - anim.start) / S.FRAME_MS;
      const n = rec.frames.length;
      const i = Math.max(0, Math.min(n - 1, Math.floor(f)));
      const t = Math.max(0, Math.min(1, f - i));
      const A = rec.frames[i];
      const B = rec.frames[Math.min(n - 1, i + 1)];
      const gone = new Map();
      for (const ev of rec.events) if (ev.type === 'fall' || ev.type === 'short') gone.set(ev.id, ev);
      let lead = -1;
      rec.order.forEach((id, k) => {
        const owner = rec.owners[k];
        let x = A[k * 2] + (B[k * 2] - A[k * 2]) * t;
        let y = A[k * 2 + 1] + (B[k * 2 + 1] - A[k * 2 + 1]) * t;
        const ev = gone.get(id);
        if (ev && f >= ev.f) {
          const age = (f - ev.f) / 30; // seconds
          if (ev.type === 'short') {
            list.push({ owner, x, y, opts: { alpha: Math.max(0, 1 - age * 2.5) } });
            return;
          }
          if (age > 0.6) return;
          // keep sliding over the edge, then drop into the gutter
          x += ev.vx * age * 0.5;
          y += ev.vy * age * 0.5;
          list.push({ owner, x, y, opts: { alpha: 1 - age / 0.6, drop: age * age * 120, scale: 1 - age * 0.5 } });
          return;
        }
        const moving = A[k * 2] !== B[k * 2] || A[k * 2 + 1] !== B[k * 2 + 1];
        if (moving && y > lead) lead = y;
        list.push({ owner, x, y, opts: id === rec.shotId ? { glow: '#ffffff' } : {} });
      });
      anim.lead = lead;
      // events: sounds + sparks
      for (const ev of rec.events) {
        const key = `${ev.type}:${ev.f}:${ev.id || `${ev.a}-${ev.b}`}`;
        if (f < ev.f || anim.fired.has(key)) continue;
        anim.fired.add(key);
        if (ev.type === 'hit') {
          const ka = rec.order.indexOf(ev.a);
          const kb = rec.order.indexOf(ev.b);
          const fr = rec.frames[Math.min(n - 1, ev.f)];
          const p = proj((fr[ka * 2] + fr[kb * 2]) / 2, (fr[ka * 2 + 1] + fr[kb * 2 + 1]) / 2);
          sfx.play(ev.s > 15 ? 'capture' : 'tick');
          fx.burst(p.x, p.y, '#fff3c0', { count: Math.min(30, 6 + ev.s), speed: 60 + ev.s * 6, life: 0.4, size: 2 });
          if (ev.s > 25) fx.shake(4);
        } else if (ev.type === 'fall') {
          const k = rec.order.indexOf(ev.id);
          const fr = rec.frames[Math.min(n - 1, ev.f)];
          const p = proj(fr[k * 2], fr[k * 2 + 1]);
          sfx.play('pop');
          fx.burst(p.x, p.y, PUCK[rec.owners[k]].top, { count: 18, speed: 120, life: 0.5, gravity: 300 });
          if (rec.owners[k] !== rec.by) callout('KNOCKED OFF!', TEXT_COLOR[rec.by], true);
          else if (ev.id === rec.shotId) callout(ev.why === 'side' ? 'GUTTER' : 'OFF THE END', '#9fb39c', true);
        } else if (ev.type === 'short') {
          sfx.play('blip');
          if (ev.id === rec.shotId) callout('SHORT', '#9fb39c', true);
        }
      }
      if (f > n + HOLD_FRAMES) {
        if (!anim.local) finishAnim();
        else if (f > n + 240) { anim = null; localPending = false; renderDom(); } // server never answered
      }
      return list;
    }
    const resting = tally ? tally.rec.after : view ? view.pucks : [];
    const counted = tally && tally.rec.roundEnd ? new Map(tally.rec.roundEnd.counted.map((c) => [c.id, c.value])) : null;
    for (const p of resting) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 120);
      list.push({ owner: p.owner, x: p.x, y: p.y, id: p.id, opts: counted && counted.has(p.id) ? { glow: pulse > 0.5 ? '#ffe14d' : '#fff' } : {} });
    }
    for (let i = fading.length - 1; i >= 0; i--) {
      const fp = fading[i];
      const a = 1 - (now - fp.born) / 450;
      if (a <= 0) { fading.splice(i, 1); continue; }
      list.push({ owner: fp.owner, x: fp.x, y: fp.y, opts: { alpha: a, scale: 0.6 + 0.4 * a } });
    }
    return list;
  }

  function drawAim() {
    const seat = mySeat();
    const p0 = { x: aimX, y: S.START_Y };
    if (drag && drag.mode === 'shot' && drag.power > 0) {
      const inp = S.normInput({ x: aimX / S.X_MAX, aim: drag.aim, power: drag.power });
      const v = S.launch(inp);
      const sp = Math.hypot(v.vx, v.vy);
      const len = 14 + drag.power * 40;
      ctx.save();
      for (let k = 1; k <= 14; k++) {
        const d = (len * k) / 14;
        const q = proj(p0.x + (v.vx / sp) * d, p0.y + (v.vy / sp) * d);
        ctx.globalAlpha = 0.9 * (1 - k / 15);
        ctx.fillStyle = TEXT_COLOR[seat];
        ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(1.5, (P.kx * 0.32) / q.z), 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    } else {
      // slide arrows either side of the waiting puck
      const p = proj(aimX, S.START_Y);
      const r = (P.kx * S.R) / p.z;
      ctx.save();
      ctx.fillStyle = 'rgba(57,255,20,.8)';
      ctx.font = `bold ${Math.round(r * 0.9)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('◀', p.x - r * 2, p.y - r * 0.4);
      ctx.fillText('▶', p.x + r * 2, p.y - r * 0.4);
      ctx.restore();
    }
    return p0;
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!S || !view) return;
    // canvas sizing (HiDPI)
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr) || P.w !== w || P.h !== h) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      layout(w, h);
    }
    P.dpr = dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const pucks = scenePucks(now);
    // camera: follow the lead moving puck down the table, return for the next shot
    let target = 0;
    if (anim && anim.lead > 0) target = Math.min(CAM_MAX, Math.max(0, anim.lead - 30));
    else if (anim || tally) target = camY >= CAM_MAX * 0.5 ? CAM_MAX : camY;
    if (anim && !(anim.lead > 0)) target = camY; // everything stopped: hold
    camY = reduced() ? target : camY + (target - camY) * 0.06;
    if (Math.abs(target - camY) < 0.01) camY = target;

    fx.applyShake(ctx);
    drawTable();
    const showHeld = canShoot() || !!drag;
    if (showHeld) drawAim();
    pucks.sort((a, b) => b.y - a.y);
    const drawn = [];
    for (const p of pucks) drawn.push([p, drawPuck(p.owner, p.x, p.y, p.opts)]);
    if (showHeld) drawPuck(mySeat(), aimX, S.START_Y, { glow: '#39ff14' });
    // tally: +N over every counted puck
    if (tally && !tally.fired) {
      tally.fired = true;
      const re = tally.rec.roundEnd;
      for (const [p, s] of drawn) {
        const c = re.counted.find((cc) => cc.id === p.id);
        if (c && s) {
          fx.text(s.x, s.y - 10, `+${c.value}`, '#ffe14d', { size: 18, life: 1.8 });
          fx.ring(s.x, s.y, '#ffe14d', { radius: s.rx * 3, life: 0.7 });
        }
      }
      if (re.scorer) {
        callout(`${re.scorer.toUpperCase()} +${re.points}`, TEXT_COLOR[re.scorer]);
        sfx.play('point');
        setTimeout(() => sfx.play('chips'), 250);
      } else {
        callout('NO SCORE', '#9fb39c');
        sfx.play('blip');
      }
      for (const c of COLORS) hudScores[c] = re.scores[c];
      renderHud(true);
    }
    fx.draw(ctx);
    ctx.restore();
    fx.drawOverlay(ctx, P.w, P.h);
    if (tally && now - tally.start > TALLY_MS) finishTally();
    if (stage.classList.contains('can-shoot') !== canShoot()) renderStatus();
  }

  // ---- DOM ----
  function seatBox(color) {
    const box = document.createElement('div');
    box.className = `sb-seat${view.phase === 'playing' && view.turn === color ? ' turn' : ''}`;
    const chip = document.createElement('span');
    chip.className = `sb-chip ${color}`;
    const name = document.createElement('span');
    const occ = view.players[color];
    name.textContent = `${color.toUpperCase()}: ${nicknameFor(occ) || '(empty)'}${occ && occ === api.getClientId() ? ' (you)' : ''}`;
    name.style.color = TEXT_COLOR[color];
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

  // Which side the table is showing as "on turn" and how many pucks each has left (lags the
  // state while a shot replays).
  function shownTurn() {
    if (anim) return anim.rec.by;
    if (tally) return null;
    return view.turn;
  }

  function renderHud(bump) {
    if (!view) return;
    const playing = view.phase !== 'waiting';
    for (const c of COLORS) {
      const h = hudSide[c];
      h.name.textContent = nicknameFor(view.players[c]) || c.toUpperCase();
      const sc = hudScores[c] == null ? view.scores[c] : hudScores[c];
      if (h.score.textContent !== String(sc)) {
        h.score.textContent = String(sc);
        if (bump) {
          h.score.classList.add('bump');
          setTimeout(() => h.score.classList.remove('bump'), 250);
        }
      }
      // pucks left as the table shows it
      // the state already counts the shot being replayed; during a round's final shot/tally the
      // state has moved on to the next round's fresh 4, so show the finished round as spent
      const ending = (anim && anim.rec.roundEnd) || tally;
      const left = ending ? 0 : view.left[c];
      h.dots.forEach((d, i) => d.classList.toggle('used', !playing || i >= left));
    }
    mid.innerHTML = '';
    const b = document.createElement('b');
    b.textContent = view.phase === 'waiting' ? 'SHUFFLEBOARD' : `ROUND ${view.round}`;
    mid.append(b, document.createTextNode(`FIRST TO ${view.target}`));
  }

  function renderStatus() {
    if (!view) { status.textContent = 'Loading...'; return; }
    const seat = mySeat();
    const over = view.phase === 'game_over' && !anim && !tally && !queue.length;
    const t = shownTurn();
    status.className = 'sb-status';
    status.style.color = '';
    if (view.phase === 'waiting') status.textContent = 'Waiting for both seats to be filled.';
    else if (over) {
      status.textContent = `${view.winner.toUpperCase()} WINS ${view.scores[view.winner]}–${view.scores[view.winner === 'red' ? 'blue' : 'red']}!`;
      status.style.color = '#ffb000';
    } else if (!t) {
      const re = tally.rec.roundEnd;
      status.textContent = re.scorer ? `ROUND ${tally.rec.round}: ${re.scorer.toUpperCase()} SCORES ${re.points}` : `ROUND ${tally.rec.round}: NO SCORE`;
      status.style.color = re.scorer ? TEXT_COLOR[re.scorer] : '#9fb39c';
    } else if (seat && t === seat) {
      const n = 5 - Math.max(1, view.left[seat]);
      status.textContent = anim ? '▶ YOUR SHOT…' : `▶ YOUR SHOT — puck ${n} of 4`;
      status.classList.add('mine');
    } else {
      status.textContent = `${t.toUpperCase()} SHOOTING — ${nicknameFor(view.players[t])}`;
      status.style.color = TEXT_COLOR[t];
    }
    const cs = canShoot();
    stage.classList.toggle('can-shoot', cs);
    hint.textContent = cs ? 'DRAG ◀ ▶ TO PLACE · DRAG UP & RELEASE TO SHOOT' : '';
  }

  function renderDom() {
    if (destroyed) return;
    const seat = mySeat();
    const over = view && view.phase === 'game_over' && !anim && !tally && !queue.length;
    results.update(over ? duelResults({
      winner: view.winner, colors: COLORS, players: view.players, me: seat, nameFor: nicknameFor,
      subtitle: `${view.scores.red}–${view.scores.blue} in ${view.history.length} round${view.history.length === 1 ? '' : 's'}`
        + ` · hangers ${view.stats.red.hangers}/${view.stats.blue.hangers} · knock-offs ${view.stats.red.knockoffs}/${view.stats.blue.knockoffs}`,
      onRematch: () => api.sendAction({ kind: 'resetGame' }),
    }) : null);
    renderStatus();
    if (!view) return;
    err.textContent = flashError ? REJECT_MESSAGES[flashError] || 'Shot rejected' : '';
    seats.innerHTML = '';
    seats.append(seatBox('red'), seatBox('blue'));
    if (seat) {
      const leave = document.createElement('button');
      leave.textContent = 'LEAVE SEAT';
      leave.addEventListener('click', () => api.sendAction({ kind: 'leaveSeat' }));
      seats.appendChild(leave);
    }
    renderHud(false);
    options.innerHTML = '';
    if (view.phase !== 'playing') {
      const lab = document.createElement('label');
      lab.textContent = 'Play to ';
      const sel = document.createElement('select');
      for (const t of [15, 21]) {
        const o = document.createElement('option');
        o.value = String(t);
        o.textContent = `${t} points`;
        sel.appendChild(o);
      }
      sel.value = String(view.target);
      sel.addEventListener('change', () => api.sendAction({ kind: 'setTarget', target: Number(sel.value) }));
      lab.appendChild(sel);
      options.appendChild(lab);
    }
    if (over && seat) {
      const again = document.createElement('button');
      again.textContent = 'REMATCH (SWAP COLOURS)';
      again.addEventListener('click', () => api.sendAction({ kind: 'resetGame' }));
      options.appendChild(again);
    }
  }

  // ---- boot ----
  loadScript('games/shuffleboard/sim.js', 'ShuffleSim')
    .then((Sim) => {
      if (destroyed) return;
      S = Sim;
      tex = tableTexture(S);
      powerTicks();
      raf = requestAnimationFrame(frame);
      renderDom();
    })
    .catch(() => {
      stage.innerHTML = '<div class="sb-fail">Could not load the game.</div>';
    });

  renderDom();

  function applyState(data, fromSnapshot) {
    const prev = view;
    view = data;
    clock.sync(data.serverNow);
    if (fromSnapshot || !prev || prev.gameId !== data.gameId) {
      anim = null;
      tally = null;
      queue.length = 0;
      localPending = false;
      fading = [];
      lastSeqSeen = data.lastShot ? data.lastShot.seq : 0;
      for (const c of COLORS) hudScores[c] = data.scores[c];
      camY = 0;
      if (prev && prev.phase !== 'playing' && data.phase === 'playing') sfx.play('go');
    } else if (data.lastShot && data.lastShot.seq > lastSeqSeen) {
      onNewShot(data.lastShot);
    }
    if (prev && !prev.winner && data.winner && prev.gameId === data.gameId) {
      const seat = mySeat();
      const rec = data.lastShot;
      const delay = rec ? rec.frames.length * S.FRAME_MS + TALLY_MS * 0.4 : 0;
      setTimeout(() => sfx.play(!seat ? 'point' : data.winner === seat ? 'win' : 'lose'), delay);
    }
    flashError = null;
    renderDom();
  }

  return {
    applySnapshot(snapshot) {
      applyState(snapshot, true);
    },
    applyEvent(data) {
      if (!data) return;
      if (data.kind === 'state') applyState(data, false);
      else if (data.kind === 'moveRejected') {
        if (anim && anim.local) {
          anim = null;
          localPending = false;
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
