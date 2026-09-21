// Maze Dash: the hub's "speedrun" game. Every player in the room races the SAME procedurally
// generated maze (shared seed per round) from a fixed start cell to a fixed exit cell, moving one
// grid cell at a time. Purely event-driven (no tick loop, unlike Slope/TRON/Slither) — every state
// change happens synchronously inside onMessage. Server generates the maze once per round and
// sends the full wall data to clients (rather than having the client regenerate it from the seed,
// the way slope.js's track math is duplicated client-side) — a randomized-DFS maze generator has
// more opportunity to subtly diverge between two hand-kept-in-sync implementations than slope.js's
// small arithmetic formulas did, and sending ~225 cells once per round is trivially cheap, so this
// sidesteps that risk entirely while keeping the server as sole layout authority either way.

const ROWS = 15;
const COLS = 15;
const EXIT_R = ROWS - 1;
const EXIT_C = COLS - 1;
const ROUND_TIME_CAP_MS = 3 * 60 * 1000;

const COLOR_PALETTE = ['#00eaff', '#ff2fb0', '#39ff14', '#ffb000', '#8c52ff', '#ff4d4d', '#ffee58', '#00ffa2'];

const DIRS = [
  { name: 'up', dr: -1, dc: 0, opp: 'down' },
  { name: 'down', dr: 1, dc: 0, opp: 'up' },
  { name: 'left', dr: 0, dc: -1, opp: 'right' },
  { name: 'right', dr: 0, dc: 1, opp: 'left' },
];
const DIR_BY_NAME = Object.fromEntries(DIRS.map((d) => [d.name, d]));

function randomSeed() {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

// Deterministic seeded PRNG (mulberry32) — same seed always produces the same sequence, which is
// all "shared maze for everyone in the room" actually requires.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Randomized recursive backtracker (iterative, stack-based) — produces a "perfect" maze: exactly
// one path between any two cells, so it's connected and solvable by construction. `open` flags on
// each cell record passable edges (the maze's actual wall data — the single source of truth for
// both rendering and move legality).
function generateMaze(seed, rows, cols) {
  const rand = mulberry32(seed);
  const cells = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) row.push({ up: false, down: false, left: false, right: false });
    cells.push(row);
  }
  const visited = Array.from({ length: rows }, () => Array(cols).fill(false));
  const stack = [[0, 0]];
  visited[0][0] = true;
  while (stack.length > 0) {
    const [r, c] = stack[stack.length - 1];
    const dirs = DIRS.slice();
    for (let i = dirs.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
    }
    let advanced = false;
    for (const d of dirs) {
      const nr = r + d.dr;
      const nc = c + d.dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || visited[nr][nc]) continue;
      cells[r][c][d.name] = true;
      cells[nr][nc][d.opp] = true;
      visited[nr][nc] = true;
      stack.push([nr, nc]);
      advanced = true;
      break;
    }
    if (!advanced) stack.pop();
  }
  return cells;
}

// BFS distance-from-start over the maze graph. Since a perfect maze is a tree (exactly one path
// between any two cells), this distance IS the shortest (only) path length — used both as a cheap
// "how far into the maze is this racer" progress metric for the leaderboard, and, at the exit
// cell, as the solvability check (a perfect maze generated correctly is always solvable, but
// verifying it algorithmically rather than just trusting the generator is cheap insurance).
function bfsDistances(cells, rows, cols, startR, startC) {
  const dist = Array.from({ length: rows }, () => Array(cols).fill(-1));
  dist[startR][startC] = 0;
  const queue = [[startR, startC]];
  let head = 0;
  while (head < queue.length) {
    const [r, c] = queue[head++];
    for (const d of DIRS) {
      if (!cells[r][c][d.name]) continue;
      const nr = r + d.dr;
      const nc = c + d.dc;
      if (dist[nr][nc] !== -1) continue;
      dist[nr][nc] = dist[r][c] + 1;
      queue.push([nr, nc]);
    }
  }
  return dist;
}

function freshPlayer(clientId, nickname, colorIdx) {
  return {
    clientId,
    nickname,
    color: COLOR_PALETTE[colorIdx % COLOR_PALETTE.length],
    racingThisRound: false,
    r: 0,
    c: 0,
    finished: false,
    finishMs: null,
  };
}

function startRace(st, room, ctx) {
  st.seed = randomSeed();
  st.maze = generateMaze(st.seed, ROWS, COLS);
  st.distFromStart = bfsDistances(st.maze, ROWS, COLS, 0, 0);
  st.roundId = (st.roundId || 0) + 1;
  st.roundStartedAt = Date.now();
  st.roundEndedAt = null;
  st.phase = 'racing';
  for (const p of st.players.values()) {
    p.racingThisRound = true;
    p.r = 0;
    p.c = 0;
    p.finished = false;
    p.finishMs = null;
  }

  const roundId = st.roundId;
  setTimeout(() => {
    // Re-validate rather than trusting captured state — a stale timer from an earlier round (or
    // one that already ended naturally) must no-op instead of force-ending a *newer* round. Same
    // defensive re-check pattern this hub's bot-move scheduling already uses.
    if (st.roundId !== roundId || st.phase !== 'racing') return;
    endRound(st);
    broadcastState(room, ctx);
  }, ROUND_TIME_CAP_MS);
}

