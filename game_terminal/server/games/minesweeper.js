// Minesweeper race: two seats sweep the SAME mine layout on their own boards at the same time;
// first to open every safe cell wins. Hitting a mine doesn't end your game, it freezes you for
// FREEZE_MS and marks that mine. Both start from the same auto-opened empty patch. Players only
// see their own board plus the opponent's progress (same layout, so their cells would be a
// spoiler); spectators see both; mines are only sent at game over. Bots: ./ai/minesweeperSolver.

'use strict';

const { setBotLevel, botLevelOf } = require('./ai/levels');
const S = require('./ai/minesweeperSolver');

const TYPE = 'minesweeper';
const BOT = 'BOT';
const SEATS = ['p1', 'p2'];
const SIZES = {
  small: { cols: 9, rows: 9, mines: 10 },
  medium: { cols: 16, rows: 16, mines: 40 },
  large: { cols: 30, rows: 16, mines: 99 },
};
const FREEZE_MS = 5000;
const HIDDEN = 0;
const OPEN = 1;
const FLAG = 2;
const BOOM = 3;

function makeLayout(size, rng = Math.random) {
  const { cols, rows, mines } = SIZES[size];
  const n = cols * rows;
  for (;;) {
    const mine = new Array(n).fill(false);
    for (let placed = 0; placed < mines;) {
      const i = Math.floor(rng() * n);
      if (!mine[i]) { mine[i] = true; placed++; }
    }
    const num = mine.map((m, i) => (m ? -1 : S.neighbors(cols, rows, i).filter((j) => mine[j]).length));
    const zeros = [];
    num.forEach((v, i) => { if (v === 0) zeros.push(i); });
    if (zeros.length) return { cols, rows, mines, mine, num, start: zeros[Math.floor(rng() * zeros.length)] };
  }
}

const freshBoard = (n) => ({ cell: new Array(n).fill(HIDDEN), opened: 0, hits: 0, frozenUntil: 0 });

function flood(L, b, i) {
  const stack = [i];
  while (stack.length) {
    const j = stack.pop();
    if (b.cell[j] !== HIDDEN && b.cell[j] !== FLAG) continue;
    b.cell[j] = OPEN;
    b.opened++;
    if (L.num[j] === 0) for (const k of S.neighbors(L.cols, L.rows, j)) if (b.cell[k] === HIDDEN) stack.push(k);
  }
}

function openCell(L, b, i, now) {
  if (L.mine[i]) {
    b.cell[i] = BOOM;
    b.hits++;
    b.frozenUntil = now + FREEZE_MS;
  } else {
    flood(L, b, i);
  }
}

// A click: opens a hidden cell, or chords an opened number whose flags/mines are all marked.
// Returns false if nothing happened.
function clickCell(st, seat, i, now) {
  const L = st.layout;
  const b = st.boards[seat];
  if (b.cell[i] === OPEN) {
    const nb = S.neighbors(L.cols, L.rows, i);
    const marked = nb.filter((j) => b.cell[j] === FLAG || b.cell[j] === BOOM).length;
    const todo = nb.filter((j) => b.cell[j] === HIDDEN);
    if (L.num[i] === 0 || marked !== L.num[i] || !todo.length) return false;
    for (const j of todo) if (b.cell[j] === HIDDEN) openCell(L, b, j, now);
    return true;
  }
  if (b.cell[i] !== HIDDEN) return false;
  openCell(L, b, i, now);
  return true;
}

function checkWin(st, seat) {
  const L = st.layout;
  if (st.boards[seat].opened < L.cols * L.rows - L.mines) return false;
  st.phase = 'game_over';
  st.winner = seat;
  st.finishMs = Date.now() - st.startedAt;
  st.score[seat]++;
  st.gen++;
  return true;
}

