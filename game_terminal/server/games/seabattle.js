// Sea Battle (Battleship, GamePigeon-style). Two seats; each player arranges a five-ship fleet on
// a private 10x10 grid (PLACING phase — drag/rotate/randomize happens client-side, the server
// only validates the final layout), then they take turns firing at the enemy grid. A hit earns
// another shot (GamePigeon rule); the first to sink the whole enemy fleet wins.
//
// Secrecy: each viewer gets their own view (broadcastState sends per client). Ship positions are
// only ever sent to their owner, except a ship that has been sunk (its outline is public) and
// every fleet once the game is over. Shot grids (hit/miss) are public.
//
// PLAY VS BOT: the bot fleet is random; its shots come from chooseShot() below — Easy fires at
// random, Medium hunts at random then targets around hits, Hard hunts on a parity grid sized to
// the smallest ship still afloat, Expert picks the cell covered by the most possible placements of
// the remaining ships (probability density), weighting placements that run through open hits.

'use strict';

const { setBotLevel, botLevelOf } = require('./ai/levels');

const TYPE = 'seabattle';
const N = 10;
const SEATS = ['p1', 'p2'];
const BOT = 'BOT';
const FLEET = [
  { id: 'carrier', name: 'Carrier', len: 5 },
  { id: 'battleship', name: 'Battleship', len: 4 },
  { id: 'cruiser', name: 'Cruiser', len: 3 },
  { id: 'submarine', name: 'Submarine', len: 3 },
  { id: 'destroyer', name: 'Destroyer', len: 2 },
];
const LEN = Object.fromEntries(FLEET.map((s) => [s.id, s.len]));
const BOT_DELAY_MIN = 550;
const BOT_DELAY_MAX = 1000;

const other = (seat) => (seat === 'p1' ? 'p2' : 'p1');
const emptyGrid = () => Array.from({ length: N }, () => Array(N).fill(null));
const inBounds = (r, c) => r >= 0 && r < N && c >= 0 && c < N;

function shipCells(ship) {
  const out = [];
  for (let k = 0; k < LEN[ship.id]; k++) out.push(ship.dir === 'h' ? [ship.r, ship.c + k] : [ship.r + k, ship.c]);
  return out;
}

// Validate a client-sent fleet: exactly one of each ship, in bounds, no overlaps. Returns a
// normalized copy or null.
function normalizeFleet(raw) {
  if (!Array.isArray(raw) || raw.length !== FLEET.length) return null;
  const out = [];
  const seen = new Set();
  const occ = new Set();
  for (const s of raw) {
    if (!s || typeof s !== 'object' || !LEN[s.id] || seen.has(s.id)) return null;
    const r = Number(s.r);
    const c = Number(s.c);
    const dir = s.dir === 'v' ? 'v' : s.dir === 'h' ? 'h' : null;
    if (!Number.isInteger(r) || !Number.isInteger(c) || !dir) return null;
    const ship = { id: s.id, r, c, dir };
    for (const [rr, cc] of shipCells(ship)) {
      if (!inBounds(rr, cc) || occ.has(rr * N + cc)) return null;
      occ.add(rr * N + cc);
    }
    seen.add(s.id);
    out.push(ship);
  }
  return out;
}

// Random legal fleet. With `spaced`, ships never touch (not even diagonally) when that's possible.
function randomFleet(rand = Math.random, spaced = false) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const occ = new Set();
    const block = new Set();
    const fleet = [];
    let ok = true;
    for (const { id, len } of FLEET) {
      let placed = false;
      for (let t = 0; t < 300 && !placed; t++) {
        const dir = rand() < 0.5 ? 'h' : 'v';
        const r = Math.floor(rand() * (dir === 'v' ? N - len + 1 : N));
        const c = Math.floor(rand() * (dir === 'h' ? N - len + 1 : N));
        const ship = { id, r, c, dir };
        const cells = shipCells(ship);
        if (cells.some(([rr, cc]) => occ.has(rr * N + cc) || (spaced && block.has(rr * N + cc)))) continue;
        for (const [rr, cc] of cells) {
          occ.add(rr * N + cc);
          for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) block.add((rr + dr) * N + (cc + dc));
        }
        fleet.push(ship);
        placed = true;
      }
      if (!placed) { ok = false; break; }
    }
    if (ok) return fleet;
  }
  return randomFleet(rand, false);
}

