// TRON-style light-cycles: real-time tick-loop game (see server/games/slither.js — the only
// other tick-loop precedent in this hub, and structurally the closest relative: continuous
// per-tick movement, steering input applied on the next tick, collision against persistent
// trails/walls). Round-based rather than persistent-world/instant-respawn like Slither, since
// Tron's "last one alive wins" only makes sense with a shared start/end, not individual respawn.

// 25ms (40Hz) on a 2x-finer grid (128x96 at 5px/cell, same 640x480 arena as the old 64x48 at
// 10px/cell). Old real-world speed was 10px/60ms = 0.1667px/ms; new is 5px/25ms = 0.2px/ms — about
// 20% FASTER overall, even though each individual per-tick movement is half the pixel distance
// (which is what actually reads as "smaller steps", not a slower game). Playtest feedback: "make
// the white ball smoother by making its steps smaller and just making it faster" — this is the
// deliberate reconciliation of those two asks (see client.js's TICK_MS_CLIENT, which must be kept
// equal to this by hand — no shared module in this repo).
const TICK_MS = 25;
const GRID_W = 128;
const GRID_H = 96;
const CELL_PX = 5; // client-side only in spirit, but kept here as documentation of the pairing
const SPAWN_MARGIN = 12;
const COUNTDOWN_MS = 3000;
const ROUND_OVER_DISPLAY_MS = 4000;
const MIN_PLAYERS = 2;

const COLOR_PALETTE = ['#00eaff', '#ff2fb0', '#39ff14', '#ffb000', '#8c52ff', '#ff4d4d', '#ffee58', '#00ffa2'];

const DIR_VECTORS = { up: { dx: 0, dy: -1 }, down: { dx: 0, dy: 1 }, left: { dx: -1, dy: 0 }, right: { dx: 1, dy: 0 } };
const DIR_OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

// Corner presets for the first 4 players, each facing inward along the arena's long edges
// rather than straight at a wall. Players 5+ fall back to randomized-but-retried positions
// (pickFallbackSpawn) — Tron classically supports more than 4 light-cycles in a big arena.
function cornerSpawns() {
  return [
    { x: SPAWN_MARGIN, y: SPAWN_MARGIN, dir: 'right' },
    { x: GRID_W - 1 - SPAWN_MARGIN, y: GRID_H - 1 - SPAWN_MARGIN, dir: 'left' },
    { x: GRID_W - 1 - SPAWN_MARGIN, y: SPAWN_MARGIN, dir: 'down' },
    { x: SPAWN_MARGIN, y: GRID_H - 1 - SPAWN_MARGIN, dir: 'up' },
  ];
}

const { isBotId, newBot, dropBotsIfAlone } = require('./tickBots');

// --- CPU riders. Each tick, before movement, a bot picks straight / left / right:
//   easy    looks a few cells ahead only, reacts late and wanders;
//   medium  flood-fills each option and takes the roomiest (capped look);
//   hard    full flood fill + treats cells an enemy head could reach next tick as deadly;
//   expert  hard + Voronoi territory (cells it reaches before any rival), so it cuts players off.
const BOT_LEVELS = {
  easy: { look: 6, fill: 0, headOn: false, voronoi: false, wander: 0.03, lag: 0.35 },
  medium: { look: 0, fill: 250, headOn: false, voronoi: false, wander: 0.02, lag: 0.1 },
  hard: { look: 0, fill: 4000, headOn: true, voronoi: false, wander: 0.01, lag: 0 },
  expert: { look: 0, fill: 4000, headOn: true, voronoi: true, wander: 0, lag: 0 },
};
const TER_DIST = new Int32Array(GRID_W * GRID_H);
const TER_OWNER = new Int8Array(GRID_W * GRID_H);
const FLOOD_SEEN = new Uint8Array(GRID_W * GRID_H);
const LEFT_OF = { up: 'left', left: 'down', down: 'right', right: 'up' };
const RIGHT_OF = { up: 'right', right: 'down', down: 'left', left: 'up' };

