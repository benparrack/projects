// Blockade client: canvas board, your pawns always at the bottom (P2 sees it rotated 180°).
// Move step: click a pawn, then a highlighted square (or click a square only one pawn can reach).
// Wall step: hover a groove to preview (orientation follows the groove under the pointer,
// right-click / R flips it), click to place; on touch, tap to preview then PLACE WALL / ROTATE.
// The rules below mirror server/games/ai/blockadeEngine.js for previews only — the server decides.
import { sfx } from '../sfx.js';
import { preferredLevel, levelSelect } from '../botLevel.js';
import { createResults, duelResults } from '../resultsPanel.js';
import { injectStyle } from '../dom.js';

const COLS = 11;
const ROWS = 14;
const WC = COLS - 1;
const SEAT_COLOR = { p1: '#39ff14', p2: '#3ad7ff' };
const SEAT_DARK = { p1: '#1f8f0c', p2: '#1d6f8f' };
const SEAT_LABEL = { p1: 'P1', p2: 'P2' };
const other = (s) => (s === 'p1' ? 'p2' : 'p1');

const REJECT_MESSAGES = {
  not_your_turn: "It's not your turn",
  move_first: 'Move a pawn first',
  place_wall: 'Now place a wall',
  bad_move: "That pawn can't go there",
  bad_wall: "A wall can't go there (overlaps, or would seal someone in)",
  not_playing: 'The game is not in progress',
  not_seated: 'Take a seat to play',
};

// ---- rules mirror (preview only) ----
function steps(H, V, i) {
  const r = Math.floor(i / COLS);
  const c = i % COLS;
  const out = [];
  const h = (rr, cc) => cc >= 0 && cc < WC && H[rr * WC + cc];
  const v = (rr, cc) => rr >= 0 && rr < ROWS - 1 && V[rr * WC + cc];
  if (r > 0 && !h(r - 1, c) && !h(r - 1, c - 1)) out.push(i - COLS);
  if (r < ROWS - 1 && !h(r, c) && !h(r, c - 1)) out.push(i + COLS);
  if (c > 0 && !v(r, c - 1) && !v(r - 1, c - 1)) out.push(i - 1);
  if (c < COLS - 1 && !v(r, c) && !v(r - 1, c)) out.push(i + 1);
  return out;
}
function targets(view, seat, idx) {
  const from = view.pawns[seat][idx];
  const goals = view.start[other(seat)];
  const occ = new Set([...view.pawns.p1, ...view.pawns.p2]);
  const out = new Set();
  for (const a of steps(view.H, view.V, from)) {
    out.add(a);
    for (const b of steps(view.H, view.V, a)) if (b !== from) out.add(b);
  }
  return [...out].filter((t) => !occ.has(t) || goals.includes(t));
}
function wallOk(view, o, r, c) {
  if (r < 0 || r >= ROWS - 1 || c < 0 || c >= WC) return false;
  const { H, V } = view;
  const k = r * WC + c;
  if (H[k] || V[k]) return false;
  if (o === 'h' ? (c > 0 && H[k - 1]) || (c < WC - 1 && H[k + 1]) : (r > 0 && V[k - WC]) || (r < ROWS - 2 && V[k + WC])) return false;
  const H2 = o === 'h' ? H.slice() : H;
  const V2 = o === 'v' ? V.slice() : V;
  (o === 'h' ? H2 : V2)[k] = 1;
  for (const s of ['p1', 'p2']) {
    const seen = new Set(view.start[other(s)]);
    const q = [...seen];
    for (let i = 0; i < q.length; i++) for (const j of steps(H2, V2, q[i])) if (!seen.has(j)) { seen.add(j); q.push(j); }
    if (view.pawns[s].some((p) => !seen.has(p))) return false;
  }
  return true;
}

