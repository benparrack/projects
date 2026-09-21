// Checkers — click a piece, then click a destination square. Server validates and
// enforces mandatory captures / multi-jump; illegal attempts get a rejection flash.

const CELL = 44;

// Client-side mirror of server/games/checkers.js's pure move-generation rules, used only to
// highlight legal destinations after selecting a piece. Safe to duplicate here (unlike Hangman's
// hidden word) because the checkers board is fully public — every client already sees the whole
// board state, so this can't leak anything the server wouldn't already show. The server remains
// the sole authority on whether a move is actually accepted; this is purely a UI aid and must be
// kept in sync with server/games/checkers.js's own getMovesForPiece/getAllMovesForColor if the
// rules ever change there.
const BOARD_SIZE = 8;
const ALL_DIAGONALS = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
function inBounds(r, c) {
  return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
}
function getMovesForPiece(board, r, c) {
  const piece = board[r][c];
  if (!piece) return [];
  const forwardDr = piece.color === 'black' ? 1 : -1;
  const stepDirs = piece.king ? ALL_DIAGONALS : [[forwardDr, 1], [forwardDr, -1]];
  const captures = [];
  for (const [dr, dc] of stepDirs) {
    const midR = r + dr, midC = c + dc, toR = r + dr * 2, toC = c + dc * 2;
    if (!inBounds(toR, toC)) continue;
    const midPiece = board[midR][midC];
    if (midPiece && midPiece.color !== piece.color && !board[toR][toC]) {
      captures.push({ from: { r, c }, to: { r: toR, c: toC }, isCapture: true });
    }
  }
  if (captures.length > 0) return captures;
  const simple = [];
  for (const [dr, dc] of stepDirs) {
    const toR = r + dr, toC = c + dc;
    if (inBounds(toR, toC) && !board[toR][toC]) simple.push({ from: { r, c }, to: { r: toR, c: toC }, isCapture: false });
  }
  return simple;
}
function getAllMovesForColor(board, color) {
  const all = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const piece = board[r][c];
      if (!piece || piece.color !== color) continue;
      all.push(...getMovesForPiece(board, r, c));
    }
  }
  return all.some((m) => m.isCapture) ? all.filter((m) => m.isCapture) : all;
}
function opponentColor(color) {
  return color === 'red' ? 'black' : 'red';
}
function legalDestinationsFrom(board, from) {
  const piece = board[from.r][from.c];
  if (!piece) return [];
  return getAllMovesForColor(board, piece.color)
    .filter((m) => m.from.r === from.r && m.from.c === from.c)
    .map((m) => m.to);
}