// ---- Bot targeting -----------------------------------------------------------------------------
// `shots`: N x N of null | 'miss' | 'hit'. `sunk`: list of sunk ships ({id, r, c, dir}).
function shotKnowledge(shots, sunk) {
  const sunkCells = new Set();
  for (const s of sunk) for (const [r, c] of shipCells(s)) sunkCells.add(r * N + c);
  const openHits = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (shots[r][c] === 'hit' && !sunkCells.has(r * N + c)) openHits.push([r, c]);
  const sunkIds = new Set(sunk.map((s) => s.id));
  const remaining = FLEET.filter((s) => !sunkIds.has(s.id)).map((s) => s.len);
  return { sunkCells, openHits, remaining };
}

const unshot = (shots) => {
  const out = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (!shots[r][c]) out.push([r, c]);
  return out;
};
const pick = (list, rand) => list[Math.floor(rand() * list.length)];

// Target mode for Medium/Hard: extend a line of open hits if two or more line up, else fire
// next to any open hit.
function targetCells(shots, openHits) {
  const isHit = (r, c) => openHits.some(([hr, hc]) => hr === r && hc === c);
  const free = (r, c) => inBounds(r, c) && !shots[r][c];
  const line = [];
  for (const [r, c] of openHits) {
    for (const [dr, dc] of [[0, 1], [1, 0]]) {
      if (!isHit(r + dr, c + dc)) continue;
      // Walk to both ends of this run of hits and try just past them.
      let r1 = r; let c1 = c;
      while (isHit(r1 - dr, c1 - dc)) { r1 -= dr; c1 -= dc; }
      let r2 = r; let c2 = c;
      while (isHit(r2 + dr, c2 + dc)) { r2 += dr; c2 += dc; }
      if (free(r1 - dr, c1 - dc)) line.push([r1 - dr, c1 - dc]);
      if (free(r2 + dr, c2 + dc)) line.push([r2 + dr, c2 + dc]);
    }
  }
  if (line.length) return line;
  const adj = [];
  for (const [r, c] of openHits) {
    for (const [dr, dc] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) if (free(r + dr, c + dc)) adj.push([r + dr, c + dc]);
  }
  return adj;
}

// Probability density: how many placements of the remaining ships cover each unshot cell.
// Placements can't cross misses or sunk ships; ones running through open hits count far more
// (and while any open hit exists, only those placements count — pure target mode).
function densityGrid(shots, sunk) {
  const { sunkCells, openHits, remaining } = shotKnowledge(shots, sunk);
  const dens = Array.from({ length: N }, () => Array(N).fill(0));
  const targeting = openHits.length > 0;
  for (const len of remaining) {
    for (const dir of ['h', 'v']) {
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          const cells = [];
          let ok = true;
          let hits = 0;
          for (let k = 0; k < len; k++) {
            const rr = dir === 'v' ? r + k : r;
            const cc = dir === 'h' ? c + k : c;
            if (!inBounds(rr, cc) || shots[rr][cc] === 'miss' || sunkCells.has(rr * N + cc)) { ok = false; break; }
            if (shots[rr][cc] === 'hit') hits++;
            cells.push([rr, cc]);
          }
          if (!ok || (targeting && !hits)) continue;
          const w = targeting ? Math.pow(20, hits) : 1;
          for (const [rr, cc] of cells) if (!shots[rr][cc]) dens[rr][cc] += w;
        }
      }
    }
  }
  return dens;
}

function chooseShot(shots, sunk, level, rand = Math.random) {
  const open = unshot(shots);
  if (!open.length) return null;
  if (level === 'easy') return pick(open, rand);
  const { openHits, remaining } = shotKnowledge(shots, sunk);
  if (level === 'expert') {
    const dens = densityGrid(shots, sunk);
    let best = -1;
    let bests = [];
    for (const [r, c] of open) {
      // Small parity nudge breaks ties toward a checkerboard while hunting.
      const v = dens[r][c] + (openHits.length ? 0 : ((r + c) % 2 === 0 ? 0.5 : 0));
      if (v > best) { best = v; bests = [[r, c]]; } else if (v === best) bests.push([r, c]);
    }
    return best > 0 ? pick(bests, rand) : pick(open, rand);
  }
  if (openHits.length) {
    const t = targetCells(shots, openHits);
    if (t.length) return pick(t, rand);
  }
  if (level === 'hard') {
    const step = Math.max(2, Math.min(...remaining));
    const parity = open.filter(([r, c]) => (r + c) % step === 0);
    if (parity.length) return pick(parity, rand);
  }
  return pick(open, rand);
}

