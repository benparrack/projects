// Word Bites — drag letter pieces around your own 8x9 board to build words that read
// left-to-right or top-to-bottom. Singles, horizontal pairs and vertical pairs; pieces don't
// rotate. Every new word of 3+ letters scores (longer = much more); 80 seconds, highest total
// wins. Everyone gets the same pieces but plays on a private board.
// Server plugin: ../../../server/games/wordbites.js (authoritative: validates each drop and
// scores the complete runs through the moved piece).
import { sfx } from '../sfx.js';
import { createBotBar } from '../tickBots.js';
import { createResults } from '../resultsPanel.js';
import { makeServerClock } from '../serverClock.js';

const CSS = `
.wb-root { display: flex; flex-direction: column; gap: 8px; }
.wb-root [hidden] { display: none !important; }
.wb-top { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.wb-status { font-weight: bold; }
.wb-timer { font-size: 1.5em; font-weight: bold; letter-spacing: 1px; color: #39ff14; font-variant-numeric: tabular-nums; }
.wb-timer.low { color: #ff4d4d; animation: wb-blink 1s steps(2) infinite; }
@keyframes wb-blink { 50% { opacity: .55; } }
.wb-controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.wb-start { font-weight: bold; }
.wb-body { display: flex; gap: 14px; align-items: flex-start; flex-wrap: wrap; }
.wb-boardwrap { position: relative; flex: none; padding: 8px; border: 1px solid var(--border, #1f8f0c); border-radius: 8px;
  background: radial-gradient(circle at 50% 30%, #10240f, #040804); box-shadow: inset 0 0 34px -12px #39ff14; }
.wb-board { position: relative; touch-action: none; user-select: none; -webkit-user-select: none; }
.wb-cell { position: absolute; box-sizing: border-box; border-radius: 5px; background: rgba(57,255,20,.045);
  border: 1px solid rgba(57,255,20,.09); }
.wb-cell.flash { animation: wb-flash .9s ease-out; }
@keyframes wb-flash { 0% { background: rgba(255,210,63,.75); box-shadow: 0 0 16px #ffd23f; } 100% { background: rgba(57,255,20,.045); } }
.wb-piece { position: absolute; box-sizing: border-box; display: flex; border-radius: 7px; cursor: grab;
  background: linear-gradient(180deg, #fff6d8, #f0d9a0); border: 2px solid #b8913c; color: #2b1d05;
  box-shadow: 0 3px 0 #8a6a25, 0 4px 8px rgba(0,0,0,.5); font-weight: bold; touch-action: none;
  transition: left .14s ease-out, top .14s ease-out, transform .12s; z-index: 2; }
.wb-piece.v { flex-direction: column; }
.wb-piece span { flex: 1; display: flex; align-items: center; justify-content: center; text-transform: uppercase; }
.wb-piece.h span + span { border-left: 1px dashed rgba(138,106,37,.55); }
.wb-piece.v span + span { border-top: 1px dashed rgba(138,106,37,.55); }
.wb-piece.drag { transition: none; cursor: grabbing; transform: scale(1.08); z-index: 5; box-shadow: 0 8px 16px rgba(0,0,0,.6), 0 0 14px #ffd23f; }
.wb-piece.inword { background: linear-gradient(180deg, #e6ffd8, #b8f0a0); border-color: #3c9b2a; box-shadow: 0 3px 0 #2a6a1f, 0 4px 8px rgba(0,0,0,.5); }
.wb-piece.locked { cursor: default; }
.wb-ghost { position: absolute; box-sizing: border-box; border: 2px dashed #39ff14; border-radius: 7px; pointer-events: none; z-index: 1; }
.wb-ghost.bad { border-color: #ff4d4d; }
.wb-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; text-align: center;
  font-weight: bold; color: #e9ffe0; background: rgba(0,0,0,.55); border-radius: 8px; z-index: 8; pointer-events: none; padding: 10px; }
.wb-overlay.count { font-size: 64px; color: #ffd23f; text-shadow: 0 0 20px #ffd23f; background: rgba(0,0,0,.35); }
.wb-overlay[hidden] { display: none; }
.wb-pop { position: absolute; z-index: 9; pointer-events: none; font-weight: bold; color: #ffd23f; white-space: nowrap;
  text-shadow: 0 0 8px #000, 0 0 12px #ffd23f; transform: translate(-50%, -50%); animation: wb-pop 1.3s ease-out forwards; }
@keyframes wb-pop { 0% { opacity: 0; transform: translate(-50%, -20%) scale(.6); } 15% { opacity: 1; transform: translate(-50%, -50%) scale(1.15); }
  100% { opacity: 0; transform: translate(-50%, -160%) scale(1); } }
.wb-side { flex: 1; min-width: 170px; display: flex; flex-direction: column; gap: 10px; }
.wb-head { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid var(--border, #1f8f0c); padding-bottom: 3px; }
.wb-title { font-weight: bold; letter-spacing: 1px; color: #ffb000; }
.wb-sub { font-size: .85em; opacity: .8; }
.wb-myscore { font-size: 2em; font-weight: bold; color: #ffd23f; font-variant-numeric: tabular-nums; text-shadow: 0 0 10px rgba(255,210,63,.4); }
.wb-words { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px; max-height: 190px; overflow-y: auto; }
.wb-words li { padding: 1px 7px; border: 1px solid rgba(57,255,20,.35); border-radius: 10px; font-size: .85em; text-transform: uppercase; }
.wb-words li.fresh { animation: wb-fresh .6s ease-out; }
@keyframes wb-fresh { from { background: #ffd23f; color: #000; } }
.wb-words li.missed { opacity: .55; border-style: dashed; }
.wb-scores { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.wb-scores li { display: flex; gap: 8px; align-items: center; padding: 3px 6px; border-radius: 4px; background: rgba(57,255,20,.05); }
.wb-scores .dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
.wb-scores .nm { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wb-scores .pts { font-weight: bold; font-variant-numeric: tabular-nums; }
.wb-scores li.me { outline: 1px solid rgba(57,255,20,.5); }
.wb-hint { font-size: .8em; opacity: .7; margin: 0; }
.wb-toast { min-height: 1.2em; font-size: .9em; transition: opacity .3s; opacity: 0; }
@media (prefers-reduced-motion: reduce) { .wb-piece, .wb-pop, .wb-cell.flash, .wb-words li.fresh, .wb-timer.low { transition: none; animation: none; } }
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
const pieceSize = (pc) => (pc.kind === 'h' ? [1, 2] : pc.kind === 'v' ? [2, 1] : [1, 1]); // [rows, cols]

// Board letters for an arrangement. Exported for tests.
export function gridOf(pieces, pos, rows, cols) {
  const g = Array.from({ length: rows }, () => Array(cols).fill(null));
  for (const pc of pieces) {
    const p = pos[pc.id];
    if (!p) continue;
    const [h, w] = pieceSize(pc);
    for (let k = 0; k < Math.max(h, w); k++) {
      const r = p[0] + (pc.kind === 'v' ? k : 0);
      const c = p[1] + (pc.kind === 'h' ? k : 0);
      if (r < rows && c < cols) g[r][c] = { ch: pc.letters[k], id: pc.id };
    }
  }
  return g;
}

// Can piece `pc` sit with its top-left at (r, c) given the other pieces? Exported for tests.
export function canPlace(pieces, pos, pc, r, c, rows, cols) {
  const [h, w] = pieceSize(pc);
  if (r < 0 || c < 0 || r + h > rows || c + w > cols) return false;
  const g = gridOf(pieces, pos, rows, cols);
  for (let dr = 0; dr < h; dr++) for (let dc = 0; dc < w; dc++) {
    const cell = g[r + dr][c + dc];
    if (cell && cell.id !== pc.id) return false;
  }
  return true;
}

export function mount(container, api) {
  ensureStyles();
  const clock = makeServerClock();
  const results = createResults(container);

  const root = el('div', 'wb-root');
  const top = el('div', 'wb-top');
  const statusEl = el('div', 'wb-status', 'Loading…');
  const timerEl = el('div', 'wb-timer');
  top.append(statusEl, timerEl);
  const controls = el('div', 'wb-controls');
  const startBtn = el('button', 'wb-start', 'START');
  startBtn.addEventListener('click', () => startRound());
  controls.append(startBtn);
  const botBar = createBotBar(api);

  const body = el('div', 'wb-body');
  const wrap = el('div', 'wb-boardwrap');
  const board = el('div', 'wb-board');
  const overlay = el('div', 'wb-overlay');
  wrap.append(board, overlay);
  const side = el('div', 'wb-side');
  const meHead = el('div', 'wb-head');
  meHead.append(el('span', 'wb-title', 'YOUR SCORE'), el('span', 'wb-sub'));
  const myScoreEl = el('div', 'wb-myscore', '0');
  const wordsHead = el('div', 'wb-head');
  const wordsCount = el('span', 'wb-sub');
  wordsHead.append(el('span', 'wb-title', 'YOUR WORDS'), wordsCount);
  const wordsEl = el('ul', 'wb-words');
  const bestHead = el('div', 'wb-head');
  bestHead.append(el('span', 'wb-title', 'YOU COULD HAVE MADE'), el('span', 'wb-sub'));
  const bestEl = el('ul', 'wb-words');
  const scoreHead = el('div', 'wb-head');
  scoreHead.append(el('span', 'wb-title', 'PLAYERS'), el('span', 'wb-sub', 'pts · words · wins'));
  const scoresEl = el('ul', 'wb-scores');
  side.append(meHead, myScoreEl, wordsHead, wordsEl, bestHead, bestEl, scoreHead, scoresEl);
  body.append(wrap, side);
  const toastEl = el('div', 'wb-toast');
  const hint = el('p', 'wb-hint', 'Drag the pieces to make words reading left→right or top→bottom. Pieces don\'t rotate. Every new word of 3+ letters scores: 3=100 · 4=400 · 5=800 · 6=1400 · 7=1800 · 8+=2200.');
  root.append(top, controls, botBar.el, body, toastEl, hint);
  container.appendChild(root);

  let view = null;
  let rows = 9;
  let cols = 8;
  let cell = 44;
  let pos = {}; // my local arrangement (optimistic)
  let roundSeen = null;
  let seq = 0;
  let drag = null; // { pc, node, dx, dy, pointerId, target:[r,c]|null }
  const pieceNodes = new Map();
  let cellNodes = [];
  let ghost = null;
  let knownWords = new Set();
  let lastTickKey = '';
  let goRound = null;
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
    api.sendAction({ kind: 'start' });
  }

  const playing = () => view && view.phase === 'playing' && clock.now() >= view.startedAt && clock.now() < view.endsAt;

  // --- layout -------------------------------------------------------------------------------------
  function layout() {
    const avail = Math.max(220, Math.min(container.clientWidth || 600, window.innerWidth) - 40);
    const byW = Math.floor((avail - 4) / cols);
    const byH = Math.floor((window.innerHeight * 0.72) / rows);
    const next = Math.max(30, Math.min(54, byW, byH));
    // ResizeObserver also fires when the side panel grows; only rebuild when the cell size changes.
    if (next === cell && cellNodes.length === rows * cols) return;
    cell = next;
    board.style.width = `${cols * cell}px`;
    board.style.height = `${rows * cell}px`;
    board.style.fontSize = `${Math.round(cell * 0.5)}px`;
    for (const n of cellNodes) n.remove();
    cellNodes = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const n = el('div', 'wb-cell');
        Object.assign(n.style, { left: `${c * cell + 2}px`, top: `${r * cell + 2}px`, width: `${cell - 4}px`, height: `${cell - 4}px` });
        board.appendChild(n);
        cellNodes.push(n);
      }
    }
    for (const n of pieceNodes.values()) n.remove();
    pieceNodes.clear();
    renderPieces();
  }

  function placeNode(node, pc, r, c) {
    const [h, w] = pieceSize(pc);
    Object.assign(node.style, { left: `${c * cell + 2}px`, top: `${r * cell + 2}px`, width: `${w * cell - 4}px`, height: `${h * cell - 4}px` });
  }

  function renderPieces() {
    const pieces = view && view.pieces ? view.pieces : [];
    const ids = new Set(pieces.map((p) => p.id));
    for (const [id, n] of pieceNodes) if (!ids.has(id)) { n.remove(); pieceNodes.delete(id); }
    for (const pc of pieces) {
      let node = pieceNodes.get(pc.id);
      if (!node || node.dataset.letters !== pc.letters) {
        if (node) node.remove();
        node = el('div', `wb-piece ${pc.kind}`);
        node.dataset.letters = pc.letters;
        for (const ch of pc.letters) node.appendChild(el('span', '', ch));
        node.addEventListener('pointerdown', (e) => onDown(e, pc, node));
        board.appendChild(node);
        pieceNodes.set(pc.id, node);
      }
      node.classList.toggle('locked', !playing());
      if (drag && drag.pc.id === pc.id) continue;
      const p = pos[pc.id];
      if (p) placeNode(node, pc, p[0], p[1]);
    }
    markWords();
  }

  // Tint pieces that are part of a complete run you've already scored.
  function markWords() {
    if (!view || !view.pieces) return;
    const g = gridOf(view.pieces, pos, rows, cols);
    const lit = new Set();
    const mine = new Set((view.myWords || []).map((w) => w.word));
    for (const [dr, dc] of [[0, 1], [1, 0]]) {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (!g[r][c]) continue;
          if (r - dr >= 0 && c - dc >= 0 && g[r - dr][c - dc]) continue; // not a run start
          let word = '';
          const ids = [];
          let rr = r; let cc = c;
          while (rr < rows && cc < cols && g[rr][cc]) { word += g[rr][cc].ch; ids.push(g[rr][cc].id); rr += dr; cc += dc; }
          if (word.length >= 3 && mine.has(word)) ids.forEach((id) => lit.add(id));
        }
      }
    }
    for (const [id, n] of pieceNodes) n.classList.toggle('inword', lit.has(id));
  }

  // --- dragging -----------------------------------------------------------------------------------
  function boardXY(e) {
    const rect = board.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  function onDown(e, pc, node) {
    if (!playing() || drag || !pos[pc.id]) return;
    e.preventDefault();
    const [x, y] = boardXY(e);
    const p = pos[pc.id];
    drag = { pc, node, dx: x - p[1] * cell, dy: y - p[0] * cell, pointerId: e.pointerId, target: null };
    try { node.setPointerCapture(e.pointerId); } catch { /* old browsers */ }
    node.classList.add('drag');
    sfx.play('blip');
    node.addEventListener('pointermove', onMove);
    node.addEventListener('pointerup', onUp);
    node.addEventListener('pointercancel', onCancel);
  }

  function targetFor(x, y) {
    const r = Math.round((y - drag.dy) / cell);
    const c = Math.round((x - drag.dx) / cell);
    return [r, c];
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const [x, y] = boardXY(e);
    const [h, w] = pieceSize(drag.pc);
    const left = Math.max(-cell * 0.5, Math.min(cols * cell - w * cell + cell * 0.5, x - drag.dx));
    const topY = Math.max(-cell * 0.5, Math.min(rows * cell - h * cell + cell * 0.5, y - drag.dy));
    drag.node.style.left = `${left + 2}px`;
    drag.node.style.top = `${topY + 2}px`;
    const [r, c] = targetFor(left + drag.dx, topY + drag.dy);
    const ok = canPlace(view.pieces, pos, drag.pc, r, c, rows, cols);
    const inBounds = r >= 0 && c >= 0 && r + h <= rows && c + w <= cols;
    drag.target = ok ? [r, c] : null;
    if (!ghost) { ghost = el('div', 'wb-ghost'); board.appendChild(ghost); }
    ghost.hidden = !inBounds;
    ghost.classList.toggle('bad', !ok);
    Object.assign(ghost.style, { left: `${c * cell + 2}px`, top: `${r * cell + 2}px`, width: `${w * cell - 4}px`, height: `${h * cell - 4}px` });
  }

  function endDrag() {
    if (!drag) return;
    const { node } = drag;
    node.classList.remove('drag');
    node.removeEventListener('pointermove', onMove);
    node.removeEventListener('pointerup', onUp);
    node.removeEventListener('pointercancel', onCancel);
    if (ghost) { ghost.remove(); ghost = null; }
  }

  function onUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    onMove(e);
    const { pc, target } = drag;
    endDrag();
    drag = null;
    const old = pos[pc.id];
    if (target && playing() && (target[0] !== old[0] || target[1] !== old[1])) {
      pos[pc.id] = target;
      seq += 1;
      api.sendAction({ kind: 'move', id: pc.id, r: target[0], c: target[1], seq });
      sfx.play('move');
    } else if (!target) sfx.play('error');
    renderPieces();
  }

  function onCancel(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    endDrag();
    drag = null;
    renderPieces();
  }

  // --- scoring feedback ---------------------------------------------------------------------------
  function celebrate(scored) {
    let delay = 0;
    for (const s of scored) {
      const len = s.word.length;
      for (let k = 0; k < len; k++) {
        const r = s.r + (s.dir === 'v' ? k : 0);
        const c = s.c + (s.dir === 'h' ? k : 0);
        const n = cellNodes[r * cols + c];
        if (n) { n.classList.remove('flash'); void n.offsetWidth; n.classList.add('flash'); }
      }
      const midR = s.r + (s.dir === 'v' ? (len - 1) / 2 : 0);
      const midC = s.c + (s.dir === 'h' ? (len - 1) / 2 : 0);
      setTimeout(() => {
        const pop = el('div', 'wb-pop', `${s.word.toUpperCase()} +${s.pts}`);
        pop.style.left = `${(midC + 0.5) * cell}px`;
        pop.style.top = `${(midR + 0.5) * cell}px`;
        pop.style.fontSize = `${Math.min(26, 13 + len * 1.6)}px`;
        board.appendChild(pop);
        setTimeout(() => pop.remove(), 1400);
      }, delay);
      delay += 220;
    }
    sfx.play(scored.some((s) => s.word.length >= 6) ? 'chime' : 'point');
  }

  // --- rendering ----------------------------------------------------------------------------------
  function renderStatus() {
    if (!view) return;
    const now = clock.now();
    const players = view.players.length;
    if (view.phase === 'waiting') {
      statusEl.textContent = players > 1 ? 'Press START when everyone is ready.' : 'Press START to play — or add a bot to race.';
    } else if (view.phase === 'playing') {
      statusEl.textContent = now < view.startedAt ? 'Get ready…' : `${view.myWords.length} word${view.myWords.length === 1 ? '' : 's'} · ${view.totalWords} possible`;
    } else statusEl.textContent = 'Round over.';
    startBtn.textContent = view.phase === 'waiting' ? 'START' : 'NEW ROUND';
    startBtn.disabled = view.phase === 'playing';
  }

  function renderWords() {
    const words = view ? view.myWords || [] : [];
    wordsEl.textContent = '';
    for (const w of words.slice().reverse()) {
      const li = el('li', '', `${w.word} ${w.pts}`);
      if (!knownWords.has(w.word)) li.classList.add('fresh');
      wordsEl.appendChild(li);
    }
    knownWords = new Set(words.map((w) => w.word));
    wordsCount.textContent = String(words.length);
    const mine = view && view.players.find((p) => p.clientId === api.getClientId());
    myScoreEl.textContent = String(mine ? mine.score : 0);
    const best = view && view.bestWords;
    bestHead.hidden = !best;
    bestEl.hidden = !best;
    bestEl.textContent = '';
    if (best) {
      const got = new Set(words.map((w) => w.word));
      for (const w of best) {
        const li = el('li', got.has(w) ? '' : 'missed', w);
        bestEl.appendChild(li);
      }
    }
  }

  function renderScores() {
    scoresEl.textContent = '';
    if (!view) return;
    const me = api.getClientId();
    const ps = view.players.slice().sort((a, b) => b.score - a.score);
    for (const p of ps) {
      const li = el('li', p.clientId === me ? 'me' : '');
      const dot = el('span', 'dot');
      dot.style.background = p.color;
      li.append(dot, el('span', 'nm', p.nickname), el('span', 'pts', `${p.score} · ${p.count} · ${p.wins} wins`));
      scoresEl.appendChild(li);
    }
  }

  function renderOverlay() {
    const now = clock.now();
    if (!view || view.phase === 'waiting' || !view.pieces.length) {
      overlay.hidden = false;
      overlay.className = 'wb-overlay';
      overlay.textContent = 'WORD BITES\nPress START';
      overlay.style.whiteSpace = 'pre-line';
      overlay.style.background = '';
    } else if (view.phase === 'playing' && now < view.startedAt) {
      overlay.hidden = false;
      overlay.className = 'wb-overlay count';
      overlay.style.background = '';
      overlay.textContent = String(Math.ceil((view.startedAt - now) / 1000));
    } else if (view.phase === 'results') {
      overlay.hidden = false;
      overlay.className = 'wb-overlay';
      overlay.style.background = 'rgba(0,0,0,.25)';
      overlay.textContent = '';
    } else {
      overlay.hidden = true;
      overlay.style.background = '';
    }
  }

  function renderResults() {
    if (!view || view.phase !== 'results') { results.update(null); return; }
    const me = api.getClientId();
    const ps = view.players.filter((p) => p.inRound).sort((a, b) => b.score - a.score);
    const topScore = ps.length ? ps[0].score : 0;
    const mine = ps.find((p) => p.clientId === me);
    let outcome = 'over';
    let title = "TIME'S UP";
    if (mine && ps.length > 1) {
      const won = topScore > 0 && mine.score === topScore;
      outcome = won ? 'win' : 'lose';
      title = won ? (ps.filter((p) => p.score === topScore).length > 1 ? 'TIED FOR FIRST!' : 'YOU WIN!') : 'YOU LOSE';
    } else if (mine) outcome = mine.score > 0 ? 'win' : 'over';
    const longest = mine && mine.words && mine.words.length ? mine.words.reduce((a, b) => (b.word.length > a.word.length ? b : a)).word.toUpperCase() : null;
    results.update({
      title,
      subtitle: longest ? `Your longest word: ${longest}` : `${view.totalWords} words were possible`,
      outcome,
      rows: ps.map((p) => ({ name: p.nickname, value: `${p.score} · ${p.count} word${p.count === 1 ? '' : 's'}`, win: topScore > 0 && p.score === topScore, you: p.clientId === me })),
      rematch: { label: 'NEW ROUND', onClick: () => startRound() },
    });
  }

  function render() {
    renderStatus();
    renderPieces();
    renderWords();
    renderScores();
    renderOverlay();
    renderResults();
    if (view) botBar.update(view.players);
  }

  function frame() {
    rafId = requestAnimationFrame(frame);
    if (!view) return;
    const now = clock.now();
    renderOverlay();
    if (view.phase === 'playing') {
      const started = now >= view.startedAt;
      const left = started ? view.endsAt - now : view.roundMs;
      timerEl.textContent = fmtClock(left);
      timerEl.classList.toggle('low', started && left <= 10000);
      const secs = Math.ceil((started ? left : view.startedAt - now) / 1000);
      if (started && goRound !== view.roundId) {
        // countdown just finished: unlock the pieces
        goRound = view.roundId;
        sfx.play('go');
        renderStatus();
        renderPieces();
      }
      const key = `${view.roundId}-${started}-${secs}`;
      if (secs > 0 && (!started || secs <= 5) && key !== lastTickKey) {
        lastTickKey = key;
        sfx.play(started ? 'tick' : 'beep');
      }
      if (left <= 0 && drag) { endDrag(); drag = null; renderPieces(); }
    } else {
      timerEl.textContent = view.phase === 'results' ? '0:00' : fmtClock(view.roundMs);
      timerEl.classList.remove('low');
    }
  }

  function onState(data) {
    const prev = view;
    view = data;
    clock.sync(view.serverNow);
    if (view.cols !== cols || view.rows !== rows) { cols = view.cols; rows = view.rows; layout(); }
    if (view.roundId !== roundSeen) {
      // New round (or first snapshot): take the server's arrangement wholesale.
      roundSeen = view.roundId;
      pos = view.myPos ? JSON.parse(JSON.stringify(view.myPos)) : {};
      knownWords = new Set((view.myWords || []).map((w) => w.word));
      if (drag) { endDrag(); drag = null; }
    }
    if (prev && prev.phase === 'playing' && view.phase === 'results') {
      const me = view.players.find((p) => p.clientId === api.getClientId() && p.inRound);
      const topScore = Math.max(0, ...view.players.filter((p) => p.inRound).map((p) => p.score));
      if (me) sfx.play(me.score === topScore && topScore > 0 ? 'win' : 'lose');
    }
    render();
  }

  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { if (!drag) layout(); }) : null;
  if (ro) ro.observe(container);
  else window.addEventListener('resize', layout);
  layout();
  rafId = requestAnimationFrame(frame);

  return {
    applySnapshot(snapshot) {
      if (snapshot) onState({ kind: 'state', ...snapshot });
    },
    applyEvent(data) {
      if (!data) return;
      if (data.kind === 'state') onState(data);
      else if (data.kind === 'moved') {
        if (data.scored && data.scored.length) celebrate(data.scored);
      } else if (data.kind === 'moveRejected') {
        // Out of sync (or time ran out): fall back to the server's arrangement.
        if (data.pos) pos = JSON.parse(JSON.stringify(data.pos));
        if (data.reason !== 'time' && data.reason !== 'not_playing') toast("Couldn't move that piece there.", '#ff4d4d');
        sfx.play('error');
        renderPieces();
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
