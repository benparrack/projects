// Reversi (Othello): 8x8, standard four-disc start, black moves first. A move must outflank at
// least one opposing line; outflanked discs flip. A side with no legal move passes automatically
// (the server records it so clients can show a callout); when neither side can move the game ends
// and the most discs wins (empty squares go to the winner, standard tournament scoring).
// Seats are { black, white }; on a rematch the seats swap colours so the opener alternates.

'use strict';

const path = require('path');
const { Worker } = require('worker_threads');
const { setBotLevel, botLevelOf } = require('./ai/levels');

const N = 8;
const BOT = 'BOT';
const COLORS = ['black', 'white'];
// Human-ish reply delay (tests shrink it via _internal.timing).
const timing = { min: 350, max: 700 };
const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

const opponent = (c) => (c === 'black' ? 'white' : 'black');

function createInitialBoard() {
  const b = Array.from({ length: N }, () => Array(N).fill(null));
  b[3][3] = 'white';
  b[4][4] = 'white';
  b[3][4] = 'black';
  b[4][3] = 'black';
  return b;
}

function flipsFor(board, r, c, color) {
  if (board[r][c]) return [];
  const out = [];
  for (const [dr, dc] of DIRS) {
    const line = [];
    let rr = r + dr;
    let cc = c + dc;
    while (rr >= 0 && rr < N && cc >= 0 && cc < N && board[rr][cc] === opponent(color)) {
      line.push({ r: rr, c: cc });
      rr += dr;
      cc += dc;
    }
    if (line.length && rr >= 0 && rr < N && cc >= 0 && cc < N && board[rr][cc] === color) out.push(...line);
  }
  return out;
}

function legalMoves(board, color) {
  const moves = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (!board[r][c] && flipsFor(board, r, c, color).length) moves.push({ r, c });
    }
  }
  return moves;
}

function countDiscs(board) {
  const n = { black: 0, white: 0 };
  for (const row of board) for (const v of row) if (v) n[v]++;
  return n;
}

// --- bot engine worker (own thread so a 1-2s Expert search never blocks the event loop) ---
let worker = null;
let nextId = 1;
const pending = new Map();
function failAll(err) {
  for (const p of pending.values()) p.reject(err);
  pending.clear();
}
function think(input) {
  return new Promise((resolve, reject) => {
    if (!worker) {
      const enginePath = path.join(__dirname, 'ai', 'reversiEngine.js');
      worker = new Worker(
        `const { parentPort } = require('worker_threads');
         const engine = require(${JSON.stringify(enginePath)});
         parentPort.on('message', ({ id, input }) => {
           try { parentPort.postMessage({ id, result: engine.bestMove(input) }); }
           catch (err) { parentPort.postMessage({ id, error: String((err && err.stack) || err) }); }
         });`,
        { eval: true },
      );
      worker.unref();
      worker.on('message', ({ id, result, error }) => {
        const p = pending.get(id);
        if (!p) return;
        pending.delete(id);
        if (error) p.reject(new Error(error));
        else p.resolve(result);
      });
      worker.on('error', (err) => { worker = null; failAll(err); });
      worker.on('exit', () => { worker = null; failAll(new Error('reversi worker exited')); });
    }
    const id = nextId++;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, input });
  });
}

function buildPublicState(room) {
  const st = room.state;
  return {
    phase: st.phase,
    players: st.players,
    botLevels: st.botLevels || {},
    board: st.board,
    turn: st.turn,
    winner: st.winner,
    lastMove: st.lastMove,
    flipped: st.flipped,
    pass: st.pass, // { color, seq } — the most recent automatic pass, or null
    moveNo: st.moveNo,
    counts: countDiscs(st.board),
    legal: st.phase === 'playing' ? legalMoves(st.board, st.turn) : [],
  };
}

function broadcastState(room) {
  room.broadcast({ v: 1, type: 'game.event', payload: { gameType: 'reversi', data: { kind: 'state', ...buildPublicState(room) } } });
}

function resetBoard(st) {
  st.board = createInitialBoard();
  st.turn = 'black';
  st.winner = null;
  st.lastMove = null;
  st.flipped = [];
  st.pass = null;
  st.moveNo = 0;
  st.gameId = (st.gameId || 0) + 1;
}

function finishIfOver(st) {
  const n = countDiscs(st.board);
  st.phase = 'game_over';
  st.winner = n.black > n.white ? 'black' : n.white > n.black ? 'white' : 'draw';
}

// Places a disc (already validated legal), flips, then resolves passes / game end.
function applyMove(st, color, r, c) {
  const flips = flipsFor(st.board, r, c, color);
  if (!flips.length) return false;
  st.board[r][c] = color;
  for (const f of flips) st.board[f.r][f.c] = color;
  st.lastMove = { r, c, color };
  st.flipped = flips;
  st.moveNo++;
  const opp = opponent(color);
  if (legalMoves(st.board, opp).length) {
    st.turn = opp;
  } else if (legalMoves(st.board, color).length) {
    st.turn = color;
    st.pass = { color: opp, seq: st.moveNo };
  } else {
    finishIfOver(st);
  }
  return true;
}

