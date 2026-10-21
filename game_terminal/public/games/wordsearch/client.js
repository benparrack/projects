// Word Search — race everyone in the room to find the hidden words in one shared grid. Drag
// (mouse or finger) from a word's first letter to its last; the selection snaps to the 8
// directions. First to find a word claims it in their colour and scores (longer = more points).
// Server plugin: ../../../server/games/wordsearch.js (generates the grid, validates claims and
// never reveals an unfound word's position before the round ends).
import { sfx } from '../sfx.js';
import { createFx } from '../canvasFx.js';
import { createBotBar } from '../tickBots.js';
import { createResults } from '../resultsPanel.js';
import { makeServerClock } from '../serverClock.js';

const PREF_KEY = 'gt-wordsearch-prefs';

const CSS = `
.ws-root { display: flex; flex-direction: column; gap: 8px; }
.ws-top { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.ws-status { font-weight: bold; }
.ws-timer { font-size: 1.5em; font-weight: bold; letter-spacing: 1px; color: #39ff14; font-variant-numeric: tabular-nums; }
.ws-timer.low { color: #ff4d4d; animation: ws-blink 1s steps(2) infinite; }
@keyframes ws-blink { 50% { opacity: .55; } }
.ws-controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.ws-seg { display: inline-flex; border: 1px solid var(--border, #1f8f0c); border-radius: 4px; overflow: hidden; }
.ws-seg button { border: 0; border-radius: 0; padding: 5px 10px; font-size: .85em; }
.ws-seg button + button { border-left: 1px solid var(--border, #1f8f0c); }
.ws-seg button.on { background: #39ff14; color: #041004; font-weight: bold; }
.ws-select { background: #000; color: #39ff14; border: 1px solid var(--border, #1f8f0c); font: inherit; font-size: .85em; padding: 5px 6px; border-radius: 4px; }
.ws-start { font-weight: bold; }
.ws-label { font-size: .8em; opacity: .75; }
.ws-body { display: flex; gap: 14px; align-items: flex-start; flex-wrap: wrap; }
.ws-board { position: relative; flex: none; border: 1px solid var(--border, #1f8f0c); border-radius: 6px; padding: 6px;
  background: radial-gradient(circle at 50% 40%, #0a140a, #030503); box-shadow: inset 0 0 30px -12px #39ff14; }
.ws-board canvas { display: block; touch-action: none; cursor: crosshair; user-select: none; -webkit-user-select: none; }
.ws-preview { position: absolute; left: 50%; top: -14px; transform: translateX(-50%); background: #041004; border: 1px solid #39ff14;
  color: #e9ffe0; padding: 1px 10px; border-radius: 10px; font-weight: bold; letter-spacing: 3px; font-size: .9em; pointer-events: none;
  white-space: nowrap; opacity: 0; transition: opacity .12s; }
.ws-preview.show { opacity: 1; }
.ws-side { flex: 1; min-width: 200px; display: flex; flex-direction: column; gap: 10px; }
.ws-head { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid var(--border, #1f8f0c); padding-bottom: 3px; }
.ws-theme { font-weight: bold; letter-spacing: 1px; color: #ffb000; }
.ws-count { font-size: .85em; opacity: .8; }
.ws-words { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 3px 10px; }
.ws-word { position: relative; padding: 2px 4px; border-radius: 3px; letter-spacing: 1.5px; font-size: .92em; transition: background .3s; }
.ws-word .ws-by { display: block; font-size: .68em; letter-spacing: 0; opacity: .85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ws-word.found .ws-w { text-decoration: line-through; text-decoration-thickness: 2px; text-decoration-color: var(--ws-c); opacity: .75; }
.ws-word.found { background: color-mix(in srgb, var(--ws-c) 12%, transparent); }
.ws-word.mine .ws-w { font-weight: bold; }
.ws-word.missed .ws-w { color: #ff8a8a; }
.ws-word.fresh { animation: ws-pop .6s cubic-bezier(.2,1.5,.4,1); }
@keyframes ws-pop { 0% { transform: scale(1.25); background: color-mix(in srgb, var(--ws-c) 45%, transparent); } }
.ws-scores { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
.ws-score { display: flex; align-items: center; gap: 8px; padding: 3px 6px; border-radius: 4px; border: 1px solid rgba(57,255,20,.15); font-size: .88em; }
.ws-score.lead { border-color: rgba(255,210,63,.6); background: rgba(255,210,63,.08); }
.ws-score.you { box-shadow: inset 3px 0 0 #39ff14; }
.ws-dot { width: 10px; height: 10px; border-radius: 50%; flex: none; box-shadow: 0 0 6px currentColor; }
.ws-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ws-pts { font-weight: bold; font-variant-numeric: tabular-nums; }
.ws-wins { font-size: .78em; opacity: .7; }
.ws-toast { min-height: 1.3em; font-size: .9em; text-align: center; color: #ffb000; transition: opacity .3s; }
.ws-hint { font-size: .8em; opacity: .7; margin: 0; }
@media (prefers-reduced-motion: reduce) { .ws-word.fresh, .ws-timer.low { animation: none; } }
`;

