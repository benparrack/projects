// Maze Dash — the hub's "speedrun" game. Race the same procedurally-generated maze as everyone
// else in the room: arrow keys/WASD move one cell at a time (walls block you), first from the
// top-left to the bottom-right exit wins. Server plugin: ../../../server/games/mazedash.js
// (server sends the full maze wall data each round rather than the client regenerating it from
// the seed — see that file's header comment for why).
import { makeServerClock } from '../serverClock.js';
import { sfx } from '../sfx.js';
import { createFx, sharpCanvas } from '../canvasFx.js';

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
  const serverClock = makeServerClock();
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
  canvas.style.background = '#05080a';
  const cctx = sharpCanvas(canvas, CANVAS_WIDTH, CANVAS_HEIGHT);

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

  const fx = createFx();
  let wallPath = null; // Path2D for the current maze's walls, rebuilt when the maze changes
  let wallMaze = null;
  const shown = new Map(); // clientId -> { x, y, trail: [{x, y, t}] } smoothed on-screen racer pos
  const finishedSeen = new Set();
  let rafId = 0;

  function buildWalls(maze) {
    // Outer border, then each cell's own top/left wall (interior right/down walls are always the
    // same edge as the neighbor's left/up wall by construction, so this draws every wall exactly
    // once — see server/games/mazedash.js's generateMaze comment).
    const path = new Path2D();
    path.rect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = maze[r][c];
        const x = c * CELL_PX;
        const y = r * CELL_PX;
        if (r > 0 && !cell.up) { path.moveTo(x, y); path.lineTo(x + CELL_PX, y); }
        if (c > 0 && !cell.left) { path.moveTo(x, y); path.lineTo(x, y + CELL_PX); }
      }
    }
    return path;
  }

  function drawMaze() {
    const now = performance.now();
    cctx.fillStyle = '#05080a';
    cctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    if (!view || !view.maze) return;
    if (wallMaze !== view.maze) {
      wallMaze = view.maze;
      wallPath = buildWalls(view.maze);
    }
    fx.applyShake(cctx);

    // Neon walls: a wide dim halo under the crisp line.
    cctx.lineCap = 'square';
    cctx.strokeStyle = 'rgba(57,255,20,0.14)';
    cctx.lineWidth = 6;
    cctx.stroke(wallPath);
    cctx.strokeStyle = '#2bd40f';
    cctx.lineWidth = 2;
    cctx.stroke(wallPath);

    // Exit cell: pulsing gold beacon.
    const exit = view.exitCell;
    const ex = exit.c * CELL_PX + CELL_PX / 2;
    const ey = exit.r * CELL_PX + CELL_PX / 2;
    const pulse = 0.5 + 0.5 * Math.sin(now / 260);
    const glow = cctx.createRadialGradient(ex, ey, 0, ex, ey, CELL_PX * (0.9 + pulse * 0.5));
    glow.addColorStop(0, 'rgba(255,210,63,0.55)');
    glow.addColorStop(1, 'rgba(255,210,63,0)');
    cctx.fillStyle = glow;
    cctx.fillRect(ex - CELL_PX * 1.5, ey - CELL_PX * 1.5, CELL_PX * 3, CELL_PX * 3);
    cctx.fillStyle = '#ffd23f';
    cctx.globalAlpha = 0.6 + pulse * 0.35;
    cctx.fillRect(exit.c * CELL_PX + 4, exit.r * CELL_PX + 4, CELL_PX - 8, CELL_PX - 8);
    cctx.globalAlpha = 1;

    // Racers: eased toward their server cell, with a fading comet trail; yours gets a ring.
    const me = api.getClientId();
    for (const p of view.players) {
      if (!p.racingThisRound) continue;
      const tx = p.c * CELL_PX + CELL_PX / 2;
      const ty = p.r * CELL_PX + CELL_PX / 2;
      let s = shown.get(p.clientId);
      if (!s || Math.abs(s.x - tx) + Math.abs(s.y - ty) > CELL_PX * 3) {
        s = { x: tx, y: ty, trail: [] };
        shown.set(p.clientId, s);
      }
      s.x += (tx - s.x) * 0.35;
      s.y += (ty - s.y) * 0.35;
      s.trail.push({ x: s.x, y: s.y, t: now });
      while (s.trail.length && now - s.trail[0].t > 320) s.trail.shift();

      cctx.globalAlpha = p.finished ? 0.45 : 1;
      if (s.trail.length > 1) {
        cctx.strokeStyle = p.color;
        cctx.lineCap = 'round';
        for (let i = 1; i < s.trail.length; i++) {
          const k = i / s.trail.length;
          cctx.globalAlpha = (p.finished ? 0.2 : 0.45) * k;
          cctx.lineWidth = CELL_PX * 0.5 * k;
          cctx.beginPath();
          cctx.moveTo(s.trail[i - 1].x, s.trail[i - 1].y);
          cctx.lineTo(s.trail[i].x, s.trail[i].y);
          cctx.stroke();
        }
      }
      cctx.globalAlpha = p.finished ? 0.5 : 1;
      cctx.shadowColor = p.color;
      cctx.shadowBlur = 10;
      cctx.fillStyle = p.color;
      cctx.beginPath();
      cctx.arc(s.x, s.y, CELL_PX * 0.32, 0, Math.PI * 2);
      cctx.fill();
      cctx.shadowBlur = 0;
      cctx.fillStyle = 'rgba(255,255,255,0.7)';
      cctx.beginPath();
      cctx.arc(s.x - CELL_PX * 0.09, s.y - CELL_PX * 0.09, CELL_PX * 0.1, 0, Math.PI * 2);
      cctx.fill();
      if (p.clientId === me && !p.finished) {
        cctx.strokeStyle = '#fff';
        cctx.globalAlpha = 0.4 + pulse * 0.4;
        cctx.lineWidth = 1.5;
        cctx.beginPath();
        cctx.arc(s.x, s.y, CELL_PX * 0.48, 0, Math.PI * 2);
        cctx.stroke();
      }
      cctx.globalAlpha = 1;

      // First frame we see someone finished: fireworks at the exit.
      if (p.finished && !finishedSeen.has(p.clientId)) {
        finishedSeen.add(p.clientId);
        const mine = p.clientId === me;
        fx.burst(ex, ey, p.color, { count: mine ? 60 : 30, speed: mine ? 260 : 170, life: 0.9, size: 3 });
        fx.burst(ex, ey, '#ffd23f', { count: mine ? 30 : 12, speed: 200, life: 0.7, size: 2 });
        fx.ring(ex, ey, p.color, { radius: mine ? 90 : 50, width: 4 });
        const place = view.leaderboard.filter((e) => e.finished).findIndex((e) => e.clientId === p.clientId) + 1;
        if (place) fx.text(ex, ey - 12, ['', '1ST!', '2ND', '3RD'][place] || `${place}TH`, p.color, { size: mine ? 16 : 12, life: 1.2 });
        if (mine) {
          fx.shake(5);
          if (place === 1) fx.bigLabel('1ST!', '#ffd23f');
        }
      }
    }
    fx.draw(cctx);
    cctx.restore();
    fx.drawOverlay(cctx, CANVAS_WIDTH, CANVAS_HEIGHT);
  }

  function frame() {
    drawMaze();
    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);

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

  let lastTimerSfx = '';
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
    const untilGo = view.roundStartedAt - serverClock.now();
    if (untilGo > 0) {
      timerEl.textContent = `GET READY... ${Math.ceil(untilGo / 1000)}`;
      if (timerEl.textContent !== lastTimerSfx) {
        sfx.play('beep');
        fx.bigLabel(String(Math.ceil(untilGo / 1000)), '#ffd23f');
      }
      lastTimerSfx = timerEl.textContent;
    } else if (me.finished) {
      if (lastTimerSfx !== 'finished') sfx.play('win');
      lastTimerSfx = 'finished';
      timerEl.textContent = `FINISHED: ${fmtMs(me.finishMs)}`;
    } else {
      if (lastTimerSfx.startsWith('GET READY')) {
        sfx.play('go');
        fx.bigLabel('GO!', '#39ff14');
      }
      lastTimerSfx = 'racing';
      timerEl.textContent = fmtMs(serverClock.now() - view.roundStartedAt);
    }
  }

  let roundKey = null;
  function render() {
    if (view && view.roundStartedAt !== roundKey) {
      roundKey = view.roundStartedAt;
      finishedSeen.clear();
      shown.clear();
      // Anyone already finished when we first see this round (e.g. joined mid-race) gets no fireworks.
      for (const pl of view.players) if (pl.finished) finishedSeen.add(pl.clientId);
    }
    statusEl.textContent = statusLabel();
    raceBtn.textContent = view && view.phase === 'results' ? 'NEW RACE' : 'START RACE';
    raceBtn.disabled = !view || view.phase === 'racing';
    renderLeaderboard();
    renderTimer();
  }

  let timerInterval = setInterval(renderTimer, 100);

  function sendMove(dir) {
    api.sendAction({ kind: 'move', direction: dir });
  }

  // Holding a direction keeps moving at a steady rate (our own repeat, not the OS's slow,
  // uneven auto-repeat), so long corridors don't need a tap per cell.
  const MOVE_REPEAT_MS = 85;
  let heldDir = null;
  let repeatTimer = null;
  function stopRepeat() {
    clearInterval(repeatTimer);
    repeatTimer = null;
    heldDir = null;
  }
  function onKeyDown(ev) {
    if (ev.target && (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA')) return;
    const dir = KEY_TO_DIR[ev.code];
    if (!dir) return;
    ev.preventDefault();
    if (ev.repeat || dir === heldDir) return;
    stopRepeat();
    heldDir = dir;
    sendMove(dir);
    repeatTimer = setInterval(() => sendMove(dir), MOVE_REPEAT_MS);
  }
  function onKeyUp(ev) {
    if (KEY_TO_DIR[ev.code] === heldDir) stopRepeat();
  }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', stopRepeat);

  return {
    applySnapshot(snapshot) {
      view = snapshot;
      if (view) serverClock.sync(view.serverNow);
      render();
    },
    applyEvent(data) {
      if (data && data.kind === 'state') {
        view = data;
        if (view) serverClock.sync(view.serverNow);
        render();
      }
    },
    applyRoster(newRoster) {
      roster = newRoster;
      render();
    },
    unmount() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', stopRepeat);
      stopRepeat();
      clearInterval(timerInterval);
      cancelAnimationFrame(rafId);
      container.innerHTML = '';
    },
  };
}