// ---- Game state --------------------------------------------------------------------------------
function resetRound(st) {
  st.fleets = { p1: null, p2: null };
  st.ready = { p1: false, p2: false };
  st.shots = { p1: emptyGrid(), p2: emptyGrid() }; // shots[s] = shots fired BY seat s
  st.sunk = { p1: [], p2: [] }; // sunk[s] = enemy ships sunk BY seat s
  st.turn = null;
  st.winner = null;
  st.lastShot = null;
  st.shotCount = { p1: 0, p2: 0 };
  st.roundId = (st.roundId || 0) + 1;
}

function bothSeated(st) {
  return !!(st.players.p1 && st.players.p2);
}

function startPlacing(room) {
  const st = room.state;
  resetRound(st);
  st.phase = 'placing';
  for (const seat of SEATS) {
    if (st.players[seat] === BOT) {
      st.fleets[seat] = randomFleet(Math.random, botLevelOf(st, seat) === 'expert');
      st.ready[seat] = true;
    }
  }
}

function maybeStartBattle(st) {
  if (st.phase !== 'placing' || !st.ready.p1 || !st.ready.p2) return false;
  st.phase = 'playing';
  st.turn = st.starter;
  return true;
}

// Fire `seat`'s shot at (r, c). Returns { result: 'miss'|'hit'|'sunk', ship? } or null if illegal.
function fire(st, seat, r, c) {
  const target = other(seat);
  const grid = st.shots[seat];
  if (grid[r][c]) return null;
  const ship = st.fleets[target].find((s) => shipCells(s).some(([rr, cc]) => rr === r && cc === c));
  st.shotCount[seat]++;
  if (!ship) {
    grid[r][c] = 'miss';
    st.lastShot = { by: seat, r, c, result: 'miss', n: st.shotCount.p1 + st.shotCount.p2 };
    st.turn = target;
    return { result: 'miss' };
  }
  grid[r][c] = 'hit';
  const sunkNow = shipCells(ship).every(([rr, cc]) => grid[rr][cc] === 'hit');
  if (sunkNow) st.sunk[seat].push({ ...ship });
  st.lastShot = { by: seat, r, c, result: sunkNow ? 'sunk' : 'hit', ship: sunkNow ? ship.id : null, n: st.shotCount.p1 + st.shotCount.p2 };
  if (st.sunk[seat].length === FLEET.length) {
    st.phase = 'game_over';
    st.winner = seat;
    st.turn = null;
    st.score[seat]++;
    st.starter = other(st.starter);
  }
  // A hit keeps the turn.
  return { result: sunkNow ? 'sunk' : 'hit', ship: ship.id };
}

// Per-viewer state: fleets are only included for their owner (or for everyone once it's over).
function buildView(room, forId) {
  const st = room.state;
  const mySeat = SEATS.find((s) => st.players[s] === forId) || null;
  const over = st.phase === 'game_over';
  const fleets = {};
  for (const seat of SEATS) {
    fleets[seat] = st.fleets[seat] && (over || seat === mySeat) ? st.fleets[seat].map((s) => ({ ...s })) : null;
  }
  return {
    phase: st.phase,
    players: st.players,
    botLevels: st.botLevels || {},
    mySeat,
    ready: st.ready,
    fleets,
    shots: st.shots,
    sunk: st.sunk,
    turn: st.turn,
    winner: st.winner,
    lastShot: st.lastShot,
    shotCount: st.shotCount,
    score: st.score,
    roundId: st.roundId,
    fleetSpec: FLEET,
  };
}

function broadcastState(room) {
  for (const id of room.clients.keys()) {
    room.sendTo(id, { v: 1, type: 'game.event', payload: { gameType: TYPE, data: { kind: 'state', ...buildView(room, id) } } });
  }
}

// Bot turn: re-validated when the timer fires, so a leave/reset in between makes it a no-op.
function maybeScheduleBot(room) {
  const st = room.state;
  if (st.phase !== 'playing' || st.players[st.turn] !== BOT) return;
  const seat = st.turn;
  const roundId = st.roundId;
  const n = st.shotCount.p1 + st.shotCount.p2;
  const delay = BOT_DELAY_MIN + Math.random() * (BOT_DELAY_MAX - BOT_DELAY_MIN);
  setTimeout(() => {
    const s = room.state;
    if (s !== st || s.phase !== 'playing' || s.turn !== seat || s.roundId !== roundId
      || s.players[seat] !== BOT || s.shotCount.p1 + s.shotCount.p2 !== n) return;
    const mv = chooseShot(s.shots[seat], s.sunk[seat], botLevelOf(s, seat));
    if (!mv) return;
    fire(s, seat, mv[0], mv[1]);
    broadcastState(room);
    maybeScheduleBot(room);
  }, delay);
}

