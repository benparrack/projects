// TRON-style light-cycles — real-time tick-loop game (see server/games/tron.js). Grid-based:
// each player's cycle moves one cell per server tick in its current direction, leaving a solid
// trail; steer with arrow keys/WASD (or the on-screen D-pad) to avoid walls, trails, and other
// players. Last one alive wins the round.

const GRID_W = 64;
const GRID_H = 48;
const CELL_PX = 10;
const CANVAS_WIDTH = GRID_W * CELL_PX;
const CANVAS_HEIGHT = GRID_H * CELL_PX;

const KEY_TO_DIR = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
};

export function mount(container, api) {
  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.flexDirection = 'column';
  wrap.style.gap = '8px';
  wrap.style.alignItems = 'center';

  const hintTitle = document.createElement('p');
  hintTitle.textContent = '> HOW TO PLAY';
  hintTitle.style.margin = '0';
  hintTitle.style.fontSize = '0.85em';
  hintTitle.style.opacity = '0.9';

  const hint = document.createElement('p');
  hint.innerHTML =
    '<strong>STEER</strong> — arrow keys, WASD, or the on-screen pad<br>' +
    '<strong>GOAL</strong> — survive: avoid walls, your own trail, and everyone else\'s<br>' +
    '<strong>ROUND</strong> — starts once 2+ players are here; last cycle alive wins';
  hint.style.margin = '2px 0 0';
  hint.style.maxWidth = `${CANVAS_WIDTH}px`;
  hint.style.textAlign = 'center';
  hint.style.fontSize = '0.85em';
  hint.style.lineHeight = '1.5';
  hint.style.opacity = '0.95';

  const body = document.createElement('div');
  body.style.display = 'flex';
  body.style.gap = '12px';
  body.style.alignItems = 'flex-start';

  const canvasWrap = document.createElement('div');
  canvasWrap.style.position = 'relative';

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  canvas.style.background = '#05080a';
  canvas.style.touchAction = 'none';
  const ctx = canvas.getContext('2d');

  const overlay = document.createElement('div');
  overlay.style.position = 'absolute';
  overlay.style.top = '50%';
  overlay.style.left = '50%';
  overlay.style.transform = 'translate(-50%, -50%)';
  overlay.style.color = '#fff';
  overlay.style.fontWeight = 'bold';
  overlay.style.textAlign = 'center';
  overlay.style.fontSize = '1.3em';
  overlay.style.textShadow = '0 0 8px #000, 0 0 8px #000';
  overlay.style.pointerEvents = 'none';
  overlay.hidden = true;

  // On-screen D-pad — cheap to add, and this hub's other real-time game (Slither) added touch
  // affordances after playtesting found canvas-only input awkward on phones.
  const dpad = document.createElement('div');
  dpad.style.position = 'absolute';
  dpad.style.bottom = '10px';
  dpad.style.right = '10px';
  dpad.style.display = 'grid';
  dpad.style.gridTemplateColumns = 'repeat(3, 36px)';
  dpad.style.gridTemplateRows = 'repeat(3, 36px)';
  dpad.style.gap = '2px';
  dpad.style.opacity = '0.85';

  function dpadBtn(label, dir, col, row) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.gridColumn = String(col);
    btn.style.gridRow = String(row);
    btn.style.touchAction = 'none';
    btn.style.userSelect = 'none';
    btn.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      sendDir(dir);
    });
    return btn;
  }
  dpad.appendChild(dpadBtn('↑', 'up', 2, 1));
  dpad.appendChild(dpadBtn('←', 'left', 1, 2));
  dpad.appendChild(dpadBtn('→', 'right', 3, 2));
  dpad.appendChild(dpadBtn('↓', 'down', 2, 3));

  canvasWrap.appendChild(canvas);
  canvasWrap.appendChild(overlay);
  canvasWrap.appendChild(dpad);

  const side = document.createElement('div');
  side.style.minWidth = '160px';
  const sideTitle = document.createElement('p');
  sideTitle.textContent = '> PLAYERS';
  sideTitle.style.margin = '0 0 4px';
  const playersEl = document.createElement('ul');
  playersEl.style.margin = '0';
  playersEl.style.paddingLeft = '18px';
  playersEl.style.fontSize = '0.85em';
  side.appendChild(sideTitle);
  side.appendChild(playersEl);

  body.appendChild(canvasWrap);
  body.appendChild(side);
  wrap.appendChild(hintTitle);
  wrap.appendChild(hint);
  wrap.appendChild(body);
  container.appendChild(wrap);

  let lastView = null;
  let lastRoundId = null;
  // Local running copy of every in-round player's trail, keyed by clientId. The server sends
  // the full set only on join (snapshot); every tick after that sends just the newly-added
  // cells (trailAdded), same bandwidth-saving shape as Slither's food add/remove delta.
  const trailMap = new Map();

  function myClientId() {
    return api.getClientId();
  }

  function statusLabel(view) {
    if (!view) return 'Loading...';
    if (view.phase === 'waiting') return `Waiting for players… (need at least 2, have ${view.players.length})`;
    if (view.phase === 'countdown') return `Starting in ${Math.ceil((view.countdownRemainingMs || 0) / 1000)}…`;
    if (view.phase === 'playing') return 'Round in progress';
    if (view.phase === 'round_over') {
      if (view.roundOver && view.roundOver.isDraw) return 'ROUND OVER — DRAW';
      if (view.roundOver) return `ROUND OVER — ${view.roundOver.winnerNickname} WINS`;
    }
    return '';
  }

  function renderPlayers(view) {
    playersEl.innerHTML = '';
    for (const p of view.players) {
      const li = document.createElement('li');
      const you = p.clientId === myClientId() ? ' (you)' : '';
      li.textContent = `${p.nickname}${you} — ${p.status}`;
      li.style.color = p.color;
      playersEl.appendChild(li);
    }
  }

  function ensureTrail(clientId) {
    if (!trailMap.has(clientId)) trailMap.set(clientId, []);
    return trailMap.get(clientId);
  }

  function draw(view) {
    ctx.fillStyle = '#05080a';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    if (!view) return;

    // Faint grid so the arena reads as a grid, not an empty void.
    ctx.strokeStyle = 'rgba(31, 143, 12, 0.12)';
    ctx.lineWidth = 1;
    for (let gx = 0; gx <= GRID_W; gx += 4) {
      ctx.beginPath();
      ctx.moveTo(gx * CELL_PX, 0);
      ctx.lineTo(gx * CELL_PX, CANVAS_HEIGHT);
      ctx.stroke();
    }
    for (let gy = 0; gy <= GRID_H; gy += 4) {
      ctx.beginPath();
      ctx.moveTo(0, gy * CELL_PX);
      ctx.lineTo(CANVAS_WIDTH, gy * CELL_PX);
      ctx.stroke();
    }
    ctx.strokeStyle = '#1f8f0c';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    for (const p of view.players) {
      if (!p.head && p.status !== 'dead') continue;
      const trail = trailMap.get(p.clientId) || [];
      const dim = p.status === 'dead';
      ctx.fillStyle = p.color;
      ctx.globalAlpha = dim ? 0.4 : 0.85;
      for (const c of trail) {
        ctx.fillRect(c.x * CELL_PX, c.y * CELL_PX, CELL_PX - 1, CELL_PX - 1);
      }
      ctx.globalAlpha = 1;
      if (p.head && p.status === 'alive') {
        ctx.fillStyle = '#fff';
        ctx.fillRect(p.head.x * CELL_PX + 1, p.head.y * CELL_PX + 1, CELL_PX - 3, CELL_PX - 3);
        ctx.fillStyle = p.color;
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(p.nickname, p.head.x * CELL_PX + CELL_PX / 2, p.head.y * CELL_PX - 4);
      }
    }

    overlay.hidden = view.phase !== 'round_over';
    if (!overlay.hidden) {
      overlay.textContent = view.roundOver && view.roundOver.isDraw ? 'DRAW!' : `${view.roundOver ? view.roundOver.winnerNickname : ''} WINS!`;
    }
  }

  function applyView(view) {
    if (lastRoundId !== null && view.roundId !== lastRoundId) trailMap.clear();
    lastRoundId = view.roundId;
    lastView = view;
    renderPlayers(view);
    statusEl.textContent = statusLabel(view);
    draw(view);
  }

  const statusEl = document.createElement('p');
  statusEl.style.margin = '0';
  statusEl.style.fontSize = '0.9em';
  statusEl.style.fontWeight = 'bold';
  wrap.insertBefore(statusEl, body);

  function applySnapshotView(snapshot) {
    trailMap.clear();
    for (const [clientId, cells] of Object.entries(snapshot.trails || {})) {
      trailMap.set(clientId, cells.slice());
    }
    applyView(snapshot);
  }

  function applyTickView(view) {
    if (lastRoundId !== null && view.roundId !== lastRoundId) trailMap.clear();
    for (const add of view.trailAdded || []) {
      ensureTrail(add.clientId).push({ x: add.x, y: add.y });
    }
    applyView(view);
  }

  let lastSentDir = null;
  function sendDir(dir) {
    if (dir === lastSentDir) return;
    lastSentDir = dir;
    api.sendAction({ kind: 'steer', direction: dir });
  }

  function onKeyDown(ev) {
    const dir = KEY_TO_DIR[ev.code];
    if (!dir) return;
    ev.preventDefault();
    sendDir(dir);
  }

  window.addEventListener('keydown', onKeyDown);

  // Debug hook for automated verification, same convention as Slither's window.__slitherDebug.
  window.__tronDebug = {
    getLastView: () => lastView,
    getTrail: (clientId) => trailMap.get(clientId),
    getMyId: () => api.getClientId(),
  };

  return {
    applySnapshot(snapshot) {
      applySnapshotView(snapshot);
    },
    applyEvent(data) {
      if (data && data.kind === 'state') applyTickView(data.view);
    },
    unmount() {
      window.removeEventListener('keydown', onKeyDown);
      delete window.__tronDebug;
      container.innerHTML = '';
    },
  };
}