// Visible codes: -1 hidden, -2 flag, -3 exploded mine, 0..8 number; at game over also
// -4 unfound mine and -5 wrong flag.
function cellsFor(st, b, over) {
  const L = st.layout;
  return b.cell.map((c, i) => {
    if (c === OPEN) return L.num[i];
    if (c === BOOM) return -3;
    if (over && c === FLAG) return L.mine[i] ? -2 : -5;
    if (over && L.mine[i]) return -4;
    return c === FLAG ? -2 : -1;
  });
}

function buildView(room, viewerId) {
  const st = room.state;
  const now = Date.now();
  const seat = seatFor(st, viewerId);
  const dims = SIZES[st.size];
  const over = st.phase === 'game_over';
  const live = st.boards && st.phase !== 'waiting';
  const prog = {};
  const boards = {};
  for (const s of SEATS) {
    const b = live && st.boards[s];
    prog[s] = b ? { opened: b.opened, hits: b.hits, flags: b.cell.filter((c) => c === FLAG).length, frozenMs: over ? 0 : Math.max(0, b.frozenUntil - now) } : null;
    boards[s] = b && (over || !seat || seat === s) ? cellsFor(st, b, over) : null;
  }
  return {
    phase: st.phase,
    players: st.players,
    botLevels: st.botLevels || {},
    size: st.size,
    cols: dims.cols,
    rows: dims.rows,
    mines: dims.mines,
    safeTotal: dims.cols * dims.rows - dims.mines,
    boards,
    progress: prog,
    winner: st.winner,
    elapsedMs: over ? st.finishMs : live ? now - st.startedAt : 0,
    freezeMs: FREEZE_MS,
    score: st.score,
    round: st.gen,
  };
}

function broadcastState(room) {
  for (const id of room.clients.keys()) {
    room.sendTo(id, { v: 1, type: 'game.event', payload: { gameType: TYPE, data: { kind: 'state', ...buildView(room, id) } } });
  }
}

function startNewGame(st) {
  st.layout = makeLayout(st.size);
  const n = st.layout.cols * st.layout.rows;
  st.boards = {};
  for (const s of SEATS) {
    st.boards[s] = freshBoard(n);
    flood(st.layout, st.boards[s], st.layout.start);
  }
  st.winner = null;
  st.startedAt = Date.now();
  st.finishMs = 0;
  st.phase = 'playing';
  st.gen = (st.gen || 0) + 1;
}

// Each bot seat runs its own action loop; the gen check kills it on reset/leave/game over.
function scheduleBot(room, seat, delay) {
  const st = room.state;
  if (st.phase !== 'playing' || st.players[seat] !== BOT) return;
  const gen = st.gen;
  const cfg = S.LEVEL[botLevelOf(st, seat)];
  const wait = delay != null ? delay : cfg.ms[0] + Math.random() * (cfg.ms[1] - cfg.ms[0]);
  setTimeout(() => {
    const s = room.state;
    if (s !== st || s.gen !== gen || s.phase !== 'playing' || s.players[seat] !== BOT) return;
    const now = Date.now();
    const b = st.boards[seat];
    if (now < b.frozenUntil) return scheduleBot(room, seat, b.frozenUntil - now + 200);
    const L = st.layout;
    const i = S.pickMove({ cols: L.cols, rows: L.rows, mines: L.mines, cell: cellsFor(st, b, false) }, botLevelOf(st, seat));
    if (i != null) clickCell(st, seat, i, now);
    checkWin(st, seat);
    broadcastState(room);
    scheduleBot(room, seat);
  }, wait);
}

function startBots(room) {
  for (const s of SEATS) scheduleBot(room, s, 900);
}

function seatFor(st, clientId) {
  return (clientId && SEATS.find((s) => st.players[s] === clientId)) || null;
}

function clearSeat(st, seat) {
  st.players[seat] = null;
  st.phase = 'waiting';
  st.boards = null;
  st.winner = null;
  st.gen = (st.gen || 0) + 1;
}

