// Word Hunt — everyone gets the same 4x4 letter grid and 80 seconds. Swipe (mouse or finger)
// through touching letters to spell words of 3+ letters; longer words score far more. Each player
// keeps their own list; at the end the scores are compared and every word in the grid is revealed
// (tap one to trace it on the board).
// Server plugin: ../../../server/games/wordhunt.js (rolls the grid, validates words, runs bots and
// never reveals other players' words or the solution list before the round ends).
import { sfx } from '../sfx.js';
import { createFx } from '../canvasFx.js';
import { createBotBar } from '../tickBots.js';
import { createResults } from '../resultsPanel.js';
import { makeServerClock } from '../serverClock.js';
import { N, extendPath } from './path.js';

const POINTS = (len) => (len < 3 ? 0 : len === 3 ? 100 : len === 4 ? 400 : len === 5 ? 800 : len === 6 ? 1400 : len === 7 ? 1800 : 2200);

const CSS = `
.wh-root { display: flex; flex-direction: column; gap: 8px; }
.wh-top { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
.wh-status { font-weight: bold; }
.wh-controls { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.wh-start { font-weight: bold; }
.wh-body { display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap; justify-content: center; }
.wh-main { display: flex; flex-direction: column; align-items: center; gap: 8px; flex: none; }
.wh-hud { display: flex; justify-content: space-between; align-items: center; gap: 12px; width: 100%; }
.wh-stat { display: flex; flex-direction: column; align-items: center; min-width: 70px; }
.wh-stat b { font-size: 1.45em; font-variant-numeric: tabular-nums; color: #e9ffe0; }
.wh-stat span { font-size: .7em; letter-spacing: 2px; opacity: .7; }
.wh-timer b { color: #39ff14; }
.wh-timer.low b { color: #ff4d4d; animation: wh-blink 1s steps(2) infinite; }
@keyframes wh-blink { 50% { opacity: .55; } }
.wh-word { height: 34px; display: flex; align-items: center; justify-content: center; gap: 8px; }
.wh-word .wh-letters { padding: 3px 14px; border-radius: 16px; font-weight: bold; letter-spacing: 4px; font-size: 1.25em;
  background: #0d1a0d; border: 1px solid #2b5d26; color: #fff6c2; min-width: 40px; text-align: center; transition: background .15s, border-color .15s; }
.wh-word .wh-letters.ok { background: #1f6f12; border-color: #39ff14; color: #fff; }
.wh-word .wh-letters.dupe { background: #6a5200; border-color: #ffd23f; color: #fff; }
.wh-word .wh-letters.bad { background: #5a1414; border-color: #ff4d4d; color: #fff; }
.wh-word .wh-letters.empty { opacity: 0; }
.wh-word .wh-gain { font-weight: bold; color: #ffd23f; }
.wh-board { position: relative; border-radius: 14px; padding: 10px;
  background: linear-gradient(160deg, #1d4a1a, #0c2a0b); border: 2px solid #2f7a22;
  box-shadow: inset 0 0 30px -8px #000, 0 0 24px -10px #39ff14; }
.wh-board canvas { display: block; touch-action: none; cursor: pointer; user-select: none; -webkit-user-select: none; }
.wh-side { flex: 1; min-width: 220px; max-width: 420px; display: flex; flex-direction: column; gap: 10px; }
.wh-head { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid var(--border, #1f8f0c); padding-bottom: 3px; }
.wh-title { font-weight: bold; letter-spacing: 1px; color: #ffb000; }
.wh-sub { font-size: .8em; opacity: .75; }
.wh-mywords { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px; max-height: 220px; overflow-y: auto; }
.wh-chip { padding: 1px 7px; border-radius: 10px; font-size: .82em; letter-spacing: 1px; border: 1px solid rgba(57,255,20,.3); background: rgba(57,255,20,.06); cursor: default; }
.wh-chip.fresh { animation: wh-pop .5s cubic-bezier(.2,1.5,.4,1); }
.wh-chip.long { border-color: rgba(255,210,63,.7); color: #ffe27a; }
.wh-chip.clickable { cursor: pointer; }
.wh-chip.clickable:hover, .wh-chip.sel { background: rgba(255,210,63,.25); border-color: #ffd23f; }
.wh-chip.missed { opacity: .6; border-style: dashed; }
.wh-chip.shared { text-decoration: underline dotted; }
@keyframes wh-pop { 0% { transform: scale(1.5); background: rgba(57,255,20,.45); } }
.wh-scores { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
.wh-score { display: flex; align-items: center; gap: 8px; padding: 3px 6px; border-radius: 4px; border: 1px solid rgba(57,255,20,.15); font-size: .88em; }
.wh-score.lead { border-color: rgba(255,210,63,.6); background: rgba(255,210,63,.08); }
.wh-score.you { box-shadow: inset 3px 0 0 #39ff14; }
.wh-score.pick { cursor: pointer; }
.wh-score.picked { background: rgba(0,234,255,.1); border-color: #00eaff; }
.wh-dot { width: 10px; height: 10px; border-radius: 50%; flex: none; box-shadow: 0 0 6px currentColor; }
.wh-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wh-pts { font-weight: bold; font-variant-numeric: tabular-nums; }
.wh-cnt { font-size: .78em; opacity: .7; min-width: 64px; text-align: right; }
.wh-hint { font-size: .8em; opacity: .7; margin: 0; }
.wh-empty { font-size: .82em; opacity: .55; }
@media (prefers-reduced-motion: reduce) { .wh-chip.fresh, .wh-timer.low b { animation: none; } }
`;

