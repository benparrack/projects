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


// --- Notation (SAN + FEN), kept per game so a finished game can be reviewed move by move. ---

const PIECE_LETTER = { king: 'K', queen: 'Q', rook: 'R', bishop: 'B', knight: 'N', pawn: '' };
const FEN_LETTER = { king: 'k', queen: 'q', rook: 'r', bishop: 'b', knight: 'n', pawn: 'p' };
const sqName = (r, c) => `${String.fromCharCode(97 + c)}${8 - r}`;

function clonePos(pos) {
  return {
    board: cloneBoard(pos.board),
    turn: pos.turn,
    castlingRights: { white: { ...pos.castlingRights.white }, black: { ...pos.castlingRights.black } },
    enPassantTarget: pos.enPassantTarget ? { ...pos.enPassantTarget } : null,
  };
}

// Standard algebraic notation for `move` (one of getLegalMoves' entries) in position `pos`
// ({ board, turn, castlingRights, enPassantTarget }), with the +/# suffix.
function sanOf(pos, move, promotionChoice) {
  const piece = pos.board[move.from.r][move.from.c];
  let san;
  if (move.castle) {
    san = move.castle === 'king' ? 'O-O' : 'O-O-O';
  } else {
    const dest = sqName(move.to.r, move.to.c);
    if (piece.type === 'pawn') {
      san = move.isCapture ? `${String.fromCharCode(97 + move.from.c)}x${dest}` : dest;
      if (move.promotion) san += `=${PIECE_LETTER[promotionChoice || 'queen']}`;
    } else {
      const rivals = getLegalMoves(pos.board, piece.color, pos).filter((m) => {
        if (m.to.r !== move.to.r || m.to.c !== move.to.c) return false;
        if (m.from.r === move.from.r && m.from.c === move.from.c) return false;
        const p = pos.board[m.from.r][m.from.c];
        return p && p.type === piece.type;
      });
      let dis = '';
      if (rivals.length) {
        const file = String.fromCharCode(97 + move.from.c);
        const rank = String(8 - move.from.r);
        if (!rivals.some((m) => m.from.c === move.from.c)) dis = file;
        else if (!rivals.some((m) => m.from.r === move.from.r)) dis = rank;
        else dis = file + rank;
      }
      san = `${PIECE_LETTER[piece.type]}${dis}${move.isCapture ? 'x' : ''}${dest}`;
    }
  }
  const after = clonePos(pos);
  applyMove(after.board, after, move, promotionChoice);
  const them = opponent(piece.color);
  const king = findKing(after.board, them);
  const check = king && isSquareAttacked(after.board, king.r, king.c, piece.color);
  if (check) san += getLegalMoves(after.board, them, after).length ? '+' : '#';
  return san;
}

function fenOf(pos, halfmove, fullmove) {
  const rows = pos.board.map((row) => {
    let out = '';
    let empty = 0;
    for (const cell of row) {
      if (!cell) { empty++; continue; }
      if (empty) { out += empty; empty = 0; }
      const ch = FEN_LETTER[cell.type];
      out += cell.color === 'white' ? ch.toUpperCase() : ch;
    }
    return empty ? out + empty : out;
  });
  const cr = pos.castlingRights;
  const castle = `${cr.white.kingSide ? 'K' : ''}${cr.white.queenSide ? 'Q' : ''}${cr.black.kingSide ? 'k' : ''}${cr.black.queenSide ? 'q' : ''}` || '-';
  const ep = pos.enPassantTarget ? sqName(pos.enPassantTarget.r, pos.enPassantTarget.c) : '-';
  return `${rows.join('/')} ${pos.turn === 'white' ? 'w' : 'b'} ${castle} ${ep} ${halfmove} ${fullmove}`;
}

function snapshotPosition(st) {
  const pos = clonePos(st);
  pos.fen = fenOf(st, st.halfmove || 0, Math.floor((st.moveHistory || []).length / 2) + 1);
  return pos;
}

