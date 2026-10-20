// Roulette — one European wheel shared by the room. Click a chip, then click the felt to bet;
// the first chip starts a 20s countdown. The spin shows on a drawn wheel with a ball, or on the
// older number strip (VIEW toggle, remembered per browser) if the wheel misbehaves somewhere. Server plugin: ../../../server/games/roulette.js

import { sfx } from '../sfx.js';
import { makeServerClock } from '../serverClock.js';

const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const colorOf = (n) => (n === 0 ? 'g' : REDS.has(n) ? 'r' : 'b');
const money = (n) => `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const CELL = 46; // px per number on the wheel strip
const SPIN_ANIM_MS = 5600; // both views; the server's spinning phase is 6s
const VIEW_KEY = 'gt-roulette-view';
const TAU = Math.PI * 2;
const STEP = TAU / WHEEL.length;
const REJECT = {
  broke: 'Not enough in your casino balance. Claim the daily stipend or work a shift in the CASINO menu.',
  spot_max: 'That spot is at the $1,000 limit.',
  round_max: "You're at the $2,500 limit for this spin.",
  not_betting: 'No more bets: the wheel is spinning.',
  wallet_loading: 'Opening your casino balance… try again in a second.',
  nothing: 'No bets to do that with.',
};

const CSS = `
.rl-root { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 6px; }
.rl-strip { position: relative; width: min(100%, 560px); height: 58px; overflow: hidden; border: 2px solid #c9a24a; border-radius: 8px; background: #111; }
.rl-strip::after { content: ''; position: absolute; left: 50%; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: #ffd23f; box-shadow: 0 0 8px #ffd23f; }
.rl-track { position: absolute; top: 6px; left: 50%; display: flex; will-change: transform; }
.rl-n { width: ${CELL - 4}px; height: 42px; margin: 0 2px; display: flex; align-items: center; justify-content: center; border-radius: 4px; font-weight: bold; color: #fff; font-family: Georgia, serif; }
.rl-n.r { background: #c0262d; } .rl-n.b { background: #1c1c1c; border: 1px solid #333; } .rl-n.g { background: #12813a; }
.rl-hist { display: flex; gap: 4px; min-height: 26px; flex-wrap: wrap; justify-content: center; }
.rl-hist .rl-n { width: 26px; height: 24px; font-size: .75em; margin: 0; }
.rl-status { min-height: 1.5em; font-size: 1.15em; text-align: center; }
.rl-status.win { color: #ffbf00; }
.rl-timer { width: min(100%, 560px); height: 3px; background: rgba(255,255,255,.12); }
.rl-timer > div { height: 100%; background: #ffd23f; transition: width .25s linear; }
.rl-felt { display: grid; grid-template-columns: 40px repeat(12, minmax(26px, 40px)) 44px; gap: 2px; padding: 10px; border-radius: 10px; background: radial-gradient(ellipse at center, #1b7a3a, #0d4a22); border: 3px solid #5a3a12; user-select: none; max-width: 100%; }
.rl-spot { position: relative; min-height: 38px; display: flex; align-items: center; justify-content: center; border: 1px solid rgba(255,255,255,.55); color: #fff; font-family: Georgia, serif; font-weight: bold; cursor: pointer; font-size: .9em; }
.rl-spot.r { background: #b3262c; } .rl-spot.b { background: #1a1a1a; } .rl-spot.g { background: #12813a; }
.rl-spot:hover { outline: 2px solid #ffd23f; z-index: 1; }
.rl-spot.hit { outline: 3px solid #ffd23f; box-shadow: 0 0 14px #ffd23f; z-index: 2; }
.rl-spot.closed { cursor: default; }
.rl-chip { position: absolute; right: -4px; bottom: -4px; min-width: 22px; height: 22px; border-radius: 50%; font-size: .6em; display: flex; align-items: center; justify-content: center; background: #2f9e44; color: #fff; border: 2px dashed #fff; box-shadow: 0 1px 3px #000; z-index: 3; padding: 0 2px; }
.rl-chip.mine { background: #ffbf00; color: #000; border-color: #000; }
.rl-chips { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: center; }
.rl-pick { width: 40px; height: 40px; border-radius: 50%; padding: 0; font-weight: bold; border: 3px dashed #fff; color: #fff; }
.rl-pick.c1 { background: #ddd; color: #111; border-color: #888; } .rl-pick.c5 { background: #e04848; }
.rl-pick.c10 { background: #2a6fdb; } .rl-pick.c25 { background: #2f9e44; } .rl-pick.c50 { background: #f08c00; } .rl-pick.c100 { background: #222; }
.rl-pick.c250 { background: #d6336c; } .rl-pick.c500 { background: #7048e8; } .rl-pick.c1000 { background: #e8b923; color: #111; font-size: .8em; }
.rl-pick[aria-pressed="true"] { transform: translateY(-4px); box-shadow: 0 0 0 3px #ffd23f; }
.rl-players { font-size: .85em; width: min(100%, 560px); }
@media (max-width: 560px) {
  .rl-felt { grid-template-columns: 26px repeat(12, minmax(0, 1fr)) 30px; padding: 6px; gap: 1px; width: 100%; box-sizing: border-box; }
  .rl-spot { min-height: 32px; font-size: .68em; }
  .rl-chip { min-width: 16px; height: 16px; font-size: .5em; right: -3px; bottom: -3px; }
}
.rl-players li { display: flex; justify-content: space-between; }
.rl-stage { position: relative; display: flex; flex-direction: column; align-items: center; gap: 6px; width: min(100%, 560px); }
.rl-wheel { width: min(320px, 82vw); aspect-ratio: 1; filter: drop-shadow(0 10px 18px rgba(0,0,0,.7)); }
.rl-badge { position: absolute; top: calc(min(320px, 82vw) / 2); left: 50%; transform: translate(-50%, -50%) scale(0); width: 74px; height: 74px; border-radius: 50%;
  display: flex; flex-direction: column; align-items: center; justify-content: center; color: #fff; font-family: Georgia, serif; font-weight: bold; font-size: 1.9em; line-height: 1;
  border: 3px solid #ffd23f; box-shadow: 0 0 22px #ffd23f; transition: transform .35s cubic-bezier(.3,1.6,.5,1); pointer-events: none; }
.rl-badge small { font-size: .38em; letter-spacing: .1em; }
.rl-badge.show { transform: translate(-50%, -50%) scale(1); }
.rl-badge.r { background: #c0262d; } .rl-badge.b { background: #1c1c1c; } .rl-badge.g { background: #12813a; }
.rl-view { font-size: .75em; padding: 2px 8px; align-self: flex-end; }
`;

export function mount(container, api) {
  let view = null;
  let roster = [];
  let chip = 5;
  let spunFor = null; // result object already animated
  let landed = true; // the strip has stopped on the current result
  const clock = makeServerClock();
  const strip = WHEEL.concat(WHEEL, WHEEL, WHEEL, WHEEL, WHEEL); // long enough for a few laps
  let stripPos = WHEEL.length * 2 * CELL; // centre of number index i is at i*CELL + CELL/2

  const style = document.createElement('style');
  style.textContent = CSS;
  const root = document.createElement('div');
  root.className = 'rl-root';
  container.append(style, root);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const name = (id) => (roster.find((r) => r.clientId === id) || {}).nickname || 'someone';

  // The wheel: a canvas redrawn each frame while the ball is moving. Pockets are pre-drawn once.
  let viewMode = 'wheel';
  try { if (localStorage.getItem(VIEW_KEY) === 'strip') viewMode = 'strip'; } catch { /* private mode */ }
  const stage = el('div', 'rl-stage');
  const canvas = el('canvas', 'rl-wheel');
  const badge = el('div', 'rl-badge');
  const viewBtn = el('button', 'rl-view');
  viewBtn.type = 'button';
  const wheel = makeWheel(canvas);
  stage.append(viewBtn, canvas, badge);

  const stripBox = el('div', 'rl-strip');
  const track = el('div', 'rl-track');
  for (const n of strip) track.appendChild(el('div', `rl-n ${colorOf(n)}`, String(n)));
  stripBox.appendChild(track);
  const hist = el('div', 'rl-hist');
  const status = el('div', 'rl-status');
  const timer = el('div', 'rl-timer');
  const timerBar = el('div');
  timer.appendChild(timerBar);
  const felt = el('div', 'rl-felt');
  const chipsRow = el('div', 'rl-chips');
  const balance = el('div', 'casino-balance');
  const players = el('ul', 'rl-players');
  stage.append(stripBox);
  root.append(stage, hist, status, timer, felt, chipsRow, balance, players);
  function setView(mode) {
    viewMode = mode;
    try { localStorage.setItem(VIEW_KEY, mode); } catch { /* private mode */ }
    canvas.hidden = mode !== 'wheel';
    badge.hidden = mode !== 'wheel';
    stripBox.hidden = mode === 'wheel';
    viewBtn.textContent = mode === 'wheel' ? 'VIEW: WHEEL ⇄ strip' : 'VIEW: STRIP ⇄ wheel';
  }
  viewBtn.addEventListener('click', () => { sfx.play('click'); setView(viewMode === 'wheel' ? 'strip' : 'wheel'); });
  setView(viewMode);

  const place = (px, animate) => {
    track.style.transition = animate ? 'transform 5.6s cubic-bezier(.12,.6,.15,1)' : 'none';
    track.style.transform = `translateX(${-px}px)`;
  };
  place(stripPos + CELL / 2, false);

  // The felt: 0 down the left, numbers 3 rows x 12, columns at the right, dozens and evens below.
  const spots = new Map();
  function spot(key, label, cls, gridArea) {
    const s = el('div', `rl-spot ${cls || ''}`, label);
    s.style.gridArea = gridArea;
    s.addEventListener('click', () => {
      if (!view || view.phase !== 'betting') return;
      sfx.play('chips');
      api.sendAction({ kind: 'bet', spot: key, amount: chip });
    });
    spots.set(key, s);
    felt.appendChild(s);
  }
  spot('n:0', '0', 'g', '1 / 1 / 4 / 2');
  for (let n = 1; n <= 36; n++) {
    const col = Math.ceil(n / 3) + 1;
    const row = 3 - ((n - 1) % 3);
    spot(`n:${n}`, String(n), colorOf(n), `${row} / ${col} / ${row + 1} / ${col + 1}`);
  }
  ['c3', 'c2', 'c1'].forEach((k, i) => spot(k, '2:1', '', `${i + 1} / 14 / ${i + 2} / 15`));
  ['d1', 'd2', 'd3'].forEach((k, i) => spot(k, ['1st 12', '2nd 12', '3rd 12'][i], '', `4 / ${2 + i * 4} / 5 / ${6 + i * 4}`));
  [['low', '1-18'], ['even', 'EVEN'], ['red', '◆', 'r'], ['black', '◆', 'b'], ['odd', 'ODD'], ['high', '19-36']]
    .forEach(([k, label, cls], i) => spot(k, label, cls, `5 / ${2 + i * 2} / 6 / ${4 + i * 2}`));

  function button(text, kind) {
    const b = el('button', null, text);
    b.type = 'button';
    b.addEventListener('click', () => { sfx.play('click'); api.sendAction({ kind }); });
    return b;
  }

  function spinTo(n) {
    // Rewind to the same number on lap 2 (no animation), then land on n at least two laps on.
    // Searching from wherever the last spin stopped ran off the end of the strip and looped forever.
    const cur = (Math.round(stripPos / CELL) % WHEEL.length) + WHEEL.length;
    place(cur * CELL + CELL / 2, false);
    void track.offsetWidth;
    let target = cur + WHEEL.length * 2;
    while (strip[target] !== n) target++;
    stripPos = target * CELL;
    landed = false;
    place(stripPos + CELL / 2, true);
    badge.className = 'rl-badge';
    wheel.spin(n, () => { if (viewMode === 'wheel') onLanded(); });
    sfx.play('dice');
  }

  function onLanded() {
    if (landed) return;
    landed = true;
    const r = view && view.result;
    if (r) {
      badge.className = `rl-badge ${colorOf(r.n)} show`;
      badge.replaceChildren(document.createTextNode(String(r.n)), el('small', null, r.n === 0 ? 'GREEN' : REDS.has(r.n) ? 'RED' : 'BLACK'));
    }
    if (r && r.payouts[api.getClientId()]) sfx.play(r.payouts[api.getClientId()].won ? 'win' : 'lose');
    render();
  }

  function render() {
    if (!view) { status.textContent = 'Loading…'; return; }
    const me = api.getClientId();
    const betting = view.phase === 'betting';
    const r = view.result;
    const showResult = r && (view.phase === 'result' || landed);

    hist.replaceChildren(...view.history.map((n) => el('div', `rl-n ${colorOf(n)}`, String(n))));
    const mine = view.bets[me] || [];
    const myStake = mine.reduce((a, b) => a + b.amount, 0);
    let bal = view.balances[me] || 0;
    if (r && !showResult && r.payouts[me]) bal -= r.payouts[me].won; // don't spoil the spin
    balance.textContent = `BALANCE ${money(bal)}${myStake ? ` · ${money(myStake)} on the felt` : ''}`;

    if (betting) {
      const secs = view.deadline ? Math.max(0, Math.ceil((view.deadline - clock.now()) / 1000)) : null;
      status.className = 'rl-status';
      status.textContent = secs == null ? 'Place your bets. The first chip starts the clock.' : `Place your bets: ${secs}s`;
    } else if (!showResult) {
      status.className = 'rl-status';
      status.textContent = 'No more bets…';
    } else {
      const p = r.payouts[me];
      const label = `${r.n} ${r.n === 0 ? 'GREEN' : REDS.has(r.n) ? 'RED' : 'BLACK'}`;
      status.className = `rl-status${p && p.won ? ' win' : ''}`;
      status.textContent = p ? (p.won ? `${label}: you win ${money(p.won)}!` : `${label}: no luck this time.`) : label;
    }
    const left = view.deadline && betting ? Math.max(0, (view.deadline - clock.now()) / 20000) : 0;
    timerBar.style.width = `${Math.min(1, left) * 100}%`;

    const totals = new Map();
    for (const [id, bets] of Object.entries(view.bets)) for (const b of bets) {
      const t = totals.get(b.spot) || { all: 0, mine: 0 };
      t.all += b.amount;
      if (id === me) t.mine += b.amount;
      totals.set(b.spot, t);
    }
    for (const [key, s] of spots) {
      s.querySelector('.rl-chip')?.remove();
      s.classList.toggle('closed', !betting);
      s.classList.toggle('hit', !!(showResult && key === `n:${r.n}`));
      const t = totals.get(key);
      if (t) s.appendChild(el('span', `rl-chip${t.mine ? ' mine' : ''}`, t.all >= 1000 ? `${Math.round(t.all / 100) / 10}k` : String(t.all)));
    }

    chipsRow.replaceChildren();
    for (const c of view.chips) {
      const b = el('button', `rl-pick c${c}`, c >= 1000 ? `${c / 1000}k` : String(c));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(c === chip));
      b.addEventListener('click', () => { chip = c; sfx.play('click'); render(); });
      chipsRow.appendChild(b);
    }
    if (betting) {
      if (mine.length) chipsRow.append(button('CLEAR', 'clear'), view.ready[me] ? el('span', 'muted', 'ready') : button('DONE', 'ready'));
      else if (view.rebet.includes(me)) chipsRow.append(button('REBET', 'rebet'));
    }

    players.replaceChildren();
    const ids = new Set([...roster.map((x) => x.clientId), ...Object.keys(view.bets)]);
    for (const id of ids) {
      const stake = (view.bets[id] || []).reduce((a, b) => a + b.amount, 0);
      const p = showResult && r.payouts[id];
      const right = p ? (p.won ? `won ${money(p.won)}` : `lost ${money(p.staked)}`) : stake ? `${money(stake)} down${view.ready[id] ? ' ✓' : ''}` : '';
      players.appendChild(el('li', id === me ? '' : 'muted')).append(el('span', null, `${name(id)}${id === me ? ' (you)' : ''}`), el('span', null, right));
    }
  }

  function apply(data) {
    clock.sync(data.now);
    view = data;
    if (view.result && view.result !== spunFor && view.phase === 'spinning') {
      spunFor = view.result;
      spinTo(view.result.n);
    } else if (view.phase !== 'spinning') landed = true;
    if (view.phase === 'betting') badge.className = 'rl-badge';
    render();
  }

  track.addEventListener('transitionend', () => { if (viewMode === 'strip') onLanded(); });
  const ticker = setInterval(() => { if (view && view.phase === 'betting' && view.deadline) render(); }, 500);

  render();

  return {
    applySnapshot(s) { apply(s); },
    applyEvent(data) {
      if (!data) return;
      if (data.kind === 'state') {
        // A fresh state object each time: keep the same result identity so the spin isn't replayed.
        if (spunFor && data.result && data.result.n === spunFor.n && view && view.result) data.result = spunFor;
        apply(data);
      } else if (data.kind === 'moveRejected') { sfx.play('error'); status.className = 'rl-status'; status.textContent = REJECT[data.reason] || data.reason; }
    },
    applyRoster(r) { roster = r; render(); },
    unmount() { clearInterval(ticker); wheel.stop(); container.innerHTML = ''; },
  };
}

// A European wheel on a canvas: wooden rim, ball track with deflectors, 37 pockets, a turret.
// The wheel turns slowly clockwise all the time; spin(n) sends the ball the other way, lets it
// lose speed, drop off the track, bounce, and settle in n's pocket, then calls done().
function makeWheel(canvas) {
  const S = 640; // drawing units; the canvas is scaled to its CSS size
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  const C = S / 2;
  const R = { rim: 316, track: 280, trackIn: 236, pocketOut: 232, pocketIn: 168, numIn: 196, cone: 160, turret: 46 };
  const ballR = 11;
  const pockets = document.createElement('canvas');
  pockets.width = S;
  pockets.height = S;
  drawPockets(pockets.getContext('2d'));
  const base = document.createElement('canvas');
  base.width = S;
  base.height = S;
  drawStatic(base.getContext('2d'));

  let wheelAngle = 0;
  let last = performance.now();
  let ball = null; // { n, t0, phi0, delta, settled, done, bounces }
  let raf = 0;
  let hot = 0; // ms of glow left on the winning pocket

  function drawPockets(g) {
    g.translate(C, C);
    for (let i = 0; i < WHEEL.length; i++) {
      const n = WHEEL[i];
      const a0 = i * STEP - STEP / 2 - Math.PI / 2;
      g.beginPath();
      g.arc(0, 0, R.pocketOut, a0, a0 + STEP);
      g.arc(0, 0, R.pocketIn, a0 + STEP, a0, true);
      g.closePath();
      g.fillStyle = n === 0 ? '#0f7a35' : REDS.has(n) ? '#b8141c' : '#141414';
      g.fill();
      g.strokeStyle = '#d4af37';
      g.lineWidth = 2;
      g.stroke();
      g.save();
      g.rotate(i * STEP);
      g.fillStyle = '#fff';
      g.font = 'bold 22px Georgia, serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(n), 0, -(R.pocketOut - 18));
      g.restore();
    }
    // the numbers ring sits outside the pocket floors; separate them with a gold line
    g.beginPath(); g.arc(0, 0, R.numIn, 0, TAU); g.strokeStyle = '#d4af37'; g.lineWidth = 3; g.stroke();
    // cone and turret
    const cone = g.createRadialGradient(0, 0, 10, 0, 0, R.cone);
    cone.addColorStop(0, '#c99a4b'); cone.addColorStop(.55, '#7a4a1c'); cone.addColorStop(1, '#3d230b');
    g.beginPath(); g.arc(0, 0, R.cone, 0, TAU); g.fillStyle = cone; g.fill();
    g.strokeStyle = '#d4af37'; g.lineWidth = 4; g.stroke();
    for (let k = 0; k < 4; k++) {
      g.save(); g.rotate((k * TAU) / 4);
      g.fillStyle = '#e8c25a'; g.fillRect(-5, -R.turret - 70, 10, 70);
      g.beginPath(); g.arc(0, -R.turret - 74, 11, 0, TAU); g.fill();
      g.restore();
    }
    const tur = g.createRadialGradient(-12, -12, 4, 0, 0, R.turret);
    tur.addColorStop(0, '#fff6c8'); tur.addColorStop(.5, '#e0b94a'); tur.addColorStop(1, '#8a6414');
    g.beginPath(); g.arc(0, 0, R.turret, 0, TAU); g.fillStyle = tur; g.fill();
  }

  function drawStatic(ctx) {
    // wooden rim and the ball track (they don't turn)
    const wood = ctx.createRadialGradient(C, C, R.track, C, C, R.rim);
    wood.addColorStop(0, '#2b1607'); wood.addColorStop(.4, '#6b3a14'); wood.addColorStop(.8, '#8f5422'); wood.addColorStop(1, '#3a1d08');
    ctx.beginPath(); ctx.arc(C, C, R.rim, 0, TAU); ctx.fillStyle = wood; ctx.fill();
    const track = ctx.createRadialGradient(C, C, R.trackIn, C, C, R.track);
    track.addColorStop(0, '#1d1d1d'); track.addColorStop(.6, '#3b3b3b'); track.addColorStop(1, '#151515');
    ctx.beginPath(); ctx.arc(C, C, R.track, 0, TAU); ctx.arc(C, C, R.trackIn, 0, TAU, true); ctx.fillStyle = track; ctx.fill();
    ctx.strokeStyle = '#d4af37'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(C, C, R.track, 0, TAU); ctx.stroke();
    // deflector diamonds on the track
    for (let k = 0; k < 8; k++) {
      const a = (k * TAU) / 8 + TAU / 16;
      ctx.save(); ctx.translate(C + Math.cos(a) * 258, C + Math.sin(a) * 258); ctx.rotate(a);
      ctx.beginPath(); ctx.moveTo(-9, 0); ctx.lineTo(0, -5); ctx.lineTo(9, 0); ctx.lineTo(0, 5); ctx.closePath();
      ctx.fillStyle = '#e8c25a'; ctx.fill(); ctx.restore();
    }
  }

  // Where the ball sits now: angle in the wheel's frame (phi) and radius.
  function ballAt(now) {
    if (!ball) return null;
    const u = Math.min(1, (now - ball.t0) / SPIN_ANIM_MS);
    const phi = ball.phi0 + ball.delta * (1 - (1 - u) ** 3);
    const target = ball.idx * STEP;
    let r = R.track - ballR - 6;
    let wobble = 0;
    if (u > 0.62) {
      // off the track: drop toward the pockets, bouncing a little less each time
      const v = Math.min(1, (u - 0.62) / 0.38);
      const drop = Math.min(1, v * 1.6);
      r = r - drop * (r - (R.pocketIn + R.numIn) / 2) + Math.abs(Math.sin(v * Math.PI * 4)) * (1 - v) * 26;
      wobble = Math.sin(v * Math.PI * 5) * (1 - v) * STEP * 1.4;
    }
    return { phi: u >= 1 ? target : phi + wobble, r, u };
  }

  function frame(now) {
    const dt = Math.min(64, now - last);
    last = now;
    wheelAngle = (wheelAngle + dt * 0.00045) % TAU;
    const b = ballAt(now);
    if (b && b.u >= 1 && !ball.done) { ball.done = true; hot = 3500; ball.cb(); }
    raf = requestAnimationFrame(frame);
    if (canvas.hidden) return;
    ctx.clearRect(0, 0, S, S);
    ctx.drawImage(base, 0, 0);
    ctx.save();
    ctx.translate(C, C);
    ctx.rotate(wheelAngle);
    ctx.drawImage(pockets, -C, -C);
    if (b && b.u >= 1 && hot > 0) {
      hot -= dt;
      const a0 = ball.idx * STEP - STEP / 2 - Math.PI / 2;
      ctx.beginPath(); ctx.arc(0, 0, R.pocketOut, a0, a0 + STEP); ctx.arc(0, 0, R.pocketIn, a0 + STEP, a0, true); ctx.closePath();
      ctx.fillStyle = `rgba(255,210,63,${0.25 + 0.25 * Math.sin(now / 90)})`; ctx.fill();
    }
    ctx.restore();
    if (b) {
      // the ball turns with the wheel once it's in a pocket, so draw it in world space at wheel + phi
      const a = wheelAngle + b.phi - Math.PI / 2;
      const x = C + Math.cos(a) * b.r;
      const y = C + Math.sin(a) * b.r;
      const g = ctx.createRadialGradient(x - 4, y - 4, 1, x, y, ballR);
      g.addColorStop(0, '#fff'); g.addColorStop(.6, '#e6e6e6'); g.addColorStop(1, '#8a8a8a');
      ctx.beginPath(); ctx.arc(x, y, ballR, 0, TAU); ctx.fillStyle = g; ctx.fill();
      if (b.u > 0.62 && b.u < 1 && Math.floor(b.u * 40) !== ball.lastTick) { ball.lastTick = Math.floor(b.u * 40); if (ball.lastTick % 3 === 0) sfx.play('tick'); }
    }
  }
  raf = requestAnimationFrame(frame);

  return {
    spin(n, cb) {
      const now = performance.now();
      const cur = ballAt(now);
      const idx = WHEEL.indexOf(n);
      const phi0 = cur ? cur.phi : Math.random() * TAU;
      // The ball runs against the wheel: phi falls by about 9 turns, ending exactly on the pocket.
      let delta = idx * STEP - phi0;
      delta = ((delta % TAU) + TAU) % TAU - TAU * 9;
      ball = { n, idx, t0: now, phi0, delta, done: false, cb, lastTick: -1 };
      hot = 0;
    },
    stop() { cancelAnimationFrame(raf); },
  };
}
