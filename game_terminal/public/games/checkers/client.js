// Checkers — click a piece, then click a destination square. Server validates and
// enforces mandatory captures / multi-jump; illegal attempts get a rejection flash.

const CELL = 44;

export function mount(container, api) {
  let view = null;
  let roster = [];
  let selected = null;
  let flashError = false;

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
    }
    root.appendChild(seatRow);

    const board = document.createElement('div');
    board.style.display = 'grid';
    board.style.gridTemplateColumns = `repeat(8, ${CELL}px)`;
    board.style.gridTemplateRows = `repeat(8, ${CELL}px)`;
    board.style.border = '1px solid #1f8f0c';

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const cell = document.createElement('div');
        cell.dataset.row = String(r);
        cell.dataset.col = String(c);
        const dark = (r + c) % 2 === 1;
        cell.style.width = `${CELL}px`;
        cell.style.height = `${CELL}px`;
        cell.style.background = dark ? '#2a2a2a' : '#0a0a0a';
        cell.style.display = 'flex';
        cell.style.alignItems = 'center';
        cell.style.justifyContent = 'center';
        cell.style.boxSizing = 'border-box';
        if (selected && selected.r === r && selected.c === c) {
          cell.style.border = '2px solid #ffb000';
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
            disc.style.background = piece.color === 'red' ? '#ff4d4d' : '#ffb000';
            disc.style.display = 'flex';
            disc.style.alignItems = 'center';
            disc.style.justifyContent = 'center';
            disc.style.color = '#000';
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
