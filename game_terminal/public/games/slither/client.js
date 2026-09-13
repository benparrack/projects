// Slither.io-style real-time game — first "tick loop" game in the hub (see
// server/games/slither.js and game_terminal/FUTURE.md for the design writeup).
// Unlike the other games, the server drives the world on its own schedule; this client
// just sends steering/boost intent and renders whatever state snapshot arrives.

const CANVAS_WIDTH = 640;
const CANVAS_HEIGHT = 480;
const SNAKE_RADIUS = 9;
const FOOD_RADIUS = 6;
const STEER_SEND_MS = 70;
const STEER_EPSILON = 0.02;

// Shrink-to-zoom: camera zooms out as your own snake grows, so a huge snake can still see
// threats coming instead of only ever seeing a tiny sliver of the arena around its head.
// START_LENGTH kept in sync by hand with server/games/slither.js (no shared module in this repo).
const START_LENGTH = 120;
const ZOOM_MIN = 0.45;
const ZOOM_SHRINK_RATE = 500; // length growth (beyond start) over which zoom roughly halves

function computeZoom(length) {
  const grown = Math.max(0, length - START_LENGTH);
  return Math.max(ZOOM_MIN, 1 / (1 + grown / ZOOM_SHRINK_RATE));
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

export function mount(container, api) {
  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.flexDirection = 'column';
  wrap.style.gap = '8px';
  wrap.style.alignItems = 'center';

  const hint = document.createElement('p');
  hint.textContent = 'MOVE MOUSE TO STEER — HOLD CLICK OR SPACE TO BOOST';
  hint.style.margin = '0';
  hint.style.fontSize = '0.8em';
  hint.style.opacity = '0.8';

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
  canvas.style.cursor = 'crosshair';
  const ctx = canvas.getContext('2d');

  const overlay = document.createElement('div');
  overlay.style.position = 'absolute';
  overlay.style.top = '50%';
  overlay.style.left = '50%';
  overlay.style.transform = 'translate(-50%, -50%)';
  overlay.style.color = '#ff4d4d';
  overlay.style.fontWeight = 'bold';
  overlay.style.textAlign = 'center';
  overlay.style.pointerEvents = 'none';
  overlay.hidden = true;
  overlay.textContent = 'YOU DIED — RESPAWNING…';

  canvasWrap.appendChild(canvas);
  canvasWrap.appendChild(overlay);

  const side = document.createElement('div');
  side.style.minWidth = '140px';
  const lbTitle = document.createElement('p');
  lbTitle.textContent = '> LEADERBOARD';
  lbTitle.style.margin = '0 0 4px';
  const leaderboardEl = document.createElement('ol');
  leaderboardEl.style.margin = '0';
  leaderboardEl.style.paddingLeft = '18px';
  leaderboardEl.style.fontSize = '0.85em';
  side.appendChild(lbTitle);
  side.appendChild(leaderboardEl);

  body.appendChild(canvasWrap);
  body.appendChild(side);
  wrap.appendChild(hint);
  wrap.appendChild(body);
  container.appendChild(wrap);

  let lastView = null;

  // Debug hook for automated verification — harmless to leave mounted, mirrors the
  // convention set by the drawing game's window.__debugSegmentCount.
  window.__slitherDebug = {
    getLastView: () => lastView,
    getMyId: () => api.getClientId(),
    computeZoom,
  };

  function myClientId() {
    return api.getClientId();
  }

  function findOwnSnake(view) {
    const id = myClientId();
    return view.snakes.find((s) => s.clientId === id) || null;
  }

  function draw() {
    ctx.fillStyle = '#05080a';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    if (!lastView) return;

    const own = findOwnSnake(lastView);
    const camX = own ? own.points[0].x : lastView.arenaSize / 2;
    const camY = own ? own.points[0].y : lastView.arenaSize / 2;
    const zoom = computeZoom(own ? own.length : START_LENGTH);
    const toScreen = (x, y) => [CANVAS_WIDTH / 2 + (x - camX) * zoom, CANVAS_HEIGHT / 2 + (y - camY) * zoom];

    // arena border
    const [bx, by] = toScreen(0, 0);
    ctx.strokeStyle = '#1f8f0c';
    ctx.lineWidth = 2;
    ctx.strokeRect(bx, by, lastView.arenaSize * zoom, lastView.arenaSize * zoom);

    // food
    ctx.fillStyle = '#ffb000';
    for (const f of lastView.food) {
      const [x, y] = toScreen(f.x, f.y);
      if (x < -20 || x > CANVAS_WIDTH + 20 || y < -20 || y > CANVAS_HEIGHT + 20) continue;
      ctx.beginPath();
      ctx.arc(x, y, FOOD_RADIUS * zoom, 0, Math.PI * 2);
      ctx.fill();
    }

    // snakes
    for (const s of lastView.snakes) {
      if (!s.alive || s.points.length < 2) continue;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = SNAKE_RADIUS * 2 * zoom;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      s.points.forEach((p, i) => {
        const [x, y] = toScreen(p.x, p.y);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      const [hx, hy] = toScreen(s.points[0].x, s.points[0].y);
      ctx.fillStyle = '#fff';
      ctx.font = `${Math.max(9, 11 * zoom)}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(s.nickname, hx, hy - 16 * zoom);
    }

    overlay.hidden = !own || own.alive;
  }

  function renderLeaderboard(view) {
    leaderboardEl.innerHTML = '';
    for (const entry of view.leaderboard) {
      const li = document.createElement('li');
      li.textContent = entry.clientId === myClientId() ? `${entry.nickname} (you) — ${entry.length}` : `${entry.nickname} — ${entry.length}`;
      leaderboardEl.appendChild(li);
    }
  }

  function applyView(view) {
    lastView = view;
    draw();
    renderLeaderboard(view);
  }

  // --- input: mouse/touch position (relative to canvas center) steers; click or Space boosts ---
  let desiredAngle = 0;
  let lastSentAngle = null;
  const boostSources = new Set();
  let lastBoostSent = false;

  function pointerAngle(ev) {
    const rect = canvas.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    return Math.atan2(py - CANVAS_HEIGHT / 2, px - CANVAS_WIDTH / 2);
  }

  function sendBoost() {
    const on = boostSources.size > 0;
    if (on !== lastBoostSent) {
      lastBoostSent = on;
      api.sendAction({ kind: 'boost', on });
    }
  }

  function onPointerMove(ev) {
    desiredAngle = pointerAngle(ev);
  }
  function onPointerDown(ev) {
    desiredAngle = pointerAngle(ev);
    try {
      canvas.setPointerCapture(ev.pointerId);
    } catch {
      // Some pointer types/browsers can reject capture; boost should still engage.
    }
    boostSources.add('pointer');
    sendBoost();
  }
  function onPointerUp() {
    boostSources.delete('pointer');
    sendBoost();
  }
  function onKeyDown(ev) {
    if (ev.code === 'Space') {
      boostSources.add('key');
      sendBoost();
      ev.preventDefault();
    }
  }
  function onKeyUp(ev) {
    if (ev.code === 'Space') {
      boostSources.delete('key');
      sendBoost();
    }
  }

  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointerleave', onPointerUp);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  const steerHandle = setInterval(() => {
    if (lastSentAngle === null || angleDiff(desiredAngle, lastSentAngle) > STEER_EPSILON) {
      lastSentAngle = desiredAngle;
      api.sendAction({ kind: 'steer', angle: desiredAngle });
    }
  }, STEER_SEND_MS);

  return {
    applySnapshot(snapshot) {
      applyView(snapshot);
    },
    applyEvent(data) {
      if (data && data.kind === 'state') applyView(data.view);
    },
    unmount() {
      clearInterval(steerHandle);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      delete window.__slitherDebug;
      container.innerHTML = '';
    },
  };
}