function steerBots(st) {
  const bots = [...st.players.values()].filter((p) => p.bot && p.inRound && p.alive);
  if (!bots.length) return;
  const W = GRID_W; const H = GRID_H;
  const grid = new Uint8Array(W * H);
  for (const p of st.players.values()) if (p.inRound) for (const c of p.trail) grid[c.y * W + c.x] = 1;
  const free = (x, y, g = grid) => x >= 0 && y >= 0 && x < W && y < H && !g[y * W + x];
  const rivals = (me) => [...st.players.values()].filter((p) => p !== me && p.inRound && p.alive);

  function flood(g, x, y, cap) {
    const seen = FLOOD_SEEN.fill(0);
    const q = [y * W + x]; seen[q[0]] = 1;
    let n = 0;
    while (q.length && n < cap) {
      const i = q.pop(); n++;
      const cx = i % W; const cy = (i - cx) / W;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx; const ny = cy + dy;
        if (!free(nx, ny, g)) continue;
        const k = ny * W + nx;
        if (!seen[k]) { seen[k] = 1; q.push(k); }
      }
    }
    return n;
  }
  // Cells I reach strictly before every rival (multi-source BFS), from my candidate next cell.
  function territory(g, me, x, y) {
    const dist = TER_DIST.fill(-1);
    const owner = TER_OWNER.fill(-1);
    let q = [];
    const push = (k, o) => { dist[k] = 0; owner[k] = o; q.push(k); };
    push(y * W + x, 0);
    for (const r of rivals(me)) {
      const k = r.y * W + r.x;
      if (dist[k] === -1) push(k, 1);
    }
    let mine = 0; let d = 0;
    while (q.length) {
      const nq = [];
      d++;
      for (const i of q) {
        const cx = i % W; const cy = (i - cx) / W;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx; const ny = cy + dy;
          if (!free(nx, ny, g)) continue;
          const k = ny * W + nx;
          if (dist[k] === -1) { dist[k] = d; owner[k] = owner[i]; nq.push(k); if (owner[i] === 0) mine++; }
          else if (dist[k] === d && owner[k] !== owner[i]) { if (owner[k] === 0) mine--; owner[k] = 2; }
        }
      }
      q = nq;
    }
    return mine;
  }

  for (const b of bots) {
    const lv = BOT_LEVELS[b.bot] || BOT_LEVELS.hard;
    if (b.turnQueue.length) continue;
    if (lv.lag && Math.random() < lv.lag) continue; // slow reactions
    const danger = new Uint8Array(W * H);
    if (lv.headOn) {
      for (const r of rivals(b)) {
        for (const d of Object.values(DIR_VECTORS)) {
          const nx = r.x + d.dx; const ny = r.y + d.dy;
          if (nx >= 0 && ny >= 0 && nx < W && ny < H) danger[ny * W + nx] = 1;
        }
      }
    }
    const opts = [b.dir, LEFT_OF[b.dir], RIGHT_OF[b.dir]].map((dir, k) => {
      const v = DIR_VECTORS[dir];
      const x = b.x + v.dx; const y = b.y + v.dy;
      if (!free(x, y)) return { dir, score: -1e9 };
      let score;
      if (lv.look) {
        let run = 0;
        while (run < lv.look && free(x + v.dx * run, y + v.dy * run)) run++;
        score = run * 10;
      } else {
        grid[y * W + x] = 1;
        const room = flood(grid, x, y, lv.fill);
        score = room * 10;
        if (lv.voronoi && room > 40) score = room * 2 + territory(grid, b, x, y) * 10;
        grid[y * W + x] = 0;
      }
      if (danger[y * W + x]) score -= 5e5;
      if (k === 0) score += 5; // mild preference for going straight
      score += Math.random() * 3;
      return { dir, score };
    });
    opts.sort((p, q) => q.score - p.score);
    let choice = opts[0];
    if (lv.wander && Math.random() < lv.wander && opts[1].score > opts[0].score * 0.6 && opts[1].score > 0) choice = opts[1];
    if (choice.dir !== b.dir) b.turnQueue.push(choice.dir);
  }
}

function cellKey(x, y) {
  return `${x},${y}`;
}

// Cheap retry-based fallback for the 5th+ player: pick a random point away from the edges,
// resolve facing toward the arena center (whichever axis has the bigger offset wins, matching
// pickSpawnPoint's "good enough" philosophy in slither.js rather than a fully general solver).
function pickFallbackSpawn(st, attempt) {
  const x = SPAWN_MARGIN + Math.floor(Math.random() * (GRID_W - SPAWN_MARGIN * 2));
  const y = SPAWN_MARGIN + Math.floor(Math.random() * (GRID_H - SPAWN_MARGIN * 2));
  const cx = GRID_W / 2;
  const cy = GRID_H / 2;
  const dir = Math.abs(cx - x) > Math.abs(cy - y) ? (x < cx ? 'right' : 'left') : y < cy ? 'down' : 'up';
  return { x, y, dir };
}