let styled = false;
function ensureStyles() {
  if (styled) return;
  styled = true;
  const tag = document.createElement('style');
  tag.textContent = CSS;
  document.head.appendChild(tag);
}

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
    return { size: [10, 12, 15].includes(p.size) ? p.size : 12, theme: typeof p.theme === 'string' ? p.theme : 'surprise' };
  } catch { return { size: 12, theme: 'surprise' }; }
}
function savePrefs(p) { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* private mode */ } }

const fmtClock = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const easeOut = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// Snap a drag from cell (r0, c0) toward pointer position (fr, fc) (fractional cell coords) onto
// one of the 8 directions, clamped to the grid. Exported for tests.
export function snapSelection(r0, c0, fr, fc, n) {
  const dy = fr - r0;
  const dx = fc - c0;
  if (Math.hypot(dx, dy) < 0.5) return { r1: r0, c1: c0, r2: r0, c2: c0 };
  const oct = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  const dr = Math.round(Math.sin(oct * Math.PI / 4));
  const dc = Math.round(Math.cos(oct * Math.PI / 4));
  let k = Math.round((dx * dc + dy * dr) / (dc * dc + dr * dr));
  k = Math.max(0, k);
  while (k > 0) {
    const r = r0 + dr * k;
    const c = c0 + dc * k;
    if (r >= 0 && r < n && c >= 0 && c < n) break;
    k--;
  }
  return { r1: r0, c1: c0, r2: r0 + dr * k, c2: c0 + dc * k };
}

export function lettersOf(grid, s) {
  const dr = Math.sign(s.r2 - s.r1);
  const dc = Math.sign(s.c2 - s.c1);
  const len = Math.max(Math.abs(s.r2 - s.r1), Math.abs(s.c2 - s.c1)) + 1;
  let out = '';
  for (let i = 0; i < len; i++) out += grid[s.r1 + dr * i][s.c1 + dc * i];
  return out;
}

