// Pool — 8-Ball / 9-Ball. Aim by clicking or dragging on the table (←/→ fine-tune), pull the
// power bar down and let go to shoot (or ↑/↓ + Space), and set spin on the cue-ball widget. With
// ball in hand, drag the cue ball to place it (behind the head string on the break).
//
// The server simulates every shot with the shared deterministic physics in ./sim.js; this client
// replays the same shot from `lastShot.start` to animate it, then snaps to the authoritative
// table. The aim line shows the ghost ball, the object ball's path and the cue ball's tangent; it
// turns red when the first ball in line would be a foul.
import { sfx } from '../sfx.js';
import { preferredLevel, levelSelect, levelLabel } from '../botLevel.js';
import { createResults, duelResults } from '../resultsPanel.js';
import { sharpCanvas } from '../canvasFx.js';

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

const COLORS = {
  1: '#f2c200', 2: '#1d48c8', 3: '#d21f1f', 4: '#5c2a96', 5: '#ef7a00', 6: '#10803a', 7: '#7d1b1b', 8: '#111111',
};
const ballColor = (n) => (n === 0 ? '#f3efe2' : COLORS[n > 8 ? n - 8 : n]);
const groupOf = (n) => (n >= 1 && n <= 7 ? 'solids' : n >= 9 && n <= 15 ? 'stripes' : null);
const SEAT_NAMES = { p1: 'PLAYER 1', p2: 'PLAYER 2' };
const FOULS = { scratch: 'Scratch', no_hit: 'No ball hit', wrong_ball: 'Wrong ball first', no_rail: 'No cushion after contact' };
const REASONS = {
  eight: 'Potted the 8', eight_early: 'Potted the 8 too early', eight_foul: 'Potted the 8 on a foul', nine: 'Potted the 9',
};
const REJECT_MESSAGES = {
  not_your_turn: "It's not your turn", not_playing: 'The game is not in progress', invalid: 'Invalid shot', bad_spot: "The cue ball can't go there",
};
const M = 14; // rail + wood around the cloth, in table units

const CSS = `
.pl-root { display: flex; flex-direction: column; align-items: center; gap: 8px; width: 100%; }
.pl-status { font-size: 17px; font-weight: bold; padding: 5px 14px; border-radius: 6px; border: 2px solid transparent; text-align: center; min-height: 1.3em; }
.pl-status.mine { background: rgba(57,255,20,.15); border-color: #39ff14; }
.pl-err { color: #ff4d4d; min-height: 1.2em; font-size: 14px; text-align: center; }
.pl-toast { color: #ffb000; }
.pl-seats { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; align-items: center; }
.pl-seat { display: flex; gap: 6px; align-items: center; padding: 4px 8px; border: 1px solid #1f8f0c; border-radius: 6px; flex-wrap: wrap; }
.pl-seat.turn { border-color: #39ff14; box-shadow: 0 0 10px -2px #39ff14; }
.pl-seat .grp { color: #ffb000; font-size: 13px; }
.pl-modes { display: flex; gap: 6px; align-items: center; font-size: 14px; }
.pl-modes button.on { background: #39ff14; color: #000; }
.pl-score { font-size: 14px; color: #3ad7ff; }
.pl-main { display: flex; gap: 10px; align-items: stretch; justify-content: center; max-width: 100%; }
.pl-canvas { display: block; touch-action: none; cursor: crosshair; border-radius: 10px; }
.pl-side { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.pl-power { position: relative; width: 30px; flex: 1; min-height: 120px; border: 2px solid #1f8f0c; border-radius: 8px; background: #050805; cursor: ns-resize; touch-action: none; overflow: hidden; user-select: none; }
.pl-power.off { opacity: .35; cursor: default; }
.pl-power .fill { position: absolute; left: 0; right: 0; top: 0; background: linear-gradient(#39ff14, #ffb000 60%, #ff4d4d); }
.pl-power .lbl { position: absolute; left: 0; right: 0; bottom: 4px; text-align: center; font-size: 11px; color: #9f9; pointer-events: none; }
.pl-spin { width: 64px; height: 64px; touch-action: none; cursor: pointer; }
.pl-sidelbl { font-size: 11px; color: #8c8; text-align: center; }
.pl-racks { display: flex; gap: 18px; flex-wrap: wrap; justify-content: center; align-items: center; min-height: 26px; }
.pl-rack { display: flex; gap: 3px; align-items: center; font-size: 12px; }
.pl-mini { width: 20px; height: 20px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font: bold 9px sans-serif; color: #000; box-shadow: inset -2px -3px 4px rgba(0,0,0,.45); }
.pl-mini span { background: #fff; border-radius: 50%; width: 11px; height: 11px; line-height: 11px; text-align: center; }
.pl-mini.gone { opacity: .2; }
.pl-help { font-size: 12px; color: #6c6; text-align: center; max-width: 640px; }
`;

function miniBall(n, gone) {
  const el = document.createElement('span');
  el.className = `pl-mini${gone ? ' gone' : ''}`;
  const c = ballColor(n);
  el.style.background = n > 8 ? `linear-gradient(#f3efe2 0 24%, ${c} 24% 76%, #f3efe2 76%)` : c;
  const num = document.createElement('span');
  num.textContent = n;
  el.appendChild(num);
  return el;
}