function buildPlayersSummary(st) {
  const players = [];
  for (const p of st.players.values()) {
    let status;
    if (!p.inRound) status = 'waiting';
    else if (st.phase === 'countdown') status = 'ready';
    else status = p.alive ? 'alive' : 'dead';
    players.push({
      clientId: p.clientId,
      bot: p.bot || undefined,
      nickname: p.nickname,
      color: p.color,
      status,
      head: p.inRound && p.x !== null ? { x: p.x, y: p.y } : null,
      dir: p.dir,
    });
  }
  return players;
}

function buildTrailsMap(st) {
  const trails = {};
  for (const p of st.players.values()) {
    if (p.inRound) trails[p.clientId] = p.trail.map((c) => ({ x: c.x, y: c.y }));
  }
  return trails;
}

function baseView(st, now) {
  return {
    gridW: GRID_W,
    gridH: GRID_H,
    roundId: st.roundId,
    phase: st.phase,
    countdownRemainingMs: st.phase === 'countdown' ? Math.max(0, st.countdownEndAt - now) : null,
    roundOver: st.phase === 'round_over' ? { winnerId: st.winnerId, isDraw: st.isDraw, winnerNickname: st.winnerNickname } : null,
    players: buildPlayersSummary(st),
  };
}

function broadcastTick(room, ctx, now) {
  const st = room.state;
  const view = { ...baseView(st, now), trailAdded: st.tickTrailAdded };
  ctx.broadcast({ v: 1, type: 'game.event', payload: { gameType: 'tron', data: { kind: 'state', view } } });
}

// Locks in every currently-connected player for the round about to start (a mid-countdown
// joiner waits for the round after this one, rather than being teleported in partway through
// the 3s countdown) and bumps roundId so clients know to wipe their locally-cached trails —
// done here (waiting -> countdown) rather than at spawn time, so the arena already reads as
// freshly cleared during the countdown, not just once movement starts.
function lockInRoundParticipants(st) {
  for (const p of st.players.values()) p.inRound = true;
  st.roundId = (st.roundId || 0) + 1;
}

function spawnParticipants(st) {
  const corners = cornerSpawns();
  let idx = 0;
  const occupied = new Set();
  for (const p of st.players.values()) {
    if (!p.inRound) continue;
    const preset = idx < corners.length ? corners[idx] : pickFallbackSpawn(st, idx);
    idx++;
    p.x = preset.x;
    p.y = preset.y;
    p.dir = preset.dir;
    p.turnQueue = [];
    p.alive = true;
    p.trail = [{ x: preset.x, y: preset.y }];
    occupied.add(cellKey(preset.x, preset.y));
    st.tickTrailAdded.push({ clientId: p.clientId, x: preset.x, y: preset.y });
  }
}

function resetAfterRound(st) {
  for (const p of st.players.values()) {
    p.inRound = false;
    p.alive = false;
    p.x = null;
    p.y = null;
    p.dir = null;
    p.turnQueue = [];
    p.trail = [];
  }
  st.phase = 'waiting';
  st.winnerId = null;
  st.winnerNickname = null;
  st.isDraw = false;
}

function stepPlaying(st) {
  // Occupied set as of BEFORE this tick's moves — every trail cell (dead or alive players
  // both count as permanent walls, per the design: crashed light-cycles leave their wall up
  // for survivors, same as the arcade original).
  const occupied = new Set();
  for (const p of st.players.values()) {
    if (!p.inRound) continue;
    for (const c of p.trail) occupied.add(cellKey(c.x, c.y));
  }

  const movers = [...st.players.values()].filter((p) => p.inRound && p.alive);
  const nextCells = new Map(); // clientId -> {x,y}
  const claimCount = new Map(); // "x,y" -> number of movers landing there this tick

  for (const p of movers) {
    // One queued turn per tick, so a quick double-tap (e.g. up-then-left to U-turn) isn't lost.
    const next = p.turnQueue.shift();
    if (next && next !== DIR_OPPOSITE[p.dir]) p.dir = next;
    const v = DIR_VECTORS[p.dir];
    const nx = p.x + v.dx;
    const ny = p.y + v.dy;
    nextCells.set(p.clientId, { x: nx, y: ny });
    const key = cellKey(nx, ny);
    claimCount.set(key, (claimCount.get(key) || 0) + 1);
  }

  for (const p of movers) {
    const { x: nx, y: ny } = nextCells.get(p.clientId);
    const key = cellKey(nx, ny);
    const outOfBounds = nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H;
    const hitWall = !outOfBounds && occupied.has(key);
    const headOn = !outOfBounds && claimCount.get(key) > 1; // two+ movers landing on the same new cell this tick

    if (outOfBounds || hitWall || headOn) {
      p.alive = false;
      // Record the crash point too (even out-of-bounds attempts stay at the last valid cell —
      // no trail cell to add there since it's off the grid).
      if (!outOfBounds) {
        p.trail.push({ x: nx, y: ny });
        st.tickTrailAdded.push({ clientId: p.clientId, x: nx, y: ny });
      }
      continue;
    }

    p.x = nx;
    p.y = ny;
    p.trail.push({ x: nx, y: ny });
    st.tickTrailAdded.push({ clientId: p.clientId, x: nx, y: ny });
  }
}

