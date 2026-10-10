// Gomoku (freestyle): 15x15 board, stones on the intersections, black moves first, five or more
// in a row in any direction wins; a full board with no five is a draw. Two seats (black/white) or
// PLAY VS BOT (threat-based engine in ./ai/gomokuEngine.js, run in the shared AI worker).

const { think } = require('./ai');
const { setBotLevel, botLevelOf } = require('./ai/levels');
const engine = require('./ai/gomokuEngine');

const N = 15;
const SEATS = ['black', 'white'];
const DIRECTIONS = [[0, 1], [1, 0], [1, 1], [1, -1]];
const BOT = 'BOT';
const BOT_THINK_MS_MIN = 250;
const BOT_THINK_MS_MAX = 600;

const opponent = (color) => (color === 'black' ? 'white' : 'black');
const createInitialBoard = () => Array.from({ length: N }, () => Array(N).fill(null));

// The full run of `color` through (r, c) in the first direction that has five or more, else null.
function winningLine(board, r, c, color) {
  for (const [dr, dc] of DIRECTIONS) {
    const line = [{ r, c }];
    for (const sign of [1, -1]) {
      let rr = r + dr * sign;
      let cc = c + dc * sign;
      while (rr >= 0 && rr < N && cc >= 0 && cc < N && board[rr][cc] === color) {
        line.push({ r: rr, c: cc });
        rr += dr * sign;
        cc += dc * sign;
      }
    }
    if (line.length >= 5) return line.sort((a, b) => a.r - b.r || a.c - b.c);
  }
  return null;
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
    winLine: st.winLine,
    lastMove: st.lastMove,
    moveCount: st.moveCount,
    score: st.score,
  };
}

const stateMsg = (room) => ({ v: 1, type: 'game.event', payload: { gameType: 'gomoku', data: { kind: 'state', ...buildPublicState(room) } } });

function resetBoard(st) {
  st.board = createInitialBoard();
  st.turn = 'black';
  st.winner = null;
  st.winLine = null;
  st.lastMove = null;
  st.moveCount = 0;
}

// Black always moves first, so consecutive games swap who plays black instead of the colours.
function startNewGame(st, swap) {
  if (swap) {
    const { black, white } = st.players;
    st.players = { black: white, white: black };
    const lv = st.botLevels || {};
    st.botLevels = { black: lv.white, white: lv.black };
    st.score = { black: st.score.white, white: st.score.black };
  }
  resetBoard(st);
  st.phase = 'playing';
}

function resetScore(st) {
  st.score = { black: 0, white: 0 };
}

function applyMove(st, color, r, c) {
  if (st.board[r][c]) return false;
  st.board[r][c] = color;
  st.lastMove = { r, c };
  st.moveCount++;
  const line = winningLine(st.board, r, c, color);
  if (line) {
    st.phase = 'game_over';
    st.winner = color;
    st.winLine = line;
    st.score[color]++;
  } else if (st.moveCount >= N * N) {
    st.phase = 'game_over';
    st.winner = 'draw';
  } else {
    st.turn = opponent(color);
  }
  return true;
}

function emptyCells(board) {
  const out = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (!board[r][c]) out.push({ r, c });
  return out;
}

// Same stale-timer discipline as connect4.js: everything is re-validated when the timer fires and
// again when the engine answers, so a reset/leave in between makes the bot harmlessly no-op.
function maybeScheduleBotMove(room) {
  const st = room.state;
  if (st.phase !== 'playing' || st.players[st.turn] !== BOT) return;
  const delay = BOT_THINK_MS_MIN + Math.random() * (BOT_THINK_MS_MAX - BOT_THINK_MS_MIN);
  setTimeout(() => {
    const st2 = room.state;
    if (st2.phase !== 'playing' || st2.players[st2.turn] !== BOT) return;
    const color = st2.turn;
    const board = st2.board;
    const level = botLevelOf(st2, color);
    const finish = (mv) => {
      const st3 = room.state;
      if (st3 !== st2 || st3.board !== board || st3.phase !== 'playing' || st3.turn !== color || st3.players[color] !== BOT) return;
      if (!mv || !Number.isInteger(mv.r) || !Number.isInteger(mv.c) || mv.r < 0 || mv.r >= N || mv.c < 0 || mv.c >= N || board[mv.r][mv.c]) {
        const open = emptyCells(board);
        if (!open.length) return;
        mv = open[Math.floor(Math.random() * open.length)];
      }
      applyMove(st3, color, mv.r, mv.c);
      room.broadcast(stateMsg(room));
      maybeScheduleBotMove(room);
    };
    think('gomoku', { board, color, level }).then(finish, () => {
      // Worker unavailable: run a short in-process search rather than playing randomly.
      let mv = null;
      try { mv = engine.bestMove({ board, color, level, timeMs: 250 }); } catch { /* random fallback */ }
      finish(mv);
    });
  }, delay);
}

