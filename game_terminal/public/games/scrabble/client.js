// Scrabble — drag tiles from your rack onto the board (pointer events: mouse, pen and touch), or
// tap a rack tile then tap a square. Tap/drag a pending tile to take it back. The server is
// authoritative: pending tiles are sent as {i: rackIndex, r, c, letter?} for a live score/validity
// preview ('check'), and SUBMIT sends the same list as a 'play'. Blanks ask for a letter.
// Board cells carry data-r/data-c (hub grid-game convention for automated tests).
import { sfx } from '../sfx.js';
import { preferredLevel, levelSelect } from '../botLevel.js';
import { createResults } from '../resultsPanel.js';

const SIZE = 15;
const VALUES = {
  a: 1, b: 3, c: 3, d: 2, e: 1, f: 4, g: 2, h: 4, i: 1, j: 8, k: 5, l: 1, m: 3,
  n: 1, o: 1, p: 3, q: 10, r: 1, s: 1, t: 1, u: 1, v: 4, w: 4, x: 8, y: 4, z: 10, '?': 0,
};

// Same layout as the server (symmetric under both mirrors and the diagonal).
export const PREMIUM = (() => {
  const g = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  const set = (type, cells) => {
    for (const [r, c] of cells) {
      for (const [rr, cc] of [[r, c], [c, r], [SIZE - 1 - r, c], [r, SIZE - 1 - c], [SIZE - 1 - r, SIZE - 1 - c],
        [c, SIZE - 1 - r], [SIZE - 1 - c, r], [SIZE - 1 - c, SIZE - 1 - r]]) g[rr][cc] = type;
    }
  };
  set('TW', [[0, 0], [0, 7]]);
  set('DW', [[1, 1], [2, 2], [3, 3], [4, 4], [7, 7]]);
  set('TL', [[1, 5], [5, 5]]);
  set('DL', [[0, 3], [2, 6], [3, 7], [6, 6]]);
  return g;
})();

const REASONS = {
  no_tiles: 'Place some tiles first',
  bad_tiles: 'Invalid tiles',
  occupied: 'That square is taken',
  not_line: 'Tiles must be in one row or column',
  gap: 'Tiles must be connected with no gaps',
  center: 'The first word must cover the ★ centre square',
  too_short: 'Words need at least 2 letters',
  not_connected: 'Your word must connect to tiles on the board',
  not_word: 'Not a word',
  not_your_turn: "It's not your turn",
  bag_low: 'Need at least 7 tiles in the bag to exchange',
};

const PREMIUM_LABEL = { TW: 'TRIPLE WORD', DW: 'DOUBLE WORD', TL: 'TRIPLE LETTER', DL: 'DOUBLE LETTER' };
const PREMIUM_SHORT = { TW: 'TW', DW: 'DW', TL: 'TL', DL: 'DL' };

