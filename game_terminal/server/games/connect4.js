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

function resetBoard(st) {
  st.board = createInitialBoard();
  st.turn = 'red';
  st.winner = null;
  st.lastMove = null;
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
    };
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

    function reject() {
      ctx.sendTo(ctx.senderId, { v: 1, type: 'game.event', payload: { gameType: 'connect4', data: { kind: 'moveRejected' } } });
    }

    if (data.kind === 'sit') {
      const seat = data.seat === 'red' || data.seat === 'yellow' ? data.seat : null;
      if (!seat) return;
      if (st.players[seat]) return;
      if (st.players.red === ctx.senderId || st.players.yellow === ctx.senderId) return;
      st.players[seat] = ctx.senderId;
      if (st.players.red && st.players.yellow) {
        resetBoard(st);
        st.phase = 'playing';
      }
      broadcastState(room, ctx);
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

    if (data.kind === 'resetGame') {
      if (st.phase !== 'game_over') return;
      resetBoard(st);
      st.phase = st.players.red && st.players.yellow ? 'playing' : 'waiting';
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'move') {
      if (st.phase !== 'playing') return;
      const seatColor = st.players.red === ctx.senderId ? 'red' : st.players.yellow === ctx.senderId ? 'yellow' : null;
      if (!seatColor || seatColor !== st.turn) return reject();
      const col = Number(data.col);
      if (!Number.isInteger(col) || col < 0 || col >= COLS) return reject();
      const row = dropRow(st.board, col);
      if (row === -1) return reject();

      st.board[row][col] = seatColor;
      st.lastMove = { r: row, c: col };

      if (checkWin(st.board, row, col, seatColor)) {
        st.phase = 'game_over';
        st.winner = seatColor;
      } else if (boardFull(st.board)) {
        st.phase = 'game_over';
        st.winner = null; // draw
      } else {
        st.turn = opponent(seatColor);
      }

      broadcastState(room, ctx);
    }
  },
};
