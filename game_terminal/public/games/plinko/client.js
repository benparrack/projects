// Plinko: drop balls through a peg triangle into multiplier buckets. The server settles each drop the
// instant it's made and sends the path (left/right at every row); this draws the ball bouncing down
// that path, lights the pegs it touches and bumps the bucket it lands in. Several balls can be in
// the air at once. Server plugin: ../../../server/games/plinko.js

import { sfx } from '../sfx.js';
import { el, btn, money, fmtX, store, REJECT, shell, tabs, field, seg, select, amountField, autoFields, autoRunner, statsCard, feedCard, balanceLine, celebrate, fairButton, floats, hotkey } from '../originals.js';

const SPEEDS = { normal: 450, fast: 220, turbo: 90 }; // ms between auto drops
const ROW_MS = 95; // per row of pegs
const CSS = `
.pl-board { position: relative; flex: 1; min-height: min(520px, 100vw); }
.pl-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.pl-hist { position: absolute; right: 0; top: 0; width: 52px; pointer-events: none; display: flex; flex-direction: column; gap: 4px; padding: 10px 6px 10px 0; overflow: hidden; }
.pl-hist span { border-radius: 6px; font: 800 11px system-ui, sans-serif; text-align: center; padding: 6px 0; color: #1a0d00; animation: pl-in .3s ease-out; box-shadow: 0 2px 0 rgba(0,0,0,.35); }
@keyframes pl-in { from { transform: translateY(-14px) scale(.6); opacity: 0; } }
`;

// Bucket colour: gold in the middle to hot red at the edges.
const bucketColor = (d) => `hsl(${46 - 46 * d ** 0.8}, 100%, ${58 - 6 * d}%)`;

