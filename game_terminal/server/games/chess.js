// Chess: full legal move generation (check/checkmate/stalemate via self-check simulation),
// castling, en passant, and promotion. No draw-by-repetition/50-move-rule detection (out of
// scope) -- games end by checkmate, stalemate, or resignation.

const SIZE = 8;
const BACK_RANK_ORDER = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];
const PROMOTION_TYPES = ['queen', 'rook', 'bishop', 'knight'];

function inBounds(r, c) {
  return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
}

function opponent(color) {
  return color === 'white' ? 'black' : 'white';
}

function cloneBoard(board) {
  return board.map((row) => row.map((cell) => (cell ? { ...cell } : null)));
}

function createInitialBoard() {
  const board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  for (let c = 0; c < SIZE; c++) {
    board[0][c] = { color: 'black', type: BACK_RANK_ORDER[c] };
    board[1][c] = { color: 'black', type: 'pawn' };
    board[6][c] = { color: 'white', type: 'pawn' };
    board[7][c] = { color: 'white', type: BACK_RANK_ORDER[c] };
  }
  return board;
}

function findKing(board, color) {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const p = board[r][c];
      if (p && p.color === color && p.type === 'king') return { r, c };
    }
  }
  return null;
}

function attacksSquare(board, fr, fc, tr, tc) {
  const piece = board[fr][fc];
  if (!piece) return false;
  const dr = tr - fr;
  const dc = tc - fc;

  if (piece.type === 'pawn') {
    const dir = piece.color === 'white' ? -1 : 1;
    return dr === dir && Math.abs(dc) === 1;
  }
  if (piece.type === 'knight') {
    return (Math.abs(dr) === 1 && Math.abs(dc) === 2) || (Math.abs(dr) === 2 && Math.abs(dc) === 1);
  }
  if (piece.type === 'king') {
    return Math.abs(dr) <= 1 && Math.abs(dc) <= 1 && (dr !== 0 || dc !== 0);
  }

  const isDiag = Math.abs(dr) === Math.abs(dc) && dr !== 0;
  const isOrth = dr === 0 !== (dc === 0);
  if (piece.type === 'bishop' && !isDiag) return false;
  if (piece.type === 'rook' && !isOrth) return false;
  if (piece.type === 'queen' && !isDiag && !isOrth) return false;

  const stepR = Math.sign(dr);
  const stepC = Math.sign(dc);
  let cr = fr + stepR;
  let cc = fc + stepC;
  while (cr !== tr || cc !== tc) {
    if (board[cr][cc]) return false;
    cr += stepR;
    cc += stepC;
  }
  return true;
}

function isSquareAttacked(board, r, c, byColor) {
  for (let rr = 0; rr < SIZE; rr++) {
    for (let cc = 0; cc < SIZE; cc++) {
      const p = board[rr][cc];
      if (p && p.color === byColor && attacksSquare(board, rr, cc, r, c)) return true;
    }
  }
  return false;
}

function mkMove(fr, fc, tr, tc, isCapture) {
  return { from: { r: fr, c: fc }, to: { r: tr, c: tc }, isCapture };
}

const SLIDING_DIRS = {
  bishop: [[1, 1], [1, -1], [-1, 1], [-1, -1]],
  rook: [[1, 0], [-1, 0], [0, 1], [0, -1]],
  queen: [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]],
};
const KNIGHT_OFFSETS = [[1, 2], [1, -2], [-1, 2], [-1, -2], [2, 1], [2, -1], [-2, 1], [-2, -1]];
const KING_OFFSETS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