function buildPublicState(room) {
  const st = room.state;
  return {
    phase: st.phase,
    players: st.players,
    botLevels: st.botLevels || {},
    board: st.board,
    turn: st.turn,
    inCheck: st.inCheck,
    winner: st.winner,
    winReason: st.winReason,
    moveHistory: st.moveHistory,
    legalMoves: st.phase === 'playing' ? getLegalMoves(st.board, st.turn, st) : [],
    timeControlMs: st.timeControlMs || null,
    clocks: st.clocks || null,
    gameId: st.gameId,
    // The last finished game stays reviewable (RECAP) until the next game actually starts.
    review: st.lastGame ? { gameId: st.lastGame.gameId, plies: st.lastGame.moves.length } : null,
  };
}

// Charges real elapsed wall-clock time since the last update to whichever side's clock is
// currently running (the side to move) — called both from the 1x/sec tick (so clients see a live
// countdown and flag-falls get caught even if nobody moves) and right before a move is accepted
// (so the exact time used for that move is charged before the turn switches).
function applyClockElapsed(st) {
  if (!st.clocks || st.phase !== 'playing') return;
  const now = Date.now();
  const elapsed = now - st.lastClockUpdate;
  st.lastClockUpdate = now;
  st.clocks[st.turn] = Math.max(0, st.clocks[st.turn] - elapsed);
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
  st.reported = false;
  st.halfmove = 0;
  st.gameId = (st.gameId || 0) + 1;
  st.positions = [snapshotPosition(st)];
  // st.timeControlMs is a room-level setting (set via the `setTimeControl` action, independent of
  // resetBoard) — only the remaining-time counters reset here, to the full control, each new game.
  st.clocks = st.timeControlMs ? { white: st.timeControlMs, black: st.timeControlMs } : null;
  st.lastClockUpdate = Date.now();
}

// Applies an already-validated move (from a human or a bot) — mutates st in place (board, turn,
// move history, check/game-over detection). Shared by both paths so a bot's move goes through
// exactly the same post-move bookkeeping as a human's.
function applyChessMove(room, seatColor, match, promotionChoice) {
  const st = room.state;
  const { from, to } = match;
  const movingPiece = st.board[from.r][from.c];
  const capturedPiece = match.enPassant ? st.board[match.from.r][match.to.c] : st.board[to.r][to.c];
  const san = sanOf(st, match, promotionChoice);
  st.halfmove = movingPiece.type === 'pawn' || capturedPiece ? 0 : (st.halfmove || 0) + 1;

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
    san,
  });
  st.positions.push(snapshotPosition(st));

  const nextLegal = getLegalMoves(st.board, st.turn, st);
  const kingPos = findKing(st.board, st.turn);
  const inCheck = kingPos ? isSquareAttacked(st.board, kingPos.r, kingPos.c, seatColor) : false;
  st.inCheck = inCheck ? st.turn : null;

  if (nextLegal.length === 0) {
    endGame(room, inCheck ? seatColor : 'draw', inCheck ? 'checkmate' : 'stalemate');
  }
}

// --- Game over + post-game review ---------------------------------------------------------------

function endGame(room, winner, reason) {
  const st = room.state;
  st.phase = 'game_over';
  st.winner = winner;
  st.winReason = reason;
  // Archive the finished game for RECAP: SAN moves + every position's FEN (positions[i] is the
  // position before move i; positions[moves.length] the final one). Engine analysis fills
  // `analysis[i]` lazily, the first time someone opens the review.
  st.lastGame = {
    gameId: st.gameId,
    moves: st.moveHistory.map((m) => ({ from: m.from, to: m.to, san: m.san, color: m.color, piece: m.piece, captured: m.captured, promotion: m.promotion, castle: m.castle })),
    positions: st.positions,
    winner,
    winReason: reason,
    analysis: [],
    running: false,
    subscribers: new Set(),
  };
  // Replay = UCI strings ('e2e4', 'e7e8q'); every game starts from the standard position.
  const replay = st.moveHistory.map((m) => sqName(m.from.r, m.from.c) + sqName(m.to.r, m.to.c) + (m.promotion ? FEN_LETTER[m.promotion] : ''));
  reportDuel(room, ['white', 'black'], winner, { replay });
}

// A new game is starting: the previous game's review goes away (clients leave review mode when
// they see phase 'playing').
function dropReview(st) {
  st.lastGame = null;
}

const ANALYSIS_MS = 350; // per position, expert level — a 40-move game analyses in ~15-25s
const MATE_SCORE = 30000; // chessEngine.js's MATE
const reviewEvent = (data) => ({ v: 1, type: 'game.event', payload: { gameType: 'chess', data } });