const STYLE_ID = 'gt-scr-style';
const CSS = `
.gt-scr { display:flex; flex-direction:column; align-items:center; gap:10px; width:100%; max-width:1000px; margin:0 auto; font-family:inherit; color:#39ff14; user-select:none; -webkit-user-select:none; }
.gt-scr .scr-status { font-size:17px; font-weight:bold; padding:6px 14px; border-radius:6px; border:2px solid transparent; text-align:center; background:rgba(255,255,255,0.04); }
.gt-scr .scr-status.mine { border-color:#39ff14; background:rgba(57,255,20,0.14); }
.gt-scr .scr-status.over { color:#ffb000; }
.gt-scr .scr-flash { color:#ff4d4d; min-height:1.2em; font-size:14px; text-align:center; }
.gt-scr .scr-seats { display:flex; flex-wrap:wrap; gap:8px; justify-content:center; }
.gt-scr .scr-seat { border:1px solid #1f8f0c; border-radius:6px; padding:5px 10px; display:flex; flex-direction:column; gap:3px; min-width:120px; background:#05080a; }
.gt-scr .scr-seat.turn { border-color:#ffb000; box-shadow:0 0 10px rgba(255,176,0,0.45); }
.gt-scr .scr-seat.me .scr-seat-name::after { content:' (you)'; color:#1f8f0c; }
.gt-scr .scr-seat-name { font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:190px; }
.gt-scr .scr-seat-score { color:#ffb000; font-size:20px; font-weight:bold; }
.gt-scr .scr-seat-sub { color:#1f8f0c; font-size:12px; display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
.gt-scr .scr-seat button { font-size:11px; padding:1px 6px; }
.gt-scr .scr-lobby { display:flex; flex-wrap:wrap; gap:8px; justify-content:center; align-items:center; }
.gt-scr .scr-main { display:flex; flex-wrap:wrap; gap:14px; justify-content:center; align-items:flex-start; width:100%; }
.gt-scr .scr-boardcol { display:flex; flex-direction:column; align-items:center; gap:8px; width:min(calc(100vw - 34px), 600px); }
.gt-scr .scr-board { display:grid; grid-template-columns:repeat(15, 1fr); grid-template-rows:repeat(15, 1fr); gap:2px; width:100%; aspect-ratio:1; padding:3px; box-sizing:border-box; background:#0f2a0a; border:2px solid #1f8f0c; border-radius:6px; touch-action:none; }
.gt-scr .scr-board.myturn { border-color:#39ff14; box-shadow:0 0 14px rgba(57,255,20,0.35); }
.gt-scr .scr-cell { position:relative; background:#071107; border-radius:2px; display:flex; align-items:center; justify-content:center; font-size:clamp(5px, 1.3vw, 9px); color:rgba(255,255,255,0.55); line-height:1; text-align:center; overflow:hidden; }
.gt-scr .scr-cell.TW { background:#5a1414; color:#ffb3b3; }
.gt-scr .scr-cell.DW { background:#4b2a3c; color:#ffc4e1; }
.gt-scr .scr-cell.TL { background:#123a5c; color:#a6d8ff; }
.gt-scr .scr-cell.DL { background:#0f3a3a; color:#a6fff0; }
.gt-scr .scr-cell.star { font-size:clamp(10px, 3vw, 20px); color:#ffc4e1; }
.gt-scr .scr-cell.drop { outline:2px solid #39ff14; outline-offset:-2px; }
.gt-scr .scr-cell.target:hover { outline:1px dashed #39ff14; outline-offset:-1px; cursor:pointer; }
.gt-scr .scr-tile { position:relative; width:100%; height:100%; box-sizing:border-box; border-radius:3px; background:#2a1f05; border:1px solid #ffb000; color:#ffb000; font-weight:bold; display:flex; align-items:center; justify-content:center; font-size:clamp(11px, 3.1vw, 22px); text-transform:uppercase; line-height:1; }
.gt-scr .scr-tile .v { position:absolute; right:2px; bottom:1px; font-size:clamp(5px, 1.2vw, 9px); font-weight:normal; opacity:0.85; }
.gt-scr .scr-tile.blank { color:#ffe08a; font-style:italic; opacity:0.92; }
.gt-scr .scr-tile.pending { background:#0d3307; border-color:#39ff14; color:#39ff14; cursor:grab; box-shadow:0 0 8px rgba(57,255,20,0.5); }
.gt-scr .scr-tile.last { box-shadow:0 0 0 2px #ffb000 inset, 0 0 8px rgba(255,176,0,0.6); background:#3d2c05; }
.gt-scr .scr-tile.fresh { animation:gt-scr-pop .35s ease-out; }
@keyframes gt-scr-pop { 0% { transform:scale(0.3); opacity:0; } 70% { transform:scale(1.12); } 100% { transform:scale(1); opacity:1; } }
.gt-scr .scr-rackrow { display:flex; gap:6px; align-items:center; justify-content:center; width:100%; }
.gt-scr .scr-rack { display:flex; gap:5px; justify-content:center; padding:6px 8px; border:1px solid #1f8f0c; border-radius:6px; background:#071107; min-height:calc(min(11vw, 50px) + 4px); touch-action:none; }
.gt-scr .scr-rack .scr-tile { width:min(11vw, 50px); height:min(11vw, 50px); font-size:min(6.4vw, 28px); cursor:grab; }
.gt-scr .scr-rack .scr-tile .v { font-size:min(2.6vw, 12px); }
.gt-scr .scr-rack .scr-tile.sel { transform:translateY(-6px); border-color:#39ff14; color:#39ff14; box-shadow:0 0 10px rgba(57,255,20,0.6); }
.gt-scr .scr-rack .scr-tile.xsel { transform:translateY(-6px); border-color:#ff4d4d; color:#ff4d4d; }
.gt-scr .scr-rack .scr-slot { width:min(11vw, 50px); height:min(11vw, 50px); border:1px dashed #1f3f1a; border-radius:3px; box-sizing:border-box; }
.gt-scr .scr-preview { min-height:1.3em; font-size:15px; text-align:center; }
.gt-scr .scr-preview.ok { color:#39ff14; }
.gt-scr .scr-preview.bad { color:#ff4d4d; }
.gt-scr .scr-preview b { color:#ffb000; }
.gt-scr .scr-controls { display:flex; flex-wrap:wrap; gap:6px; justify-content:center; }
.gt-scr .scr-controls button.primary { border-color:#ffb000; color:#ffb000; }
.gt-scr .scr-controls button.primary:not(:disabled):hover { background:#ffb000; color:#000; }
.gt-scr .scr-side { display:flex; flex-direction:column; gap:8px; width:min(calc(100vw - 34px), 300px); }
.gt-scr .scr-box { border:1px solid #1f8f0c; border-radius:6px; padding:8px 10px; background:#05080a; }
.gt-scr .scr-box h4 { margin:0 0 6px; font-size:13px; color:#1f8f0c; letter-spacing:1px; }
.gt-scr .scr-bag { font-size:15px; }
.gt-scr .scr-bag b { color:#ffb000; font-size:20px; }
.gt-scr .scr-log { max-height:300px; overflow-y:auto; font-size:13px; display:flex; flex-direction:column; gap:3px; }
.gt-scr .scr-log .e { display:flex; gap:6px; justify-content:space-between; border-bottom:1px solid #0d240a; padding-bottom:2px; }
.gt-scr .scr-log .e .who { color:#1f8f0c; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:90px; flex-shrink:0; }
.gt-scr .scr-log .e .what { flex:1; text-transform:uppercase; word-break:break-word; }
.gt-scr .scr-log .e .pts { color:#ffb000; font-weight:bold; }
.gt-scr .scr-log .e.bingo .what::after { content:' BINGO!'; color:#ffb000; }
.gt-scr .scr-legend { display:grid; grid-template-columns:auto 1fr; gap:3px 8px; font-size:11px; align-items:center; }
.gt-scr .scr-legend span.k { width:18px; height:14px; border-radius:2px; display:inline-block; }
.gt-scr-ghost { position:fixed; z-index:9999; pointer-events:none; width:46px; height:46px; margin:-23px 0 0 -23px; border-radius:4px; background:#0d3307; border:2px solid #39ff14; color:#39ff14; font:bold 26px monospace; display:flex; align-items:center; justify-content:center; box-shadow:0 6px 18px rgba(0,0,0,0.6), 0 0 12px rgba(57,255,20,0.6); text-transform:uppercase; }
.gt-scr-modal { position:fixed; inset:0; z-index:9998; background:rgba(0,0,0,0.7); display:flex; align-items:center; justify-content:center; padding:16px; }
.gt-scr-modal .card { background:#05080a; border:2px solid #39ff14; border-radius:8px; padding:14px; max-width:360px; width:100%; color:#39ff14; font-family:monospace; text-align:center; }
.gt-scr-modal .grid { display:grid; grid-template-columns:repeat(7, 1fr); gap:5px; margin:10px 0; }
.gt-scr-modal .grid button { padding:8px 0; font-size:17px; text-transform:uppercase; }
@media (max-width: 640px) {
  .gt-scr .scr-status { font-size:15px; }
  .gt-scr .scr-log { max-height:160px; }
  .gt-scr .scr-board { gap:1px; padding:2px; }
}
`;

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

