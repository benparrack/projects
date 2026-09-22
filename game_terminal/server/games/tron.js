// TRON-style light-cycles: real-time tick-loop game (see server/games/slither.js — the only
// other tick-loop precedent in this hub, and structurally the closest relative: continuous
// per-tick movement, steering input applied on the next tick, collision against persistent
// trails/walls). Round-based rather than persistent-world/instant-respawn like Slither, since
// Tron's "last one alive wins" only makes sense with a shared start/end, not individual respawn.

// 60ms (~16.7Hz) rather than the original 90ms — snappier steering input registration, and more
// ticks per second for the client's interpolated rendering to blend between (see client.js's
// TICK_MS_CLIENT, which must be kept equal to this by hand — no shared module in this repo).
const TICK_MS = 60;
const GRID_W = 64;
const GRID_H = 48;
const CELL_PX = 10; // client-side only in spirit, but kept here as documentation of the pairing
const SPAWN_MARGIN = 6;
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
    p.pendingDir = preset.dir;
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
    p.pendingDir = null;
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
    if (p.pendingDir && p.pendingDir !== DIR_OPPOSITE[p.dir]) p.dir = p.pendingDir;
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
      color: COLOR_PALETTE[st.nextColorIdx++ % COLOR_PALETTE.length],
      inRound: false,
      alive: false,
      x: null,
      y: null,
      dir: null,
      pendingDir: null,
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
  },

  onMessage(room, client, data, ctx) {
    const p = room.state.players.get(ctx.senderId);
    if (!p || !data || typeof data.kind !== 'string') return;
    if (data.kind === 'steer') {
      if (DIR_VECTORS[data.direction]) p.pendingDir = data.direction;
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
