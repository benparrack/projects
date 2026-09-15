// Crazy Eights — 2-6 players. Click a card in your hand to play it (an 8 prompts for a suit);
// DRAW if you have nothing playable, then PLAY the drawn card or PASS.
// Server plugin: ../../../server/games/crazyeights.js

import { renderCard, SUIT_GLYPH } from '../cardCommon.js';

const SUITS = ['S', 'H', 'D', 'C'];

export function mount(container, api) {
  let view = null;
  let roster = [];
  let pendingEightIndex = null; // index into hand awaiting a suit choice

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

  function isPlayable(card) {
    return card.rank === '8' || card.rank === view.topCard.rank || card.suit === view.currentSuit;
  }

  function playCard(index, declaredSuit) {
    api.sendAction({ kind: 'play', cardIndex: index, declaredSuit });
    pendingEightIndex = null;
  }

  function render() {
    root.innerHTML = '';
    if (!view) {
      root.textContent = 'Loading...';
      return;
    }

    const mySeat = mySeatIndex();
    const status = document.createElement('div');
    if (view.phase === 'waiting') {
      status.textContent = `Waiting for players (${view.seats.length}/6 seated, need 2+ to start).`;
    } else if (view.phase === 'playing') {
      const turnName = nicknameFor(view.seats[view.turnIdx]);
      status.textContent = `Turn: ${turnName}${view.turnIdx === mySeat ? ' (you)' : ''} — current suit: ${SUIT_GLYPH[view.currentSuit]}`;
    } else if (view.phase === 'game_over') {
      status.textContent = `${nicknameFor(view.seats[view.winnerSeat])} WINS — hand emptied!`;
    }
    root.appendChild(status);

    const seatRow = document.createElement('div');
    seatRow.style.display = 'flex';
    seatRow.style.gap = '8px';
    seatRow.style.flexWrap = 'wrap';
    if (mySeat === -1 && view.phase === 'waiting' && view.seats.length < 6) {
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
    if (view.phase === 'waiting' && view.seats.length >= 2 && mySeat === 0) {
      const startBtn = document.createElement('button');
      startBtn.textContent = 'START GAME';
      startBtn.addEventListener('click', () => api.sendAction({ kind: 'startGame' }));
      seatRow.appendChild(startBtn);
    }
    root.appendChild(seatRow);

    // Other players' seat list with live hand counts.
    const players = document.createElement('div');
    players.style.display = 'flex';
    players.style.gap = '14px';
    players.style.fontSize = '0.85em';
    view.seats.forEach((clientId, i) => {
      const tag = document.createElement('div');
      const isTurn = view.phase === 'playing' && i === view.turnIdx;
      tag.textContent = `${nicknameFor(clientId)}${clientId === api.getClientId() ? ' (you)' : ''}: ${view.handCounts[i]}${isTurn ? ' ← turn' : ''}`;
      tag.style.opacity = isTurn ? '1' : '0.7';
      tag.style.fontWeight = isTurn ? 'bold' : 'normal';
      players.appendChild(tag);
    });
    root.appendChild(players);

    if (view.phase === 'playing' || view.phase === 'game_over') {
      const table = document.createElement('div');
      table.style.display = 'flex';
      table.style.gap = '16px';
      table.style.alignItems = 'center';

      const drawStack = document.createElement('div');
      drawStack.style.display = 'flex';
      drawStack.style.flexDirection = 'column';
      drawStack.style.alignItems = 'center';
      drawStack.style.gap = '4px';
      drawStack.appendChild(renderCard(null, { faceDown: true }));
      const drawLabel = document.createElement('div');
      drawLabel.textContent = `Draw pile: ${view.drawPileSize}`;
      drawLabel.style.fontSize = '0.75em';
      drawStack.appendChild(drawLabel);
      table.appendChild(drawStack);

      if (view.topCard) {
        const discardCol = document.createElement('div');
        discardCol.style.display = 'flex';
        discardCol.style.flexDirection = 'column';
        discardCol.style.alignItems = 'center';
        discardCol.style.gap = '4px';
        discardCol.appendChild(renderCard(view.topCard));
        const suitLabel = document.createElement('div');
        suitLabel.textContent = `Suit to match: ${SUIT_GLYPH[view.currentSuit]}`;
        suitLabel.style.fontSize = '0.75em';
        discardCol.appendChild(suitLabel);
        table.appendChild(discardCol);
      }
      root.appendChild(table);
    }

    if (view.lastAction) {
      const la = view.lastAction;
      const name = nicknameFor(view.seats[la.seatIdx]);
      const msg = document.createElement('div');
      msg.style.fontSize = '0.8em';
      msg.style.opacity = '0.8';
      if (la.kind === 'play') msg.textContent = `${name} played ${la.card.rank}${SUIT_GLYPH[la.card.suit]}`;
      else if (la.kind === 'draw') msg.textContent = `${name} drew a card`;
      else if (la.kind === 'pass') msg.textContent = `${name} passed`;
      root.appendChild(msg);
    }

    if (mySeat !== -1 && view.phase === 'playing') {
      const isMyTurn = mySeat === view.turnIdx;
      const handLabel = document.createElement('div');
      handLabel.textContent = 'Your hand:';
      handLabel.style.fontSize = '0.8em';
      root.appendChild(handLabel);

      const hand = document.createElement('div');
      hand.style.display = 'flex';
      hand.style.gap = '4px';
      hand.style.flexWrap = 'wrap';
      hand.style.justifyContent = 'center';
      view.myHand.forEach((card, i) => {
        const wrap = document.createElement('div');
        wrap.style.display = 'flex';
        wrap.style.flexDirection = 'column';
        wrap.style.alignItems = 'center';
        wrap.style.gap = '2px';
        const cardEl = renderCard(card);
        const playable = isMyTurn && isPlayable(card);
        cardEl.style.cursor = playable ? 'pointer' : 'default';
        cardEl.style.opacity = isMyTurn && !playable ? '0.4' : '1';
        cardEl.style.outline = playable ? '2px solid #39ff14' : 'none';
        if (playable) {
          cardEl.addEventListener('click', () => {
            if (card.rank === '8') pendingEightIndex = i;
            else playCard(i);
            render();
          });
        }
        wrap.appendChild(cardEl);
        hand.appendChild(wrap);
      });
      root.appendChild(hand);

      if (pendingEightIndex !== null) {
        const picker = document.createElement('div');
        picker.style.display = 'flex';
        picker.style.gap = '6px';
        picker.style.alignItems = 'center';
        const label = document.createElement('span');
        label.textContent = 'Declare suit:';
        picker.appendChild(label);
        for (const suit of SUITS) {
          const btn = document.createElement('button');
          btn.textContent = SUIT_GLYPH[suit];
          btn.addEventListener('click', () => {
            playCard(pendingEightIndex, suit);
            render();
          });
          picker.appendChild(btn);
        }
        root.appendChild(picker);
      }

      if (isMyTurn) {
        const actions = document.createElement('div');
        actions.style.display = 'flex';
        actions.style.gap = '8px';
        const drawBtn = document.createElement('button');
        drawBtn.textContent = 'DRAW';
        drawBtn.disabled = view.hasDrawnThisTurn;
        drawBtn.addEventListener('click', () => api.sendAction({ kind: 'draw' }));
        actions.appendChild(drawBtn);
        const passBtn = document.createElement('button');
        passBtn.textContent = 'PASS';
        passBtn.disabled = !view.hasDrawnThisTurn;
        passBtn.addEventListener('click', () => api.sendAction({ kind: 'pass' }));
        actions.appendChild(passBtn);
        root.appendChild(actions);
      }
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
