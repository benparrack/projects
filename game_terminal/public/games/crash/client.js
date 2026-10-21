// Crash: one rocket for the room. Bet during the countdown, then watch the multiplier climb and cash
// out before it blows up. The server owns the clock and the crash point; this draws the curve from
// the round's start time (m = e^(k t)), so every screen shows the same multiplier.
// Server plugin: ../../../server/games/crash.js

import { sfx } from '../sfx.js';
import { makeServerClock } from '../serverClock.js';
import { el, btn, money, fmtX, store, REJECT, shell, tabs, field, numberInput, amountField, autoFields, autoRunner, statsCard, feedCard, balanceLine, celebrate, fairButton, floats, hotkey, shake } from '../originals.js';

const CSS = `
.cr-hist { display: flex; gap: 5px; padding: 8px 8px 0; overflow: hidden; mask-image: linear-gradient(90deg, #000 85%, transparent); }
.cr-hist button { flex: none; border: 0; border-radius: 999px; padding: 4px 9px; font: 800 11.5px system-ui, sans-serif; background: var(--input); animation: cr-in .35s ease-out; }
.cr-hist button.lo { color: var(--loss); } .cr-hist button.mid { color: var(--win); } .cr-hist button.hi { color: #1a1000; background: linear-gradient(135deg, #ffd76a, #ffb21e); }
.cr-hist button:hover { filter: brightness(1.25); }
.cr-canvas { flex: 1; width: 100%; min-height: 0; display: block; }
.cr-big { position: absolute; left: 0; right: 0; top: 34%; text-align: center; pointer-events: none; font: 900 54px system-ui, sans-serif; color: #fff; font-variant-numeric: tabular-nums; text-shadow: 0 4px 24px rgba(0,0,0,.6); transition: color .2s; }
.cr-big small { display: block; font-size: 13px; font-weight: 700; color: var(--muted); letter-spacing: 2px; }
.cr-big.crashed { color: var(--loss); animation: cr-boom .5s ease-out; }
.cr-big.out { color: var(--win); }
.cr-bar { position: absolute; left: 50%; top: calc(34% + 74px); transform: translateX(-50%); width: 60%; height: 6px; border-radius: 3px; background: rgba(255,255,255,.08); overflow: hidden; pointer-events: none; }
.cr-bar i { display: block; height: 100%; background: linear-gradient(90deg, var(--accent), var(--accent2)); }
.cr-me { position: absolute; right: 10px; top: 44px; pointer-events: none; padding: 5px 10px; border-radius: 8px; font: 800 13px system-ui, sans-serif; background: rgba(39,224,124,.15); color: var(--win); border: 1px solid var(--win); display: none; }
.cr-players { width: 100%; border-collapse: collapse; font-size: 12.5px; font-variant-numeric: tabular-nums; }
.cr-players td { padding: 4px; border-bottom: 1px solid rgba(38,46,88,.5); } .cr-players td:not(:first-child) { text-align: right; }
.cr-players tr.out td { color: var(--win); } .cr-players tr.lost td { color: var(--loss); opacity: .7; } .cr-players tr.me td:first-child { font-weight: 800; }
@media (max-width: 640px) { .cr-canvas { min-height: 250px; } .cr-big { font-size: 44px; } }
@keyframes cr-in { from { transform: translateX(-20px); opacity: 0; } }
@keyframes cr-boom { 0% { transform: scale(1.35); } 100% { transform: scale(1); } }
`;

