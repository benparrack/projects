// Mini Golf client. Top-down 2D canvas course + the shared putt physics (sim.js). On your turn,
// press anywhere on the course and drag BACK (slingshot style): the dotted guide shows where the
// ball will go and how hard, the meter shows power; let go to putt (drag back to the middle to
// cancel). Your own putt starts rolling instantly from a local run of the same sim; the server's
// authoritative result (bit-identical) takes over when it arrives. Everyone else replays the
// server's frames. Moving obstacles are pure functions of the server clock, so all viewers see
// the windmills and sliders in the same place.

import { sfx } from '../sfx.js';
import { preferredLevel, levelSelect, levelLabel } from '../botLevel.js';
import { createResults, duelResults } from '../resultsPanel.js';
import { makeServerClock } from '../serverClock.js';
import { createFx } from '../canvasFx.js';
import { loadScript } from '../loadScript.js';
import { injectStyle, reduced } from '../dom.js';

const FRAME_MS = 1000 / 60;
const HOLD_FRAMES = 22; // the ball settles / drops this long before the putt animation ends
const INTERLUDE_MS = 2300; // hole summary card between holes
const COLORS = ['red', 'blue'];
const BALL_FILL = { red: ['#ffb3ba', '#ff3b4e', '#8a0f1c'], blue: ['#b9d7ff', '#3b82ff', '#0f2f80'] };
const TEXT_COLOR = { red: '#ff5a6a', blue: '#5aa0ff' };
const DRAG_FULL = 150; // world units of drag for full power

const REJECT_MESSAGES = {
  not_your_turn: "It's not your turn.",
  busy: 'Wait for the ball to stop.',
  not_playing: 'The game is not running.',
  invalid: 'Invalid putt.',
};

const CSS = `
.mg-root { display: flex; flex-direction: column; align-items: center; gap: 8px; font-family: monospace; color: #b8ffb0; width: 100%; }
.mg-status { font-size: 15px; font-weight: bold; letter-spacing: 1px; text-align: center; min-height: 20px; }
.mg-status.mine { color: #39ff14; text-shadow: 0 0 8px #39ff14; }
.mg-err { color: #ff5a5a; font-size: 12px; min-height: 14px; }
.mg-seats { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; align-items: center; }
.mg-seat { display: flex; align-items: center; gap: 6px; padding: 5px 8px; border: 1px solid #1d5c1d; border-radius: 6px; background: #071107; font-size: 13px; }
.mg-seat.turn { border-color: #39ff14; box-shadow: 0 0 10px -2px #39ff14; }
.mg-seat button, .mg-row button { font: inherit; font-size: 12px; }
.mg-dot { width: 12px; height: 12px; border-radius: 50%; display: inline-block; flex: none; }
.mg-dot.red { background: radial-gradient(circle at 35% 30%, #ffd0d4, #ff3b4e 55%, #8a0f1c); }
.mg-dot.blue { background: radial-gradient(circle at 35% 30%, #d6e8ff, #3b82ff 55%, #0f2f80); }
.mg-stage { position: relative; width: min(100%, 440px, calc(72vh * 9 / 14)); aspect-ratio: 9 / 14; border: 1px solid #1d5c1d; border-radius: 10px; overflow: hidden;
  background: #020805; touch-action: none; user-select: none; -webkit-user-select: none; }
.mg-stage canvas { display: block; width: 100%; height: 100%; }
.mg-stage.can-putt { cursor: crosshair; } .mg-stage.dragging { cursor: grabbing; }
.mg-hud { position: absolute; left: 0; right: 0; top: 0; display: flex; justify-content: space-between; align-items: flex-start; padding: 7px 9px; pointer-events: none; font-size: 12px; text-shadow: 0 1px 2px #000, 0 0 4px #000; }
.mg-hole { font-weight: bold; color: #e9ffe4; letter-spacing: 1px; }
.mg-hole small { display: block; font-weight: normal; color: #9fdc98; letter-spacing: 0; }
.mg-par { text-align: right; color: #ffe14d; font-weight: bold; }
.mg-par small { display: block; color: #9fdc98; font-weight: normal; }
.mg-strokes { position: absolute; left: 0; right: 0; bottom: 6px; display: flex; justify-content: space-between; padding: 0 9px; pointer-events: none; font-size: 12px; text-shadow: 0 1px 2px #000, 0 0 4px #000; }
.mg-sc { display: flex; align-items: center; gap: 4px; font-weight: bold; }
.mg-pip { width: 7px; height: 7px; border-radius: 50%; border: 1px solid currentColor; opacity: .35; }
.mg-pip.on { background: currentColor; opacity: 1; }
.mg-hint { position: absolute; left: 0; right: 0; bottom: 26px; text-align: center; font-size: 12px; color: #c9ffc0; pointer-events: none; text-shadow: 0 1px 2px #000, 0 0 4px #000; animation: mg-hint 1.6s ease-in-out infinite alternate; }
@keyframes mg-hint { from { opacity: .45; } to { opacity: 1; } }
.mg-power { position: absolute; right: 10px; top: 50%; width: 12px; height: 42%; transform: translateY(-50%); border: 1px solid #39ff14; border-radius: 6px; background: rgba(0,0,0,.5); overflow: hidden; pointer-events: none; opacity: 0; transition: opacity .15s; }
.mg-power.on { opacity: 1; }
.mg-power > div { position: absolute; left: 0; right: 0; bottom: 0; background: linear-gradient(0deg, #39ff14, #ffe14d 60%, #ff4d4d); }
.mg-callout { position: absolute; left: 50%; top: 40%; transform: translate(-50%, -50%); font-size: 30px; font-weight: bold; letter-spacing: 3px; white-space: nowrap; pointer-events: none;
  text-shadow: 0 0 14px currentColor, 0 2px 3px #000; animation: mg-call 1.6s cubic-bezier(.2,1.4,.4,1) forwards; }
.mg-callout.small { font-size: 18px; top: 48%; }
@keyframes mg-call { 0% { opacity: 0; transform: translate(-50%, -50%) scale(.4); } 15% { opacity: 1; transform: translate(-50%, -50%) scale(1.08); }
  25% { transform: translate(-50%, -50%) scale(1); } 80% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -70%) scale(1); } }
.mg-card { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); min-width: 62%; padding: 14px 16px; border: 1px solid #39ff14; border-radius: 10px;
  background: rgba(2, 12, 5, .92); box-shadow: 0 0 24px -4px #39ff14; text-align: center; pointer-events: none; animation: mg-card .35s cubic-bezier(.2,1.4,.4,1); }
.mg-card h3 { margin: 0 0 8px; font-size: 16px; letter-spacing: 2px; color: #e9ffe4; }
.mg-card .ln { display: flex; justify-content: space-between; gap: 14px; font-size: 14px; margin: 4px 0; font-weight: bold; }
.mg-card .tag { font-size: 11px; opacity: .85; font-weight: normal; }
.mg-card .nx { margin-top: 8px; font-size: 11px; color: #9fdc98; }
@keyframes mg-card { from { opacity: 0; transform: translate(-50%, -50%) scale(.7); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
.mg-table { border-collapse: collapse; font-size: 12px; margin: 0 auto; }
.mg-table th, .mg-table td { border: 1px solid #1d5c1d; padding: 2px 5px; text-align: center; min-width: 18px; }
.mg-table th { color: #9fdc98; font-weight: normal; }
.mg-table td.nm { text-align: left; max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: bold; }
.mg-table .cur { background: rgba(57,255,20,.12); }
.mg-table .tot { font-weight: bold; color: #e9ffe4; }
.mg-table .u { color: #ffe14d; } .mg-table .o { color: #ff8a8a; } .mg-table .e { color: #d8ffd0; }
.mg-table .one { color: #ffb000; text-shadow: 0 0 6px #ffb000; }
.mg-scroll { max-width: 100%; overflow-x: auto; }
.mg-row { display: flex; gap: 8px; align-items: center; justify-content: center; flex-wrap: wrap; font-size: 12px; }
.mg-help { font-size: 11px; opacity: .7; text-align: center; max-width: 520px; }
.mg-fail { padding: 30px; text-align: center; color: #ff8080; }
`;