function vacateSeatsOf(st, clientId) {
  let changed = false;
  for (const seat of SEATS) {
    if (st.players[seat] === clientId) {
      st.players[seat] = null;
      changed = true;
    }
  }
  if (changed) {
    st.phase = 'waiting';
    resetBoard(st);
    resetScore(st);
  }
  return changed;
}

module.exports = {
  type: 'gomoku',

  createInitialState() {
    const st = { phase: 'waiting', players: { black: null, white: null } };
    resetBoard(st);
    resetScore(st);
    return st;
  },

  isRoomFull(room) {
    return !!(room.state.players.black && room.state.players.white);
  },

  serializeSnapshot(room) {
    return buildPublicState(room);
  },

  onLeave(room, client) {
    if (vacateSeatsOf(room.state, client.clientId)) {
      for (const clientId of room.clients.keys()) room.sendTo(clientId, stateMsg(room));
    }
  },

  onMessage(room, client, data, ctx) {
    if (!data || typeof data.kind !== 'string') return;
    const st = room.state;
    const reject = (reason) => ctx.sendTo(ctx.senderId, { v: 1, type: 'game.event', payload: { gameType: 'gomoku', data: { kind: 'moveRejected', reason } } });
    const seatArg = SEATS.includes(data.seat) ? data.seat : null;

    if (data.kind === 'sit') {
      if (!seatArg || st.players[seatArg]) return;
      if (data.bot) {
        st.players[seatArg] = BOT;
        setBotLevel(st, seatArg, data.level);
      } else {
        if (SEATS.some((s) => st.players[s] === ctx.senderId)) return;
        st.players[seatArg] = ctx.senderId;
      }
      if (st.players.black && st.players.white) startNewGame(st, false);
      ctx.broadcast(stateMsg(room));
      maybeScheduleBotMove(room);
      return;
    }

    if (data.kind === 'leaveSeat') {
      if (vacateSeatsOf(st, ctx.senderId)) ctx.broadcast(stateMsg(room));
      return;
    }

    if (data.kind === 'setBotLevel') {
      if (!seatArg || st.players[seatArg] !== BOT) return;
      setBotLevel(st, seatArg, data.level);
      ctx.broadcast(stateMsg(room));
      return;
    }

    if (data.kind === 'removeBot') {
      if (!seatArg || st.players[seatArg] !== BOT) return;
      st.players[seatArg] = null;
      st.phase = 'waiting';
      resetBoard(st);
      resetScore(st);
      ctx.broadcast(stateMsg(room));
      return;
    }

    if (data.kind === 'resetGame') {
      if (st.phase !== 'game_over') return;
      if (!SEATS.some((s) => st.players[s] === ctx.senderId)) return;
      if (!(st.players.black && st.players.white)) return;
      startNewGame(st, true);
      ctx.broadcast(stateMsg(room));
      maybeScheduleBotMove(room);
      return;
    }

    if (data.kind === 'move') {
      if (st.phase !== 'playing') return reject('not_playing');
      const seat = SEATS.find((s) => st.players[s] === ctx.senderId);
      if (!seat) return reject('not_seated');
      if (seat !== st.turn) return reject('not_your_turn');
      const r = Number(data.r);
      const c = Number(data.c);
      if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= N || c < 0 || c >= N) return reject('invalid');
      if (!applyMove(st, seat, r, c)) return reject('occupied');
      ctx.broadcast(stateMsg(room));
      maybeScheduleBotMove(room);
    }
  },

  // Exposed for tests.
  _internal: { winningLine, N },
};