export function mount(container, api) {
  let view = null;
  let roster = [];
  let selected = null;
  let flashError = false;
  let flipOverride = null; // null = auto (orient so your own color sits at the bottom)

  const root = document.createElement('div');
  root.style.display = 'flex';
  root.style.flexDirection = 'column';
  root.style.gap = '10px';
  root.style.alignItems = 'center';
  container.appendChild(root);

  function nicknameFor(clientId) {
    if (!clientId) return null;
    if (clientId === 'BOT') return '(bot)';
    const entry = roster.find((r) => r.clientId === clientId);
    return entry ? entry.nickname : 'someone';
  }

  function mySeat() {
    const me = api.getClientId();
    if (!view) return null;
    if (view.players.red === me) return 'red';
    if (view.players.black === me) return 'black';
    return null;
  }

  function onSquareClick(r, c) {
    const seat = mySeat();
    if (!seat || view.phase !== 'playing' || view.turn !== seat) return;
    const piece = view.board[r][c];
    if (selected) {
      if (selected.r === r && selected.c === c) {
        selected = null;
      } else {
        api.sendAction({ kind: 'move', from: selected, to: { r, c } });
        selected = null;
      }
      render();
    } else if (piece && piece.color === seat) {
      selected = { r, c };
      render();
    }
  }

  function render() {
    root.innerHTML = '';
    if (!view) {
      root.textContent = 'Loading...';
      return;
    }

    const status = document.createElement('div');
    if (view.phase === 'waiting') {
      status.textContent = 'Waiting for both seats to be filled.';
    } else if (view.phase === 'playing') {
      const turnName = nicknameFor(view.players[view.turn]) || view.turn;
      status.textContent = `Turn: ${view.turn.toUpperCase()} (${turnName})${view.mustContinueFrom ? ' — must continue jumping' : ''}`;
    } else if (view.phase === 'game_over') {
      status.textContent = `${view.winner.toUpperCase()} WINS!`;
    }
    root.appendChild(status);

    if (flashError) {
      const err = document.createElement('div');
      err.textContent = 'Illegal move';
      err.style.color = '#ff4d4d';
      root.appendChild(err);
    }

    const seatRow = document.createElement('div');
    seatRow.style.display = 'flex';
    seatRow.style.gap = '12px';
    const seat = mySeat();

    for (const color of ['black', 'red']) {
      const label = document.createElement('div');
      const occupant = nicknameFor(view.players[color]);
      label.textContent = `${color.toUpperCase()}: ${occupant || '(empty)'}`;
      seatRow.appendChild(label);
      if (!view.players[color]) {
        if (!seat) {
          const btn = document.createElement('button');
          btn.textContent = `PLAY ${color.toUpperCase()}`;
          btn.addEventListener('click', () => api.sendAction({ kind: 'sit', seat: color }));
          seatRow.appendChild(btn);
        }
        // Shown even when the viewer is already seated — that's the whole point of a bot seat:
        // a lone human who's already sat down can still fill the other seat without waiting.
        const botBtn = document.createElement('button');
        botBtn.textContent = 'PLAY VS BOT';
        botBtn.addEventListener('click', () => api.sendAction({ kind: 'sit', seat: color, bot: true }));
        seatRow.appendChild(botBtn);
      } else if (view.players[color] === 'BOT') {
        const removeBtn = document.createElement('button');
        removeBtn.textContent = 'REMOVE BOT';
        removeBtn.addEventListener('click', () => api.sendAction({ kind: 'removeBot', seat: color }));
        seatRow.appendChild(removeBtn);
      }
    }
    if (seat) {
      const leaveBtn = document.createElement('button');
      leaveBtn.textContent = 'LEAVE SEAT';
      leaveBtn.addEventListener('click', () => api.sendAction({ kind: 'leaveSeat' }));
      seatRow.appendChild(leaveBtn);
    }
    const autoFlip = seat === 'black';
    const flipped = flipOverride !== null ? flipOverride : autoFlip;
    const flipBtn = document.createElement('button');
    flipBtn.textContent = 'FLIP BOARD';
    flipBtn.addEventListener('click', () => {
      flipOverride = !flipped;
      render();
    });
    seatRow.appendChild(flipBtn);
    root.appendChild(seatRow);

    if (view.phase !== 'waiting') {
      const counts = { black: 0, red: 0 };
      for (const row of view.board) {
        for (const cell of row) {
          if (cell) counts[cell.color]++;
        }
      }
      const diffLine = document.createElement('div');
      diffLine.style.fontSize = '0.85em';
      diffLine.style.opacity = '0.85';
      if (seat) {
        const mine = counts[seat];
        const theirs = counts[opponentColor(seat)];
        const diff = mine - theirs;
        diffLine.textContent = `You: ${mine}  Opponent: ${theirs}  (${diff > 0 ? '+' : ''}${diff})`;
      } else {
        diffLine.textContent = `BLACK: ${counts.black}  RED: ${counts.red}`;
      }
      root.appendChild(diffLine);
    }

    const board = document.createElement('div');
    board.style.display = 'grid';
    board.style.gridTemplateColumns = `repeat(8, ${CELL}px)`;
    board.style.gridTemplateRows = `repeat(8, ${CELL}px)`;
    board.style.border = '1px solid #1f8f0c';

    const legalTargets = selected ? legalDestinationsFrom(view.board, selected) : [];

    const lastMove = view.lastMove;
    // lastMove.path covers the whole chain for a multi-jump (every square the piece passed
    // through), not just the final leg's from/to.
    const isLastMoveSquare = (r, c) => !!lastMove && lastMove.path.some((p) => p.r === r && p.c === c);

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const cell = document.createElement('div');
        cell.dataset.row = String(r);
        cell.dataset.col = String(c);
        const dark = (r + c) % 2 === 1;
        const displayRow = flipped ? 7 - r : r;
        const displayCol = flipped ? 7 - c : c;
        cell.style.gridRowStart = String(displayRow + 1);
        cell.style.gridColumnStart = String(displayCol + 1);
        cell.style.width = `${CELL}px`;
        cell.style.height = `${CELL}px`;
        cell.style.background = dark
          ? isLastMoveSquare(r, c) ? '#3a3a10' : '#2a2a2a'
          : isLastMoveSquare(r, c) ? '#151505' : '#0a0a0a';
        cell.style.display = 'flex';
        cell.style.alignItems = 'center';
        cell.style.justifyContent = 'center';
        cell.style.boxSizing = 'border-box';
        if (selected && selected.r === r && selected.c === c) {
          cell.style.border = '2px solid #ffb000';
        } else if (isLastMoveSquare(r, c)) {
          cell.style.border = '2px solid rgba(255, 176, 0, 0.5)';
        }
        if (legalTargets.some((t) => t.r === r && t.c === c)) {
          const dot = document.createElement('div');
          dot.style.width = '14px';
          dot.style.height = '14px';
          dot.style.borderRadius = '50%';
          dot.style.background = 'rgba(255, 176, 0, 0.65)';
          cell.appendChild(dot);
        }
        if (dark) {
          cell.style.cursor = 'pointer';
          cell.addEventListener('click', () => onSquareClick(r, c));
          const piece = view.board[r][c];
          if (piece) {
            const disc = document.createElement('div');
            disc.style.width = `${CELL - 12}px`;
            disc.style.height = `${CELL - 12}px`;
            disc.style.borderRadius = '50%';
            // Actual black (not the amber previously used here) so the disc color matches the
            // "BLACK"/"PLAY BLACK" seat label — needs a visible border since a truly flat black
            // disc would otherwise disappear against the board's near-black dark squares.
            const isBlack = piece.color === 'black';
            disc.style.background = isBlack ? '#1a1a1a' : '#ff4d4d';
            disc.style.border = isBlack ? '2px solid #999' : '2px solid #7a1414';
            disc.style.boxSizing = 'border-box';
            disc.style.display = 'flex';
            disc.style.alignItems = 'center';
            disc.style.justifyContent = 'center';
            disc.style.color = isBlack ? '#fff' : '#000';
            disc.style.fontWeight = 'bold';
            if (piece.king) disc.textContent = 'K';
            cell.appendChild(disc);
          }
        }
        board.appendChild(cell);
      }
    }
    root.appendChild(board);

    if (view.phase === 'game_over') {
      const again = document.createElement('button');
      again.textContent = 'NEW GAME';
      again.addEventListener('click', () => api.sendAction({ kind: 'resetGame' }));
      root.appendChild(again);
    }
  }

  render();

  return {
    applySnapshot(snapshot) {
      view = snapshot;
      render();
    },
    applyEvent(data) {
      if (!data) return;
      if (data.kind === 'state') {
        view = data;
        flashError = false;
        render();
      } else if (data.kind === 'moveRejected') {
        flashError = true;
        selected = null;
        render();
      }
    },
    applyRoster(newRoster) {
      roster = newRoster;
      render();
    },
    unmount() {
      container.innerHTML = '';
    },
  };
}
