// Paintball client — a 2D canvas carnival shooting gallery over the shared sim (sim.js). The
// target schedule comes from the game's seed, so every browser draws the same run. The shooter's
// shots are applied locally the instant they're fired (same gun rules + hit-testing as the server)
// and sent as { t, x, y }; everyone else replays the server's accepted events on a slightly
// delayed clock so splats land in sync with the targets they hit. Misses leave paint on the
// scenery (one paint layer per barricade + the back wall); hits splat the cardboard as it falls.

import { sfx } from '../sfx.js';
import { preferredLevel, levelSelect } from '../botLevel.js';
import { createResults, duelResults } from '../resultsPanel.js';
import { makeServerClock } from '../serverClock.js';
import { createFx, flashEl } from '../canvasFx.js';
import { loadScript } from '../loadScript.js';
import { injectStyle } from '../dom.js';

const COLORS = ['red', 'blue'];
const PAINT = { red: '#ff2d55', blue: '#2f8bff' };
const TEXT_COLOR = { red: '#ff5a6a', blue: '#5aa0ff' };
const SPECT_DELAY = 350; // spectators watch slightly behind so streamed shots arrive in time
const FALL_MS = 320;
const FX_WINDOW = 450; // events older than this when applied are catch-up: no fx / sound

const REJECT_MESSAGES = {
  not_your_turn: "It's not your turn.",
  not_playing: 'The game is not running.',
  not_started: 'Wait for GO',
  bad_time: 'Shot arrived too late (lag).',
  too_fast: 'Too fast.',
  empty: 'Out of paint. Reload (R)',
  reloading: 'Still reloading.',
  full: 'Hopper is already full.',
  time_up: "Time's up.",
  too_many: 'Too many shots.',
  invalid: 'Invalid shot.',
};

const CSS = `
.pb-root { display: flex; flex-direction: column; align-items: center; gap: 8px; font-family: monospace; color: #b8ffb0; width: 100%; }
.pb-status { font-size: 15px; font-weight: bold; letter-spacing: 1px; text-align: center; min-height: 20px; }
.pb-status.mine { color: #39ff14; text-shadow: 0 0 8px #39ff14; }
.pb-err { color: #ff5a5a; font-size: 12px; min-height: 14px; }
.pb-seats { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; align-items: center; }
.pb-seat { display: flex; align-items: center; gap: 6px; padding: 5px 8px; border: 1px solid #1d5c1d; border-radius: 6px; background: #071107; font-size: 13px; }
.pb-seat.turn { border-color: #39ff14; box-shadow: 0 0 10px -2px #39ff14; }
.pb-seat button { font: inherit; font-size: 12px; }
.pb-dot { width: 12px; height: 12px; border-radius: 50%; display: inline-block; box-shadow: inset -2px -2px 3px rgba(0,0,0,.35); }
.pb-score { font-weight: bold; color: #ffe14d; }
.pb-stage { position: relative; width: min(100%, 820px); aspect-ratio: 8 / 5; border: 1px solid #1d5c1d; border-radius: 10px; overflow: hidden;
  background: #05070d; touch-action: none; user-select: none; -webkit-user-select: none; }
.pb-stage canvas { display: block; width: 100%; height: 100%; }
.pb-stage.aiming { cursor: none; } .pb-stage.can-start { cursor: pointer; }
.pb-reload { position: absolute; right: 8px; bottom: 8px; font: bold 13px monospace; letter-spacing: 1px; padding: 8px 12px; border-radius: 8px;
  border: 2px solid #ffe14d; background: rgba(20,14,0,.75); color: #ffe14d; cursor: pointer; touch-action: manipulation; }
.pb-reload.urgent { animation: pb-pulse .5s ease-in-out infinite alternate; border-color: #ff4d4d; color: #ff8080; }
.pb-reload[hidden] { display: none; }
@keyframes pb-pulse { from { transform: scale(1); } to { transform: scale(1.08); box-shadow: 0 0 14px #ff4d4d; } }
.pb-help { font-size: 11px; opacity: .7; text-align: center; max-width: 620px; }
.pb-fail { padding: 30px; text-align: center; color: #ff8080; }
`;

