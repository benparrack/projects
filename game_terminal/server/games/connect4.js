// Connect 4: standard rules, 7x6 grid, gravity-drop columns, first to 4 in a row (any of the
// four directions) wins; a full board with no winner is a draw.

const COLS = 7;
const ROWS = 6;

const DIRECTIONS = [
  [0, 1], // horizontal
  [1, 0], // vertical
  [1, 1], // diagonal down-right
  [1, -1], // diagonal down-left
];

function opponent(color) {
  return color === 'red' ? 'yellow' : 'red';
}

function createInitialBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

// Gravity: the piece lands in the lowest empty row of the column. Returns -1 if full.
function dropRow(board, col) {
  for (let r = ROWS - 1; r >= 0; r--) {
    if (!board[r][col]) return r;
  }
  return -1;
}

function checkWin(board, r, c, color) {
  for (const [dr, dc] of DIRECTIONS) {
    let count = 1;
    for (const sign of [1, -1]) {
      let rr = r + dr * sign;
      let cc = c + dc * sign;
      while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && board[rr][cc] === color) {
        count++;
        rr += dr * sign;
        cc += dc * sign;
      }
    }
    if (count >= 4) return true;
  }
  return false;
}

function boardFull(board) {
  return board[0].every((cell) => cell !== null);
}

function buildPublicState(room) {
  const st = room.state;
  return {
    phase: st.phase,
    players: st.players,
    board: st.board,
    turn: st.turn,
    winner: st.winner,
    lastMove: st.lastMove,
  };
}

function broadcastState(room, ctx) {
  ctx.broadcast({
    v: 1,
    type: 'game.event',
    payload: { gameType: 'connect4', data: { kind: 'state', ...buildPublicState(room) } },
  });
}

function resetBoard(st, firstMover) {
  st.board = createInitialBoard();
  st.turn = firstMover || 'red';
  st.winner = null;
  st.lastMove = null;
}

// Starts a fresh game and flips which color moves first compared to the previous game, so
// consecutive games alternate starters instead of the same seat always opening.
function startNewGame(st) {
  const firstMover = st.nextFirstMover || 'red';
  resetBoard(st, firstMover);
  st.nextFirstMover = opponent(firstMover);
}

const BOT = 'BOT';
const BOT_THINK_MS_MIN = 400;
const BOT_THINK_MS_MAX = 900;

function applyDrop(st, color, col) {
  const row = dropRow(st.board, col);
  if (row === -1) return false;
  st.board[row][col] = color;
  st.lastMove = { r: row, c: col };
  if (checkWin(st.board, row, col, color)) {
    st.phase = 'game_over';
    st.winner = color;
  } else if (boardFull(st.board)) {
    st.phase = 'game_over';
    st.winner = null;
  } else {
    st.turn = opponent(color);
  }
  return true;
}

// Bots are a sentinel seat value ('BOT') rather than a real clientId — see FUTURE.md's
// "Bot/CPU opponents" writeup. Scheduling re-validates phase/turn/seat when the timer fires
// rather than trusting the state at schedule time, so a stale/duplicate timer (e.g. two actions
// both triggering a schedule for the same pending turn) harmlessly no-ops instead of double-moving.
function maybeScheduleBotMove(room) {
  const st = room.state;
  if (st.phase !== 'playing' || st.players[st.turn] !== BOT) return;
  const delay = BOT_THINK_MS_MIN + Math.random() * (BOT_THINK_MS_MAX - BOT_THINK_MS_MIN);
  setTimeout(() => {
    const st2 = room.state;
    if (st2.phase !== 'playing' || st2.players[st2.turn] !== BOT) return;
    const color = st2.turn;
    const openCols = [];
    for (let c = 0; c < COLS; c++) {
      if (dropRow(st2.board, c) !== -1) openCols.push(c);
    }
    if (openCols.length === 0) return;
    const col = openCols[Math.floor(Math.random() * openCols.length)];
    applyDrop(st2, color, col);
    room.broadcast({ v: 1, type: 'game.event', payload: { gameType: 'connect4', data: { kind: 'state', ...buildPublicState(room) } } });
    maybeScheduleBotMove(room);
  }, delay);
}