export function mount(container, api) {
  const st = store('crash');
  const clock = makeServerClock();
  let view = null;
  let mode = 'Manual';
  let queued = false; // bet as soon as the next round opens
  let runner = null;
  let lastRound = 0; let lastPhase = null;
  let mineThisRound = null; // my bet as of the last state
  let milestone = 1;
  let boomAt = 0; let boomParts = [];

  const { panel, stage, foot, below } = shell(container, CSS);
  const me = () => api.getClientId();
  const myBet = () => (view ? view.bets.find((b) => b.id === me()) : null);
  const myBalance = () => (view && view.balances[me()]) || 0;

  // ---- panel ----
  const modeTabs = tabs(['Manual', 'Auto'], mode, (m) => { mode = m; renderPanel(); });
  const balance = balanceLine();
  const amountSlot = el('div');
  let amount = null;
  const autoOut = numberInput({ value: st.get('autoOut', ''), step: '0.01', min: 1.01, suffix: 'x', onChange: (v) => { const n = Number(v); st.set('autoOut', n >= 1.01 ? n.toFixed(2) : ''); autoOut.set(st.get('autoOut', '')); } });
  autoOut.input.placeholder = 'off';
  const autoOutField = field('Auto Cash Out', autoOut.el);
  const quick = el('div', 'og-seg');
  for (const x of [1.5, 2, 3, 10]) quick.append(btn(null, `${x}x`, () => { autoOut.set(x.toFixed(2)); st.set('autoOut', x.toFixed(2)); sfx.play('click'); }));
  const auto = autoFields(st);
  const betBtn = btn('og-bet', 'Bet', onMain);
  const msg = el('div', 'og-msg');
  const hint = el('div', 'og-hot', 'Space bets and cashes out');
  panel.append(modeTabs.el, balance.el, amountSlot, autoOutField.el, quick, auto.el, betBtn, msg, hint);

  // ---- stage ----
  const hist = el('div', 'cr-hist');
  const canvas = el('canvas', 'cr-canvas');
  const big = el('div', 'cr-big');
  const bar = el('div', 'cr-bar'); const barFill = el('i'); bar.append(barFill);
  const meTag = el('div', 'cr-me');
  const fair = fairButton({
    seeds: null,
    intro: 'Every round has its own secret seed; its SHA-256 hash is shown before betting opens and the seed is revealed at the crash. f = the first float of HMAC-SHA256(seed, "crash:0:0") (4 bytes), crash point = floor(98 / (1 − f)) / 100, at least 1.00x. Click a past round to check it.',
    verify: {
      fields: [['server', 'Round seed'], ['hash', 'Round hash']],
      async run(v) {
        const [f] = await floats(v.server, 'crash', 0, 1);
        const p = Math.min(10000, Math.max(1, Math.floor(98 / (1 - f)) / 100));
        return `Crash point ${fmtX(p)}`;
      },
    },
  });
  const roundText = el('span');
  foot.append(fair.el, el('span', 'og-spacer'), roundText);
  stage.append(hist, canvas, big, bar, meTag, foot);

  const playersCard = el('div', 'og-card');
  const playersHead = el('h4', null, 'THIS ROUND');
  const playersTable = el('table', 'cr-players');
  playersCard.append(playersHead, playersTable);
  const stats = statsCard();
  const feed = feedCard(me);
  below.append(playersCard, feed.el, stats.el);

  // ---- drawing ----
  let W = 0; let H = 0; let g = null;
  const stars = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), z: 0.3 + Math.random() * 0.7 }));
  function layout() {
    const dpr = window.devicePixelRatio || 1;
    W = canvas.clientWidth || 380; H = canvas.clientHeight || 300;
    canvas.width = W * dpr; canvas.height = H * dpr;
    g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  const ro = new ResizeObserver(layout);
  ro.observe(canvas);

  const growth = (t) => Math.floor(100 * Math.exp(view.k * Math.max(0, t))) / 100;
  const timeFor = (m) => Math.log(m) / view.k;
  const niceStep = (span, n) => { const raw = span / n; const p = 10 ** Math.floor(Math.log10(raw)); return [1, 2, 5, 10].map((s) => s * p).find((s) => s >= raw); };

  function frame() {
    raf = requestAnimationFrame(frame);
    if (!g || !view) return;
    const now = clock.now();
    const el_ = now - view.phaseAt;
    const running = view.phase === 'running';
    const crashed = view.phase === 'crashed';
    const t = running ? el_ : crashed ? timeFor(view.point) : 0;
    const m = running ? growth(el_) : crashed ? view.point : 1;
    g.clearRect(0, 0, W, H);

    // Stars drift left faster as the rocket speeds up.
    const speed = running ? 0.02 + Math.min(0.4, (m - 1) * 0.02) : 0.004;
    for (const s of stars) {
      s.x -= speed * s.z * 0.016;
      if (s.x < 0) { s.x += 1; s.y = Math.random(); }
      g.fillStyle = `rgba(200,210,255,${0.25 + 0.5 * s.z})`;
      g.fillRect(s.x * W, s.y * H, 1.6 * s.z, 1.6 * s.z);
    }

    // Axes scale to keep the curve in view.
    const padL = 38; const padB = 24; const padT = 12; const padR = 18;
    const tMax = Math.max(8000, t * 1.18);
    const mMax = Math.max(2, 1 + (m - 1) * 1.25);
    const X = (tt) => padL + (tt / tMax) * (W - padL - padR);
    const Y = (mm) => H - padB - ((mm - 1) / (mMax - 1)) * (H - padB - padT);
    g.font = '600 10.5px system-ui, sans-serif';
    g.fillStyle = 'rgba(136,144,184,.85)';
    g.strokeStyle = 'rgba(136,144,184,.12)';
    g.lineWidth = 1;
    const ms = niceStep(mMax - 1, 4);
    g.textAlign = 'right'; g.textBaseline = 'middle';
    for (let v = ms >= 1 ? Math.max(ms, 2) : 1; v <= mMax + 1e-9; v = +(v + ms).toFixed(2)) { const y = Y(v); g.beginPath(); g.moveTo(padL, y); g.lineTo(W - padR, y); g.stroke(); g.fillText(`${+v.toFixed(2)}x`, padL - 5, y); }
    const ts = niceStep(tMax / 1000, 5);
    g.textAlign = 'center'; g.textBaseline = 'top';
    for (let s = ts; s * 1000 <= tMax; s += ts) g.fillText(`${s}s`, X(s * 1000), H - padB + 6);

    if (running || crashed) {
      const col = crashed ? '255,75,99' : '91,124,255';
      const N = 80;
      const pts = [];
      for (let i = 0; i <= N; i++) { const tt = (t * i) / N; pts.push([X(tt), Y(Math.exp(view.k * tt))]); }
      const grad = g.createLinearGradient(0, Y(m), 0, H - padB);
      grad.addColorStop(0, `rgba(${col},.45)`); grad.addColorStop(1, `rgba(${col},0)`);
      g.beginPath(); g.moveTo(X(0), H - padB); pts.forEach(([x, y]) => g.lineTo(x, y)); g.lineTo(pts[N][0], H - padB); g.closePath();
      g.fillStyle = grad; g.fill();
      g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      const lg = g.createLinearGradient(X(0), 0, pts[N][0], 0);
      lg.addColorStop(0, crashed ? '#ff4b63' : '#5b7cff'); lg.addColorStop(1, crashed ? '#ff8a5b' : '#c56bff');
      g.strokeStyle = lg; g.lineWidth = 4; g.lineCap = 'round'; g.shadowColor = `rgba(${col},.8)`; g.shadowBlur = 14; g.stroke(); g.shadowBlur = 0;

      // Cash-out markers with names.
      for (const b of view.bets) {
        if (b.out == null) continue;
        const x = X(timeFor(b.out)); const y = Y(b.out);
        g.fillStyle = b.id === me() ? '#ffc94a' : '#27e07c';
        g.beginPath(); g.arc(x, y, 4.5, 0, 7); g.fill();
        g.font = '700 10px system-ui, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'bottom';
        g.fillText(`${b.name.split(' ')[0]} ${fmtX(b.out)}`, x + 5, y - 3);
      }

      // The rocket at the tip, pointing along the curve.
      const [x1, y1] = pts[N - 1]; const [x2, y2] = pts[N];
      const ang = Math.atan2(y2 - y1, x2 - x1 || 0.01);
      if (running) drawRocket(x2, y2, ang, now);
      else drawBoom(x2, y2, now);
    }
    // Centre readout.
    if (running) {
      big.className = `cr-big${myBet() && myBet().out != null ? ' out' : ''}`;
      big.firstChild.textContent = fmtX(m);
      if (m >= milestone + 1) { milestone = Math.floor(m); sfx.note(330 * 2 ** Math.min(3, Math.log2(milestone)), { dur: 0.12, type: 'sine', vol: 0.12 }); }
      const b = myBet();
      const sub = b && b.out == null && betBtn.querySelector('small');
      if (sub) sub.textContent = money(b.bet * m);
      bar.style.display = 'none';
    } else if (view.phase === 'betting') {
      const left = Math.max(0, view.betMs - el_);
      big.className = 'cr-big';
      big.firstChild.textContent = `${(left / 1000).toFixed(1)}s`;
      bar.style.display = '';
      barFill.style.width = `${(left / view.betMs) * 100}%`;
      const sec = Math.ceil(left / 1000);
      if (sec <= 3 && sec > 0 && sec !== frame.lastSec) { frame.lastSec = sec; sfx.play('tick'); }
    } else { bar.style.display = 'none'; }
  }

  function drawRocket(x, y, ang, now) {
    g.save();
    g.translate(x, y); g.rotate(ang);
    // Flame flickers.
    const fl = 14 + Math.sin(now / 30) * 4 + Math.random() * 4;
    const fg = g.createLinearGradient(-fl - 10, 0, -8, 0);
    fg.addColorStop(0, 'rgba(255,90,40,0)'); fg.addColorStop(0.5, 'rgba(255,140,40,.9)'); fg.addColorStop(1, '#fff6a8');
    g.fillStyle = fg;
    g.beginPath(); g.moveTo(-8, -5); g.quadraticCurveTo(-fl - 10, 0, -8, 5); g.closePath(); g.fill();
    // Body.
    g.fillStyle = '#e9edff';
    g.beginPath(); g.moveTo(16, 0); g.quadraticCurveTo(8, -7, -8, -6); g.lineTo(-8, 6); g.quadraticCurveTo(8, 7, 16, 0); g.fill();
    g.fillStyle = '#ff4b63';
    g.beginPath(); g.moveTo(-8, -6); g.lineTo(-13, -11); g.lineTo(-3, -6); g.fill();
    g.beginPath(); g.moveTo(-8, 6); g.lineTo(-13, 11); g.lineTo(-3, 6); g.fill();
    g.fillStyle = '#5b7cff'; g.beginPath(); g.arc(5, 0, 2.8, 0, 7); g.fill();
    g.restore();
  }
  function drawBoom(x, y, now) {
    const k = (now - boomAt) / 900;
    if (k > 1) return;
    if (!boomParts.length) boomParts = Array.from({ length: 36 }, () => ({ a: Math.random() * 7, v: 40 + Math.random() * 110, c: ['#ffc94a', '#ff4b63', '#ff8a5b', '#fff'][Math.floor(Math.random() * 4)] }));
    g.fillStyle = `rgba(255,140,60,${0.5 * (1 - k)})`;
    g.beginPath(); g.arc(x, y, 10 + 50 * k, 0, 7); g.fill();
    for (const p of boomParts) {
      g.fillStyle = p.c; g.globalAlpha = 1 - k;
      g.fillRect(x + Math.cos(p.a) * p.v * k, y + Math.sin(p.a) * p.v * k + 30 * k * k, 3, 3);
    }
    g.globalAlpha = 1;
  }
  big.append(document.createTextNode(''), el('small'));
  let raf = requestAnimationFrame(frame);

  // ---- actions ----
  const autoTarget = () => { const n = Number(st.get('autoOut', '')); return n >= 1.01 ? n : null; };
  function placeBet(bet) { api.sendAction({ kind: 'bet', bet, auto: autoTarget() }); sfx.play('chips'); }
  function onMain() {
    msg.textContent = '';
    if (!view) return;
    if (mode === 'Auto') {
      if (runner) { stopAuto(); return; }
      runner = autoRunner(auto.read(), amount.get(), view.limits);
      if (view.phase === 'betting' && !myBet()) placeBet(runner.bet); else queued = true;
      renderPanel();
      return;
    }
    const b = myBet();
    if (view.phase === 'betting') { if (b) api.sendAction({ kind: 'cancel' }); else placeBet(amount.get()); return; }
    if (view.phase === 'running' && b && b.out == null) { api.sendAction({ kind: 'cashout' }); return; }
    queued = !queued; // between rounds: queue for the next one
    sfx.play('click');
    renderPanel();
  }
  function stopAuto(reason) { runner = null; queued = false; if (reason) { msg.className = 'og-msg info'; msg.textContent = reason; } renderPanel(); }

  function renderPanel() {
    if (!view) return;
    if (!amount) { amount = amountField(st, view.limits, myBalance); amountSlot.replaceChildren(amount.el); amount.onChange(renderPanel); }
    const b = myBet();
    const isAuto = mode === 'Auto';
    modeTabs.lock(!!runner || !!b);
    amount.disable(!!runner || !!b);
    autoOut.disable(!!runner || !!b);
    quick.querySelectorAll('button').forEach((q) => { q.disabled = !!runner || !!b; });
    auto.el.style.display = isAuto ? '' : 'none';
    auto.disable(!!runner);
    const set = (cls, text, sub) => { betBtn.className = `og-bet ${cls}`; betBtn.replaceChildren(document.createTextNode(text)); betBtn.append(el('small', null, sub || '')); if (!sub) betBtn.lastChild.remove(); };
    if (isAuto) {
      if (runner) set('stop', 'Stop Autobet', `${runner.left === Infinity ? '∞' : runner.left} left · ${runner.net >= 0 ? '+' : ''}${money(runner.net)}`);
      else set('', 'Start Autobet', autoTarget() ? `cash out at ${fmtX(autoTarget())}` : 'no auto cash-out set');
      betBtn.disabled = false;
    } else if (view.phase === 'betting') {
      if (b) set('stop', 'Cancel Bet', 'waiting for launch'); else set('', 'Bet');
      betBtn.disabled = !b && myBalance() < amount.get();
    } else if (view.phase === 'running' && b && b.out == null) {
      set('cash', 'Cash Out', money(b.bet));
      betBtn.disabled = false;
    } else {
      if (queued) set('ghost', 'Cancel', 'queued for next round'); else set('', 'Bet', 'next round');
      betBtn.disabled = !queued && myBalance() < amount.get();
    }
  }

  function renderPlayers() {
    const bets = [...view.bets].sort((a, b) => b.bet - a.bet);
    const total = bets.reduce((a, b) => a + b.bet, 0);
    playersHead.textContent = `THIS ROUND · ${bets.length} player${bets.length === 1 ? '' : 's'} · ${money(total)}`;
    playersTable.replaceChildren();
    for (const b of bets) {
      const lost = view.phase === 'crashed' && b.out == null;
      const tr = el('tr', `${b.out != null ? 'out' : lost ? 'lost' : ''}${b.id === me() ? ' me' : ''}`);
      tr.append(el('td', null, b.name), el('td', null, money(b.bet)), el('td', null, b.out != null ? fmtX(b.out) : b.auto ? `@${fmtX(b.auto)}` : '-'), el('td', null, b.out != null ? `+${money(b.win - b.bet)}` : lost ? `-${money(b.bet)}` : ''));
      playersTable.append(tr);
    }
    if (!bets.length) { const tr = el('tr'); const td = el('td', null, view.phase === 'betting' ? 'Place your bets…' : 'No bets this round.'); td.colSpan = 4; td.style.color = 'var(--muted)'; tr.append(td); playersTable.append(tr); }
  }

  function renderHistory() {
    hist.replaceChildren();
    for (const h of view.history.slice(0, 16)) {
      const b = btn(h.point >= 10 ? 'hi' : h.point >= 2 ? 'mid' : 'lo', fmtX(h.point), () => fair.open({ server: h.seed, hash: h.hash }));
      b.title = `Round ${h.round}: click to verify`;
      hist.append(b);
    }
  }

  function onState(v) {
    const prevBet = mineThisRound;
    const prevPhase = lastPhase;
    view = v;
    clock.sync(v.now);
    const b = myBet();
    // Round transitions.
    if (v.round !== lastRound) {
      lastRound = v.round; milestone = 1; frame.lastSec = null;
      if (queued || runner) { queued = false; placeBet(runner ? runner.bet : amount ? amount.get() : v.limits.min); }
    }
    if (v.phase === 'running' && prevPhase === 'betting') sfx.play('whoosh');
    if (v.phase === 'crashed' && prevPhase !== 'crashed') {
      boomAt = clock.now(); boomParts = [];
      sfx.play('crash'); shake(stage);
      big.firstChild.textContent = fmtX(v.point);
      big.className = 'cr-big crashed';
      big.lastChild.textContent = 'CRASHED';
      if (prevBet) {
        const mine = b || prevBet;
        const profit = (mine.out != null ? mine.win : 0) - mine.bet;
        stats.add(mine.bet, profit);
        if (runner) {
          const next = runner.next(profit, myBalance());
          if (next == null) stopAuto(runner.reason); else queued = true;
        }
      }
    } else if (v.phase !== 'crashed') big.lastChild.textContent = v.phase === 'betting' ? 'STARTING IN' : '';
    // My cash-out (by hand or auto) during the run.
    if (b && b.out != null && prevBet && prevBet.out == null) {
      meTag.style.display = 'block';
      meTag.textContent = `Cashed ${fmtX(b.out)} · +${money(b.win - b.bet)}`;
      if (b.out >= 10) celebrate(stage, b.out, b.win - b.bet); else sfx.play('point');
    }
    if (!b || v.phase === 'betting') meTag.style.display = 'none';
    mineThisRound = b ? { ...b } : null;
    lastPhase = v.phase;
    balance.set(myBalance());
    feed.set(v.feed);
    roundText.textContent = `Round #${v.round} · hash ${v.hash.slice(0, 10)}…`;
    renderHistory(); renderPlayers(); renderPanel();
  }

  const offKey = hotkey(onMain);

  return {
    applySnapshot(data) { if (data && data.kind === 'state') onState(data); },
    applyEvent(data) {
      if (!data) return;
      if (data.kind === 'state') onState(data);
      else if (data.kind === 'moveRejected') {
        sfx.play('error');
        if (data.reason === 'not_betting') { queued = true; renderPanel(); }
        msg.className = 'og-msg'; msg.textContent = REJECT[data.reason] || data.reason;
        if (runner && data.reason !== 'not_betting') stopAuto();
      }
    },
    unmount() { cancelAnimationFrame(raf); ro.disconnect(); offKey(); container.innerHTML = ''; },
  };
}