export function mount(container, api) {
  if (!document.getElementById('pl-style')) {
    const style = document.createElement('style');
    style.id = 'pl-style';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  let Sim = null;
  let view = null;
  let roster = [];
  let flashError = null;
  let flashTimer = null;
  let toast = '';
  let toastTimer = null;
  let destroyed = false;

  // aim / shot input (table units)
  let aim = { x: 1, y: 0 };
  let aimKey = null; // `${gameId}:${shotNo}` the aim was set for — re-aim at a target on a new turn
  let spin = { x: 0, y: 0 };
  let kbPower = 0.5;
  let pull = 0; // 0..1 while dragging the power bar
  let pulling = false;
  let placing = false; // dragging the cue ball (ball in hand)
  let placeSpot = null; // { x, y } chosen cue position while ball in hand
  let aiming = false;
  let lastAimSent = 0;
  let remoteAim = null;

  // animation of the last shot
  let anim = null; // { run, shotNo, startT, stepsDone, sinking: [] }
  let shownShotNo = -1;

  const root = document.createElement('div');
  root.className = 'pl-root';
  container.appendChild(root);
  const results = createResults(container);

  const status = document.createElement('div');
  status.className = 'pl-status';
  const err = document.createElement('div');
  err.className = 'pl-err';
  const seats = document.createElement('div');
  seats.className = 'pl-seats';
  const bar = document.createElement('div');
  bar.className = 'pl-seats';
  const main = document.createElement('div');
  main.className = 'pl-main';
  const canvas = document.createElement('canvas');
  canvas.className = 'pl-canvas';
  const side = document.createElement('div');
  side.className = 'pl-side';
  const powerEl = document.createElement('div');
  powerEl.className = 'pl-power';
  powerEl.title = 'Drag down to pull back, release to shoot';
  const powerFill = document.createElement('div');
  powerFill.className = 'fill';
  const powerLbl = document.createElement('div');
  powerLbl.className = 'lbl';
  powerEl.append(powerFill, powerLbl);
  const spinCanvas = document.createElement('canvas');
  spinCanvas.className = 'pl-spin';
  spinCanvas.title = 'Spin: top = follow, bottom = draw, sides = english. Double-click to reset.';
  const spinLbl = document.createElement('div');
  spinLbl.className = 'pl-sidelbl';
  spinLbl.textContent = 'SPIN';
  const powLbl = document.createElement('div');
  powLbl.className = 'pl-sidelbl';
  powLbl.textContent = 'POWER';
  side.append(powLbl, powerEl, spinCanvas, spinLbl);
  main.append(canvas, side);
  const racks = document.createElement('div');
  racks.className = 'pl-racks';
  const help = document.createElement('div');
  help.className = 'pl-help';
  help.textContent = 'Click/drag on the table to aim · ←/→ fine aim (Shift = finer) · drag the power bar down and release to shoot (or ↑/↓ then Space) · drag the cue ball when you have ball in hand';
  root.append(status, err, seats, bar, main, racks, help);

  let ctx = null;
  let scale = 3;
  let cssW = 0;
  let spinCtx = sharpCanvas(spinCanvas, 64, 64);

  function nicknameFor(clientId) {
    if (!clientId) return null;
    if (clientId === 'BOT') return '(bot)';
    const entry = roster.find((r) => r.clientId === clientId);
    return entry ? entry.nickname : 'someone';
  }
  function mySeat() {
    if (!view) return null;
    const me = api.getClientId();
    if (view.players.p1 === me) return 'p1';
    if (view.players.p2 === me) return 'p2';
    return null;
  }
  const other = (s) => (s === 'p1' ? 'p2' : 'p1');
  const animating = () => !!anim;
  const myTurn = () => view && view.phase === 'playing' && !animating() && mySeat() === view.turn;
  const seatName = (s) => (view.players[s] === 'BOT'
    ? `BOT (${levelLabel((view.botLevels || {})[s])})` : nicknameFor(view.players[s]) || SEAT_NAMES[s]);

  // ---- geometry ------------------------------------------------------------------------------
  const tx = (x) => (x + M) * scale;
  const ty = (y) => (y + M) * scale;
  function toTable(ev) {
    const r = canvas.getBoundingClientRect();
    return { x: (ev.clientX - r.left) / scale - M, y: (ev.clientY - r.top) / scale - M };
  }

  function resize() {
    if (!Sim) return;
    const avail = Math.max(260, Math.min(980, (container.clientWidth || window.innerWidth) - 110));
    const availH = Math.max(200, window.innerHeight - 330);
    const totalW = Sim.L + 2 * M;
    const totalH = Sim.W + 2 * M;
    scale = Math.min(avail / totalW, availH / totalH);
    scale = Math.max(1, scale);
    cssW = Math.round(totalW * scale);
    ctx = sharpCanvas(canvas, cssW, Math.round(totalH * scale));
    powerEl.style.height = `${Math.round(totalH * scale) - 110}px`;
    draw();
  }

  // Balls currently on screen.
  function shownBalls() {
    if (anim) return anim.run.balls.filter((b) => b.on);
    if (!view) return [];
    const balls = view.balls.map((b) => ({ ...b }));
    if (view.ballInHand && placeSpot && myTurn()) {
      const cue = balls.find((b) => b.n === 0);
      if (cue) { cue.x = placeSpot.x; cue.y = placeSpot.y; }
    }
    if (view.ballInHand && remoteAim && remoteAim.cue && !myTurn()) {
      const cue = balls.find((b) => b.n === 0);
      if (cue) { cue.x = remoteAim.cue.x; cue.y = remoteAim.cue.y; }
    }
    return balls;
  }

  function legalTargets(seat) {
    const objs = view.balls.filter((b) => b.n !== 0).map((b) => b.n);
    if (view.mode === '9ball') return [Math.min(...objs)];
    if (view.breakShot) return objs;
    const mine = view.groups[seat];
    if (!mine) return objs.filter((n) => n !== 8);
    const own = objs.filter((n) => groupOf(n) === mine);
    return own.length ? own : [8];
  }

  // Ray from the cue ball: first ball hit (ghost-ball position) or cushion.
  function traceAim(balls, cue, ux, uy) {
    const R = Sim.R;
    let best = null;
    for (const b of balls) {
      if (b.n === 0) continue;
      const fx = cue.x - b.x;
      const fy = cue.y - b.y;
      const bq = fx * ux + fy * uy;
      const c = fx * fx + fy * fy - 4 * R * R;
      const disc = bq * bq - c;
      if (disc < 0) continue;
      const t = -bq - Math.sqrt(disc);
      if (t > 0 && (!best || t < best.t)) best = { t, ball: b };
    }
    // cushion (ball-centre bounds)
    let tc = Infinity;
    let nx = 0;
    let ny = 0;
    if (ux > 1e-9) { const t = (Sim.L - R - cue.x) / ux; if (t < tc) { tc = t; nx = -1; ny = 0; } }
    if (ux < -1e-9) { const t = (R - cue.x) / ux; if (t < tc) { tc = t; nx = 1; ny = 0; } }
    if (uy > 1e-9) { const t = (Sim.W - R - cue.y) / uy; if (t < tc) { tc = t; nx = 0; ny = -1; } }
    if (uy < -1e-9) { const t = (R - cue.y) / uy; if (t < tc) { tc = t; nx = 0; ny = 1; } }
    if (best && best.t < tc) return { kind: 'ball', t: best.t, ball: best.ball };
    return { kind: 'rail', t: Math.max(0, tc), nx, ny };
  }

  function defaultAim(seat) {
    const balls = shownBalls();
    const cue = balls.find((b) => b.n === 0);
    if (!cue) return;
    let target = null;
    if (view.breakShot) target = Sim.FOOT;
    else {
      const legal = legalTargets(seat);
      let bestD = Infinity;
      for (const b of balls) {
        if (!legal.includes(b.n)) continue;
        const d = (b.x - cue.x) ** 2 + (b.y - cue.y) ** 2;
        if (d < bestD) { bestD = d; target = b; }
      }
    }
    if (!target) return;
    const dx = target.x - cue.x;
    const dy = target.y - cue.y;
    const m = Math.hypot(dx, dy) || 1;
    aim = { x: dx / m, y: dy / m };
  }

  // ---- drawing -------------------------------------------------------------------------------
  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function drawTable(c) {
    const L = Sim.L;
    const W = Sim.W;
    const s = scale;
    const fw = (L + 2 * M) * s;
    const fh = (W + 2 * M) * s;
    // wood frame
    const wood = c.createLinearGradient(0, 0, 0, fh);
    wood.addColorStop(0, '#6b3a17');
    wood.addColorStop(0.5, '#4a260d');
    wood.addColorStop(1, '#2e1606');
    roundRect(c, 0, 0, fw, fh, 9 * s * 0.5);
    c.fillStyle = wood;
    c.fill();
    c.strokeStyle = 'rgba(255,200,140,.25)';
    c.lineWidth = 1;
    c.stroke();
    // grain
    c.save();
    c.globalAlpha = 0.08;
    c.strokeStyle = '#000';
    for (let i = 0; i < 18; i++) {
      c.beginPath();
      const yy = (i / 18) * fh;
      c.moveTo(0, yy);
      c.bezierCurveTo(fw * 0.3, yy + 4, fw * 0.7, yy - 4, fw, yy + 2);
      c.stroke();
    }
    c.restore();
    // cushions (rubber) — slightly darker cloth band inside the wood
    const cush = 4.2;
    c.fillStyle = '#0b5e2b';
    c.fillRect(tx(-cush), ty(-cush), (L + 2 * cush) * s, (W + 2 * cush) * s);
    // cloth
    const felt = c.createRadialGradient(tx(L / 2), ty(W / 2), 10, tx(L / 2), ty(W / 2), L * 0.62 * s);
    felt.addColorStop(0, '#16a04c');
    felt.addColorStop(1, '#0c7334');
    c.fillStyle = felt;
    c.fillRect(tx(0), ty(0), L * s, W * s);
    // cushion nose shading
    c.strokeStyle = 'rgba(0,0,0,.28)';
    c.lineWidth = Math.max(1, 0.8 * s);
    c.strokeRect(tx(0), ty(0), L * s, W * s);
    // pocket jaws: carve the openings in the cushion band
    for (const p of Sim.POCKETS) {
      c.beginPath();
      c.arc(tx(p.x), ty(p.y), (p.r + 1.6) * s, 0, Math.PI * 2);
      c.fillStyle = '#0a4a22';
      c.fill();
    }
    for (const p of Sim.POCKETS) {
      const g = c.createRadialGradient(tx(p.x), ty(p.y), 0, tx(p.x), ty(p.y), p.r * s);
      g.addColorStop(0, '#000');
      g.addColorStop(0.75, '#050505');
      g.addColorStop(1, '#262626');
      c.beginPath();
      c.arc(tx(p.x), ty(p.y), p.r * s, 0, Math.PI * 2);
      c.fillStyle = g;
      c.fill();
      c.strokeStyle = 'rgba(200,170,90,.55)';
      c.lineWidth = Math.max(1, 0.6 * s);
      c.stroke();
    }
    // diamonds (sights)
    c.fillStyle = '#efe3c0';
    const dia = (x, y) => {
      const r = 1.1 * s;
      c.beginPath();
      c.moveTo(x, y - r);
      c.lineTo(x + r * 0.7, y);
      c.lineTo(x, y + r);
      c.lineTo(x - r * 0.7, y);
      c.closePath();
      c.fill();
    };
    const off = -(4.2 + (M - 4.2) / 2);
    for (let i = 1; i < 8; i++) {
      if (i === 4) continue;
      const x = tx((L * i) / 8);
      dia(x, ty(off));
      dia(x, ty(W - off));
    }
    for (let i = 1; i < 4; i++) {
      const y = ty((W * i) / 4);
      dia(tx(off), y);
      dia(tx(L - off), y);
    }
    // head string + foot spot
    c.strokeStyle = 'rgba(255,255,255,.12)';
    c.lineWidth = 1;
    c.setLineDash([4, 5]);
    c.beginPath();
    c.moveTo(tx(Sim.HEAD_X), ty(0));
    c.lineTo(tx(Sim.HEAD_X), ty(W));
    c.stroke();
    c.setLineDash([]);
    c.fillStyle = 'rgba(255,255,255,.25)';
    c.beginPath();
    c.arc(tx(Sim.FOOT.x), ty(Sim.FOOT.y), 0.7 * s, 0, Math.PI * 2);
    c.fill();
    if (view && view.ballInHand && view.kitchen && view.phase === 'playing' && !anim) {
      c.fillStyle = 'rgba(255,255,255,.05)';
      c.fillRect(tx(0), ty(0), Sim.HEAD_X * s, W * s);
    }
  }

  function drawBall(c, b, alpha = 1, sizeK = 1) {
    const s = scale;
    const R = Sim.R * s * sizeK;
    const x = tx(b.x);
    const y = ty(b.y);
    c.save();
    c.globalAlpha = alpha;
    // shadow
    c.fillStyle = 'rgba(0,0,0,.35)';
    c.beginPath();
    c.ellipse(x + R * 0.25, y + R * 0.35, R, R * 0.9, 0, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.arc(x, y, R, 0, Math.PI * 2);
    c.save();
    c.clip();
    const col = ballColor(b.n);
    if (b.n > 8) {
      c.fillStyle = '#f3efe2';
      c.fillRect(x - R, y - R, 2 * R, 2 * R);
      c.fillStyle = col;
      c.fillRect(x - R, y - R * 0.55, 2 * R, R * 1.1);
    } else {
      c.fillStyle = col;
      c.fillRect(x - R, y - R, 2 * R, 2 * R);
    }
    if (b.n !== 0 && R > 4) {
      c.fillStyle = '#fbf8ee';
      c.beginPath();
      c.arc(x, y, R * 0.48, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#111';
      c.font = `bold ${Math.max(6, R * 0.62)}px sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(String(b.n), x, y + R * 0.04);
    } else if (b.n === 0) {
      // a faint red dot (measle) so the cue ball reads as a cue ball
      c.fillStyle = 'rgba(200,40,40,.35)';
      c.beginPath();
      c.arc(x + R * 0.25, y + R * 0.2, R * 0.16, 0, Math.PI * 2);
      c.fill();
    }
    // shading + specular
    const sh = c.createRadialGradient(x - R * 0.4, y - R * 0.45, R * 0.1, x, y, R * 1.05);
    sh.addColorStop(0, 'rgba(255,255,255,.55)');
    sh.addColorStop(0.25, 'rgba(255,255,255,.08)');
    sh.addColorStop(0.7, 'rgba(0,0,0,0)');
    sh.addColorStop(1, 'rgba(0,0,0,.45)');
    c.fillStyle = sh;
    c.fillRect(x - R, y - R, 2 * R, 2 * R);
    c.restore();
    c.restore();
  }

  function drawCueStick(c, cue, ux, uy, pullAmt, faint) {
    const s = scale;
    const gap = Sim.R + 1.5 + pullAmt * 28;
    const len = 150;
    const x1 = tx(cue.x - ux * gap);
    const y1 = ty(cue.y - uy * gap);
    const x2 = tx(cue.x - ux * (gap + len));
    const y2 = ty(cue.y - uy * (gap + len));
    const px = -uy;
    const py = ux;
    const w1 = 0.75 * s;
    const w2 = 1.6 * s;
    c.save();
    c.globalAlpha = faint ? 0.45 : 1;
    // shadow
    c.fillStyle = 'rgba(0,0,0,.3)';
    c.beginPath();
    c.moveTo(x1 + px * w1 + 3, y1 + py * w1 + 5);
    c.lineTo(x2 + px * w2 + 3, y2 + py * w2 + 5);
    c.lineTo(x2 - px * w2 + 3, y2 - py * w2 + 5);
    c.lineTo(x1 - px * w1 + 3, y1 - py * w1 + 5);
    c.fill();
    const g = c.createLinearGradient(x1, y1, x2, y2);
    g.addColorStop(0, '#f2f0ea');
    g.addColorStop(0.015, '#f2f0ea');
    g.addColorStop(0.02, '#e9d3a1');
    g.addColorStop(0.62, '#c9965a');
    g.addColorStop(0.64, '#1a1a1a');
    g.addColorStop(0.7, '#5a2c10');
    g.addColorStop(0.95, '#2b1406');
    g.addColorStop(1, '#111');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(x1 + px * w1, y1 + py * w1);
    c.lineTo(x2 + px * w2, y2 + py * w2);
    c.lineTo(x2 - px * w2, y2 - py * w2);
    c.lineTo(x1 - px * w1, y1 - py * w1);
    c.closePath();
    c.fill();
    c.fillStyle = '#3a7bd5'; // chalked tip
    c.beginPath();
    c.arc(x1, y1, w1, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }

  function drawGuide(c, balls, cue, ux, uy, seat, faint) {
    const s = scale;
    const hit = traceAim(balls, cue, ux, uy);
    const gx = cue.x + ux * hit.t;
    const gy = cue.y + uy * hit.t;
    const bad = hit.kind === 'ball' && seat && !legalTargets(seat).includes(hit.ball.n);
    const col = bad ? 'rgba(255,77,77,.9)' : 'rgba(255,255,255,.85)';
    c.save();
    c.globalAlpha = faint ? 0.4 : 1;
    c.strokeStyle = col;
    c.lineWidth = Math.max(1, 0.35 * s);
    c.setLineDash([3, 3]);
    c.beginPath();
    c.moveTo(tx(cue.x), ty(cue.y));
    c.lineTo(tx(gx), ty(gy));
    c.stroke();
    c.setLineDash([]);
    // ghost ball
    c.beginPath();
    c.arc(tx(gx), ty(gy), Sim.R * s, 0, Math.PI * 2);
    c.stroke();
    if (hit.kind === 'ball') {
      const b = hit.ball;
      let nx = b.x - gx;
      let ny = b.y - gy;
      const nm = Math.hypot(nx, ny) || 1;
      nx /= nm;
      ny /= nm;
      const k = ux * nx + uy * ny;
      // object ball path
      c.strokeStyle = bad ? 'rgba(255,77,77,.9)' : 'rgba(255,255,255,.9)';
      c.beginPath();
      c.moveTo(tx(b.x), ty(b.y));
      c.lineTo(tx(b.x + nx * (12 + 40 * k)), ty(b.y + ny * (12 + 40 * k)));
      c.stroke();
      // cue ball tangent
      const tvx = ux - k * nx;
      const tvy = uy - k * ny;
      const tl = Math.hypot(tvx, tvy);
      if (tl > 0.05) {
        c.strokeStyle = 'rgba(255,255,255,.4)';
        c.beginPath();
        c.moveTo(tx(gx), ty(gy));
        c.lineTo(tx(gx + (tvx / tl) * 20 * tl), ty(gy + (tvy / tl) * 20 * tl));
        c.stroke();
      }
      if (bad) {
        c.fillStyle = 'rgba(255,77,77,.95)';
        c.font = `bold ${Math.max(10, 3.2 * s)}px sans-serif`;
        c.textAlign = 'center';
        c.fillText('✕', tx(gx), ty(gy) + 1.1 * s);
      }
    } else {
      // short bounce preview
      const d = ux * hit.nx + uy * hit.ny;
      const rx = ux - 2 * d * hit.nx;
      const ry = uy - 2 * d * hit.ny;
      c.strokeStyle = 'rgba(255,255,255,.35)';
      c.beginPath();
      c.moveTo(tx(gx), ty(gy));
      c.lineTo(tx(gx + rx * 18), ty(gy + ry * 18));
      c.stroke();
    }
    c.restore();
  }

  function draw() {
    if (!ctx || !Sim || destroyed) return;
    const c = ctx;
    c.clearRect(0, 0, canvas.width, canvas.height);
    drawTable(c);
    const balls = shownBalls();
    for (const b of balls) drawBall(c, b);
    if (anim) {
      const now = performance.now();
      for (const k of anim.sinking) {
        const t = (now - k.t0) / 260;
        if (t >= 1) continue;
        const p = Sim.POCKETS[k.pocket];
        drawBall(c, { n: k.n, x: k.x + (p.x - k.x) * t, y: k.y + (p.y - k.y) * t }, 1 - t, 1 - t * 0.45);
      }
    }
    if (!view || anim || view.phase !== 'playing') return;
    const cue = balls.find((b) => b.n === 0);
    if (!cue) return;
    if (myTurn()) {
      drawGuide(c, balls, cue, aim.x, aim.y, view.turn, false);
      drawCueStick(c, cue, aim.x, aim.y, pulling ? pull : 0, false);
      if (view.ballInHand) {
        const ok = Sim.validCueSpot(balls.filter((b) => b.n !== 0), cue.x, cue.y, view.kitchen);
        c.strokeStyle = ok ? 'rgba(57,255,20,.8)' : 'rgba(255,77,77,.9)';
        c.lineWidth = 1.5;
        c.setLineDash([2, 2]);
        c.beginPath();
        c.arc(tx(cue.x), ty(cue.y), (Sim.R + 1.6) * scale, 0, Math.PI * 2);
        c.stroke();
        c.setLineDash([]);
        if (!placing) {
          c.fillStyle = 'rgba(255,255,255,.75)';
          c.font = `${Math.max(10, 2.6 * scale)}px sans-serif`;
          c.textAlign = 'center';
          c.fillText('✋ drag to place', tx(cue.x), ty(cue.y) - (Sim.R + 3) * scale);
        }
      }
    } else if (remoteAim && remoteAim.shotNo === view.shotNo) {
      drawGuide(c, balls, cue, remoteAim.dx, remoteAim.dy, view.turn, true);
      drawCueStick(c, cue, remoteAim.dx, remoteAim.dy, remoteAim.power || 0, true);
    }
  }

  function drawSpin() {
    const c = spinCtx;
    c.clearRect(0, 0, 64, 64);
    const g = c.createRadialGradient(24, 22, 3, 32, 32, 30);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#bdb7a6');
    c.fillStyle = g;
    c.beginPath();
    c.arc(32, 32, 29, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#1f8f0c';
    c.lineWidth = 2;
    c.stroke();
    c.strokeStyle = 'rgba(0,0,0,.15)';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(32, 5); c.lineTo(32, 59); c.moveTo(5, 32); c.lineTo(59, 32);
    c.stroke();
    c.fillStyle = '#d21f1f';
    c.beginPath();
    c.arc(32 + spin.x * 22, 32 - spin.y * 22, 5, 0, Math.PI * 2);
    c.fill();
    const lbl = spin.y > 0.15 ? 'FOLLOW' : spin.y < -0.15 ? 'DRAW' : 'CENTER';
    spinLbl.textContent = `SPIN · ${lbl}${Math.abs(spin.x) > 0.15 ? (spin.x > 0 ? ' · R' : ' · L') : ''}`;
  }

  function drawPower() {
    const p = pulling ? pull : kbPower;
    powerFill.style.height = `${Math.round(p * 100)}%`;
    powerFill.style.opacity = pulling ? 1 : 0.4;
    powerLbl.textContent = `${Math.round(p * 100)}%`;
    powerEl.classList.toggle('off', !myTurn());
  }

  // ---- animation -----------------------------------------------------------------------------
  let raf = 0;
  function loop() {
    raf = 0;
    if (destroyed) return;
    if (anim) {
      const now = performance.now();
      const want = Math.min(Math.floor(((now - anim.startT) / 1000) * 480), anim.stepsDone + 480);
      let loudBall = 0;
      let loudRail = 0;
      while (anim.stepsDone < want && !anim.run.done) {
        const before = new Map(anim.run.balls.map((b) => [b.n, { x: b.x, y: b.y }]));
        const ev = anim.run.step();
        anim.stepsDone++;
        for (const e of ev) {
          if (e.t === 'ball') loudBall = Math.max(loudBall, e.v);
          else if (e.t === 'rail') loudRail = Math.max(loudRail, e.v);
          else if (e.t === 'pot') {
            const p = before.get(e.n);
            anim.sinking.push({ n: e.n, pocket: e.pocket, x: p.x, y: p.y, t0: now });
            sfx.play(e.n === 0 ? 'error' : 'capture');
          }
        }
      }
      if (loudBall > 15) sfx.play('move', { vol: Math.min(1, loudBall / 300) });
      if (loudRail > 25) sfx.play('dry', { vol: Math.min(1, loudRail / 400) });
      if (anim.run.done && performance.now() - Math.max(0, ...anim.sinking.map((k) => k.t0)) > 280) finishAnim();
    }
    draw();
    if (anim) raf = requestAnimationFrame(loop);
  }
  function kick() { if (!raf) raf = requestAnimationFrame(loop); }

  function startAnim(ls) {
    anim = { run: Sim.createShot(ls.start, ls.shot), shotNo: ls.shotNo, startT: performance.now(), stepsDone: 0, sinking: [] };
    remoteAim = null;
    sfx.play('move', { vol: 0.4 + ls.shot.power * 0.6 });
    render();
    kick();
  }

  function finishAnim() {
    const ls = view && view.lastShot;
    anim = null;
    if (ls) {
      const msgs = [];
      if (ls.foul) msgs.push(`FOUL — ${FOULS[ls.foul] || ls.foul}${view.winner ? '' : `: ${seatName(other(ls.by))} has ball in hand`}`);
      for (const n of ls.notes || []) msgs.push(n);
      if (msgs.length) showToast(msgs.join(' · '));
    }
    if (view && view.phase === 'game_over') sfx.play(view.winner === mySeat() ? 'win' : mySeat() ? 'lose' : 'chime');
    afterSettle();
    render();
  }

  // Called when the table is at rest with the newest state shown.
  function afterSettle() {
    placeSpot = null;
    if (!view) return;
    const key = `${view.gameId}:${view.shotNo}`;
    if (myTurn() && aimKey !== key) {
      aimKey = key;
      spin = { x: 0, y: 0 };
      defaultAim(view.turn);
      drawSpin();
      if (view.lastShot && view.lastShot.by !== mySeat()) sfx.play('turn');
    }
  }

  function showToast(text) {
    toast = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast = ''; renderErr(); }, 4000);
    renderErr();
  }

  // ---- input ---------------------------------------------------------------------------------
  function sendAim(force) {
    const now = performance.now();
    if (!force && now - lastAimSent < 100) return;
    lastAimSent = now;
    const msg = { kind: 'aim', dx: aim.x, dy: aim.y, power: pulling ? pull : 0 };
    if (view.ballInHand && placeSpot) msg.cue = placeSpot;
    api.sendAction(msg);
  }

  function setAimTo(p) {
    const cue = shownBalls().find((b) => b.n === 0);
    if (!cue) return;
    const dx = p.x - cue.x;
    const dy = p.y - cue.y;
    const m = Math.hypot(dx, dy);
    if (m < 0.5) return;
    aim = { x: dx / m, y: dy / m };
  }

  function rotateAim(rad) {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    aim = { x: aim.x * c - aim.y * s, y: aim.x * s + aim.y * c };
  }

  canvas.addEventListener('pointerdown', (ev) => {
    if (!myTurn()) return;
    const p = toTable(ev);
    const cue = shownBalls().find((b) => b.n === 0);
    canvas.setPointerCapture(ev.pointerId);
    if (view.ballInHand && cue && Math.hypot(p.x - cue.x, p.y - cue.y) < Sim.R * 2.4) {
      placing = true;
      canvas.style.cursor = 'grabbing';
      sfx.play('click');
    } else {
      aiming = true;
      setAimTo(p);
      sendAim();
    }
    draw();
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!myTurn()) return;
    const p = toTable(ev);
    if (placing) {
      const R = Sim.R;
      const maxX = view.kitchen ? Sim.HEAD_X : Sim.L - R;
      placeSpot = { x: Math.max(R, Math.min(maxX, p.x)), y: Math.max(R, Math.min(Sim.W - R, p.y)) };
      sendAim();
      draw();
    } else if (aiming) {
      setAimTo(p);
      sendAim();
      draw();
    } else if (view.ballInHand) {
      const cue = shownBalls().find((b) => b.n === 0);
      canvas.style.cursor = cue && Math.hypot(p.x - cue.x, p.y - cue.y) < Sim.R * 2.4 ? 'grab' : 'crosshair';
    }
  });
  const endCanvasDrag = () => {
    if (placing) {
      placing = false;
      canvas.style.cursor = 'crosshair';
      const balls = shownBalls();
      const cue = balls.find((b) => b.n === 0);
      if (cue && !Sim.validCueSpot(balls.filter((b) => b.n !== 0), cue.x, cue.y, view.kitchen)) {
        sfx.play('error');
        placeSpot = null;
      } else {
        defaultAimIfFacingNothing();
      }
      sendAim(true);
    }
    aiming = false;
    draw();
  };
  canvas.addEventListener('pointerup', endCanvasDrag);
  canvas.addEventListener('pointercancel', endCanvasDrag);
  function defaultAimIfFacingNothing() {
    const balls = shownBalls();
    const cue = balls.find((b) => b.n === 0);
    if (cue && traceAim(balls, cue, aim.x, aim.y).kind !== 'ball') defaultAim(view.turn);
  }

  let pullStartY = 0;
  powerEl.addEventListener('pointerdown', (ev) => {
    if (!myTurn()) return;
    powerEl.setPointerCapture(ev.pointerId);
    pulling = true;
    pullStartY = ev.clientY;
    pull = 0;
    drawPower();
    draw();
  });
  powerEl.addEventListener('pointermove', (ev) => {
    if (!pulling) return;
    const h = powerEl.clientHeight || 200;
    pull = Math.max(0, Math.min(1, (ev.clientY - pullStartY) / (h * 0.9)));
    drawPower();
    sendAim();
    draw();
  });
  const releasePower = () => {
    if (!pulling) return;
    pulling = false;
    const p = pull;
    pull = 0;
    drawPower();
    if (p >= 0.03) {
      kbPower = p;
      shoot(p);
    } else {
      sendAim(true);
      draw();
    }
  };
  powerEl.addEventListener('pointerup', releasePower);
  powerEl.addEventListener('pointercancel', () => { pulling = false; pull = 0; drawPower(); draw(); });

  function setSpinFrom(ev) {
    const r = spinCanvas.getBoundingClientRect();
    let x = ((ev.clientX - r.left) / r.width - 0.5) / 0.35;
    let y = -((ev.clientY - r.top) / r.height - 0.5) / 0.35;
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    spin = { x: Math.round(x * 20) / 20, y: Math.round(y * 20) / 20 };
    drawSpin();
  }
  let spinDrag = false;
  spinCanvas.addEventListener('pointerdown', (ev) => { spinDrag = true; spinCanvas.setPointerCapture(ev.pointerId); setSpinFrom(ev); });
  spinCanvas.addEventListener('pointermove', (ev) => { if (spinDrag) setSpinFrom(ev); });
  spinCanvas.addEventListener('pointerup', () => { spinDrag = false; sfx.play('click'); });
  spinCanvas.addEventListener('dblclick', () => { spin = { x: 0, y: 0 }; drawSpin(); });

  function shoot(power) {
    if (!myTurn()) return;
    const msg = { kind: 'shoot', dx: aim.x, dy: aim.y, power, spinX: spin.x, spinY: spin.y };
    if (view.ballInHand) {
      const balls = shownBalls();
      const cue = balls.find((b) => b.n === 0);
      if (!Sim.validCueSpot(balls.filter((b) => b.n !== 0), cue.x, cue.y, view.kitchen)) {
        sfx.play('error');
        flash('bad_spot');
        return;
      }
      msg.cue = { x: cue.x, y: cue.y };
    }
    api.sendAction(msg);
  }

  function onKey(ev) {
    if (!myTurn() || ev.target.closest && ev.target.closest('input, select, textarea')) return;
    const fine = ev.shiftKey ? 0.0006 : 0.006;
    if (ev.key === 'ArrowLeft') rotateAim(-fine);
    else if (ev.key === 'ArrowRight') rotateAim(fine);
    else if (ev.key === 'ArrowUp') kbPower = Math.min(1, Math.round((kbPower + 0.05) * 100) / 100);
    else if (ev.key === 'ArrowDown') kbPower = Math.max(0.05, Math.round((kbPower - 0.05) * 100) / 100);
    else if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); shoot(kbPower); return; }
    else return;
    ev.preventDefault();
    sendAim();
    drawPower();
    draw();
  }
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', resize);

  function flash(reason) {
    flashError = reason;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { flashError = null; renderErr(); }, 2200);
    renderErr();
  }

  // ---- DOM chrome ----------------------------------------------------------------------------
  function renderErr() {
    err.innerHTML = '';
    if (flashError) {
      err.textContent = REJECT_MESSAGES[flashError] || flashError;
    } else if (toast) {
      const t = document.createElement('span');
      t.className = 'pl-toast';
      t.textContent = toast;
      err.appendChild(t);
    }
  }

  function seatBox(s) {
    const box = document.createElement('div');
    box.className = `pl-seat${view.phase === 'playing' && view.turn === s ? ' turn' : ''}`;
    const name = document.createElement('span');
    const occ = nicknameFor(view.players[s]);
    name.textContent = `${SEAT_NAMES[s]}: ${occ || '(empty)'}${view.players[s] === api.getClientId() ? ' (you)' : ''}`;
    box.appendChild(name);
    if (view.mode === '8ball' && view.groups[s]) {
      const g = document.createElement('span');
      g.className = 'grp';
      g.textContent = view.groups[s].toUpperCase();
      box.appendChild(g);
    }
    const seat = mySeat();
    if (!view.players[s]) {
      if (!seat) {
        const btn = document.createElement('button');
        btn.textContent = 'SIT HERE';
        btn.addEventListener('click', () => api.sendAction({ kind: 'sit', seat: s }));
        box.appendChild(btn);
      }
      const botBtn = document.createElement('button');
      botBtn.textContent = 'PLAY VS BOT';
      botBtn.addEventListener('click', () => api.sendAction({ kind: 'sit', seat: s, bot: true, level: preferredLevel() }));
      box.append(botBtn, levelSelect(preferredLevel()));
    } else if (view.players[s] === 'BOT') {
      box.appendChild(levelSelect((view.botLevels || {})[s], (level) => api.sendAction({ kind: 'setBotLevel', seat: s, level })));
      const rm = document.createElement('button');
      rm.textContent = 'REMOVE BOT';
      rm.addEventListener('click', () => api.sendAction({ kind: 'removeBot', seat: s }));
      box.appendChild(rm);
    } else if (view.players[s] === api.getClientId()) {
      const lv = document.createElement('button');
      lv.textContent = 'LEAVE SEAT';
      lv.addEventListener('click', () => api.sendAction({ kind: 'leaveSeat' }));
      box.appendChild(lv);
    }
    return box;
  }

  function renderStatus() {
    status.className = 'pl-status';
    status.style.color = '';
    if (!view) { status.textContent = 'Loading…'; return; }
    const mode = view.mode === '9ball' ? '9-BALL' : '8-BALL';
    if (view.phase === 'waiting') { status.textContent = `${mode} — waiting for both seats to be filled.`; return; }
    if (view.phase === 'game_over' && !anim) {
      status.textContent = `${seatName(view.winner).toUpperCase()} WINS — ${REASONS[view.winReason] || ''}`;
      return;
    }
    if (anim) { status.textContent = `${seatName(view.lastShot.by)} shoots…`; return; }
    const mine = myTurn();
    let extra = '';
    if (view.breakShot) extra = ' — BREAK';
    else if (view.ballInHand) extra = ' — BALL IN HAND';
    if (mine) {
      let target = '';
      if (!view.breakShot) {
        if (view.mode === '9ball') target = ` · hit the ${legalTargets(view.turn)[0]} first`;
        else if (!view.groups[view.turn]) target = ' · table open';
        else if (legalTargets(view.turn)[0] === 8) target = ' · on the 8!';
        else target = ` · you're ${view.groups[view.turn]}`;
      }
      status.textContent = `▶ YOUR SHOT${extra}${target}`;
      status.classList.add('mine');
    } else {
      status.textContent = `${seatName(view.turn)} to shoot${extra}`;
      status.style.color = '#3ad7ff';
    }
  }

  function renderRacks() {
    racks.innerHTML = '';
    if (!view) return;
    const onTable = new Set(view.balls.map((b) => b.n));
    if (view.mode === '9ball') {
      const r = document.createElement('div');
      r.className = 'pl-rack';
      for (let n = 1; n <= 9; n++) r.appendChild(miniBall(n, !onTable.has(n)));
      racks.appendChild(r);
      return;
    }
    for (const s of ['p1', 'p2']) {
      const r = document.createElement('div');
      r.className = 'pl-rack';
      const lbl = document.createElement('span');
      lbl.textContent = `${seatName(s)}:`;
      r.appendChild(lbl);
      const g = view.groups[s];
      if (!g) {
        const t = document.createElement('span');
        t.textContent = ' open';
        t.style.color = '#6c6';
        r.appendChild(t);
      } else {
        const nums = g === 'solids' ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15];
        for (const n of nums) r.appendChild(miniBall(n, !onTable.has(n)));
        r.appendChild(miniBall(8, !onTable.has(8)));
      }
      racks.appendChild(r);
    }
  }

  function renderBar() {
    bar.innerHTML = '';
    const modes = document.createElement('div');
    modes.className = 'pl-modes';
    const seat = mySeat();
    const canSwitch = view.phase !== 'playing' && (seat || (!view.players.p1 && !view.players.p2));
    for (const [m, label] of [['8ball', '8-BALL'], ['9ball', '9-BALL']]) {
      const b = document.createElement('button');
      b.textContent = label;
      b.className = view.mode === m ? 'on' : '';
      b.disabled = !canSwitch && view.mode !== m;
      b.addEventListener('click', () => { if (canSwitch && view.mode !== m) api.sendAction({ kind: 'setMode', mode: m }); });
      modes.appendChild(b);
    }
    bar.appendChild(modes);
    if (view.players.p1 && view.players.p2) {
      const sc = document.createElement('span');
      sc.className = 'pl-score';
      sc.textContent = `RACKS  ${seatName('p1')} ${view.score.p1} – ${view.score.p2} ${seatName('p2')}`;
      bar.appendChild(sc);
    }
  }

  function render() {
    if (destroyed) return;
    const seat = mySeat();
    results.update(view && view.phase === 'game_over' && !anim ? duelResults({
      winner: view.winner, colors: ['p1', 'p2'], players: view.players, me: seat, nameFor: (id) => nicknameFor(id) || '(empty)',
      subtitle: `${REASONS[view.winReason] || ''} · racks ${view.score.p1}–${view.score.p2}`,
      onRematch: () => api.sendAction({ kind: 'resetGame' }),
    }) : null);
    renderStatus();
    renderErr();
    if (!view) return;
    seats.innerHTML = '';
    seats.append(seatBox('p1'), seatBox('p2'));
    renderBar();
    renderRacks();
    drawPower();
    draw();
  }

  function applyState(data) {
    const prev = view;
    view = data;
    if (!Sim) { render(); return; }
    const ls = data.lastShot;
    if (prev && prev.gameId !== data.gameId) {
      anim = null;
      shownShotNo = data.shotNo;
      if (data.phase === 'playing') sfx.play('go');
    }
    if (ls && ls.shotNo > shownShotNo && prev && prev.gameId === data.gameId) {
      shownShotNo = ls.shotNo;
      startAnim(ls);
      return;
    }
    shownShotNo = Math.max(shownShotNo, data.shotNo);
    if (!anim) afterSettle();
    render();
  }

  drawSpin();
  render();
  loadScript('games/pool/sim.js', 'PoolSim').then((S) => {
    if (destroyed) return;
    Sim = S;
    if (view) shownShotNo = view.shotNo;
    resize();
    if (view) afterSettle();
    render();
  }).catch((e) => { status.textContent = `Failed to load physics: ${e.message}`; });

  return {
    applySnapshot(snapshot) {
      if (!snapshot) return;
      if (!Sim) { view = snapshot; render(); return; }
      shownShotNo = snapshot.shotNo;
      anim = null;
      view = snapshot;
      afterSettle();
      render();
    },
    applyEvent(evt) {
      const data = evt && evt.payload ? evt.payload.data : evt;
      if (!data) return;
      if (data.kind === 'state') applyState(data);
      else if (data.kind === 'aim') {
        if (!view || data.shotNo !== view.shotNo || anim) return;
        remoteAim = data;
        draw();
      } else if (data.kind === 'moveRejected') {
        sfx.play('error');
        flash(data.reason || 'invalid');
      }
    },
    applyRoster(r) {
      roster = r || [];
      render();
    },
    unmount() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      clearTimeout(flashTimer);
      clearTimeout(toastTimer);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', resize);
      results.destroy();
      container.innerHTML = '';
    },
  };
}