module.exports = {
  type: 'connect4',

  createInitialState() {
    return {
      phase: 'waiting',
      players: { red: null, yellow: null },
      board: createInitialBoard(),
      turn: 'red',
      winner: null,
      lastMove: null,
      nextFirstMover: 'red',
    };
  },

  // See chess.js's isRoomFull for why this exists — routes public-lobby overflow into a new room.
  isRoomFull(room) {
    return !!(room.state.players.red && room.state.players.yellow);
  },

  serializeSnapshot(room) {
    return buildPublicState(room);
  },

  onLeave(room, client) {
    const st = room.state;
    let changed = false;
    if (st.players.red === client.clientId) {
      st.players.red = null;
      changed = true;
    }
    if (st.players.yellow === client.clientId) {
      st.players.yellow = null;
      changed = true;
    }
    if (changed) {
      st.phase = 'waiting';
      resetBoard(st);
      for (const clientId of room.clients.keys()) {
        room.sendTo(clientId, {
          v: 1,
          type: 'game.event',
          payload: { gameType: 'connect4', data: { kind: 'state', ...buildPublicState(room) } },
        });
      }
    }
  },

  onMessage(room, client, data, ctx) {
    if (!data || typeof data.kind !== 'string') return;
    const st = room.state;

    // `reason` lets the client show an accurate message — previously every rejection (wrong
    // turn, bad column index, or an actually-full column) was reported identically, so players
    // could be told "Column is full" when the real reason was something else entirely.
    function reject(reason) {
      ctx.sendTo(ctx.senderId, { v: 1, type: 'game.event', payload: { gameType: 'connect4', data: { kind: 'moveRejected', reason } } });
    }

    if (data.kind === 'sit') {
      const seat = data.seat === 'red' || data.seat === 'yellow' ? data.seat : null;
      if (!seat) return;
      if (st.players[seat]) return;
      if (data.bot) {
        st.players[seat] = BOT;
      } else {
        if (st.players.red === ctx.senderId || st.players.yellow === ctx.senderId) return;
        st.players[seat] = ctx.senderId;
      }
      if (st.players.red && st.players.yellow) {
        startNewGame(st);
        st.phase = 'playing';
      }
      broadcastState(room, ctx);
      maybeScheduleBotMove(room);
      return;
    }

    if (data.kind === 'leaveSeat') {
      let changed = false;
      if (st.players.red === ctx.senderId) {
        st.players.red = null;
        changed = true;
      }
      if (st.players.yellow === ctx.senderId) {
        st.players.yellow = null;
        changed = true;
      }
      if (changed) {
        st.phase = 'waiting';
        resetBoard(st);
        broadcastState(room, ctx);
      }
      return;
    }

    // Removes a bot from a seat — a human can't "sit" over a BOT sentinel via the normal `sit`
    // check (seat isn't empty), so this is the only way to clear one, e.g. to sit down themselves.
    if (data.kind === 'removeBot') {
      const seat = data.seat === 'red' || data.seat === 'yellow' ? data.seat : null;
      if (!seat || st.players[seat] !== BOT) return;
      st.players[seat] = null;
      st.phase = 'waiting';
      resetBoard(st);
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'resetGame') {
      if (st.phase !== 'game_over') return;
      startNewGame(st);
      st.phase = st.players.red && st.players.yellow ? 'playing' : 'waiting';
      broadcastState(room, ctx);
      maybeScheduleBotMove(room);
      return;
    }

    if (data.kind === 'move') {
      if (st.phase !== 'playing') return;
      const seatColor = st.players.red === ctx.senderId ? 'red' : st.players.yellow === ctx.senderId ? 'yellow' : null;
      if (!seatColor || seatColor !== st.turn) return reject('not_your_turn');
      const col = Number(data.col);
      if (!Number.isInteger(col) || col < 0 || col >= COLS) return reject('invalid_column');
      if (!applyDrop(st, seatColor, col)) return reject('column_full');

      broadcastState(room, ctx);
      maybeScheduleBotMove(room);
    }
  },
};
