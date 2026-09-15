// Checkers (American/English draughts rules): mandatory capture, multi-jump,
// men move and capture forward only, kings move/capture any direction.

const BOARD_SIZE = 8;

function inBounds(r, c) {
  return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
}

function isDarkSquare(r, c) {
  return (r + c) % 2 === 1;
}

function opponent(color) {
  return color === 'red' ? 'black' : 'red';
}

function createInitialBoard() {
  const board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (isDarkSquare(r, c)) board[r][c] = { color: 'black', king: false };
    }
  }
  for (let r = 5; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (isDarkSquare(r, c)) board[r][c] = { color: 'red', king: false };
    }
  }
  return board;
}

const ALL_DIAGONALS = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

function getMovesForPiece(board, r, c) {
  const piece = board[r][c];
  if (!piece) return [];
  const forwardDr = piece.color === 'black' ? 1 : -1;
  const stepDirs = piece.king ? ALL_DIAGONALS : [[forwardDr, 1], [forwardDr, -1]];

  // Standard American/English rules: a man captures only in the same forward directions it
  // moves in — backward captures are a king-only privilege (real bug caught by playtest: this
  // used to check ALL_DIAGONALS regardless of king status, letting men capture backward).
  const captures = [];
  for (const [dr, dc] of stepDirs) {
    const midR = r + dr;
    const midC = c + dc;
    const toR = r + dr * 2;
    const toC = c + dc * 2;
    if (!inBounds(toR, toC)) continue;
    const midPiece = board[midR][midC];
    if (midPiece && midPiece.color !== piece.color && !board[toR][toC]) {
      captures.push({ from: { r, c }, to: { r: toR, c: toC }, capture: { r: midR, c: midC }, isCapture: true });
    }
  }
  if (captures.length > 0) return captures;

  const simple = [];
  for (const [dr, dc] of stepDirs) {
    const toR = r + dr;
    const toC = c + dc;
    if (inBounds(toR, toC) && !board[toR][toC]) {
      simple.push({ from: { r, c }, to: { r: toR, c: toC }, isCapture: false });
    }
  }
  return simple;
}

function getAllMovesForColor(board, color) {
  const all = [];
  let anyCapture = false;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const piece = board[r][c];
      if (!piece || piece.color !== color) continue;
      for (const move of getMovesForPiece(board, r, c)) {
        if (move.isCapture) anyCapture = true;
        all.push(move);
      }
    }
  }
  return anyCapture ? all.filter((m) => m.isCapture) : all;
}

function buildPublicState(room) {
  const st = room.state;
  return {
    phase: st.phase,
    players: st.players,
    board: st.board,
    turn: st.turn,
    mustContinueFrom: st.mustContinueFrom,
    winner: st.winner,
  };
}

function broadcastState(room, ctx) {
  ctx.broadcast({
    v: 1,
    type: 'game.event',
    payload: { gameType: 'checkers', data: { kind: 'state', ...buildPublicState(room) } },
  });
}

function resetBoard(st) {
  st.board = createInitialBoard();
  st.turn = 'black';
  st.mustContinueFrom = null;
  st.winner = null;
}

module.exports = {
  type: 'checkers',

  createInitialState() {
    return {
      phase: 'waiting',
      players: { red: null, black: null },
      board: createInitialBoard(),
      turn: 'black',
      mustContinueFrom: null,
      winner: null,
    };
  },

  // See chess.js's isRoomFull for why this exists — routes public-lobby overflow into a new room.
  isRoomFull(room) {
    return !!(room.state.players.red && room.state.players.black);
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
    if (st.players.black === client.clientId) {
      st.players.black = null;
      changed = true;
    }
    if (changed) {
      st.phase = 'waiting';
      resetBoard(st);
      for (const clientId of room.clients.keys()) {
        room.sendTo(clientId, {
          v: 1,
          type: 'game.event',
          payload: { gameType: 'checkers', data: { kind: 'state', ...buildPublicState(room) } },
        });
      }
    }
  },

  onMessage(room, client, data, ctx) {
    if (!data || typeof data.kind !== 'string') return;
    const st = room.state;

    function reject() {
      ctx.sendTo(ctx.senderId, { v: 1, type: 'game.event', payload: { gameType: 'checkers', data: { kind: 'moveRejected' } } });
    }

    if (data.kind === 'sit') {
      const seat = data.seat === 'red' || data.seat === 'black' ? data.seat : null;
      if (!seat) return;
      if (st.players[seat]) return;
      if (st.players.red === ctx.senderId || st.players.black === ctx.senderId) return;
      st.players[seat] = ctx.senderId;
      if (st.players.red && st.players.black) {
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
      if (st.players.black === ctx.senderId) {
        st.players.black = null;
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
      st.phase = st.players.red && st.players.black ? 'playing' : 'waiting';
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'move') {
      if (st.phase !== 'playing') return;
      const seatColor = st.players.red === ctx.senderId ? 'red' : st.players.black === ctx.senderId ? 'black' : null;
      if (!seatColor || seatColor !== st.turn) return reject();
      const { from, to } = data;
      if (!from || !to) return reject();
      if (st.mustContinueFrom && (from.r !== st.mustContinueFrom.r || from.c !== st.mustContinueFrom.c)) return reject();

      const legalMoves = getAllMovesForColor(st.board, seatColor);
      const match = legalMoves.find(
        (m) => m.from.r === from.r && m.from.c === from.c && m.to.r === to.r && m.to.c === to.c
      );
      if (!match) return reject();

      const piece = st.board[from.r][from.c];
      st.board[from.r][from.c] = null;
      if (match.isCapture) st.board[match.capture.r][match.capture.c] = null;
      st.board[to.r][to.c] = piece;

      const backRow = piece.color === 'black' ? BOARD_SIZE - 1 : 0;
      let promoted = false;
      if (!piece.king && to.r === backRow) {
        piece.king = true;
        promoted = true;
      }

      let continueTurn = false;
      if (match.isCapture && !promoted) {
        const further = getMovesForPiece(st.board, to.r, to.c).filter((m) => m.isCapture);
        if (further.length > 0) {
          continueTurn = true;
          st.mustContinueFrom = { r: to.r, c: to.c };
        }
      }

      if (!continueTurn) {
        st.mustContinueFrom = null;
        st.turn = opponent(seatColor);
        const oppMoves = getAllMovesForColor(st.board, st.turn);
        if (oppMoves.length === 0) {
          st.phase = 'game_over';
          st.winner = seatColor;
        }
      }

      broadcastState(room, ctx);
    }
  },
};
