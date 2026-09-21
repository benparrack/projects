// Hearts — 4 players, no trump. Sit in a seat, then once full START GAME. Each hand (unless
// it's a "no pass" hand) pick 3 cards to pass; then play by clicking a legal card on your turn.
// Server plugin: ../../../server/games/hearts.js

import { renderCard, SUIT_GLYPH } from '../cardCommon.js';

const SEAT_LABELS = ['NORTH', 'EAST', 'SOUTH', 'WEST'];

export function mount(container, api) {
  let view = null;
  let roster = [];
  let selectedForPass = []; // indices into myHand, up to 3

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

  function mySeatIndex() {
    if (!view) return -1;
    return view.seats.indexOf(api.getClientId());
  }

  function isLegalCard(card) {
    if (!view.legalCardsHint) return true;
    return view.legalCardsHint.some((c) => c.suit === card.suit && c.rank === card.rank);
  }

  function togglePassSelect(idx) {
    const pos = selectedForPass.indexOf(idx);
    if (pos !== -1) {
      selectedForPass.splice(pos, 1);
    } else if (selectedForPass.length < 3) {
      selectedForPass.push(idx);
    }
    render();
  }

  function submitPass() {
    if (selectedForPass.length !== 3) return;
    api.sendAction({ kind: 'submitPass', cardIndices: selectedForPass });
    selectedForPass = [];
  }

  function render() {
    root.innerHTML = '';
    if (!view) {
      root.textContent = 'Loading...';
      return;
    }

    const mySeat = mySeatIndex();

    const status = document.createElement('div');
    status.style.fontSize = '18px';
    status.style.fontWeight = 'bold';
    if (view.phase === 'waiting') {
      status.textContent = `Waiting for players (${view.seats.filter(Boolean).length}/4 seated).`;
    } else if (view.phase === 'passing') {
      status.textContent = `Passing ${view.passDirection.toUpperCase()} — pick 3 cards to pass.`;
    } else if (view.phase === 'playing') {
      const turnName = nicknameFor(view.seats[view.turnSeat]);
      status.textContent = `${view.currentTrick.length === 0 ? 'Leading' : 'Turn'}: ${turnName}${view.turnSeat === mySeat ? ' (you)' : ''}`;
    } else if (view.phase === 'hand_over') {
      status.textContent = view.moonShooterSeat != null
        ? `${nicknameFor(view.seats[view.moonShooterSeat])} SHOT THE MOON!`
        : 'Hand over.';
    } else if (view.phase === 'game_over') {
      status.textContent = `${nicknameFor(view.seats[view.winnerSeat])} WINS with the lowest score!`;
    }
    root.appendChild(status);

    // Seats
    const seatRow = document.createElement('div');
    seatRow.style.display = 'flex';
    seatRow.style.gap = '10px';
    seatRow.style.flexWrap = 'wrap';
    seatRow.style.justifyContent = 'center';
    view.seats.forEach((clientId, i) => {
      const box = document.createElement('div');
      box.style.border = '1px solid #444';
      box.style.borderRadius = '6px';
      box.style.padding = '6px 10px';
      box.style.minWidth = '110px';
      box.style.textAlign = 'center';
      box.dataset.seat = String(i);
      const isTurn = view.phase === 'playing' && i === view.turnSeat;
      box.style.outline = isTurn ? '2px solid #39ff14' : 'none';

      const label = document.createElement('div');
      label.style.fontSize = '0.7em';
      label.style.opacity = '0.6';
      label.textContent = SEAT_LABELS[i];
      box.appendChild(label);

      if (clientId) {
        const name = document.createElement('div');
        name.textContent = `${nicknameFor(clientId)}${clientId === api.getClientId() ? ' (you)' : ''}`;
        box.appendChild(name);
        const score = document.createElement('div');
        score.style.fontSize = '0.8em';
        score.style.opacity = '0.8';
        score.textContent = `Score: ${view.scores[i]}${view.phase !== 'waiting' ? ` · cards: ${view.handCounts[i]}` : ''}`;
        box.appendChild(score);
        if (view.phase === 'passing') {
          const pass = document.createElement('div');
          pass.style.fontSize = '0.75em';
          pass.style.color = view.passSubmittedSeats[i] ? '#39ff14' : '#888';
          pass.textContent = view.passSubmittedSeats[i] ? 'passed' : 'choosing...';
          box.appendChild(pass);
        }
      } else if (mySeat === -1 && view.phase === 'waiting') {
        const btn = document.createElement('button');
        btn.textContent = 'SIT';
        btn.addEventListener('click', () => api.sendAction({ kind: 'sit', seatIdx: i }));
        box.appendChild(btn);
      } else {
        const empty = document.createElement('div');
        empty.style.opacity = '0.4';
        empty.textContent = '(empty)';
        box.appendChild(empty);
      }
      seatRow.appendChild(box);
    });
    root.appendChild(seatRow);

    const controls = document.createElement('div');
    controls.style.display = 'flex';
    controls.style.gap = '8px';
    if (mySeat !== -1 && view.phase === 'waiting') {
      const leaveBtn = document.createElement('button');
      leaveBtn.textContent = 'LEAVE SEAT';
      leaveBtn.addEventListener('click', () => api.sendAction({ kind: 'leaveSeat' }));
      controls.appendChild(leaveBtn);
    }
    if (view.phase === 'waiting' && view.seats.every(Boolean) && mySeat === 0) {
      const startBtn = document.createElement('button');
      startBtn.textContent = 'START GAME';
      startBtn.addEventListener('click', () => api.sendAction({ kind: 'startGame' }));
      controls.appendChild(startBtn);
    }
    if (controls.children.length) root.appendChild(controls);

    // Current trick
    if (view.phase === 'playing' || view.phase === 'hand_over') {
      const trickRow = document.createElement('div');
      trickRow.style.display = 'flex';
      trickRow.style.gap = '10px';
      trickRow.style.alignItems = 'center';
      const trickLabel = document.createElement('div');
      trickLabel.style.fontSize = '0.75em';
      trickLabel.style.opacity = '0.7';
      trickLabel.textContent = 'Trick:';
      trickRow.appendChild(trickLabel);
      for (const entry of view.currentTrick) {
        const col = document.createElement('div');
        col.style.display = 'flex';
        col.style.flexDirection = 'column';
        col.style.alignItems = 'center';
        col.appendChild(renderCard(entry.card, { small: true }));
        const who = document.createElement('div');
        who.style.fontSize = '0.65em';
        who.textContent = SEAT_LABELS[entry.seatIdx];
        col.appendChild(who);
        trickRow.appendChild(col);
      }
      root.appendChild(trickRow);

      if (view.lastTrick) {
        const last = document.createElement('div');
        last.style.fontSize = '0.75em';
        last.style.opacity = '0.7';
        last.textContent = `Last trick won by ${nicknameFor(view.seats[view.lastTrickWinnerSeat])}`;
        root.appendChild(last);
      }
    }

    if (view.phase === 'hand_over' && view.handScores) {
      const summary = document.createElement('div');
      summary.style.fontSize = '0.8em';
      summary.textContent = `Hand points: ${view.handScores.map((p, i) => `${SEAT_LABELS[i]} +${p}`).join('  ')}`;
      root.appendChild(summary);

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

    // My hand
    if (mySeat !== -1 && (view.phase === 'passing' || view.phase === 'playing')) {
      const handLabel = document.createElement('div');
      handLabel.style.fontSize = '0.8em';
      handLabel.textContent = view.phase === 'passing' ? 'Pick 3 cards to pass:' : 'Your hand:';
      root.appendChild(handLabel);

      const hand = document.createElement('div');
      hand.style.display = 'flex';
      hand.style.gap = '4px';
      hand.style.flexWrap = 'wrap';
      hand.style.justifyContent = 'center';

      const isMyTurn = view.phase === 'playing' && view.turnSeat === mySeat;
      view.myHand.forEach((card, i) => {
        const wrap = document.createElement('div');
        wrap.style.display = 'flex';
        wrap.style.flexDirection = 'column';
        wrap.style.alignItems = 'center';
        const cardEl = renderCard(card);
        if (view.phase === 'passing' && !view.myPassSubmitted) {
          const selected = selectedForPass.includes(i);
          cardEl.style.cursor = 'pointer';
          cardEl.style.outline = selected ? '2px solid #39ff14' : 'none';
          cardEl.addEventListener('click', () => togglePassSelect(i));
        } else if (view.phase === 'playing') {
          const legal = isMyTurn && isLegalCard(card);
          cardEl.style.cursor = legal ? 'pointer' : 'default';
          cardEl.style.opacity = isMyTurn && !legal ? '0.4' : '1';
          cardEl.style.outline = legal ? '2px solid #39ff14' : 'none';
          if (legal) cardEl.addEventListener('click', () => api.sendAction({ kind: 'play', cardIndex: i }));
        }
        wrap.appendChild(cardEl);
        hand.appendChild(wrap);
      });
      root.appendChild(hand);

      if (view.phase === 'passing' && !view.myPassSubmitted) {
        const passBtn = document.createElement('button');
        passBtn.textContent = `PASS (${selectedForPass.length}/3)`;
        passBtn.disabled = selectedForPass.length !== 3;
        passBtn.addEventListener('click', submitPass);
        root.appendChild(passBtn);
      } else if (view.phase === 'passing' && view.myPassSubmitted) {
        const waiting = document.createElement('div');
        waiting.style.fontSize = '0.75em';
        waiting.style.opacity = '0.7';
        waiting.textContent = 'Waiting for other players to pass...';
        root.appendChild(waiting);
      }
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
