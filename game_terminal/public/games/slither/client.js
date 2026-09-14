// Slither.io-style real-time game — first "tick loop" game in the hub (see
// server/games/slither.js and game_terminal/FUTURE.md for the design writeup).
// Unlike the other games, the server drives the world on its own schedule; this client
// just sends steering/boost intent and renders whatever state snapshot arrives.

const CANVAS_WIDTH = 640;
const CANVAS_HEIGHT = 480;
const FOOD_RADIUS = 6;
const MINIMAP_SIZE = 128;
const MINIMAP_MARGIN = 10;
const STEER_SEND_MS = 70;
const STEER_EPSILON = 0.02;

// Must match server TICK_MS (server/games/slither.js) — no shared module in this repo, kept in
// sync by hand like START_LENGTH below. Used to time client-side interpolation between ticks.
const SERVER_TICK_MS = 50;
// A per-tick head displacement past this is a teleport (respawn), not real movement — even
// boosted top speed is a few units/tick, nowhere close to this, so skip interpolating across it
// rather than drawing a false streak from the old death spot to the new spawn point.
const TELEPORT_DIST_SQ = 50 ** 2;

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

// Girth grows a bit alongside length too, not just the tail getting longer. Same formula as
// server/games/slither.js's radiusFor — kept in sync by hand like START_LENGTH above.
const BASE_SNAKE_RADIUS = 9;
const MAX_SNAKE_RADIUS = 13;
const RADIUS_GROWTH_LENGTH = 1800;

