// Reversi — click a square with a dot to place a disc; the server validates, flips and resolves
// passes. Discs flip in 3D (rippling outward from the placed disc), the side to move gets legal-
// move dots (hover previews which discs would flip), a live score bar tracks disc counts and an
// automatic pass pops a callout. Cells carry data-row/data-col for automated testing.
import { sfx, boardSounds } from '../sfx.js';
import { preferredLevel, levelSelect } from '../botLevel.js';
import { createResults, duelResults } from '../resultsPanel.js';
import { changeTracker } from '../boardFx.js';

const N = 8;
const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

const REJECT_MESSAGES = {
  not_your_turn: "It's not your turn",
  occupied: 'That square is taken',
  no_flips: 'A move must flip at least one disc',
  invalid: 'Invalid move',
  not_playing: 'The game is not in progress',
};

const CSS = `
.rv-root { display: flex; flex-direction: column; align-items: center; gap: 10px; width: 100%; }
.rv-status { font-size: 18px; font-weight: bold; padding: 6px 14px; border-radius: 6px; border: 2px solid transparent; text-align: center; }
.rv-status.mine { background: rgba(57,255,20,.15); border-color: #39ff14; }
.rv-err { color: #ff4d4d; min-height: 1.2em; font-size: 14px; }
.rv-seats { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; align-items: center; }
.rv-seat { display: flex; gap: 6px; align-items: center; padding: 4px 8px; border: 1px solid #1f8f0c; border-radius: 6px; }
.rv-seat.turn { border-color: #39ff14; box-shadow: 0 0 10px -2px #39ff14; }
.rv-chip { width: 16px; height: 16px; border-radius: 50%; display: inline-block; flex: none; }
.rv-chip.black { background: radial-gradient(circle at 35% 30%, #666, #111 60%); border: 1px solid #555; }
.rv-chip.white { background: radial-gradient(circle at 35% 30%, #fff, #d8d8d8 60%, #aaa); border: 1px solid #ccc; }
.rv-score { display: flex; align-items: center; gap: 8px; width: min(400px, 92vw); font-weight: bold; }
.rv-bar { flex: 1; height: 12px; border-radius: 6px; overflow: hidden; display: flex; border: 1px solid #1f8f0c; background: #000; }
.rv-bar .b { background: linear-gradient(#444, #111); transition: flex-grow .45s ease; }
.rv-bar .w { background: linear-gradient(#fff, #bbb); transition: flex-grow .45s ease; }
.rv-num { min-width: 26px; text-align: center; font-size: 20px; }
.rv-num.bump { animation: rv-bump .35s ease-out; }
@keyframes rv-bump { 40% { transform: scale(1.35); color: #ffb000; } }
.rv-boardwrap { position: relative; }
.rv-board {
  --cell: min(48px, calc((92vw - 26px) / 8));
  display: grid; grid-template-columns: repeat(8, var(--cell)); grid-template-rows: repeat(8, var(--cell));
  gap: 2px; padding: 6px; border-radius: 8px; background: #0b3d1e;
  border: 3px solid #1f8f0c; box-shadow: inset 0 0 24px rgba(0,0,0,.6);
}
.rv-board.myturn { border-color: #39ff14; box-shadow: inset 0 0 24px rgba(0,0,0,.6), 0 0 14px 2px rgba(57,255,20,.45); }
.rv-cell {
  position: relative; background: radial-gradient(circle at 50% 40%, #1d7a3c, #136030 75%);
  border-radius: 3px; display: flex; align-items: center; justify-content: center; perspective: 300px;
}
.rv-cell.legal { cursor: pointer; }
.rv-cell.last { box-shadow: inset 0 0 0 2px #ffb000; }
.rv-dot { width: 28%; height: 28%; border-radius: 50%; opacity: .55; pointer-events: none; transition: transform .12s; }
.rv-dot.black { background: #050505; }
.rv-dot.white { background: #f2f2f2; }
.rv-dot.spect { opacity: .25; }
.rv-cell.legal:hover .rv-dot { transform: scale(1.3); opacity: .8; }
.rv-ghost { position: absolute; width: 82%; height: 82%; border-radius: 50%; opacity: .4; pointer-events: none; }
.rv-disc { width: 82%; height: 82%; position: relative; transform-style: preserve-3d; pointer-events: none; }
.rv-face { position: absolute; inset: 0; border-radius: 50%; backface-visibility: hidden; }
.rv-face.black { background: radial-gradient(circle at 35% 30%, #6a6a6a, #1a1a1a 55%, #000); box-shadow: 0 2px 3px rgba(0,0,0,.7), inset 0 -2px 3px rgba(255,255,255,.08); }
.rv-face.white { background: radial-gradient(circle at 35% 30%, #fff, #e6e6e6 55%, #b5b5b5); box-shadow: 0 2px 3px rgba(0,0,0,.6), inset 0 -2px 3px rgba(0,0,0,.15); }
.rv-face.back { transform: rotateY(180deg); }
.rv-preview .rv-disc { filter: brightness(1.35) drop-shadow(0 0 4px #ffb000); }
.rv-callout {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 5; pointer-events: none;
  background: rgba(5,8,10,.92); border: 2px solid #ffb000; color: #ffb000; border-radius: 8px;
  padding: 10px 18px; font-weight: bold; font-size: 18px; letter-spacing: 1px; white-space: nowrap;
  box-shadow: 0 0 22px -4px #ffb000; animation: rv-callout 2.2s ease-in-out forwards;
}
@keyframes rv-callout { 0% { opacity: 0; transform: translate(-50%, -50%) scale(.6); } 12% { opacity: 1; transform: translate(-50%, -50%) scale(1.06); } 20% { transform: translate(-50%, -50%) scale(1); } 80% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -60%); } }
.rv-btn-row { display: flex; gap: 8px; }
@media (prefers-reduced-motion: reduce) { .rv-callout, .rv-num.bump { animation: none; } }
`;