// Board wire format: 15 strings, '.' empty, lowercase tile, UPPERCASE = blank.
export function decodeBoard(rows) {
  return rows.map((row) => [...row].map((ch) => (ch === '.' ? null : { l: ch.toLowerCase(), b: ch !== ch.toLowerCase() })));
}

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const btn = (label, onClick, cls) => {
  const b = el('button', cls, label);
  b.addEventListener('click', onClick);
  return b;
};

export function mount(container, api) {
  ensureStyle();
  let view = null;
  let board = null;
  let roster = [];
  const results = createResults(container);
  const root = el('div', 'gt-scr');
  container.appendChild(root);

  // Local move-in-progress state, valid for one (gameId, rack, board) combination.
  let rackKey = '';
  let order = []; // display order of rack indices (shuffle/rearrange)
  const pending = new Map(); // 'r,c' -> { i, letter }
  let selected = null; // rack index picked for tap-to-place
  let exchangeMode = false;
  const exchangeSel = new Set();
  let preview = null; // { key, ok, reason, score, words, bad, bingo }
  let previewTimer = null;
  let flash = null;
  let flashTimer = null;
  let prevBoardStr = null;
  let freshCells = new Set();
  let drag = null;
  let modal = null;

  const me = () => api.getClientId();
  const seated = () => view && view.mySeat >= 0;
  const myTurn = () => view && view.phase === 'playing' && seated() && view.turnIdx === view.mySeat;
  const canArrange = () => view && view.phase === 'playing' && seated();
  const usedIdx = () => new Set([...pending.values()].map((p) => p.i));

  function showFlash(text) {
    flash = text;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { flash = null; const f = root.querySelector('.scr-flash'); if (f) f.textContent = ''; }, 3500);
    const f = root.querySelector('.scr-flash');
    if (f) f.textContent = text;
  }

  function pendingTiles() {
    return [...pending.entries()].map(([k, p]) => {
      const [r, c] = k.split(',').map(Number);
      const t = { i: p.i, r, c };
      if (view.myRack[p.i] === '?') t.letter = p.letter;
      return t;
    });
  }
  const pendingKey = () => pendingTiles().map((t) => `${t.i}@${t.r},${t.c}${t.letter || ''}`).sort().join(';');

  function requestPreview() {
    clearTimeout(previewTimer);
    preview = null;
    updatePreviewEl();
    if (!pending.size || !myTurn()) return;
    previewTimer = setTimeout(() => api.sendAction({ kind: 'check', tiles: pendingTiles(), key: pendingKey() }), 90);
  }

  function resetLocal() {
    pending.clear();
    selected = null;
    exchangeMode = false;
    exchangeSel.clear();
    preview = null;
    order = view ? view.myRack.map((_, i) => i) : [];
  }

  // New snapshot: keep pending tiles where still valid (same rack, squares still empty).
  function syncLocal() {
    const key = `${view.gameId}|${view.mySeat}|${view.myRack.join('')}`;
    if (key !== rackKey) {
      rackKey = key;
      resetLocal();
      return;
    }
    for (const [k, p] of [...pending]) {
      const [r, c] = k.split(',').map(Number);
      if (board[r][c] || p.i >= view.myRack.length) pending.delete(k);
    }
    if (!canArrange()) { pending.clear(); exchangeMode = false; exchangeSel.clear(); }
  }

  function placeTile(i, r, c, letter) {
    if (!canArrange() || board[r][c] || pending.has(`${r},${c}`)) return false;
    for (const [k, p] of pending) if (p.i === i) pending.delete(k);
    const tile = view.myRack[i];
    if (tile === '?' && !letter) {
      chooseBlank((l) => { if (l) placeTile(i, r, c, l); });
      return true;
    }
    pending.set(`${r},${c}`, { i, letter: tile === '?' ? letter : tile });
    selected = null;
    sfx.play('click');
    render();
    requestPreview();
    return true;
  }

  function unplace(key) {
    if (!pending.has(key)) return;
    pending.delete(key);
    sfx.play('blip');
    render();
    requestPreview();
  }

  function recall() {
    if (!pending.size) return;
    pending.clear();
    selected = null;
    sfx.play('whoosh');
    render();
    requestPreview();
  }

  function shuffle() {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    sfx.play('swap');
    render();
  }

  function submit() {
    if (!myTurn() || !pending.size) return;
    api.sendAction({ kind: 'play', tiles: pendingTiles() });
  }

  function doExchange() {
    if (!myTurn()) return;
    if (!exchangeMode) {
      pending.clear();
      exchangeMode = true;
      exchangeSel.clear();
      render();
      return;
    }
    if (!exchangeSel.size) { exchangeMode = false; render(); return; }
    api.sendAction({ kind: 'exchange', indices: [...exchangeSel] });
  }

  function chooseBlank(cb) {
    closeModal();
    modal = el('div', 'gt-scr-modal');
    const card = el('div', 'card');
    card.appendChild(el('div', null, 'BLANK TILE — CHOOSE A LETTER'));
    const grid = el('div', 'grid');
    for (let k = 0; k < 26; k++) {
      const L = String.fromCharCode(97 + k);
      grid.appendChild(btn(L, () => { closeModal(); cb(L); }));
    }
    card.appendChild(grid);
    card.appendChild(btn('CANCEL', () => { closeModal(); cb(null); }));
    modal.appendChild(card);
    modal.addEventListener('pointerdown', (e) => { if (e.target === modal) { closeModal(); cb(null); } });
    document.body.appendChild(modal);
  }
  function closeModal() { if (modal) { modal.remove(); modal = null; } }

  // ---- drag & drop (pointer events) ----
  function startDrag(e, src) {
    // src: { from: 'rack', i } | { from: 'board', key }
    if (!canArrange() || exchangeMode) return;
    if (e.button != null && e.button > 0) return;
    e.preventDefault();
    const i = src.from === 'rack' ? src.i : pending.get(src.key).i;
    drag = { src, i, x0: e.clientX, y0: e.clientY, moved: false, ghost: null, over: null, pid: e.pointerId };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('pointercancel', onDragCancel);
  }
  function cellAt(x, y) {
    const t = document.elementFromPoint(x, y);
    const cell = t && t.closest && t.closest('.gt-scr .scr-cell');
    if (cell) return cell;
    return null;
  }
  function onDragMove(e) {
    if (!drag || e.pointerId !== drag.pid) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return;
    if (!drag.moved) {
      drag.moved = true;
      const tile = view.myRack[drag.i];
      const shown = drag.src.from === 'board' ? pending.get(drag.src.key).letter : tile;
      drag.ghost = el('div', 'gt-scr-ghost', shown === '?' ? ' ' : shown);
      document.body.appendChild(drag.ghost);
      sfx.play('select');
    }
    drag.ghost.style.left = `${e.clientX}px`;
    drag.ghost.style.top = `${e.clientY - 18}px`;
    const cell = cellAt(e.clientX, e.clientY - 18);
    if (drag.over && drag.over !== cell) drag.over.classList.remove('drop');
    drag.over = cell;
    if (cell) cell.classList.add('drop');
  }
  function endDragListeners() {
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    window.removeEventListener('pointercancel', onDragCancel);
    if (drag && drag.ghost) drag.ghost.remove();
    if (drag && drag.over) drag.over.classList.remove('drop');
  }
  function onDragCancel() { endDragListeners(); drag = null; }
  function onDragEnd(e) {
    if (!drag || e.pointerId !== drag.pid) return;
    const d = drag;
    endDragListeners();
    drag = null;
    if (!view || !canArrange()) return;
    if (!d.moved) {
      // A tap: rack tile toggles selection; a pending board tile goes back to the rack.
      if (d.src.from === 'board') unplace(d.src.key);
      else { selected = selected === d.i ? null : d.i; sfx.play('select'); render(); }
      return;
    }
    const cell = cellAt(e.clientX, e.clientY - 18);
    if (cell) {
      const r = Number(cell.dataset.r);
      const c = Number(cell.dataset.c);
      const k = `${r},${c}`;
      if (d.src.from === 'board' && d.src.key === k) { render(); return; }
      if (!board[r][c] && !pending.has(k)) {
        const prevLetter = d.src.from === 'board' ? pending.get(d.src.key).letter : null;
        if (d.src.from === 'board') pending.delete(d.src.key);
        placeTile(d.i, r, c, view.myRack[d.i] === '?' ? prevLetter : undefined);
        return;
      }
      render();
      return;
    }
    // Dropped elsewhere (e.g. back on the rack): a board tile returns; a rack tile reorders.
    const rackEl = root.querySelector('.scr-rack');
    const rb = rackEl && rackEl.getBoundingClientRect();
    if (d.src.from === 'board') { unplace(d.src.key); return; }
    if (rb && e.clientY >= rb.top - 30 && e.clientY <= rb.bottom + 30) {
      const tiles = [...rackEl.querySelectorAll('[data-i]')];
      let pos = tiles.length;
      for (let k = 0; k < tiles.length; k++) {
        const b = tiles[k].getBoundingClientRect();
        if (e.clientX < b.left + b.width / 2) { pos = k; break; }
      }
      const visible = tiles.map((t) => Number(t.dataset.i));
      const target = visible[pos];
      order = order.filter((x) => x !== d.i);
      const at = target == null ? order.length : order.indexOf(target);
      order.splice(at === -1 ? order.length : at, 0, d.i);
      sfx.play('blip');
    }
    render();
  }

  function onCellClick(r, c) {
    if (!canArrange() || exchangeMode) return;
    if (selected != null && !board[r][c] && !pending.has(`${r},${c}`)) placeTile(selected, r, c);
  }

  // ---- rendering ----
  function seatName(i) {
    const s = view.seats[i];
    return s ? s.name : '—';
  }

  function statusText() {
    if (view.phase === 'waiting') {
      const n = view.seats.length;
      if (n < 2) return { text: 'WAITING FOR PLAYERS — need 2 to 4 (add a bot to play now)' };
      return { text: seated() ? `${n} PLAYERS READY — press START GAME` : `${n} PLAYERS SEATED — waiting for a player to start` };
    }
    if (view.phase === 'game_over') {
      const fin = (view.endInfo && view.endInfo.final) || [];
      const best = fin.filter((f) => f.winner);
      const why = { out: 'a player went out', scoreless: 'six scoreless turns', left: 'a player left' }[view.endInfo && view.endInfo.reason] || '';
      return { text: `GAME OVER — ${best.length > 1 ? 'TIE' : `${(best[0] && best[0].name) || '?'} WINS`}${why ? ` (${why})` : ''}`, cls: 'over' };
    }
    if (myTurn()) return { text: exchangeMode ? '▶ YOUR TURN — pick tiles to exchange, then CONFIRM' : '▶ YOUR TURN — place tiles to form a word', cls: 'mine' };
    return { text: `${seatName(view.turnIdx).toUpperCase()} IS THINKING…` };
  }

  function renderSeats() {
    const wrap = el('div', 'scr-seats');
    const final = view.phase === 'game_over' && view.endInfo ? view.endInfo.final : null;
    const list = final ? final.map((f) => ({ ...f, rackCount: f.rack.length })) : view.seats;
    list.forEach((s, i) => {
      const box = el('div', 'scr-seat');
      if (view.phase === 'playing' && i === view.turnIdx) box.classList.add('turn');
      if (s.id === me()) box.classList.add('me');
      box.appendChild(el('div', 'scr-seat-name', `${final && s.winner ? '👑 ' : ''}${s.name}`));
      box.appendChild(el('div', 'scr-seat-score', String(s.score)));
      const sub = el('div', 'scr-seat-sub');
      if (final) {
        sub.textContent = s.out ? `went out (+${s.delta})` : `${s.delta ? `${s.delta} ` : ''}left: ${s.rack.map((l) => l.toUpperCase()).join('') || '—'}`;
      } else if (view.phase === 'playing') {
        sub.textContent = `${s.rackCount} tiles`;
      }
      if (!final && s.bot && view.phase !== 'playing') {
        sub.appendChild(levelSelect(s.level, (level) => api.sendAction({ kind: 'setBotLevel', id: s.id, level })));
        sub.appendChild(btn('✕', () => api.sendAction({ kind: 'removeBot', id: s.id })));
      }
      box.appendChild(sub);
      wrap.appendChild(box);
    });
    return wrap;
  }

  function renderLobby() {
    const row = el('div', 'scr-lobby');
    if (view.phase === 'playing') {
      if (seated()) row.appendChild(btn('RESIGN', () => api.sendAction({ kind: 'resign' })));
      return row;
    }
    const n = view.seats.length;
    if (!seated() && n < 4) row.appendChild(btn('SIT DOWN', () => api.sendAction({ kind: 'sit' })));
    if (n < 4) {
      const sel = levelSelect(preferredLevel());
      row.appendChild(btn('PLAY VS BOT', () => api.sendAction({ kind: 'addBot', level: sel.value })));
      row.appendChild(sel);
    }
    if (seated() && n >= 2) row.appendChild(btn(view.phase === 'game_over' ? 'NEW GAME' : 'START GAME', () => api.sendAction({ kind: 'startGame' }), 'primary'));
    if (seated()) row.appendChild(btn('LEAVE SEAT', () => api.sendAction({ kind: 'leaveSeat' })));
    return row;
  }

  function tileEl(letter, blank, extra) {
    const t = el('div', `scr-tile${blank ? ' blank' : ''}${extra ? ` ${extra}` : ''}`);
    t.appendChild(document.createTextNode(letter === '?' ? '' : letter));
    if (!blank && letter !== '?') t.appendChild(el('span', 'v', String(VALUES[letter])));
    return t;
  }

  function renderBoard() {
    const g = el('div', 'scr-board');
    if (myTurn()) g.classList.add('myturn');
    const last = new Set(((view.lastMove && view.lastMove.tiles) || []).map((t) => `${t.r},${t.c}`));
    const targetable = canArrange() && selected != null;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const k = `${r},${c}`;
        const prem = PREMIUM[r][c];
        const cell = el('div', `scr-cell${prem ? ` ${prem}` : ''}`);
        cell.dataset.r = String(r);
        cell.dataset.c = String(c);
        const b = board[r][c];
        const p = pending.get(k);
        if (b) {
          cell.appendChild(tileEl(b.l, b.b, `${last.has(k) ? 'last' : ''}${freshCells.has(k) ? ' fresh' : ''}`));
        } else if (p) {
          const t = tileEl(p.letter, view.myRack[p.i] === '?', 'pending');
          t.addEventListener('pointerdown', (e) => startDrag(e, { from: 'board', key: k }));
          cell.appendChild(t);
        } else {
          if (r === 7 && c === 7) { cell.classList.add('star'); cell.textContent = '★'; } else if (prem) cell.textContent = PREMIUM_SHORT[prem];
          if (prem) cell.title = PREMIUM_LABEL[prem];
          if (targetable) cell.classList.add('target');
          cell.addEventListener('click', () => onCellClick(r, c));
        }
        g.appendChild(cell);
      }
    }
    return g;
  }

  function renderRack() {
    const row = el('div', 'scr-rackrow');
    const rack = el('div', 'scr-rack');
    const used = usedIdx();
    // Keep `order` a permutation of the current rack indices.
    if (order.length !== view.myRack.length) order = view.myRack.map((_, i) => i);
    for (const i of order) {
      if (used.has(i)) { rack.appendChild(el('div', 'scr-slot')); continue; }
      const L = view.myRack[i];
      const t = tileEl(L, L === '?', selected === i ? 'sel' : exchangeSel.has(i) ? 'xsel' : '');
      t.dataset.i = String(i);
      if (L === '?') t.title = 'Blank — choose any letter when you place it';
      if (exchangeMode) {
        t.addEventListener('click', () => {
          if (exchangeSel.has(i)) exchangeSel.delete(i); else exchangeSel.add(i);
          sfx.play('select');
          render();
        });
      } else t.addEventListener('pointerdown', (e) => startDrag(e, { from: 'rack', i }));
      rack.appendChild(t);
    }
    row.appendChild(rack);
    return row;
  }

  function previewHtml() {
    if (!pending.size) return { cls: '', html: myTurn() ? 'Drag tiles onto the board — or tap a tile, then a square.' : '' };
    if (!myTurn()) return { cls: '', html: 'Planning ahead — you can submit on your turn.' };
    if (!preview || preview.key !== pendingKey()) return { cls: '', html: 'checking…' };
    const esc = (s) => String(s).replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
    if (preview.ok) {
      const ws = preview.words.map((w) => `${esc(w.word.toUpperCase())} ${w.score}`).join(' + ');
      return { cls: 'ok', html: `✓ ${ws}${preview.bingo ? ' + BINGO 50' : ''} = <b>${preview.score}</b>` };
    }
    if (preview.reason === 'not_word' && preview.bad) {
      return { cls: 'bad', html: `✗ Not in the dictionary: ${preview.bad.map((w) => esc(w.toUpperCase())).join(', ')}` };
    }
    return { cls: 'bad', html: `✗ ${esc(REASONS[preview.reason] || 'Invalid move')}` };
  }
  function updatePreviewEl() {
    const p = root.querySelector('.scr-preview');
    if (!p) return;
    const { cls, html } = previewHtml();
    p.className = `scr-preview ${cls}`;
    p.innerHTML = html;
    const sub = root.querySelector('[data-act="submit"]');
    if (sub) sub.disabled = !myTurn() || !pending.size || (preview && preview.key === pendingKey() && !preview.ok);
  }

  function renderControls() {
    const row = el('div', 'scr-controls');
    if (!canArrange()) return row;
    const turn = myTurn();
    if (exchangeMode) {
      row.appendChild(btn(exchangeSel.size ? `CONFIRM EXCHANGE (${exchangeSel.size})` : 'CANCEL EXCHANGE', doExchange, 'primary'));
      if (exchangeSel.size) row.appendChild(btn('CANCEL', () => { exchangeMode = false; exchangeSel.clear(); render(); }));
      return row;
    }
    const sub = btn('SUBMIT', submit, 'primary');
    sub.dataset.act = 'submit';
    row.appendChild(sub);
    const rc = btn('RECALL', recall);
    rc.disabled = !pending.size;
    row.appendChild(rc);
    row.appendChild(btn('SHUFFLE', shuffle));
    const ex = btn('EXCHANGE', doExchange);
    ex.disabled = !turn || view.bagCount < 7;
    if (view.bagCount < 7) ex.title = 'Need at least 7 tiles in the bag';
    row.appendChild(ex);
    const ps = btn('PASS', () => api.sendAction({ kind: 'pass' }));
    ps.disabled = !turn;
    row.appendChild(ps);
    return row;
  }

  function logLine(e) {
    const line = el('div', `e${e.bingo ? ' bingo' : ''}`);
    const who = e.name || (view.seats[e.seat] ? view.seats[e.seat].name : '?');
    line.appendChild(el('span', 'who', who));
    let what;
    if (e.type === 'play') what = e.words.map((w) => w.word).join(', ');
    else if (e.type === 'exchange') what = `exchanged ${e.count}`;
    else what = 'passed';
    line.appendChild(el('span', 'what', what));
    line.appendChild(el('span', 'pts', e.type === 'play' ? `+${e.score}` : '—'));
    return line;
  }

  function renderSide() {
    const side = el('div', 'scr-side');
    const bag = el('div', 'scr-box scr-bag');
    bag.innerHTML = `TILES IN BAG: <b>${view.bagCount}</b>`;
    if (view.phase === 'playing' && view.scorelessStreak >= 3) {
      bag.appendChild(el('div', null, `Scoreless turns: ${view.scorelessStreak}/6`));
    }
    side.appendChild(bag);
    const logBox = el('div', 'scr-box');
    logBox.appendChild(el('h4', null, 'MOVES'));
    const log = el('div', 'scr-log');
    if (!view.log.length) log.appendChild(el('div', null, view.phase === 'playing' ? 'No moves yet.' : '—'));
    for (const e of view.log.slice().reverse()) log.appendChild(logLine(e));
    logBox.appendChild(log);
    side.appendChild(logBox);
    const legend = el('div', 'scr-box scr-legend');
    for (const k of ['TW', 'DW', 'TL', 'DL']) {
      const sw = el('span', `k scr-cell ${k}`);
      legend.appendChild(sw);
      legend.appendChild(el('span', null, PREMIUM_LABEL[k]));
    }
    side.appendChild(legend);
    return side;
  }

  function renderResults() {
    if (!view || view.phase !== 'game_over' || !view.endInfo) { results.update(null); return; }
    const fin = view.endInfo.final.map((f, i) => ({ ...f, i }));
    const sorted = fin.slice().sort((a, b) => b.score - a.score);
    const mine = fin.find((f) => f.id === me());
    const winners = fin.filter((f) => f.winner);
    const tie = winners.length > 1;
    const why = { out: 'Bag empty — a player went out', scoreless: 'Six scoreless turns in a row', left: 'A player left the game' }[view.endInfo.reason] || 'Game over';
    results.update({
      title: mine ? (mine.winner ? (tie ? 'TIE FOR FIRST!' : 'YOU WIN!') : 'YOU LOSE') : (tie ? "IT'S A TIE" : `${winners[0] ? winners[0].name : '?'} WINS`),
      subtitle: why,
      outcome: mine ? (mine.winner ? (tie ? 'draw' : 'win') : 'lose') : 'over',
      rows: sorted.map((f) => ({ name: f.name, value: `${f.score}${f.delta ? ` (${f.delta > 0 ? '+' : ''}${f.delta})` : ''}`, win: f.winner, you: f.id === me() })),
      rematch: seated() && view.seats.length >= 2 ? { label: 'REMATCH', onClick: () => api.sendAction({ kind: 'startGame' }) } : null,
    });
  }

  function render() {
    renderResults();
    root.innerHTML = '';
    if (!view) { root.textContent = 'Loading…'; return; }
    const st = statusText();
    root.appendChild(el('div', `scr-status${st.cls ? ` ${st.cls}` : ''}`, st.text));
    root.appendChild(el('div', 'scr-flash', flash || ''));
    root.appendChild(renderSeats());
    root.appendChild(renderLobby());
    const main = el('div', 'scr-main');
    const col = el('div', 'scr-boardcol');
    col.appendChild(renderBoard());
    if (canArrange()) {
      col.appendChild(renderRack());
      col.appendChild(el('div', 'scr-preview'));
      col.appendChild(renderControls());
    } else if (view.phase === 'playing') {
      col.appendChild(el('div', 'scr-preview', 'Spectating — racks are hidden.'));
    }
    main.appendChild(col);
    main.appendChild(renderSide());
    root.appendChild(main);
    if (canArrange()) updatePreviewEl();
  }

  function onKey(e) {
    if (!view || !canArrange() || modal) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'Enter' && myTurn() && pending.size) { e.preventDefault(); submit(); } else if (e.key === 'Escape') { recall(); }
  }
  window.addEventListener('keydown', onKey);

  function applyState(next) {
    const prev = view;
    view = next;
    board = decodeBoard(view.board);
    const boardStr = view.board.join('');
    freshCells = new Set();
    if (prevBoardStr && prev && prev.gameId === view.gameId && boardStr !== prevBoardStr) {
      for (let k = 0; k < boardStr.length; k++) if (boardStr[k] !== '.' && prevBoardStr[k] === '.') freshCells.add(`${Math.floor(k / SIZE)},${k % SIZE}`);
    }
    prevBoardStr = boardStr;
    syncLocal();
    if (prev) {
      const lastPrev = prev.log.length ? prev.log[prev.log.length - 1] : null;
      const lastNow = view.log.length ? view.log[view.log.length - 1] : null;
      if (prev.gameId !== view.gameId && view.phase === 'playing') sfx.play('deal');
      else if (lastNow && (!lastPrev || lastNow.n !== lastPrev.n || view.log.length !== prev.log.length)) {
        const mineMove = view.seats[lastNow.seat] && view.seats[lastNow.seat].id === me();
        if (lastNow.type === 'play') sfx.play(lastNow.bingo ? 'chime' : mineMove ? 'point' : 'card');
        else if (lastNow.type === 'exchange') sfx.play('swap');
        else sfx.play('tick');
      }
      if (view.phase === 'playing' && myTurn() && !(prev.phase === 'playing' && prev.turnIdx === view.turnIdx && prev.mySeat === view.mySeat)) {
        setTimeout(() => sfx.play('turn'), 250);
      }
      if (prev.phase === 'playing' && view.phase === 'game_over' && view.endInfo) {
        const mine = view.endInfo.final.find((f) => f.id === me());
        sfx.play(mine ? (mine.winner ? 'win' : 'lose') : 'chime');
      }
    }
    render();
  }

  return {
    applySnapshot(snapshot) {
      if (snapshot) applyState(snapshot);
    },
    applyEvent(data) {
      if (!data) return;
      if (data.kind === 'state') applyState(data);
      else if (data.kind === 'preview') {
        preview = data;
        updatePreviewEl();
      } else if (data.kind === 'moveRejected') {
        sfx.play('error');
        if (data.reason === 'not_word' && data.bad && data.bad.length) showFlash(`Not in the dictionary: ${data.bad.map((w) => w.toUpperCase()).join(', ')}`);
        else showFlash(REASONS[data.reason] || 'Move rejected');
      }
    },
    applyRoster(newRoster) {
      roster = newRoster || [];
      void roster;
      if (view) render();
    },
    unmount() {
      window.removeEventListener('keydown', onKey);
      endDragListeners();
      drag = null;
      closeModal();
      clearTimeout(previewTimer);
      clearTimeout(flashTimer);
      results.destroy();
      container.innerHTML = '';
    },
  };
}
