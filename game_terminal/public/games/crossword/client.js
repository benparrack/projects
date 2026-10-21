// Crossword — generated freeform crosswords with real clues. CO-OP: everyone fills one shared
// grid (each finished word is credited to whoever completed it); RACE: everyone solves their own
// copy of the same puzzle, first to finish wins. Click a cell (click again to switch direction),
// type to fill; Backspace, arrows, Tab / Shift+Tab (next/previous clue) and Space (switch
// direction) work like a real crossword app. Server plugin: ../../../server/games/crossword.js
// (generates the puzzle, checks words and never sends answers before the round is over).
import { sfx } from '../sfx.js';
import { createBotBar } from '../tickBots.js';
import { createResults } from '../resultsPanel.js';
import { makeServerClock } from '../serverClock.js';

const PREF_KEY = 'gt-crossword-prefs';
const PENDING_MS = 2500;

const CSS = `
.cw-root { display: flex; flex-direction: column; gap: 8px; }
.cw-top { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.cw-title { font-weight: bold; letter-spacing: 1px; color: #ffb000; }
.cw-status { font-size: .88em; opacity: .85; }
.cw-timer { font-size: 1.4em; font-weight: bold; letter-spacing: 1px; color: #39ff14; font-variant-numeric: tabular-nums; }
.cw-controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.cw-seg { display: inline-flex; border: 1px solid var(--border, #1f8f0c); border-radius: 4px; overflow: hidden; }
.cw-seg button { border: 0; border-radius: 0; padding: 5px 10px; font-size: .85em; }
.cw-seg button + button { border-left: 1px solid var(--border, #1f8f0c); }
.cw-seg button.on { background: #39ff14; color: #041004; font-weight: bold; }
.cw-seg button:disabled { opacity: .45; }
.cw-label { font-size: .8em; opacity: .75; }
.cw-btn { padding: 5px 12px; font-size: .88em; border-radius: 4px; }
.cw-btn.primary { font-weight: bold; border-color: #39ff14; }
.cw-btn.warn { border-color: #ff5a5a; color: #ff8a8a; }
.cw-btn.warn.armed { background: #ff4d4d; color: #140303; font-weight: bold; }
.cw-body { display: flex; gap: 14px; align-items: flex-start; flex-wrap: wrap; }
.cw-left { display: flex; flex-direction: column; gap: 6px; flex: none; max-width: 100%; }
.cw-cluebar { display: flex; gap: 8px; align-items: center; min-height: 2.4em; padding: 4px 8px; border-radius: 5px;
  background: rgba(58,215,255,.08); border: 1px solid rgba(58,215,255,.35); color: #d8f6ff; font-size: .92em; }
.cw-cluebar .cw-cnum { font-weight: bold; color: #3ad7ff; white-space: nowrap; }
.cw-cluebar .cw-ctext { flex: 1; }
.cw-board { position: relative; align-self: flex-start; padding: 6px; border: 1px solid var(--border, #1f8f0c); border-radius: 6px;
  background: radial-gradient(circle at 50% 40%, #0a140a, #030503); box-shadow: inset 0 0 30px -12px #39ff14; }
.cw-grid { display: grid; gap: 2px; user-select: none; -webkit-user-select: none; touch-action: manipulation; }
.cw-cell { position: relative; width: var(--cw); height: var(--cw); box-sizing: border-box; border-radius: 3px;
  background: #e9f5e4; color: #071007; cursor: pointer; display: flex; align-items: center; justify-content: center;
  font-weight: bold; font-size: calc(var(--cw) * .56); text-transform: uppercase; transition: background .15s, box-shadow .15s; }
.cw-block { width: var(--cw); height: var(--cw); }
.cw-cell .cw-num { position: absolute; top: 1px; left: 2px; font-size: max(8px, calc(var(--cw) * .26)); font-weight: normal; color: #3b4a3a; line-height: 1; }
.cw-cell.in-word { background: #bfeefc; }
.cw-cell.sel { background: #ffd23f; }
.cw-cell.solved { background: color-mix(in srgb, var(--cw-c) 34%, #e9f5e4); }
.cw-cell.solved.in-word { background: color-mix(in srgb, var(--cw-c) 34%, #bfeefc); }
.cw-cell.solved.sel { background: #ffd23f; }
.cw-cell.solved .cw-l { color: color-mix(in srgb, var(--cw-c) 55%, #071007); }
.cw-cell.hint::after { content: ''; position: absolute; top: 0; right: 0; border-style: solid; border-width: 0 7px 7px 0;
  border-color: transparent #ff2fb0 transparent transparent; border-top-right-radius: 3px; }
.cw-cell.pending .cw-l { opacity: .7; }
.cw-cell.other { box-shadow: inset 0 0 0 2px var(--cw-o); }
.cw-cell.missed .cw-l { color: #d02a2a; }
.cw-cell.wrong { animation: cw-wrong .55s ease-in-out; }
@keyframes cw-wrong { 20%, 60% { background: #ff8a8a; transform: translateX(-2px); } 40%, 80% { background: #ff8a8a; transform: translateX(2px); } }
.cw-cell.pop { animation: cw-pop .45s cubic-bezier(.2,1.6,.4,1) backwards; }
@keyframes cw-pop { 0% { transform: scale(.6); } 60% { transform: scale(1.12); } }
.cw-board.counting .cw-l { visibility: hidden; }
.cw-count { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 64px; font-weight: bold;
  color: #ffd23f; text-shadow: 0 0 18px #ffd23f; background: rgba(0,0,0,.55); border-radius: 6px; pointer-events: none; }
.cw-idle { position: absolute; inset: 0; display: flex; flex-direction: column; gap: 6px; align-items: center; justify-content: center;
  text-align: center; padding: 10px; background: rgba(0,0,0,.6); border-radius: 6px; }
.cw-idle b { color: #ffb000; letter-spacing: 2px; }
.cw-input { position: absolute; left: 0; top: 0; width: 1px; height: 1px; opacity: 0; border: 0; padding: 0; font-size: 16px; }
.cw-side { flex: 1; min-width: 220px; display: flex; flex-direction: column; gap: 10px; }
.cw-lists { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.cw-lists.narrow { grid-template-columns: 1fr; }
.cw-head { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid var(--border, #1f8f0c); padding-bottom: 3px; font-weight: bold; color: #ffb000; letter-spacing: 1px; }
.cw-head small { font-weight: normal; color: #9fd89a; letter-spacing: 0; }
.cw-clues { list-style: none; margin: 4px 0 0; padding: 0; max-height: 300px; overflow-y: auto; scrollbar-width: thin; }
.cw-clue { display: flex; gap: 6px; padding: 3px 5px; border-radius: 3px; cursor: pointer; font-size: .86em; line-height: 1.3; border-left: 3px solid transparent; }
.cw-clue:hover { background: rgba(57,255,20,.07); }
.cw-clue .n { font-weight: bold; min-width: 1.6em; text-align: right; }
.cw-clue.active { background: rgba(58,215,255,.14); border-left-color: #3ad7ff; color: #e3f8ff; }
.cw-clue.cross { background: rgba(58,215,255,.05); }
.cw-clue.done { opacity: .55; }
.cw-clue.done .t { text-decoration: line-through; text-decoration-color: var(--cw-c); text-decoration-thickness: 2px; }
.cw-clue .ans { margin-left: auto; color: #ffb000; letter-spacing: 1px; font-weight: bold; }
.cw-clue .who { width: 8px; height: 8px; border-radius: 50%; flex: none; margin-top: 5px; }
.cw-players { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
.cw-player { display: flex; align-items: center; gap: 8px; padding: 3px 6px; border-radius: 4px; border: 1px solid rgba(57,255,20,.15); font-size: .86em; }
.cw-player.lead { border-color: rgba(255,210,63,.6); background: rgba(255,210,63,.08); }
.cw-player.you { box-shadow: inset 3px 0 0 #39ff14; }
.cw-dot { width: 10px; height: 10px; border-radius: 50%; flex: none; box-shadow: 0 0 6px currentColor; }
.cw-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cw-pts { font-weight: bold; font-variant-numeric: tabular-nums; }
.cw-wins { font-size: .78em; opacity: .7; }
.cw-bar { flex: 0 0 70px; height: 6px; border-radius: 3px; background: rgba(255,255,255,.08); overflow: hidden; }
.cw-bar i { display: block; height: 100%; transition: width .3s; }
.cw-toast { min-height: 1.3em; font-size: .9em; text-align: center; color: #ffb000; transition: opacity .3s; }
.cw-hint { font-size: .78em; opacity: .65; margin: 0; }
@media (prefers-reduced-motion: reduce) { .cw-cell.pop, .cw-cell.wrong { animation: none; } }
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
    return {
      size: ['mini', 'medium', 'large'].includes(p.size) ? p.size : 'medium',
      mode: ['coop', 'race'].includes(p.mode) ? p.mode : 'coop',
    };
  } catch { return { size: 'medium', mode: 'coop' }; }
}
function savePrefs(p) { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* private mode */ } }

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const fmtClock = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const K = (r, c) => `${r},${c}`;
const DIRS = { across: [0, 1], down: [1, 0] };
const cellsOf = (w) => Array.from({ length: w.len }, (_, i) => [w.r + DIRS[w.dir][0] * i, w.c + DIRS[w.dir][1] * i]);
const label = (w) => `${w.num}${w.dir === 'across' ? 'A' : 'D'}`;

export function mount(container, api) {
  ensureStyles();
  const clock = makeServerClock();
  const prefs = loadPrefs();
  const results = createResults(container);

  const root = el('div', 'cw-root');
  const top = el('div', 'cw-top');
  const titleEl = el('span', 'cw-title', 'CROSSWORD');
  const statusEl = el('span', 'cw-status');
  const titleWrap = el('div');
  titleWrap.append(titleEl, document.createTextNode(' '), statusEl);
  const timerEl = el('div', 'cw-timer');
  top.append(titleWrap, timerEl);

  const controls = el('div', 'cw-controls');
  const modeSeg = el('div', 'cw-seg');
  const modeBtns = {};
  for (const [m, text] of [['coop', 'CO-OP'], ['race', 'RACE']]) {
    const b = el('button', '', text);
    b.title = m === 'coop' ? 'Everyone fills one shared grid' : 'Everyone solves their own copy — first to finish wins';
    b.addEventListener('click', () => { prefs.mode = m; savePrefs(prefs); sfx.play('click'); renderControls(); });
    modeBtns[m] = b;
    modeSeg.appendChild(b);
  }
  const sizeSeg = el('div', 'cw-seg');
  const sizeBtns = {};
  for (const [s, text] of [['mini', 'MINI'], ['medium', 'MEDIUM'], ['large', 'LARGE']]) {
    const b = el('button', '', text);
    b.addEventListener('click', () => { prefs.size = s; savePrefs(prefs); sfx.play('click'); renderControls(); });
    sizeBtns[s] = b;
    sizeSeg.appendChild(b);
  }
  const startBtn = el('button', 'cw-btn primary', 'START');
  startBtn.addEventListener('click', () => startRound());
  const hintBtn = el('button', 'cw-btn', 'HINT');
  hintBtn.title = 'Reveal one letter of the selected clue (costs 1 point)';
  hintBtn.addEventListener('click', () => {
    const w = activeWord();
    if (w) { api.sendAction({ kind: 'hint', id: w.id }); sfx.play('blip'); }
    focusInput();
  });
  const giveUpBtn = el('button', 'cw-btn warn', 'REVEAL');
  let armedTimer = 0;
  giveUpBtn.addEventListener('click', () => {
    if (!giveUpBtn.classList.contains('armed')) {
      giveUpBtn.classList.add('armed');
      giveUpBtn.textContent = 'SURE?';
      clearTimeout(armedTimer);
      armedTimer = setTimeout(() => { giveUpBtn.classList.remove('armed'); renderControls(); }, 3000);
      return;
    }
    clearTimeout(armedTimer);
    giveUpBtn.classList.remove('armed');
    api.sendAction({ kind: 'giveUp' });
  });
  controls.append(...(api.daily ? [] : [modeSeg, sizeSeg]), startBtn, hintBtn, giveUpBtn);
  const botBar = createBotBar(api);

  const body = el('div', 'cw-body');
  const left = el('div', 'cw-left');
  const clueBar = el('div', 'cw-cluebar');
  const clueNum = el('span', 'cw-cnum');
  const clueText = el('span', 'cw-ctext');
  clueBar.append(clueNum, clueText);
  const board = el('div', 'cw-board');
  const gridEl = el('div', 'cw-grid');
  const input = el('input', 'cw-input');
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('autocapitalize', 'characters');
  input.setAttribute('autocorrect', 'off');
  input.setAttribute('spellcheck', 'false');
  input.setAttribute('aria-label', 'Crossword letter input');
  const overlay = el('div', 'cw-idle');
  board.append(gridEl, input, overlay);
  left.append(clueBar, board);

  const side = el('div', 'cw-side');
  const lists = el('div', 'cw-lists');
  const acrossWrap = el('div');
  const acrossHead = el('div', 'cw-head');
  acrossHead.append(el('span', '', 'ACROSS'), el('small'));
  const acrossList = el('ul', 'cw-clues');
  acrossWrap.append(acrossHead, acrossList);
  const downWrap = el('div');
  const downHead = el('div', 'cw-head');
  downHead.append(el('span', '', 'DOWN'), el('small'));
  const downList = el('ul', 'cw-clues');
  downWrap.append(downHead, downList);
  lists.append(acrossWrap, downWrap);
  const playersHead = el('div', 'cw-head');
  const playersHeadL = el('span', '', 'PLAYERS');
  const playersHeadR = el('small', '', 'pts · wins');
  playersHead.append(playersHeadL, playersHeadR);
  const playersEl = el('ul', 'cw-players');
  side.append(lists, playersHead, playersEl);
  body.append(left, side);

  const toastEl = el('div', 'cw-toast');
  const hint = el('p', 'cw-hint', 'Click a cell and type. Click it again or press Space to switch direction · Tab / Shift+Tab: next / previous clue · Backspace to erase. A word locks in when every letter is right.');
  root.append(top, controls, botBar.el, body, toastEl, hint);
  container.appendChild(root);

  let view = null;
  let roundSeen = null;
  let words = []; // clues of the current round
  let cellMap = new Map(); // "r,c" -> { el, lEl, num, across?: word, down?: word }
  let sel = null; // { r, c, dir }
  const pending = new Map(); // "r,c" -> { l, t } — typed locally, not yet echoed by the server
  let solvedSeen = new Set();
  let lastTick = '';
  let toastTimer = 0;
  let rafId = 0;
  let sentCursor;
  let cellPx = 34;

  function toast(msg, color = '#ffb000') {
    toastEl.textContent = msg;
    toastEl.style.color = color;
    toastEl.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.style.opacity = '0'; }, 2400);
  }

  function startRound() {
    if (view && view.phase === 'playing') return;
    sfx.play('select');
    api.sendAction({ kind: 'start', size: prefs.size, mode: solo() ? 'coop' : prefs.mode });
  }
  // Alone in a normal room: no co-op/race choice to make, just you against the clock.
  const solo = () => !!view && !view.ranked && !api.daily && view.players.length === 1;
  const modeLabel = () => (view.ranked ? 'RANKED RACE ★' : solo() || api.daily ? 'SOLO' : view.mode === 'coop' ? 'CO-OP' : 'RACE');

  const playing = () => view && view.phase === 'playing';
  const counting = () => playing() && clock.now() < view.startedAt;
  const me = () => (view ? view.players.find((p) => p.clientId === api.getClientId()) : null);

  // --- board data ---------------------------------------------------------------------------
  let entriesByKey = new Map();
  function indexBoard() {
    entriesByKey = new Map();
    if (view && view.board) for (const [r, c, l, by, lock] of view.board.entries) entriesByKey.set(K(r, c), { l, by, lock });
    // Drop pending letters the server has caught up with (or that are stale).
    const now = performance.now();
    for (const [k, p] of pending) {
      const e = entriesByKey.get(k);
      if ((e ? e.l : '') === p.l || (e && e.lock) || now - p.t > PENDING_MS) pending.delete(k);
    }
  }
  const letterAt = (k) => (pending.has(k) ? pending.get(k).l : (entriesByKey.get(k) || {}).l || '');
  const lockedAt = (k) => !!(entriesByKey.get(k) || {}).lock;
  const solvedBy = (w) => (view && view.board ? view.board.solved[w.id] : undefined);

  function wordAt(r, c, dir) {
    const info = cellMap.get(K(r, c));
    return info ? info[dir] || null : null;
  }
  function activeWord() {
    if (!sel) return null;
    return wordAt(sel.r, sel.c, sel.dir) || wordAt(sel.r, sel.c, sel.dir === 'across' ? 'down' : 'across');
  }

  // --- layout -------------------------------------------------------------------------------
  function sizeCells() {
    if (!view || !view.cols) return;
    const cw = root.clientWidth || container.clientWidth || 600;
    const wide = cw >= 620;
    const avail = wide ? Math.min(cw - 250, 520) : cw - 20;
    const px = Math.max(22, Math.min(44, Math.floor((avail - 12) / view.cols) - 2));
    if (px !== cellPx) cellPx = px;
    gridEl.style.setProperty('--cw', `${cellPx}px`);
    gridEl.style.gridTemplateColumns = `repeat(${view.cols}, var(--cw))`;
    lists.classList.toggle('narrow', !wide || cw < 760);
    left.style.width = `${view.cols * (cellPx + 2) + 14}px`;
  }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => sizeCells()) : null;
  if (ro) ro.observe(root);

  function buildGrid() {
    gridEl.textContent = '';
    cellMap = new Map();
    words = view.clues.slice();
    const nums = new Map();
    for (const [r, c, num] of view.cells) nums.set(K(r, c), num);
    for (let r = 0; r < view.rows; r++) {
      for (let c = 0; c < view.cols; c++) {
        const k = K(r, c);
        if (!nums.has(k)) { gridEl.appendChild(el('div', 'cw-block')); continue; }
        const cell = el('div', 'cw-cell');
        const num = nums.get(k);
        if (num) cell.appendChild(el('span', 'cw-num', String(num)));
        const lEl = el('span', 'cw-l');
        cell.appendChild(lEl);
        cell.addEventListener('pointerdown', (ev) => { ev.preventDefault(); clickCell(r, c); });
        gridEl.appendChild(cell);
        cellMap.set(k, { el: cell, lEl, num });
      }
    }
    for (const w of words) for (const [r, c] of cellsOf(w)) cellMap.get(K(r, c))[w.dir] = w;
    // Lists
    acrossList.textContent = '';
    downList.textContent = '';
    for (const w of words) {
      const li = el('li', 'cw-clue');
      li.append(el('span', 'n', String(w.num)), el('span', 't', w.clue));
      li.addEventListener('click', () => { selectWord(w); focusInput(); });
      w.li = li;
      (w.dir === 'across' ? acrossList : downList).appendChild(li);
    }
    acrossHead.lastChild.textContent = `${words.filter((w) => w.dir === 'across').length}`;
    downHead.lastChild.textContent = `${words.filter((w) => w.dir === 'down').length}`;
    sizeCells();
    const first = words.find((w) => w.dir === 'across') || words[0];
    sel = null;
    if (first) selectWord(first, true);
  }

  // --- selection & typing -------------------------------------------------------------------
  function firstEmpty(w) {
    const cs = cellsOf(w);
    return cs.find(([r, c]) => !letterAt(K(r, c))) || cs[0];
  }
  function selectWord(w, quiet = false) {
    const [r, c] = firstEmpty(w);
    sel = { r, c, dir: w.dir };
    if (!quiet) sfx.play('click');
    afterSelect();
  }
  function clickCell(r, c) {
    if (!view || !cellMap.has(K(r, c))) return;
    const info = cellMap.get(K(r, c));
    if (sel && sel.r === r && sel.c === c) {
      const other = sel.dir === 'across' ? 'down' : 'across';
      if (info[other]) sel.dir = other;
    } else {
      sel = { r, c, dir: sel && info[sel.dir] ? sel.dir : (info.across ? 'across' : 'down') };
    }
    afterSelect();
    focusInput();
  }
  function afterSelect() {
    const w = activeWord();
    if (w && sel.dir !== w.dir) sel.dir = w.dir;
    if (view && view.mode === 'coop' && playing()) {
      const id = w ? w.id : null;
      if (id !== sentCursor) { sentCursor = id; api.sendAction({ kind: 'cursor', id }); }
    }
    renderBoard();
    renderClues();
  }
  function focusInput() {
    if (!playing()) return;
    try { input.focus({ preventScroll: true }); } catch { input.focus(); }
  }

  function moveInWord(step, { skipLocked = true } = {}) {
    const w = activeWord();
    if (!w) return false;
    const cs = cellsOf(w);
    let i = cs.findIndex(([r, c]) => r === sel.r && c === sel.c) + step;
    while (i >= 0 && i < cs.length) {
      const [r, c] = cs[i];
      if (!skipLocked || !lockedAt(K(r, c))) { sel.r = r; sel.c = c; return true; }
      i += step;
    }
    return false;
  }
  function nextClue(step) {
    const open = words.filter((w) => solvedBy(w) === undefined);
    const list = open.length ? open : words;
    const cur = activeWord();
    let i = cur ? list.indexOf(cur) : -1;
    if (i === -1) i = step > 0 ? -1 : 0;
    const w = list[(i + step + list.length) % list.length];
    if (w) selectWord(w, true);
  }
  function typeLetter(l) {
    if (!playing() || counting() || !sel) return;
    const k = K(sel.r, sel.c);
    if (!lockedAt(k)) {
      pending.set(k, { l, t: performance.now() });
      api.sendAction({ kind: 'fill', r: sel.r, c: sel.c, l });
      sfx.play('blip', { vol: 0.6 });
    }
    const w = activeWord();
    if (w && cellsOf(w).every(([r, c]) => letterAt(K(r, c)))) {
      // Word complete: stay on its last cell until the server judges it (it jumps on solve).
      if (!moveInWord(1)) { renderBoard(); return; }
    } else if (w) {
      // Next empty cell after this one, else wrap to the first empty one.
      const cs = cellsOf(w);
      const at = cs.findIndex(([r, c]) => r === sel.r && c === sel.c);
      const nxt = cs.slice(at + 1).find(([r, c]) => !letterAt(K(r, c))) || cs.find(([r, c]) => !letterAt(K(r, c)));
      if (nxt) { sel.r = nxt[0]; sel.c = nxt[1]; }
    }
    afterSelect();
  }
  function backspace() {
    if (!playing() || counting() || !sel) return;
    const k = K(sel.r, sel.c);
    if (letterAt(k) && !lockedAt(k)) {
      pending.set(k, { l: '', t: performance.now() });
      api.sendAction({ kind: 'fill', r: sel.r, c: sel.c, l: '' });
    } else if (moveInWord(-1)) {
      const k2 = K(sel.r, sel.c);
      if (letterAt(k2) && !lockedAt(k2)) {
        pending.set(k2, { l: '', t: performance.now() });
        api.sendAction({ kind: 'fill', r: sel.r, c: sel.c, l: '' });
      }
    }
    afterSelect();
  }
  function arrow(dr, dc) {
    if (!sel) return;
    const dir = dr ? 'down' : 'across';
    if (sel.dir !== dir && cellMap.get(K(sel.r, sel.c))[dir]) { sel.dir = dir; afterSelect(); return; }
    let r = sel.r + dr;
    let c = sel.c + dc;
    while (r >= 0 && c >= 0 && r < view.rows && c < view.cols) {
      if (cellMap.has(K(r, c))) {
        sel = { r, c, dir: cellMap.get(K(r, c))[dir] ? dir : sel.dir };
        if (!cellMap.get(K(r, c))[sel.dir]) sel.dir = sel.dir === 'across' ? 'down' : 'across';
        afterSelect();
        return;
      }
      r += dr;
      c += dc;
    }
  }

  input.addEventListener('keydown', (ev) => {
    if (!view || !sel || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const k = ev.key;
    if (/^[a-zA-Z]$/.test(k)) { ev.preventDefault(); typeLetter(k.toLowerCase()); return; }
    const map = {
      Backspace: () => backspace(),
      Delete: () => { const kk = K(sel.r, sel.c); if (!lockedAt(kk) && playing() && !counting()) { pending.set(kk, { l: '', t: performance.now() }); api.sendAction({ kind: 'fill', r: sel.r, c: sel.c, l: '' }); renderBoard(); } },
      ArrowLeft: () => arrow(0, -1),
      ArrowRight: () => arrow(0, 1),
      ArrowUp: () => arrow(-1, 0),
      ArrowDown: () => arrow(1, 0),
      Tab: () => nextClue(ev.shiftKey ? -1 : 1),
      Enter: () => nextClue(ev.shiftKey ? -1 : 1),
      ' ': () => { const info = cellMap.get(K(sel.r, sel.c)); const o = sel.dir === 'across' ? 'down' : 'across'; if (info && info[o]) { sel.dir = o; afterSelect(); } },
    };
    if (map[k]) { ev.preventDefault(); map[k](); }
  });
  // Soft keyboards (Android) often send key 'Unidentified' — read the typed text instead.
  input.addEventListener('input', () => {
    const v = input.value;
    input.value = '';
    const m = v.match(/[a-zA-Z]/g);
    if (m) typeLetter(m[m.length - 1].toLowerCase());
  });

  // --- rendering ----------------------------------------------------------------------------
  function renderControls() {
    const live = playing();
    modeSeg.hidden = sizeSeg.hidden = !!(view && view.ranked); // ranked is always a mini race
    if (solo()) modeSeg.hidden = true;
    for (const [m, b] of Object.entries(modeBtns)) { b.classList.toggle('on', (live ? view.mode : prefs.mode) === m); b.disabled = live; }
    for (const [s, b] of Object.entries(sizeBtns)) { b.classList.toggle('on', (live ? view.size : prefs.size) === s); b.disabled = live; }
    startBtn.hidden = live;
    startBtn.textContent = view && view.phase === 'results' ? 'NEW PUZZLE' : 'START';
    const p = me();
    hintBtn.hidden = !live;
    hintBtn.disabled = !p || p.hintsLeft <= 0 || counting() || (p && p.gaveUp);
    hintBtn.textContent = `HINT (${p ? p.hintsLeft : 0})`;
    giveUpBtn.hidden = !live || (p && p.gaveUp);
    if (!giveUpBtn.classList.contains('armed')) giveUpBtn.textContent = view && view.mode === 'race' ? 'GIVE UP' : 'REVEAL';
    giveUpBtn.title = view && view.mode === 'race' ? 'Stop racing (answers show once everyone is done)' : 'End the puzzle and show every answer';
  }

  function renderStatus() {
    if (!view || view.phase === 'waiting' || !view.cols) {
      titleEl.textContent = 'CROSSWORD';
      statusEl.textContent = api.daily ? '· today\'s puzzle, press START' : view && view.ranked ? '· a mini race, press START' : solo() ? '· SOLO: pick a size, then START' : '· pick a mode and size, then START';
      return;
    }
    titleEl.textContent = `CROSSWORD · ${(view.sizes[view.size] || '').toUpperCase()} · ${modeLabel()}`;
    const done = words.filter((w) => solvedBy(w) !== undefined).length;
    if (view.phase === 'results') {
      statusEl.textContent = view.endReason === 'revealed' ? '· answers revealed' : view.mode === 'race' ? '· race over' : '· solved!';
    } else if (counting()) statusEl.textContent = '· get ready…';
    else if (me() && me().gaveUp) statusEl.textContent = '· you gave up — watching the race';
    else statusEl.textContent = `· ${done}/${words.length} clues${view.mode === 'race' ? ' · first to finish wins' : ''}`;
  }

  function renderBoard() {
    if (!view || !view.cols) return;
    const w = activeWord();
    const inWord = new Set(w ? cellsOf(w).map(([r, c]) => K(r, c)) : []);
    const over = view.phase === 'results';
    // Co-op: other players' current clue, outlined in their colour.
    const others = new Map();
    if (view.mode === 'coop' && playing()) {
      for (const p of view.players) {
        if (p.clientId === api.getClientId() || p.cursor == null) continue;
        const ow = words[p.cursor];
        if (ow) for (const [r, c] of cellsOf(ow)) if (!others.has(K(r, c))) others.set(K(r, c), p.color);
      }
    }
    const solvedColor = new Map();
    const colorOf = (id) => { const p = view.players.find((x) => x.clientId === id); return p ? p.color : '#39ff14'; };
    for (const ww of words) {
      const by = solvedBy(ww);
      if (by !== undefined) for (const [r, c] of cellsOf(ww)) if (!solvedColor.has(K(r, c))) solvedColor.set(K(r, c), colorOf(by));
    }
    const answerAt = new Map();
    if (over) for (const ww of words) if (ww.answer) cellsOf(ww).forEach(([r, c], i) => answerAt.set(K(r, c), ww.answer[i]));
    for (const [k, info] of cellMap) {
      const e = entriesByKey.get(k);
      let l = letterAt(k);
      let missed = false;
      if (over && answerAt.has(k) && l !== answerAt.get(k) && !(e && e.lock)) { l = answerAt.get(k); missed = true; }
      info.lEl.textContent = l;
      const cl = info.el.classList;
      cl.toggle('sel', !!sel && K(sel.r, sel.c) === k && !over);
      cl.toggle('in-word', inWord.has(k) && !over);
      cl.toggle('solved', solvedColor.has(k));
      if (solvedColor.has(k)) info.el.style.setProperty('--cw-c', solvedColor.get(k));
      cl.toggle('hint', !!(e && e.lock === 2));
      cl.toggle('pending', pending.has(k));
      cl.toggle('missed', missed);
      cl.toggle('other', others.has(k) && !inWord.has(k));
      if (others.has(k)) info.el.style.setProperty('--cw-o', others.get(k));
    }
    board.classList.toggle('counting', counting());
    const w2 = activeWord();
    if (w2 && !over) {
      clueNum.textContent = label(w2);
      clueText.textContent = counting() ? '…' : `${w2.clue} (${w2.len})`;
      clueBar.style.visibility = '';
    } else clueBar.style.visibility = over || !w2 ? 'hidden' : '';
  }

  function renderClues() {
    if (!view) return;
    const w = activeWord();
    const cross = sel ? wordAt(sel.r, sel.c, sel.dir === 'across' ? 'down' : 'across') : null;
    const over = view.phase === 'results';
    for (const ww of words) {
      const li = ww.li;
      if (!li) continue;
      const by = solvedBy(ww);
      li.classList.toggle('active', ww === w && !over);
      li.classList.toggle('cross', ww === cross && !over);
      li.classList.toggle('done', by !== undefined);
      const p = by !== undefined ? view.players.find((x) => x.clientId === by) : null;
      li.style.setProperty('--cw-c', p ? p.color : '#39ff14');
      li.querySelector('.t').textContent = counting() ? '• • •' : ww.clue;
      let ans = li.querySelector('.ans');
      if (over && ww.answer && by === undefined) {
        if (!ans) { ans = el('span', 'ans'); li.appendChild(ans); }
        ans.textContent = ww.answer.toUpperCase();
      } else if (ans) ans.remove();
      let who = li.querySelector('.who');
      if (view.mode === 'coop' && p) {
        if (!who) { who = el('span', 'who'); li.insertBefore(who, li.firstChild); }
        who.style.background = p.color;
        who.title = p.nickname;
      } else if (who) who.remove();
    }
    // Keep the active clue visible inside its own scrolling list (not the page).
    if (w && w.li) {
      const list = w.li.parentElement;
      const t = w.li.offsetTop - list.offsetTop;
      if (t < list.scrollTop || t + w.li.offsetHeight > list.scrollTop + list.clientHeight) {
        list.scrollTop = Math.max(0, t - list.clientHeight / 2 + w.li.offsetHeight / 2);
      }
    }
  }

  function renderPlayers() {
    playersEl.textContent = '';
    if (!view) return;
    const meId = api.getClientId();
    const race = view.mode === 'race' && view.phase !== 'waiting';
    playersHeadR.textContent = race ? 'progress · wins' : 'pts · wins';
    const list = view.players.slice().sort((a, b) => b.score - a.score || b.wins - a.wins);
    const topScore = list.length ? list[0].score : 0;
    for (const p of list) {
      const li = el('li', 'cw-player');
      const lead = race ? view.winner === p.clientId : topScore > 0 && p.score === topScore;
      if (lead) li.classList.add('lead');
      if (p.clientId === meId) li.classList.add('you');
      const dot = el('span', 'cw-dot');
      dot.style.background = p.color;
      dot.style.color = p.color;
      const name = el('span', 'cw-name', `${lead ? '★ ' : ''}${p.nickname}${p.clientId === meId ? ' (you)' : ''}${p.gaveUp ? ' · gave up' : ''}`);
      li.append(dot, name);
      if (race) {
        const bar = el('span', 'cw-bar');
        const fill = el('i');
        fill.style.width = `${view.totalCells ? Math.round(100 * (p.filled || 0) / view.totalCells) : 0}%`;
        fill.style.background = p.color;
        bar.title = `${p.filled || 0}/${view.totalCells} letters`;
        bar.appendChild(fill);
        li.append(bar, el('span', 'cw-pts', `${p.solved}/${words.length}`));
      } else li.append(el('span', 'cw-pts', String(p.score)));
      li.append(el('span', 'cw-wins', `· ${p.wins} wins`));
      playersEl.appendChild(li);
    }
  }

  function renderOverlay() {
    overlay.textContent = '';
    if (!view || !view.cols) {
      overlay.hidden = false;
      overlay.className = 'cw-idle';
      overlay.append(el('b', '', 'CROSSWORD'), ...(api.daily
        ? [el('span', '', 'Today\'s puzzle: one try, fastest solve tops the board. Press START.')]
        : solo() ? [el('span', '', 'SOLO: solve it as fast as you can. Your best time is saved to your profile.'), el('span', '', 'Want company? Share the invite link, or add a bot for co-op and race.')]
        : api.ranked ? [el('span', '', 'RANKED: a head-to-head mini race. Same puzzle, first to finish wins.'), el('span', '', 'Press START once your opponent is here.')]
        : [el('span', '', 'CO-OP: fill one grid together · RACE: same puzzle, first to finish wins')]));
      if (!view || !view.cols) { gridEl.style.setProperty('--cw', '30px'); gridEl.style.gridTemplateColumns = 'repeat(9, var(--cw))'; if (!gridEl.childElementCount) for (let i = 0; i < 81; i++) gridEl.appendChild(el('div', (i * 7 + (i >> 2)) % 5 === 0 ? 'cw-block' : 'cw-cell')); }
      return;
    }
    if (counting()) {
      overlay.hidden = false;
      overlay.className = 'cw-count';
      overlay.textContent = String(Math.ceil((view.startedAt - clock.now()) / 1000));
      return;
    }
    overlay.hidden = true;
  }

  function renderResults() {
    if (!view || view.phase !== 'results') { results.update(null); return; }
    const meId = api.getClientId();
    const players = view.players.filter((p) => p.inRound);
    const elapsed = fmtClock((view.endedAt || clock.now()) - view.startedAt);
    const size = (view.sizes[view.size] || '').toUpperCase();
    if (view.mode === 'race') {
      players.sort((a, b) => (b.clientId === view.winner) - (a.clientId === view.winner) || b.solved - a.solved || (b.filled || 0) - (a.filled || 0));
      const winner = view.players.find((p) => p.clientId === view.winner);
      const iWon = view.winner === meId;
      results.update({
        title: view.endReason === 'revealed' ? 'ANSWERS REVEALED' : iWon ? 'YOU WIN!' : `${winner ? winner.nickname : '?'} WINS`,
        subtitle: `RACE · ${size} · ${elapsed}`,
        outcome: view.endReason === 'revealed' ? 'over' : iWon ? 'win' : (me() && me().inRound ? 'lose' : 'over'),
        rows: players.map((p) => ({ name: p.nickname, value: `${p.solved}/${words.length} clues`, win: p.clientId === view.winner, you: p.clientId === meId })),
        rematch: { label: 'NEW PUZZLE', onClick: () => startRound() },
      });
      return;
    }
    players.sort((a, b) => b.score - a.score);
    const topScore = players.length ? players[0].score : 0;
    const done = words.filter((w) => solvedBy(w) !== undefined).length;
    results.update({
      title: view.endReason === 'revealed' ? 'ANSWERS REVEALED' : players.length === 1 ? `SOLVED IN ${elapsed}` : 'PUZZLE SOLVED!',
      subtitle: `${modeLabel()} · ${size} · ${done}/${words.length} clues · ${elapsed}`,
      outcome: view.endReason === 'revealed' ? 'over' : 'win',
      rows: players.map((p) => ({ name: p.nickname, value: `${p.score} pts · ${p.solved} clue${p.solved === 1 ? '' : 's'}`, win: topScore > 0 && p.score === topScore, you: p.clientId === meId })),
      rematch: { label: 'NEW PUZZLE', onClick: () => startRound() },
    });
  }

  function renderTimer() {
    if (!view || view.phase === 'waiting' || !view.startedAt) { timerEl.textContent = ''; return; }
    if (view.phase === 'results') { timerEl.textContent = fmtClock((view.endedAt || 0) - view.startedAt); return; }
    const now = clock.now();
    if (now < view.startedAt) {
      const s = Math.ceil((view.startedAt - now) / 1000);
      const key = `c${view.roundId}-${s}`;
      if (key !== lastTick) { lastTick = key; sfx.play('beep'); renderOverlay(); renderBoard(); renderClues(); renderStatus(); }
      timerEl.textContent = '0:00';
      return;
    }
    if (lastTick.startsWith(`c${view.roundId}-`)) {
      lastTick = `go${view.roundId}`;
      sfx.play('go');
      render();
      focusInput();
    }
    timerEl.textContent = fmtClock(now - view.startedAt);
  }

  function render() {
    renderControls();
    renderStatus();
    renderOverlay();
    renderBoard();
    renderClues();
    renderPlayers();
    renderResults();
    if (view) botBar.update(view.players);
  }

  function flashWrong(ids) {
    for (const id of ids) {
      const w = words[id];
      if (!w) continue;
      cellsOf(w).forEach(([r, c]) => {
        const info = cellMap.get(K(r, c));
        if (!info) return;
        info.el.classList.remove('wrong');
        void info.el.offsetWidth; // restart the animation
        info.el.classList.add('wrong');
      });
    }
    sfx.play('error');
    toast('Not quite — something in that word is wrong', '#ff8a8a');
  }

  function onState(data) {
    const prev = view;
    view = data;
    clock.sync(view.serverNow);
    const meId = api.getClientId();
    if (view.roundId !== roundSeen) {
      roundSeen = view.roundId;
      pending.clear();
      sentCursor = undefined;
      solvedSeen = new Set(Object.keys((view.board && view.board.solved) || {}).map(Number));
      indexBoard();
      if (view.cols) buildGrid();
    } else {
      indexBoard();
      // Answers only arrive once the round ends; words was copied at round start.
      for (const cl of view.clues) if (cl.answer && words[cl.id]) words[cl.id].answer = cl.answer;
      const solved = (view.board && view.board.solved) || {};
      for (const [idStr, by] of Object.entries(solved)) {
        const id = Number(idStr);
        if (solvedSeen.has(id)) continue;
        solvedSeen.add(id);
        const w = words[id];
        if (!w) continue;
        cellsOf(w).forEach(([r, c], i) => {
          const info = cellMap.get(K(r, c));
          if (!info) return;
          info.el.classList.remove('pop');
          void info.el.offsetWidth;
          info.el.style.animationDelay = `${i * 45}ms`;
          info.el.classList.add('pop');
        });
        const p = view.players.find((x) => x.clientId === by);
        if (by === meId) {
          sfx.play('point');
          // Jump on to the next open clue if we were still on the one just solved.
          if (activeWord() === w && playing()) nextClue(1);
        } else {
          sfx.play('pop');
          if (p && view.mode === 'coop') toast(`${p.nickname} solved ${label(w)} — ${w.clue}`, p.color);
        }
      }
    }
    if (prev && prev.phase === 'playing' && view.phase === 'results') {
      input.blur();
      if (view.endReason === 'revealed') sfx.play('lose');
      else if (view.mode === 'coop' || view.winner === meId) sfx.play('win');
      else sfx.play('lose');
    }
    if (prev && prev.mode === 'race' && view.mode === 'race' && view.phase === 'playing') {
      for (const p of view.players) {
        const old = prev.players.find((x) => x.clientId === p.clientId);
        if (p.clientId !== meId && old && p.solved > old.solved && p.solved === words.length - 2) toast(`${p.nickname} is 2 clues from finishing!`, p.color);
      }
    }
    render();
  }

  function frame() {
    rafId = requestAnimationFrame(frame);
    renderTimer();
  }
  rafId = requestAnimationFrame(frame);
  render();

  return {
    applySnapshot(snapshot) {
      if (snapshot) onState({ kind: 'state', ...snapshot });
    },
    applyEvent(data) {
      if (!data) return;
      if (data.kind === 'state') onState(data);
      else if (data.kind === 'wrong') flashWrong(data.ids || []);
      else if (data.kind === 'rejected' && data.reason === 'no_hints') { toast('No hints left'); sfx.play('error'); }
    },
    applyRoster() { /* names come from the server's player list */ },
    unmount() {
      cancelAnimationFrame(rafId);
      clearTimeout(toastTimer);
      clearTimeout(armedTimer);
      if (ro) ro.disconnect();
      results.destroy();
      container.innerHTML = '';
    },
  };
}