let styled = false;
function ensureStyles() {
  if (styled) return;
  styled = true;
  const tag = document.createElement('style');
  tag.textContent = CSS;
  document.head.appendChild(tag);
}

const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const opponent = (c) => (c === 'black' ? 'white' : 'black');

// Discs `color` would flip by playing (r, c) — mirrors the server's rule (used for hover preview).
export function flipsFor(board, r, c, color) {
  if (board[r][c]) return [];
  const out = [];
  for (const [dr, dc] of DIRS) {
    const line = [];
    let rr = r + dr;
    let cc = c + dc;
    while (rr >= 0 && rr < N && cc >= 0 && cc < N && board[rr][cc] === opponent(color)) {
      line.push({ r: rr, c: cc });
      rr += dr;
      cc += dc;
    }
    if (line.length && rr >= 0 && rr < N && cc >= 0 && cc < N && board[rr][cc] === color) out.push(...line);
  }
  return out;
}

function discEl(color, backColor) {
  const d = document.createElement('div');
  d.className = 'rv-disc';
  const front = document.createElement('div');
  front.className = `rv-face ${color}`;
  d.appendChild(front);
  if (backColor) {
    const back = document.createElement('div');
    back.className = `rv-face back ${backColor}`;
    d.appendChild(back);
  }
  return d;
}