const freshScore = () => ({ p1: 0, p2: 0 });

module.exports = {
  type: TYPE,

  createInitialState() {
    return { phase: 'waiting', players: { p1: null, p2: null }, botLevels: {}, score: freshScore(), size: 'medium', boards: null, winner: null, gen: 0 };
  },

  isRoomFull(room) {
    return !!(room.state.players.p1 && room.state.players.p2);
  },

  serializeSnapshot(room, client) {
    return buildView(room, client ? client.clientId : null);
  },

  onLeave(room, client) {
    const st = room.state;
    const seat = seatFor(st, client.clientId);
    if (!seat) return;
    clearSeat(st, seat);
    st.score = freshScore();
    broadcastState(room);
  },

  onMessage(room, client, data, ctx) {
    if (!data || typeof data.kind !== 'string') return;
    const st = room.state;
    const reject = (reason) => ctx.sendTo(ctx.senderId, { v: 1, type: 'game.event', payload: { gameType: TYPE, data: { kind: 'moveRejected', reason } } });
    const validSeat = (s) => (SEATS.includes(s) ? s : null);
    const mine = seatFor(st, ctx.senderId);

    switch (data.kind) {
      case 'sit': {
        const seat = validSeat(data.seat);
        if (!seat || st.players[seat]) return;
        if (data.bot) {
          st.players[seat] = BOT;
          setBotLevel(st, seat, data.level);
        } else {
          if (mine) return;
          st.players[seat] = ctx.senderId;
        }
        st.score = freshScore();
        if (st.players.p1 && st.players.p2) startNewGame(st);
        broadcastState(room);
        startBots(room);
        return;
      }
      case 'leaveSeat': {
        if (!mine) return;
        clearSeat(st, mine);
        st.score = freshScore();
        broadcastState(room);
        return;
      }
      case 'setBotLevel': {
        const seat = validSeat(data.seat);
        if (!seat || st.players[seat] !== BOT) return;
        setBotLevel(st, seat, data.level);
        broadcastState(room);
        return;
      }
      case 'removeBot': {
        const seat = validSeat(data.seat);
        if (!seat || st.players[seat] !== BOT) return;
        clearSeat(st, seat);
        st.score = freshScore();
        broadcastState(room);
        return;
      }
      // Board size: any time outside a game, or mid-game when your opponent is a bot (restarts).
      case 'setSize': {
        if (!mine || typeof data.size !== 'string' || !Object.prototype.hasOwnProperty.call(SIZES, data.size)) return;
        const other = mine === 'p1' ? 'p2' : 'p1';
        if (st.phase === 'playing' && st.players[other] !== BOT) return reject('in_progress');
        st.size = data.size;
        if (st.phase !== 'waiting') startNewGame(st);
        broadcastState(room);
        startBots(room);
        return;
      }
      case 'resetGame': {
        if (st.phase !== 'game_over' || !mine) return;
        startNewGame(st);
        broadcastState(room);
        startBots(room);
        return;
      }
      case 'reveal':
      case 'flag': {
        if (st.phase !== 'playing') return reject('not_playing');
        if (!mine) return reject('not_seated');
        const L = st.layout;
        const i = data.i;
        if (!Number.isInteger(i) || i < 0 || i >= L.cols * L.rows) return reject('invalid');
        const b = st.boards[mine];
        const now = Date.now();
        if (now < b.frozenUntil) return reject('frozen');
        if (data.kind === 'flag') {
          if (b.cell[i] === HIDDEN) b.cell[i] = FLAG;
          else if (b.cell[i] === FLAG) b.cell[i] = HIDDEN;
          else return;
        } else if (!clickCell(st, mine, i, now)) {
          return;
        }
        checkWin(st, mine);
        broadcastState(room);
        return;
      }
      default:
    }
  },
};

module.exports._internals = { SIZES, FREEZE_MS, makeLayout, clickCell, cellsFor, buildView };