// Engine score (side-to-move POV, centipawns or mate) -> { cp } or { mate } from White's POV.
function evalFromScore(score, turn) {
  const sign = turn === 'white' ? 1 : -1;
  if (Math.abs(score) > MATE_SCORE - 200) {
    const moves = Math.ceil((MATE_SCORE - Math.abs(score)) / 2);
    return { mate: Math.sign(score) * sign * Math.max(1, moves) };
  }
  return { cp: score * sign };
}

function analysisFor(game, i, result) {
  const pos = game.positions[i];
  const entry = { index: i, eval: null, best: null };
  if (i === game.moves.length && (game.winReason === 'checkmate' || game.winReason === 'stalemate')) {
    entry.eval = game.winReason === 'checkmate' ? { mate: 0, winner: game.winner } : { cp: 0 };
    return entry;
  }
  if (!result) return entry;
  entry.eval = evalFromScore(result.score, pos.turn);
  const legal = getLegalMoves(pos.board, pos.turn, pos);
  const match = legal.find((m) => m.from.r === result.from.r && m.from.c === result.from.c && m.to.r === result.to.r && m.to.c === result.to.c);
  if (match) {
    const promo = match.promotion ? result.promotion || 'queen' : null;
    entry.best = { from: match.from, to: match.to, promotion: promo, san: sanOf(pos, match, promo) };
  }
  return entry;
}

function sendToSubscribers(room, game, msg) {
  for (const id of game.subscribers) {
    if (room.clients.has(id)) room.sendTo(id, msg);
    else game.subscribers.delete(id);
  }
}

// Analyses every position of the archived game in order, one engine request at a time on the
// shared AI worker (so bot moves in other rooms interleave instead of queueing behind a whole
// game), streaming each result to whoever has the review open. Stops if the archive is replaced.
async function runAnalysis(room, game) {
  if (game.running) return;
  game.running = true;
  for (let i = 0; i <= game.moves.length; i++) {
    if (room.state.lastGame !== game) return;
    if (game.analysis[i]) continue;
    const pos = game.positions[i];
    const terminal = i === game.moves.length && (game.winReason === 'checkmate' || game.winReason === 'stalemate');
    let result = null;
    if (!terminal) {
      try {
        result = await think('chess', { board: pos.board, turn: pos.turn, castlingRights: pos.castlingRights, enPassantTarget: pos.enPassantTarget, level: 'expert', timeMs: ANALYSIS_MS });
      } catch (err) {
        result = null;
      }
    }
    if (room.state.lastGame !== game) return;
    game.analysis[i] = analysisFor(game, i, result);
    sendToSubscribers(room, game, reviewEvent({ kind: 'reviewAnalysis', gameId: game.gameId, entry: game.analysis[i] }));
  }
  game.done = true;
}

const { think } = require('./ai');
const { setBotLevel, botLevelOf } = require('./ai/levels');
const { reportDuel, frameOf } = require('./boardResult');

const BOT = 'BOT';
const BOT_THINK_MS_MIN = 100;
const BOT_THINK_MS_MAX = 300;