function movesForPiece(board, r, c, state) {
  const piece = board[r][c];
  const moves = [];

  if (SLIDING_DIRS[piece.type]) {
    for (const [dr, dc] of SLIDING_DIRS[piece.type]) {
      let cr = r + dr;
      let cc = c + dc;
      while (inBounds(cr, cc)) {
        const target = board[cr][cc];
        if (!target) {
          moves.push(mkMove(r, c, cr, cc, false));
        } else {
          if (target.color !== piece.color) moves.push(mkMove(r, c, cr, cc, true));
          break;
        }
        cr += dr;
        cc += dc;
      }
    }
    return moves;
  }

  if (piece.type === 'knight') {
    for (const [dr, dc] of KNIGHT_OFFSETS) {
      const nr = r + dr;
      const nc = c + dc;
      if (!inBounds(nr, nc)) continue;
      const target = board[nr][nc];
      if (!target) moves.push(mkMove(r, c, nr, nc, false));
      else if (target.color !== piece.color) moves.push(mkMove(r, c, nr, nc, true));
    }
    return moves;
  }

  if (piece.type === 'king') {
    for (const [dr, dc] of KING_OFFSETS) {
      const nr = r + dr;
      const nc = c + dc;
      if (!inBounds(nr, nc)) continue;
      const target = board[nr][nc];
      if (!target) moves.push(mkMove(r, c, nr, nc, false));
      else if (target.color !== piece.color) moves.push(mkMove(r, c, nr, nc, true));
    }
    const rights = state.castlingRights[piece.color];
    const homeRow = piece.color === 'white' ? 7 : 0;
    if (r === homeRow && c === 4) {
      const enemy = opponent(piece.color);
      if (!isSquareAttacked(board, r, c, enemy)) {
        if (
          rights.kingSide &&
          !board[homeRow][5] &&
          !board[homeRow][6] &&
          board[homeRow][7] &&
          board[homeRow][7].type === 'rook' &&
          board[homeRow][7].color === piece.color &&
          !isSquareAttacked(board, homeRow, 5, enemy) &&
          !isSquareAttacked(board, homeRow, 6, enemy)
        ) {
          moves.push({ from: { r, c }, to: { r: homeRow, c: 6 }, isCapture: false, castle: 'king' });
        }
        if (
          rights.queenSide &&
          !board[homeRow][1] &&
          !board[homeRow][2] &&
          !board[homeRow][3] &&
          board[homeRow][0] &&
          board[homeRow][0].type === 'rook' &&
          board[homeRow][0].color === piece.color &&
          !isSquareAttacked(board, homeRow, 2, enemy) &&
          !isSquareAttacked(board, homeRow, 3, enemy)
        ) {
          moves.push({ from: { r, c }, to: { r: homeRow, c: 2 }, isCapture: false, castle: 'queen' });
        }
      }
    }
    return moves;
  }

  if (piece.type === 'pawn') {
    const dir = piece.color === 'white' ? -1 : 1;
    const startRow = piece.color === 'white' ? 6 : 1;
    const backRow = piece.color === 'white' ? 0 : 7;
    const oneR = r + dir;
    if (inBounds(oneR, c) && !board[oneR][c]) {
      moves.push({ from: { r, c }, to: { r: oneR, c }, isCapture: false, promotion: oneR === backRow });
      const twoR = r + dir * 2;
      if (r === startRow && !board[twoR][c]) {
        moves.push(mkMove(r, c, twoR, c, false));
      }
    }
    for (const dc of [-1, 1]) {
      const nr = r + dir;
      const nc = c + dc;
      if (!inBounds(nr, nc)) continue;
      const target = board[nr][nc];
      if (target && target.color !== piece.color) {
        moves.push({ from: { r, c }, to: { r: nr, c: nc }, isCapture: true, promotion: nr === backRow });
      } else if (!target && state.enPassantTarget && state.enPassantTarget.r === nr && state.enPassantTarget.c === nc) {
        moves.push({ from: { r, c }, to: { r: nr, c: nc }, isCapture: true, enPassant: true });
      }
    }
    return moves;
  }

  return moves;
}

function generatePseudoMoves(board, color, state) {
  const moves = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const piece = board[r][c];
      if (piece && piece.color === color) moves.push(...movesForPiece(board, r, c, state));
    }
  }
  return moves;
}

function applyMoveBoardOnly(board, move, promotionChoice) {
  const piece = board[move.from.r][move.from.c];
  board[move.from.r][move.from.c] = null;
  if (move.enPassant) board[move.from.r][move.to.c] = null;
  let placed = { ...piece };
  if (move.promotion) placed = { color: piece.color, type: promotionChoice || 'queen' };
  board[move.to.r][move.to.c] = placed;
  if (move.castle) {
    const homeRow = move.from.r;
    if (move.castle === 'king') {
      board[homeRow][5] = board[homeRow][7];
      board[homeRow][7] = null;
    } else {
      board[homeRow][3] = board[homeRow][0];
      board[homeRow][0] = null;
    }
  }
}

function getLegalMoves(board, color, state) {
  const pseudo = generatePseudoMoves(board, color, state);
  const legal = [];
  for (const move of pseudo) {
    const testBoard = cloneBoard(board);
    applyMoveBoardOnly(testBoard, move, 'queen');
    const king = findKing(testBoard, color);
    if (king && !isSquareAttacked(testBoard, king.r, king.c, opponent(color))) legal.push(move);
  }
  return legal;
}

function applyMove(board, state, move, promotionChoice) {
  const piece = board[move.from.r][move.from.c];
  const captured = board[move.to.r][move.to.c] || null;

  applyMoveBoardOnly(board, move, promotionChoice);

  if (piece.type === 'king') {
    state.castlingRights[piece.color].kingSide = false;
    state.castlingRights[piece.color].queenSide = false;
  }
  if (piece.type === 'rook') {
    const homeRow = piece.color === 'white' ? 7 : 0;
    if (move.from.r === homeRow && move.from.c === 0) state.castlingRights[piece.color].queenSide = false;
    if (move.from.r === homeRow && move.from.c === 7) state.castlingRights[piece.color].kingSide = false;
  }
  if (captured && captured.type === 'rook') {
    const enemyHomeRow = captured.color === 'white' ? 7 : 0;
    if (move.to.r === enemyHomeRow && move.to.c === 0) state.castlingRights[captured.color].queenSide = false;
    if (move.to.r === enemyHomeRow && move.to.c === 7) state.castlingRights[captured.color].kingSide = false;
  }

  if (piece.type === 'pawn' && Math.abs(move.to.r - move.from.r) === 2) {
    state.enPassantTarget = { r: (move.to.r + move.from.r) / 2, c: move.from.c };
  } else {
    state.enPassantTarget = null;
  }
}