function endRound(st) {
  st.phase = 'results';
  st.roundEndedAt = Date.now();
}

function allRacersFinished(st) {
  const racers = [...st.players.values()].filter((p) => p.racingThisRound);
  return racers.length > 0 && racers.every((p) => p.finished);
}

function buildLeaderboard(st) {
  const list = [...st.players.values()].filter((p) => p.racingThisRound);
  const finished = list.filter((p) => p.finished).sort((a, b) => a.finishMs - b.finishMs);
  const racing = list
    .filter((p) => !p.finished)
    .sort((a, b) => {
      const da = st.distFromStart ? st.distFromStart[a.r][a.c] : 0;
      const db = st.distFromStart ? st.distFromStart[b.r][b.c] : 0;
      return db - da; // further along the (unique) path to the exit ranks higher
    });
  return [...finished, ...racing].map((p) => ({
    clientId: p.clientId,
    nickname: p.nickname,
    finished: p.finished,
    finishMs: p.finishMs,
  }));
}

function buildPublicState(room) {
  const st = room.state;
  return {
    phase: st.phase,
    rows: ROWS,
    cols: COLS,
    startCell: { r: 0, c: 0 },
    exitCell: { r: EXIT_R, c: EXIT_C },
    seed: st.seed,
    maze: st.maze,
    roundStartedAt: st.roundStartedAt,
    roundEndedAt: st.roundEndedAt,
    players: [...st.players.values()].map((p) => ({
      clientId: p.clientId,
      nickname: p.nickname,
      color: p.color,
      racingThisRound: p.racingThisRound,
      r: p.r,
      c: p.c,
      finished: p.finished,
      finishMs: p.finishMs,
    })),
    leaderboard: buildLeaderboard(st),
  };
}

function broadcastState(room, ctx) {
  ctx.broadcast({ v: 1, type: 'game.event', payload: { gameType: 'mazedash', data: { kind: 'state', ...buildPublicState(room) } } });
}

module.exports = {
  type: 'mazedash',

  createInitialState() {
    return {
      phase: 'waiting', // 'waiting' | 'racing' | 'results'
      seed: null,
      maze: null,
      distFromStart: null,
      roundId: 0,
      roundStartedAt: null,
      roundEndedAt: null,
      nextColorIdx: 0,
      players: new Map(),
    };
  },

  serializeSnapshot(room) {
    return buildPublicState(room);
  },

  onJoin(room, client) {
    const st = room.state;
    // Joining mid-race doesn't drop you into a race already in progress — you're added with
    // racingThisRound: false and simply wait for the next startRace (which resets every present
    // player, this one included, at the moment it fires).
    st.players.set(client.clientId, freshPlayer(client.clientId, client.nickname, st.nextColorIdx++));
  },

  onLeave(room, client) {
    const st = room.state;
    st.players.delete(client.clientId);
    if (st.phase === 'racing' && allRacersFinished(st)) {
      endRound(st);
      // onLeave gets no ctx (unlike onMessage) — broadcast manually so remaining clients see the
      // round end immediately instead of being stuck on a stale 'racing' view until their next
      // own action, same pattern connect4.js/checkers.js use for a leave-triggered state change.
      const envelope = { v: 1, type: 'game.event', payload: { gameType: 'mazedash', data: { kind: 'state', ...buildPublicState(room) } } };
      for (const clientId of room.clients.keys()) room.sendTo(clientId, envelope);
    }
  },

  onMessage(room, client, data, ctx) {
    if (!data || typeof data.kind !== 'string') return;
    const st = room.state;

    if (data.kind === 'startRace') {
      if (st.phase === 'racing') return;
      startRace(st, room, ctx);
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'move') {
      if (st.phase !== 'racing') return;
      const p = st.players.get(ctx.senderId);
      if (!p || !p.racingThisRound || p.finished) return;
      const d = DIR_BY_NAME[data.direction];
      if (!d) return;
      const cell = st.maze[p.r][p.c];
      if (!cell[d.name]) return; // wall blocks this direction — silent no-op
      const nr = p.r + d.dr;
      const nc = p.c + d.dc;
      if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) return;
      p.r = nr;
      p.c = nc;
      if (nr === EXIT_R && nc === EXIT_C) {
        p.finished = true;
        p.finishMs = Date.now() - st.roundStartedAt;
      }
      if (allRacersFinished(st)) endRound(st);
      broadcastState(room, ctx);
      return;
    }
  },
};