// ---- drawing helpers (all in the 800 x 500 logical space) -------------------------------------
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const splatSeed = (ev) => (Math.round(ev.x * 10) * 73856093) ^ (Math.round(ev.y * 10) * 19349663) ^ (ev.t * 83492791);

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.max(0, Math.min(255, Math.round(c * k)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

// A paint splat: a lumpy blob, flung droplets, optional drips and a wet highlight.
function drawSplat(g, x, y, r, color, seed, drips) {
  const rand = rng(seed);
  g.fillStyle = color;
  g.beginPath();
  const n = 14;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (0.7 + rand() * 0.5);
    pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
  }
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    const mx = (p[0] + q[0]) / 2;
    const my = (p[1] + q[1]) / 2;
    if (i === 0) g.moveTo(mx, my);
    else g.quadraticCurveTo(p[0], p[1], mx, my);
  }
  g.quadraticCurveTo(pts[0][0], pts[0][1], (pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2);
  g.fill();
  const drops = 5 + Math.floor(rand() * 5);
  for (let i = 0; i < drops; i++) {
    const a = rand() * Math.PI * 2;
    const d = r * (1.05 + rand() * 1.1);
    g.beginPath();
    g.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, r * (0.07 + rand() * 0.2), 0, Math.PI * 2);
    g.fill();
  }
  if (drips) {
    const nd = Math.floor(rand() * 3);
    for (let i = 0; i < nd; i++) {
      const dx = (rand() - 0.5) * r * 1.1;
      const len = r * (0.6 + rand() * 1.4);
      const wd = r * (0.14 + rand() * 0.1);
      g.fillRect(x + dx - wd / 2, y, wd, len);
      g.beginPath();
      g.arc(x + dx, y + len, wd * 0.75, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.fillStyle = 'rgba(255,255,255,0.28)';
  g.beginPath();
  g.ellipse(x - r * 0.25, y - r * 0.3, r * 0.32, r * 0.18, -0.5, 0, Math.PI * 2);
  g.fill();
}

function drawBackdrop(g, S) {
  const { W, H, LANES } = S;
  const rand = rng(1234);
  // back wall: vertical planks
  const wall = g.createLinearGradient(0, 40, 0, H);
  wall.addColorStop(0, '#2a1a10');
  wall.addColorStop(1, '#3b2414');
  g.fillStyle = wall;
  g.fillRect(0, 0, W, H);
  for (let x = 0; x < W; x += 46) {
    g.fillStyle = `rgba(0,0,0,${0.18 + rand() * 0.15})`;
    g.fillRect(x, 40, 2, H);
    g.fillStyle = `rgba(255,220,170,${0.03 + rand() * 0.04})`;
    g.fillRect(x + 2, 40, 44, H);
    g.strokeStyle = 'rgba(0,0,0,0.12)';
    g.lineWidth = 1;
    for (let k = 0; k < 3; k++) {
      const gx = x + 8 + rand() * 30;
      g.beginPath();
      g.moveTo(gx, 40);
      g.bezierCurveTo(gx + 6, 160, gx - 6, 300, gx + 3, H);
      g.stroke();
    }
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.beginPath(); g.arc(x + 23, 60, 1.6, 0, Math.PI * 2); g.fill();
  }
  // floor behind the barricades
  const floorTop = LANES[0].top + LANES[0].barH - 4;
  const fl = g.createLinearGradient(0, floorTop, 0, H);
  fl.addColorStop(0, '#1a110a');
  fl.addColorStop(1, '#0d0805');
  g.fillStyle = fl;
  g.fillRect(0, floorTop, W, H - floorTop);
  g.strokeStyle = 'rgba(255,200,140,0.05)';
  for (let y = floorTop + 8; y < H; y += 14) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  // neon sign
  g.save();
  g.font = 'bold 30px monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = '#39ff14';
  g.shadowBlur = 18;
  g.strokeStyle = '#39ff14';
  g.lineWidth = 2;
  g.strokeRect(W / 2 - 150, 72, 300, 46);
  g.fillStyle = '#b8ff9c';
  g.fillText('★ PAINTBALL ★', W / 2, 96);
  g.restore();
  // tent valance with a scalloped edge
  for (let x = 0, i = 0; x < W; x += 40, i++) {
    g.fillStyle = i % 2 ? '#e9dcc0' : '#b3203a';
    g.fillRect(x, 0, 40, 34);
    g.beginPath();
    g.arc(x + 20, 34, 20, 0, Math.PI);
    g.fill();
  }
  const vs = g.createLinearGradient(0, 0, 0, 56);
  vs.addColorStop(0, 'rgba(0,0,0,0.35)');
  vs.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = vs;
  g.fillRect(0, 0, W, 56);
  // velvet side curtains
  for (const [x0, dir] of [[0, 1], [W, -1]]) {
    const cg = g.createLinearGradient(x0, 0, x0 + dir * 30, 0);
    cg.addColorStop(0, '#4a0614');
    cg.addColorStop(1, 'rgba(110,10,30,0)');
    g.fillStyle = cg;
    g.fillRect(dir > 0 ? 0 : W - 30, 0, 30, H);
  }
  // vignette
  const vg = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.65);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.45)');
  g.fillStyle = vg;
  g.fillRect(0, 0, W, H);
}

// Barricade k fills its band [top, top + barH] completely (the paint layer sticks to it).
function drawBarricade(g, S, k) {
  const { W, LANES } = S;
  const { top, barH } = LANES[k];
  const bottom = k === 2 ? S.H : top + barH;
  const rand = rng(77 + k);
  if (k === 0) {
    // sandbags, two staggered rows
    g.fillStyle = '#5b4a2c';
    g.fillRect(0, top + 2, W, bottom - top - 2);
    const rows = 2;
    const rh = barH / rows;
    for (let r = 0; r < rows; r++) {
      for (let x = r ? -26 : 0; x < W; x += 52) {
        const y = top + r * rh;
        const gr = g.createLinearGradient(0, y, 0, y + rh);
        gr.addColorStop(0, '#b39b68');
        gr.addColorStop(1, '#7a6440');
        g.fillStyle = gr;
        g.beginPath();
        g.roundRect(x + 1, y + 1, 50, rh - 1, rh * 0.45);
        g.fill();
        g.strokeStyle = 'rgba(40,28,10,0.6)';
        g.lineWidth = 1.2;
        g.stroke();
        g.strokeStyle = 'rgba(40,28,10,0.25)';
        g.beginPath(); g.moveTo(x + 10 + rand() * 6, y + rh * 0.5); g.lineTo(x + 40, y + rh * 0.45); g.stroke();
      }
    }
  } else if (k === 1) {
    // plank fence with posts and X braces
    const gr = g.createLinearGradient(0, top, 0, bottom);
    gr.addColorStop(0, '#8a5a2e');
    gr.addColorStop(1, '#4e3016');
    g.fillStyle = gr;
    g.fillRect(0, top, W, barH);
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 1;
    for (let y = top + 12; y < bottom; y += 12) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    for (let x = 0; x < W; x += 100) {
      g.strokeStyle = '#3a220e';
      g.lineWidth = 5;
      g.beginPath(); g.moveTo(x + 10, top + 6); g.lineTo(x + 90, bottom - 4); g.moveTo(x + 90, top + 6); g.lineTo(x + 10, bottom - 4); g.stroke();
      g.fillStyle = '#2e1a0a';
      g.fillRect(x - 5, top, 10, barH);
      g.fillStyle = '#c9c2b0';
      for (const yy of [top + 8, bottom - 8]) { g.beginPath(); g.arc(x, yy, 1.8, 0, Math.PI * 2); g.fill(); }
    }
    g.fillStyle = '#a8763f';
    g.fillRect(0, top, W, 5);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(0, top + 5, W, 2);
  } else {
    // carnival counter: striped skirt under a wooden ledge with a neon trim
    g.save();
    g.beginPath();
    g.rect(0, top, W, bottom - top);
    g.clip();
    g.fillStyle = '#efe4c8';
    g.fillRect(0, top, W, bottom - top);
    g.fillStyle = '#c4213f';
    for (let x = -100; x < W + 100; x += 44) {
      g.beginPath();
      g.moveTo(x, bottom);
      g.lineTo(x + 22, bottom);
      g.lineTo(x + 22 + (bottom - top), top);
      g.lineTo(x + (bottom - top), top);
      g.fill();
    }
    const sh = g.createLinearGradient(0, top, 0, bottom);
    sh.addColorStop(0, 'rgba(0,0,0,0.05)');
    sh.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = sh;
    g.fillRect(0, top, W, bottom - top);
    g.restore();
    const lg = g.createLinearGradient(0, top, 0, top + 14);
    lg.addColorStop(0, '#c48a4c');
    lg.addColorStop(1, '#6e4520');
    g.fillStyle = lg;
    g.fillRect(0, top, W, 14);
    g.fillStyle = 'rgba(255,240,210,0.35)';
    g.fillRect(0, top, W, 2);
    g.save();
    g.shadowColor = '#39ff14';
    g.shadowBlur = 10;
    g.fillStyle = '#39ff14';
    g.fillRect(0, top + 14, W, 2);
    g.restore();
    g.fillStyle = 'rgba(255,225,77,0.85)';
    g.font = '16px monospace';
    g.textAlign = 'center';
    for (let x = 100; x < W; x += 200) g.fillText('★', x, top + 44);
  }
}

// Silhouette path of a target in its local frame (origin = bottom centre, up = -y).
function silhouette(g, tg, h, w) {
  g.beginPath();
  if (tg.kind === 'gold') {
    const r = w * 0.5;
    star(g, 0, -h + r, r * 1.05, r * 0.45);
    return;
  }
  g.arc(0, -h + h * 0.18, h * 0.17, 0, Math.PI * 2);
  g.roundRect(-w / 2, -h * 0.67, w, h * 0.67, [w * 0.35, w * 0.35, 2, 2]);
}
function star(g, cx, cy, ro, ri) {
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? ri : ro;
    if (i === 0) g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    else g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  g.closePath();
}

function drawTarget(g, tg, p, fall, hit, T, scale) {
  const { h, w } = p;
  g.save();
  g.translate(p.x, p.bottom);
  if (fall > 0) {
    g.scale(1, Math.max(0.02, Math.cos((fall * Math.PI) / 2)));
  }
  // stick
  g.fillStyle = '#5a3a1c';
  g.fillRect(-3 * scale, -4, 6 * scale, 40);
  if (tg.kind === 'gold') {
    const spin = Math.cos(T / 140);
    const r = w * 0.5;
    g.save();
    g.translate(0, -h + r);
    g.scale(0.35 + 0.65 * Math.abs(spin), 1);
    g.shadowColor = '#ffd84a';
    g.shadowBlur = 16 + 8 * Math.sin(T / 90);
    const gg = g.createLinearGradient(-r, -r, r, r);
    gg.addColorStop(0, '#fff6b0');
    gg.addColorStop(0.5, '#ffcc1a');
    gg.addColorStop(1, '#c98800');
    g.fillStyle = gg;
    g.beginPath();
    star(g, 0, 0, r * 1.05, r * 0.45);
    g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = '#7a5200';
    g.lineWidth = 1.5;
    g.stroke();
    g.restore();
  } else {
    const civ = tg.kind === 'civ';
    // raised arms behind the civilian's body
    if (civ) {
      g.fillStyle = '#e2c89a';
      g.strokeStyle = '#6b4a24';
      g.lineWidth = 1.6 * scale;
      for (const s of [-1, 1]) {
        g.save();
        g.translate(s * w * 0.42, -h * 0.6);
        g.rotate(s * 0.35);
        g.beginPath();
        g.roundRect(-w * 0.1, -h * 0.42, w * 0.2, h * 0.44, w * 0.1);
        g.fill();
        g.stroke();
        g.beginPath();
        g.arc(0, -h * 0.43, w * 0.13, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.restore();
      }
    }
    // cardboard edge (thickness) then face
    g.save();
    g.translate(2 * scale, 2 * scale);
    silhouette(g, tg, h, w);
    g.fillStyle = '#5c3d1c';
    g.fill();
    g.restore();
    silhouette(g, tg, h, w);
    g.fillStyle = civ ? '#ead6ac' : '#c99a5c';
    g.fill();
    g.save();
    g.clip();
    const hy = -h + h * 0.18;
    const hr = h * 0.17;
    if (civ) {
      // teal shirt, smile, rosy cheeks, hair
      g.fillStyle = '#2bb5a0';
      g.fillRect(-w, -h * 0.6, w * 2, h);
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.font = `bold ${Math.round(h * 0.13)}px monospace`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('♥', 0, -h * 0.36);
      g.fillStyle = '#6b3f1a';
      g.beginPath();
      g.arc(0, hy - hr * 0.35, hr * 1.02, Math.PI, 0);
      g.fill();
      g.fillStyle = '#2a1a0a';
      for (const s of [-1, 1]) { g.beginPath(); g.arc(s * hr * 0.38, hy, hr * 0.12, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = 'rgba(255,90,110,0.45)';
      for (const s of [-1, 1]) { g.beginPath(); g.arc(s * hr * 0.6, hy + hr * 0.3, hr * 0.17, 0, Math.PI * 2); g.fill(); }
      g.strokeStyle = '#2a1a0a';
      g.lineWidth = 1.6 * scale;
      g.beginPath();
      g.arc(0, hy + hr * 0.2, hr * 0.42, 0.15 * Math.PI, 0.85 * Math.PI);
      g.stroke();
    } else {
      // bandit: striped jumper, bullseye, mask, hat
      g.fillStyle = '#2a2a33';
      g.fillRect(-w, -h * 0.67, w * 2, h);
      g.fillStyle = '#e9e2d0';
      for (let y = -h * 0.6; y < 0; y += h * 0.1) g.fillRect(-w, y, w * 2, h * 0.045);
      const cy = -h * 0.36;
      for (const [rr, c] of [[0.16, '#fff'], [0.12, '#e3263f'], [0.08, '#fff'], [0.04, '#e3263f']]) {
        g.fillStyle = c;
        g.beginPath();
        g.arc(0, cy, h * rr, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#1b1b22';
      g.fillRect(-hr * 1.1, hy - hr * 0.3, hr * 2.2, hr * 0.45);
      g.fillStyle = '#fff';
      for (const s of [-1, 1]) { g.beginPath(); g.arc(s * hr * 0.4, hy - hr * 0.08, hr * 0.12, 0, Math.PI * 2); g.fill(); }
      g.strokeStyle = '#3a2410';
      g.lineWidth = 2 * scale;
      g.beginPath();
      g.moveTo(-hr * 0.45, hy + hr * 0.42);
      g.quadraticCurveTo(0, hy + hr * 0.25, hr * 0.45, hy + hr * 0.42);
      g.stroke();
    }
    if (hit) drawSplat(g, hit.dx, hit.dy, 13 * scale, hit.color, hit.seed, false);
    g.restore();
    silhouette(g, tg, h, w);
    g.strokeStyle = '#4a3016';
    g.lineWidth = 2 * scale;
    g.stroke();
    if (!civ) {
      // hat on top (outside the clip)
      const hy2 = -h + h * 0.18;
      const hr2 = h * 0.17;
      g.fillStyle = '#141418';
      g.beginPath();
      g.ellipse(0, hy2 - hr2 * 0.7, hr2 * 1.45, hr2 * 0.28, 0, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.roundRect(-hr2 * 0.85, hy2 - hr2 * 1.55, hr2 * 1.7, hr2 * 0.9, [hr2 * 0.4, hr2 * 0.4, 0, 0]);
      g.fill();
      g.fillStyle = '#b3203a';
      g.fillRect(-hr2 * 0.85, hy2 - hr2 * 0.95, hr2 * 1.7, hr2 * 0.2);
    }
  }
  if (tg.kind === 'gold' && hit) {
    g.save();
    g.translate(0, 0);
    drawSplat(g, hit.dx, hit.dy, 10 * scale, hit.color, hit.seed, false);
    g.restore();
  }
  if (fall > 0) {
    g.fillStyle = `rgba(0,0,0,${0.5 * fall})`;
    g.fillRect(-w, -h - 10, w * 2, h + 14);
  }
  g.restore();
}

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
  const fx = createFx();
  const schedules = new Map();

  const root = document.createElement('div');
  root.className = 'pb-root';
  container.appendChild(root);
  const results = createResults(container);

  const status = document.createElement('div');
  status.className = 'pb-status';
  const err = document.createElement('div');
  err.className = 'pb-err';
  const seats = document.createElement('div');
  seats.className = 'pb-seats';
  const stage = document.createElement('div');
  stage.className = 'pb-stage';
  const canvas = document.createElement('canvas');
  const reloadBtn = document.createElement('button');
  reloadBtn.className = 'pb-reload';
  reloadBtn.textContent = '⟳ RELOAD';
  reloadBtn.title = 'Reload (R or right-click)';
  reloadBtn.hidden = true;
  stage.append(canvas, reloadBtn);
  const help = document.createElement('div');
  help.className = 'pb-help';
  help.textContent = 'Each player gets one 45-second run through the same gallery. Click/tap to fire. Bandits score (more for far rows, moving targets and head shots, gold stars 500), civilians cost 300. 8 paintballs per hopper: reload with R, right-click or the RELOAD button. Highest score wins.';
  root.append(status, err, seats, stage, help);

  const ctx = canvas.getContext('2d');
  let cache = null; // { k, back, bars: [c0, c1, c2] } offscreen canvases at backing resolution

  // ---- helpers ----
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
  function scheduleFor(seed) {
    if (!schedules.has(seed)) {
      if (schedules.size > 4) schedules.clear();
      schedules.set(seed, S.makeSchedule(seed));
    }
    return schedules.get(seed);
  }
  // Is it my run, live (countdown or running)?
  const myRunLive = () => !!(view && view.phase === 'playing' && view.run && view.run.seat === mySeat() && view.turn === mySeat());

  // ---- the displayed run ----
  // events: the run's events (local + optimistic for the shooter, server-fed otherwise); applied:
  // how many have been replayed into `sim` and painted; hits: id -> { dx, dy, t, color, seed }.
  let disp = null;
  function newDisp() {
    if (!S || !view) { disp = null; return; }
    disp = {
      key: `${view.gameId}:${view.runSeq}`,
      seed: view.seed,
      schedule: scheduleFor(view.seed),
      seat: view.run ? view.run.seat : null,
      events: view.run ? view.run.events.map((e) => ({ ...e })) : [],
      applied: 0,
      sim: S.newRun(view.seed, scheduleFor(view.seed)),
      hits: new Map(),
      wasReloading: false,
      lastShot: null,
      lastSec: null,
      countdownShown: null,
    };
    repaint();
  }
  function rebuildDisp() {
    if (!disp) return;
    disp.applied = 0;
    disp.sim = S.newRun(disp.seed, disp.schedule);
    disp.hits.clear();
    repaint();
  }
  function mergeEvents(from, events) {
    if (!disp || !Array.isArray(events)) return;
    for (let i = 0; i < events.length; i++) {
      if (from + i === disp.events.length) disp.events.push({ ...events[i] });
    }
  }

  // ---- scenery caches & paint ----
  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  function ensureSize() {
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (!cw || !ch || !S) return false;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const bw = Math.min(1640, Math.round(cw * dpr));
    const bh = Math.round((bw * S.H) / S.W);
    if (cache && cache.bw === bw) return true;
    canvas.width = bw;
    canvas.height = bh;
    cache = { bw, bh, k: bw / S.W, back: makeCanvas(bw, bh), bars: [0, 1, 2].map(() => makeCanvas(bw, bh)) };
    repaint();
    return true;
  }
  function layerCtx(c) {
    const g = c.getContext('2d');
    g.setTransform(cache.k, 0, 0, cache.k, 0, 0);
    return g;
  }
  // Redraw clean scenery; the frame loop then re-applies (re-paints) every due event.
  function repaint() {
    if (!cache || !S) return;
    const gb = layerCtx(cache.back);
    gb.clearRect(0, 0, S.W, S.H);
    drawBackdrop(gb, S);
    cache.bars.forEach((c, k) => {
      const g = layerCtx(c);
      g.clearRect(0, 0, S.W, S.H);
      drawBarricade(g, S, k);
    });
    if (disp) {
      disp.applied = 0;
      disp.sim = S.newRun(disp.seed, disp.schedule);
      disp.hits.clear();
    }
  }
  function surfaceAt(x, y) {
    for (let k = 2; k >= 0; k--) {
      const L = S.LANES[k];
      if (y >= L.top && (k === 2 || y <= L.top + L.barH)) return cache.bars[k];
    }
    return cache.back;
  }
  function paintMiss(ev, color) {
    if (!cache) return;
    const g = layerCtx(surfaceAt(ev.x, ev.y));
    g.globalCompositeOperation = 'source-atop';
    const L = S.LANES;
    const r = ev.y >= L[2].top ? 15 : ev.y >= L[1].top ? 12.5 : ev.y >= L[0].top ? 10 : 9;
    drawSplat(g, ev.x, ev.y, r, color, splatSeed(ev), true);
    g.globalCompositeOperation = 'source-over';
  }

  // Replay due events: score them through the shared sim, paint misses, record hits, fire fx.
  function applyDue(T) {
    if (!disp) return;
    const color = PAINT[disp.seat] || PAINT.red;
    while (disp.applied < disp.events.length && disp.events[disp.applied].t <= T) {
      const ev = disp.events[disp.applied++];
      const r = S.applyEvent(disp.sim, ev);
      if (!r.ok) continue;
      const live = T - ev.t < FX_WINDOW;
      const mine = disp.seat === mySeat();
      const vol = mine ? 1 : 0.6;
      if (ev.type === 'reload') {
        if (live) sfx.play('reload', { vol });
        continue;
      }
      disp.lastShot = { x: ev.x, y: ev.y, at: performance.now(), live };
      if (live) sfx.play('pistol', { vol: 0.45 * vol });
      const res = r.res;
      if (!res) {
        paintMiss(ev, color);
        if (live) {
          fx.burst(ev.x, ev.y, color, { count: 10, speed: 120, life: 0.35, size: 2.5, gravity: 300 });
          sfx.play('move', { vol: 0.5 * vol });
        }
        continue;
      }
      disp.hits.set(res.id, { t: ev.t, dx: res.dx, dy: res.dy, color, seed: splatSeed(ev) });
      if (!live) continue;
      fx.burst(ev.x, ev.y, color, { count: 26, speed: 240, life: 0.55, size: 3.2, gravity: 420 });
      if (res.kind === 'civ') {
        fx.text(ev.x, ev.y - 14, `CIVILIAN ${res.pts}`, '#ff5a5a', { size: 17, life: 1.1 });
        fx.shake(7);
        flashEl(stage, 'rgba(255,40,40,0.35)', 280);
        sfx.play('hurt', { vol });
      } else if (res.kind === 'gold') {
        fx.ring(ev.x, ev.y, '#ffd84a', { radius: 60, life: 0.6, width: 4 });
        fx.burst(ev.x, ev.y, '#ffd84a', { count: 30, speed: 260, life: 0.8, size: 2.5 });
        fx.text(ev.x, ev.y - 16, `GOLD +${res.pts}`, '#ffd84a', { size: 20, life: 1.2 });
        sfx.play('chime', { vol });
      } else {
        fx.text(ev.x, ev.y - 14, `${res.head ? 'HEADSHOT ' : ''}+${res.pts}`, res.head ? '#ffb000' : '#ffe14d', { size: res.head ? 17 : 15 });
        if (res.head) fx.ring(ev.x, ev.y, '#ffb000', { radius: 34, life: 0.4 });
        sfx.play(res.head ? 'headshot' : 'hit', { vol });
      }
    }
  }

  // ---- clock ----
  // Run time (ms) this browser should show; null if no run is scheduled.
  function runTime() {
    if (!view || view.runStart == null) return null;
    const t = clock.now() - view.runStart;
    return myRunLive() ? t : t - SPECT_DELAY;
  }
  function mode() {
    if (!view || !S) return 'none';
    if (view.phase === 'waiting') return 'attract';
    if (view.phase === 'game_over') return 'over';
    if (view.runStart == null) return 'ready';
    const T = runTime();
    if (T < 0) return 'countdown';
    if (T <= S.RUN_MS) return 'running';
    return 'timeup';
  }

  // ---- input ----
  let aim = { x: 400, y: 260, mouse: false, inside: false };
  function toLogical(e) {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * S.W, y: ((e.clientY - r.top) / r.height) * S.H };
  }
  const canShoot = () => myRunLive() && mode() === 'running';
  function tryStart() {
    if (!view || view.phase !== 'playing' || view.runStart != null || view.turn !== mySeat() || !mySeat()) return false;
    api.sendAction({ kind: 'start' });
    sfx.play('select');
    return true;
  }
  function flash(reason) {
    flashError = reason;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { flashError = null; renderErr(); }, 1600);
    renderErr();
  }
  function fire(x, y) {
    if (!canShoot() || !disp) return;
    const T = Math.round(runTime());
    applyDue(T);
    const gun = S.gunAt(disp.sim, T);
    if (gun.reloading) { sfx.play('dry'); return; }
    if (gun.ammo <= 0) {
      sfx.play('dry');
      flash('empty');
      return;
    }
    if (T - disp.sim.lastShot < S.FIRE_MIN_MS) return;
    const ev = S.normEvent({ type: 'shot', t: T, x, y });
    if (!ev) return;
    disp.events.push(ev);
    applyDue(T);
    recoil = performance.now();
    api.sendAction({ kind: 'shot', t: ev.t, x: ev.x, y: ev.y });
  }
  function reload() {
    if (!canShoot() || !disp) return;
    const T = Math.round(runTime());
    applyDue(T);
    const gun = S.gunAt(disp.sim, T);
    if (gun.reloading || gun.ammo >= S.CLIP) return;
    disp.events.push({ type: 'reload', t: T });
    applyDue(T);
    api.sendAction({ kind: 'reload', t: T });
  }
  let recoil = 0;
  stage.addEventListener('pointerdown', (e) => {
    if (!S || e.target === reloadBtn) return;
    if (tryStart()) { e.preventDefault(); return; }
    if (!canShoot()) return;
    e.preventDefault();
    if (e.button === 2) { reload(); return; }
    const p = toLogical(e);
    aim = { x: p.x, y: p.y, mouse: e.pointerType === 'mouse', inside: true };
    fire(p.x, p.y);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!S) return;
    const p = toLogical(e);
    aim = { x: p.x, y: p.y, mouse: e.pointerType === 'mouse', inside: true };
  });
  stage.addEventListener('pointerleave', () => { aim.inside = false; });
  stage.addEventListener('contextmenu', (e) => e.preventDefault());
  reloadBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); reload(); });
  const onKey = (e) => {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.repeat) return;
    if (e.key === 'r' || e.key === 'R') {
      if (canShoot()) { e.preventDefault(); reload(); }
    } else if (e.key === ' ' || e.key === 'Enter') {
      if (tryStart()) e.preventDefault();
    }
  };
  window.addEventListener('keydown', onKey);

  // ---- per-frame draw ----
  function drawLights(g, now) {
    for (let i = 0; i < 21; i++) {
      const x = 20 + i * 38;
      const y = 50 + Math.sin(i * 0.9) * 3;
      const on = 0.6 + 0.4 * Math.sin(now / 300 + i * 1.7);
      const c = ['#ffe14d', '#ff5a6a', '#39ff14', '#5aa0ff'][i % 4];
      g.globalAlpha = on;
      g.shadowColor = c;
      g.shadowBlur = 10;
      g.fillStyle = c;
      g.beginPath();
      g.arc(x, y, 3.2, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    g.shadowBlur = 0;
    g.strokeStyle = 'rgba(30,20,10,0.9)';
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i < 21; i++) {
      const x = 20 + i * 38;
      const y = 47 + Math.sin(i * 0.9) * 3;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  }
  function drawTargets(g, lane, T, ghost) {
    const L = S.LANES[lane];
    g.save();
    g.beginPath();
    g.rect(0, 0, S.W, L.top + 1);
    g.clip();
    if (ghost) g.globalAlpha = 0.55;
    for (const tg of disp ? disp.schedule : []) {
      if (tg.lane !== lane) continue;
      if (tg.t0 > T) break;
      const hit = !ghost && disp.hits.get(tg.id);
      if (hit) {
        const fall = (T - hit.t) / FALL_MS;
        if (fall >= 1) continue;
        const p = S.pose(tg, hit.t);
        if (p) drawTarget(g, tg, p, Math.max(0, fall), hit, T, L.scale);
        continue;
      }
      const p = S.pose(tg, T);
      if (p && p.raise > 0) drawTarget(g, tg, p, 0, null, T, L.scale);
    }
    g.restore();
  }
  function drawGun(g, seat, now) {
    const tx = disp && disp.lastShot && !myRunLive() ? disp.lastShot.x : aim.x;
    const ty = disp && disp.lastShot && !myRunLive() ? disp.lastShot.y : aim.y;
    const bx = S.W / 2;
    const by = S.H + 30;
    const ang = Math.atan2(ty - by, tx - bx) + Math.PI / 2;
    const kick = Math.max(0, 1 - (now - recoil) / 90);
    const kick2 = disp && disp.lastShot && !myRunLive() ? Math.max(0, 1 - (now - disp.lastShot.at) / 90) : 0;
    g.save();
    g.translate(bx, by + (kick + kick2) * 8);
    g.rotate(Math.max(-0.9, Math.min(0.9, ang)));
    // barrel
    const bg = g.createLinearGradient(-7, 0, 7, 0);
    bg.addColorStop(0, '#2b2f36');
    bg.addColorStop(0.5, '#7a8290');
    bg.addColorStop(1, '#22252b');
    g.fillStyle = bg;
    g.fillRect(-6, -118, 12, 70);
    g.fillStyle = '#15171b';
    g.fillRect(-8, -122, 16, 8);
    // body + hopper
    g.fillStyle = '#30343c';
    g.beginPath();
    g.roundRect(-20, -60, 40, 70, 8);
    g.fill();
    const hg = g.createRadialGradient(-6, -82, 2, 0, -74, 24);
    hg.addColorStop(0, '#ffffff');
    hg.addColorStop(0.3, PAINT[seat] || '#888');
    hg.addColorStop(1, shade(PAINT[seat] || '#888888', 0.45));
    g.fillStyle = hg;
    g.beginPath();
    g.ellipse(0, -72, 22, 16, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#39ff14';
    g.lineWidth = 1.5;
    g.beginPath();
    g.roundRect(-20, -60, 40, 70, 8);
    g.stroke();
    if (kick + kick2 > 0.3) {
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = `rgba(255,240,200,${(kick + kick2) * 0.7})`;
      g.beginPath();
      g.arc(0, -126, 9, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }
  function drawCrosshair(g, empty) {
    if (!aim.inside || !aim.mouse) return;
    const c = empty ? '#ff4d4d' : '#39ff14';
    g.save();
    g.strokeStyle = c;
    g.shadowColor = c;
    g.shadowBlur = 6;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(aim.x, aim.y, 11, 0, Math.PI * 2);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      g.moveTo(aim.x + dx * 6, aim.y + dy * 6);
      g.lineTo(aim.x + dx * 17, aim.y + dy * 17);
    }
    g.stroke();
    g.fillStyle = c;
    g.fillRect(aim.x - 1, aim.y - 1, 2, 2);
    g.restore();
  }
  function text(g, str, x, y, { size = 16, color = '#fff', align = 'center', glow = null, weight = 'bold' } = {}) {
    g.font = `${weight} ${size}px monospace`;
    g.textAlign = align;
    g.textBaseline = 'middle';
    g.lineWidth = Math.max(2, size / 7);
    g.strokeStyle = 'rgba(0,0,0,0.85)';
    g.strokeText(str, x, y);
    if (glow) { g.shadowColor = glow; g.shadowBlur = 12; }
    g.fillStyle = color;
    g.fillText(str, x, y);
    g.shadowBlur = 0;
  }
  function drawHud(g, m, T) {
    const seat = disp && disp.seat;
    if (!seat || !(m === 'running' || m === 'countdown' || m === 'timeup')) return;
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.beginPath();
    g.roundRect(8, 6, 784, 40, 8);
    g.fill();
    const name = nicknameFor(view.players[seat]) || seat.toUpperCase();
    g.fillStyle = PAINT[seat];
    g.beginPath(); g.arc(26, 26, 7, 0, Math.PI * 2); g.fill();
    text(g, name.slice(0, 14), 40, 26, { size: 14, color: TEXT_COLOR[seat], align: 'left' });
    text(g, String(disp.sim.score), 230, 26, { size: 22, color: '#ffe14d', align: 'right', glow: '#ffb000' });
    const left = Math.max(0, Math.ceil((S.RUN_MS - Math.max(0, T)) / 1000));
    const urgent = left <= 10 && m === 'running';
    text(g, `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`, S.W / 2, 26, { size: 24, color: urgent ? '#ff5a5a' : '#b8ffb0', glow: urgent ? '#ff2d2d' : '#39ff14' });
    const other = seat === 'red' ? 'blue' : 'red';
    const target = view.scores[other];
    text(g, target != null ? `TO BEAT ${target}` : 'FIRST RUN', 780, 26, { size: 14, color: target != null ? TEXT_COLOR[other] : '#9fdc98', align: 'right' });
    // time bar
    const frac = Math.max(0, Math.min(1, 1 - Math.max(0, T) / S.RUN_MS));
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.fillRect(14, 42, 772, 2);
    g.fillStyle = urgent ? '#ff5a5a' : '#39ff14';
    g.fillRect(14, 42, 772 * frac, 2);
    // hopper: paintballs left / reload progress
    const gun = S.gunAt(disp.sim, Math.max(0, Math.min(T, S.RUN_MS)));
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.beginPath();
    g.roundRect(10, S.H - 34, 26 + S.CLIP * 18, 26, 13);
    g.fill();
    for (let i = 0; i < S.CLIP; i++) {
      const x = 28 + i * 18;
      const y = S.H - 21;
      g.beginPath();
      g.arc(x, y, 6.5, 0, Math.PI * 2);
      if (!gun.reloading && i < gun.ammo) {
        const bg = g.createRadialGradient(x - 2, y - 2, 1, x, y, 7);
        bg.addColorStop(0, '#fff');
        bg.addColorStop(0.4, PAINT[seat]);
        bg.addColorStop(1, shade(PAINT[seat], 0.5));
        g.fillStyle = bg;
      } else g.fillStyle = 'rgba(255,255,255,0.12)';
      g.fill();
    }
    if (gun.reloading) {
      const p = 1 - (gun.reloadEnd - T) / S.RELOAD_MS;
      g.fillStyle = '#ffe14d';
      g.fillRect(22, S.H - 12, (S.CLIP * 18 - 6) * Math.max(0, Math.min(1, p)), 3);
      text(g, 'RELOADING', 22 + S.CLIP * 9, S.H - 44, { size: 12, color: '#ffe14d' });
    } else if (gun.ammo === 0 && m === 'running') {
      const blink = Math.floor(performance.now() / 250) % 2;
      if (blink) text(g, myRunLive() ? 'RELOAD (R)' : 'EMPTY', 22 + S.CLIP * 9, S.H - 44, { size: 13, color: '#ff5a5a' });
    }
  }
  function drawOverlay(g, m, T, now) {
    const dim = (a) => { g.fillStyle = `rgba(0,0,0,${a})`; g.fillRect(0, 0, S.W, S.H); };
    if (m === 'attract') {
      dim(0.45);
      text(g, 'PAINTBALL', S.W / 2, 200, { size: 46, color: '#b8ff9c', glow: '#39ff14' });
      text(g, 'Take a seat (or play vs a bot) to start the duel', S.W / 2, 252, { size: 15, color: '#d8ffd0' });
    } else if (m === 'ready') {
      dim(0.5);
      const seat = view.turn;
      const name = nicknameFor(view.players[seat]) || seat;
      text(g, `${seat.toUpperCase()} UP: ${name}`, S.W / 2, 170, { size: 30, color: TEXT_COLOR[seat], glow: PAINT[seat] });
      const other = seat === 'red' ? 'blue' : 'red';
      if (view.scores[other] != null) text(g, `${other.toUpperCase()} SCORED ${view.scores[other]}. BEAT IT`, S.W / 2, 214, { size: 17, color: '#ffe14d' });
      if (seat === mySeat()) {
        const pulse = 1 + 0.06 * Math.sin(now / 180);
        g.save();
        g.translate(S.W / 2, 290);
        g.scale(pulse, pulse);
        g.fillStyle = 'rgba(57,255,20,0.18)';
        g.strokeStyle = '#39ff14';
        g.lineWidth = 2;
        g.beginPath();
        g.roundRect(-150, -30, 300, 60, 12);
        g.fill();
        g.stroke();
        text(g, '▶ TAP TO START', 0, 0, { size: 24, color: '#b8ff9c', glow: '#39ff14' });
        g.restore();
        text(g, '45 seconds · shoot bandits · spare civilians · R to reload', S.W / 2, 350, { size: 13, color: '#cfeec8', weight: 'normal' });
      } else {
        text(g, 'Getting ready…', S.W / 2, 280, { size: 18, color: '#cfeec8' });
      }
      if (view.readyDeadline != null && view.players[seat] !== 'BOT') {
        const s = Math.max(0, Math.ceil((view.readyDeadline - clock.now()) / 1000));
        if (s <= 15) text(g, `auto-start in ${s}s`, S.W / 2, 390, { size: 13, color: '#9fb39c', weight: 'normal' });
      }
    } else if (m === 'countdown') {
      dim(0.25);
      const n = Math.ceil(-T / 1000);
      if (n <= 3) {
        const frac = 1 - (-T / 1000 - (n - 1));
        const sc = 1.4 - 0.4 * Math.min(1, frac * 3);
        g.save();
        g.translate(S.W / 2, S.H / 2);
        g.scale(sc, sc);
        text(g, String(n), 0, 0, { size: 96, color: '#ffe14d', glow: '#ffb000' });
        g.restore();
      } else {
        const seat = disp && disp.seat;
        if (seat) text(g, `${seat.toUpperCase()} STEPS UP…`, S.W / 2, S.H / 2, { size: 28, color: TEXT_COLOR[seat], glow: PAINT[seat] });
      }
    } else if (m === 'running' && T < 600) {
      g.globalAlpha = 1 - T / 600;
      text(g, 'GO', S.W / 2, S.H / 2, { size: 90 + T / 20, color: '#39ff14', glow: '#39ff14' });
      g.globalAlpha = 1;
    } else if (m === 'timeup' && disp) {
      dim(0.45);
      text(g, "TIME'S UP", S.W / 2, 190, { size: 50, color: '#ffe14d', glow: '#ffb000' });
      const s = disp.sim.stats;
      text(g, `${disp.sim.score} POINTS`, S.W / 2, 250, { size: 28, color: PAINT[disp.seat], glow: PAINT[disp.seat] });
      text(g, `${s.hits} hits · ${s.heads} head shots · ${s.civs} civilians · ${s.shots ? Math.round(((s.hits + s.civs) / s.shots) * 100) : 0}% accuracy`, S.W / 2, 290, { size: 13, color: '#d8ffd0', weight: 'normal' });
    }
  }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!S || !ensureSize()) return;
    const m = mode();
    let T = 0;
    if (m === 'attract') T = (now * 0.8) % S.RUN_MS;
    else if (m === 'over') T = S.RUN_MS + 1000;
    else if (m === 'ready') T = -1;
    else T = runTime();
    if (disp && m !== 'attract') {
      applyDue(Math.min(T, S.RUN_MS));
      // sounds keyed to the run clock
      if (m === 'countdown') {
        const n = Math.ceil(-T / 1000);
        if (n <= 3 && disp.countdownShown !== n) { disp.countdownShown = n; sfx.play('beep'); }
      } else if (m === 'running') {
        if (disp.countdownShown !== 0 && T < 700) { disp.countdownShown = 0; sfx.play('go'); }
        const sec = Math.ceil((S.RUN_MS - T) / 1000);
        if (sec <= 5 && sec !== disp.lastSec) { disp.lastSec = sec; sfx.play('tick'); }
        const gun = S.gunAt(disp.sim, T);
        if (disp.wasReloading && !gun.reloading) sfx.play('reloaded', { vol: myRunLive() ? 1 : 0.6 });
        disp.wasReloading = gun.reloading;
      } else if (m === 'timeup' && disp.lastSec !== -1) {
        disp.lastSec = -1;
        sfx.play('point');
      }
    }
    const g = ctx;
    g.setTransform(cache.k, 0, 0, cache.k, 0, 0);
    g.clearRect(0, 0, S.W, S.H);
    fx.applyShake(g);
    g.drawImage(cache.back, 0, 0, S.W, S.H);
    drawLights(g, now);
    const showTargets = m === 'attract' || m === 'running' || m === 'timeup';
    for (let lane = 0; lane < 3; lane++) {
      if (showTargets && disp) drawTargets(g, lane, Math.min(T, S.RUN_MS), m === 'attract');
      g.drawImage(cache.bars[lane], 0, 0, S.W, S.H);
    }
    // tracer from the gun to the latest shot
    if (disp && disp.lastShot && disp.lastShot.live && now - disp.lastShot.at < 110 && m === 'running') {
      const a = 1 - (now - disp.lastShot.at) / 110;
      g.strokeStyle = `rgba(255,255,255,${0.5 * a})`;
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(S.W / 2, S.H - 90);
      g.lineTo(disp.lastShot.x, disp.lastShot.y);
      g.stroke();
      g.fillStyle = PAINT[disp.seat];
      g.beginPath();
      g.arc(disp.lastShot.x, disp.lastShot.y, 5 * a + 2, 0, Math.PI * 2);
      g.fill();
    }
    fx.draw(g);
    if (disp && disp.seat && (m === 'running' || m === 'countdown')) drawGun(g, disp.seat, now);
    g.restore();
    drawHud(g, m, T);
    drawOverlay(g, m, T, now);
    const shooting = canShoot();
    if (shooting) drawCrosshair(g, S.gunAt(disp.sim, T).ammo === 0 && !S.gunAt(disp.sim, T).reloading);
    // patch DOM bits in place only when they change (never rebuild under the pointer)
    stage.classList.toggle('aiming', shooting && aim.mouse);
    const startable = !!(view && view.phase === 'playing' && view.runStart == null && view.turn && view.turn === mySeat());
    stage.classList.toggle('can-start', startable);
    const showReload = shooting;
    if (reloadBtn.hidden === showReload) reloadBtn.hidden = !showReload;
    if (showReload) {
      const gun = S.gunAt(disp.sim, T);
      const urgent = gun.ammo === 0 && !gun.reloading;
      if (reloadBtn.classList.contains('urgent') !== urgent) reloadBtn.classList.toggle('urgent', urgent);
      if (reloadBtn.disabled !== gun.reloading) reloadBtn.disabled = gun.reloading;
    }
  }

  // ---- DOM ----
  function seatBox(color) {
    const box = document.createElement('div');
    box.className = `pb-seat${view.phase === 'playing' && view.turn === color ? ' turn' : ''}`;
    const dot = document.createElement('span');
    dot.className = 'pb-dot';
    dot.style.background = PAINT[color];
    const name = document.createElement('span');
    const occ = view.players[color];
    name.textContent = `${color.toUpperCase()}: ${nicknameFor(occ) || '(empty)'}${occ && occ === api.getClientId() ? ' (you)' : ''}`;
    name.style.color = TEXT_COLOR[color];
    box.append(dot, name);
    if (view.scores && view.scores[color] != null) {
      const sc = document.createElement('span');
      sc.className = 'pb-score';
      sc.textContent = `${view.scores[color]}`;
      box.appendChild(sc);
    }
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
  function renderErr() {
    err.textContent = flashError ? REJECT_MESSAGES[flashError] || 'Shot rejected' : '';
  }
  function renderDom() {
    if (destroyed) return;
    const seat = mySeat();
    const over = view && view.phase === 'game_over';
    results.update(over ? duelResults({
      winner: view.winner === 'draw' ? null : view.winner, colors: COLORS, players: view.players, me: seat, nameFor: nicknameFor,
      subtitle: COLORS.map((c) => {
        const s = view.stats[c];
        return `${c.toUpperCase()} ${view.scores[c] ?? 0} (${s.hits} hits${s.civs ? `, ${s.civs} civ` : ''})`;
      }).join(' · '),
      onRematch: () => api.sendAction({ kind: 'resetGame' }),
    }) : null);
    renderErr();
    if (!view) {
      status.textContent = 'Loading...';
      return;
    }
    status.className = 'pb-status';
    status.style.color = '';
    if (view.phase === 'waiting') {
      status.textContent = 'Waiting for both seats to be filled.';
    } else if (over) {
      status.textContent = view.winner === 'draw'
        ? `DRAW. ${view.scores.red} each`
        : `${view.winner.toUpperCase()} WINS ${view.scores.red} – ${view.scores.blue}`;
      status.style.color = '#ffb000';
    } else if (seat && view.turn === seat) {
      status.textContent = view.runStart == null ? '▶ YOUR RUN. Tap the gallery to start' : '▶ YOUR RUN. Shoot the bandits, spare the civilians.';
      status.classList.add('mine');
    } else {
      const t = view.turn;
      status.textContent = `${t.toUpperCase()} ${view.runStart == null ? 'GETTING READY' : 'SHOOTING'}. ${nicknameFor(view.players[t])}`;
      status.style.color = TEXT_COLOR[t];
    }
    seats.innerHTML = '';
    seats.append(seatBox('red'), seatBox('blue'));
    if (seat) {
      const leave = document.createElement('button');
      leave.textContent = 'LEAVE SEAT';
      leave.addEventListener('click', () => api.sendAction({ kind: 'leaveSeat' }));
      seats.appendChild(leave);
    }
  }

  // ---- state ----
  function applyState(data, fromSnapshot) {
    const prev = view;
    view = data;
    clock.sync(data.serverNow);
    const key = `${data.gameId}:${data.runSeq}`;
    if (!disp || disp.key !== key || fromSnapshot) newDisp();
    else if (data.run && !myRunLive()) mergeEvents(0, data.run.events);
    if (prev && prev.phase !== 'playing' && data.phase === 'playing') sfx.play('go');
    if (prev && prev.turn && data.turn && prev.turn !== data.turn) {
      if (data.turn === mySeat()) setTimeout(() => sfx.play('turn'), 250);
      else sfx.play('point');
    }
    if (prev && !prev.winner && data.winner) {
      const seat = mySeat();
      sfx.play(!seat || data.winner === 'draw' ? 'point' : data.winner === seat ? 'win' : 'lose');
    }
    renderDom();
  }

  loadScript('games/paintball/sim.js', 'PaintballSim')
    .then((Sim) => {
      if (destroyed) return;
      S = Sim;
      if (view) newDisp();
      raf = requestAnimationFrame(frame);
      renderDom();
    })
    .catch(() => {
      stage.innerHTML = '<div class="pb-fail">Could not load the gallery.</div>';
    });
  renderDom();

  return {
    applySnapshot(snapshot) {
      applyState(snapshot, true);
    },
    applyEvent(data) {
      if (!data) return;
      if (data.kind === 'state') applyState(data, false);
      else if (data.kind === 'shots') {
        clock.sync(data.serverNow);
        if (!view || !disp || data.runSeq !== view.runSeq) return;
        if (data.seat === mySeat() && myRunLive()) return; // already applied locally
        mergeEvents(data.from, data.events);
      } else if (data.kind === 'moveRejected') {
        // drop the optimistic event the server refused and replay the run without it
        if (disp && myRunLive() && typeof data.t === 'number') {
          for (let i = disp.events.length - 1; i >= 0; i--) {
            if (disp.events[i].t === data.t) {
              disp.events.splice(i, 1);
              rebuildDisp();
              break;
            }
          }
        }
        if (data.reason !== 'too_fast') sfx.play('error');
        flash(data.reason || 'invalid');
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
      window.removeEventListener('keydown', onKey);
      results.destroy();
      container.innerHTML = '';
    },
  };
}
