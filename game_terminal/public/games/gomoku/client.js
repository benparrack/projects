// Gomoku — a Go-style wooden board drawn on a canvas: stones sit on the 15x15 intersections, a
// translucent ghost stone follows the pointer on your turn, the last move gets a marker and the
// winning five glows. Rules (five or more in a row) and the bot are server-side (server/games/
// gomoku.js). The canvas is kept across renders; only the header/seat row DOM is rebuilt.
import { sfx, boardSounds } from '../sfx.js';
import { preferredLevel, levelSelect } from '../botLevel.js';
import { createResults, duelResults } from '../resultsPanel.js';
import { injectStyle } from '../dom.js';

const N = 15;
const STAR_POINTS = [[3, 3], [3, 11], [11, 3], [11, 11], [7, 7]];
const REJECT_MESSAGES = {
  occupied: 'That point is taken',
  not_your_turn: "It's not your turn",
  not_seated: 'Take a seat to play',
  not_playing: 'The game is not in progress',
  invalid: 'Invalid move',
};
const SEAT_COLOR = { black: '#e8e8e8', white: '#ffffff' };

const CSS = `
.gt-gomoku { display: flex; flex-direction: column; align-items: center; gap: 10px; width: 100%; }
.gt-gomoku .gk-status { font-size: 18px; font-weight: bold; padding: 6px 14px; border-radius: 6px; border: 2px solid transparent; text-align: center; }
.gt-gomoku .gk-status.mine { background: rgba(57,255,20,.15); border-color: #39ff14; }
.gt-gomoku .gk-err { color: #ff4d4d; min-height: 1.2em; font-size: 14px; }
.gt-gomoku .gk-seats { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; align-items: center; }
.gt-gomoku .gk-seat { display: flex; gap: 8px; align-items: center; padding: 6px 10px; border: 1px solid #1f8f0c; border-radius: 6px; flex-wrap: wrap; }
.gt-gomoku .gk-seat.turn { border-color: #ffb000; box-shadow: 0 0 10px -2px #ffb000; }
.gt-gomoku .gk-stone { width: 16px; height: 16px; border-radius: 50%; display: inline-block; flex: none; }
.gt-gomoku .gk-stone.black { background: radial-gradient(circle at 35% 30%, #777, #111 60%); box-shadow: 0 1px 2px #000; }
.gt-gomoku .gk-stone.white { background: radial-gradient(circle at 35% 30%, #fff, #d5d5d0 70%, #a8a8a0); box-shadow: 0 1px 2px #000; }
.gt-gomoku .gk-score { font-weight: bold; color: #ffb000; }
.gt-gomoku .gk-board { position: relative; width: 100%; max-width: 560px; touch-action: manipulation; }
.gt-gomoku canvas { display: block; width: 100%; height: auto; border-radius: 8px; cursor: pointer; box-shadow: 0 6px 24px rgba(0,0,0,.6), 0 0 0 1px #3a2a10; }
.gt-gomoku canvas.idle { cursor: default; }
.gt-gomoku canvas.myturn { box-shadow: 0 6px 24px rgba(0,0,0,.6), 0 0 0 2px #39ff14, 0 0 16px 2px rgba(57,255,20,.45); }
`;

// Board geometry in canvas units (independent of CSS size / DPR).
const SIZE = 600;
const MARGIN = 30;
const STEP = (SIZE - MARGIN * 2) / (N - 1);
const pos = (i) => MARGIN + i * STEP;

// Pure helper (also used by tests): canvas-unit point -> nearest intersection, or null if too far.
function pointToCell(x, y) {
  const c = Math.round((x - MARGIN) / STEP);
  const r = Math.round((y - MARGIN) / STEP);
  if (r < 0 || r >= N || c < 0 || c >= N) return null;
  if (Math.hypot(x - pos(c), y - pos(r)) > STEP * 0.62) return null;
  return { r, c };
}