const CSS = `
.bk-root { display: flex; flex-direction: column; align-items: center; gap: 8px; width: 100%; }
.bk-status { font-size: 18px; font-weight: bold; padding: 6px 14px; border-radius: 6px; border: 2px solid transparent; text-align: center; }
.bk-status.mine { background: rgba(57,255,20,.15); border-color: #39ff14; }
.bk-err { color: #ff4d4d; min-height: 1.2em; font-size: 14px; text-align: center; }
.bk-row { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; align-items: center; }
.bk-seat { display: flex; gap: 6px; align-items: center; padding: 4px 8px; border: 1px solid #1f8f0c; border-radius: 6px; }
.bk-seat.turn { border-color: #39ff14; box-shadow: 0 0 10px -2px #39ff14; }
.bk-chip { width: 12px; height: 12px; border-radius: 50%; display: inline-block; }
.bk-walls { font-size: 12px; opacity: .85; white-space: nowrap; }
.bk-canvas { display: block; border-radius: 10px; touch-action: manipulation; cursor: pointer; }
.bk-hint { font-size: 12px; opacity: .65; text-align: center; max-width: 460px; }
`;

export function mount(container, api) {
  injectStyle(CSS);
  let view = null;
  let roster = [];
  let flashTimer = null;
  let selected = null; // pawn index
  let hover = null; // { cell, wall:{o,r,c} }
  let flip = false; // orientation override (right-click / R / ROTATE)
  let pending = null; // touch: wall awaiting confirm
  let lastPointer = 'mouse';
  let anim = null; // { seat, pawn, from, to, t0 }
  let chromeKey = null;
  let s = 40; // cell pitch px
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const root = document.createElement('div');
  root.className = 'bk-root';
  container.appendChild(root);
  const status = document.createElement('div');
  status.className = 'bk-status';
  const err = document.createElement('div');
  err.className = 'bk-err';
  const chrome = document.createElement('div');
  chrome.className = 'bk-row';
  const touchRow = document.createElement('div');
  touchRow.className = 'bk-row';
  const canvas = document.createElement('canvas');
  canvas.className = 'bk-canvas';
  const ctx = canvas.getContext('2d');
  const hint = document.createElement('div');
  hint.className = 'bk-hint';
  hint.textContent = 'Each turn: move one pawn 1–2 squares, then drop a wall. Reach either glowing enemy home square to win. Walls may never seal anyone in. Right-click or R rotates a wall.';
  const tally = document.createElement('div');
  tally.className = 'bk-walls';
  root.append(status, err, chrome, canvas, touchRow, tally, hint);
  const results = createResults(container);

  const nicknameFor = (id) => {
    if (!id) return null;
    if (id === 'BOT') return '(bot)';
    const e = roster.find((r) => r.clientId === id);
    return e ? e.nickname : 'someone';
  };
  const mySeat = () => (view ? ['p1', 'p2'].find((x) => view.players[x] === api.getClientId()) || null : null);
  const seatName = (x) => (view.players[x] === 'BOT' ? `Bot (${(view.botLevels || {})[x] || 'hard'})` : nicknameFor(view.players[x]) || '(empty)');
  const myTurn = () => view && view.phase === 'playing' && mySeat() === view.turn;
  const rotated = () => mySeat() === 'p2';

  // ---- geometry ----
  const M = () => Math.round(s * 0.3); // outer margin
  function size() {
    s = Math.max(26, Math.min(44, Math.floor((Math.min(window.innerWidth, 900) - 50) / COLS), Math.floor((window.innerHeight - 300) / ROWS)));
    const w = COLS * s + 2 * M();
    const h = ROWS * s + 2 * M();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  // Pointer -> board coords (in cells, 0..COLS / 0..ROWS), undoing the P2 rotation.
  function toBoard(e) {
    const rect = canvas.getBoundingClientRect();
    let x = (e.clientX - rect.left - M()) / s;
    let y = (e.clientY - rect.top - M()) / s;
    if (rotated()) { x = COLS - x; y = ROWS - y; }
    return { x, y };
  }
  function cellAt({ x, y }) {
    const c = Math.floor(x);
    const r = Math.floor(y);
    return r >= 0 && r < ROWS && c >= 0 && c < COLS ? r * COLS + c : null;
  }
  function wallAt({ x, y }, forceO) {
    const dx = Math.abs(x - Math.round(x));
    const dy = Math.abs(y - Math.round(y));
    let o = dy < dx ? 'h' : 'v';
    if (flip) o = o === 'h' ? 'v' : 'h';
    if (forceO) o = forceO;
    const left = view.left[view.turn];
    if (!left[o] && left[o === 'h' ? 'v' : 'h']) o = o === 'h' ? 'v' : 'h';
    const r = Math.min(ROWS - 2, Math.max(0, o === 'h' ? Math.round(y) - 1 : Math.floor(y - 0.5)));
    const c = Math.min(WC - 1, Math.max(0, o === 'h' ? Math.floor(x - 0.5) : Math.round(x) - 1));
    return { o, r, c };
  }

  // ---- drawing ----
  function rr(x, y, w, h, rad) {
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, w, h, rad) : ctx.rect(x, y, w, h);
  }
  function wallRect(o, r, c) {
    const g = s * 0.2;
    const len = 2 * s - g * 0.6;
    return o === 'h' ? [c * s + g * 0.3, (r + 1) * s - g / 2, len, g] : [(c + 1) * s - g / 2, r * s + g * 0.3, g, len];
  }
  function draw() {
    if (!view) return;
    const W = COLS * s + 2 * M();
    const Hh = ROWS * s + 2 * M();
    ctx.save();
    ctx.clearRect(0, 0, W, Hh);
    ctx.fillStyle = '#060a06';
    rr(0, 0, W, Hh, 10);
    ctx.fill();
    ctx.translate(M(), M());
    if (rotated()) { ctx.translate(COLS * s, ROWS * s); ctx.rotate(Math.PI); }
    const seat = mySeat();
    const g = s * 0.2;
    const now = performance.now();
    // cells
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        ctx.fillStyle = (r + c) % 2 ? '#18231a' : '#1c291e';
        rr(c * s + g / 2, r * s + g / 2, s - g, s - g, 4);
        ctx.fill();
      }
    }
    // home squares: each side's homes are the other side's goals
    for (const x of ['p1', 'p2']) {
      for (const i of view.start[x]) {
        const r = Math.floor(i / COLS);
        const c = i % COLS;
        const goalOfMine = seat && x !== seat;
        const pulse = goalOfMine && !reduced ? 0.35 + 0.25 * Math.sin(now / 300) : 0.35;
        ctx.fillStyle = SEAT_DARK[x];
        ctx.globalAlpha = pulse + 0.2;
        rr(c * s + g / 2, r * s + g / 2, s - g, s - g, 4);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = SEAT_COLOR[x];
        ctx.lineWidth = goalOfMine ? 3 : 1.5;
        ctx.stroke();
        ctx.save();
        ctx.translate((c + 0.5) * s, (r + 0.5) * s);
        if (rotated()) ctx.rotate(Math.PI);
        ctx.fillStyle = SEAT_COLOR[x];
        ctx.globalAlpha = 0.55;
        ctx.font = `bold ${Math.round(s * 0.42)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('★', 0, 0);
        ctx.restore();
      }
    }
    // move targets
    if (myTurn() && view.step === 'move' && selected != null) {
      for (const t of targets(view, seat, selected)) {
        const r = Math.floor(t / COLS);
        const c = t % COLS;
        const win = view.start[other(seat)].includes(t);
        ctx.fillStyle = win ? '#ffb000' : SEAT_COLOR[seat];
        ctx.globalAlpha = hover && hover.cell === t ? 0.9 : 0.45;
        ctx.beginPath();
        ctx.arc((c + 0.5) * s, (r + 0.5) * s, s * (win ? 0.28 : 0.16), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    // walls
    const lw = view.lastWall;
    for (const o of ['h', 'v']) {
      const arr = o === 'h' ? view.H : view.V;
      for (let k = 0; k < arr.length; k++) {
        if (!arr[k]) continue;
        const r = Math.floor(k / WC);
        const c = k % WC;
        const owner = view.wallOwner[`${o}${k}`] || 'p1';
        const isLast = lw && lw.o === o && lw.r === r && lw.c === c;
        ctx.fillStyle = SEAT_COLOR[owner];
        ctx.shadowColor = SEAT_COLOR[owner];
        ctx.shadowBlur = isLast ? 14 : 4;
        rr(...wallRect(o, r, c), 3);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
    // wall preview
    const pw = pending || (myTurn() && view.step === 'wall' && hover && hover.wall);
    if (pw) {
      const ok = wallOk(view, pw.o, pw.r, pw.c) && view.left[seat][pw.o] > 0;
      ctx.fillStyle = ok ? SEAT_COLOR[seat] : '#ff4d4d';
      ctx.globalAlpha = pending ? 0.85 : 0.5;
      rr(...wallRect(pw.o, pw.r, pw.c), 3);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    // pawns
    for (const x of ['p1', 'p2']) {
      view.pawns[x].forEach((p, idx) => {
        let px = (p % COLS) + 0.5;
        let py = Math.floor(p / COLS) + 0.5;
        if (anim && anim.seat === x && anim.pawn === idx) {
          const k = Math.min(1, Math.max(0, (now - anim.t0) / 260));
          const e = 1 - (1 - k) * (1 - k);
          px = (anim.from % COLS) + 0.5 + ((anim.to % COLS) - (anim.from % COLS)) * e;
          py = Math.floor(anim.from / COLS) + 0.5 + (Math.floor(anim.to / COLS) - Math.floor(anim.from / COLS)) * e;
        }
        const sel = x === seat && selected === idx && myTurn() && view.step === 'move';
        const grad = ctx.createRadialGradient(px * s - s * 0.1, py * s - s * 0.12, s * 0.04, px * s, py * s, s * 0.34);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.35, SEAT_COLOR[x]);
        grad.addColorStop(1, SEAT_DARK[x]);
        ctx.fillStyle = grad;
        ctx.shadowColor = SEAT_COLOR[x];
        ctx.shadowBlur = sel ? 16 : 5;
        ctx.beginPath();
        ctx.arc(px * s, py * s, s * 0.32, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        if (sel) {
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      });
    }
    ctx.restore();
  }

  let raf = 0;
  const loop = () => {
    draw();
    const animating = anim && performance.now() - anim.t0 < 260;
    const pulsing = !reduced && view && view.phase === 'playing' && mySeat();
    raf = animating || pulsing ? requestAnimationFrame(loop) : 0;
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };

  // ---- input ----
  function sendMove(idx, to) {
    selected = null;
    api.sendAction({ kind: 'move', pawn: idx, to });
  }
  function placeWall(w) {
    pending = null;
    renderTouchRow();
    if (!wallOk(view, w.o, w.r, w.c) || !view.left[mySeat()][w.o]) { sfx.play('error'); return; }
    api.sendAction({ kind: 'wall', o: w.o, r: w.r, c: w.c });
  }
  canvas.addEventListener('pointermove', (e) => {
    if (!view || e.pointerType === 'touch') return;
    const b = toBoard(e);
    hover = { cell: cellAt(b), wall: myTurn() && view.step === 'wall' ? wallAt(b) : null };
    kick();
  });
  canvas.addEventListener('pointerleave', () => { hover = null; kick(); });
  canvas.addEventListener('pointerdown', (e) => { lastPointer = e.pointerType; });
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    flip = !flip;
    if (view && hover) hover.wall = myTurn() && view.step === 'wall' ? wallAt(toBoard(e)) : null;
    kick();
  });
  canvas.addEventListener('click', (e) => {
    if (!myTurn()) return;
    const seat = mySeat();
    const b = toBoard(e);
    if (view.step === 'wall') {
      const w = wallAt(b);
      if (lastPointer === 'touch') {
        const same = pending && pending.o === w.o && pending.r === w.r && pending.c === w.c;
        if (same) placeWall(w);
        else { pending = w; renderTouchRow(); kick(); }
        return;
      }
      placeWall(w);
      return;
    }
    const cell = cellAt(b);
    if (cell == null) return;
    const own = view.pawns[seat].indexOf(cell);
    if (own >= 0) {
      selected = selected === own ? null : own;
      sfx.play('select');
      kick();
      return;
    }
    if (selected != null && targets(view, seat, selected).includes(cell)) return sendMove(selected, cell);
    const able = [0, 1].filter((i) => targets(view, seat, i).includes(cell));
    if (able.length === 1) return sendMove(able[0], cell);
    sfx.play('error');
  });
  const onKey = (e) => {
    if ((e.key === 'r' || e.key === 'R') && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName)) {
      flip = !flip;
      if (pending) pending = { ...pending, o: pending.o === 'h' ? 'v' : 'h' };
      kick();
    }
  };
  window.addEventListener('keydown', onKey);

  function renderTouchRow() {
    touchRow.innerHTML = '';
    if (!pending || !myTurn() || view.step !== 'wall') return;
    const place = document.createElement('button');
    place.textContent = 'PLACE WALL';
    place.addEventListener('click', () => placeWall(pending));
    const rot = document.createElement('button');
    rot.textContent = 'ROTATE ⟳';
    rot.addEventListener('click', () => { pending = { ...pending, o: pending.o === 'h' ? 'v' : 'h' }; kick(); });
    const cancel = document.createElement('button');
    cancel.textContent = 'CANCEL';
    cancel.addEventListener('click', () => { pending = null; renderTouchRow(); kick(); });
    touchRow.append(place, rot, cancel);
  }

  // ---- DOM chrome ----
  function seatBox(x) {
    const box = document.createElement('div');
    box.className = `bk-seat${view.phase === 'playing' && view.turn === x ? ' turn' : ''}`;
    const chip = document.createElement('span');
    chip.className = 'bk-chip';
    chip.style.background = SEAT_COLOR[x];
    const name = document.createElement('span');
    name.textContent = `${SEAT_LABEL[x]}: ${seatName(x)}${view.players[x] === api.getClientId() ? ' (you)' : ''}`;
    const walls = document.createElement('span');
    walls.className = 'bk-walls';
    walls.textContent = `▬${view.left[x].h} ▮${view.left[x].v}`;
    walls.title = 'Horizontal / vertical walls left';
    box.append(chip, name, walls);
    if (!view.players[x]) {
      if (!mySeat()) {
        const btn = document.createElement('button');
        btn.textContent = `PLAY ${SEAT_LABEL[x]}`;
        btn.addEventListener('click', () => api.sendAction({ kind: 'sit', seat: x }));
        box.appendChild(btn);
      }
      const bot = document.createElement('button');
      bot.textContent = 'PLAY VS BOT';
      bot.addEventListener('click', () => api.sendAction({ kind: 'sit', seat: x, bot: true, level: preferredLevel() }));
      box.append(bot, levelSelect(preferredLevel()));
    } else if (view.players[x] === 'BOT') {
      box.appendChild(levelSelect((view.botLevels || {})[x], (level) => api.sendAction({ kind: 'setBotLevel', seat: x, level })));
      const rm = document.createElement('button');
      rm.textContent = 'REMOVE BOT';
      rm.addEventListener('click', () => api.sendAction({ kind: 'removeBot', seat: x }));
      box.appendChild(rm);
    }
    return box;
  }

  function renderChrome() {
    const seat = mySeat();
    const key = JSON.stringify([view.players, view.botLevels, view.phase, view.turn, view.left, seat, roster.map((r) => r.clientId + r.nickname)]);
    if (key === chromeKey) return;
    chromeKey = key;
    chrome.innerHTML = '';
    chrome.append(seatBox('p1'), seatBox('p2'));
    if (seat) {
      const leave = document.createElement('button');
      leave.textContent = 'LEAVE SEAT';
      leave.addEventListener('click', () => api.sendAction({ kind: 'leaveSeat' }));
      chrome.appendChild(leave);
    }
    if (view.phase === 'game_over' && seat) {
      const again = document.createElement('button');
      again.textContent = 'NEW GAME';
      again.addEventListener('click', () => api.sendAction({ kind: 'resetGame' }));
      chrome.appendChild(again);
    }
  }

  function render() {
    if (!view) { status.textContent = 'Loading...'; return; }
    const seat = mySeat();
    results.update(view.phase === 'game_over' && view.winner ? duelResults({
      winner: view.winner, colors: ['p1', 'p2'], players: view.players, me: seat,
      nameFor: (id) => (id === 'BOT' ? 'Bot' : nicknameFor(id) || '(empty)'),
      subtitle: `Reached the enemy home in ${Math.ceil((view.moveCount + 1) / 2)} turns`,
      onRematch: () => api.sendAction({ kind: 'resetGame' }),
    }) : null);
    status.classList.remove('mine');
    status.style.color = '';
    if (view.phase === 'waiting') status.textContent = 'Waiting for both seats to be filled.';
    else if (view.phase === 'game_over') { status.textContent = `${SEAT_LABEL[view.winner]} (${seatName(view.winner)}) BREAKS THROUGH`; status.style.color = '#ffb000'; }
    else if (myTurn()) {
      status.classList.add('mine');
      status.textContent = view.step === 'move' ? '▶ YOUR TURN. MOVE A PAWN 1–2 SQUARES' : '▶ NOW PLACE A WALL';
    } else {
      status.textContent = `${SEAT_LABEL[view.turn]} (${seatName(view.turn)}) ${view.step === 'move' ? 'is moving' : 'is placing a wall'}…`;
      status.style.color = SEAT_COLOR[view.turn];
    }
    tally.textContent = view.score.p1 || view.score.p2 ? `Match: P1 ${view.score.p1} · P2 ${view.score.p2}` : '';
    renderChrome();
    renderTouchRow();
    kick();
  }

  let resizeTimer = null;
  const onResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { size(); kick(); }, 150); };
  window.addEventListener('resize', onResize);
  size();
  render();

  return {
    applySnapshot(snapshot) {
      view = snapshot;
      render();
    },
    applyEvent(data) {
      if (!data) return;
      if (data.kind === 'state') {
        const prev = view;
        view = data;
        const lm = data.lastMove;
        if (prev && lm && (!prev.lastMove || prev.lastMove.id !== lm.id || prev.lastMove.seat !== lm.seat) && !reduced) {
          anim = { ...lm, t0: performance.now() };
          sfx.play('move');
        }
        const lw = data.lastWall;
        if (prev && lw && (!prev.lastWall || prev.lastWall.id !== lw.id || prev.lastWall.seat !== lw.seat)) sfx.play('slide');
        if (prev && prev.phase === 'playing' && data.phase === 'game_over') sfx.play(mySeat() ? (data.winner === mySeat() ? 'win' : 'lose') : 'point');
        if (prev && data.phase === 'playing' && myTurn() && (prev.turn !== data.turn || prev.phase !== 'playing')) setTimeout(() => sfx.play('turn'), 250);
        if (!myTurn() || data.step !== 'move') selected = null;
        if (!myTurn() || data.step !== 'wall') pending = null;
        // One pawn with moves left: pre-select it.
        if (myTurn() && data.step === 'move' && selected == null) {
          const movable = [0, 1].filter((i) => targets(data, mySeat(), i).length);
          if (movable.length === 1) selected = movable[0];
        }
        render();
      } else if (data.kind === 'moveRejected') {
        sfx.play('error');
        err.textContent = REJECT_MESSAGES[data.reason] || 'Move rejected';
        clearTimeout(flashTimer);
        flashTimer = setTimeout(() => { err.textContent = ''; }, 2500);
      }
    },
    applyRoster(newRoster) {
      roster = newRoster;
      if (view) render();
    },
    unmount() {
      cancelAnimationFrame(raf);
      clearTimeout(flashTimer);
      clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
      results.destroy();
      container.innerHTML = '';
    },
  };
}
