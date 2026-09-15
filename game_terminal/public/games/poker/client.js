// Texas Hold'em — 2-6 players, fixed blinds (10/20), chip stacks persist hand to hand.
// Server plugin: ../../../server/games/poker.js

import { renderCard } from '../cardCommon.js';

// Mirrors server/games/poker.js's HAND_NAMES (category index -> display name) — duplicated here
// since it's just a tiny display lookup, not game logic that needs to stay authoritative.
const HAND_NAMES = ['High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush'];

export function mount(container, api) {
  let view = null;
  let roster = [];
  let raiseAmount = null;

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
  function nameAt(seatIdx) {
    return nicknameFor(view.seats[seatIdx]);
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

    const mySeat = mySeatIndex();
    const h = view.hand;

    const status = document.createElement('div');
    if (view.phase === 'waiting') {
      status.textContent = `Waiting for players (${view.seats.length}/6 seated, need 2+ to start).`;
    } else if (view.phase === 'playing') {
      status.textContent = `${h.stage.toUpperCase()} — ${nameAt(h.toAct)}${h.toAct === mySeat ? ' (you)' : ''} to act — pot: ${h.potTotal}`;
    } else if (view.phase === 'hand_over') {
      const r = h.lastResult;
      status.textContent = r.kind === 'fold' ? `${nameAt(r.winnerSeat)} wins the pot — everyone else folded.` : 'Showdown!';
    } else if (view.phase === 'game_over') {
      status.textContent = `${nameAt(view.winnerSeat)} WINS — took all the chips!`;
    }
    root.appendChild(status);

    const seatRow = document.createElement('div');
    seatRow.style.display = 'flex';
    seatRow.style.gap = '8px';
    seatRow.style.flexWrap = 'wrap';
    if (mySeat === -1 && view.phase === 'waiting' && view.seats.length < 6) {
      const btn = document.createElement('button');
      btn.textContent = 'SIT DOWN (1000 chips)';
      btn.addEventListener('click', () => api.sendAction({ kind: 'sit' }));
      seatRow.appendChild(btn);
    }
    if (mySeat !== -1 && view.phase === 'waiting') {
      const leaveBtn = document.createElement('button');
      leaveBtn.textContent = 'LEAVE SEAT';
      leaveBtn.addEventListener('click', () => api.sendAction({ kind: 'leaveSeat' }));
      seatRow.appendChild(leaveBtn);
    }
    if (view.phase === 'waiting' && view.seats.length >= 2 && mySeat === 0) {
      const startBtn = document.createElement('button');
      startBtn.textContent = 'START GAME';
      startBtn.addEventListener('click', () => api.sendAction({ kind: 'startGame' }));
      seatRow.appendChild(startBtn);
    }
    root.appendChild(seatRow);

    // Seats around the table: chips, current bet, dealer marker, folded/all-in state.
    const seatsRow = document.createElement('div');
    seatsRow.style.display = 'flex';
    seatsRow.style.gap = '14px';
    seatsRow.style.flexWrap = 'wrap';
    seatsRow.style.justifyContent = 'center';
    view.seats.forEach((clientId, i) => {
      const col = document.createElement('div');
      col.style.display = 'flex';
      col.style.flexDirection = 'column';
      col.style.alignItems = 'center';
      col.style.gap = '2px';
      col.style.padding = '6px';
      col.style.border = h && h.toAct === i && view.phase === 'playing' ? '2px solid #39ff14' : '1px solid transparent';
      col.style.opacity = h && h.folded[i] ? '0.4' : '1';
      const name = document.createElement('div');
      name.textContent = `${i === view.dealerIdx ? '(D) ' : ''}${nicknameFor(clientId)}${clientId === api.getClientId() ? ' (you)' : ''}`;
      name.style.fontSize = '0.85em';
      col.appendChild(name);
      const chips = document.createElement('div');
      chips.textContent = `${view.chips[i]} chips`;
      chips.style.fontSize = '0.8em';
      chips.style.opacity = '0.8';
      col.appendChild(chips);
      if (h) {
        const bet = document.createElement('div');
        bet.textContent = h.folded[i] ? 'folded' : h.allIn[i] ? 'ALL IN' : h.bets[i] > 0 ? `bet ${h.bets[i]}` : '';
        bet.style.fontSize = '0.75em';
        bet.style.color = '#ffb000';
        col.appendChild(bet);
      }
      seatsRow.appendChild(col);
    });
    root.appendChild(seatsRow);

    if (h && (view.phase === 'playing' || view.phase === 'hand_over')) {
      const table = document.createElement('div');
      table.style.display = 'flex';
      table.style.flexDirection = 'column';
      table.style.alignItems = 'center';
      table.style.gap = '6px';
      const communityRow = document.createElement('div');
      communityRow.style.display = 'flex';
      communityRow.style.gap = '4px';
      for (const card of h.community) communityRow.appendChild(renderCard(card));
      for (let i = h.community.length; i < 5; i++) communityRow.appendChild(renderCard(null, { faceDown: true }));
      table.appendChild(communityRow);
      const potLabel = document.createElement('div');
      potLabel.textContent = `Pot: ${h.potTotal}`;
      potLabel.style.opacity = '0.8';
      table.appendChild(potLabel);
      root.appendChild(table);
    }

    if (view.phase === 'hand_over' && h.lastResult.kind === 'showdown') {
      const reveal = document.createElement('div');
      reveal.style.display = 'flex';
      reveal.style.flexDirection = 'column';
      reveal.style.alignItems = 'center';
      reveal.style.gap = '4px';
      for (const entry of h.lastResult.revealedHands) {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.gap = '6px';
        const label = document.createElement('span');
        const won = h.lastResult.payouts[entry.seat] > 0;
        label.textContent = `${nameAt(entry.seat)}${won ? ' 🏆' : ''}: ${HAND_NAMES[entry.best[0]]}`;
        label.style.fontWeight = won ? 'bold' : 'normal';
        row.appendChild(label);
        for (const card of entry.cards) row.appendChild(renderCard(card, { small: true }));
        reveal.appendChild(row);
      }
      root.appendChild(reveal);
    }

    if (mySeat !== -1 && h && h.myHoleCards && h.myHoleCards.length && view.phase !== 'waiting') {
      const holeLabel = document.createElement('div');
      holeLabel.textContent = 'Your hand:';
      holeLabel.style.fontSize = '0.8em';
      root.appendChild(holeLabel);
      const holeRow = document.createElement('div');
      holeRow.style.display = 'flex';
      holeRow.style.gap = '4px';
      for (const card of h.myHoleCards) holeRow.appendChild(renderCard(card));
      root.appendChild(holeRow);
    }

    if (view.phase === 'playing' && h.toAct === mySeat) {
      const toCall = h.currentBet - h.bets[mySeat];
      const myStack = view.chips[mySeat];
      const maxRaiseTo = h.bets[mySeat] + myStack;
      const minRaiseTo = Math.min(h.currentBet + 20, maxRaiseTo);
      if (raiseAmount === null) raiseAmount = minRaiseTo;

      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.gap = '8px';
      actions.style.alignItems = 'center';
      actions.style.flexWrap = 'wrap';

      const foldBtn = document.createElement('button');
      foldBtn.textContent = 'FOLD';
      foldBtn.addEventListener('click', () => api.sendAction({ kind: 'fold' }));
      actions.appendChild(foldBtn);

      const callBtn = document.createElement('button');
      callBtn.textContent = toCall <= 0 ? 'CHECK' : `CALL ${toCall}`;
      callBtn.addEventListener('click', () => api.sendAction({ kind: toCall <= 0 ? 'check' : 'call' }));
      actions.appendChild(callBtn);

      if (maxRaiseTo > h.currentBet) {
        const raiseInput = document.createElement('input');
        raiseInput.type = 'range';
        raiseInput.min = String(minRaiseTo);
        raiseInput.max = String(maxRaiseTo);
        raiseInput.value = String(Math.min(raiseAmount, maxRaiseTo));
        raiseInput.addEventListener('input', () => {
          raiseAmount = Number(raiseInput.value);
          amountLabel.textContent = String(raiseAmount);
        });
        actions.appendChild(raiseInput);
        const amountLabel = document.createElement('span');
        amountLabel.textContent = String(Math.min(raiseAmount, maxRaiseTo));
        actions.appendChild(amountLabel);
        const raiseBtn = document.createElement('button');
        raiseBtn.textContent = raiseAmount >= maxRaiseTo ? 'ALL IN' : 'RAISE TO';
        raiseBtn.addEventListener('click', () => {
          api.sendAction({ kind: 'raise', amount: raiseAmount });
          raiseAmount = null;
        });
        actions.appendChild(raiseBtn);
      }
      root.appendChild(actions);
    } else {
      raiseAmount = null;
    }

    if (view.phase === 'hand_over') {
      const nextBtn = document.createElement('button');
      nextBtn.textContent = 'NEXT HAND';
      nextBtn.addEventListener('click', () => api.sendAction({ kind: 'nextHand' }));
      root.appendChild(nextBtn);
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
