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
//
// POWERS (optional, toggled pre-game by either admiral, default off): each side gets a Barrage
// (fire at every unshot cell of one row or column) and a Radar (learn which cells of a 2x2 area
// hold a ship). Both run on long cooldowns counted in the user's own turns, and using one ends the
// turn. Radar readings go only to the scanner (everyone sees WHERE they scanned); the full fleet is
// still never sent to the other side.

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
// first: the own-turn number it unlocks on; cooldown: own turns until it's usable again.
const POWERS = {
  barrage: { name: 'Barrage', first: 10, cooldown: 12 },
  radar: { name: 'Radar', first: 5, cooldown: 9 },
};

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
  st.seq = 0; // bumps on every shot / power: the client's "new action" key
  st.turnsTaken = { p1: 0, p2: 0 };
  const at = () => Object.fromEntries(Object.entries(POWERS).map(([k, v]) => [k, v.first]));
  st.powerAt = { p1: at(), p2: at() };
  st.radar = { p1: emptyGrid(), p2: emptyGrid() }; // radar[s] = readings taken BY s: 'ship'|'empty'
  st.radarAreas = { p1: [], p2: [] }; // top-left corners of every 2x2 scan BY s (public)
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
  passTurn(st, st.starter);
  return true;
}

function passTurn(st, seat) {
  st.turn = seat;
  st.turnsTaken[seat]++;
}

// One shell at an unshot (r, c): marks it, records sinks and the win. No turn handling.
function shootCell(st, seat, r, c) {
  const grid = st.shots[seat];
  const ship = st.fleets[other(seat)].find((s) => shipCells(s).some(([rr, cc]) => rr === r && cc === c));
  st.shotCount[seat]++;
  if (!ship) {
    grid[r][c] = 'miss';
    return { result: 'miss' };
  }
  grid[r][c] = 'hit';
  const sunkNow = shipCells(ship).every(([rr, cc]) => grid[rr][cc] === 'hit');
  if (sunkNow) st.sunk[seat].push({ ...ship });
  if (st.sunk[seat].length === FLEET.length) {
    st.phase = 'game_over';
    st.winner = seat;
    st.turn = null;
    st.score[seat]++;
    st.starter = other(st.starter);
  }
  return { result: sunkNow ? 'sunk' : 'hit', ship: ship.id };
}

// Fire `seat`'s shot at (r, c). Returns { result: 'miss'|'hit'|'sunk', ship? } or null if illegal.
// A hit keeps the turn; a miss passes it.
function fire(st, seat, r, c) {
  if (st.shots[seat][r][c]) return null;
  const res = shootCell(st, seat, r, c);
  // `ship` is only named once sunk: a plain hit doesn't tell the shooter which ship it was.
  st.lastShot = { by: seat, r, c, result: res.result, ship: res.result === 'sunk' ? res.ship : null, n: ++st.seq };
  if (res.result === 'miss') passTurn(st, other(seat));
  return res;
}

const powerLeft = (st, seat, p) => Math.max(0, st.powerAt[seat][p] - st.turnsTaken[seat]);

// Cells a power covers, or null if the target is malformed / out of bounds.
function powerCells(p, d) {
  const i = Number(d.i);
  const r = Number(d.r);
  const c = Number(d.c);
  if (p === 'barrage') {
    if ((d.axis !== 'row' && d.axis !== 'col') || !Number.isInteger(i) || i < 0 || i >= N) return null;
    return Array.from({ length: N }, (_, k) => (d.axis === 'row' ? [i, k] : [k, i]));
  }
  if (p === 'radar') {
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r > N - 2 || c > N - 2) return null;
    return [[r, c], [r, c + 1], [r + 1, c], [r + 1, c + 1]];
  }
  return null;
}