function maybeScheduleBotMove(room) {
  const st = room.state;
  if (st.phase !== 'playing' || st.players[st.turn] !== BOT) return;
  const gameId = st.gameId;
  const moveNo = st.moveNo;
  const color = st.turn;
  const stillValid = () => {
    const s = room.state;
    return s === st && s.gameId === gameId && s.moveNo === moveNo && s.phase === 'playing' && s.turn === color && s.players[color] === BOT;
  };
  const started = Date.now();
  const delay = timing.min + Math.random() * (timing.max - timing.min);
  const finish = (mv) => {
    if (!stillValid()) return;
    const legal = legalMoves(st.board, color);
    if (!legal.length) return;
    if (!mv || !legal.some((m) => m.r === mv.r && m.c === mv.c)) mv = legal[Math.floor(Math.random() * legal.length)];
    applyMove(st, color, mv.r, mv.c);
    broadcastState(room);
    maybeScheduleBotMove(room);
  };
  // Start thinking immediately, but never answer faster than the human-ish delay.
  const board = st.board.map((row) => row.slice());
  think({ board, color, level: botLevelOf(st, color) }).then(
    (mv) => setTimeout(() => finish(mv), Math.max(0, delay - (Date.now() - started))),
    () => setTimeout(() => finish(null), delay),
  );
}

function seatOf(st, clientId) {
  return st.players.black === clientId ? 'black' : st.players.white === clientId ? 'white' : null;
}

function startIfReady(st) {
  if (st.players.black && st.players.white) {
    resetBoard(st);
    st.phase = 'playing';
  }
}

module.exports = {
  type: 'reversi',

  createInitialState() {
    const st = { phase: 'waiting', players: { black: null, white: null }, botLevels: {} };
    resetBoard(st);
    return st;
  },

  isRoomFull(room) {
    return !!(room.state.players.black && room.state.players.white);
  },

  serializeSnapshot(room) {
    return buildPublicState(room);
  },

  onLeave(room, client) {
    const st = room.state;
    const seat = seatOf(st, client.clientId);
    if (!seat) return;
    st.players[seat] = null;
    st.phase = 'waiting';
    resetBoard(st);
    broadcastState(room);
  },

  onMessage(room, client, data, ctx) {
    if (!data || typeof data.kind !== 'string') return;
    const st = room.state;
    const reject = (reason) => ctx.sendTo(ctx.senderId, { v: 1, type: 'game.event', payload: { gameType: 'reversi', data: { kind: 'moveRejected', reason } } });
    const seatArg = COLORS.includes(data.seat) ? data.seat : null;

    if (data.kind === 'sit') {
      if (!seatArg || st.players[seatArg]) return;
      if (data.bot) {
        st.players[seatArg] = BOT;
        setBotLevel(st, seatArg, data.level);
      } else {
        if (seatOf(st, ctx.senderId)) return;
        st.players[seatArg] = ctx.senderId;
      }
      startIfReady(st);
      broadcastState(room);
      maybeScheduleBotMove(room);
      return;
    }

    if (data.kind === 'leaveSeat') {
      const seat = seatOf(st, ctx.senderId);
      if (!seat) return;
      st.players[seat] = null;
      st.phase = 'waiting';
      resetBoard(st);
      broadcastState(room);
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
      resetBoard(st);
      broadcastState(room);
      return;
    }

    if (data.kind === 'resetGame') {
      if (st.phase !== 'game_over') return;
      if (!seatOf(st, ctx.senderId)) return;
      // Swap colours so whoever played white opens the next game.
      st.players = { black: st.players.white, white: st.players.black };
      st.botLevels = { black: (st.botLevels || {}).white, white: (st.botLevels || {}).black };
      resetBoard(st);
      st.phase = st.players.black && st.players.white ? 'playing' : 'waiting';
      broadcastState(room);
      maybeScheduleBotMove(room);
      return;
    }

    if (data.kind === 'move') {
      if (st.phase !== 'playing') return reject('not_playing');
      const seat = seatOf(st, ctx.senderId);
      if (!seat || seat !== st.turn) return reject('not_your_turn');
      const r = Number(data.r);
      const c = Number(data.c);
      if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= N || c < 0 || c >= N) return reject('invalid');
      if (st.board[r][c]) return reject('occupied');
      if (!applyMove(st, seat, r, c)) return reject('no_flips');
      broadcastState(room);
      maybeScheduleBotMove(room);
    }
  },

  _internal: { timing, flipsFor, legalMoves, countDiscs, applyMove, createInitialBoard },
};