// See connect4.js's maybeScheduleBotMove for the sentinel-seat / re-validate-on-fire pattern this
// mirrors. Also charges clock time for the bot's "thinking" delay when a time control is active,
// same as a human's move does, so a bot can still lose on time in principle (short delay makes it
// unlikely in practice, but keeps the clock model consistent rather than special-cased for bots).
function maybeScheduleBotMove(room) {
  const st = room.state;
  if (st.phase !== 'playing' || st.players[st.turn] !== BOT) return;
  const delay = BOT_THINK_MS_MIN + Math.random() * (BOT_THINK_MS_MAX - BOT_THINK_MS_MIN);
  setTimeout(() => {
    const st2 = room.state;
    if (st2.phase !== 'playing' || st2.players[st2.turn] !== BOT) return;
    const color = st2.turn;

    if (st2.clocks) {
      applyClockElapsed(st2);
      if (st2.clocks[color] <= 0) {
        endGame(room, opponent(color), 'timeout');
        room.broadcast({ v: 1, type: 'game.event', payload: { gameType: 'chess', data: { kind: 'state', ...buildPublicState(room) } } });
        return;
      }
    }

    const legalMoves = getLegalMoves(st2.board, color, st2);
    if (legalMoves.length === 0) return;
    const history = st2.moveHistory;
    const plies = history.length;
    // The engine caps this further by difficulty level; a running clock caps it at ~1/25th.
    const timeMs = st2.clocks ? Math.max(200, st2.clocks[color] / 25) : undefined;
    const finish = (best) => {
      const st3 = room.state;
      // Re-validate: a reset, resign or duplicate timer may have changed the game mid-search.
      if (st3.phase !== 'playing' || st3.turn !== color || st3.players[color] !== BOT || st3.moveHistory !== history || history.length !== plies) return;
      if (st3.clocks) {
        applyClockElapsed(st3);
        if (st3.clocks[color] <= 0) {
          endGame(room, opponent(color), 'timeout');
          room.broadcast({ v: 1, type: 'game.event', payload: { gameType: 'chess', data: { kind: 'state', ...buildPublicState(room) } } });
          return;
        }
      }
      let match = best && legalMoves.find((m) => m.from.r === best.from.r && m.from.c === best.from.c && m.to.r === best.to.r && m.to.c === best.to.c);
      if (!match) match = legalMoves[Math.floor(Math.random() * legalMoves.length)];
      const promotionChoice = match.promotion ? (best && best.promotion) || 'queen' : null;
      applyChessMove(room, color, match, promotionChoice);
      room.broadcast({ v: 1, type: 'game.event', payload: { gameType: 'chess', data: { kind: 'state', ...buildPublicState(room) } } });
      maybeScheduleBotMove(room);
    };
    think('chess', { board: st2.board, turn: color, castlingRights: st2.castlingRights, enPassantTarget: st2.enPassantTarget, timeMs, level: botLevelOf(st2, color) })
      .then(finish, () => finish(null));
  }, delay);
}