// Use a power for `seat` (whose turn it is). Returns null on success or a reject reason. Ends the turn.
function usePower(st, seat, d) {
  if (!st.powers) return 'powers_off';
  const p = d && Object.prototype.hasOwnProperty.call(POWERS, d.power) ? d.power : null;
  const cells = p && powerCells(p, d);
  if (!cells) return 'invalid';
  if (powerLeft(st, seat, p) > 0) return 'power_cooldown';
  const grid = st.shots[seat];
  const open = cells.filter(([r, c]) => !grid[r][c]);
  if (!open.length) return 'nothing_left';
  if (p === 'barrage') {
    const out = [];
    for (const [r, c] of open) {
      if (st.phase !== 'playing') break;
      const res = shootCell(st, seat, r, c);
      out.push({ r, c, result: res.result, ship: res.result === 'sunk' ? res.ship : null });
    }
    const result = out.some((x) => x.result === 'sunk') ? 'sunk' : out.some((x) => x.result === 'hit') ? 'hit' : 'miss';
    st.lastShot = { by: seat, power: 'barrage', axis: d.axis, i: Number(d.i), cells: out, result, n: ++st.seq };
  } else {
    const occ = new Set(st.fleets[other(seat)].flatMap((s) => shipCells(s).map(([r, c]) => r * N + c)));
    for (const [r, c] of cells) st.radar[seat][r][c] = occ.has(r * N + c) ? 'ship' : 'empty';
    const [[r, c]] = cells;
    st.radarAreas[seat].push({ r, c });
    st.lastShot = { by: seat, power: 'radar', r, c, n: ++st.seq };
  }
  st.powerAt[seat][p] = st.turnsTaken[seat] + POWERS[p].cooldown;
  if (st.phase === 'playing') passTurn(st, other(seat));
  return null;
}

// Bot's view of the enemy grid with radar folded in: radar-clear cells count as misses.
function botShots(st, seat) {
  const radar = st.radar[seat];
  return st.shots[seat].map((row, r) => row.map((v, c) => v || (radar[r][c] === 'empty' ? 'miss' : null)));
}

// Should the bot use a power this action? Returns a power message or null. Easy uses them rarely
// and aims at random; Medium aims at the busiest unexplored line/area; Hard/Expert aim by the
// probability-density map (Hard only while hunting, Expert any time it pays).
function choosePower(st, seat, level, rand = Math.random) {
  if (!st.powers) return null;
  const raw = st.shots[seat];
  const shots = botShots(st, seat);
  const radar = st.radar[seat];
  const { openHits } = shotKnowledge(shots, st.sunk[seat]);
  const pendingBlip = radar.some((row, r) => row.some((v, c) => v === 'ship' && !raw[r][c]));
  if (level !== 'easy' && pendingBlip) return null; // free hits waiting — take them first
  if (rand() >= { easy: 0.2, medium: 0.6, hard: 1, expert: 1 }[level]) return null;
  const dens = level === 'hard' || level === 'expert' ? densityGrid(shots, st.sunk[seat]) : null;
  const val = (r, c) => (shots[r][c] ? 0 : dens ? dens[r][c] : 1);
  const best = (cands) => {
    if (!cands.length) return null;
    if (level === 'easy') return pick(cands, rand);
    let top = -1;
    let tops = [];
    for (const x of cands) {
      if (x.score > top) { top = x.score; tops = [x]; } else if (x.score === top) tops.push(x);
    }
    return top > 0 ? pick(tops, rand) : null;
  };
  const sum = (cells) => cells.reduce((a, [r, c]) => a + val(r, c), 0);
  const valid = (cells) => cells.some(([r, c]) => !raw[r][c]);
  if (powerLeft(st, seat, 'barrage') === 0 && (level === 'expert' || level === 'easy' || !openHits.length)) {
    const cands = [];
    for (const axis of ['row', 'col']) {
      for (let i = 0; i < N; i++) {
        const cells = powerCells('barrage', { axis, i });
        if (valid(cells)) cands.push({ kind: 'power', power: 'barrage', axis, i, score: sum(cells) });
      }
    }
    const b = best(cands);
    if (b) return b;
  }
  if (powerLeft(st, seat, 'radar') === 0 && (level === 'easy' || !openHits.length)) {
    const cands = [];
    for (let r = 0; r < N - 1; r++) {
      for (let c = 0; c < N - 1; c++) {
        const cells = powerCells('radar', { r, c });
        if (valid(cells)) cands.push({ kind: 'power', power: 'radar', r, c, score: sum(cells) });
      }
    }
    const b = best(cands);
    if (b) return b;
  }
  return null;
}