function buildPublicState(room) {
  const st = room.state;
  return {
    phase: st.phase,
    players: st.players,
    board: st.board,
    turn: st.turn,
    inCheck: st.inCheck,
    winner: st.winner,
    winReason: st.winReason,
    moveHistory: st.moveHistory,
    legalMoves: st.phase === 'playing' ? getLegalMoves(st.board, st.turn, st) : [],
  };
}

function broadcastState(room, ctx) {
  ctx.broadcast({ v: 1, type: 'game.event', payload: { gameType: 'chess', data: { kind: 'state', ...buildPublicState(room) } } });
}

function resetBoard(st) {
  st.board = createInitialBoard();
  st.turn = 'white';
  st.castlingRights = { white: { kingSide: true, queenSide: true }, black: { kingSide: true, queenSide: true } };
  st.enPassantTarget = null;
  st.inCheck = null;
  st.winner = null;
  st.winReason = null;
  st.moveHistory = [];
}

module.exports = {
  type: 'chess',

  createInitialState() {
    const st = { phase: 'waiting', players: { white: null, black: null } };
    resetBoard(st);
    return st;
  },

  serializeSnapshot(room) {
    return buildPublicState(room);
  },

  onLeave(room, client) {
    const st = room.state;
    let changed = false;
    if (st.players.white === client.clientId) {
      st.players.white = null;
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
        room.sendTo(clientId, { v: 1, type: 'game.event', payload: { gameType: 'chess', data: { kind: 'state', ...buildPublicState(room) } } });
      }
    }
  },

  onMessage(room, client, data, ctx) {
    if (!data || typeof data.kind !== 'string') return;
    const st = room.state;

    function reject() {
      ctx.sendTo(ctx.senderId, { v: 1, type: 'game.event', payload: { gameType: 'chess', data: { kind: 'moveRejected' } } });
    }

    if (data.kind === 'sit') {
      const seat = data.seat === 'white' || data.seat === 'black' ? data.seat : null;
      if (!seat) return;
      if (st.players[seat]) return;
      if (st.players.white === ctx.senderId || st.players.black === ctx.senderId) return;
      st.players[seat] = ctx.senderId;
      if (st.players.white && st.players.black) {
        resetBoard(st);
        st.phase = 'playing';
      }
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'leaveSeat') {
      let changed = false;
      if (st.players.white === ctx.senderId) {
        st.players.white = null;
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
      st.phase = st.players.white && st.players.black ? 'playing' : 'waiting';
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'resign') {
      if (st.phase !== 'playing') return;
      const seatColor = st.players.white === ctx.senderId ? 'white' : st.players.black === ctx.senderId ? 'black' : null;
      if (!seatColor) return;
      st.phase = 'game_over';
      st.winner = opponent(seatColor);
      st.winReason = 'resignation';
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'move') {
      if (st.phase !== 'playing') return reject();
      const seatColor = st.players.white === ctx.senderId ? 'white' : st.players.black === ctx.senderId ? 'black' : null;
      if (!seatColor || seatColor !== st.turn) return reject();
      const { from, to } = data;
      if (!from || !to) return reject();

      const legalMoves = getLegalMoves(st.board, seatColor, st);
      const match = legalMoves.find((m) => m.from.r === from.r && m.from.c === from.c && m.to.r === to.r && m.to.c === to.c);
      if (!match) return reject();

      let promotionChoice = null;
      if (match.promotion) {
        promotionChoice = PROMOTION_TYPES.includes(data.promotion) ? data.promotion : 'queen';
      }

      const movingPiece = st.board[from.r][from.c];
      const capturedPiece = match.enPassant ? st.board[match.from.r][match.to.c] : st.board[to.r][to.c];

      applyMove(st.board, st, match, promotionChoice);
      st.turn = opponent(seatColor);

      st.moveHistory.push({
        from: { r: from.r, c: from.c },
        to: { r: to.r, c: to.c },
        piece: movingPiece.type,
        color: seatColor,
        captured: capturedPiece ? capturedPiece.type : null,
        promotion: promotionChoice,
        castle: match.castle || null,
      });

      const nextLegal = getLegalMoves(st.board, st.turn, st);
      const kingPos = findKing(st.board, st.turn);
      const inCheck = kingPos ? isSquareAttacked(st.board, kingPos.r, kingPos.c, seatColor) : false;
      st.inCheck = inCheck ? st.turn : null;

      if (nextLegal.length === 0) {
        st.phase = 'game_over';
        st.winner = inCheck ? seatColor : 'draw';
        st.winReason = inCheck ? 'checkmate' : 'stalemate';
      }

      broadcastState(room, ctx);
    }
  },
};
