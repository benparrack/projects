// Maze Dash — the hub's "speedrun" game. Race the same procedurally-generated maze as everyone
// else in the room: arrow keys/WASD move one cell at a time (walls block you), first from the
// top-left to the bottom-right exit wins. Server plugin: ../../../server/games/mazedash.js
// (server sends the full maze wall data each round rather than the client regenerating it from
// the seed — see that file's header comment for why).

const ROWS = 15; // must match server/games/mazedash.js's ROWS/COLS
const COLS = 15;
const CELL_PX = 22;
const CANVAS_WIDTH = COLS * CELL_PX;
const CANVAS_HEIGHT = ROWS * CELL_PX;

const KEY_TO_DIR = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
};

function fmtMs(ms) {
  if (ms == null) return '--';
  const s = ms / 1000;
  return `${s.toFixed(2)}s`;
}

export function mount(container, api) {
  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.flexDirection = 'column';
  wrap.style.gap = '8px';
  wrap.style.alignItems = 'center';

  const hint = document.createElement('p');
  hint.innerHTML =
    '<strong>MOVE</strong> — arrow keys or WASD, one cell per press<br>' +
    '<strong>GOAL</strong> — reach the gold exit cell fastest; everyone races the same maze';
  hint.style.margin = '0';
  hint.style.maxWidth = `${CANVAS_WIDTH}px`;
  hint.style.textAlign = 'center';
  hint.style.fontSize = '0.85em';
  hint.style.lineHeight = '1.5';
  hint.style.opacity = '0.95';

  const statusEl = document.createElement('p');
  statusEl.style.margin = '0';
  statusEl.style.fontSize = '0.95em';
  statusEl.style.fontWeight = 'bold';

  const timerEl = document.createElement('p');
  timerEl.style.margin = '0';
  timerEl.style.fontSize = '1.4em';
  timerEl.style.fontWeight = 'bold';
  timerEl.style.color = '#39ff14';

  const actionRow = document.createElement('div');
  const raceBtn = document.createElement('button');
  raceBtn.textContent = 'START RACE';
  raceBtn.addEventListener('click', () => api.sendAction({ kind: 'startRace' }));
  actionRow.appendChild(raceBtn);

  const body = document.createElement('div');
  body.style.display = 'flex';
  body.style.gap = '12px';
  body.style.alignItems = 'flex-start';

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  canvas.style.background = '#05080a';
  const cctx = canvas.getContext('2d');

  const side = document.createElement('div');
  side.style.minWidth = '170px';
  const sideTitle = document.createElement('p');
  sideTitle.textContent = '> LEADERBOARD';
  sideTitle.style.margin = '0 0 4px';
  const lbEl = document.createElement('ol');
  lbEl.style.margin = '0';
  lbEl.style.paddingLeft = '20px';
  lbEl.style.fontSize = '0.85em';
  side.appendChild(sideTitle);
  side.appendChild(lbEl);

  body.appendChild(canvas);
  body.appendChild(side);
  wrap.appendChild(hint);
  wrap.appendChild(statusEl);
  wrap.appendChild(timerEl);
  wrap.appendChild(actionRow);
  wrap.appendChild(body);
  container.appendChild(wrap);

  let view = null;
  let roster = [];

  function nicknameFor(clientId) {
    const entry = roster.find((r) => r.clientId === clientId);
    return entry ? entry.nickname : 'someone';
  }

  function myPlayer() {
    if (!view) return null;
    const me = api.getClientId();
    return view.players.find((p) => p.clientId === me) || null;
  }

  function statusLabel() {
    if (!view) return 'Loading...';
    if (view.phase === 'waiting') return `Waiting to start (${view.players.length} here) — click START RACE.`;
    if (view.phase === 'racing') return 'Race in progress!';
    if (view.phase === 'results') return 'Race over — click NEW RACE to go again.';
    return '';
  }

  function drawMaze() {
    cctx.fillStyle = '#05080a';
    cctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    if (!view || !view.maze) return;
    const maze = view.maze;

    cctx.strokeStyle = '#1f8f0c';
    cctx.lineWidth = 2;
    cctx.lineCap = 'square';

    // Outer border, then each cell's own top/left wall (interior right/down walls are always the
    // same edge as the neighbor's left/up wall by construction, so this draws every wall exactly
    // once — see server/games/mazedash.js's generateMaze comment).
    cctx.strokeRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = maze[r][c];
        const x = c * CELL_PX;
        const y = r * CELL_PX;
        if (r > 0 && !cell.up) {
          cctx.beginPath();
          cctx.moveTo(x, y);
          cctx.lineTo(x + CELL_PX, y);
          cctx.stroke();
        }
        if (c > 0 && !cell.left) {
          cctx.beginPath();
          cctx.moveTo(x, y);
          cctx.lineTo(x, y + CELL_PX);
          cctx.stroke();
        }
      }
    }

    // Exit cell.
    const exit = view.exitCell;
    cctx.fillStyle = '#ffd23f';
    cctx.globalAlpha = 0.6;
    cctx.fillRect(exit.c * CELL_PX + 3, exit.r * CELL_PX + 3, CELL_PX - 6, CELL_PX - 6);
    cctx.globalAlpha = 1;

    // Racers.
    for (const p of view.players) {
      if (!p.racingThisRound) continue;
      cctx.fillStyle = p.color;
      cctx.globalAlpha = p.finished ? 0.5 : 1;
      const cx = p.c * CELL_PX + CELL_PX / 2;
      const cy = p.r * CELL_PX + CELL_PX / 2;
      cctx.beginPath();
      cctx.arc(cx, cy, CELL_PX * 0.32, 0, Math.PI * 2);
      cctx.fill();
      cctx.globalAlpha = 1;
    }
  }

  function renderLeaderboard() {
    lbEl.innerHTML = '';
    if (!view) return;
    for (const entry of view.leaderboard) {
      const li = document.createElement('li');
      const you = entry.clientId === api.getClientId() ? ' (you)' : '';
      li.textContent = entry.finished
        ? `${nicknameFor(entry.clientId)}${you} — ${fmtMs(entry.finishMs)}`
        : `${nicknameFor(entry.clientId)}${you} — racing…`;
      lbEl.appendChild(li);
    }
  }

  function renderTimer() {
    if (!view || view.phase !== 'racing' || !view.roundStartedAt) {
      timerEl.textContent = '';
      return;
    }
    const me = myPlayer();
    if (!me || !me.racingThisRound) {
      timerEl.textContent = '';
      return;
    }
    if (me.finished) {
      timerEl.textContent = `FINISHED: ${fmtMs(me.finishMs)}`;
    } else {
      timerEl.textContent = fmtMs(Date.now() - view.roundStartedAt);
    }
  }

  function render() {
    statusEl.textContent = statusLabel();
    raceBtn.textContent = view && view.phase === 'results' ? 'NEW RACE' : 'START RACE';
    raceBtn.disabled = !view || view.phase === 'racing';
    drawMaze();
    renderLeaderboard();
    renderTimer();
  }

  let timerInterval = setInterval(renderTimer, 100);

  function sendMove(dir) {
    api.sendAction({ kind: 'move', direction: dir });
  }

  function onKeyDown(ev) {
    if (ev.repeat) return; // one move per physical keypress, not per OS auto-repeat tick
    const dir = KEY_TO_DIR[ev.code];
    if (!dir) return;
    ev.preventDefault();
    sendMove(dir);
  }
  window.addEventListener('keydown', onKeyDown);

  return {
    applySnapshot(snapshot) {
      view = snapshot;
      render();
    },
    applyEvent(data) {
      if (data && data.kind === 'state') {
        view = data;
        render();
      }
    },
    applyRoster(newRoster) {
      roster = newRoster;
      render();
    },
    unmount() {
      window.removeEventListener('keydown', onKeyDown);
      clearInterval(timerInterval);
      container.innerHTML = '';
    },
  };
}
