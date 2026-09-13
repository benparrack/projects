// Chess — click a piece, then a destination. Server validates fully (check, castling,
// en passant, promotion); illegal attempts flash a rejection. Board orientation is fixed
// (white at the bottom) for both players, matching this project's Checkers implementation.

const CELL = 44;
const GLYPHS = {
  white: { king: '♔', queen: '♕', rook: '♖', bishop: '♗', knight: '♘', pawn: '♙' },
  black: { king: '♚', queen: '♛', rook: '♜', bishop: '♝', knight: '♞', pawn: '♟' },
};
const PROMOTION_CHOICES = ['queen', 'rook', 'bishop', 'knight'];

export function mount(container, api) {
  let view = null;
  let roster = [];
  let selected = null;
  let flashError = false;
  let pendingPromotion = null; // { from, to }

  const root = document.createElement('div');
  root.style.display = 'flex';
  root.style.flexDirection = 'column';
  root.style.gap = '10px';
  root.style.alignItems = 'center';
  container.appendChild(root);

  function nicknameFor(clientId) {
    if (!clientId) return null;
    const entry = roster.find((r) => r.clientId === clientId);
    return entry ? entry.nickname : 'someone';
  }

  function mySeat() {
    const me = api.getClientId();
    if (!view) return null;
    if (view.players.white === me) return 'white';
    if (view.players.black === me) return 'black';
    return null;
  }

  function squareName(r, c) {
    return `${String.fromCharCode(97 + c)}${8 - r}`;
  }

  function moveText(m) {
    if (m.castle === 'king') return 'O-O';
    if (m.castle === 'queen') return 'O-O-O';
    const sep = m.captured ? 'x' : '→';
    let txt = `${squareName(m.from.r, m.from.c)}${sep}${squareName(m.to.r, m.to.c)}`;
    if (m.promotion) txt += `=${m.promotion[0].toUpperCase()}`;
    return txt;
  }

  function legalDestinations() {
    if (!selected || !view.legalMoves) return [];
    return view.legalMoves.filter((m) => m.from.r === selected.r && m.from.c === selected.c);
  }

  function isPromotionAttempt(from, to) {
    const piece = view.board[from.r][from.c];
    if (!piece || piece.type !== 'pawn') return false;
    return to.r === 0 || to.r === 7;
  }

  function onSquareClick(r, c) {
    const seat = mySeat();
    if (!seat || view.phase !== 'playing' || view.turn !== seat || pendingPromotion) return;
    const piece = view.board[r][c];
    if (selected) {
      if (selected.r === r && selected.c === c) {
        selected = null;
      } else if (isPromotionAttempt(selected, { r, c })) {
        pendingPromotion = { from: selected, to: { r, c } };
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

  function choosePromotion(type) {
    if (!pendingPromotion) return;
    api.sendAction({ kind: 'move', from: pendingPromotion.from, to: pendingPromotion.to, promotion: type });
    pendingPromotion = null;
    render();
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
      status.textContent = `Turn: ${view.turn.toUpperCase()} (${turnName})${view.inCheck === view.turn ? ' — CHECK' : ''}`;
    } else if (view.phase === 'game_over') {
      const reason = view.winReason === 'checkmate' ? 'CHECKMATE' : view.winReason === 'resignation' ? 'RESIGNATION' : 'STALEMATE';
      status.textContent = view.winner === 'draw' ? `DRAW (${reason})` : `${view.winner.toUpperCase()} WINS (${reason})`;
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

    for (const color of ['white', 'black']) {
      const label = document.createElement('div');
      const occupant = nicknameFor(view.players[color]);
      label.textContent = `${color.toUpperCase()}: ${occupant || '(empty)'}`;
      seatRow.appendChild(label);
      if (!view.players[color] && !seat) {
        const btn = document.createElement('button');
        btn.textContent = `PLAY ${color.toUpperCase()}`;
        btn.addEventListener('click', () => api.sendAction({ kind: 'sit', seat: color }));
        seatRow.appendChild(btn);
      }
    }
    if (seat) {
      const leaveBtn = document.createElement('button');
      leaveBtn.textContent = 'LEAVE SEAT';
      leaveBtn.addEventListener('click', () => api.sendAction({ kind: 'leaveSeat' }));
      seatRow.appendChild(leaveBtn);
      if (view.phase === 'playing') {
        const resignBtn = document.createElement('button');
        resignBtn.textContent = 'RESIGN';
        resignBtn.addEventListener('click', () => api.sendAction({ kind: 'resign' }));
        seatRow.appendChild(resignBtn);
      }
    }
    root.appendChild(seatRow);

    const board = document.createElement('div');
    board.style.display = 'grid';
    board.style.gridTemplateColumns = `repeat(8, ${CELL}px)`;
    board.style.gridTemplateRows = `repeat(8, ${CELL}px)`;
    board.style.border = '1px solid #1f8f0c';

    const destMoves = legalDestinations();

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const cell = document.createElement('div');
        cell.dataset.row = String(r);
        cell.dataset.col = String(c);
        const dark = (r + c) % 2 === 1;
        cell.style.width = `${CELL}px`;
        cell.style.height = `${CELL}px`;
        cell.style.background = dark ? '#2a2a2a' : '#0a0a0a';
        cell.style.position = 'relative';
        cell.style.display = 'flex';
        cell.style.alignItems = 'center';
        cell.style.justifyContent = 'center';
        cell.style.boxSizing = 'border-box';
        cell.style.fontSize = `${CELL - 10}px`;
        cell.style.cursor = 'pointer';
        if (selected && selected.r === r && selected.c === c) {
          cell.style.border = '2px solid #ffb000';
        }
        cell.addEventListener('click', () => onSquareClick(r, c));
        const piece = view.board[r][c];
        if (piece) {
          const glyph = document.createElement('span');
          glyph.textContent = GLYPHS[piece.color][piece.type];
          glyph.style.color = piece.color === 'white' ? '#f5f5f5' : '#1a1a1a';
          glyph.style.textShadow = piece.color === 'white' ? '0 0 2px #000' : '0 0 2px #999';
          cell.appendChild(glyph);
        }
        const destMove = destMoves.find((m) => m.to.r === r && m.to.c === c);
        if (destMove) {
          const marker = document.createElement('div');
          marker.style.position = 'absolute';
          marker.style.boxSizing = 'border-box';
          if (piece) {
            marker.style.width = `${CELL - 6}px`;
            marker.style.height = `${CELL - 6}px`;
            marker.style.border = '3px solid rgba(57,255,20,0.65)';
            marker.style.borderRadius = '50%';
          } else {
            marker.style.width = '14px';
            marker.style.height = '14px';
            marker.style.background = 'rgba(57,255,20,0.55)';
            marker.style.borderRadius = '50%';
          }
          cell.appendChild(marker);
        }
        board.appendChild(cell);
      }
    }

    const boardRow = document.createElement('div');
    boardRow.style.display = 'flex';
    boardRow.style.gap = '12px';
    boardRow.style.alignItems = 'flex-start';
    boardRow.appendChild(board);

    const historyPanel = document.createElement('div');
    historyPanel.style.width = '150px';
    historyPanel.style.maxHeight = `${CELL * 8}px`;
    historyPanel.style.overflowY = 'auto';
    historyPanel.style.border = '1px solid #1f8f0c';
    historyPanel.style.padding = '6px';
    historyPanel.style.fontSize = '13px';
    historyPanel.style.color = '#39ff14';
    historyPanel.style.boxSizing = 'border-box';
    const historyTitle = document.createElement('div');
    historyTitle.textContent = 'MOVES';
    historyTitle.style.opacity = '0.7';
    historyTitle.style.marginBottom = '4px';
    historyPanel.appendChild(historyTitle);
    const history = view.moveHistory || [];
    for (let i = 0; i < history.length; i += 2) {
      const row = document.createElement('div');
      const num = i / 2 + 1;
      const whiteText = moveText(history[i]);
      const blackText = history[i + 1] ? moveText(history[i + 1]) : '';
      row.textContent = `${num}. ${whiteText}  ${blackText}`;
      historyPanel.appendChild(row);
    }
    boardRow.appendChild(historyPanel);
    root.appendChild(boardRow);
    historyPanel.scrollTop = historyPanel.scrollHeight;

    if (pendingPromotion) {
      const picker = document.createElement('div');
      picker.style.display = 'flex';
      picker.style.gap = '6px';
      const label = document.createElement('span');
      label.textContent = 'Promote to: ';
      picker.appendChild(label);
      for (const type of PROMOTION_CHOICES) {
        const btn = document.createElement('button');
        btn.textContent = type.toUpperCase();
        btn.addEventListener('click', () => choosePromotion(type));
        picker.appendChild(btn);
      }
      root.appendChild(picker);
    }

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
        pendingPromotion = null;
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