export function mount(container, api) {
  injectStyle(CSS);
  let view = null;
  let roster = [];
  let flashError = null;
  let flashTimer = null;
  let hover = null;
  let placedAt = 0; // performance.now() when the last move appeared (stone pop-in)
  let lastKey = null;
  let raf = 0;

  const root = document.createElement('div');
  root.className = 'gt-gomoku';
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:8px;width:100%';
  const boardWrap = document.createElement('div');
  boardWrap.className = 'gk-board';
  const canvas = document.createElement('canvas');
  canvas.dataset.n = String(N);
  boardWrap.appendChild(canvas);
  const footer = document.createElement('div');
  root.append(header, boardWrap, footer);
  container.appendChild(root);
  const results = createResults(container);
  const g = canvas.getContext('2d');

  function nicknameFor(clientId) {
    if (!clientId) return null;
    if (clientId === 'BOT') return 'Bot';
    const entry = roster.find((r) => r.clientId === clientId);
    return entry ? entry.nickname : 'someone';
  }
  function mySeat() {
    if (!view) return null;
    const me = api.getClientId();
    if (view.players.black === me) return 'black';
    if (view.players.white === me) return 'white';
    return null;
  }
  const myTurn = () => view && view.phase === 'playing' && mySeat() === view.turn;

  // ---- canvas ----------------------------------------------------------------------------------
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const css = boardWrap.clientWidth || SIZE;
    const px = Math.round(css * dpr);
    if (canvas.width !== px) {
      canvas.width = px;
      canvas.height = px;
    }
    draw();
  }
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(boardWrap);

  let woodPattern = null;
  function wood() {
    if (woodPattern) return woodPattern;
    const off = document.createElement('canvas');
    off.width = SIZE;
    off.height = SIZE;
    const o = off.getContext('2d');
    const grad = o.createLinearGradient(0, 0, SIZE, SIZE);
    grad.addColorStop(0, '#e2b56c');
    grad.addColorStop(0.5, '#d9a75a');
    grad.addColorStop(1, '#c98f45');
    o.fillStyle = grad;
    o.fillRect(0, 0, SIZE, SIZE);
    // Grain: deterministic wavy streaks.
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 70; k++) {
      const y0 = rnd() * SIZE;
      o.strokeStyle = `rgba(${rnd() < 0.5 ? '120,70,20' : '255,230,170'},${0.05 + rnd() * 0.08})`;
      o.lineWidth = 1 + rnd() * 3;
      o.beginPath();
      for (let x = 0; x <= SIZE; x += 20) {
        const y = y0 + Math.sin(x / (60 + k) + k) * 6 + Math.sin(x / 17 + k * 3) * 1.5;
        if (x === 0) o.moveTo(x, y); else o.lineTo(x, y);
      }
      o.stroke();
    }
    woodPattern = off;
    return off;
  }

  function stone(x, y, color, alpha = 1, scale = 1) {
    const rad = STEP * 0.46 * scale;
    g.save();
    g.globalAlpha = alpha;
    if (alpha === 1) {
      g.fillStyle = 'rgba(0,0,0,.35)';
      g.beginPath();
      g.arc(x + rad * 0.12, y + rad * 0.18, rad, 0, Math.PI * 2);
      g.fill();
    }
    const grad = g.createRadialGradient(x - rad * 0.35, y - rad * 0.4, rad * 0.1, x, y, rad);
    if (color === 'black') {
      grad.addColorStop(0, '#6a6a6a');
      grad.addColorStop(0.45, '#1c1c1c');
      grad.addColorStop(1, '#050505');
    } else {
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.6, '#e9e9e4');
      grad.addColorStop(1, '#b4b4ac');
    }
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  function draw() {
    if (!canvas.width) return;
    const k = canvas.width / SIZE;
    const now = performance.now();
    g.setTransform(k, 0, 0, k, 0, 0);
    g.drawImage(wood(), 0, 0);
    // Grid.
    g.strokeStyle = 'rgba(40,22,5,.85)';
    g.lineWidth = 1.2;
    g.beginPath();
    for (let i = 0; i < N; i++) {
      g.moveTo(pos(0), pos(i)); g.lineTo(pos(N - 1), pos(i));
      g.moveTo(pos(i), pos(0)); g.lineTo(pos(i), pos(N - 1));
    }
    g.stroke();
    g.lineWidth = 2.4;
    g.strokeRect(pos(0), pos(0), pos(N - 1) - pos(0), pos(N - 1) - pos(0));
    g.fillStyle = 'rgba(40,22,5,.95)';
    for (const [r, c] of STAR_POINTS) {
      g.beginPath();
      g.arc(pos(c), pos(r), 3.6, 0, Math.PI * 2);
      g.fill();
    }
    if (!view) return;

    const lm = view.lastMove;
    const winSet = new Set((view.winLine || []).map((p) => `${p.r},${p.c}`));
    let animating = false;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const s = view.board[r][c];
        if (!s) continue;
        const isLast = lm && lm.r === r && lm.c === c;
        let scale = 1;
        if (isLast) {
          const t = Math.min(1, (now - placedAt) / 180);
          if (t < 1) animating = true;
          scale = t < 1 ? 0.6 + 0.4 * (1 - (1 - t) * (1 - t)) + Math.sin(t * Math.PI) * 0.08 : 1;
        }
        stone(pos(c), pos(r), s, 1, scale);
      }
    }
    // Winning five: pulsing ring + connecting stroke.
    if (winSet.size) {
      animating = true;
      const pulse = 0.55 + 0.45 * Math.sin(now / 220);
      const line = view.winLine;
      g.save();
      g.strokeStyle = `rgba(255,210,63,${0.55 + 0.35 * pulse})`;
      g.lineWidth = 5;
      g.lineCap = 'round';
      g.shadowColor = '#ffd23f';
      g.shadowBlur = 14;
      g.beginPath();
      g.moveTo(pos(line[0].c), pos(line[0].r));
      g.lineTo(pos(line[line.length - 1].c), pos(line[line.length - 1].r));
      g.stroke();
      for (const p of line) {
        g.beginPath();
        g.arc(pos(p.c), pos(p.r), STEP * (0.5 + 0.04 * pulse), 0, Math.PI * 2);
        g.stroke();
      }
      g.restore();
    }
    // Last-move marker.
    if (lm && view.board[lm.r][lm.c] && !winSet.size) {
      g.save();
      g.fillStyle = '#ff4d4d';
      g.shadowColor = '#ff4d4d';
      g.shadowBlur = 6;
      g.beginPath();
      g.arc(pos(lm.c), pos(lm.r), STEP * 0.13, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    // Hover ghost on your turn.
    if (hover && myTurn() && !view.board[hover.r][hover.c]) {
      stone(pos(hover.c), pos(hover.r), view.turn, 0.45);
    }
    if (animating && !raf) raf = requestAnimationFrame(() => { raf = 0; draw(); });
  }

  function eventCell(e) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return null;
    return pointToCell((e.clientX - rect.left) * (SIZE / rect.width), (e.clientY - rect.top) * (SIZE / rect.height));
  }
  canvas.addEventListener('pointermove', (e) => {
    const cell = e.pointerType === 'mouse' ? eventCell(e) : null;
    if ((cell && hover && cell.r === hover.r && cell.c === hover.c) || (!cell && !hover)) return;
    hover = cell;
    draw();
  });
  canvas.addEventListener('pointerleave', () => { hover = null; draw(); });
  canvas.addEventListener('click', (e) => {
    const cell = eventCell(e);
    if (!cell || !view) return;
    if (!mySeat()) return;
    if (!myTurn()) { showError('not_your_turn'); return; }
    if (view.board[cell.r][cell.c]) { showError('occupied'); return; }
    api.sendAction({ kind: 'move', r: cell.r, c: cell.c });
  });

  function showError(reason) {
    flashError = reason;
    sfx.play('error');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { flashError = null; render(); }, 1800);
    render();
  }

  // ---- DOM header ------------------------------------------------------------------------------
  function render() {
    results.update(view && view.phase === 'game_over' ? duelResults({
      winner: view.winner, colors: ['black', 'white'], players: view.players, me: mySeat(), nameFor: nicknameFor,
      subtitle: view.winner === 'draw' ? 'The board is full' : `Five in a row · ${view.moveCount} stones`,
      onRematch: () => api.sendAction({ kind: 'resetGame' }),
    }) : null);
    header.innerHTML = '';
    footer.innerHTML = '';
    if (!view) {
      header.textContent = 'Loading...';
      return;
    }
    const seat = mySeat();

    const status = document.createElement('div');
    status.className = 'gk-status';
    if (view.phase === 'waiting') {
      status.textContent = 'Waiting for both seats to be filled.';
    } else if (view.phase === 'playing') {
      const name = nicknameFor(view.players[view.turn]) || view.turn;
      if (myTurn()) {
        status.textContent = `▶ YOUR TURN (${view.turn.toUpperCase()})`;
        status.classList.add('mine');
      } else {
        status.textContent = `${view.turn.toUpperCase()} TO MOVE. ${name}${view.players[view.turn] === 'BOT' ? ' is thinking…' : ''}`;
      }
    } else {
      status.textContent = view.winner === 'draw' ? "IT'S A DRAW" : `${view.winner.toUpperCase()} WINS`;
      status.style.color = '#ffd23f';
    }
    header.appendChild(status);

    const seats = document.createElement('div');
    seats.className = 'gk-seats';
    for (const color of ['black', 'white']) {
      const box = document.createElement('div');
      box.className = 'gk-seat';
      if (view.phase === 'playing' && view.turn === color) box.classList.add('turn');
      const dot = document.createElement('span');
      dot.className = `gk-stone ${color}`;
      const label = document.createElement('span');
      const occ = nicknameFor(view.players[color]);
      label.textContent = `${color.toUpperCase()}: ${occ || '(empty)'}${view.players[color] === api.getClientId() ? ' (you)' : ''}`;
      label.style.color = SEAT_COLOR[color];
      const sc = document.createElement('span');
      sc.className = 'gk-score';
      sc.textContent = String(view.score ? view.score[color] : 0);
      sc.title = 'Games won';
      box.append(dot, label, sc);
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
        const rm = document.createElement('button');
        rm.textContent = 'REMOVE BOT';
        rm.addEventListener('click', () => api.sendAction({ kind: 'removeBot', seat: color }));
        box.append(levelSelect((view.botLevels || {})[color], (level) => api.sendAction({ kind: 'setBotLevel', seat: color, level })), rm);
      }
      seats.appendChild(box);
    }
    if (seat) {
      const leave = document.createElement('button');
      leave.textContent = 'LEAVE SEAT';
      leave.classList.add('seat-leave'); // hidden in play-by-turns games (seats are fixed)
      leave.addEventListener('click', () => api.sendAction({ kind: 'leaveSeat' }));
      seats.appendChild(leave);
    }
    header.appendChild(seats);

    const err = document.createElement('div');
    err.className = 'gk-err';
    err.textContent = flashError ? (REJECT_MESSAGES[flashError] || 'Move rejected') : '';
    header.appendChild(err);

    canvas.className = myTurn() ? 'myturn' : seat && view.phase === 'playing' ? '' : 'idle';

    if (view.phase === 'game_over' && seat) {
      const again = document.createElement('button');
      again.textContent = 'NEW GAME (SWAP COLORS)';
      again.addEventListener('click', () => api.sendAction({ kind: 'resetGame' }));
      footer.appendChild(again);
    } else if (view.phase !== 'waiting') {
      const hint = document.createElement('div');
      hint.style.cssText = 'font-size:12px;opacity:.6';
      hint.textContent = 'Get five (or more) in a row. Across, down or diagonally. Black moves first.';
      footer.appendChild(hint);
    }
    draw();
  }

  function setView(next) {
    const key = next.lastMove ? `${next.lastMove.r},${next.lastMove.c}:${next.moveCount}` : null;
    if (key && key !== lastKey) placedAt = performance.now();
    lastKey = key;
    view = next;
  }

  resize();
  render();

  return {
    applySnapshot(snapshot) {
      setView(snapshot);
      placedAt = 0;
      render();
    },
    applyEvent(data) {
      if (!data) return;
      if (data.kind === 'state') {
        const prev = view;
        setView(data);
        boardSounds(prev, data, mySeat());
        if (prev && data.phase === 'playing' && prev.turn !== data.turn && myTurn()) setTimeout(() => sfx.play('turn'), 160);
        flashError = null;
        render();
      } else if (data.kind === 'moveRejected') {
        showError(data.reason);
      }
    },
    applyRoster(newRoster) {
      roster = newRoster;
      render();
    },
    unmount() {
      cancelAnimationFrame(raf);
      clearTimeout(flashTimer);
      if (ro) ro.disconnect();
      results.destroy();
      container.innerHTML = '';
    },
  };
}