function vacate(room, clientId) {
  const st = room.state;
  let changed = false;
  for (const seat of SEATS) {
    if (st.players[seat] === clientId) {
      st.players[seat] = null;
      changed = true;
    }
  }
  if (changed) {
    st.phase = 'waiting';
    st.score = { p1: 0, p2: 0 };
    resetRound(st);
  }
  return changed;
}

module.exports = {
  type: TYPE,

  createInitialState() {
    const st = { phase: 'waiting', players: { p1: null, p2: null }, botLevels: {}, score: { p1: 0, p2: 0 }, starter: 'p1' };
    resetRound(st);
    return st;
  },

  // Public matchmaking opens a new room once both seats are taken (same as the other duels).
  isRoomFull(room) {
    return bothSeated(room.state);
  },

  serializeSnapshot(room, client) {
    return buildView(room, client ? client.clientId : null);
  },

  onLeave(room, client) {
    if (vacate(room, client.clientId)) broadcastState(room);
  },

  onMessage(room, client, data, ctx) {
    if (!data || typeof data.kind !== 'string') return;
    const st = room.state;
    const me = ctx.senderId;
    const reject = (reason) => ctx.sendTo(me, { v: 1, type: 'game.event', payload: { gameType: TYPE, data: { kind: 'moveRejected', reason } } });
    const seatArg = SEATS.includes(data.seat) ? data.seat : null;
    const mySeat = SEATS.find((s) => st.players[s] === me) || null;

    if (data.kind === 'sit') {
      if (!seatArg || st.players[seatArg]) return;
      if (data.bot) {
        if (st.players[other(seatArg)] === BOT) return; // bot vs bot isn't a game anyone watches
        st.players[seatArg] = BOT;
        setBotLevel(st, seatArg, data.level);
      } else {
        if (mySeat) return;
        st.players[seatArg] = me;
      }
      if (bothSeated(st)) startPlacing(room);
      broadcastState(room);
      return;
    }

    if (data.kind === 'leaveSeat') {
      if (vacate(room, me)) broadcastState(room);
      return;
    }

    if (data.kind === 'setBotLevel') {
      if (!seatArg || st.players[seatArg] !== BOT) return;
      setBotLevel(st, seatArg, data.level);
      broadcastState(room);
      return;
    }

    if (data.kind === 'removeBot') {
      if (!seatArg || st.players[seatArg] !== BOT) return;
      st.players[seatArg] = null;
      st.phase = 'waiting';
      st.score = { p1: 0, p2: 0 };
      resetRound(st);
      broadcastState(room);
      return;
    }

    if (data.kind === 'placeFleet') {
      if (st.phase !== 'placing') return reject('not_placing');
      if (!mySeat) return reject('not_seated');
      const fleet = normalizeFleet(data.ships);
      if (!fleet) return reject('bad_fleet');
      st.fleets[mySeat] = fleet;
      st.ready[mySeat] = true;
      maybeStartBattle(st);
      broadcastState(room);
      maybeScheduleBot(room);
      return;
    }

    if (data.kind === 'unready') {
      if (st.phase !== 'placing' || !mySeat || !st.ready[mySeat]) return;
      st.ready[mySeat] = false;
      broadcastState(room);
      return;
    }

    if (data.kind === 'fire') {
      if (st.phase !== 'playing') return reject('not_playing');
      if (!mySeat) return reject('not_seated');
      if (st.turn !== mySeat) return reject('not_your_turn');
      const r = Number(data.r);
      const c = Number(data.c);
      if (!Number.isInteger(r) || !Number.isInteger(c) || !inBounds(r, c)) return reject('invalid');
      if (!fire(st, mySeat, r, c)) return reject('already_shot');
      broadcastState(room);
      maybeScheduleBot(room);
      return;
    }

    if (data.kind === 'resetGame') {
      if (st.phase !== 'game_over' || !mySeat || !bothSeated(st)) return;
      startPlacing(room);
      broadcastState(room);
    }
  },

  // Exposed for tests.
  _internal: { N, FLEET, shipCells, normalizeFleet, randomFleet, chooseShot, densityGrid, fire, buildView },
};