// The bot's whole move: maybe a power, else a shot (radar blips first, radar-clear cells skipped).
function botMove(st, seat, level, rand = Math.random) {
  const pw = choosePower(st, seat, level, rand);
  if (pw) return pw;
  const raw = st.shots[seat];
  if (level !== 'easy') {
    const blips = [];
    st.radar[seat].forEach((row, r) => row.forEach((v, c) => { if (v === 'ship' && !raw[r][c]) blips.push([r, c]); }));
    if (blips.length) { const [r, c] = pick(blips, rand); return { kind: 'fire', r, c }; }
  }
  const mv = chooseShot(botShots(st, seat), st.sunk[seat], level, rand) || chooseShot(raw, st.sunk[seat], level, rand);
  return mv ? { kind: 'fire', r: mv[0], c: mv[1] } : null;
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
  const radar = {};
  const powerLeftView = {};
  for (const seat of SEATS) {
    radar[seat] = over || seat === mySeat ? st.radar[seat] : null;
    powerLeftView[seat] = Object.fromEntries(Object.keys(POWERS).map((p) => [p, powerLeft(st, seat, p)]));
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
    powers: !!st.powers,
    powerSpec: POWERS,
    powerLeft: powerLeftView,
    radar,
    radarAreas: st.radarAreas,
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
  const n = st.seq;
  const delay = BOT_DELAY_MIN + Math.random() * (BOT_DELAY_MAX - BOT_DELAY_MIN);
  setTimeout(() => {
    const s = room.state;
    if (s !== st || s.phase !== 'playing' || s.turn !== seat || s.roundId !== roundId
      || s.players[seat] !== BOT || s.seq !== n) return;
    const mv = botMove(s, seat, botLevelOf(s, seat));
    if (!mv) return;
    if (mv.kind !== 'power' || usePower(s, seat, mv)) {
      const shot = mv.kind === 'fire' ? [mv.r, mv.c] : chooseShot(s.shots[seat], s.sunk[seat], botLevelOf(s, seat));
      if (!shot) return;
      fire(s, seat, shot[0], shot[1]);
    }
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
    const st = { phase: 'waiting', players: { p1: null, p2: null }, botLevels: {}, score: { p1: 0, p2: 0 }, starter: 'p1', powers: false };
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

    // Pre-game rule toggle. Changing it mid-placement un-readies the humans so both see the new rule.
    if (data.kind === 'setPowers') {
      if (!mySeat || (st.phase !== 'waiting' && st.phase !== 'placing') || typeof data.on !== 'boolean') return;
      if (st.powers === data.on) return;
      st.powers = data.on;
      if (st.phase === 'placing') for (const seat of SEATS) if (st.players[seat] !== BOT) st.ready[seat] = false;
      broadcastState(room);
      return;
    }

    if (data.kind === 'power') {
      if (st.phase !== 'playing') return reject('not_playing');
      if (!mySeat) return reject('not_seated');
      if (st.turn !== mySeat) return reject('not_your_turn');
      const why = usePower(st, mySeat, data);
      if (why) return reject(why);
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
  _internal: { N, FLEET, POWERS, shipCells, normalizeFleet, randomFleet, chooseShot, densityGrid, fire, usePower, choosePower, botMove, powerLeft, buildView },
};
