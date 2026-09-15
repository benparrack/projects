// War — 2 players, no decisions to make: click FLIP each round, higher card takes the pile,
// ties trigger a "war" (both burn a card, flip again). Server plugin: ../../../server/games/war.js

import { renderCard } from '../cardCommon.js';

export function mount(container, api) {
  let view = null;
  let roster = [];

  const root = document.createElement('div');
  root.style.display = 'flex';
  root.style.flexDirection = 'column';
  root.style.gap = '10px';
  root.style.alignItems = 'center';
  container.appendChild(root);

  function nicknameFor(clientId) {
    const entry = roster.find((r) => r.clientId === clientId);
    return entry ? entry.nickname : 'someone';
  }

  function mySeatIndex() {
    if (!view) return -1;
    return view.seats.indexOf(api.getClientId());
  }

  function render() {
    root.innerHTML = '';
    if (!view) {
      root.textContent = 'Loading...';
      return;
    }

    const status = document.createElement('div');
    if (view.phase === 'waiting') {
      status.textContent = `Waiting for a second player (${view.seats.length}/2 seated).`;
    } else if (view.phase === 'playing') {
      status.textContent = 'Click FLIP to play your top card.';
    } else if (view.phase === 'game_over') {
      const winnerName = nicknameFor(view.seats[view.winnerSeat]);
      status.textContent = `${winnerName} WINS THE WHOLE DECK!`;
    }
    root.appendChild(status);

    const seatRow = document.createElement('div');
    seatRow.style.display = 'flex';
    seatRow.style.gap = '12px';
    const mySeat = mySeatIndex();
    if (mySeat === -1 && view.seats.length < 2 && view.phase === 'waiting') {
      const btn = document.createElement('button');
      btn.textContent = 'SIT DOWN';
      btn.addEventListener('click', () => api.sendAction({ kind: 'sit' }));
      seatRow.appendChild(btn);
    }
    if (mySeat !== -1) {
      const leaveBtn = document.createElement('button');
      leaveBtn.textContent = 'LEAVE SEAT';
      leaveBtn.addEventListener('click', () => api.sendAction({ kind: 'leaveSeat' }));
      seatRow.appendChild(leaveBtn);
    }
    root.appendChild(seatRow);

    if (view.seats.length > 0) {
      const table = document.createElement('div');
      table.style.display = 'flex';
      table.style.gap = '40px';
      table.style.alignItems = 'center';
      table.style.justifyContent = 'center';
      view.seats.forEach((clientId, i) => {
        const col = document.createElement('div');
        col.style.display = 'flex';
        col.style.flexDirection = 'column';
        col.style.alignItems = 'center';
        col.style.gap = '6px';
        const name = document.createElement('div');
        name.textContent = `${nicknameFor(clientId)}${clientId === api.getClientId() ? ' (you)' : ''} — ${view.handCounts[i]} cards`;
        col.appendChild(name);
        col.appendChild(renderCard(view.pendingFlips[i], { faceDown: !view.pendingFlips[i] }));
        if (i === mySeat && view.phase === 'playing' && !view.pendingFlips[i]) {
          const flipBtn = document.createElement('button');
          flipBtn.textContent = 'FLIP';
          flipBtn.addEventListener('click', () => api.sendAction({ kind: 'flip' }));
          col.appendChild(flipBtn);
        }
        table.appendChild(col);
      });
      root.appendChild(table);
    }

    if (view.potSize > 0) {
      const pot = document.createElement('div');
      pot.textContent = `Pot: ${view.potSize} card${view.potSize === 1 ? '' : 's'}`;
      pot.style.opacity = '0.8';
      root.appendChild(pot);
    }

    if (view.lastResult) {
      const result = document.createElement('div');
      if (view.lastResult.kind === 'war') {
        result.textContent = 'WAR! Each side burns a card — flip again.';
      } else if (view.lastResult.kind === 'roundWin') {
        result.textContent = `${nicknameFor(view.seats[view.lastResult.winnerIdx])} takes the pile (${view.lastResult.cardsWon} cards).`;
      } else if (view.lastResult.kind === 'outOfCards') {
        result.textContent = `${nicknameFor(view.seats[view.lastResult.loserIdx])} ran out of cards!`;
      }
      result.style.color = '#39ff14';
      root.appendChild(result);
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
      if (data && data.kind === 'state') {
        view = data;
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