let styled = false;
function ensureStyles() {
  if (styled) return;
  styled = true;
  const tag = document.createElement('style');
  tag.textContent = CSS;
  document.head.appendChild(tag);
}

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const fmtClock = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
export function mount(container, api) {
  ensureStyles();
  const clock = makeServerClock();
  const results = createResults(container);
  const fx = createFx();

  const root = el('div', 'wh-root');
  const top = el('div', 'wh-top');
  const statusEl = el('div', 'wh-status', 'Loading…');
  const controls = el('div', 'wh-controls');
  const startBtn = el('button', 'wh-start', 'START');
  startBtn.addEventListener('click', () => startRound());
  controls.append(startBtn);
  top.append(statusEl, controls);
  const botBar = createBotBar(api);

  const body = el('div', 'wh-body');
  const main = el('div', 'wh-main');
  const hud = el('div', 'wh-hud');
  const scoreStat = el('div', 'wh-stat');
  const scoreVal = el('b', '', '0');
  scoreStat.append(scoreVal, el('span', '', 'SCORE'));
  const timerStat = el('div', 'wh-stat wh-timer');
  const timerVal = el('b', '', '1:20');
  timerStat.append(timerVal, el('span', '', 'TIME'));
  const countStat = el('div', 'wh-stat');
  const countVal = el('b', '', '0');
  countStat.append(countVal, el('span', '', 'WORDS'));
  hud.append(scoreStat, timerStat, countStat);
  const wordBar = el('div', 'wh-word');
  const lettersEl = el('span', 'wh-letters empty', '·');
  const gainEl = el('span', 'wh-gain');
  wordBar.append(lettersEl, gainEl);
  const board = el('div', 'wh-board');
  const canvas = document.createElement('canvas');
  board.append(canvas);
  main.append(hud, wordBar, board);

  const side = el('div', 'wh-side');
  const wordsHead = el('div', 'wh-head');
  const wordsTitle = el('span', 'wh-title', 'YOUR WORDS');
  const wordsSub = el('span', 'wh-sub');
  wordsHead.append(wordsTitle, wordsSub);
  const wordsEl = el('ul', 'wh-mywords');
  const scoreHead = el('div', 'wh-head');
  scoreHead.append(el('span', 'wh-title', 'SCORES'), el('span', 'wh-sub', 'pts · words · wins'));
  const scoresEl = el('ul', 'wh-scores');
  side.append(scoreHead, scoresEl, wordsHead, wordsEl);
  body.append(main, side);
  const hint = el('p', 'wh-hint', 'Swipe through touching letters (any direction, each tile once) to make words of 3+ letters. 3=100 · 4=400 · 5=800 · 6=1400 · 7=1800 · 8+=2200. Everyone plays the same grid — highest score wins.');
  root.append(top, botBar.el, body, hint);
  container.appendChild(root);

  let view = null;
  let roundSeen = null;
  let cell = 80;
  let gap = 10;
  let cssW = 0;
  let cctx = null;
  let path = [];
  let dragging = false;
  let flash = null; // { path, color, t } after a submit
  let shown = null; // { path, t } word traced from the results list
  let pickedPlayer = null; // results: whose words the side list shows
  let freshWord = null;
  let seq = 0;
  const pending = new Map(); // seq -> path
  let lastTick = '';
  let rafId = 0;
  let wordTimer = 0;

  function startRound() {
    if (view && view.phase === 'playing') return;
    sfx.play('select');
    api.sendAction({ kind: 'start' });
  }

  // --- layout
  function layout() {
    const cw = root.clientWidth || container.clientWidth || 600;
    const avail = Math.min(cw - 28, 400);
    const next = Math.max(56, Math.min(88, Math.floor((avail - 3 * 10) / N)));
    if (next === cell && cctx) return;
    cell = next;
    gap = Math.round(cell * 0.13);
    cssW = cell * N + gap * (N - 1);
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

  const tileXY = (i) => [(i % N) * (cell + gap), Math.floor(i / N) * (cell + gap)];
  const centerOf = (i) => { const [x, y] = tileXY(i); return [x + cell / 2, y + cell / 2]; };

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  const canPlay = () => view && view.phase === 'playing' && view.grid && clock.now() >= view.startedAt && clock.now() < view.endsAt;

  function draw() {
    if (!cctx) layout();
    const ctx = cctx;
    const now = performance.now();
    ctx.clearRect(0, 0, cssW, cssW);
    fx.applyShake(ctx);
    const grid = view && view.grid ? view.grid : null;
    const counting = view && view.phase === 'playing' && clock.now() < view.startedAt;

    // Which tiles are highlighted, and in what colour.
    let hl = null;
    let hlColor = '#ffd23f';
    if (dragging && path.length) { hl = path; hlColor = '#ffd23f'; }
    else if (flash && now - flash.t < 450) { hl = flash.path; hlColor = flash.color; }
    else if (shown) { hl = shown.path; hlColor = '#00eaff'; }
    const hlSet = new Set(hl || []);

    for (let i = 0; i < N * N; i++) {
      const [x, y] = tileXY(i);
      const on = hlSet.has(i);
      const lift = on ? 2 : 0;
      // shadow / edge
      roundRect(ctx, x, y + 3, cell, cell, cell * 0.16);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fill();
      roundRect(ctx, x, y - lift, cell, cell, cell * 0.16);
      const g = ctx.createLinearGradient(0, y - lift, 0, y - lift + cell);
      if (on) { g.addColorStop(0, '#fffbe6'); g.addColorStop(1, hlColor); }
      else if (grid && !counting) { g.addColorStop(0, '#fff3d2'); g.addColorStop(1, '#e8cf98'); }
      else { g.addColorStop(0, '#3a4a36'); g.addColorStop(1, '#263222'); }
      ctx.fillStyle = g;
      ctx.fill();
      if (on) { ctx.shadowColor = hlColor; ctx.shadowBlur = 14; ctx.lineWidth = 2.5; ctx.strokeStyle = hlColor; ctx.stroke(); ctx.shadowBlur = 0; }
      let ch = grid ? grid[i] : 'WORDHUNT????????'[i];
      if (counting) ch = String.fromCharCode(65 + ((i * 7 + Math.floor(now / 90)) % 26));
      ctx.fillStyle = grid && !counting ? '#2a1a08' : 'rgba(57,255,20,0.35)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `bold ${Math.round(cell * 0.55)}px "Arial Rounded MT Bold", "Trebuchet MS", system-ui, sans-serif`;
      if (ch !== '?') ctx.fillText(ch.toUpperCase(), x + cell / 2, y - lift + cell / 2 + 2);
    }

    // The swipe line.
    if (hl && hl.length > 1) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = hlColor;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = cell * 0.2;
      ctx.beginPath();
      hl.forEach((i, k) => { const [x, y] = centerOf(i); if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.stroke();
      ctx.restore();
      const [sx, sy] = centerOf(hl[0]);
      ctx.beginPath();
      ctx.arc(sx, sy, cell * 0.13, 0, Math.PI * 2);
      ctx.fillStyle = hlColor;
      ctx.globalAlpha = 0.8;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    if (!grid) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, cssW / 2 - 24, cssW, 48);
      ctx.fillStyle = '#39ff14';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `bold ${Math.max(13, Math.round(cssW / 22))}px "Courier New", monospace`;
      ctx.fillText('PRESS START TO PLAY', cssW / 2, cssW / 2);
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

  // --- input: a tile only "catches" the pointer near its centre, so diagonal swipes between
  // two tiles don't clip a neighbour.
  function tileAt(ev, strict) {
    const rect = canvas.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * cssW;
    const y = ((ev.clientY - rect.top) / rect.height) * cssW;
    const pitch = cell + gap;
    const c = Math.floor(x / pitch);
    const r = Math.floor(y / pitch);
    if (r < 0 || r >= N || c < 0 || c >= N) return -1;
    const [cx, cy] = centerOf(r * N + c);
    const d = Math.hypot(x - cx, y - cy);
    if (d > cell * (strict ? 0.42 : 0.6)) return -1;
    return r * N + c;
  }

  function wordOf(p) { return p.map((i) => view.grid[i]).join(''); }

  function updateWordBar(state, text, gain) {
    clearTimeout(wordTimer);
    lettersEl.className = `wh-letters ${state || ''}`;
    lettersEl.textContent = text ? text.toUpperCase() : '·';
    if (!text) lettersEl.classList.add('empty');
    gainEl.textContent = gain || '';
  }

  canvas.addEventListener('pointerdown', (ev) => {
    if (!canPlay()) return;
    const i = tileAt(ev, false);
    if (i < 0) return;
    ev.preventDefault();
    canvas.setPointerCapture(ev.pointerId);
    dragging = true;
    shown = null;
    path = [i];
    sfx.play('blip');
    updateWordBar('', wordOf(path));
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!dragging) return;
    const i = tileAt(ev, true);
    if (i < 0) return;
    const next = extendPath(path, i);
    if (next !== path && next.length !== path.length) {
      path = next;
      sfx.play('tick');
      const w = wordOf(path);
      const mine = myWords();
      updateWordBar(mine.includes(w) ? 'dupe' : '', w);
    }
  });
  const endDrag = (ev) => {
    if (!dragging) return;
    dragging = false;
    if (ev && canvas.hasPointerCapture && canvas.hasPointerCapture(ev.pointerId)) canvas.releasePointerCapture(ev.pointerId);
    const p = path;
    path = [];
    if (!canPlay() || p.length < 3) {
      if (p.length) updateWordBar('', '');
      return;
    }
    const w = wordOf(p);
    if (myWords().includes(w)) {
      flash = { path: p, color: '#ffd23f', t: performance.now() };
      updateWordBar('dupe', w, 'already found');
      sfx.play('error');
      fadeWordBar();
      return;
    }
    seq += 1;
    pending.set(seq, p);
    api.sendAction({ kind: 'submit', path: p, seq });
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', () => { dragging = false; path = []; updateWordBar('', ''); });

  function fadeWordBar() {
    clearTimeout(wordTimer);
    wordTimer = setTimeout(() => updateWordBar('', ''), 900);
  }

  function onResult(data) {
    const p = pending.get(data.seq) || [];
    pending.delete(data.seq);
    const now = performance.now();
    if (data.outcome === 'found') {
      flash = { path: p, color: '#39ff14', t: now };
      updateWordBar('ok', data.word, `+${data.points}`);
      freshWord = data.word;
      const long = data.word.length >= 5;
      sfx.play(long ? 'chime' : 'point');
      if (p.length) {
        const [x, y] = centerOf(p[p.length - 1]);
        fx.burst(x, y, long ? '#ffd23f' : '#39ff14', { count: long ? 34 : 18, speed: long ? 220 : 150, life: 0.6 });
        fx.text(x, y - cell * 0.4, `+${data.points}`, '#ffd23f', { size: long ? 20 : 15, life: 0.9 });
      }
      if (data.word.length >= 6) { fx.shake(3); fx.bigLabel(data.word.length >= 8 ? 'INCREDIBLE!' : 'AWESOME!', '#ffd23f'); }
    } else if (data.outcome === 'already') {
      flash = { path: p, color: '#ffd23f', t: now };
      updateWordBar('dupe', data.word, 'already found');
      sfx.play('error');
    } else if (data.outcome === 'invalid') {
      flash = { path: p, color: '#ff4d4d', t: now };
      updateWordBar('bad', data.word, 'not a word');
      sfx.play('error');
    } else {
      updateWordBar('', '');
    }
    fadeWordBar();
  }

  // --- panels
  const me = () => api.getClientId();
  const myPlayer = () => (view ? view.players.find((p) => p.clientId === me()) : null);
  const myWords = () => { const p = myPlayer(); return (p && p.words) || []; };

  function renderStatus() {
    if (!view) { statusEl.textContent = 'Loading…'; return; }
    const humans = view.players.filter((p) => !p.bot).length;
    if (view.phase === 'waiting') statusEl.textContent = `${humans} player${humans === 1 ? '' : 's'} here — add a bot or wait for friends, then START.`;
    else if (view.phase === 'playing') statusEl.textContent = clock.now() < view.startedAt ? 'Get ready…' : 'Find as many words as you can!';
    else statusEl.textContent = `Round over — ${view.totalWords} words were hiding in this grid.`;
    startBtn.disabled = view.phase === 'playing';
    startBtn.textContent = view.phase === 'results' ? 'NEW GRID' : 'START';
  }

  function chip(word, cls, onClick) {
    const li = el('li', `wh-chip ${cls || ''}`, word.toUpperCase());
    if (word.length >= 6) li.classList.add('long');
    if (onClick) {
      li.classList.add('clickable');
      li.addEventListener('click', onClick);
    }
    return li;
  }

  function renderWords() {
    wordsEl.textContent = '';
    if (!view) return;
    const over = view.phase === 'results';
    if (!over) {
      const words = myWords().slice().reverse();
      wordsTitle.textContent = 'YOUR WORDS';
      wordsSub.textContent = words.length ? `${words.length} found` : '';
      if (!words.length) wordsEl.appendChild(el('li', 'wh-empty', view.phase === 'playing' ? 'Swipe the grid to find words…' : 'No words yet.'));
      for (const w of words) wordsEl.appendChild(chip(w, w === freshWord ? 'fresh' : ''));
      freshWord = null;
      return;
    }
    // Results: the picked player's words, or every word in the grid.
    const byWord = new Map((view.allWords || []).map((x) => [x.word, x.path]));
    const traced = (w) => () => { shown = shown && shown.word === w ? null : { word: w, path: byWord.get(w) || [] }; sfx.play('click'); renderWords(); };
    const pick = pickedPlayer && view.players.find((p) => p.clientId === pickedPlayer);
    if (pick) {
      const words = (pick.words || []).slice().sort((a, b) => b.length - a.length || a.localeCompare(b));
      wordsTitle.textContent = pick.clientId === me() ? 'YOUR WORDS' : `${pick.nickname.toUpperCase()}'S WORDS`;
      wordsSub.textContent = `${words.length} · tap to trace`;
      const others = new Set(view.players.filter((p) => p.clientId !== pick.clientId).flatMap((p) => p.words || []));
      for (const w of words) wordsEl.appendChild(chip(w, `${others.has(w) ? 'shared' : ''} ${shown && shown.word === w ? 'sel' : ''}`, traced(w)));
      if (!words.length) wordsEl.appendChild(el('li', 'wh-empty', 'No words this round.'));
    } else {
      const mine = new Set(myWords());
      const all = view.allWords || [];
      wordsTitle.textContent = 'ALL WORDS';
      wordsSub.textContent = `you found ${mine.size}/${all.length} · tap to trace`;
      for (const x of all) wordsEl.appendChild(chip(x.word, `${mine.has(x.word) ? '' : 'missed'} ${shown && shown.word === x.word ? 'sel' : ''}`, traced(x.word)));
    }
    if (shown) {
      const def = el('a', null, `📖 What does ${shown.word.toUpperCase()} mean?`);
      Object.assign(def, { href: `https://en.wiktionary.org/wiki/${encodeURIComponent(shown.word)}`, target: '_blank', rel: 'noopener' });
      const li = el('li', 'wh-empty');
      li.style.cssText = 'width:100%;opacity:1';
      li.appendChild(def);
      wordsEl.appendChild(li);
    }
  }

  function renderScores() {
    scoresEl.textContent = '';
    if (!view) return;
    const over = view.phase === 'results';
    const list = view.players.slice().sort((a, b) => b.score - a.score || b.wins - a.wins);
    const topScore = list.length ? list[0].score : 0;
    if (over) {
      const all = el('li', `wh-score pick ${!pickedPlayer ? 'picked' : ''}`);
      all.append(el('span', 'wh-name', '📜 All words in the grid'));
      all.addEventListener('click', () => { pickedPlayer = null; shown = null; renderScores(); renderWords(); });
      scoresEl.appendChild(all);
    }
    for (const p of list) {
      const li = el('li', 'wh-score');
      if (topScore > 0 && p.score === topScore) li.classList.add('lead');
      if (p.clientId === me()) li.classList.add('you');
      const dot = el('span', 'wh-dot');
      dot.style.background = p.color;
      dot.style.color = p.color;
      const crown = topScore > 0 && p.score === topScore ? '👑 ' : '';
      li.append(dot, el('span', 'wh-name', `${crown}${p.nickname}${p.clientId === me() ? ' (you)' : ''}`),
        el('span', 'wh-pts', `${p.score}`), el('span', 'wh-cnt', `${p.count}w · ${p.wins}🏆`));
      if (over) {
        li.classList.add('pick');
        if (pickedPlayer === p.clientId) li.classList.add('picked');
        li.addEventListener('click', () => { pickedPlayer = p.clientId; shown = null; renderScores(); renderWords(); });
      }
      scoresEl.appendChild(li);
    }
  }

  function renderHud() {
    const p = myPlayer();
    scoreVal.textContent = p ? String(p.score) : '0';
    countVal.textContent = p ? String(p.count) : '0';
  }

  function renderTimer() {
    if (!view || !view.startedAt || view.phase === 'waiting') {
      timerVal.textContent = '1:20';
      timerStat.classList.remove('low');
      return;
    }
    if (view.phase === 'results') {
      timerVal.textContent = '0:00';
      timerStat.classList.remove('low');
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
        renderStatus();
      }
      timerVal.textContent = fmtClock(view.endsAt - view.startedAt);
      return;
    }
    if (lastTick.startsWith(`c${view.roundId}-`)) {
      lastTick = `go${view.roundId}`;
      sfx.play('go');
      fx.bigLabel('GO!', '#39ff14');
      renderStatus();
    }
    const left = view.endsAt - now;
    timerVal.textContent = fmtClock(left);
    timerStat.classList.toggle('low', left <= 10000);
    const secs = Math.ceil(left / 1000);
    if (secs <= 5 && secs > 0 && lastTick !== `t${view.roundId}-${secs}`) {
      lastTick = `t${view.roundId}-${secs}`;
      sfx.play('tick');
    }
  }

  function renderResults() {
    if (!view || view.phase !== 'results') { results.update(null); return; }
    const players = view.players.filter((p) => p.inRound).sort((a, b) => b.score - a.score);
    const topScore = players.length ? players[0].score : 0;
    const mine = players.find((p) => p.clientId === me());
    const solo = players.length <= 1;
    let outcome = 'over';
    let title = "TIME'S UP";
    if (mine && !solo) {
      const iWon = topScore > 0 && mine.score === topScore;
      outcome = iWon ? 'win' : 'lose';
      title = iWon ? (players.filter((p) => p.score === topScore).length > 1 ? 'TIED FOR FIRST!' : 'YOU WIN!') : 'YOU LOSE';
    } else if (mine) outcome = mine.score > 0 ? 'win' : 'lose';
    const best = (p) => (p.words || []).reduce((b, w) => (w.length > b.length ? w : b), '');
    results.update({
      title,
      subtitle: `${view.totalWords} words in the grid${mine ? ` · you found ${mine.count}` : ''}`,
      outcome,
      rows: players.map((p) => ({
        name: p.nickname,
        value: `${p.score} · ${p.count}w${best(p) ? ` · ${best(p).toUpperCase()}` : ''}`,
        win: topScore > 0 && p.score === topScore,
        you: p.clientId === me(),
      })),
      rematch: { label: 'NEW GRID', onClick: () => startRound() },
    });
  }

  function onState(data) {
    const prev = view;
    view = data;
    clock.sync(view.serverNow);
    if (view.roundId !== roundSeen) {
      roundSeen = view.roundId;
      path = [];
      dragging = false;
      flash = null;
      shown = null;
      pickedPlayer = null;
      pending.clear();
      updateWordBar('', '');
    }
    if (prev && prev.phase === 'playing' && view.phase === 'results') {
      dragging = false;
      path = [];
      const mine = view.players.find((p) => p.clientId === me() && p.inRound);
      const topScore = Math.max(0, ...view.players.filter((p) => p.inRound).map((p) => p.score));
      if (mine) sfx.play(mine.score === topScore && topScore > 0 ? 'win' : 'lose');
      fx.bigLabel("TIME'S UP", '#ffd23f');
    }
    render();
  }

  function render() {
    renderStatus();
    renderHud();
    renderScores();
    renderWords();
    renderResults();
    if (view) botBar.update(view.players);
  }

  layout();
  rafId = requestAnimationFrame(frame);

  return {
    applySnapshot(snapshot) {
      if (snapshot) onState({ ...snapshot, kind: 'state' });
    },
    applyEvent(data) {
      if (!data) return;
      if (data.kind === 'state') onState(data);
      else if (data.kind === 'result') onResult(data);
    },
    applyRoster() { /* names come from the server's player list */ },
    unmount() {
      cancelAnimationFrame(rafId);
      clearTimeout(wordTimer);
      if (ro) ro.disconnect();
      else window.removeEventListener('resize', layout);
      results.destroy();
      container.innerHTML = '';
    },
  };
}