export function mount(container, api) {
  const st = store('plinko');
  let view = null;
  let rows = st.get('rows', 16);
  let risk = st.get('risk', 'medium');
  let mode = 'Manual';
  let ballSeq = 0;
  let serverBalance = 0;
  const flying = new Map(); // ball id -> ball (waiting on the server, or animating)
  const pops = []; // floating multipliers over the buckets
  let runner = null;
  let autoTimer = null;
  let seedsNow = null;

  const { root, panel, stage, foot, below } = shell(container, CSS);
  const limits = () => (view ? view.limits : { min: 0.1, max: 1000 });

  // ---- panel ----
  const modeTabs = tabs(['Manual', 'Auto'], mode, (m) => { mode = m; renderPanel(); });
  const balance = balanceLine();
  let amount = null; // built once limits arrive
  const amountSlot = el('div');
  const riskSeg = seg(['low', 'medium', 'high'], risk, (r) => { risk = r; st.set('risk', r); layout(); });
  const rowsSel = select([8, 9, 10, 11, 12, 13, 14, 15, 16].map((n) => [n, String(n)]), rows, (v) => { rows = Number(v); st.set('rows', rows); layout(); });
  const speedSeg = seg(Object.keys(SPEEDS), st.get('speed', 'fast'), (s) => st.set('speed', s));
  const auto = autoFields(st);
  const autoBox = el('div', 'og-field');
  autoBox.append(field('Speed', speedSeg.el).el, auto.el);
  const betBtn = btn('og-bet', 'Drop Ball', onBet);
  const msg = el('div', 'og-msg');
  const hint = el('div', 'og-hot', 'Space drops a ball');
  panel.append(modeTabs.el, balance.el, amountSlot, field('Risk', riskSeg.el).el, field('Rows', rowsSel.el).el, autoBox, betBtn, msg, hint);

  // ---- stage ----
  const board = el('div', 'pl-board');
  const canvas = el('canvas', 'pl-canvas');
  const hist = el('div', 'pl-hist');
  board.append(canvas, hist);
  const fair = fairButton({
    seeds: () => seedsNow,
    rotate: (client) => api.sendAction({ kind: 'seed', client }),
    intro: 'Each drop uses HMAC-SHA256(server seed, "client seed:nonce:0"). Every 4 bytes make a float; for each row, a float under 0.5 sends the ball left, otherwise right. The bucket is the number of rights. Rotate the pair to reveal the server seed and check any earlier drop.',
    verify: {
      fields: [['server', 'Server seed'], ['hash', 'Server seed hash (optional)'], ['client', 'Client seed'], ['nonce', 'Nonce', '0'], ['rows', 'Rows', String(rows)], ['risk', 'Risk (low/medium/high)', risk]],
      async run(v) {
        const n = Number(v.rows);
        const f = await floats(v.server, v.client, Number(v.nonce), n);
        const path = f.map((x) => (x < 0.5 ? 0 : 1));
        const slot = path.reduce((a, b) => a + b, 0);
        const t = view && view.tables[v.risk] && view.tables[v.risk][n];
        return `Path ${path.map((p) => (p ? 'R' : 'L')).join('')} → bucket ${slot}${t ? ` → ${fmtX(t[slot])}` : ''}`;
      },
    },
  });
  const footText = el('span', null, '98% RTP');
  foot.append(fair.el, el('span', 'og-spacer'), footText);
  stage.append(board, foot);

  const stats = statsCard();
  const feed = feedCard(() => api.getClientId());
  below.append(feed.el, stats.el);

  // ---- geometry ----
  let W = 0; let H = 0; let g = null; let geo = null;
  function layout() {
    const dpr = window.devicePixelRatio || 1;
    W = canvas.clientWidth || 400;
    H = canvas.clientHeight || 360;
    canvas.width = W * dpr; canvas.height = H * dpr;
    g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bucketH = Math.max(22, Math.min(34, W / (rows + 2) * 0.9));
    const gap = Math.min((W - 16) / (rows + 2), (H - 34 - bucketH - 18) / rows);
    const top = Math.max(34, (H - rows * gap - bucketH) / 2 + 8); // centred when width is the limit
    const pegR = Math.max(2.2, gap * 0.1);
    geo = { cx: W / 2, top, gap, pegR, ballR: Math.max(4, gap * 0.25), bucketY: top + rows * gap + 4, bucketH, rows, risk, hits: new Map(), bump: new Array(rows + 1).fill(0) };
    footText.textContent = view ? `${rows} rows · ${risk} · max ${fmtX(view.tables[risk][rows][0])} · 98% RTP` : '98% RTP';
  }
  const pegX = (r, i) => geo.cx + (i - (r + 2) / 2) * geo.gap;
  const pegY = (r) => geo.top + r * geo.gap;
  // Where the ball touches row r's peg after k rights in r decisions.
  const contact = (r, k) => ({ x: geo.cx + (k - r / 2) * geo.gap, y: pegY(r) - geo.pegR - geo.ballR });
  const ro = new ResizeObserver(() => layout());
  ro.observe(board);

  // ---- balls ----
  function launch(b) {
    b.t0 = performance.now();
    b.rows = rows;
    // Key points: above the board, a contact on every row, then the bucket.
    const pts = [{ x: geo.cx + (Math.random() - 0.5) * 2, y: geo.top - geo.gap * 1.2 }];
    let k = 0;
    for (let r = 0; r < b.path.length; r++) { pts.push(contact(r, k)); k += b.path[r]; }
    pts.push({ x: geo.cx + (k - b.path.length / 2) * geo.gap, y: geo.bucketY + geo.bucketH * 0.4 });
    b.pts = pts;
    b.hop = pts.map(() => 0.28 + Math.random() * 0.14);
    b.pegs = [];
    for (let r = 0, kk = 0; r < b.path.length; r++) { b.pegs.push([r, kk + 1]); kk += b.path[r]; }
  }
  function ballPos(b, now) {
    const t = Math.max(0, (now - b.t0) / ROW_MS); // rAF time can predate the launch
    const seg = Math.floor(t);
    const n = b.pts.length - 1;
    if (seg >= n) return { done: true, ...b.pts[n] };
    const u = t - seg;
    const a = b.pts[seg]; const c = b.pts[seg + 1];
    const ease = 1 - (1 - u) ** 2;
    const hop = seg === 0 ? 0 : geo.gap * b.hop[seg];
    // A little parabolic hop off each peg, falling into the next.
    return { x: a.x + (c.x - a.x) * ease, y: a.y + (c.y - a.y) * u * u - 4 * hop * u * (1 - u) * (1 - u), seg };
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!g || !view) return;
    g.clearRect(0, 0, W, H);
    // Pegs (lit when a ball just hit them).
    for (let r = 0; r < geo.rows; r++) for (let i = 0; i < r + 3; i++) {
      const lit = geo.hits.get(`${r}:${i}`);
      const glow = lit ? Math.max(0, 1 - (now - lit) / 350) : 0;
      if (glow > 0) { g.fillStyle = `rgba(255,255,255,${0.35 * glow})`; g.beginPath(); g.arc(pegX(r, i), pegY(r), geo.pegR * (2 + 2 * glow), 0, 7); g.fill(); }
      g.fillStyle = glow > 0 ? '#ffffff' : '#c9d2ff';
      g.beginPath(); g.arc(pegX(r, i), pegY(r), geo.pegR * (1 + 0.4 * glow), 0, 7); g.fill();
    }
    // Buckets.
    const t = view.tables[risk][geo.rows];
    const bw = geo.gap * 0.92;
    for (let k = 0; k <= geo.rows; k++) {
      const x = geo.cx + (k - geo.rows / 2) * geo.gap;
      const d = Math.abs(k - geo.rows / 2) / (geo.rows / 2);
      const bump = Math.max(0, 1 - (now - geo.bump[k]) / 300);
      const y = geo.bucketY + bump * 7 * Math.sin(bump * Math.PI);
      g.fillStyle = 'rgba(0,0,0,.4)';
      roundRect(x - bw / 2, y + 4, bw, geo.bucketH, 5); g.fill();
      g.fillStyle = bucketColor(d);
      if (bump > 0) { g.shadowColor = bucketColor(d); g.shadowBlur = 18 * bump; }
      roundRect(x - bw / 2, y, bw, geo.bucketH, 5); g.fill();
      g.shadowBlur = 0;
      g.fillStyle = '#1a0d00';
      const label = t[k] >= 100 ? String(t[k]) : `${t[k]}`;
      g.font = `800 ${Math.max(8, Math.min(13, bw / (label.length * 0.62 + 0.6)))}px system-ui, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(label, x, y + geo.bucketH / 2 + 1);
    }
    // Balls.
    for (const [id, b] of flying) {
      if (!b.pts) continue;
      if (b.rows !== geo.rows) { landed(id, b); continue; } // board changed under it: settle it now
      const p = ballPos(b, now);
      if (p.seg != null && p.seg > (b.lastSeg ?? 0)) {
        b.lastSeg = p.seg;
        const [r, i] = b.pegs[p.seg - 1] || [];
        if (r != null) { geo.hits.set(`${r}:${i}`, now); if (flying.size < 6) sfx.note(1800 + r * 60, { dur: 0.03, type: 'sine', vol: 0.05 }); }
      }
      if (p.done) { landed(id, b); continue; }
      const grd = g.createRadialGradient(p.x - geo.ballR * 0.35, p.y - geo.ballR * 0.35, 1, p.x, p.y, geo.ballR);
      grd.addColorStop(0, '#fff6d6'); grd.addColorStop(0.5, '#ff8fb1'); grd.addColorStop(1, '#e0245e');
      g.fillStyle = grd; g.shadowColor = 'rgba(255,90,140,.7)'; g.shadowBlur = 10;
      g.beginPath(); g.arc(p.x, p.y, geo.ballR, 0, 7); g.fill();
      g.shadowBlur = 0;
    }
    drawPops(now);
  }
  function drawPops(now) {
    for (let i = pops.length - 1; i >= 0; i--) {
      const p = pops[i];
      const k = (now - p.t) / 900;
      if (k > 1) { pops.splice(i, 1); continue; }
      g.globalAlpha = 1 - k * k;
      g.fillStyle = p.color;
      g.font = `900 ${p.big ? 18 : 13}px system-ui, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'bottom';
      g.fillText(p.text, p.x, geo.bucketY - 6 - 34 * k);
    }
    g.globalAlpha = 1;
  }
  function roundRect(x, y, w, h, r) { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); }
  let raf = requestAnimationFrame(frame);

  function landed(id, b) {
    flying.delete(id);
    geo.bump[b.slot] = performance.now();
    if (b.mult >= 1) pops.push({ t: geo.bump[b.slot], x: geo.cx + (b.slot - b.rows / 2) * geo.gap, text: fmtX(b.mult), color: bucketColor(Math.abs(b.slot - b.rows / 2) / (b.rows / 2)), big: b.mult >= 5 });
    if (pops.length > 12) pops.shift();
    const d = Math.abs(b.slot - b.rows / 2) / (b.rows / 2);
    const x = b.mult;
    if (x >= 1) sfx.note(440 * 2 ** Math.min(2.5, Math.log2(x + 1)), { dur: 0.16, type: 'triangle', vol: 0.18 });
    else sfx.note(300 + 200 * d, { dur: 0.08, type: 'sine', vol: 0.1 });
    stats.add(b.bet, b.win - b.bet);
    const chip = el('span', null, fmtX(x).replace('.00x', 'x'));
    chip.style.background = bucketColor(d);
    hist.prepend(chip);
    while (hist.children.length > 6) hist.lastChild.remove();
    if (x >= 10 && b.win - b.bet > 0) celebrate(stage, x, b.win);
    syncBalance();
  }
  const inFlightWins = () => [...flying.values()].reduce((a, b) => a + (b.win || 0), 0);
  function syncBalance() { balance.set(serverBalance - inFlightWins()); renderPanel(); }

  // ---- betting ----
  function drop(bet) {
    if (!view) return false;
    const id = ++ballSeq;
    flying.set(id, { bet, pending: true });
    api.sendAction({ kind: 'drop', bet, rows, risk, ball: id });
    return true;
  }
  function onBet() {
    msg.textContent = '';
    if (mode === 'Manual') { if (drop(amount.get())) sfx.play('pop'); return; }
    if (runner) { stopAuto(); return; }
    runner = autoRunner(auto.read(), amount.get(), limits(), serverBalance);
    renderPanel();
    autoStep();
  }
  function autoStep() {
    if (!runner) return;
    drop(runner.bet);
    autoTimer = setTimeout(() => { autoTimer = null; }, SPEEDS[speedSeg.get()]);
  }
  function stopAuto(reason) {
    runner = null;
    clearTimeout(autoTimer); autoTimer = null;
    if (reason) { msg.className = 'og-msg info'; msg.textContent = reason; }
    renderPanel();
  }
  function onDrop(d) {
    const b = flying.get(d.ball) || { bet: d.bet };
    Object.assign(b, { path: d.path, slot: d.slot, mult: d.mult, win: d.win, pending: false });
    flying.set(d.ball, b);
    serverBalance = d.balance;
    if (seedsNow) seedsNow.nonce = d.fair.nonce + 1;
    launch(b);
    syncBalance();
    if (runner) {
      const next = runner.next(d.win - d.bet, d.balance);
      if (next == null) { stopAuto(runner.reason); return; }
      const wait = SPEEDS[speedSeg.get()];
      const since = autoTimer ? wait : 0;
      clearTimeout(autoTimer);
      autoTimer = setTimeout(() => { autoTimer = null; autoStep(); }, Math.max(0, since));
    }
  }

  function renderPanel() {
    if (!view) return;
    if (!amount) { amount = amountField(st, view.limits, () => serverBalance); amountSlot.replaceChildren(amount.el); amount.onChange(renderPanel); }
    const auto_ = mode === 'Auto';
    const busy = [...flying.values()].some((b) => b.pts || b.pending);
    modeTabs.lock(!!runner);
    autoBox.style.display = auto_ ? '' : 'none';
    auto.disable(!!runner);
    amount.disable(!!runner);
    // The board can't change shape under balls in flight.
    riskSeg.disable(busy || !!runner);
    rowsSel.disable(busy || !!runner);
    if (auto_) {
      betBtn.className = runner ? 'og-bet stop' : 'og-bet';
      betBtn.replaceChildren(document.createTextNode(runner ? 'Stop Autobet' : 'Start Autobet'));
      if (runner) betBtn.append(el('small', null, `${runner.left === Infinity ? '∞' : runner.left} left · ${runner.net >= 0 ? '+' : ''}${money(runner.net)}`));
    } else { betBtn.className = 'og-bet'; betBtn.textContent = 'Drop Ball'; }
    betBtn.disabled = !runner && balance.value < amount.get() && serverBalance < amount.get();
  }

  const offKey = hotkey(() => onBet());

  return {
    // The shared snapshot has no seeds or balance; only the personal state counts.
    applySnapshot(data) { if (data && data.kind === 'state' && data.seeds) this.applyEvent(data); },
    applyEvent(data) {
      if (!data) return;
      if (data.kind === 'state') {
        view = data;
        if (data.seeds) seedsNow = data.seeds;
        serverBalance = data.balance;
        balance.set(serverBalance);
        feed.set(data.feed);
        layout();
        renderPanel();
      } else if (data.kind === 'drop') onDrop(data);
      else if (data.kind === 'dropFailed') { flying.delete(data.ball); if (runner) stopAuto(); renderPanel(); }
      else if (data.kind === 'feed') feed.set(data.feed);
      else if (data.kind === 'seeds') { seedsNow = data.seeds; fair.reveal(data.prev); fair.open({ server: data.prev.server, hash: data.prev.hash, client: data.prev.client, nonce: String(Math.max(0, data.prev.nonces - 1)) }); }
      else if (data.kind === 'moveRejected') { sfx.play('error'); msg.className = 'og-msg'; msg.textContent = REJECT[data.reason] || data.reason; }
    },
    unmount() { cancelAnimationFrame(raf); ro.disconnect(); offKey(); stopAuto(); container.innerHTML = ''; },
  };
}
