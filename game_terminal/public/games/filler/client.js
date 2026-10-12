// Filler — pick one of the colour buttons under the board; your region (bottom-left for P1,
// top-right for P2) turns that colour and swallows every touching cell of it. The two colours
// currently held by the players are locked. Absorbed cells ripple in outward from your region,
// hovering a colour previews what it would capture (+N), and a split bar tracks the race to
// more than half the board. Cells carry data-row/data-col, buttons data-color, for testing.
import { sfx, boardSounds } from '../sfx.js';
import { preferredLevel, levelSelect } from '../botLevel.js';
import { createResults } from '../resultsPanel.js';
import { changeTracker } from '../boardFx.js';

const PALETTE = [
  { name: 'RED', hex: '#ef4f5a', dark: '#a8222d' },
  { name: 'YELLOW', hex: '#f7d23e', dark: '#b8930a' },
  { name: 'GREEN', hex: '#5cc95f', dark: '#2c8a31' },
  { name: 'BLUE', hex: '#3f9bea', dark: '#1d62a8' },
  { name: 'PURPLE', hex: '#9b5de5', dark: '#5f2ea6' },
  { name: 'BLACK', hex: '#4a5058', dark: '#25292e' },
];
const WAVE_MS = 70; // keep in sync with server/games/filler.js
const SEAT_LABEL = { p1: 'P1', p2: 'P2' };
const SEAT_NUM = { p1: 1, p2: 2 };

const REJECT_MESSAGES = {
  not_your_turn: "It's not your turn",
  color_taken: 'That colour is taken — pick another',
  invalid: 'Invalid move',
  not_playing: 'The game is not in progress',
  not_seated: 'Take a seat to play',
};

