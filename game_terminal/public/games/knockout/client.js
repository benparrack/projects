// Knockout client — top-down 2D canvas of the ice floe. During planning, drag out from any of your
// penguins to set its arrow (direction + power; drag back onto the penguin to clear it), then hit
// LOCK IN. Your arrows are private until both sides commit (or the round timer runs out — your
// current arrows count). The server then resolves everything at once with the shared sim
// (sim.js); every client replays the same frames: a short reveal of both sides' arrows, the slide
// with collisions and splash-downs, then (every 2nd round) the floe cracking smaller.
// The board is rotated so your own penguins start at the bottom (spectators see red at bottom).

import { sfx } from '../sfx.js';
import { preferredLevel, levelSelect } from '../botLevel.js';
import { createResults, duelResults } from '../resultsPanel.js';
import { makeServerClock } from '../serverClock.js';
import { createFx } from '../canvasFx.js';
import { loadScript } from '../loadScript.js';
import { injectStyle, reduced } from '../dom.js';

const COLORS = ['red', 'blue'];
const TEAM = { red: '#ff4a5e', blue: '#4a9dff' };
const TEAM_DARK = { red: '#a3182b', blue: '#1b4fa8' };

const REJECT_MESSAGES = {
  not_playing: 'The game is not running.',
  not_seated: 'Take a seat to play.',
  busy: 'Wait for the round to finish.',
  locked: 'You already locked in this round.',
  invalid: 'Invalid move.',
};

const CSS = `
.ko-root { display: flex; flex-direction: column; align-items: center; gap: 8px; font-family: monospace; color: #b8ffb0; width: 100%; }
.ko-status { font-size: 15px; font-weight: bold; letter-spacing: 1px; text-align: center; min-height: 20px; }
.ko-status.mine { color: #39ff14; text-shadow: 0 0 8px #39ff14; }
.ko-err { color: #ff5a5a; font-size: 12px; min-height: 14px; }
.ko-seats { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; align-items: center; }
.ko-seat { display: flex; align-items: center; gap: 6px; padding: 5px 8px; border: 1px solid #1d5c1d; border-radius: 6px; background: #071107; font-size: 13px; }
.ko-seat.locked { border-color: #39ff14; box-shadow: 0 0 10px -2px #39ff14; }
.ko-seat button, .ko-row button { font: inherit; font-size: 12px; }
.ko-chip { width: 14px; height: 14px; border-radius: 50%; display: inline-block; flex: none; background: #11141b; box-shadow: inset 0 0 0 3px var(--c); }
.ko-tag { font-size: 11px; padding: 1px 5px; border-radius: 4px; border: 1px solid currentColor; }
.ko-stage { position: relative; width: min(100%, 580px, 68vh); aspect-ratio: 1 / 1; border: 1px solid #1d5c1d; border-radius: 10px; overflow: hidden;
  background: #04121e; touch-action: none; user-select: none; -webkit-user-select: none; }
.ko-stage canvas { display: block; width: 100%; height: 100%; }
.ko-row { display: flex; gap: 8px; align-items: center; justify-content: center; flex-wrap: wrap; font-size: 12px; min-height: 30px; }
.ko-lock { font: inherit; font-size: 15px !important; font-weight: bold; letter-spacing: 2px; padding: 6px 22px; border-radius: 6px; cursor: pointer;
  background: #0b2a0b; color: #39ff14; border: 2px solid #39ff14; box-shadow: 0 0 12px -3px #39ff14; }
.ko-lock:disabled { opacity: .45; cursor: default; box-shadow: none; }
.ko-lock.done { background: #39ff14; color: #031003; }
.ko-row label { display: flex; gap: 5px; align-items: center; cursor: pointer; }
.ko-help { font-size: 11px; opacity: .7; text-align: center; max-width: 560px; }
.ko-fail { padding: 30px; text-align: center; color: #ff8080; }
`;

// Seeded scratches / cracks on the ice (world coords, fixed per page).
function iceMarks(H0) {
  let s = 1234567;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const marks = [];
  for (let i = 0; i < 26; i++) {
    const x = (rnd() * 2 - 1) * H0;
    const y = (rnd() * 2 - 1) * H0;
    const a = rnd() * Math.PI;
    const len = 0.8 + rnd() * 3.2;
    const pts = [[x, y]];
    let cx = x;
    let cy = y;
    let ang = a;
    const segs = 2 + Math.floor(rnd() * 3);
    for (let k = 0; k < segs; k++) {
      ang += (rnd() - 0.5) * 0.9;
      cx += Math.cos(ang) * len / segs;
      cy += Math.sin(ang) * len / segs;
      pts.push([cx, cy]);
    }
    marks.push({ pts, w: 0.5 + rnd() * 1.2, a: 0.12 + rnd() * 0.2 });
  }
  return marks;
}

