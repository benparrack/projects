// Backgammon — click a remaining die to arm it (auto-armed when only one distinct value is
// left), then click a source point (or the bar pile) to play that die from there. The server is
// the sole legality authority (no client-side legal-move mirror here, unlike checkers/connect4 —
// backgammon's bear-off/blocking rules are involved enough that duplicating them client-side
// risked drifting out of sync); an illegal attempt gets a rejection flash instead of a preview.

const POINT_W = 46;
const POINT_H = 150;
const DISC = 30;

// Layout: top row left->right is 13..18 | (bar) | 19..24 (Black's home on the right);
// bottom row left->right is 12..7 | (bar) | 6..1 (White's home on the right).
const TOP_LEFT = [13, 14, 15, 16, 17, 18];
const TOP_RIGHT = [19, 20, 21, 22, 23, 24];
const BOTTOM_LEFT = [12, 11, 10, 9, 8, 7];
const BOTTOM_RIGHT = [6, 5, 4, 3, 2, 1];

function opponentColor(color) {
  return color === 'white' ? 'black' : 'white';
}

export function mount(container, api) {
  let view = null;
  let roster = [];
  let armedDie = null;
  let flashError = null;

  const root = document.createElement('div');
  root.style.display = 'flex';
  root.style.flexDirection = 'column';
  root.style.gap = '10px';
  root.style.alignItems = 'center';
  root.style.fontFamily = 'inherit';
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

  function remainingDice() {
    return view ? view.dice : [];
  }

  function uniqueRemainingDice() {
    return [...new Set(remainingDice())];
  }

  function effectiveArmedDie() {
    const uniq = uniqueRemainingDice();
    if (uniq.length === 1) return uniq[0]; // only one distinct value left — no need to click it
    return armedDie;
  }

  function playFrom(from) {
    const seat = mySeat();
    if (!seat || view.phase !== 'playing' || view.turn !== seat) return;
    const die = effectiveArmedDie();
    if (die == null) return;
    api.sendAction({ kind: 'move', from, die });
    armedDie = null;
  }

  function discEl(color) {
    const d = document.createElement('div');
    d.style.width = `${DISC}px`;
    d.style.height = `${DISC}px`;
    d.style.borderRadius = '50%';
    d.style.boxSizing = 'border-box';
    d.style.flexShrink = '0';
    if (color === 'black') {
      d.style.background = '#1a1a1a';
      d.style.border = '2px solid #999';
    } else {
      d.style.background = '#f2f2f2';
      d.style.border = '2px solid #999';
    }
    return d;
  }

  function renderPoint(pointNum, faceUp) {
    const cell = document.createElement('div');
    cell.dataset.point = String(pointNum);
    cell.style.width = `${POINT_W}px`;
    cell.style.height = `${POINT_H}px`;
    cell.style.display = 'flex';
    cell.style.flexDirection = faceUp ? 'column' : 'column-reverse';
    cell.style.alignItems = 'center';
    cell.style.gap = '2px';
    cell.style.padding = '4px 2px';
    cell.style.boxSizing = 'border-box';
    cell.style.background = pointNum % 2 === 0 ? '#1c1c1c' : '#141414';
    cell.style.border = '1px solid #2a2a2a';
    cell.style.position = 'relative';

    const pt = view.points[pointNum];
    const seat = mySeat();
    const isMine = seat && pt && pt.color === seat && view.phase === 'playing' && view.turn === seat;
    if (isMine) {
      cell.style.cursor = 'pointer';
      cell.addEventListener('click', () => playFrom(pointNum));
    }

    const label = document.createElement('div');
    label.textContent = String(pointNum);
    label.style.fontSize = '9px';
    label.style.opacity = '0.5';
    label.style.position = 'absolute';
    label.style[faceUp ? 'top' : 'bottom'] = '2px';
    cell.appendChild(label);

    if (pt && pt.count > 0) {
      const shown = Math.min(pt.count, 5);
      for (let i = 0; i < shown; i++) cell.appendChild(discEl(pt.color));
      if (pt.count > 5) {
        const more = document.createElement('div');
        more.textContent = `+${pt.count - 5}`;
        more.style.fontSize = '11px';
        more.style.color = '#ffb000';
        cell.appendChild(more);
      }
    }
    return cell;
  }

  function renderBarPile(color) {
    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.alignItems = 'center';
    wrap.style.gap = '4px';
    wrap.style.width = `${POINT_W}px`;
    const count = view.bar[color];
    const label = document.createElement('div');
    label.textContent = `BAR (${count})`;
    label.style.fontSize = '10px';
    label.style.opacity = '0.7';
    wrap.appendChild(label);
    if (count > 0) {
      const seat = mySeat();
      if (seat === color && view.phase === 'playing' && view.turn === seat) {
        wrap.style.cursor = 'pointer';
        wrap.addEventListener('click', () => playFrom('bar'));
      }
      wrap.appendChild(discEl(color));
    }
    return wrap;
  }

  function render() {
    root.innerHTML = '';
    if (!view) {
      root.textContent = 'Loading...';
      return;
    }

    const seat = mySeat();

    const status = document.createElement('div');
    status.style.fontSize = '16px';
    status.style.fontWeight = 'bold';
    if (view.phase === 'waiting') {
      status.textContent = 'Waiting for both seats to be filled.';
    } else if (view.phase === 'playing') {
      const turnName = nicknameFor(view.players[view.turn]) || view.turn;
      status.textContent = `Turn: ${view.turn.toUpperCase()} (${turnName})`;
    } else if (view.phase === 'game_over') {
      status.textContent = `${view.winner.toUpperCase()} WINS!`;
    }
    root.appendChild(status);

    if (flashError) {
      const err = document.createElement('div');
      err.textContent = `Illegal move${flashError !== true ? ` (${flashError})` : ''}`;
      err.style.color = '#ff4d4d';
      root.appendChild(err);
    }

    const seatRow = document.createElement('div');
    seatRow.style.display = 'flex';
    seatRow.style.gap = '12px';
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
    }
    root.appendChild(seatRow);

    if (view.phase === 'playing') {
      const diceRow = document.createElement('div');
      diceRow.style.display = 'flex';
      diceRow.style.gap = '8px';
      diceRow.style.alignItems = 'center';

      const rollLabel = document.createElement('div');
      rollLabel.style.fontSize = '12px';
      rollLabel.style.opacity = '0.8';
      rollLabel.textContent = view.lastRoll.length ? `Rolled: ${view.lastRoll.join('-')}` : '';
      diceRow.appendChild(rollLabel);

      if (view.dice.length === 0 && seat === view.turn) {
        const rollBtn = document.createElement('button');
        rollBtn.textContent = 'ROLL DICE';
        rollBtn.addEventListener('click', () => api.sendAction({ kind: 'rollDice' }));
        diceRow.appendChild(rollBtn);
      } else {
        const uniq = uniqueRemainingDice();
        for (const d of view.dice) {
          const pill = document.createElement('button');
          pill.textContent = String(d);
          pill.disabled = seat !== view.turn;
          const isArmed = uniq.length === 1 || armedDie === d;
          pill.style.background = isArmed ? '#ffb000' : '';
          pill.style.color = isArmed ? '#000' : '';
          pill.addEventListener('click', () => {
            if (uniq.length > 1) {
              armedDie = armedDie === d ? null : d;
              render();
            }
          });
          diceRow.appendChild(pill);
        }
      }
      root.appendChild(diceRow);
    }

    const board = document.createElement('div');
    board.style.display = 'flex';
    board.style.flexDirection = 'column';
    board.style.border = '2px solid #1f8f0c';

    function makeRow(leftPoints, rightPoints, faceUp) {
      const row = document.createElement('div');
      row.style.display = 'flex';
      for (const p of leftPoints) row.appendChild(renderPoint(p, faceUp));
      const barCol = document.createElement('div');
      barCol.style.display = 'flex';
      barCol.style.alignItems = 'center';
      barCol.style.justifyContent = 'center';
      barCol.style.width = '36px';
      barCol.style.background = '#0a0a0a';
      barCol.style.borderLeft = '1px solid #2a2a2a';
      barCol.style.borderRight = '1px solid #2a2a2a';
      if (faceUp) barCol.appendChild(renderBarPile('black'));
      else barCol.appendChild(renderBarPile('white'));
      row.appendChild(barCol);
      for (const p of rightPoints) row.appendChild(renderPoint(p, faceUp));
      return row;
    }

    board.appendChild(makeRow(TOP_LEFT, TOP_RIGHT, true));
    const mid = document.createElement('div');
    mid.style.height = '10px';
    board.appendChild(mid);
    board.appendChild(makeRow(BOTTOM_LEFT, BOTTOM_RIGHT, false));
    root.appendChild(board);

    const offRow = document.createElement('div');
    offRow.style.display = 'flex';
    offRow.style.gap = '16px';
    offRow.style.fontSize = '13px';
    offRow.textContent = '';
    const whiteOff = document.createElement('div');
    whiteOff.textContent = `WHITE borne off: ${view.borneOff.white}/15`;
    const blackOff = document.createElement('div');
    blackOff.textContent = `BLACK borne off: ${view.borneOff.black}/15`;
    offRow.appendChild(whiteOff);
    offRow.appendChild(blackOff);
    root.appendChild(offRow);

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
        flashError = null;
        armedDie = null;
        render();
      } else if (data.kind === 'moveRejected') {
        flashError = data.reason || true;
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