const CSS = `
.fl-root { display: flex; flex-direction: column; align-items: center; gap: 10px; width: 100%; }
.fl-status { font-size: 18px; font-weight: bold; padding: 6px 14px; border-radius: 6px; border: 2px solid transparent; text-align: center; }
.fl-status.mine { background: rgba(57,255,20,.15); border-color: #39ff14; }
.fl-err { color: #ff4d4d; min-height: 1.2em; font-size: 14px; }
.fl-seats { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; align-items: center; }
.fl-seat { display: flex; gap: 6px; align-items: center; padding: 4px 8px; border: 1px solid #1f8f0c; border-radius: 6px; }
.fl-seat.turn { border-color: #39ff14; box-shadow: 0 0 10px -2px #39ff14; }
.fl-chip { width: 16px; height: 16px; border-radius: 4px; display: inline-block; flex: none; border: 1px solid rgba(255,255,255,.35); transition: background .35s; }
.fl-score { display: flex; align-items: center; gap: 8px; width: min(420px, calc(100vw - 40px)); font-weight: bold; }
.fl-bar { position: relative; flex: 1; height: 14px; border-radius: 7px; overflow: hidden; display: flex; border: 1px solid #1f8f0c; background: #0a0f0a; }
.fl-bar > div { transition: flex-grow .45s ease, background .35s; }
.fl-bar .mid { flex-grow: 1; }
.fl-bar::after { content: ''; position: absolute; left: 50%; top: -2px; bottom: -2px; width: 2px; margin-left: -1px; background: #ffb000; opacity: .8; }
.fl-num { min-width: 28px; text-align: center; font-size: 20px; }
.fl-num.bump { animation: fl-bump .35s ease-out; }
@keyframes fl-bump { 40% { transform: scale(1.35); color: #ffb000; } }
.fl-boardwrap { position: relative; }
.fl-board {
  --cell: min(50px, calc((100vw - 72px) / 8));
  display: grid; grid-template-columns: repeat(8, var(--cell)); grid-template-rows: repeat(7, var(--cell));
  gap: 2px; padding: 6px; border-radius: 10px; background: #050805;
  border: 3px solid #1f8f0c; box-shadow: inset 0 0 24px rgba(0,0,0,.8);
}
.fl-board.myturn { border-color: #39ff14; box-shadow: inset 0 0 24px rgba(0,0,0,.8), 0 0 14px 2px rgba(57,255,20,.45); }
.fl-cell {
  position: relative; border-radius: 4px; transition: background-color .35s ease, filter .2s;
  box-shadow: inset 0 -3px 0 rgba(0,0,0,.25), inset 0 2px 0 rgba(255,255,255,.18);
}
.fl-cell.own1, .fl-cell.own2 { border-radius: 2px; box-shadow: inset 0 0 0 2px rgba(255,255,255,.55), inset 0 0 10px rgba(255,255,255,.25); }
.fl-cell.own2 { box-shadow: inset 0 0 0 2px rgba(0,0,0,.55), inset 0 0 10px rgba(0,0,0,.35); }
.fl-cell.preview { filter: brightness(1.45); box-shadow: inset 0 0 0 2px #ffb000, 0 0 8px #ffb000; z-index: 1; }
.fl-cell.dim { filter: saturate(.55) brightness(.7); }
.fl-tag {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none;
  font-weight: bold; font-size: calc(var(--cell) * .3); color: #fff; text-shadow: 0 1px 2px #000, 0 0 4px #000;
}
.fl-palette { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
.fl-swatch {
  position: relative; width: 52px; height: 52px; border-radius: 50%; cursor: pointer; padding: 0;
  border: 3px solid rgba(255,255,255,.25); transition: transform .12s, box-shadow .12s, opacity .2s;
  box-shadow: inset 0 -5px 0 rgba(0,0,0,.3), inset 0 4px 0 rgba(255,255,255,.25), 0 3px 6px rgba(0,0,0,.6);
}
.fl-swatch:not(:disabled):hover { transform: translateY(-3px) scale(1.06); box-shadow: inset 0 -5px 0 rgba(0,0,0,.3), inset 0 4px 0 rgba(255,255,255,.25), 0 0 14px #fff; }
.fl-swatch:disabled { cursor: default; opacity: .28; }
.fl-swatch.locked::after { content: '✕'; position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 26px; color: #fff; text-shadow: 0 0 4px #000; }
.fl-swatch .gain {
  position: absolute; top: -8px; right: -8px; min-width: 22px; padding: 1px 5px; border-radius: 10px; font-size: 12px; font-weight: bold;
  background: #0c160c; color: #39ff14; border: 1px solid #39ff14; pointer-events: none;
}
.fl-swatch .gain.zero { color: #888; border-color: #555; }
.fl-hint { font-size: 12px; opacity: .65; text-align: center; max-width: 440px; }
.fl-tally { font-size: 13px; opacity: .8; }
.fl-btn-row { display: flex; gap: 8px; }
@media (prefers-reduced-motion: reduce) { .fl-num.bump { animation: none; } .fl-cell { transition: none; } }
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

// Cells `color` would absorb for player p (mirrors the server's flood) — for the hover preview.
export function absorbPreview(view, p, color) {
  const { cols, rows } = view;
  const owner = view.owner.slice();
  const out = [];
  const queue = [];
  for (let i = 0; i < owner.length; i++) if (owner[i] === p) queue.push(i);
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const r = Math.floor(i / cols);
    const c = i % cols;
    const nb = [];
    if (r > 0) nb.push(i - cols);
    if (r < rows - 1) nb.push(i + cols);
    if (c > 0) nb.push(i - 1);
    if (c < cols - 1) nb.push(i + 1);
    for (const j of nb) {
      if (owner[j] === 0 && view.colors[j] === color) {
        owner[j] = p;
        out.push(j);
        queue.push(j);
      }
    }
  }
  return out;
}

export function mount(container, api) {
  ensureStyles();
  let view = null;
  let roster = [];
  let flashError = null;
  let flashTimer = null;
  let hoverColor = null;
  const moveChanged = changeTracker();
  let prevCounts = null;
  let animUntil = 0; // hover re-renders would cut the absorb ripple short, so hold them off

  const root = document.createElement('div');
  root.className = 'fl-root';
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
    if (view.players.p1 === me) return 'p1';
    if (view.players.p2 === me) return 'p2';
    return null;
  }

  function pick(color) {
    const seat = mySeat();
    if (!seat || view.phase !== 'playing' || view.turn !== seat) return;
    if (color === view.current.p1 || color === view.current.p2) {
      sfx.play('error');
      return;
    }
    hoverColor = null;
    api.sendAction({ kind: 'move', color });
  }

  function seatName(seat) {
    const n = nicknameFor(view.players[seat]);
    if (view.players[seat] === 'BOT') return `Bot (${(view.botLevels || {})[seat] || 'hard'})`;
    return n || '(empty)';
  }

  function seatLabel(seat) {
    const box = document.createElement('div');
    box.className = `fl-seat${view.phase === 'playing' && view.turn === seat ? ' turn' : ''}`;
    const chip = document.createElement('span');
    chip.className = 'fl-chip';
    chip.style.background = PALETTE[view.current[seat]].hex;
    const name = document.createElement('span');
    const corner = seat === 'p1' ? '↙' : '↗';
    name.textContent = `${SEAT_LABEL[seat]} ${corner}: ${view.players[seat] === 'BOT' ? '(bot)' : nicknameFor(view.players[seat]) || '(empty)'}${view.players[seat] === api.getClientId() ? ' (you)' : ''}`;
    box.append(chip, name);
    const seat0 = mySeat();
    if (!view.players[seat]) {
      if (!seat0) {
        const btn = document.createElement('button');
        btn.textContent = `PLAY ${SEAT_LABEL[seat]}`;
        btn.addEventListener('click', () => api.sendAction({ kind: 'sit', seat }));
        box.appendChild(btn);
      }
      const botBtn = document.createElement('button');
      botBtn.textContent = 'PLAY VS BOT';
      botBtn.addEventListener('click', () => api.sendAction({ kind: 'sit', seat, bot: true, level: preferredLevel() }));
      box.append(botBtn, levelSelect(preferredLevel()));
    } else if (view.players[seat] === 'BOT') {
      box.appendChild(levelSelect((view.botLevels || {})[seat], (level) => api.sendAction({ kind: 'setBotLevel', seat, level })));
      const rm = document.createElement('button');
      rm.textContent = 'REMOVE BOT';
      rm.addEventListener('click', () => api.sendAction({ kind: 'removeBot', seat }));
      box.appendChild(rm);
    }
    return box;
  }

  function resultsOpts(seat) {
    if (!view || view.phase !== 'game_over') return null;
    const draw = view.winner === 'draw';
    const order = draw ? ['p1', 'p2'] : [view.winner, view.winner === 'p1' ? 'p2' : 'p1'];
    return {
      title: draw ? "IT'S A DRAW" : seat === view.winner ? 'YOU WIN!' : seat ? 'YOU LOSE' : `${seatName(view.winner).toUpperCase()} WINS!`,
      subtitle: `Cells ${view.counts.p1} – ${view.counts.p2} of ${view.cols * view.rows}`,
      outcome: draw ? 'draw' : !seat ? 'over' : seat === view.winner ? 'win' : 'lose',
      rows: order.map((s) => ({ name: seatName(s), value: `${view.counts[s]} cells`, win: !draw && s === view.winner, you: s === seat })),
      rematch: seat ? { label: 'REMATCH', onClick: () => api.sendAction({ kind: 'resetGame' }) } : null,
    };
  }

  function render() {
    const seat = mySeat();
    results.update(resultsOpts(seat));
    root.innerHTML = '';
    if (!view) {
      root.textContent = 'Loading...';
      return;
    }
    const total = view.cols * view.rows;

    const status = document.createElement('div');
    status.className = 'fl-status';
    if (view.phase === 'waiting') {
      status.textContent = 'Waiting for both seats to be filled.';
    } else if (view.phase === 'playing') {
      const mine = seat && seat === view.turn;
      status.textContent = mine ? `▶ YOUR TURN — PICK A COLOUR` : `${SEAT_LABEL[view.turn]} TO MOVE — ${nicknameFor(view.players[view.turn])}`;
      if (mine) status.classList.add('mine');
      status.style.color = mine ? '' : PALETTE[view.current[view.turn]].hex;
    } else {
      status.textContent = view.winner === 'draw' ? "IT'S A DRAW!" : `${SEAT_LABEL[view.winner]} WINS ${view.counts[view.winner]}–${view.counts[view.winner === 'p1' ? 'p2' : 'p1']}!`;
      status.style.color = '#ffb000';
    }
    root.appendChild(status);

    const err = document.createElement('div');
    err.className = 'fl-err';
    err.textContent = flashError ? REJECT_MESSAGES[flashError] || 'Move rejected' : '';
    root.appendChild(err);

    const seats = document.createElement('div');
    seats.className = 'fl-seats';
    seats.append(seatLabel('p1'), seatLabel('p2'));
    if (seat) {
      const leave = document.createElement('button');
      leave.textContent = 'LEAVE SEAT';
      leave.addEventListener('click', () => api.sendAction({ kind: 'leaveSeat' }));
      seats.appendChild(leave);
    }
    root.appendChild(seats);

    // Score: P1 count | bar (P1 fill, unclaimed, P2 fill, halfway marker) | P2 count.
    const score = document.createElement('div');
    score.className = 'fl-score';
    const n1 = document.createElement('span');
    n1.className = 'fl-num';
    n1.textContent = view.counts.p1;
    const n2 = document.createElement('span');
    n2.className = 'fl-num';
    n2.textContent = view.counts.p2;
    if (prevCounts && !reduced()) {
      if (view.counts.p1 > prevCounts.p1) n1.classList.add('bump');
      if (view.counts.p2 > prevCounts.p2) n2.classList.add('bump');
    }
    const bar = document.createElement('div');
    bar.className = 'fl-bar';
    bar.title = `First to ${Math.floor(total / 2) + 1} cells wins`;
    const b1 = document.createElement('div');
    b1.style.flexGrow = String(view.counts.p1);
    b1.style.background = PALETTE[view.current.p1].hex;
    const mid = document.createElement('div');
    mid.style.flexGrow = String(total - view.counts.p1 - view.counts.p2);
    const b2 = document.createElement('div');
    b2.style.flexGrow = String(view.counts.p2);
    b2.style.background = PALETTE[view.current.p2].hex;
    bar.append(b1, mid, b2);
    const c1 = document.createElement('span');
    c1.className = 'fl-chip';
    c1.style.background = PALETTE[view.current.p1].hex;
    const c2 = document.createElement('span');
    c2.className = 'fl-chip';
    c2.style.background = PALETTE[view.current.p2].hex;
    score.append(c1, n1, bar, n2, c2);
    root.appendChild(score);

    // Board.
    const myTurn = seat && view.phase === 'playing' && view.turn === seat;
    const lm = view.lastMove;
    const animate = moveChanged(lm ? `${lm.id}:${view.moveCount}` : null) && !reduced();
    const gainedAt = new Map(animate && lm ? lm.gained.map((g) => [g.i, g.d]) : []);
    if (gainedAt.size) animUntil = performance.now() + Math.max(...gainedAt.values()) * WAVE_MS + 340;
    const preview = myTurn && hoverColor != null ? new Set(absorbPreview(view, SEAT_NUM[seat], hoverColor)) : null;

    const wrap = document.createElement('div');
    wrap.className = 'fl-boardwrap';
    const board = document.createElement('div');
    board.className = 'fl-board';
    if (myTurn) board.classList.add('myturn');
    for (let r = 0; r < view.rows; r++) {
      for (let c = 0; c < view.cols; c++) {
        const i = r * view.cols + c;
        const cell = document.createElement('div');
        const own = view.owner[i];
        cell.className = `fl-cell${own ? ` own${own}` : ''}`;
        cell.dataset.row = String(r);
        cell.dataset.col = String(c);
        const color = own ? view.current[own === 1 ? 'p1' : 'p2'] : view.colors[i];
        cell.style.backgroundColor = PALETTE[color].hex;
        if (preview) {
          if (preview.has(i)) {
            cell.classList.add('preview');
            cell.style.backgroundColor = PALETTE[hoverColor].hex;
          } else if (!own) cell.classList.add('dim');
        }
        // Corner tags mark where each player started.
        if ((own === 1 && r === view.rows - 1 && c === 0) || (own === 2 && r === 0 && c === view.cols - 1)) {
          const tag = document.createElement('span');
          tag.className = 'fl-tag';
          tag.textContent = own === 1 ? 'P1' : 'P2';
          cell.appendChild(tag);
        }
        if (gainedAt.has(i)) {
          const d = gainedAt.get(i);
          cell.animate([
            { transform: 'scale(.4)', filter: 'brightness(2.2)' },
            { transform: 'scale(1.12)', filter: 'brightness(1.4)', offset: 0.6 },
            { transform: 'scale(1)', filter: 'brightness(1)' },
          ], { duration: 320, delay: d * WAVE_MS, easing: 'ease-out', fill: 'backwards' });
        }
        board.appendChild(cell);
      }
    }
    wrap.appendChild(board);
    root.appendChild(wrap);

    // Hover preview repaints the existing cells in place — a full render() here would replace the
    // swatch under the pointer, so the mouseup lands on a detached node and the click never fires.
    const paintPreview = () => {
      const pv = myTurn && hoverColor != null ? new Set(absorbPreview(view, SEAT_NUM[seat], hoverColor)) : null;
      [...board.children].forEach((cell, i) => {
        const own = view.owner[i];
        const base = own ? view.current[own === 1 ? 'p1' : 'p2'] : view.colors[i];
        const inPv = !!pv && pv.has(i);
        cell.classList.toggle('preview', inPv);
        cell.classList.toggle('dim', !!pv && !inPv && !own);
        cell.style.backgroundColor = PALETTE[inPv ? hoverColor : base].hex;
      });
    };

    // Colour buttons.
    const palette = document.createElement('div');
    palette.className = 'fl-palette';
    PALETTE.forEach((pc, k) => {
      const btn = document.createElement('button');
      btn.className = 'fl-swatch';
      btn.dataset.color = String(k);
      btn.style.background = pc.hex;
      btn.title = pc.name;
      const locked = k === view.current.p1 || k === view.current.p2;
      if (locked) btn.classList.add('locked');
      btn.disabled = !myTurn || locked;
      if (myTurn && !locked) {
        const g = absorbPreview(view, SEAT_NUM[seat], k).length;
        const badge = document.createElement('span');
        badge.className = `gain${g ? '' : ' zero'}`;
        badge.textContent = `+${g}`;
        btn.appendChild(badge);
        btn.addEventListener('pointerenter', (e) => {
          if (e.pointerType === 'touch' || performance.now() < animUntil) return;
          hoverColor = k;
          paintPreview();
        });
        btn.addEventListener('pointerleave', (e) => {
          if (e.pointerType === 'touch' || hoverColor !== k) return;
          hoverColor = null;
          paintPreview();
        });
        btn.addEventListener('click', () => pick(k));
      }
      palette.appendChild(btn);
    });
    root.appendChild(palette);

    const hint = document.createElement('div');
    hint.className = 'fl-hint';
    hint.textContent = `Pick a colour to grow your corner region into every touching cell of that colour. Both players' current colours are locked. Own more than half the board (${Math.floor(total / 2) + 1}+ cells) to win.`;
    root.appendChild(hint);

    if (view.score && (view.score.p1 || view.score.p2 || view.score.draws)) {
      const tally = document.createElement('div');
      tally.className = 'fl-tally';
      tally.textContent = `Match: P1 ${view.score.p1} · P2 ${view.score.p2}${view.score.draws ? ` · draws ${view.score.draws}` : ''}`;
      root.appendChild(tally);
    }

    if (view.phase === 'game_over' && seat) {
      const row = document.createElement('div');
      row.className = 'fl-btn-row';
      const again = document.createElement('button');
      again.textContent = 'NEW GAME';
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
        // boardSounds keys off `board`/`turn`; give it the owner grid so a capture-less turn still clicks.
        boardSounds(prev && { ...prev, board: prev.owner }, { ...data, board: data.owner }, mySeat());
        if (prev && data.lastMove && data.lastMove.gained.length >= 5 && !data.winner && (!prev.lastMove || prev.lastMove.id !== data.lastMove.id)) {
          setTimeout(() => sfx.play('swap'), 150);
        }
        if (prev && prev.phase === 'playing' && data.phase === 'playing' && data.turn === mySeat() && prev.turn !== data.turn) {
          setTimeout(() => sfx.play('turn'), 300);
        }
        flashError = null;
        hoverColor = null;
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
