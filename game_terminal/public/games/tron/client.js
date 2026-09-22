// TRON-style light-cycles — real-time tick-loop game (see server/games/tron.js). Grid-based:
// each player's cycle moves one cell per server tick in its current direction, leaving a solid
// trail; steer with arrow keys/WASD (or the on-screen D-pad) to avoid walls, trails, and other
// players. Last one alive wins the round.

const GRID_W = 128;
const GRID_H = 96;
const CELL_PX = 5;
const CANVAS_WIDTH = GRID_W * CELL_PX;
const CANVAS_HEIGHT = GRID_H * CELL_PX;
// Trail stroke width and head-dot radius used to be derived from CELL_PX (which doubled as both
// "grid step size" and "how chunky a rendered cell looks"), but now that CELL_PX is halved for
// finer movement steps, deriving visual thickness from it would make the trail/ball render half
// as thick too. Keep the same on-screen sizes as before (8px trail, 3.5px ball radius) by making
// them their own constants instead.
const TRAIL_WIDTH_PX = 8;
const BALL_RADIUS_PX = 3.5;
// Must match server/games/tron.js's TICK_MS by hand (no shared module in this repo) — used to
// blend the rendered head position between the previous and most-recent tick, same pattern
// slither.js/slope.js use to avoid raw-broadcast jitter.
const TICK_MS_CLIENT = 25;

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

  // Interpolation state: where each player's head was as of the PREVIOUS tick vs the most recent
  // one, plus when the most recent tick view actually arrived — draw() blends between the two
  // using elapsed real time, so movement (including turns) reads as a continuous slide between
  // ticks instead of a snap, the same fix slither.js/slope.js already needed for this hub's other
  // real-time games.
  const prevHeadMap = new Map(); // clientId -> {x,y}
  const curHeadMap = new Map(); // clientId -> {x,y}
  let viewReceivedAt = performance.now();

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

    // Faint grid so the arena reads as a grid, not an empty void. Spacing is in PIXELS (40px),
    // not a fixed cell count, so the visual line density stays the same regardless of how fine
    // GRID_W/GRID_H/CELL_PX are tuned for movement smoothness.
    const GRIDLINE_PX = 40;
    ctx.strokeStyle = 'rgba(31, 143, 12, 0.12)';
    ctx.lineWidth = 1;
    for (let gx = 0; gx <= GRID_W; gx += GRIDLINE_PX / CELL_PX) {
      ctx.beginPath();
      ctx.moveTo(gx * CELL_PX, 0);
      ctx.lineTo(gx * CELL_PX, CANVAS_HEIGHT);
      ctx.stroke();
    }
    for (let gy = 0; gy <= GRID_H; gy += GRIDLINE_PX / CELL_PX) {
      ctx.beginPath();
      ctx.moveTo(0, gy * CELL_PX);
      ctx.lineTo(CANVAS_WIDTH, gy * CELL_PX);
      ctx.stroke();
    }
    ctx.strokeStyle = '#1f8f0c';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    const t = Math.min(1, Math.max(0, (performance.now() - viewReceivedAt) / TICK_MS_CLIENT));

    // Pixel-space centerline point for a grid cell — cells render as a stroked path through
    // their centers rather than individually-filled squares, which is what makes the trail read
    // as one seamless line instead of a string of separate blocks.
    function cellPt(x, y) {
      return [x * CELL_PX + CELL_PX / 2, y * CELL_PX + CELL_PX / 2];
    }

    for (const p of view.players) {
      if (!p.head && p.status !== 'dead') continue;
      const trail = trailMap.get(p.clientId) || [];
      const dim = p.status === 'dead';

      // Interpolated head: slide from where it was last tick to where it is now, over the real
      // elapsed time since that tick's broadcast arrived — this is what removes the "jumps in
      // blocks" feel, turns included (a turn is just two straight segments meeting at a corner;
      // sliding smoothly INTO that corner instead of teleporting is the actual fix).
      const cur = curHeadMap.get(p.clientId);
      const prev = prevHeadMap.get(p.clientId);
      let hx, hy;
      if (cur && prev && p.status !== 'dead') {
        hx = prev.x + (cur.x - prev.x) * t;
        hy = prev.y + (cur.y - prev.y) * t;
      } else if (cur) {
        hx = cur.x;
        hy = cur.y;
      } else if (p.head) {
        hx = p.head.x;
        hy = p.head.y;
      } else {
        continue;
      }

      ctx.strokeStyle = p.color;
      ctx.globalAlpha = dim ? 0.4 : 0.9;
      ctx.lineWidth = TRAIL_WIDTH_PX;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      if (trail.length > 0) {
        const [x0, y0] = cellPt(trail[0].x, trail[0].y);
        ctx.moveTo(x0, y0);
        if (p.status === 'alive') {
          // Draw through every SETTLED cell except the newest one. The newest cell (trail[last])
          // is where the server just moved this player's head INTO this tick — drawing all the
          // way to it here would paint the trail there instantly on tick arrival, while the head
          // dot below is still gliding to catch up over the tick window. That mismatch was the
          // "trail is displaced from the bike" bug: the trail's tip snapped ahead immediately,
          // only the decorative dot animated. Instead, the segment leading into the newest cell
          // is drawn straight to the interpolated (sliding) head position, so the trail's tip and
          // the head dot always advance in lockstep.
          const settledCount = trail.length - 1;
          for (let i = 1; i < settledCount; i++) {
            const [x, y] = cellPt(trail[i].x, trail[i].y);
            ctx.lineTo(x, y);
          }
          ctx.lineTo(hx * CELL_PX + CELL_PX / 2, hy * CELL_PX + CELL_PX / 2);
        } else {
          // Dead: no further interpolation happening (hx/hy already settled at the crash cell),
          // so draw straight through every committed cell including the last.
          for (let i = 1; i < trail.length; i++) {
            const [x, y] = cellPt(trail[i].x, trail[i].y);
            ctx.lineTo(x, y);
          }
        }
      } else {
        ctx.moveTo(hx * CELL_PX + CELL_PX / 2, hy * CELL_PX + CELL_PX / 2);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;

      if (p.status === 'alive') {
        const px = hx * CELL_PX + CELL_PX / 2;
        const py = hy * CELL_PX + CELL_PX / 2;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(px, py, BALL_RADIUS_PX, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = p.color;
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(p.nickname, px, py - 10);
      }
    }

    overlay.hidden = view.phase !== 'round_over';
    if (!overlay.hidden) {
      overlay.textContent = view.roundOver && view.roundOver.isDraw ? 'DRAW!' : `${view.roundOver ? view.roundOver.winnerNickname : ''} WINS!`;
    }
  }

  function applyView(view) {
    if (lastRoundId !== null && view.roundId !== lastRoundId) {
      trailMap.clear();
      prevHeadMap.clear();
      curHeadMap.clear();
    }
    lastRoundId = view.roundId;
    // Shift cur -> prev before adopting the new heads, so draw()'s interpolation blends from
    // "where it was" to "where it just moved to" — skipped for a player with no previous head
    // yet (first tick after spawn), which draw() handles by rendering them at their head with no
    // slide rather than lerping from (0,0) or a stale spot.
    for (const p of view.players) {
      if (curHeadMap.has(p.clientId)) prevHeadMap.set(p.clientId, curHeadMap.get(p.clientId));
      else prevHeadMap.delete(p.clientId);
      if (p.head) curHeadMap.set(p.clientId, { x: p.head.x, y: p.head.y });
      else curHeadMap.delete(p.clientId);
    }
    viewReceivedAt = performance.now();
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

  // Redraw every real animation frame (not just when a tick broadcast arrives) so draw()'s
  // interpolation actually has frames to blend across — decoupled from the ~60ms server tick the
  // same way slither.js's/slope.js's render loops are. Cancelled on unmount to avoid leaking a
  // loop across game switches.
  let rafId = null;
  function renderLoop() {
    rafId = requestAnimationFrame(renderLoop);
    if (lastView) draw(lastView);
  }
  rafId = requestAnimationFrame(renderLoop);

  return {
    applySnapshot(snapshot) {
      applySnapshotView(snapshot);
    },
    applyEvent(data) {
      if (data && data.kind === 'state') applyTickView(data.view);
    },
    unmount() {
      window.removeEventListener('keydown', onKeyDown);
      if (rafId !== null) cancelAnimationFrame(rafId);
      delete window.__tronDebug;
      container.innerHTML = '';
    },
  };
}