const deep = (o) => JSON.parse(JSON.stringify(o));

// ---- static course art (cached per hole + pixel size) ------------------------------------------
function shapePath(g, s) {
  g.beginPath();
  if (s.rect) g.rect(s.rect[0], s.rect[1], s.rect[2], s.rect[3]);
  else if (s.circle) g.arc(s.circle[0], s.circle[1], s.circle[2], 0, Math.PI * 2);
}

function hash(i) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function drawCourse(S, hi, pw, ph) {
  const c = document.createElement('canvas');
  c.width = pw;
  c.height = ph;
  const g = c.getContext('2d');
  const k = pw / S.W;
  g.scale(k, k);
  const h = S.HOLES[hi];
  // backdrop: dark terminal grid
  g.fillStyle = '#020805';
  g.fillRect(0, 0, S.W, S.H);
  g.strokeStyle = 'rgba(57,255,20,0.05)';
  g.lineWidth = 1;
  for (let x = 0; x <= S.W; x += 20) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, S.H); g.stroke(); }
  for (let y = 0; y <= S.H; y += 20) { g.beginPath(); g.moveTo(0, y); g.lineTo(S.W, y); g.stroke(); }

  const fair = () => {
    g.beginPath();
    h.fairway.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
  };
  // drop shadow under the fairway
  g.save();
  g.shadowColor = 'rgba(57,255,20,0.25)';
  g.shadowBlur = 18;
  fair();
  g.fillStyle = '#145c26';
  g.fill();
  g.restore();
  // felt: gradient + mowing stripes + speckle
  g.save();
  fair();
  g.clip();
  const grad = g.createLinearGradient(0, 0, S.W, S.H);
  grad.addColorStop(0, '#1d7a34');
  grad.addColorStop(1, '#13602a');
  g.fillStyle = grad;
  g.fillRect(0, 0, S.W, S.H);
  g.fillStyle = 'rgba(255,255,255,0.035)';
  for (let y = -S.W; y < S.H; y += 36) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(S.W, y + S.W * 0.35);
    g.lineTo(S.W, y + S.W * 0.35 + 18);
    g.lineTo(0, y + 18);
    g.closePath();
    g.fill();
  }
  for (let i = 0; i < 900; i++) {
    g.fillStyle = hash(i) > 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(180,255,170,0.05)';
    g.fillRect(hash(i + 1000) * S.W, hash(i + 2000) * S.H, 1.2, 1.2);
  }
  // slopes: slightly lighter/darker tint (animated chevrons are drawn live)
  for (const s of h.slopes || []) {
    shapePath(g, s);
    g.fillStyle = 'rgba(255,240,120,0.06)';
    g.fill();
  }
  for (const f of h.funnels || []) {
    const rg = g.createRadialGradient(f[0], f[1], 0, f[0], f[1], f[2]);
    rg.addColorStop(0, 'rgba(0,0,0,0.28)');
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg;
    g.beginPath();
    g.arc(f[0], f[1], f[2], 0, Math.PI * 2);
    g.fill();
  }
  // sand
  for (const s of h.sand || []) {
    g.save();
    shapePath(g, s);
    g.shadowColor = 'rgba(0,0,0,0.45)';
    g.shadowBlur = 6;
    g.fillStyle = '#d9c27a';
    g.fill();
    g.restore();
    g.save();
    shapePath(g, s);
    g.clip();
    const bx = s.rect ? s.rect[0] : s.circle[0] - s.circle[2];
    const by = s.rect ? s.rect[1] : s.circle[1] - s.circle[2];
    const bw = s.rect ? s.rect[2] : s.circle[2] * 2;
    const bh = s.rect ? s.rect[3] : s.circle[2] * 2;
    for (let i = 0; i < (bw * bh) / 14; i++) {
      g.fillStyle = hash(i * 3 + bx) > 0.5 ? 'rgba(120,90,30,0.25)' : 'rgba(255,250,220,0.35)';
      g.fillRect(bx + hash(i * 7 + by) * bw, by + hash(i * 11 + bw) * bh, 1.1, 1.1);
    }
    // raked lines
    g.strokeStyle = 'rgba(150,120,50,0.25)';
    g.lineWidth = 0.8;
    for (let y = by + 4; y < by + bh; y += 5) {
      g.beginPath();
      for (let x = bx; x <= bx + bw; x += 6) g.lineTo(x, y + Math.sin(x * 0.2) * 1.2);
      g.stroke();
    }
    g.restore();
  }
  g.restore();
  // tee mat
  g.save();
  g.translate(h.tee[0], h.tee[1]);
  g.fillStyle = 'rgba(0,0,0,0.28)';
  g.fillRect(-15, -9, 30, 18);
  g.strokeStyle = 'rgba(220,255,210,0.5)';
  g.lineWidth = 1;
  g.strokeRect(-15, -9, 30, 18);
  g.fillStyle = 'rgba(255,255,255,0.75)';
  g.beginPath(); g.arc(-10, 0, 1.6, 0, Math.PI * 2); g.arc(10, 0, 1.6, 0, Math.PI * 2); g.fill();
  g.restore();
  // cup
  const [cx, cy] = h.cup;
  g.save();
  g.fillStyle = 'rgba(255,255,255,0.12)';
  g.beginPath(); g.arc(cx, cy, S.CUP_R + 3, 0, Math.PI * 2); g.fill();
  const cg = g.createRadialGradient(cx - 2, cy - 2, 1, cx, cy, S.CUP_R);
  cg.addColorStop(0, '#000');
  cg.addColorStop(0.75, '#050805');
  cg.addColorStop(1, '#2a3a2a');
  g.fillStyle = cg;
  g.beginPath(); g.arc(cx, cy, S.CUP_R, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.lineWidth = 1;
  g.stroke();
  g.restore();
  // rails, banks, posts, bumper bases
  const st = S.statics(hi);
  for (const pass of [0, 1]) {
    for (const w of st) {
      if (w.kind === 'post' || w.kind === 'bumper') continue;
      const bank = w.kind === 'bank';
      g.save();
      g.lineCap = 'round';
      if (pass === 0) {
        g.shadowColor = bank ? '#ffb000' : '#39ff14';
        g.shadowBlur = 10;
        g.strokeStyle = bank ? '#a86a00' : '#1f8f2e';
        g.lineWidth = w.r * 2 + 2;
      } else {
        g.strokeStyle = bank ? '#ffcf4d' : '#8cff7a';
        g.lineWidth = 1.4;
      }
      g.beginPath();
      g.moveTo(w.ax, w.ay);
      g.lineTo(w.bx, w.by);
      g.stroke();
      g.restore();
    }
  }
  for (const w of st) {
    if (w.kind !== 'post') continue;
    g.save();
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath(); g.arc(w.ax + 2, w.ay + 3, w.r, 0, Math.PI * 2); g.fill();
    const pg = g.createRadialGradient(w.ax - w.r * 0.4, w.ay - w.r * 0.4, 1, w.ax, w.ay, w.r);
    pg.addColorStop(0, '#f4fff2');
    pg.addColorStop(0.5, '#9fb59c');
    pg.addColorStop(1, '#3d4d3c');
    g.fillStyle = pg;
    g.beginPath(); g.arc(w.ax, w.ay, w.r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#39ff14';
    g.lineWidth = 0.8;
    g.stroke();
    g.restore();
  }
  return c;
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

  const root = document.createElement('div');
  root.className = 'mg-root';
  container.appendChild(root);
  const results = createResults(container);

  const status = document.createElement('div');
  status.className = 'mg-status';
  const err = document.createElement('div');
  err.className = 'mg-err';
  const seats = document.createElement('div');
  seats.className = 'mg-seats';
  const stage = document.createElement('div');
  stage.className = 'mg-stage';
  const canvas = document.createElement('canvas');
  const hud = document.createElement('div');
  hud.className = 'mg-hud';
  const strokesBar = document.createElement('div');
  strokesBar.className = 'mg-strokes';
  const hint = document.createElement('div');
  hint.className = 'mg-hint';
  const power = document.createElement('div');
  power.className = 'mg-power';
  const powerFill = document.createElement('div');
  power.appendChild(powerFill);
  stage.append(canvas, hud, strokesBar, hint, power);
  const card = document.createElement('div');
  card.className = 'mg-scroll';
  const options = document.createElement('div');
  options.className = 'mg-row';
  const help = document.createElement('div');
  help.className = 'mg-help';
  help.textContent = 'On your turn press anywhere on the course and drag BACK, like a slingshot. The dotted line shows direction and power. Let go to putt; drag back to the start to cancel. Turns alternate stroke by stroke. Water = +1 stroke and a re-try from where you hit. 6 strokes max (then you score 7). Lowest total after 9 holes wins.';
  root.append(status, err, seats, stage, card, options, help);
  let holeCard = null;

  // ---- helpers ----
  function nicknameFor(id) {
    if (!id) return null;
    if (id === 'BOT') return '(bot)';
    const e = roster.find((r) => r.clientId === id);
    return e ? e.nickname : 'someone';
  }
  function seatName(c) {
    const id = view && view.players[c];
    if (!id) return c.toUpperCase();
    if (id === 'BOT') return `Bot (${levelLabel((view.botLevels || {})[c])})`;
    return nicknameFor(id);
  }
  function mySeat() {
    if (!view) return null;
    const me = api.getClientId();
    return view.players.red === me ? 'red' : view.players.blue === me ? 'blue' : null;
  }
  const fromView = (v) => deep({ hole: v.hole, balls: v.balls, strokes: v.strokes, scores: v.scores });

  // ---- animation state ----
  let disp = null; // { hole, balls, strokes, scores } as currently drawn
  const queue = []; // shot records waiting to play
  let anim = null; // { rec, start, fired:Set, local }
  let localPending = null;
  let lastSeqSeen = 0;
  let interlude = null; // { until, rec }
  let drag = null; // { id, x0, y0, angle, power }
  let courseArt = null; // { hole, pw, ph, canvas }
  const trail = [];
  const flashes = new Map(); // collider id -> time of last hit
  let sinkAnim = null; // { color, start }

  function callout(text, color, small) {
    if (reduced() && small) return;
    const el = document.createElement('div');
    el.className = `mg-callout${small ? ' small' : ''}`;
    el.style.color = color || '#39ff14';
    el.textContent = text;
    stage.appendChild(el);
    setTimeout(() => el.remove(), 1700);
  }

  function startAnim(rec, start, local) {
    if (rec.push) start += Math.max(0, rec.t0 - clock.now()); // knocks are announced just before contact
    anim = { rec, start, fired: new Set(), local };
    disp = deep(rec.pre);
    trail.length = 0;
    sinkAnim = null;
  }

  function finishAnim() {
    const rec = anim.rec;
    anim = null;
    disp = deep(rec.post);
    trail.length = 0;
    const seat = mySeat();
    if (rec.holeEnd && !rec.gameOver) {
      interlude = { until: performance.now() + INTERLUDE_MS, rec };
      showHoleCard(rec);
    } else {
      afterShot();
    }
    if (rec.nextTurn && seat && rec.nextTurn === seat && !rec.holeEnd && rec.by !== seat) setTimeout(() => sfx.play('turn'), 150);
    renderDom();
  }

  function afterShot() {
    if (queue.length) {
      startAnim(queue.shift(), performance.now(), false);
    } else if (view) {
      disp = fromView(view);
    }
  }

  function endInterlude() {
    interlude = null;
    if (holeCard) { holeCard.remove(); holeCard = null; }
    afterShot();
    const seat = mySeat();
    if (seat && view && view.phase === 'playing' && view.turn === seat && !anim) setTimeout(() => sfx.play('turn'), 100);
    renderDom();
  }

  function showHoleCard(rec) {
    if (holeCard) holeCard.remove();
    const h = S.HOLES[rec.hole];
    holeCard = document.createElement('div');
    holeCard.className = 'mg-card';
    const t = document.createElement('h3');
    t.textContent = `HOLE ${rec.hole + 1} COMPLETE`;
    holeCard.appendChild(t);
    for (const c of COLORS) {
      const sc = rec.post.scores[c][rec.hole];
      const tot = rec.post.scores[c].reduce((a, v) => a + (v || 0), 0);
      const par = rec.post.scores[c].reduce((a, v, i) => a + (v == null ? 0 : S.HOLES[i].par), 0);
      const ln = document.createElement('div');
      ln.className = 'ln';
      ln.style.color = TEXT_COLOR[c];
      const l = document.createElement('span');
      l.textContent = `${seatName(c)}  ${sc}`;
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = ` ${sc === S.PICKUP_SCORE && sc - h.par > 2 ? 'picked up' : S.scoreName(sc, h.par).replace('!', '').toLowerCase()}`;
      l.appendChild(tag);
      const r = document.createElement('span');
      const d = tot - par;
      r.textContent = `TOTAL ${tot} (${d === 0 ? 'E' : d > 0 ? `+${d}` : d})`;
      ln.append(l, r);
      holeCard.appendChild(ln);
    }
    const nx = document.createElement('div');
    nx.className = 'nx';
    const nh = S.HOLES[rec.hole + 1];
    nx.textContent = nh ? `NEXT: HOLE ${rec.hole + 2}. ${nh.name.toUpperCase()} · PAR ${nh.par}` : '';
    holeCard.appendChild(nx);
    stage.appendChild(holeCard);
    sfx.play('point');
  }

  function onNewShot(rec) {
    if (rec.seq <= lastSeqSeen) return;
    lastSeqSeen = rec.seq;
    if (anim && anim.local && localPending && rec.by === mySeat() && !rec.push) {
      anim.rec = rec;
      anim.local = false;
      localPending = null;
      return;
    }
    localPending = null;
    if (anim || interlude) queue.push(rec);
    else {
      startAnim(rec, performance.now(), false);
      if (!rec.push) sfx.play('move', { vol: 0.8 });
    }
  }

  // ---- input ----
  function canPutt() {
    const seat = mySeat();
    return !!(S && view && disp && seat && view.phase === 'playing' && view.turn === seat && !anim && !queue.length
      && !interlude && !localPending && disp.hole === view.hole && !view.balls[seat].done
      && clock.now() >= view.busyUntil - 150);
  }

  function worldScale() {
    const r = stage.getBoundingClientRect();
    return r.width / S.W;
  }

  stage.addEventListener('pointerdown', (e) => {
    if (!canPutt() || drag) return;
    e.preventDefault();
    try { stage.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, angle: 0, power: 0 };
    stage.classList.add('dragging');
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const k = worldScale() || 1;
    const dx = (drag.x0 - e.clientX) / k;
    const dy = (drag.y0 - e.clientY) / k;
    const len = Math.sqrt(dx * dx + dy * dy);
    drag.power = Math.min(1, len / DRAG_FULL);
    if (len > 2) drag.angle = Math.atan2(dy, dx);
    power.classList.add('on');
    powerFill.style.height = `${Math.round(drag.power * 100)}%`;
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    stage.classList.remove('dragging');
    power.classList.remove('on');
    if (e.type === 'pointercancel' || d.power < 0.05) return; // tap / dragged back = cancel
    if (!canPutt()) return;
    const input = S.normInput({ angle: d.angle, power: d.power });
    const seat = mySeat();
    const b = view.balls[seat];
    const t0 = Math.round(clock.now());
    const res = S.simulate(view.hole, { x: b.x, y: b.y }, input, t0 % 60000);
    if (!res) return;
    localPending = { input, start: performance.now() };
    const rec = { seq: -1, by: seat, hole: view.hole, phaseMs: t0 % 60000, input, frames: res.frames, events: res.events,
      outcome: res.outcome, end: res.end, pre: fromView(view), post: null };
    startAnim(rec, performance.now(), true);
    sfx.play('move', { vol: 0.9 });
    api.sendAction({ kind: 'putt', angle: input.angle, power: input.power, t0 });
    renderDom();
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  // ---- drawing ----
  function ensureCanvas() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    const pw = Math.max(1, Math.round(w * dpr));
    const ph = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    return { pw, ph };
  }

  function fireEvent(ev, rec, side) {
    const frames = side ? side.frames : rec.frames;
    const color = side ? side.color : rec.by;
    const fr = frames[Math.min(ev.f, frames.length - 1)];
    const [x, y] = fr;
    const vol = Math.min(1, (ev.v || 200) / 400);
    switch (ev.type) {
      case 'wall':
      case 'post':
        sfx.play('tick', { vol: 0.4 + vol * 0.6 });
        if (ev.id) flashes.set(ev.id, performance.now());
        fx.burst(x, y, '#9dff8a', { count: 5, speed: 60, life: 0.25, size: 1.4 });
        break;
      case 'bank':
        sfx.play('blip');
        flashes.set(ev.id, performance.now());
        fx.burst(x, y, '#ffcf4d', { count: 8, speed: 80, life: 0.3, size: 1.5 });
        break;
      case 'bumper':
        sfx.play('pop');
        flashes.set(ev.id, performance.now());
        fx.ring(x, y, '#ff4dff', { radius: 26, life: 0.35, width: 2.5 });
        fx.shake(2);
        break;
      case 'mover':
        sfx.play('swap');
        fx.burst(x, y, '#ffa040', { count: 8, speed: 90, life: 0.3, size: 1.5 });
        if (ev.knock) callout('KNOCKED', TEXT_COLOR[color], true);
        break;
      case 'sand':
        sfx.play('slide', { vol: 0.5 });
        fx.burst(x, y, '#e8d395', { count: 14, speed: 50, life: 0.5, size: 1.6 });
        break;
      case 'lip':
        sfx.play('blip', { vol: 0.6 });
        break;
      case 'water':
        sfx.play('whoosh');
        fx.burst(x, y, '#7fc4ff', { count: 26, speed: 90, life: 0.6, size: 1.8 });
        fx.ring(x, y, '#9fd4ff', { radius: 18, life: 0.6, width: 2 });
        callout(ev.knock ? 'SPLASH' : 'SPLASH +1', '#5aa0ff', true);
        break;
      case 'sink':
        sinkAnim = { color, start: performance.now() };
        sfx.play('pop');
        setTimeout(() => sfx.play('chime'), 90);
        fx.burst(x, y, '#ffe14d', { count: 30, speed: 110, life: 0.7, size: 1.8 });
        fx.burst(x, y, BALL_FILL[color][1], { count: 16, speed: 80, life: 0.6, size: 1.6 });
        fx.ring(x, y, '#ffffff', { radius: 22, life: 0.5, width: 2 });
        break;
      default:
    }
  }

  function onAnimEnd(rec) {
    // callouts about the stroke's outcome
    if (!rec.post) return;
    const h = S.HOLES[rec.hole];
    const sc = rec.post.scores[rec.by][rec.hole];
    if (rec.outcome === 'sink' && sc != null) {
      const name = S.scoreName(sc, h.par);
      const great = sc < h.par || sc === 1;
      callout(name, great ? '#ffb000' : TEXT_COLOR[rec.by], !great && sc > h.par);
      if (great) sfx.play('kill');
    } else if (rec.pickedUp) {
      callout(`PICKED UP · ${S.PICKUP_SCORE}`, '#ff8a8a', true);
      sfx.play('error');
    }
  }

  const animLen = (rec) => Math.max(rec.frames.length, rec.side ? rec.side.frames.length : 0);

  function timeNowT() {
    // obstacle time: replay time during a putt, the shared server clock otherwise
    if (anim) {
      const el = performance.now() - anim.start;
      return ((((anim.rec.phaseMs + el) % 60000) + 60000) % 60000) / 1000;
    }
    return (clock.now() % 60000) / 1000;
  }

  function drawBall(g, x, y, color, scale = 1, glow = false) {
    const r = S.BALL_R * scale;
    g.save();
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath(); g.ellipse(x + 1.8, y + 2.4, r, r * 0.85, 0, 0, Math.PI * 2); g.fill();
    if (glow) { g.shadowColor = BALL_FILL[color][1]; g.shadowBlur = 10; }
    const bg = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    bg.addColorStop(0, BALL_FILL[color][0]);
    bg.addColorStop(0.55, BALL_FILL[color][1]);
    bg.addColorStop(1, BALL_FILL[color][2]);
    g.fillStyle = bg;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.lineWidth = 0.7;
    g.stroke();
    g.restore();
  }

  function draw(now) {
    const { pw, ph } = ensureCanvas();
    const g = canvas.getContext('2d');
    const hi = disp ? disp.hole : 0;
    const h = S.HOLES[hi];
    if (!courseArt || courseArt.hole !== hi || courseArt.pw !== pw || courseArt.ph !== ph) {
      courseArt = { hole: hi, pw, ph, canvas: drawCourse(S, hi, pw, ph) };
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, pw, ph);
    g.drawImage(courseArt.canvas, 0, 0);
    const k = pw / S.W;
    g.setTransform(k, 0, 0, k, 0, 0);
    fx.applyShake(g);
    const t = now / 1000;
    const still = reduced();

    // water (animated)
    for (const s of h.water || []) {
      g.save();
      shapePath(g, s);
      g.shadowColor = 'rgba(60,160,255,0.6)';
      g.shadowBlur = 8;
      const wg = s.rect ? g.createLinearGradient(s.rect[0], s.rect[1], s.rect[0], s.rect[1] + s.rect[3])
        : g.createRadialGradient(s.circle[0], s.circle[1], 1, s.circle[0], s.circle[1], s.circle[2]);
      wg.addColorStop(0, '#2c7be5');
      wg.addColorStop(1, '#0d3f99');
      g.fillStyle = wg;
      g.fill();
      g.shadowBlur = 0;
      g.clip();
      g.strokeStyle = 'rgba(200,235,255,0.35)';
      g.lineWidth = 1;
      const bx = s.rect ? s.rect[0] : s.circle[0] - s.circle[2];
      const by = s.rect ? s.rect[1] : s.circle[1] - s.circle[2];
      const bw = s.rect ? s.rect[2] : s.circle[2] * 2;
      const bh = s.rect ? s.rect[3] : s.circle[2] * 2;
      for (let y = by + 6; y < by + bh; y += 9) {
        g.beginPath();
        for (let x = bx; x <= bx + bw; x += 4) {
          const yy = y + Math.sin(x * 0.12 + (still ? 0 : t * 2.2) + y * 0.3) * 1.6;
          if (x === bx) g.moveTo(x, yy); else g.lineTo(x, yy);
        }
        g.stroke();
      }
      g.restore();
      g.save();
      shapePath(g, s);
      g.strokeStyle = 'rgba(160,215,255,0.8)';
      g.lineWidth = 1.2;
      g.stroke();
      g.restore();
    }
    // slope chevrons drifting downhill
    for (const s of h.slopes || []) {
      const [rx, ry, rw, rh] = s.rect;
      const mag = Math.sqrt(s.ax * s.ax + s.ay * s.ay) || 1;
      const ux = s.ax / mag;
      const uy = s.ay / mag;
      g.save();
      g.beginPath();
      g.rect(rx, ry, rw, rh);
      g.clip();
      g.strokeStyle = 'rgba(255,240,140,0.22)';
      g.lineWidth = 1.6;
      g.lineCap = 'round';
      const off = still ? 0 : (t * 18) % 28;
      for (let a = -28; a < 28 + Math.max(rw, rh); a += 28) {
        for (let b = 14; b < Math.max(rw, rh) + 28; b += 34) {
          // a = along slope, b = across
          let px; let py;
          if (Math.abs(uy) > Math.abs(ux)) { px = rx + b - 14; py = uy > 0 ? ry + a + off : ry + rh - a - off; }
          else { py = ry + b - 14; px = ux > 0 ? rx + a + off : rx + rw - a - off; }
          g.beginPath();
          g.moveTo(px - uy * 6 - ux * 5, py + ux * 6 - uy * 5);
          g.lineTo(px, py);
          g.lineTo(px + uy * 6 - ux * 5, py - ux * 6 - uy * 5);
          g.stroke();
        }
      }
      g.restore();
    }
    for (const f of h.funnels || []) {
      g.save();
      g.strokeStyle = 'rgba(255,240,140,0.18)';
      g.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        const ph2 = still ? i / 3 : ((t * 0.5 + i / 3) % 1);
        g.globalAlpha = ph2;
        g.beginPath();
        g.arc(f[0], f[1], f[2] * ph2 + S.CUP_R, 0, Math.PI * 2);
        g.stroke();
      }
      g.restore();
    }
    // flash glow on recently-hit colliders
    const nowMs = performance.now();
    for (const w of S.statics(hi)) {
      const ht = flashes.get(w.id);
      const kf = ht ? 1 - (nowMs - ht) / 300 : 0;
      if (w.kind === 'bumper') {
        g.save();
        const pulse = Math.max(0, kf);
        g.shadowColor = '#ff4dff';
        g.shadowBlur = 8 + pulse * 18;
        const bg = g.createRadialGradient(w.ax - 3, w.ay - 3, 1, w.ax, w.ay, w.r);
        bg.addColorStop(0, pulse > 0 ? '#ffffff' : '#ffc4ff');
        bg.addColorStop(0.5, '#e02ee0');
        bg.addColorStop(1, '#5a0a5a');
        g.fillStyle = bg;
        g.beginPath(); g.arc(w.ax, w.ay, w.r * (1 + pulse * 0.12), 0, Math.PI * 2); g.fill();
        g.shadowBlur = 0;
        g.strokeStyle = '#ffd0ff';
        g.lineWidth = 1.2;
        g.beginPath(); g.arc(w.ax, w.ay, w.r * 0.62, 0, Math.PI * 2); g.stroke();
        g.restore();
      } else if (kf > 0) {
        g.save();
        g.globalAlpha = kf;
        g.lineCap = 'round';
        g.strokeStyle = w.kind === 'bank' ? '#fff3b0' : '#e6ffe0';
        g.shadowColor = w.kind === 'bank' ? '#ffb000' : '#39ff14';
        g.shadowBlur = 14;
        g.lineWidth = w.r * 2;
        g.beginPath();
        if (w.len2) { g.moveTo(w.ax, w.ay); g.lineTo(w.bx, w.by); g.stroke(); } else { g.arc(w.ax, w.ay, w.r, 0, Math.PI * 2); g.stroke(); }
        g.restore();
      } else if (ht) flashes.delete(w.id);
    }

    // moving obstacles
    const T = timeNowT();
    for (const m of S.moverShapes(hi, T)) {
      g.save();
      g.lineCap = 'round';
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.lineWidth = m.r * 2;
      g.beginPath(); g.moveTo(m.ax + 2, m.ay + 3); g.lineTo(m.bx + 2, m.by + 3); g.stroke();
      if (m.spin) {
        g.shadowColor = '#ff8a00';
        g.shadowBlur = 8;
        g.strokeStyle = '#b85a00';
        g.lineWidth = m.r * 2;
        g.beginPath(); g.moveTo(m.ax, m.ay); g.lineTo(m.bx, m.by); g.stroke();
        g.shadowBlur = 0;
        g.strokeStyle = '#ffb347';
        g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(m.ax, m.ay); g.lineTo(m.bx, m.by); g.stroke();
        // sail lattice
        g.strokeStyle = 'rgba(255,220,170,0.5)';
        g.lineWidth = 0.8;
        const L = Math.sqrt(m.len2);
        const nx = -m.dy / L;
        const ny = m.dx / L;
        for (let s = 0.35; s <= 0.95; s += 0.15) {
          const px = m.ax + m.dx * s;
          const py = m.ay + m.dy * s;
          g.beginPath(); g.moveTo(px - nx * 3, py - ny * 3); g.lineTo(px + nx * 3, py + ny * 3); g.stroke();
        }
      } else {
        // hazard-striped slider bar
        g.strokeStyle = '#ffd400';
        g.shadowColor = '#ffd400';
        g.shadowBlur = 8;
        g.lineWidth = m.r * 2;
        g.beginPath(); g.moveTo(m.ax, m.ay); g.lineTo(m.bx, m.by); g.stroke();
        g.shadowBlur = 0;
        g.save();
        g.beginPath();
        const L = Math.sqrt(m.len2);
        const ux = m.dx / L;
        const uy = m.dy / L;
        g.moveTo(m.ax - uy * m.r, m.ay + ux * m.r);
        g.lineTo(m.bx - uy * m.r, m.by + ux * m.r);
        g.lineTo(m.bx + uy * m.r, m.by - ux * m.r);
        g.lineTo(m.ax + uy * m.r, m.ay - ux * m.r);
        g.closePath();
        g.clip();
        g.strokeStyle = '#111';
        g.lineWidth = 4;
        for (let s = -m.r * 2; s < L + m.r * 2; s += 10) {
          const px = m.ax + ux * s;
          const py = m.ay + uy * s;
          g.beginPath(); g.moveTo(px - 8, py + 8); g.lineTo(px + 8, py - 8); g.stroke();
        }
        g.restore();
      }
      g.restore();
    }
    for (const m of h.movers || []) {
      if (m.kind !== 'spinner') continue;
      g.save();
      const hg = g.createRadialGradient(m.cx - 2, m.cy - 2, 1, m.cx, m.cy, 9);
      hg.addColorStop(0, '#ffe2b8');
      hg.addColorStop(1, '#7a3a00');
      g.fillStyle = hg;
      g.beginPath(); g.arc(m.cx, m.cy, 7, 0, Math.PI * 2); g.fill();
      g.restore();
    }

    // flag (lowered when a ball is rolling close)
    const [cx, cy] = h.cup;
    let near = false;
    const ballPos = {};
    const seat = mySeat();
    if (disp) {
      for (const c of COLORS) {
        const b = disp.balls[c];
        if (!b.done) ballPos[c] = [b.x, b.y];
      }
    }
    let rolling = null;
    if (anim) {
      const r = anim.rec;
      const fl = Math.max(0, (performance.now() - anim.start) / FRAME_MS);
      const i0 = Math.min(r.frames.length - 1, Math.floor(fl));
      const i1 = Math.min(r.frames.length - 1, i0 + 1);
      const a = Math.min(1, fl - i0);
      const p = [r.frames[i0][0] + (r.frames[i1][0] - r.frames[i0][0]) * a, r.frames[i0][1] + (r.frames[i1][1] - r.frames[i0][1]) * a];
      const done = fl >= r.frames.length - 1;
      rolling = { color: r.by, p, done, rec: r };
      delete ballPos[r.by];
      if (!(done && r.outcome !== 'rest')) ballPos[r.by] = p;
      if (r.side) {
        // the other ball, knocked by a mover during this record
        const sf = r.side.frames;
        const j0 = Math.min(sf.length - 1, Math.floor(fl));
        const j1 = Math.min(sf.length - 1, j0 + 1);
        const b = Math.min(1, fl - j0);
        delete ballPos[r.side.color];
        if (!(fl >= sf.length - 1 && r.side.outcome !== 'rest')) {
          ballPos[r.side.color] = [sf[j0][0] + (sf[j1][0] - sf[j0][0]) * b, sf[j0][1] + (sf[j1][1] - sf[j0][1]) * b];
        }
      }
      const last = trail[trail.length - 1];
      if (!done && (!last || last[0] !== p[0] || last[1] !== p[1])) {
        trail.push(p);
        if (trail.length > 18) trail.shift();
      }
    }
    for (const c in ballPos) {
      const [bx, by] = ballPos[c];
      if ((bx - cx) * (bx - cx) + (by - cy) * (by - cy) < 60 * 60) near = true;
    }
    g.save();
    const flagLift = near ? 0.25 : 1;
    g.strokeStyle = '#e8e8e8';
    g.lineWidth = 1.4;
    const topY = cy - 34 * flagLift;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx, topY); g.stroke();
    if (flagLift > 0.5) {
      const wave = still ? 0 : Math.sin(t * 4) * 2;
      g.fillStyle = '#ff2a3a';
      g.shadowColor = '#ff2a3a';
      g.shadowBlur = 6;
      g.beginPath();
      g.moveTo(cx, topY);
      g.quadraticCurveTo(cx + 9, topY + 2 + wave, cx + 17, topY + 5 + wave * 0.5);
      g.lineTo(cx, topY + 11);
      g.closePath();
      g.fill();
      g.shadowBlur = 0;
      g.fillStyle = '#fff';
      g.font = 'bold 6px monospace';
      g.textAlign = 'center';
      g.fillText(String(hi + 1), cx + 6, topY + 7.5);
    }
    g.restore();

    // trail
    if (rolling && trail.length > 1 && !still) {
      g.save();
      g.lineCap = 'round';
      for (let i = 1; i < trail.length; i++) {
        g.globalAlpha = (i / trail.length) * 0.45;
        g.strokeStyle = BALL_FILL[rolling.color][1];
        g.lineWidth = S.BALL_R * 1.4 * (i / trail.length);
        g.beginPath(); g.moveTo(trail[i - 1][0], trail[i - 1][1]); g.lineTo(trail[i][0], trail[i][1]); g.stroke();
      }
      g.restore();
    }

    // turn ring under the waiting ball
    const showTurn = view && view.phase === 'playing' && !anim && !interlude && !queue.length && disp && disp.hole === view.hole ? view.turn : null;
    if (showTurn && ballPos[showTurn]) {
      const [bx, by] = ballPos[showTurn];
      const pulse = still ? 0.5 : (Math.sin(t * 5) + 1) / 2;
      g.save();
      g.strokeStyle = TEXT_COLOR[showTurn];
      g.globalAlpha = 0.45 + pulse * 0.4;
      g.lineWidth = 1.2;
      g.setLineDash([3, 3]);
      g.lineDashOffset = still ? 0 : -t * 8;
      g.beginPath(); g.arc(bx, by, S.BALL_R + 5 + pulse * 2, 0, Math.PI * 2); g.stroke();
      g.restore();
    }

    // balls: the inactive one first so the one on turn sits on top
    const order = COLORS.slice().sort((a) => (a === showTurn || (rolling && a === rolling.color) ? 1 : -1));
    for (const c of order) {
      if (!ballPos[c]) continue;
      drawBall(g, ballPos[c][0], ballPos[c][1], c, 1, c === showTurn);
    }
    if (sinkAnim) {
      const k2 = (performance.now() - sinkAnim.start) / 350;
      if (k2 < 1) drawBall(g, cx, cy, sinkAnim.color, 1 - k2 * 0.8);
    }

    // aim guide
    if (drag && drag.power >= 0.05 && seat && ballPos[seat]) {
      const [bx, by] = ballPos[seat];
      const ux = Math.cos(drag.angle);
      const uy = Math.sin(drag.angle);
      const len = 26 + drag.power * 190;
      const col = drag.power < 0.5 ? `rgb(${Math.round(57 + drag.power * 2 * 198)},255,20)` : `rgb(255,${Math.round(255 - (drag.power - 0.5) * 2 * 175)},40)`;
      g.save();
      g.fillStyle = col;
      g.shadowColor = col;
      g.shadowBlur = 6;
      for (let s = 12; s < len; s += 8) {
        g.globalAlpha = 1 - (s / len) * 0.75;
        g.beginPath(); g.arc(bx + ux * s, by + uy * s, 1.7, 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = 0.9;
      const ex = bx + ux * len;
      const ey = by + uy * len;
      g.beginPath();
      g.moveTo(ex + ux * 6, ey + uy * 6);
      g.lineTo(ex - uy * 4, ey + ux * 4);
      g.lineTo(ex + uy * 4, ey - ux * 4);
      g.closePath();
      g.fill();
      // power ring
      g.shadowBlur = 0;
      g.globalAlpha = 0.9;
      g.strokeStyle = col;
      g.lineWidth = 2;
      g.beginPath(); g.arc(bx, by, S.BALL_R + 6, -Math.PI / 2, -Math.PI / 2 + drag.power * Math.PI * 2); g.stroke();
      // rubber band behind the ball
      g.globalAlpha = 0.35;
      g.strokeStyle = '#ffffff';
      g.lineWidth = 1;
      g.setLineDash([2, 3]);
      g.beginPath(); g.moveTo(bx, by); g.lineTo(bx - ux * drag.power * 40, by - uy * drag.power * 40); g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
      g.fillStyle = '#fff';
      g.font = 'bold 9px monospace';
      g.textAlign = 'center';
      g.fillText(`${Math.round(drag.power * 100)}%`, bx - ux * 18, by - uy * 18 + 3);
      g.restore();
    }

    fx.draw(g);
    g.restore(); // shake
  }

  // ---- per-frame update ----
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!S || !disp) return;
    if (anim) {
      const rec = anim.rec;
      const fi = Math.floor((performance.now() - anim.start) / FRAME_MS);
      for (let i = 0; i < rec.events.length; i++) {
        const ev = rec.events[i];
        if (ev.f <= fi && !anim.fired.has(i)) {
          anim.fired.add(i);
          fireEvent(ev, rec);
        }
      }
      const sev = rec.side ? rec.side.events : [];
      for (let i = 0; i < sev.length; i++) {
        if (sev[i].f <= fi && !anim.fired.has(`s${i}`)) {
          anim.fired.add(`s${i}`);
          fireEvent(sev[i], rec, rec.side);
        }
      }
      if (fi >= animLen(rec) + HOLD_FRAMES && !anim.local) {
        onAnimEnd(rec);
        finishAnim();
      }
    } else if (interlude && performance.now() >= interlude.until) {
      endInterlude();
    }
    draw(now);
    if (!anim && stage.classList.contains('can-putt') !== canPutt()) renderDom();
  }

  // ---- DOM ----
  function seatBox(color) {
    const box = document.createElement('div');
    box.className = `mg-seat${view.phase === 'playing' && view.turn === color ? ' turn' : ''}`;
    const dot = document.createElement('span');
    dot.className = `mg-dot ${color}`;
    const name = document.createElement('span');
    const occ = view.players[color];
    name.textContent = `${color.toUpperCase()}: ${nicknameFor(occ) || '(empty)'}${occ && occ === api.getClientId() ? ' (you)' : ''}`;
    name.style.color = TEXT_COLOR[color];
    box.append(dot, name);
    const seat = mySeat();
    if (!occ && view.solo && view.phase !== 'waiting') {
      name.textContent = `${color.toUpperCase()}: (solo round)`;
    } else if (!occ) {
      if (seat && view.phase !== 'playing') {
        const solo = document.createElement('button');
        solo.textContent = 'PLAY SOLO';
        solo.title = 'Nine holes on your own: chase your best (lowest) score';
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

  function scoreCell(v, par) {
    const td = document.createElement('td');
    if (v == null) return td;
    td.textContent = String(v);
    td.className = v === 1 ? 'one' : v < par ? 'u' : v > par ? 'o' : 'e';
    return td;
  }

  function renderCard() {
    card.innerHTML = '';
    if (!S || !disp) return;
    const tbl = document.createElement('table');
    tbl.className = 'mg-table';
    const head = document.createElement('tr');
    const blank = document.createElement('th');
    blank.textContent = 'HOLE';
    head.appendChild(blank);
    S.HOLES.forEach((_, i) => {
      const th = document.createElement('th');
      th.textContent = String(i + 1);
      if (i === disp.hole && view.phase === 'playing') th.className = 'cur';
      head.appendChild(th);
    });
    for (const lab of ['TOT', '±']) {
      const th = document.createElement('th');
      th.textContent = lab;
      head.appendChild(th);
    }
    tbl.appendChild(head);
    const parRow = document.createElement('tr');
    const pl = document.createElement('td');
    pl.className = 'nm';
    pl.textContent = 'PAR';
    parRow.appendChild(pl);
    S.HOLES.forEach((h, i) => {
      const td = document.createElement('td');
      td.textContent = String(h.par);
      if (i === disp.hole && view.phase === 'playing') td.className = 'cur';
      parRow.appendChild(td);
    });
    const ptd = document.createElement('td');
    ptd.className = 'tot';
    ptd.textContent = String(S.TOTAL_PAR);
    parRow.append(ptd, document.createElement('td'));
    tbl.appendChild(parRow);
    for (const c of activeColors()) {
      const tr = document.createElement('tr');
      const nm = document.createElement('td');
      nm.className = 'nm';
      nm.style.color = TEXT_COLOR[c];
      nm.textContent = seatName(c);
      nm.title = nm.textContent;
      tr.appendChild(nm);
      let tot = 0;
      let par = 0;
      S.HOLES.forEach((h, i) => {
        const v = disp.scores[c][i];
        const td = scoreCell(v, h.par);
        if (v != null) { tot += v; par += h.par; }
        if (i === disp.hole && view.phase === 'playing') td.classList.add('cur');
        tr.appendChild(td);
      });
      const tt = document.createElement('td');
      tt.className = 'tot';
      tt.textContent = String(tot);
      const dd = document.createElement('td');
      const d = tot - par;
      dd.textContent = par ? (d === 0 ? 'E' : d > 0 ? `+${d}` : String(d)) : '–';
      dd.className = d < 0 ? 'u' : d > 0 ? 'o' : 'e';
      tr.append(tt, dd);
      tbl.appendChild(tr);
    }
    card.appendChild(tbl);
  }

  // A solo round only shows the one golfer.
  const activeColors = () => COLORS.filter((c) => !view.solo || view.players[c]);
  const vsPar = (tot) => { const d = tot - S.TOTAL_PAR; return d === 0 ? 'E' : d > 0 ? `+${d}` : String(d); };

  function renderDom() {
    if (destroyed) return;
    const seat = mySeat();
    const over = view && view.phase === 'game_over' && !anim && !queue.length && !interlude;
    const soloTot = over && view.solo ? view.scores[view.winner].reduce((a, v) => a + (v || 0), 0) : 0;
    results.update(over && view.solo ? {
      title: `${soloTot} STROKES`,
      subtitle: `SOLO · ${vsPar(soloTot)} vs par ${S.TOTAL_PAR}`,
      outcome: 'win',
      rows: [{ name: seatName(view.winner), value: `${soloTot} (${vsPar(soloTot)})`, win: true, you: view.winner === seat }],
      rematch: seat ? { label: 'PLAY AGAIN', onClick: () => api.sendAction({ kind: 'resetGame' }) } : null,
    } : over ? duelResults({
      winner: view.winner, colors: COLORS, players: view.players, me: seat, nameFor: (id) => (id === 'BOT' ? 'Bot' : nicknameFor(id)),
      subtitle: COLORS.map((c) => {
        const tot = view.scores[c].reduce((a, v) => a + (v || 0), 0);
        const d = tot - S.TOTAL_PAR;
        return `${c.toUpperCase()} ${tot} (${d === 0 ? 'E' : d > 0 ? `+${d}` : d})`;
      }).join(' · '),
      onRematch: () => api.sendAction({ kind: 'resetGame' }),
    }) : null);
    if (!view || !S || !disp) {
      status.textContent = 'Loading...';
      return;
    }
    const showTurn = anim && !anim.rec.push ? anim.rec.by : view.turn;
    status.className = 'mg-status';
    status.style.color = '';
    if (view.phase === 'waiting') {
      status.textContent = seat ? 'PLAY SOLO for a best score, or wait for an opponent / play a bot.' : 'Waiting for both seats to be filled.';
    } else if (over && view.solo) {
      status.textContent = `ROUND OVER: ${soloTot} STROKES (${vsPar(soloTot)})`;
      status.style.color = '#ffb000';
    } else if (over) {
      status.textContent = view.winner === 'draw' ? "IT'S A TIE" : `${view.winner.toUpperCase()} WINS`;
      status.style.color = '#ffb000';
    } else if (interlude) {
      status.textContent = `HOLE ${interlude.rec.hole + 1} COMPLETE`;
      status.style.color = '#e9ffe4';
    } else if (seat && showTurn === seat) {
      status.textContent = anim ? '▶ ROLLING…' : `▶ YOUR PUTT. STROKE ${(disp.strokes[seat] || 0) + 1}`;
      status.classList.add('mine');
    } else {
      status.textContent = `${showTurn.toUpperCase()} PUTTING. ${seatName(showTurn)}`;
      status.style.color = TEXT_COLOR[showTurn];
    }
    err.textContent = flashError ? REJECT_MESSAGES[flashError] || 'Putt rejected' : '';

    seats.innerHTML = '';
    seats.append(seatBox('red'), seatBox('blue'));
    if (seat) {
      const leave = document.createElement('button');
      leave.textContent = 'LEAVE SEAT';
      leave.addEventListener('click', () => api.sendAction({ kind: 'leaveSeat' }));
      seats.appendChild(leave);
    }

    const h = S.HOLES[disp.hole];
    hud.innerHTML = '';
    const hl = document.createElement('div');
    hl.className = 'mg-hole';
    hl.textContent = `HOLE ${disp.hole + 1}/${S.HOLES.length}`;
    const hs = document.createElement('small');
    hs.textContent = h.name;
    hl.appendChild(hs);
    const pr = document.createElement('div');
    pr.className = 'mg-par';
    pr.textContent = `PAR ${h.par}`;
    const ps = document.createElement('small');
    ps.textContent = `max ${S.MAX_STROKES} strokes`;
    pr.appendChild(ps);
    hud.append(hl, pr);

    strokesBar.innerHTML = '';
    if (view.phase !== 'waiting') {
      for (const c of activeColors()) {
        const el = document.createElement('div');
        el.className = 'mg-sc';
        el.style.color = TEXT_COLOR[c];
        const n = disp.strokes[c] || 0;
        const b = disp.balls[c];
        const lab = document.createElement('span');
        const sc = disp.scores[c][disp.hole];
        lab.textContent = b.done ? (b.sunk ? `IN · ${sc}` : `PICKED UP · ${sc}`) : `${n} STROKE${n === 1 ? '' : 'S'}`;
        const pips = document.createElement('span');
        pips.style.display = 'flex';
        pips.style.gap = '2px';
        for (let i = 0; i < S.MAX_STROKES; i++) {
          const p = document.createElement('span');
          p.className = `mg-pip${i < n ? ' on' : ''}`;
          pips.appendChild(p);
        }
        if (c === 'red') el.append(lab, pips); else el.append(pips, lab);
        strokesBar.appendChild(el);
      }
    }

    const ct = canPutt();
    stage.classList.toggle('can-putt', ct);
    hint.textContent = ct ? 'DRAG BACK & RELEASE TO PUTT' : '';
    renderCard();

    options.innerHTML = '';
    if (view.phase === 'game_over' && seat && over) {
      const again = document.createElement('button');
      again.textContent = view.solo ? 'PLAY AGAIN' : 'REMATCH (SWAP COLOURS)';
      again.addEventListener('click', () => api.sendAction({ kind: 'resetGame' }));
      options.appendChild(again);
    }
  }

  // ---- boot ----
  loadScript('games/minigolf/sim.js', 'MiniGolfSim')
    .then((Sim) => {
      if (destroyed) return;
      S = Sim;
      if (view && !disp) disp = fromView(view);
      raf = requestAnimationFrame(frame);
      renderDom();
    })
    .catch(() => {
      stage.innerHTML = '<div class="mg-fail">Could not load the course.</div>';
    });

  renderDom();

  function resetAnim() {
    anim = null;
    queue.length = 0;
    localPending = null;
    interlude = null;
    sinkAnim = null;
    trail.length = 0;
    if (holeCard) { holeCard.remove(); holeCard = null; }
  }

  function applyState(data, fromSnapshot) {
    const prev = view;
    view = data;
    clock.sync(data.serverNow);
    if (fromSnapshot || !prev || prev.gameId !== data.gameId) {
      resetAnim();
      lastSeqSeen = data.lastShot ? data.lastShot.seq : 0;
      disp = fromView(data);
      if (prev && prev.phase !== 'playing' && data.phase === 'playing') sfx.play('go');
    } else if (data.lastShot && data.lastShot.seq > lastSeqSeen) {
      onNewShot(data.lastShot);
    } else if (!anim && !queue.length && !interlude) {
      disp = fromView(data);
    }
    if (prev && !prev.winner && data.winner && !fromSnapshot) {
      const seat = mySeat();
      const delay = anim ? Math.max(0, (animLen(anim.rec) + HOLD_FRAMES) * FRAME_MS - (performance.now() - anim.start)) + 200 : 0;
      setTimeout(() => sfx.play(!seat || data.winner === 'draw' ? 'point' : data.winner === seat ? 'win' : 'lose'), delay);
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
          localPending = null;
          trail.length = 0;
          if (!interlude) afterShot();
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