export function mount(container, api) {
  ensureStyles();
  let view = null;
  let roster = [];
  let flashError = null;
  let flashTimer = null;
  let hover = null; // {r, c} under the pointer, for the flip preview
  const moveChanged = changeTracker();
  const passChanged = changeTracker();
  let prevCounts = null;
  let animUntil = 0; // hover re-renders would cut flip animations short, so hold them off

  const root = document.createElement('div');
  root.className = 'rv-root';
  container.appendChild(root);
  const results = createResults(container);

  function nicknameFor(clientId) {
    if (!clientId) return null;
    if (clientId === 'BOT') return '(bot)';
    const entry = roster.find((r) => r.clientId === clientId);
    return entry ? entry.nickname : 'someone';
  }

  function mySeat() {
    const me = api.getClientId();
    if (!view) return null;
    if (view.players.black === me) return 'black';
    if (view.players.white === me) return 'white';
    return null;
  }

  function play(r, c) {
    const seat = mySeat();
    if (!seat || view.phase !== 'playing' || view.turn !== seat) return;
    if (!view.legal.some((m) => m.r === r && m.c === c)) {
      sfx.play('error');
      return;
    }
    hover = null;
    api.sendAction({ kind: 'move', r, c });
  }

  function seatLabel(color) {
    const box = document.createElement('div');
    box.className = `rv-seat${view.phase === 'playing' && view.turn === color ? ' turn' : ''}`;
    const chip = document.createElement('span');
    chip.className = `rv-chip ${color}`;
    const name = document.createElement('span');
    const occupant = nicknameFor(view.players[color]);
    name.textContent = `${color.toUpperCase()}: ${occupant || '(empty)'}${view.players[color] === api.getClientId() ? ' (you)' : ''}`;
    box.append(chip, name);
    const seat = mySeat();
    if (!view.players[color]) {
      if (!seat) {
        const btn = document.createElement('button');
        btn.textContent = `PLAY ${color.toUpperCase()}`;
        btn.addEventListener('click', () => api.sendAction({ kind: 'sit', seat: color }));
        box.appendChild(btn);
      }
      const botBtn = document.createElement('button');
      botBtn.textContent = 'PLAY VS BOT';
      botBtn.addEventListener('click', () => api.sendAction({ kind: 'sit', seat: color, bot: true, level: preferredLevel() }));
      box.append(botBtn, levelSelect(preferredLevel()));
    } else if (view.players[color] === 'BOT') {
      box.appendChild(levelSelect((view.botLevels || {})[color], (level) => api.sendAction({ kind: 'setBotLevel', seat: color, level })));
      const rm = document.createElement('button');
      rm.textContent = 'REMOVE BOT';
      rm.addEventListener('click', () => api.sendAction({ kind: 'removeBot', seat: color }));
      box.appendChild(rm);
    }
    return box;
  }

  function render() {
    const seat = mySeat();
    results.update(view && view.phase === 'game_over' ? duelResults({
      winner: view.winner, colors: ['black', 'white'], players: view.players, me: seat, nameFor: nicknameFor,
      subtitle: `Discs ${view.counts.black} – ${view.counts.white}`, onRematch: () => api.sendAction({ kind: 'resetGame' }),
    }) : null);
    root.innerHTML = '';
    if (!view) {
      root.textContent = 'Loading...';
      return;
    }

    const status = document.createElement('div');
    status.className = 'rv-status';
    if (view.phase === 'waiting') {
      status.textContent = 'Waiting for both seats to be filled.';
    } else if (view.phase === 'playing') {
      const mine = seat && seat === view.turn;
      status.textContent = mine ? `▶ YOUR TURN (${seat.toUpperCase()})` : `${view.turn.toUpperCase()} TO MOVE — ${nicknameFor(view.players[view.turn])}`;
      if (mine) status.classList.add('mine');
      status.style.color = view.turn === 'black' ? '#c8c8c8' : '#ffffff';
    } else {
      status.textContent = view.winner === 'draw' ? "IT'S A DRAW!" : `${view.winner.toUpperCase()} WINS ${Math.max(view.counts.black, view.counts.white)}–${Math.min(view.counts.black, view.counts.white)}!`;
      status.style.color = '#ffb000';
    }
    root.appendChild(status);

    const err = document.createElement('div');
    err.className = 'rv-err';
    err.textContent = flashError ? REJECT_MESSAGES[flashError] || 'Move rejected' : '';
    root.appendChild(err);

    const seats = document.createElement('div');
    seats.className = 'rv-seats';
    seats.append(seatLabel('black'), seatLabel('white'));
    if (seat) {
      const leave = document.createElement('button');
      leave.textContent = 'LEAVE SEAT';
      leave.addEventListener('click', () => api.sendAction({ kind: 'leaveSeat' }));
      seats.appendChild(leave);
    }
    root.appendChild(seats);

    // Score bar: counts + proportional bar.
    const score = document.createElement('div');
    score.className = 'rv-score';
    const nb = document.createElement('span');
    nb.className = 'rv-num';
    nb.textContent = view.counts.black;
    const nw = document.createElement('span');
    nw.className = 'rv-num';
    nw.textContent = view.counts.white;
    if (prevCounts && !reduced()) {
      if (view.counts.black > prevCounts.black) nb.classList.add('bump');
      if (view.counts.white > prevCounts.white) nw.classList.add('bump');
    }
    const bar = document.createElement('div');
    bar.className = 'rv-bar';
    const bb = document.createElement('div');
    bb.className = 'b';
    bb.style.flexGrow = String(view.counts.black);
    const bw = document.createElement('div');
    bw.className = 'w';
    bw.style.flexGrow = String(view.counts.white);
    bar.append(bb, bw);
    const cb = document.createElement('span');
    cb.className = 'rv-chip black';
    const cw = document.createElement('span');
    cw.className = 'rv-chip white';
    score.append(cb, nb, bar, nw, cw);
    root.appendChild(score);

    // Board.
    const wrap = document.createElement('div');
    wrap.className = 'rv-boardwrap';
    const board = document.createElement('div');
    board.className = 'rv-board';
    const myTurn = seat && view.phase === 'playing' && view.turn === seat;
    if (myTurn) board.classList.add('myturn');
    const lm = view.lastMove;
    const animate = moveChanged(lm ? `${view.moveNo}:${lm.r},${lm.c}` : null) && !reduced();
    if (animate) animUntil = performance.now() + 900;
    const flippedSet = new Map((view.flipped || []).map((f) => [`${f.r},${f.c}`, f]));
    const legalSet = new Set(view.phase === 'playing' ? view.legal.map((m) => `${m.r},${m.c}`) : []);
    const preview = myTurn && hover && legalSet.has(`${hover.r},${hover.c}`)
      ? new Set(flipsFor(view.board, hover.r, hover.c, seat).map((f) => `${f.r},${f.c}`)) : new Set();

    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const key = `${r},${c}`;
        const cell = document.createElement('div');
        cell.className = 'rv-cell';
        cell.dataset.row = String(r);
        cell.dataset.col = String(c);
        const piece = view.board[r][c];
        if (lm && lm.r === r && lm.c === c) cell.classList.add('last');
        if (piece) {
          const flipped = animate && flippedSet.has(key);
          const disc = discEl(piece, flipped ? opponent(piece) : null);
          if (preview.has(key)) cell.classList.add('rv-preview');
          if (animate && lm && lm.r === r && lm.c === c) {
            disc.animate([{ transform: 'scale(1.6)', opacity: 0 }, { transform: 'scale(.92)', opacity: 1, offset: 0.7 }, { transform: 'scale(1)' }],
              { duration: 260, easing: 'ease-out' });
          } else if (flipped) {
            const dist = Math.max(Math.abs(r - lm.r), Math.abs(c - lm.c));
            const axis = r === lm.r ? 'Y' : c === lm.c ? 'X' : 'Y';
            disc.animate([
              { transform: `rotate${axis}(180deg) translateZ(0)` },
              { transform: `rotate${axis}(90deg) translateZ(10px)`, offset: 0.5 },
              { transform: `rotate${axis}(0deg) translateZ(0)` },
            ], { duration: 420, delay: 120 + dist * 70, easing: 'ease-in-out', fill: 'backwards' });
          }
          cell.appendChild(disc);
        } else if (legalSet.has(key)) {
          const dot = document.createElement('div');
          dot.className = `rv-dot ${view.turn}${myTurn ? '' : ' spect'}`;
          cell.appendChild(dot);
          if (myTurn) {
            cell.classList.add('legal');
            if (hover && hover.r === r && hover.c === c) {
              const ghost = document.createElement('div');
              ghost.className = `rv-ghost rv-face ${seat}`;
              cell.appendChild(ghost);
            }
          }
        }
        cell.addEventListener('pointerenter', (e) => {
          if (e.pointerType === 'touch' || !myTurn || !legalSet.has(key) || performance.now() < animUntil) return;
          hover = { r, c };
          render();
        });
        cell.addEventListener('pointerleave', (e) => {
          if (e.pointerType === 'touch' || !hover || hover.r !== r || hover.c !== c) return;
          hover = null;
          render();
        });
        cell.addEventListener('click', () => play(r, c));
        board.appendChild(cell);
      }
    }
    wrap.appendChild(board);

    const passKey = view.pass ? `${view.pass.seq}:${view.pass.color}` : null;
    if (passChanged(passKey) && view.pass && view.phase !== 'waiting') {
      const call = document.createElement('div');
      call.className = 'rv-callout';
      const who = view.pass.color === seat ? 'YOU HAVE' : `${view.pass.color.toUpperCase()} HAS`;
      call.textContent = `${who} NO MOVES — PASS`;
      wrap.appendChild(call);
      setTimeout(() => call.remove(), 2300);
      sfx.play('beep');
    }
    root.appendChild(wrap);

    if (view.phase === 'game_over' && seat) {
      const row = document.createElement('div');
      row.className = 'rv-btn-row';
      const again = document.createElement('button');
      again.textContent = 'NEW GAME (SWAP COLOURS)';
      again.addEventListener('click', () => api.sendAction({ kind: 'resetGame' }));
      row.appendChild(again);
      root.appendChild(row);
    }
    prevCounts = view.counts;
  }

  render();

  return {
    applySnapshot(snapshot) {
      view = snapshot;
      prevCounts = null;
      render();
    },
    applyEvent(data) {
      if (!data) return;
      if (data.kind === 'state') {
        const prev = view;
        view = data;
        // boardSounds plays move/win/lose; add a flip ripple for big captures.
        boardSounds(prev, data, mySeat());
        if (prev && data.flipped && data.flipped.length >= 4 && data.moveNo !== prev.moveNo && !data.winner) {
          setTimeout(() => sfx.play('swap'), 180);
        }
        if (prev && data.phase === 'playing' && data.turn === mySeat() && (prev.turn !== data.turn || prev.moveNo !== data.moveNo) && prev.phase === 'playing') {
          setTimeout(() => sfx.play('turn'), 300);
        }
        flashError = null;
        hover = null;
        render();
      } else if (data.kind === 'moveRejected') {
        flashError = data.reason || 'invalid';
        sfx.play('error');
        clearTimeout(flashTimer);
        flashTimer = setTimeout(() => { flashError = null; render(); }, 2000);
        render();
      }
    },
    applyRoster(newRoster) {
      roster = newRoster;
      render();
    },
    unmount() {
      clearTimeout(flashTimer);
      results.destroy();
      container.innerHTML = '';
    },
  };
}