export function mount(container, api) {
  injectStyle(CSS);
  let view = null;
  let roster = [];
  let flashError = null;
  let flashTimer = null;
  let destroyed = false;
  let S = null; // KnockoutSim once loaded
  let raf = 0;
  let marks = null;
  const clock = makeServerClock();
  const fx = createFx();

  const root = document.createElement('div');
  root.className = 'ko-root';
  container.appendChild(root);
  const results = createResults(container);

  const status = document.createElement('div');
  status.className = 'ko-status';
  const err = document.createElement('div');
  err.className = 'ko-err';
  const seats = document.createElement('div');
  seats.className = 'ko-seats';
  const stage = document.createElement('div');
  stage.className = 'ko-stage';
  const canvas = document.createElement('canvas');
  stage.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  // planning controls: built once, patched in place (never re-rendered under the pointer)
  const controls = document.createElement('div');
  controls.className = 'ko-row';
  const lockBtn = document.createElement('button');
  lockBtn.className = 'ko-lock';
  lockBtn.textContent = 'LOCK IN';
  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'CLEAR ARROWS';
  controls.append(lockBtn, clearBtn);
  const options = document.createElement('div');
  options.className = 'ko-row';
  const help = document.createElement('div');
  help.className = 'ko-help';
  help.textContent = 'Drag out from your penguins to aim them. Longer arrow = harder shove. Both players move at the same time; arrows stay secret until everyone locks in. Knock their penguins off the ice. It shrinks every 2 rounds. Last team standing wins.';
  root.append(status, err, seats, stage, controls, options, help);

  // ---- game-state helpers ----
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
  const sideOf = (id) => (id[0] === 'r' ? 'red' : 'blue');

  // ---- local planning / animation state ----
  const drafts = new Map(); // my penguin id -> { a, p } (world angle)
  let draftRound = 0; // round + gameId the drafts belong to
  let lockSent = false;
  let drag = null; // { pointerId, id }
  let hoverId = null;
  let anim = null; // { rec, start, fired:Set }
  let lastSeqSeen = 0;
  let lastTickSec = -1;
  let shownPlan = null; // last canPlan() value the DOM was patched for
  let shownLocked = null;

  function flip() { return mySeat() === 'blue' ? -1 : 1; }

  // ---- geometry ----
  let W = 0; // css px size of the square stage
  function scale() { return W / (2 * ((S ? S.H0 : 10) + 1.7)); }
  function toScreen(x, y) {
    const f = flip();
    const s = scale();
    return [W / 2 + f * x * s, W / 2 + f * y * s];
  }
  function toWorld(px, py) {
    const f = flip();
    const s = scale();
    return [f * (px - W / 2) / s, f * (py - W / 2) / s];
  }
  const screenAngle = (a) => (flip() === -1 ? a + Math.PI : a);

  function canPlan() {
    const seat = mySeat();
    return !!(S && view && seat && view.phase === 'playing' && !anim && !view.locked[seat] && !lockSent
      && clock.now() >= view.planFrom - 150 && view.penguins.some((p) => p.side === seat));
  }

  function myPenguinAt(wx, wy) {
    const seat = mySeat();
    if (!view || !seat) return null;
    let best = null;
    let bd = Infinity;
    for (const p of view.penguins) {
      if (p.side !== seat) continue;
      let d = Math.hypot(p.x - wx, p.y - wy);
      // also grab by an existing arrow tip
      const m = drafts.get(p.id);
      if (m && m.p > 0) {
        const tx = p.x + Math.cos(m.a) * m.p * S.MAX_ARROW;
        const ty = p.y + Math.sin(m.a) * m.p * S.MAX_ARROW;
        d = Math.min(d, Math.hypot(tx - wx, ty - wy));
      }
      if (d < bd) { bd = d; best = p; }
    }
    return best && bd <= S.R * 1.7 ? best : null;
  }

  function sendDrafts(lock) {
    const moves = {};
    for (const [id, m] of drafts) moves[id] = { a: m.a, p: m.p };
    api.sendAction({ kind: 'submit', moves, lock: !!lock });
  }

  // ---- input ----
  function localPoint(e) {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (W / r.height)];
  }
  stage.addEventListener('pointerdown', (e) => {
    if (!canPlan()) return;
    const [px, py] = localPoint(e);
    const [wx, wy] = toWorld(px, py);
    const p = myPenguinAt(wx, wy);
    if (!p) return;
    e.preventDefault();
    stage.setPointerCapture(e.pointerId);
    drag = { pointerId: e.pointerId, id: p.id };
    sfx.play('click');
    stage.style.cursor = 'grabbing';
  });
  stage.addEventListener('pointermove', (e) => {
    if (!S || !view) return;
    const [px, py] = localPoint(e);
    const [wx, wy] = toWorld(px, py);
    if (drag && e.pointerId === drag.pointerId) {
      const p = view.penguins.find((q) => q.id === drag.id);
      if (!p) return;
      const dx = wx - p.x;
      const dy = wy - p.y;
      const len = Math.hypot(dx, dy);
      if (len < S.R * 0.9) drafts.set(p.id, { a: drafts.has(p.id) ? drafts.get(p.id).a : 0, p: 0 });
      else drafts.set(p.id, S.normMove({ a: Math.atan2(dy, dx), p: Math.min(1, (len - S.R * 0.5) / S.MAX_ARROW) }));
      return;
    }
    // hover: only a cursor change, nothing re-rendered
    const h = canPlan() ? myPenguinAt(wx, wy) : null;
    const id = h ? h.id : null;
    if (id !== hoverId) {
      hoverId = id;
      stage.style.cursor = id ? 'grab' : '';
    }
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const id = drag.id;
    drag = null;
    stage.style.cursor = hoverId ? 'grab' : '';
    const m = drafts.get(id);
    if (m && m.p <= 0) drafts.delete(id);
    if (!canPlan()) return;
    sfx.play(m && m.p > 0 ? 'select' : 'tick');
    sendDrafts(false);
    patchControls(true);
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('pointerleave', () => {
    if (!drag && hoverId) { hoverId = null; stage.style.cursor = ''; }
  });

  lockBtn.addEventListener('click', () => {
    if (!canPlan()) return;
    lockSent = true;
    sendDrafts(true);
    sfx.play('check');
    patchControls(true);
    renderStatus();
  });
  clearBtn.addEventListener('click', () => {
    if (!canPlan() || !drafts.size) return;
    drafts.clear();
    sendDrafts(false);
    sfx.play('swap');
    patchControls(true);
  });

  function patchControls(force) {
    const seat = mySeat();
    const plan = canPlan();
    const locked = !!(seat && view && view.phase === 'playing' && (view.locked[seat] || lockSent));
    if (!force && plan === shownPlan && locked === shownLocked) return;
    shownPlan = plan;
    shownLocked = locked;
    controls.style.visibility = seat && view && view.phase === 'playing' ? 'visible' : 'hidden';
    lockBtn.disabled = !plan;
    lockBtn.classList.toggle('done', locked);
    lockBtn.textContent = locked ? 'LOCKED IN ✓' : drafts.size ? 'LOCK IN' : 'LOCK IN (STAY PUT)';
    clearBtn.disabled = !plan || !drafts.size;
    renderStatus();
  }

  // ---- animation ----
  function startAnim(rec) {
    anim = { rec, start: performance.now(), fired: new Set() };
    drag = null;
    sfx.play('beep');
    fx.bigLabel('REVEAL', '#ffe14d');
    renderDom();
  }

  function finishAnim() {
    anim = null;
    renderDom();
    if (view && view.phase === 'playing') {
      fx.bigLabel('GO', '#39ff14');
      if (mySeat()) setTimeout(() => sfx.play('turn'), 120);
    }
  }

  // Where every penguin is at anim time t (ms). Returns [{id, side, x, y, face, sink(0..1), alpha}]
  function animPenguins(t) {
    const rec = anim.rec;
    const n = rec.frames.length;
    const slideT = Math.max(0, t - rec.revealMs);
    const f = slideT / (S.FRAME_DT * 1000);
    const i = Math.min(n - 1, Math.floor(f));
    const k = Math.min(1, f - i);
    const A = rec.frames[i];
    const B = rec.frames[Math.min(n - 1, i + 1)];
    const outF = new Map(rec.outs.map((o) => [o.id, o.f]));
    const slideEnd = rec.revealMs + n * S.FRAME_DT * 1000 + rec.holdMs;
    const shrinkK = rec.shrinkMs ? Math.min(1, Math.max(0, (t - slideEnd) / rec.shrinkMs)) : 0;
    const Hnow = rec.H + (rec.nextH - rec.H) * easeInOut(shrinkK);
    const list = [];
    rec.ids.forEach((id, j) => {
      const before = rec.before.find((b) => b.id === id) || {};
      const x = A[j * 2] + (B[j * 2] - A[j * 2]) * k;
      const y = A[j * 2 + 1] + (B[j * 2 + 1] - A[j * 2 + 1]) * k;
      let face = before.face || 0;
      // face along travel
      const px = rec.frames[Math.max(0, i - 1)][j * 2];
      const py = rec.frames[Math.max(0, i - 1)][j * 2 + 1];
      if (Math.hypot(B[j * 2] - px, B[j * 2 + 1] - py) > 0.02) face = Math.atan2(B[j * 2 + 1] - py, B[j * 2] - px);
      else if (t >= rec.revealMs) face = lastFace.get(id) ?? face;
      else {
        const m = rec.moves[id];
        if (m && m.p > 0) face = m.a;
      }
      lastFace.set(id, face);
      let sink = 0;
      if (outF.has(id) && f >= outF.get(id)) sink = Math.min(1, (f - outF.get(id)) / 18);
      if (rec.fell.includes(id) && shrinkK > 0) {
        const edge = Math.max(Math.abs(x), Math.abs(y));
        if (edge > Hnow) sink = Math.min(1, sink + (t - slideEnd - rec.shrinkMs * fellStart(rec, x, y)) / 450);
      }
      list.push({ id, side: sideOf(id), x, y, face, sink: Math.max(0, sink) });
    });
    return { list, f, Hnow, slideEnd, shrinkK };
  }
  const lastFace = new Map();
  function fellStart(rec, x, y) {
    // fraction of the shrink at which the edge passes (x, y)
    const edge = Math.max(Math.abs(x), Math.abs(y));
    if (rec.H === rec.nextH) return 0;
    const u = Math.min(1, Math.max(0, (rec.H - edge) / (rec.H - rec.nextH)));
    return u; // approximate (ease ignored)
  }
  const easeInOut = (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);

  function fireEvents(t, list) {
    const rec = anim.rec;
    const f = Math.max(0, (t - rec.revealMs) / (S.FRAME_DT * 1000));
    const s = scale();
    const pos = (id) => list.find((p) => p.id === id);
    if (t >= rec.revealMs && !anim.fired.has('go')) {
      anim.fired.add('go');
      if (Object.values(rec.moves).some((m) => m.p > 0)) sfx.play('slide');
    }
    for (const ev of rec.events) {
      const key = `h${ev.f}:${ev.a}:${ev.b}`;
      if (f >= ev.f && !anim.fired.has(key)) {
        anim.fired.add(key);
        const a = pos(ev.a);
        const b = pos(ev.b);
        if (a && b) {
          const [sx, sy] = toScreen((a.x + b.x) / 2, (a.y + b.y) / 2);
          fx.ring(sx, sy, '#ffffff', { radius: S.R * s * (1 + ev.s / 10), life: 0.35, width: 3 });
          fx.burst(sx, sy, '#dff6ff', { count: Math.round(6 + ev.s * 1.5), speed: 60 + ev.s * 14, life: 0.4, size: 2 });
          fx.shake(Math.min(8, ev.s * 0.6));
        }
        sfx.play(ev.s > 7 ? 'capture' : 'move');
      }
    }
    for (const o of rec.outs) {
      const key = `o${o.id}`;
      if (f >= o.f && !anim.fired.has(key)) {
        anim.fired.add(key);
        splashAt(pos(o.id), o.id);
      }
    }
    if (rec.shrinkMs) {
      const slideEnd = rec.revealMs + rec.frames.length * S.FRAME_DT * 1000 + rec.holdMs;
      if (t >= slideEnd && !anim.fired.has('shrink')) {
        anim.fired.add('shrink');
        sfx.play('crash');
        fx.shake(6);
        fx.bigLabel('CRACK', '#8fe3ff');
      }
      for (const id of rec.fell) {
        const p = pos(id);
        if (!p) continue;
        const at = slideEnd + rec.shrinkMs * fellStart(rec, p.x, p.y);
        if (t >= at && !anim.fired.has(`f${id}`)) {
          anim.fired.add(`f${id}`);
          splashAt(p, id);
        }
      }
    }
  }

  function splashAt(p, id) {
    if (!p) return;
    const s = scale();
    const [sx, sy] = toScreen(p.x, p.y);
    fx.burst(sx, sy, '#bfe9ff', { count: 30, speed: 150, life: 0.7, size: 3 });
    fx.ring(sx, sy, '#7fd0ff', { radius: S.R * s * 2.6, life: 0.7, width: 4 });
    const seat = mySeat();
    const side = sideOf(id);
    fx.text(sx, sy - S.R * s, seat ? (side === seat ? 'OOF' : 'KO') : 'SPLASH', TEAM[side], { size: 16, life: 1.1 });
    sfx.play('whoosh', { vol: 0.8 });
    setTimeout(() => sfx.play('pop'), 120);
  }

  // ---- drawing ----
  function drawWater(now) {
    const g = ctx.createRadialGradient(W / 2, W / 2, W * 0.1, W / 2, W / 2, W * 0.75);
    g.addColorStop(0, '#0d4a6e');
    g.addColorStop(1, '#03182a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, W);
    if (reduced()) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(160,220,255,0.07)';
    ctx.lineWidth = 2;
    const t = now / 1000;
    for (let r = 0; r < 16; r++) {
      const y0 = (r + 0.5) * (W / 16);
      ctx.beginPath();
      for (let x = 0; x <= W; x += 12) {
        const y = y0 + Math.sin(x / 38 + t * 1.3 + r * 1.7) * 4 + Math.sin(x / 91 - t * 0.7 + r) * 3;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawIce(H, crackTo, now) {
    const s = scale();
    const [x0, y0] = toScreen(-H, -H);
    const [x1, y1] = toScreen(H, H);
    const left = Math.min(x0, x1);
    const top = Math.min(y0, y1);
    const size = Math.abs(x1 - x0);
    // underwater shelf + shadow
    ctx.fillStyle = 'rgba(120,200,240,0.18)';
    ctx.fillRect(left - 6, top - 6, size + 12, size + 12);
    ctx.fillStyle = 'rgba(0,10,30,0.35)';
    ctx.fillRect(left + 5, top + 8, size, size);
    const g = ctx.createLinearGradient(left, top, left + size, top + size);
    g.addColorStop(0, '#f4fbff');
    g.addColorStop(0.55, '#d6eefa');
    g.addColorStop(1, '#b4dbef');
    ctx.fillStyle = g;
    ctx.fillRect(left, top, size, size);
    // scratches, clipped to the floe
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, size, size);
    ctx.clip();
    for (const m of marks) {
      ctx.strokeStyle = `rgba(110,160,190,${m.a})`;
      ctx.lineWidth = m.w;
      ctx.beginPath();
      m.pts.forEach(([x, y], i) => {
        const [sx, sy] = toScreen(x, y);
        if (i) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy);
      });
      ctx.stroke();
    }
    // the rim that will break off after this round
    if (crackTo != null && crackTo < H) {
      const [c0x, c0y] = toScreen(-crackTo, -crackTo);
      const [c1x, c1y] = toScreen(crackTo, crackTo);
      const cl = Math.min(c0x, c1x);
      const ct = Math.min(c0y, c1y);
      const cs = Math.abs(c1x - c0x);
      const pulse = 0.18 + 0.1 * Math.sin(now / 260);
      ctx.fillStyle = `rgba(255,120,90,${pulse})`;
      ctx.beginPath();
      ctx.rect(left, top, size, size);
      ctx.rect(cl, ct, cs, cs);
      ctx.fill('evenodd');
      ctx.strokeStyle = 'rgba(70,110,140,0.9)';
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 5]);
      ctx.strokeRect(cl, ct, cs, cs);
      ctx.setLineDash([]);
    }
    ctx.restore();
    // bright rim
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = Math.max(2, s * 0.12);
    ctx.strokeRect(left, top, size, size);
  }

  function drawPenguin(p, opts = {}) {
    const s = scale();
    const r = S.R * s;
    const [x, y] = toScreen(p.x, p.y);
    const sink = p.sink || 0;
    if (sink >= 1) return;
    const sc = 1 - sink * 0.55;
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = 1 - sink * 0.9;
    ctx.scale(sc, sc);
    if (opts.glow) {
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.45, 0, Math.PI * 2);
      ctx.fillStyle = `${TEAM[p.side]}33`;
      ctx.fill();
    }
    // shadow
    ctx.fillStyle = sink ? 'rgba(0,30,60,0.3)' : 'rgba(40,80,110,0.28)';
    ctx.beginPath();
    ctx.ellipse(r * 0.12, r * 0.2, r * 1.04, r * 1.0, 0, 0, Math.PI * 2);
    ctx.fill();
    // team ring
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.02, 0, Math.PI * 2);
    ctx.fillStyle = TEAM[p.side];
    ctx.fill();
    ctx.rotate(screenAngle(p.face || 0));
    // flippers
    ctx.fillStyle = '#151922';
    for (const sgn of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(-r * 0.12, sgn * r * 0.86, r * 0.42, r * 0.17, sgn * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
    // body
    const bg = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
    bg.addColorStop(0, '#3b4252');
    bg.addColorStop(1, '#0b0d12');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.84, 0, Math.PI * 2);
    ctx.fill();
    // white face / belly patch toward the front
    ctx.fillStyle = '#f7fbff';
    ctx.beginPath();
    ctx.ellipse(r * 0.3, 0, r * 0.48, r * 0.56, 0, 0, Math.PI * 2);
    ctx.fill();
    // eyes
    for (const sgn of [-1, 1]) {
      ctx.fillStyle = '#0b0d12';
      ctx.beginPath();
      ctx.arc(r * 0.46, sgn * r * 0.24, r * 0.09, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(r * 0.49, sgn * r * 0.22, r * 0.035, 0, Math.PI * 2);
      ctx.fill();
    }
    // beak
    ctx.fillStyle = '#ffab1f';
    ctx.beginPath();
    ctx.moveTo(r * 0.68, -r * 0.14);
    ctx.lineTo(r * 1.12, 0);
    ctx.lineTo(r * 0.68, r * 0.14);
    ctx.closePath();
    ctx.fill();
    // team bobble hat on the back of the head
    ctx.fillStyle = TEAM_DARK[p.side];
    ctx.beginPath();
    ctx.arc(-r * 0.22, 0, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(-r * 0.42, 0, r * 0.11, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawArrow(p, m, color, opts = {}) {
    if (!m || m.p <= 0) return;
    const s = scale();
    const r = S.R * s;
    const len = m.p * S.MAX_ARROW * (opts.grow == null ? 1 : opts.grow);
    const [x0, y0] = toScreen(p.x, p.y);
    const [x1, y1] = toScreen(p.x + Math.cos(m.a) * (len + S.R * 0.5), p.y + Math.sin(m.a) * (len + S.R * 0.5));
    const ang = Math.atan2(y1 - y0, x1 - x0);
    const sx = x0 + Math.cos(ang) * r * 1.1;
    const sy = y0 + Math.sin(ang) * r * 1.1;
    if (Math.hypot(x1 - sx, y1 - sy) < 4) return;
    ctx.save();
    ctx.globalAlpha = opts.alpha == null ? 1 : opts.alpha;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = r * 0.42;
    ctx.beginPath(); ctx.moveTo(sx, sy + 2); ctx.lineTo(x1, y1 + 2); ctx.stroke();
    const g = ctx.createLinearGradient(sx, sy, x1, y1);
    g.addColorStop(0, `${color}88`);
    g.addColorStop(1, color);
    ctx.strokeStyle = g;
    ctx.lineWidth = r * 0.32;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(x1 - Math.cos(ang) * r * 0.4, y1 - Math.sin(ang) * r * 0.4); ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x1 + Math.cos(ang) * r * 0.25, y1 + Math.sin(ang) * r * 0.25);
    ctx.lineTo(x1 + Math.cos(ang + 2.5) * r * 0.62, y1 + Math.sin(ang + 2.5) * r * 0.62);
    ctx.lineTo(x1 + Math.cos(ang - 2.5) * r * 0.62, y1 + Math.sin(ang - 2.5) * r * 0.62);
    ctx.closePath();
    ctx.fill();
    if (opts.label) {
      ctx.font = `bold ${Math.round(Math.max(11, r * 0.6))}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 3;
      const lx = x1 + Math.cos(ang) * r * 1.1;
      const ly = y1 + Math.sin(ang) * r * 1.1;
      ctx.strokeText(opts.label, lx, ly);
      ctx.fillText(opts.label, lx, ly);
    }
    ctx.restore();
  }

  function drawHud(list, now) {
    const s = Math.max(12, Math.round(W / 38));
    ctx.save();
    ctx.font = `bold ${s}px monospace`;
    ctx.textBaseline = 'top';
    const order = flip() === -1 ? ['blue', 'red'] : ['red', 'blue'];
    order.forEach((side, i) => {
      const n = list.filter((p) => p.side === side && (p.sink || 0) < 0.5).length;
      const name = nicknameFor(view.players[side]) || side.toUpperCase();
      const label = `${name.slice(0, 12)} ${'●'.repeat(n)}${'○'.repeat(Math.max(0, view.count - n))}`;
      ctx.textAlign = i === 0 ? 'left' : 'right';
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText(label, (i === 0 ? 10 : W - 10) + 1, 11);
      ctx.fillStyle = TEAM[side];
      ctx.fillText(label, i === 0 ? 10 : W - 10, 10);
      // lock badge
      if (view.phase === 'playing' && !anim) {
        const lk = view.locked[side] || (side === mySeat() && lockSent);
        ctx.font = `bold ${Math.round(s * 0.8)}px monospace`;
        ctx.fillStyle = lk ? '#39ff14' : 'rgba(200,230,255,0.6)';
        ctx.fillText(lk ? 'LOCKED ✓' : 'planning…', i === 0 ? 10 : W - 10, 12 + s);
        ctx.font = `bold ${s}px monospace`;
      }
    });
    // round + timer, bottom centre
    if (view.phase === 'playing' || anim) {
      const rd = anim ? anim.rec.round : view.round;
      let txt = `ROUND ${rd}`;
      if (!anim && view.phase === 'playing') {
        const left = Math.max(0, view.deadline - clock.now());
        const total = view.roundMs || 20000;
        const frac = Math.min(1, left / total);
        txt += `  ·  ${Math.ceil(left / 1000)}s`;
        if (view.nextH < view.H) txt += '  ·  ICE SHRINKS AFTER THIS ROUND';
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(0, W - 6, W, 6);
        ctx.fillStyle = frac < 0.25 ? '#ff5a5a' : frac < 0.5 ? '#ffe14d' : '#39ff14';
        ctx.fillRect(0, W - 6, W * frac, 6);
        const sec = Math.ceil(left / 1000);
        if (left > 0 && sec <= 5 && sec !== lastTickSec && clock.now() >= view.planFrom) {
          lastTickSec = sec;
          if (mySeat() && !view.locked[mySeat()] && !lockSent) sfx.play('tick');
        }
      }
      ctx.font = `bold ${Math.round(s * 0.85)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText(txt, W / 2 + 1, W - 11);
      ctx.fillStyle = '#d8f6ff';
      ctx.fillText(txt, W / 2, W - 12);
    }
    ctx.restore();
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!S || !view) return;
    // size
    const cw = stage.clientWidth;
    if (!cw) return;
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    if (cw !== W || canvas.width !== Math.round(cw * dpr)) {
      W = cw;
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(cw * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let list;
    let H = view.H;
    let crackTo = null;
    let animInfo = null;
    if (anim) {
      const t = now - anim.start;
      animInfo = animPenguins(t);
      list = animInfo.list;
      H = animInfo.Hnow;
      if (!animInfo.shrinkK) crackTo = anim.rec.nextH < anim.rec.H ? anim.rec.nextH : null;
      fireEvents(t, list);
      if (t > anim.rec.durMs) finishAnim();
    } else {
      list = view.penguins.map((p) => ({ ...p, sink: 0 }));
      if (view.phase === 'playing' && view.nextH < view.H) crackTo = view.nextH;
      // face planned arrows
      const seat = mySeat();
      for (const p of list) {
        const m = p.side === seat ? drafts.get(p.id) : null;
        if (m && m.p > 0) p.face = m.a;
      }
    }

    drawWater(now);
    fx.applyShake(ctx);
    drawIce(H, crackTo, now);
    // sinking penguins under the rest
    const seat = mySeat();
    const plan = canPlan();
    for (const p of list) if (p.sink > 0) drawPenguin(p);
    for (const p of list) {
      if (p.sink > 0) continue;
      const mine = p.side === seat;
      drawPenguin(p, { glow: plan && mine && (hoverId === p.id || (drag && drag.id === p.id)) });
    }
    if (anim) {
      // the reveal: both sides' arrows, shrinking away as everyone launches
      const rec = anim.rec;
      const t = now - anim.start;
      if (t < rec.revealMs + 250) {
        const grow = t < 350 ? t / 350 : 1;
        const alpha = t < rec.revealMs ? 1 : 1 - (t - rec.revealMs) / 250;
        for (const p of rec.before) drawArrow(p, rec.moves[p.id], TEAM[p.side], { grow, alpha });
      }
    } else if (seat && view.phase === 'playing') {
      for (const p of list) {
        if (p.side !== seat) continue;
        const m = drafts.get(p.id);
        const dragging = drag && drag.id === p.id;
        drawArrow(p, m, TEAM[seat], { alpha: plan || view.locked[seat] || lockSent ? 1 : 0.5, label: dragging && m && m.p > 0 ? `${Math.round(m.p * 100)}%` : null });
      }
      // first-round hint
      if (plan && !drafts.size && view.round === 1 && !drag) {
        ctx.save();
        ctx.font = `bold ${Math.max(12, Math.round(W / 40))}px monospace`;
        ctx.textAlign = 'center';
        ctx.globalAlpha = 0.55 + 0.45 * Math.sin(now / 400);
        ctx.fillStyle = '#0b3550';
        ctx.fillText('DRAG FROM A PENGUIN TO AIM IT', W / 2, W / 2);
        ctx.restore();
      }
    }
    fx.draw(ctx);
    ctx.restore();
    drawHud(list, now);
    fx.drawOverlay(ctx, W, W);
    patchControls(false);
  }

  // ---- DOM ----
  function seatBox(color) {
    const box = document.createElement('div');
    const occ = view.players[color];
    const lk = view.phase === 'playing' && !anim && view.locked[color];
    box.className = `ko-seat${lk ? ' locked' : ''}`;
    const chip = document.createElement('span');
    chip.className = 'ko-chip';
    chip.style.setProperty('--c', TEAM[color]);
    const name = document.createElement('span');
    name.textContent = `${color.toUpperCase()}: ${nicknameFor(occ) || '(empty)'}${occ && occ === api.getClientId() ? ' (you)' : ''}`;
    name.style.color = TEAM[color];
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
    if (lk) {
      const tag = document.createElement('span');
      tag.className = 'ko-tag';
      tag.style.color = '#39ff14';
      tag.textContent = 'LOCKED';
      box.appendChild(tag);
    }
    return box;
  }

  function renderStatus() {
    if (!view) { status.textContent = 'Loading...'; return; }
    const seat = mySeat();
    const over = view.phase === 'game_over' && !anim;
    status.className = 'ko-status';
    status.style.color = '';
    if (view.phase === 'waiting') {
      status.textContent = 'Waiting for both seats to be filled.';
    } else if (over) {
      status.textContent = view.winner === 'draw' ? "IT'S A DRAW. Everyone's in the water." : `${view.winner.toUpperCase()} WINS`;
      status.style.color = '#ffb000';
    } else if (anim) {
      status.textContent = `ROUND ${anim.rec.round}. SLIDE`;
      status.style.color = '#8fe3ff';
    } else if (seat && !view.penguins.some((p) => p.side === seat)) {
      status.textContent = 'Your penguins are all in the water…';
    } else if (seat && (view.locked[seat] || lockSent)) {
      const opp = seat === 'red' ? 'blue' : 'red';
      status.textContent = view.locked[opp] ? 'Both locked in. Here we go.' : `LOCKED IN. Waiting for ${nicknameFor(view.players[opp])}…`;
      status.style.color = '#9fdc98';
    } else if (seat) {
      status.textContent = clock.now() < view.planFrom - 150 ? 'Get ready…' : '▶ YOUR MOVE. Aim your penguins, then LOCK IN';
      status.classList.add('mine');
    } else {
      const r = view.locked.red ? 'RED ✓' : 'RED …';
      const b = view.locked.blue ? 'BLUE ✓' : 'BLUE …';
      status.textContent = `ROUND ${view.round}. Players are planning (${r} / ${b})`;
    }
  }

  function renderDom() {
    if (destroyed) return;
    const seat = mySeat();
    const over = !!(view && view.phase === 'game_over' && !anim);
    results.update(over ? duelResults({
      winner: view.winner, colors: COLORS, players: view.players, me: seat, nameFor: nicknameFor,
      subtitle: `${view.endReason === 'rounds' ? `Round limit (${view.maxRounds}). Most penguins left · ` : ''}`
        + COLORS.map((c) => `${c.toUpperCase()} ${view.stats[c].ko} KO`).join(' · '),
      onRematch: () => api.sendAction({ kind: 'resetGame' }),
    }) : null);
    renderStatus();
    if (!view) return;
    err.textContent = flashError ? REJECT_MESSAGES[flashError] || 'Move rejected' : '';

    seats.innerHTML = '';
    seats.append(seatBox('red'), seatBox('blue'));
    if (seat) {
      const leave = document.createElement('button');
      leave.textContent = 'LEAVE SEAT';
      leave.addEventListener('click', () => api.sendAction({ kind: 'leaveSeat' }));
      seats.appendChild(leave);
    }

    options.innerHTML = '';
    if (view.phase !== 'playing') {
      const lab = document.createElement('label');
      lab.textContent = 'Penguins per side: ';
      for (const n of [4, 5]) {
        const b = document.createElement('button');
        b.textContent = view.count === n ? `${n} ✓` : String(n);
        b.disabled = view.count === n;
        b.addEventListener('click', () => api.sendAction({ kind: 'setCount', count: n }));
        lab.appendChild(b);
      }
      options.appendChild(lab);
      if (view.phase === 'game_over' && seat && over) {
        const again = document.createElement('button');
        again.textContent = 'REMATCH (SWAP SIDES)';
        again.addEventListener('click', () => api.sendAction({ kind: 'resetGame' }));
        options.appendChild(again);
      }
    } else {
      options.textContent = `${view.count} penguins each · ${Math.round((view.roundMs || 20000) / 1000)}s rounds · ice shrinks every ${S ? S.SHRINK_EVERY : 2} rounds`;
    }
    patchControls(true);
  }

  // ---- boot ----
  loadScript('games/knockout/sim.js', 'KnockoutSim')
    .then((Sim) => {
      if (destroyed) return;
      S = Sim;
      marks = iceMarks(S.H0);
      raf = requestAnimationFrame(frame);
      renderDom();
    })
    .catch(() => {
      stage.innerHTML = '<div class="ko-fail">Could not load the game engine.</div>';
    });

  renderDom();

  function applyState(data, fromSnapshot) {
    const prev = view;
    view = data;
    clock.sync(data.serverNow);
    const seat = mySeat();
    const roundKey = `${data.gameId}:${data.round}`;
    if (fromSnapshot || !prev || prev.gameId !== data.gameId) {
      anim = null;
      lastSeqSeen = data.lastRound ? data.lastRound.seq : 0;
      drafts.clear();
      lockSent = false;
      draftRound = roundKey;
      if (prev && prev.phase !== 'playing' && data.phase === 'playing') {
        sfx.play('go');
        fx.bigLabel('GO', '#39ff14');
      }
    } else if (data.lastRound && data.lastRound.seq > lastSeqSeen) {
      lastSeqSeen = data.lastRound.seq;
      startAnim(data.lastRound);
    }
    if (draftRound !== roundKey) {
      draftRound = roundKey;
      drafts.clear();
      lockSent = false;
      lastTickSec = -1;
    }
    if (seat && data.locked[seat]) lockSent = false; // the server's flag takes over
    if (prev && !prev.winner && data.winner) {
      const delay = anim ? anim.rec.durMs : 0;
      setTimeout(() => {
        if (destroyed) return;
        sfx.play(!seat || data.winner === 'draw' ? 'point' : data.winner === seat ? 'win' : 'lose');
        fx.bigLabel(data.winner === 'draw' ? 'DRAW' : 'K.O.!', data.winner === 'draw' ? '#ffe14d' : TEAM[data.winner]);
      }, delay);
    }
    if (prev && prev.locked && seat && !anim) {
      const opp = seat === 'red' ? 'blue' : 'red';
      if (!prev.locked[opp] && data.locked[opp] && data.round === prev.round) sfx.play('blip');
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
        lockSent = false;
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