module.exports = {
  type: 'tron',
  tickIntervalMs: TICK_MS,

  createInitialState() {
    return {
      players: new Map(),
      phase: 'waiting',
      roundId: 0,
      countdownEndAt: null,
      roundOverAt: null,
      winnerId: null,
      winnerNickname: null,
      isDraw: false,
      nextColorIdx: 0,
      tickTrailAdded: [],
    };
  },

  serializeSnapshot(room) {
    const st = room.state;
    return { ...baseView(st, Date.now()), trails: buildTrailsMap(st) };
  },

  onJoin(room, client) {
    const st = room.state;
    st.players.set(client.clientId, {
      clientId: client.clientId,
      nickname: client.nickname,
      bot: client.bot || null,
      color: COLOR_PALETTE[st.nextColorIdx++ % COLOR_PALETTE.length],
      inRound: false,
      alive: false,
      x: null,
      y: null,
      dir: null,
      turnQueue: [],
      trail: [],
    });
  },

  // Deliberately removes the player's record entirely, walls and all, rather than leaving a
  // crashed cycle's trail behind forever — a departed player's wall permanently blocking the
  // arena (possibly for the rest of the room's life) is worse than the minor unrealism of it
  // vanishing with them. A mid-round departure is picked up by the next tick's alive-count
  // check same as a real crash would be.
  onLeave(room, client) {
    room.state.players.delete(client.clientId);
    dropBotsIfAlone(room.state.players);
  },

  onMessage(room, client, data, ctx) {
    const p = room.state.players.get(ctx.senderId);
    if (!p || !data || typeof data.kind !== 'string') return;
    if (data.kind === 'addBot') {
      const b = newBot(room.state.players, data.level);
      if (b) module.exports.onJoin(room, { clientId: b.clientId, nickname: b.nickname, bot: b.level });
      return;
    }
    if (data.kind === 'removeBot') {
      if (isBotId(data.clientId)) room.state.players.delete(data.clientId);
      return;
    }
    if (data.kind === 'steer') {
      if (!DIR_VECTORS[data.direction] || !p.turnQueue) return;
      const last = p.turnQueue.length ? p.turnQueue[p.turnQueue.length - 1] : p.dir;
      // Ignore no-op and reversing inputs relative to the last queued heading; cap the buffer.
      if (data.direction === last || data.direction === DIR_OPPOSITE[last]) return;
      if (p.turnQueue.length < 3) p.turnQueue.push(data.direction);
    }
  },

  tick(room, ctx) {
    const st = room.state;
    const now = Date.now();
    st.tickTrailAdded = [];

    if (st.phase === 'waiting') {
      if (st.players.size >= MIN_PLAYERS) {
        st.phase = 'countdown';
        st.countdownEndAt = now + COUNTDOWN_MS;
        lockInRoundParticipants(st);
      }
    } else if (st.phase === 'countdown') {
      if (st.players.size < MIN_PLAYERS) {
        // Everyone but one left mid-countdown — abandon it rather than starting a round
        // nobody can win.
        resetAfterRound(st);
      } else if (now >= st.countdownEndAt) {
        spawnParticipants(st);
        st.phase = 'playing';
      }
    } else if (st.phase === 'playing') {
      steerBots(st);
      stepPlaying(st);
      const aliveCount = [...st.players.values()].filter((p) => p.inRound && p.alive).length;
      if (aliveCount <= 1) {
        const survivor = [...st.players.values()].find((p) => p.inRound && p.alive) || null;
        st.phase = 'round_over';
        st.roundOverAt = now;
        st.winnerId = survivor ? survivor.clientId : null;
        st.winnerNickname = survivor ? survivor.nickname : null;
        st.isDraw = !survivor;
      }
    } else if (st.phase === 'round_over') {
      if (now - st.roundOverAt >= ROUND_OVER_DISPLAY_MS) {
        resetAfterRound(st);
      }
    }

    broadcastTick(room, ctx, now);
  },
};
