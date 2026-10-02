// TRON-style light-cycles — real-time tick-loop game (see server/games/tron.js). Grid-based:
// each player's cycle moves one cell per server tick in its current direction, leaving a solid
// trail; steer with arrow keys/WASD (or the on-screen D-pad) to avoid walls, trails, and other
// players. Last one alive wins the round.
import { sfx } from '../sfx.js';
import { createFx, flashEl, sharpCanvas } from '../canvasFx.js';
import { createBotBar } from '../tickBots.js';

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

const STATUS_TEXT = { waiting: 'next round', ready: 'ready', alive: 'alive', dead: 'out' };

// Most wins first, then most draws, then fewest rounds played (a newcomer with 0-0 isn't ranked
// above someone who's played and lost), then name.
export function sortedStandings(players) {
  return players.slice().sort((a, b) => (b.wins || 0) - (a.wins || 0)
    || (b.draws || 0) - (a.draws || 0)
    || (a.rounds || 0) - (b.rounds || 0)
    || String(a.nickname).localeCompare(String(b.nickname)));
}

function injectScoreStyles() {
  if (document.getElementById('tron-score-styles')) return;
  const style = document.createElement('style');
  style.id = 'tron-score-styles';
  style.textContent = `
.tron-score { min-width: 250px; max-width: 340px; font-size: 0.85em; }
.tron-score-head { display: flex; justify-content: space-between; align-items: baseline; margin: 0 0 6px; }
.tron-score-round { opacity: 0.6; font-size: 0.85em; letter-spacing: 1px; }
.tron-score-table { width: 100%; border-collapse: collapse; }
.tron-score-table th { text-align: left; font-weight: normal; opacity: 0.55; font-size: 0.8em; padding: 0 4px 3px; border-bottom: 1px solid rgba(57,255,20,0.25); }
.tron-score-table th:nth-child(3), .tron-score-table th:nth-child(4) { text-align: center; }
.tron-score-row td { padding: 4px; border-bottom: 1px solid rgba(57,255,20,0.08); }
.tron-score-row .rank { width: 1.4em; text-align: center; opacity: 0.6; }
.tron-score-row .name { color: var(--c); max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tron-score-row .sw { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--c); box-shadow: 0 0 6px var(--c); margin-right: 6px; vertical-align: middle; }
.tron-score-row .num { text-align: center; width: 2em; font-variant-numeric: tabular-nums; }
.tron-score-row .w { font-weight: bold; color: #fff; }
.tron-score-row .st { font-size: 0.8em; opacity: 0.6; text-align: right; white-space: nowrap; }
.tron-score-row .st-alive { color: #39ff14; opacity: 0.9; }
.tron-score-row.dead .name { opacity: 0.45; text-decoration: line-through; }
.tron-score-row.me .name span { text-decoration: underline; text-underline-offset: 3px; }
.tron-score-row.leader { background: linear-gradient(90deg, rgba(255,215,0,0.16), transparent); }
.tron-score-row.leader .rank { color: #ffd700; opacity: 1; text-shadow: 0 0 6px #ffd700; }
.tron-score-reset { margin-top: 8px; font-size: 0.8em; padding: 2px 8px; }
.tron-overlay-standings { margin-top: 8px; font-size: 0.45em; font-weight: normal; display: grid; gap: 2px; min-width: 180px; }
.tron-overlay-standings div { display: flex; justify-content: space-between; gap: 16px; }
@media (max-width: 900px) { .tron-score { max-width: none; width: 100%; } }
`;
  document.head.appendChild(style);
}

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
  body.style.flexWrap = 'wrap';
  body.style.justifyContent = 'center';

  const canvasWrap = document.createElement('div');
  canvasWrap.style.position = 'relative';

  const canvas = document.createElement('canvas');
  canvas.style.background = '#05080a';
  canvas.style.touchAction = 'none';
  const ctx = sharpCanvas(canvas, CANVAS_WIDTH, CANVAS_HEIGHT);
  canvas.style.maxWidth = '100%';
  canvas.style.height = 'auto';
  const fx = createFx();
  let sparkClock = 0;

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

  // Scoreboard: round wins/draws per player for as long as they stay in the room (server keeps
  // the tallies; see scoreRound in server/games/tron.js). Styles are scoped under .tron-score.
  injectScoreStyles();
  const side = document.createElement('div');
  side.className = 'tron-score';
  const sideTitle = document.createElement('div');
  sideTitle.className = 'tron-score-head';
  const sideTitleText = document.createElement('span');
  sideTitleText.textContent = '> SCOREBOARD';
  const roundLabel = document.createElement('span');
  roundLabel.className = 'tron-score-round';
  sideTitle.append(sideTitleText, roundLabel);
  const playersEl = document.createElement('table');
  playersEl.className = 'tron-score-table';
  const resetBtn = document.createElement('button');
  resetBtn.className = 'tron-score-reset';
  resetBtn.textContent = 'RESET SCORES';
  resetBtn.title = 'Set everyone\'s wins and draws back to zero';
  resetBtn.addEventListener('click', () => {
    sfx.play('click');
    api.sendAction({ kind: 'resetScores' });
  });
  side.append(sideTitle, playersEl, resetBtn);

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

  // Rebuilt only when something visible changes (ticks arrive at 40Hz). A W cell that just went
  // up pops, so the scoreboard reads as live rather than a static list.
  let scoreKey = null;
  const prevWins = new Map();
  function renderPlayers(view) {
    const me = myClientId();
    const rows = sortedStandings(view.players);
    const top = rows.length && rows[0].wins > 0 ? rows[0].wins : 0;
    const key = `${view.roundsPlayed}|${me}|` + rows.map((p) => `${p.clientId}:${p.wins}:${p.draws}:${p.status}`).join('|');
    if (key === scoreKey) return;
    scoreKey = key;
    roundLabel.textContent = view.roundsPlayed ? `${view.roundsPlayed} ROUND${view.roundsPlayed === 1 ? '' : 'S'}` : '';
    resetBtn.disabled = !rows.some((p) => p.wins || p.draws);
    playersEl.textContent = '';
    const head = playersEl.insertRow();
    head.className = 'tron-score-th';
    for (const [t, title] of [['#', ''], ['PLAYER', ''], ['W', 'Round wins'], ['D', 'Draws (crashed out together)'], ['', '']]) {
      const th = document.createElement('th');
      th.textContent = t;
      if (title) th.title = title;
      head.appendChild(th);
    }
    rows.forEach((p, i) => {
      const tr = playersEl.insertRow();
      const leader = top > 0 && p.wins === top;
      tr.className = `tron-score-row${leader ? ' leader' : ''}${p.clientId === me ? ' me' : ''}${p.status === 'dead' ? ' dead' : ''}`;
      tr.style.setProperty('--c', p.color);
      const rank = tr.insertCell();
      rank.className = 'rank';
      rank.textContent = leader ? '♛' : String(i + 1);
      const name = tr.insertCell();
      name.className = 'name';
      const sw = document.createElement('i');
      sw.className = 'sw';
      const nm = document.createElement('span');
      nm.textContent = p.nickname + (p.clientId === me ? ' (you)' : '');
      name.append(sw, nm);
      name.title = `${p.nickname} — ${p.rounds || 0} round${p.rounds === 1 ? '' : 's'} played`;
      const w = tr.insertCell();
      w.className = 'num w';
      w.textContent = String(p.wins || 0);
      const d = tr.insertCell();
      d.className = 'num';
      d.textContent = String(p.draws || 0);
      const st = tr.insertCell();
      st.className = `st st-${p.status}`;
      st.textContent = STATUS_TEXT[p.status] || p.status;
      if (prevWins.has(p.clientId) && (p.wins || 0) > prevWins.get(p.clientId)) {
        w.animate([{ transform: 'scale(1.9)', color: '#fff' }, { transform: 'scale(1)' }], { duration: 600, easing: 'ease-out' });
      }
    });
    prevWins.clear();
    for (const p of rows) prevWins.set(p.clientId, p.wins || 0);
  }

  // Round-over banner: the winner plus a compact standings line underneath.
  function renderOverlay(view) {
    overlay.textContent = '';
    const big = document.createElement('div');
    big.textContent = view.roundOver && view.roundOver.isDraw ? 'DRAW!' : `${view.roundOver ? view.roundOver.winnerNickname : ''} WINS!`;
    overlay.appendChild(big);
    const rows = sortedStandings(view.players).slice(0, 5);
    if (rows.length) {
      const tbl = document.createElement('div');
      tbl.className = 'tron-overlay-standings';
      for (const p of rows) {
        const line = document.createElement('div');
        line.style.color = p.color;
        const won = view.roundOver && view.roundOver.winnerId === p.clientId;
        const n = document.createElement('span');
        n.textContent = p.nickname;
        const sc = document.createElement('b');
        sc.textContent = `${p.wins || 0}${won ? ' +1' : ''}`;
        line.append(n, sc);
        tbl.appendChild(line);
      }
      overlay.appendChild(tbl);
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
    fx.applyShake(ctx);
    const now = performance.now();
    const emitSparks = now - sparkClock > 33;
    if (emitSparks) sparkClock = now;

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
      // Soft neon halo under the solid trail (two wide low-alpha passes — far cheaper than
      // shadowBlur on a long path every frame), then the trail itself with a bright core.
      ctx.globalAlpha = dim ? 0.05 : 0.12;
      ctx.lineWidth = TRAIL_WIDTH_PX * 2.6;
      ctx.stroke();
      ctx.globalAlpha = dim ? 0.08 : 0.2;
      ctx.lineWidth = TRAIL_WIDTH_PX * 1.6;
      ctx.stroke();
      ctx.globalAlpha = dim ? 0.35 : 0.9;
      ctx.lineWidth = TRAIL_WIDTH_PX;
      ctx.stroke();
      if (!dim) {
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = TRAIL_WIDTH_PX * 0.25;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      if (p.status === 'alive') {
        const px = hx * CELL_PX + CELL_PX / 2;
        const py = hy * CELL_PX + CELL_PX / 2;
        ctx.save();
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 14;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(px, py, BALL_RADIUS_PX + 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        if (emitSparks && view.phase === 'playing') {
          fx.burst(px, py, p.color, { count: 1, speed: 40, life: 0.35, size: 1.6 });
        }
        ctx.fillStyle = p.color;
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(p.nickname, px, py - 10);
      }
    }

    fx.draw(ctx);
    ctx.restore();
    fx.drawOverlay(ctx, CANVAS_WIDTH, CANVAS_HEIGHT);

    const wasHidden = overlay.hidden;
    overlay.hidden = view.phase !== 'round_over';
    if (wasHidden && !overlay.hidden) {
      overlay.style.fontSize = '2em';
      overlay.animate([{ transform: 'translate(-50%, -50%) scale(0.3)', opacity: 0 }, { transform: 'translate(-50%, -50%) scale(1.15)', opacity: 1, offset: 0.7 }, { transform: 'translate(-50%, -50%) scale(1)' }], { duration: 420, easing: 'ease-out' });
    }
    if (wasHidden && !overlay.hidden) renderOverlay(view);
  }

  let sfxPrev = null;
  function tronSounds(view) {
    const me = api.getClientId();
    const prev = sfxPrev;
    sfxPrev = view;
    if (!prev) return;
    if (view.phase === 'countdown') {
      const a = Math.ceil((prev.countdownRemainingMs || 0) / 1000);
      const b = Math.ceil((view.countdownRemainingMs || 0) / 1000);
      if (prev.phase !== 'countdown' || b < a) {
        sfx.play('beep');
        if (b > 0) fx.bigLabel(String(b));
      }
    }
    if (view.phase === 'playing' && prev.phase === 'countdown') {
      sfx.play('go');
      fx.bigLabel('GO!');
    }
    // Crash explosions for every player who died this tick (bigger, with shake + flash, for you).
    for (const p of view.players) {
      const before = prev.players.find((q) => q.clientId === p.clientId);
      if (!before || before.status === 'dead' || p.status !== 'dead') continue;
      const h = p.head || curHeadMap.get(p.clientId);
      if (!h) continue;
      const x = h.x * CELL_PX + CELL_PX / 2;
      const y = h.y * CELL_PX + CELL_PX / 2;
      const mine = p.clientId === me;
      fx.burst(x, y, p.color, { count: mine ? 60 : 36, speed: 260, life: 0.8, size: 3 });
      fx.burst(x, y, '#ffffff', { count: 12, speed: 140, life: 0.4, size: 2 });
      fx.ring(x, y, p.color, { radius: 48, life: 0.5 });
      fx.shake(mine ? 9 : 4);
      if (mine) flashEl(canvasWrap);
    }
    const was = prev.players.find((p) => p.clientId === me);
    const now = view.players.find((p) => p.clientId === me);
    if (was && now && was.status !== 'dead' && now.status === 'dead') sfx.play('crash');
    if (view.phase === 'round_over' && prev.phase !== 'round_over' && view.roundOver) {
      if (view.roundOver.isDraw || !now) sfx.play('point');
      else sfx.play(view.roundOver.winnerId === me ? 'win' : 'lose');
      const w = !view.roundOver.isDraw && view.players.find((p) => p.clientId === view.roundOver.winnerId);
      const wh = w && (w.head || curHeadMap.get(w.clientId));
      if (wh) {
        const x = wh.x * CELL_PX + CELL_PX / 2;
        const y = wh.y * CELL_PX + CELL_PX / 2;
        for (let i = 0; i < 3; i++) fx.ring(x, y, w.color, { radius: 30 + i * 25, life: 0.6 + i * 0.2 });
        fx.burst(x, y, w.color, { count: 50, speed: 220, life: 1.1, size: 2.5, gravity: 120 });
      }
    }
  }

  function applyView(view) {
    tronSounds(view);
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
    botBar.update(view.players);
    statusEl.textContent = statusLabel(view);
    draw(view);
  }

  const statusEl = document.createElement('p');
  statusEl.style.margin = '0';
  statusEl.style.fontSize = '0.9em';
  statusEl.style.fontWeight = 'bold';
  wrap.insertBefore(statusEl, body);
  const botBar = createBotBar(api);
  wrap.insertBefore(botBar.el, body);

  function applySnapshotView(snapshot) {
    trailMap.clear();
    for (const [clientId, cells] of Object.entries(snapshot.trails || {})) {
      trailMap.set(clientId, cells.slice());
    }
    applyView(snapshot);
  }

  function applyTickView(view) {
    if (lastRoundId !== null && view.roundId !== lastRoundId) {
      trailMap.clear();
      lastSentDir = null; // a new round starts with a new heading — don't swallow the first key
    }
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