function computeRadius(length) {
  const t = Math.min(1, Math.max(0, (length - START_LENGTH) / RADIUS_GROWTH_LENGTH));
  return BASE_SNAKE_RADIUS + (MAX_SNAKE_RADIUS - BASE_SNAKE_RADIUS) * t;
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
  hint.textContent = 'MOVE MOUSE / DRAG TO STEER — CLICK, SPACE, OR THE BOOST BUTTON TO BOOST';
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

  // Dedicated boost control — mainly for touch, where the canvas itself has to be free for
  // steer-by-drag without every touch also engaging boost (see onPointerDown below).
  const boostBtn = document.createElement('button');
  boostBtn.textContent = 'BOOST';
  boostBtn.style.position = 'absolute';
  boostBtn.style.bottom = '10px';
  boostBtn.style.right = '10px';
  boostBtn.style.padding = '10px 16px';
  boostBtn.style.opacity = '0.85';
  boostBtn.style.touchAction = 'none';
  boostBtn.style.userSelect = 'none';

  // Minimap: shows every visible snake's head on the full arena, so a huge/zoomed-out arena
  // doesn't leave players unable to tell where threats or open food-rich space are relative to
  // their own position (playtest request: "add minimap").
  const minimap = document.createElement('canvas');
  minimap.width = MINIMAP_SIZE;
  minimap.height = MINIMAP_SIZE;
  minimap.style.position = 'absolute';
  minimap.style.top = `${MINIMAP_MARGIN}px`;
  minimap.style.right = `${MINIMAP_MARGIN}px`;
  minimap.style.background = 'rgba(5, 8, 10, 0.75)';
  minimap.style.border = '1px solid #1f8f0c';
  minimap.style.pointerEvents = 'none';
  const minimapCtx = minimap.getContext('2d');

  canvasWrap.appendChild(canvas);
  canvasWrap.appendChild(overlay);
  canvasWrap.appendChild(boostBtn);
  canvasWrap.appendChild(minimap);

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

  // Two most recent tick views plus when the latest one arrived, so rendering can interpolate
  // snake positions between them instead of snapping — see draw()/currentRenderView() below.
  let previousView = null;
  let currentView = null;
  let lastTickAt = 0;
  // The server sends the full food list only once (on join/snapshot); every tick after that
  // sends just an add/remove delta (foodAdded/foodRemoved) to keep the 20x/second broadcast
  // small, so this client maintains its own running copy keyed by food id.
  const foodMap = new Map();

  // Debug hook for automated verification — harmless to leave mounted, mirrors the
  // convention set by the drawing game's window.__debugSegmentCount.
  window.__slitherDebug = {
    getLastView: () => currentView,
    getRenderView: () => currentRenderView(),
    getMyId: () => api.getClientId(),
    computeZoom,
    computeRadius,
  };

  function myClientId() {
    return api.getClientId();
  }

  function findOwnSnake(view) {
    const id = myClientId();
    return view.snakes.find((s) => s.clientId === id) || null;
  }

  function draw(view) {
    ctx.fillStyle = '#05080a';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    if (!view) return;

    const own = findOwnSnake(view);
    const camX = own ? own.points[0].x : view.arenaSize / 2;
    const camY = own ? own.points[0].y : view.arenaSize / 2;
    const zoom = computeZoom(own ? own.length : START_LENGTH);
    const toScreen = (x, y) => [CANVAS_WIDTH / 2 + (x - camX) * zoom, CANVAS_HEIGHT / 2 + (y - camY) * zoom];

    // arena border
    const [bx, by] = toScreen(0, 0);
    ctx.strokeStyle = '#1f8f0c';
    ctx.lineWidth = 2;
    ctx.strokeRect(bx, by, view.arenaSize * zoom, view.arenaSize * zoom);

    // food
    ctx.fillStyle = '#ffb000';
    for (const f of view.food) {
      const [x, y] = toScreen(f.x, f.y);
      if (x < -20 || x > CANVAS_WIDTH + 20 || y < -20 || y > CANVAS_HEIGHT + 20) continue;
      ctx.beginPath();
      ctx.arc(x, y, FOOD_RADIUS * zoom, 0, Math.PI * 2);
      ctx.fill();
    }

    // snakes
    for (const s of view.snakes) {
      if (!s.alive || s.points.length < 2) continue;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = computeRadius(s.length) * 2 * zoom;
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

    if (!own || own.alive) {
      overlay.hidden = true;
    } else {
      overlay.hidden = false;
      const remainingSec = own.respawnAt ? Math.max(0, Math.ceil((own.respawnAt - Date.now()) / 1000)) : 0;
      overlay.textContent = `YOU DIED — RESPAWNING IN ${remainingSec}…`;
    }

    drawMinimap(view, own, camX, camY, zoom);
  }

  function drawMinimap(view, own, camX, camY, zoom) {
    minimapCtx.fillStyle = 'rgba(5, 8, 10, 0.75)';
    minimapCtx.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
    if (!view) return;
    const scale = MINIMAP_SIZE / view.arenaSize;
    const myId = myClientId();

    for (const s of view.snakes) {
      if (!s.alive || !s.points.length) continue;
      const head = s.points[0];
      const isMe = s.clientId === myId;
      const x = head.x * scale;
      const y = head.y * scale;
      minimapCtx.beginPath();
      minimapCtx.arc(x, y, isMe ? 4 : 2.5, 0, Math.PI * 2);
      minimapCtx.fillStyle = s.color;
      minimapCtx.fill();
      if (isMe) {
        minimapCtx.lineWidth = 1.5;
        minimapCtx.strokeStyle = '#fff';
        minimapCtx.stroke();
      }
    }

    // Viewport rectangle: what the main camera currently shows, mapped onto the minimap.
    if (own) {
      const halfW = (CANVAS_WIDTH / zoom / 2) * scale;
      const halfH = (CANVAS_HEIGHT / zoom / 2) * scale;
      minimapCtx.strokeStyle = 'rgba(255,255,255,0.5)';
      minimapCtx.lineWidth = 1;
      minimapCtx.strokeRect(camX * scale - halfW, camY * scale - halfH, halfW * 2, halfH * 2);
    }
  }

  function renderLeaderboard(view) {
    leaderboardEl.innerHTML = '';
    for (const entry of view.leaderboard) {
      const li = document.createElement('li');
      li.textContent = entry.clientId === myClientId() ? `${entry.nickname} (you) — ${entry.length}` : `${entry.nickname} — ${entry.length}`;
      leaderboardEl.appendChild(li);
    }
  }

  function applySnapshotView(snapshot) {
    foodMap.clear();
    for (const f of snapshot.food || []) foodMap.set(f.id, f);
    const view = { ...snapshot, food: [...foodMap.values()] };
    previousView = view;
    currentView = view;
    lastTickAt = performance.now();
    renderLeaderboard(view);
  }

  function applyTickView(view) {
    // Added before removed: an item can be added (e.g. dropped from a corpse) and eaten again
    // within the same tick, appearing in both lists — applying added first means that case
    // nets out to "removed", matching what the server actually still has.
    for (const f of view.foodAdded || []) foodMap.set(f.id, f);
    for (const id of view.foodRemoved || []) foodMap.delete(id);
    previousView = currentView || view;
    currentView = { ...view, food: [...foodMap.values()] };
    lastTickAt = performance.now();
    renderLeaderboard(currentView);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  // Interpolates each live snake's points toward its current position from where it was last
  // tick, so movement reads as continuous between the server's 50ms ticks instead of snapping —
  // network delivery isn't perfectly evenly spaced, so rendering strictly on message arrival
  // (the old behavior) could read as jitter even when the server itself ticks on time.
  function interpolateSnakes(t) {
    const prevById = new Map(previousView.snakes.map((s) => [s.clientId, s]));
    return currentView.snakes.map((s) => {
      if (!s.alive) return s;
      const prev = prevById.get(s.clientId);
      if (!prev || !prev.alive) return s;
      const dx = s.points[0].x - prev.points[0].x;
      const dy = s.points[0].y - prev.points[0].y;
      if (dx * dx + dy * dy > TELEPORT_DIST_SQ) return s;
      const n = Math.min(prev.points.length, s.points.length);
      const points = s.points.map((p, i) => (i < n ? { x: lerp(prev.points[i].x, p.x, t), y: lerp(prev.points[i].y, p.y, t) } : p));
      return { ...s, points };
    });
  }

  // What to actually draw this animation frame: interpolated between the last two tick views if
  // we have both, otherwise whatever's current (or nothing, before the first snapshot arrives).
  function currentRenderView() {
    if (!currentView) return null;
    if (!previousView || previousView === currentView) return currentView;
    const t = Math.min(1, (performance.now() - lastTickAt) / SERVER_TICK_MS);
    if (t >= 1) return currentView;
    return { ...currentView, snakes: interpolateSnakes(t) };
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
      // Some pointer types/browsers can reject capture; steering should still work.
    }
    // Mouse click-and-hold on the canvas is a deliberate boost gesture. Touch has no separate
    // "hover" state though — every touch is a pointerdown just to steer-by-drag — so tying
    // boost to canvas pointerdown for touch would make it impossible to steer without also
    // draining length the whole time. Touch/pen boost instead via the dedicated button below.
    if (ev.pointerType === 'mouse') {
      boostSources.add('pointer');
      sendBoost();
    }
  }
  function onPointerUp() {
    boostSources.delete('pointer');
    sendBoost();
  }
  function onBoostBtnDown(ev) {
    ev.preventDefault();
    boostSources.add('button');
    sendBoost();
  }
  function onBoostBtnUp() {
    boostSources.delete('button');
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
  boostBtn.addEventListener('pointerdown', onBoostBtnDown);
  boostBtn.addEventListener('pointerup', onBoostBtnUp);
  boostBtn.addEventListener('pointerleave', onBoostBtnUp);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  const steerHandle = setInterval(() => {
    if (lastSentAngle === null || angleDiff(desiredAngle, lastSentAngle) > STEER_EPSILON) {
      lastSentAngle = desiredAngle;
      api.sendAction({ kind: 'steer', angle: desiredAngle });
    }
  }, STEER_SEND_MS);

  // Redraws every animation frame from whatever the latest (interpolated) state is, rather than
  // only when a network message happens to arrive — decouples render smoothness from WebSocket
  // delivery timing, which isn't perfectly evenly spaced under real network conditions.
  let rafHandle = requestAnimationFrame(function renderLoop() {
    draw(currentRenderView());
    rafHandle = requestAnimationFrame(renderLoop);
  });

  return {
    applySnapshot(snapshot) {
      applySnapshotView(snapshot);
    },
    applyEvent(data) {
      if (data && data.kind === 'state') applyTickView(data.view);
    },
    unmount() {
      clearInterval(steerHandle);
      cancelAnimationFrame(rafHandle);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerUp);
      boostBtn.removeEventListener('pointerdown', onBoostBtnDown);
      boostBtn.removeEventListener('pointerup', onBoostBtnUp);
      boostBtn.removeEventListener('pointerleave', onBoostBtnUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      delete window.__slitherDebug;
      container.innerHTML = '';
    },
  };
}