export function mount(container, api) {
  ensureStyles();
  const clock = makeServerClock();
  const prefs = loadPrefs();
  const results = createResults(container);
  const fx = createFx();

  const root = el('div', 'ws-root');
  const top = el('div', 'ws-top');
  const statusEl = el('div', 'ws-status', 'Loading…');
  const timerEl = el('div', 'ws-timer');
  top.append(statusEl, timerEl);

  const controls = el('div', 'ws-controls');
  const sizeSeg = el('div', 'ws-seg');
  const sizeBtns = {};
  for (const n of [10, 12, 15]) {
    const b = el('button', '', `${n}×${n}`);
    b.addEventListener('click', () => { prefs.size = n; savePrefs(prefs); sfx.play('click'); renderControls(); });
    sizeBtns[n] = b;
    sizeSeg.appendChild(b);
  }
  const themeSel = el('select', 'ws-select');
  themeSel.title = 'Theme';
  themeSel.addEventListener('change', () => { prefs.theme = themeSel.value; savePrefs(prefs); });
  const startBtn = el('button', 'ws-start', 'START');
  startBtn.addEventListener('click', () => startRound());
  controls.append(el('span', 'ws-label', 'GRID'), sizeSeg, el('span', 'ws-label', 'THEME'), themeSel, startBtn);
  const botBar = createBotBar(api);

  const body = el('div', 'ws-body');
  const board = el('div', 'ws-board');
  const canvas = document.createElement('canvas');
  const preview = el('div', 'ws-preview');
  board.append(canvas, preview);
  const side = el('div', 'ws-side');
  const head = el('div', 'ws-head');
  const themeEl = el('span', 'ws-theme', 'WORD SEARCH');
  const countEl = el('span', 'ws-count');
  head.append(themeEl, countEl);
  const wordsEl = el('ul', 'ws-words');
  const scoreTitle = el('div', 'ws-head');
  scoreTitle.append(el('span', 'ws-theme', 'SCORES'), el('span', 'ws-count', 'pts · wins'));
  const scoresEl = el('ul', 'ws-scores');
  side.append(head, wordsEl, scoreTitle, scoresEl);
  body.append(board, side);
  const toastEl = el('div', 'ws-toast');
  const hint = el('p', 'ws-hint', 'Drag from the first letter of a word to its last. Any of the 8 directions, forwards or backwards. First to find a word gets the points.');
  root.append(top, controls, botBar.el, body, toastEl, hint);
  container.appendChild(root);

  let view = null;
  let cell = 34;
  let n = 12;
  let cctx = null;
  let cssW = 0;
  let sel = null; // { r1, c1, r2, c2 } while dragging
  let dragging = false;
  let hover = null;
  const anims = new Map(); // word -> start time of its claim highlight grow-in
  const misses = []; // { s, t } red flashes for wrong selections
  let knownFound = new Map(); // word -> foundBy, to detect new claims
  let roundSeen = null;
  let lastTick = '';
  let toastTimer = 0;
  let rafId = 0;

  function toast(msg, color = '#ffb000') {
    toastEl.textContent = msg;
    toastEl.style.color = color;
    toastEl.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.style.opacity = '0'; }, 2200);
  }

  function startRound() {
    if (view && view.phase === 'playing') return;
    sfx.play('select');
    api.sendAction({ kind: 'start', size: prefs.size, theme: prefs.theme });
  }

  // --- layout: cell size follows the available width (phone → small cells, desktop → roomy).
  function layout() {
    const size = view && view.grid ? view.grid.length : 12;
    const cw = root.clientWidth || container.clientWidth || 600;
    const wide = cw >= 640;
    const maxBoard = Math.min(wide ? cw - 230 : cw - 14, 560);
    const next = Math.max(20, Math.min(40, Math.floor(maxBoard / size)));
    if (next === cell && size === n && cctx) return;
    cell = next;
    n = size;
    cssW = cell * n;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssW * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssW}px`;
    cctx = canvas.getContext('2d');
    cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => layout()) : null;
  if (ro) ro.observe(root);
  else window.addEventListener('resize', layout);

  // --- drawing
  const center = (r, c) => [c * cell + cell / 2, r * cell + cell / 2];

  function capsulePath(ctx, x1, y1, x2, y2, w) {
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const len = Math.hypot(x2 - x1, y2 - y1);
    ctx.save();
    ctx.translate(x1, y1);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.arc(0, 0, w / 2, Math.PI / 2, Math.PI * 1.5);
    ctx.lineTo(len, -w / 2);
    ctx.arc(len, 0, w / 2, -Math.PI / 2, Math.PI / 2);
    ctx.closePath();
    ctx.restore();
  }

  function drawCapsule(s, color, { alpha = 0.32, progress = 1, dashed = false, glow = true } = {}) {
    const [x1, y1] = center(s.r1, s.c1);
    const [x2, y2] = center(s.r2, s.c2);
    const ex = x1 + (x2 - x1) * progress;
    const ey = y1 + (y2 - y1) * progress;
    const w = cell * 0.8;
    capsulePath(cctx, x1, y1, ex, ey, w);
    cctx.globalAlpha = alpha;
    cctx.fillStyle = color;
    cctx.fill();
    cctx.globalAlpha = 0.95;
    cctx.lineWidth = 2;
    cctx.strokeStyle = color;
    if (dashed) cctx.setLineDash([4, 4]);
    if (glow) { cctx.shadowColor = color; cctx.shadowBlur = 8; }
    cctx.stroke();
    cctx.setLineDash([]);
    cctx.shadowBlur = 0;
    cctx.globalAlpha = 1;
  }

  const posSel = (p, len) => ({ r1: p.r, c1: p.c, r2: p.r + p.dr * (len - 1), c2: p.c + p.dc * (len - 1) });

  function cellsInSel(s) {
    const out = new Set();
    if (!s) return out;
    const dr = Math.sign(s.r2 - s.r1);
    const dc = Math.sign(s.c2 - s.c1);
    const len = Math.max(Math.abs(s.r2 - s.r1), Math.abs(s.c2 - s.c1)) + 1;
    for (let i = 0; i < len; i++) out.add((s.r1 + dr * i) * 100 + s.c1 + dc * i);
    return out;
  }

  // Placeholder grid shown before the first round.
  const idleGrid = (() => {
    const msg = ['WORD', 'SEARCH'];
    const g = [];
    const letters = 'ETAOINSHRDLUCMFWYPGB';
    for (let r = 0; r < 12; r++) {
      let row = '';
      for (let c = 0; c < 12; c++) row += letters[(r * 7 + c * 13 + r * c) % letters.length];
      g.push(row.split(''));
    }
    msg.forEach((w, i) => { for (let k = 0; k < w.length; k++) g[4 + i * 3][((12 - w.length) >> 1) + k] = w[k]; });
    return g.map((row) => row.join(''));
  })();

  function draw() {
    if (!cctx) layout();
    const now = performance.now();
    const ctx = cctx;
    ctx.clearRect(0, 0, cssW, cssW);
    const grid = view && view.grid ? view.grid : null;
    const shownGrid = grid || idleGrid;
    if (shownGrid.length !== n) layout();
    fx.applyShake(ctx);

    const counting = view && view.phase === 'playing' && clock.now() < view.startedAt;

    // Subtle cell checker.
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if ((r + c) % 2) { ctx.fillStyle = 'rgba(57,255,20,0.035)'; ctx.fillRect(c * cell, r * cell, cell, cell); }
    }
    if (hover && !dragging && grid && !counting) {
      ctx.fillStyle = 'rgba(57,255,20,0.12)';
      ctx.fillRect(hover.c * cell, hover.r * cell, cell, cell);
    }

    // Claimed words (and, after the round, the ones nobody found).
    const lit = new Map();
    if (view && grid) {
      for (const w of view.words) {
        if (!w.pos) continue;
        const s = posSel(w.pos, w.len);
        if (w.foundBy) {
          const t0 = anims.get(w.word);
          const prog = t0 == null ? 1 : easeOut((now - t0) / 380);
          drawCapsule(s, w.foundColor, { progress: prog });
          for (const k of cellsInSel(s)) lit.set(k, '#ffffff');
        } else {
          drawCapsule(s, '#ff6b6b', { alpha: 0.1, dashed: true, glow: false });
          for (const k of cellsInSel(s)) if (!lit.has(k)) lit.set(k, '#ffb3b3');
        }
      }
    }
    // Wrong selections flash red and fade.
    for (let i = misses.length - 1; i >= 0; i--) {
      const m = misses[i];
      const age = (now - m.t) / 450;
      if (age >= 1) { misses.splice(i, 1); continue; }
      const jx = Math.sin(age * 40) * 3 * (1 - age);
      ctx.save();
      ctx.translate(jx, 0);
      ctx.globalAlpha = 1 - age;
      drawCapsule(m.s, '#ff4d4d', { alpha: 0.3 * (1 - age) });
      ctx.restore();
    }
    // The live drag.
    const selCells = cellsInSel(dragging ? sel : null);
    if (dragging && sel) drawCapsule(sel, '#ffd23f', { alpha: 0.28 });

    // Letters.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(cell * 0.56)}px "Courier New", ui-monospace, monospace`;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const k = r * 100 + c;
        const [x, y] = center(r, c);
        let ch = (shownGrid[r] || '')[c] || '';
        if (counting) {
          // Scrambled shimmer until GO.
          ch = String.fromCharCode(65 + ((r * 31 + c * 17 + Math.floor(now / 90)) % 26));
          ctx.fillStyle = 'rgba(57,255,20,0.25)';
        } else if (selCells.has(k)) ctx.fillStyle = '#fff6c2';
        else if (lit.has(k)) ctx.fillStyle = lit.get(k);
        else ctx.fillStyle = grid ? '#c8f5bd' : 'rgba(57,255,20,0.22)';
        ctx.fillText(ch.toUpperCase(), x, y + 1);
      }
    }
    if (!grid) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, cssW / 2 - 26, cssW, 52);
      ctx.fillStyle = '#39ff14';
      ctx.font = `bold ${Math.max(13, Math.round(cssW / 26))}px "Courier New", monospace`;
      ctx.fillText('PICK A GRID & THEME, THEN START', cssW / 2, cssW / 2);
    }
    fx.draw(ctx);
    ctx.restore();
    fx.drawOverlay(ctx, cssW, cssW);
  }

  function frame() {
    draw();
    renderTimer();
    rafId = requestAnimationFrame(frame);
  }

  // --- input
  function cellAt(ev) {
    const rect = canvas.getBoundingClientRect();
    const fc = ((ev.clientX - rect.left) / rect.width) * n - 0.5;
    const fr = ((ev.clientY - rect.top) / rect.height) * n - 0.5;
    return { fr, fc, r: Math.round(fr), c: Math.round(fc) };
  }
  const canPlay = () => view && view.phase === 'playing' && view.grid && clock.now() >= view.startedAt;

  canvas.addEventListener('pointerdown', (ev) => {
    if (!canPlay()) return;
    const p = cellAt(ev);
    if (p.r < 0 || p.r >= n || p.c < 0 || p.c >= n) return;
    ev.preventDefault();
    canvas.setPointerCapture(ev.pointerId);
    dragging = true;
    sel = { r1: p.r, c1: p.c, r2: p.r, c2: p.c };
    sfx.play('blip');
    updatePreview();
  });
  canvas.addEventListener('pointermove', (ev) => {
    const p = cellAt(ev);
    hover = p.r >= 0 && p.r < n && p.c >= 0 && p.c < n ? p : null;
    if (!dragging || !sel) return;
    const next = snapSelection(sel.r1, sel.c1, p.fr, p.fc, n);
    if (next.r2 !== sel.r2 || next.c2 !== sel.c2) {
      sel = next;
      sfx.play('tick');
      updatePreview();
    }
  });
  canvas.addEventListener('pointerleave', () => { hover = null; });
  const endDrag = (ev) => {
    if (!dragging) return;
    dragging = false;
    if (canvas.hasPointerCapture && ev && canvas.hasPointerCapture(ev.pointerId)) canvas.releasePointerCapture(ev.pointerId);
    const s = sel;
    sel = null;
    updatePreview();
    if (!s || (s.r1 === s.r2 && s.c1 === s.c2) || !canPlay()) return;
    const letters = lettersOf(view.grid, s);
    const rev = letters.split('').reverse().join('');
    const match = view.words.find((w) => w.word === letters || w.word === rev);
    if (!match) {
      misses.push({ s, t: performance.now() });
      sfx.play('error');
      return;
    }
    if (match.foundBy) {
      misses.push({ s, t: performance.now() });
      sfx.play('error');
      toast(`${match.word.toUpperCase()} was already found by ${match.foundName}`);
      return;
    }
    api.sendAction({ kind: 'claim', r1: s.r1, c1: s.c1, r2: s.r2, c2: s.c2 });
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', (ev) => { dragging = false; sel = null; updatePreview(); if (ev) { /* no claim */ } });

  function updatePreview() {
    if (dragging && sel && view && view.grid) {
      preview.textContent = lettersOf(view.grid, sel).toUpperCase();
      preview.classList.add('show');
    } else preview.classList.remove('show');
  }

  // --- DOM panels
  function renderControls() {
    const playing = view && view.phase === 'playing';
    for (const [k, b] of Object.entries(sizeBtns)) {
      b.classList.toggle('on', Number(k) === prefs.size);
      b.disabled = playing;
    }
    const themes = (view && view.themes) || { surprise: 'Surprise me' };
    if (themeSel.options.length !== Object.keys(themes).length) {
      themeSel.textContent = '';
      for (const [k, label] of Object.entries(themes)) {
        const o = el('option', '', label);
        o.value = k;
        themeSel.appendChild(o);
      }
    }
    if (!themes[prefs.theme]) prefs.theme = 'surprise';
    themeSel.value = prefs.theme;
    themeSel.disabled = playing;
    startBtn.disabled = !view || playing;
    startBtn.textContent = view && view.phase === 'results' ? 'NEW PUZZLE' : 'START';
  }

  function renderStatus() {
    if (!view) { statusEl.textContent = 'Loading…'; return; }
    const humans = view.players.filter((p) => !p.bot).length;
    if (view.phase === 'waiting') statusEl.textContent = `${humans} player${humans === 1 ? '' : 's'} here. Pick a grid and theme, then START.`;
    else if (view.phase === 'playing') {
      const left = view.words.filter((w) => !w.foundBy).length;
      statusEl.textContent = clock.now() < view.startedAt ? 'Get ready…' : `${left} word${left === 1 ? '' : 's'} left to find.`;
    } else {
      statusEl.textContent = view.endReason === 'all_found' ? 'All words found.' : "Time's up.";
    }
  }

  function renderWords() {
    wordsEl.textContent = '';
    if (!view || !view.words.length) {
      themeEl.textContent = 'WORD SEARCH';
      countEl.textContent = '';
      return;
    }
    themeEl.textContent = (view.themeLabel || 'Words').toUpperCase();
    const found = view.words.filter((w) => w.foundBy).length;
    countEl.textContent = `${found}/${view.words.length} found`;
    const me = api.getClientId();
    const over = view.phase === 'results';
    for (const w of view.words) {
      const li = el('li', 'ws-word');
      const counting = view.phase === 'playing' && clock.now() < view.startedAt;
      li.appendChild(el('span', 'ws-w', counting ? '•'.repeat(w.len) : w.word.toUpperCase()));
      if (w.foundBy) {
        li.classList.add('found');
        li.style.setProperty('--ws-c', w.foundColor);
        if (w.foundBy === me) li.classList.add('mine');
        if (anims.has(w.word) && performance.now() - anims.get(w.word) < 700) li.classList.add('fresh');
        const by = el('span', 'ws-by', `${w.foundBy === me ? 'you' : w.foundName} +${w.points}`);
        by.style.color = w.foundColor;
        li.appendChild(by);
      } else if (over) {
        li.classList.add('missed');
        li.appendChild(el('span', 'ws-by', 'missed'));
      }
      wordsEl.appendChild(li);
    }
  }

  function renderScores() {
    scoresEl.textContent = '';
    if (!view) return;
    const me = api.getClientId();
    const list = view.players.slice().sort((a, b) => b.score - a.score || b.wins - a.wins);
    const top = list.length ? list[0].score : 0;
    for (const p of list) {
      const li = el('li', 'ws-score');
      if (top > 0 && p.score === top) li.classList.add('lead');
      if (p.clientId === me) li.classList.add('you');
      const dot = el('span', 'ws-dot');
      dot.style.background = p.color;
      dot.style.color = p.color;
      const name = el('span', 'ws-name', `${top > 0 && p.score === top ? '★ ' : ''}${p.nickname}${p.clientId === me ? ' (you)' : ''}`);
      li.append(dot, name, el('span', 'ws-pts', `${p.score}`), el('span', 'ws-wins', `· ${p.wins} wins`));
      scoresEl.appendChild(li);
    }
  }

  function renderTimer() {
    if (!view || view.phase === 'waiting' || !view.startedAt) { timerEl.textContent = ''; timerEl.classList.remove('low'); return; }
    if (view.phase === 'results') {
      timerEl.textContent = fmtClock((view.endedAt || view.endsAt) - view.startedAt);
      timerEl.classList.remove('low');
      return;
    }
    const now = clock.now();
    if (now < view.startedAt) {
      const s = Math.ceil((view.startedAt - now) / 1000);
      const key = `c${view.roundId}-${s}`;
      if (key !== lastTick) {
        lastTick = key;
        sfx.play('beep');
        fx.bigLabel(String(s), '#ffd23f');
        renderWords();
        renderStatus();
      }
      timerEl.textContent = fmtClock(view.endsAt - view.startedAt);
      return;
    }
    if (lastTick.startsWith(`c${view.roundId}-`)) {
      lastTick = `go${view.roundId}`;
      sfx.play('go');
      fx.bigLabel('GO', '#39ff14');
      renderWords();
      renderStatus();
    }
    const left = view.endsAt - now;
    timerEl.textContent = fmtClock(left);
    timerEl.classList.toggle('low', left <= 30000);
    const secs = Math.ceil(left / 1000);
    if (secs <= 10 && secs > 0 && lastTick !== `t${view.roundId}-${secs}`) {
      lastTick = `t${view.roundId}-${secs}`;
      sfx.play('tick');
    }
  }

  function renderResults() {
    if (!view || view.phase !== 'results') { results.update(null); return; }
    const me = api.getClientId();
    const players = view.players.filter((p) => p.inRound).sort((a, b) => b.score - a.score);
    const top = players.length ? players[0].score : 0;
    const mine = players.find((p) => p.clientId === me);
    const solo = players.filter((p) => !p.bot).length <= 1 && !players.some((p) => p.bot);
    const found = view.words.filter((w) => w.foundBy).length;
    let outcome = 'over';
    let title = view.endReason === 'all_found' ? 'ALL FOUND' : "TIME'S UP";
    if (mine && !solo) {
      const iWon = top > 0 && mine.score === top;
      outcome = iWon ? 'win' : 'lose';
      title = iWon ? (players.filter((p) => p.score === top).length > 1 ? 'TIED FOR FIRST' : 'YOU WIN') : 'YOU LOSE';
    } else if (mine && solo) outcome = view.endReason === 'all_found' ? 'win' : 'lose';
    results.update({
      title,
      subtitle: `${(view.themeLabel || '').toUpperCase()} · ${found}/${view.words.length} words · ${fmtClock((view.endedAt || view.endsAt) - view.startedAt)}`,
      outcome,
      rows: players.map((p) => ({
        name: p.nickname,
        value: `${p.score} pts · ${p.found} word${p.found === 1 ? '' : 's'}`,
        win: top > 0 && p.score === top,
        you: p.clientId === me,
      })),
      rematch: { label: 'NEW PUZZLE', onClick: () => startRound() },
    });
  }

  function onState(data) {
    const prev = view;
    view = data;
    clock.sync(view.serverNow);
    const me = api.getClientId();
    if (view.roundId !== roundSeen) {
      // New round (or first snapshot): claims already on the board appear without animation.
      roundSeen = view.roundId;
      anims.clear();
      knownFound = new Map(view.words.filter((w) => w.foundBy).map((w) => [w.word, w.foundBy]));
      misses.length = 0;
      if (prev && view.phase === 'playing') layout();
    } else {
      for (const w of view.words) {
        if (!w.foundBy || knownFound.has(w.word)) continue;
        knownFound.set(w.word, w.foundBy);
        anims.set(w.word, performance.now());
        const s = posSel(w.pos, w.len);
        const [x2, y2] = center(s.r2, s.c2);
        const [x1, y1] = center(s.r1, s.c1);
        const mine = w.foundBy === me;
        setTimeout(() => {
          fx.burst(x2, y2, w.foundColor, { count: mine ? 28 : 14, speed: mine ? 200 : 130, life: 0.6 });
          fx.text((x1 + x2) / 2, (y1 + y2) / 2 - cell * 0.6, `+${w.points}`, w.foundColor, { size: mine ? 18 : 13, life: 1 });
        }, 300);
        if (mine) { sfx.play('point'); fx.shake(2); }
        else { sfx.play('pop'); toast(`${w.foundName} found ${w.word.toUpperCase()}`, w.foundColor); }
      }
    }
    if (prev && prev.phase === 'playing' && view.phase === 'results') {
      const mine = view.players.find((p) => p.clientId === me && p.inRound);
      const top = Math.max(0, ...view.players.filter((p) => p.inRound).map((p) => p.score));
      if (mine) sfx.play(mine.score === top && top > 0 ? 'win' : 'lose');
      if (view.endReason === 'all_found') fx.bigLabel('ALL FOUND', '#ffd23f');
    }
    if (view.grid && view.grid.length !== n) layout();
    render();
  }

  function render() {
    renderControls();
    renderStatus();
    renderWords();
    renderScores();
    renderResults();
    if (view) botBar.update(view.players);
  }

  layout();
  rafId = requestAnimationFrame(frame);

  return {
    applySnapshot(snapshot) {
      if (snapshot && snapshot.kind === 'state') onState(snapshot);
      else if (snapshot) onState({ kind: 'state', ...snapshot });
    },
    applyEvent(data) {
      if (!data) return;
      if (data.kind === 'state') onState(data);
      else if (data.kind === 'miss') {
        if (data.reason === 'taken') toast(`${String(data.word || '').toUpperCase()} was already found by ${data.by}`);
        sfx.play('error');
      }
    },
    applyRoster() { /* names come from the server's player list */ },
    unmount() {
      cancelAnimationFrame(rafId);
      clearTimeout(toastTimer);
      if (ro) ro.disconnect();
      else window.removeEventListener('resize', layout);
      results.destroy();
      container.innerHTML = '';
    },
  };
}