module.exports = {
  type: 'chess',
  // Exposed for tests.
  _internals: { sanOf, fenOf, getLegalMoves, evalFromScore, createInitialBoard },

  createInitialState() {
    const st = { phase: 'waiting', players: { white: null, black: null }, timeControlMs: null };
    resetBoard(st);
    return st;
  },

  // 1x/sec is plenty for a countdown clock (vs. slither's real physics tick) — see
  // roomManager.js's Room constructor for how a plugin opts into this periodic hook.
  tickIntervalMs: 1000,
  tick(room, ctx) {
    const st = room.state;
    if (st.phase !== 'playing' || !st.clocks) return;
    applyClockElapsed(st);
    if (st.clocks[st.turn] <= 0) {
      endGame(room, opponent(st.turn), 'timeout');
    }
    broadcastState(room, ctx);
  },

  // Both seats taken — RoomManager uses this to route extra public-lobby joiners into a fresh
  // instance instead of dumping them all into one game as permanent spectators (real playtest
  // request: "more than two people should get put into a new lobby waiting for another person").
  isRoomFull(room) {
    return !!(room.state.players.white && room.state.players.black);
  },

  serializeSnapshot(room) {
    return buildPublicState(room);
  },

  stats: { rated: true },

  // Re-plays a reported UCI move list on a fresh board through the real move path; one spectator
  // snapshot per position (legalMoves dropped — spectators can't move, and it keeps frames small).
  replayFrames(replay) {
    const PROMO = { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' };
    const sqOf = (s) => ({ r: 8 - Number(s[1]), c: s.charCodeAt(0) - 97 });
    const room = { state: module.exports.createInitialState() };
    room.state.phase = 'playing';
    const frame = () => frameOf({ ...buildPublicState(room), legalMoves: [] });
    const frames = [frame()];
    for (const uci of replay) {
      const st = room.state;
      const from = sqOf(uci.slice(0, 2));
      const to = sqOf(uci.slice(2, 4));
      const match = getLegalMoves(st.board, st.turn, st).find((m) => m.from.r === from.r && m.from.c === from.c && m.to.r === to.r && m.to.c === to.c);
      if (!match) break;
      applyChessMove(room, st.turn, match, match.promotion ? PROMO[uci[4]] || 'queen' : null);
      frames.push(frame());
    }
    return frames;
  },

  onLeave(room, client) {
    const st = room.state;
    if (st.lastGame) st.lastGame.subscribers.delete(client.clientId);
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
      if (data.bot) {
        st.players[seat] = BOT;
        setBotLevel(st, seat, data.level);
      } else {
        if (st.players.white === ctx.senderId || st.players.black === ctx.senderId) return;
        st.players[seat] = ctx.senderId;
      }
      if (st.players.white && st.players.black) {
        resetBoard(st);
        st.phase = 'playing';
        dropReview(st);
      }
      broadcastState(room, ctx);
      maybeScheduleBotMove(room);
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

    // Removes a bot from a seat (a human can't "sit" over a BOT sentinel via the normal `sit`
    // check, since the seat isn't empty).
    if (data.kind === 'setBotLevel') {
      const seat = data.seat === 'white' || data.seat === 'black' ? data.seat : null;
      if (!seat || st.players[seat] !== BOT) return;
      setBotLevel(st, seat, data.level);
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'removeBot') {
      const seat = data.seat === 'white' || data.seat === 'black' ? data.seat : null;
      if (!seat || st.players[seat] !== BOT) return;
      st.players[seat] = null;
      st.phase = 'waiting';
      resetBoard(st);
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'setTimeControl') {
      if (st.phase !== 'waiting') return;
      const seatColor = st.players.white === ctx.senderId ? 'white' : st.players.black === ctx.senderId ? 'black' : null;
      if (!seatColor) return;
      const minutes = Number(data.minutes);
      st.timeControlMs = Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes * 60000) : null;
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'resetGame') {
      if (st.phase !== 'game_over') return;
      resetBoard(st);
      st.phase = st.players.white && st.players.black ? 'playing' : 'waiting';
      if (st.phase === 'playing') dropReview(st);
      broadcastState(room, ctx);
      maybeScheduleBotMove(room);
      return;
    }

    // RECAP: anyone in the room (players or spectators) can open the last finished game's review.
    // The archive goes out once, to the requester only; analysis entries stream in as they finish.
    if (data.kind === 'reviewRequest') {
      const game = st.lastGame;
      if (!game || (data.gameId != null && data.gameId !== game.gameId)) {
        ctx.sendTo(ctx.senderId, reviewEvent({ kind: 'reviewUnavailable' }));
        return;
      }
      game.subscribers.add(ctx.senderId);
      ctx.sendTo(ctx.senderId, reviewEvent({
        kind: 'reviewData',
        gameId: game.gameId,
        moves: game.moves,
        fens: game.positions.map((p) => p.fen),
        winner: game.winner,
        winReason: game.winReason,
        analysis: game.analysis,
        done: !!game.done,
      }));
      runAnalysis(room, game);
      return;
    }

    if (data.kind === 'reviewClose') {
      if (st.lastGame) st.lastGame.subscribers.delete(ctx.senderId);
      return;
    }

    if (data.kind === 'resign') {
      if (st.phase !== 'playing') return;
      const seatColor = st.players.white === ctx.senderId ? 'white' : st.players.black === ctx.senderId ? 'black' : null;
      if (!seatColor) return;
      endGame(room, opponent(seatColor), 'resignation');
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'move') {
      if (st.phase !== 'playing') return reject();
      const seatColor = st.players.white === ctx.senderId ? 'white' : st.players.black === ctx.senderId ? 'black' : null;
      if (!seatColor || seatColor !== st.turn) return reject();

      if (st.clocks) {
        applyClockElapsed(st);
        if (st.clocks[seatColor] <= 0) {
          endGame(room, opponent(seatColor), 'timeout');
          broadcastState(room, ctx);
          return;
        }
      }

      const { from, to } = data;
      if (!from || !to) return reject();

      const legalMoves = getLegalMoves(st.board, seatColor, st);
      const match = legalMoves.find((m) => m.from.r === from.r && m.from.c === from.c && m.to.r === to.r && m.to.c === to.c);
      if (!match) return reject();

      let promotionChoice = null;
      if (match.promotion) {
        promotionChoice = PROMOTION_TYPES.includes(data.promotion) ? data.promotion : 'queen';
      }

      applyChessMove(room, seatColor, match, promotionChoice);
      broadcastState(room, ctx);
      maybeScheduleBotMove(room);
    }
  },
};
