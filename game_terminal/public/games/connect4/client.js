// Connect 4 — click a column's drop button to play there; gravity and win/draw detection are
// server-authoritative. Board cells are purely visual (plus data-row/data-col for automated
// testing, per this hub's grid-game convention) — the drop buttons above the board are what's
// clickable, matching the classic "click a column" interaction.

const CELL = 50;
const COLS = 7;
const ROWS = 6;

export function mount(container, api) {
  let view = null;
  let roster = [];
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
    if (view.players.yellow === me) return 'yellow';
    return null;
  }

  function onColumnClick(col) {
    const seat = mySeat();
    if (!seat || view.phase !== 'playing' || view.turn !== seat) return;
    api.sendAction({ kind: 'move', col });
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
      status.textContent = `Turn: ${view.turn.toUpperCase()} (${turnName})`;
    } else if (view.phase === 'game_over') {
      status.textContent = view.winner ? `${view.winner.toUpperCase()} WINS!` : "IT'S A DRAW!";
    }
    root.appendChild(status);

    if (flashError) {
      const err = document.createElement('div');
      err.textContent = 'Column is full';
      err.style.color = '#ff4d4d';
      root.appendChild(err);
    }

    const seatRow = document.createElement('div');
    seatRow.style.display = 'flex';
    seatRow.style.gap = '12px';
    const seat = mySeat();

    for (const color of ['red', 'yellow']) {
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

    const boardWrap = document.createElement('div');
    boardWrap.style.display = 'inline-flex';
    boardWrap.style.flexDirection = 'column';
    boardWrap.style.gap = '2px';

    const canDrop = seat && view.phase === 'playing' && view.turn === seat;
    const colRow = document.createElement('div');
    colRow.style.display = 'grid';
    colRow.style.gridTemplateColumns = `repeat(${COLS}, ${CELL}px)`;
    for (let c = 0; c < COLS; c++) {
      const btn = document.createElement('button');
      btn.textContent = '↓';
      btn.dataset.col = String(c);
      btn.style.width = `${CELL}px`;
      btn.disabled = !canDrop || view.board[0][c] !== null;
      btn.addEventListener('click', () => onColumnClick(c));
      colRow.appendChild(btn);
    }
    boardWrap.appendChild(colRow);

    const board = document.createElement('div');
    board.style.display = 'grid';
    board.style.gridTemplateColumns = `repeat(${COLS}, ${CELL}px)`;
    board.style.gridTemplateRows = `repeat(${ROWS}, ${CELL}px)`;
    board.style.background = '#0a2a5e';
    board.style.border = '1px solid #1f8f0c';
    board.style.gap = '4px';
    board.style.padding = '4px';
    board.style.boxSizing = 'content-box';

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = document.createElement('div');
        cell.dataset.row = String(r);
        cell.dataset.col = String(c);
        cell.style.width = `${CELL - 4}px`;
        cell.style.height = `${CELL - 4}px`;
        cell.style.borderRadius = '50%';
        cell.style.boxSizing = 'border-box';
        const piece = view.board[r][c];
        if (piece === 'red') cell.style.background = '#ff4d4d';
        else if (piece === 'yellow') cell.style.background = '#ffee58';
        else cell.style.background = '#05080a';
        if (view.lastMove && view.lastMove.r === r && view.lastMove.c === c) {
          cell.style.boxShadow = '0 0 0 3px #39ff14 inset';
        }
        board.appendChild(cell);
      }
    }
    boardWrap.appendChild(board);
    root.appendChild(boardWrap);

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
