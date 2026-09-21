// Spades — 4 seats, fixed partnerships (NORTH+SOUTH = seats 0&2 vs EAST+WEST = seats 1&3).
// Bid 0-13 (0 = NIL) when it's your turn during bidding, then click a card in your hand to play
// it on your turn. Server plugin: ../../../server/games/spades.js
// Legal-card highlighting below mirrors the server's `legalCardIndices` by hand (no shared
// module in this repo — same pattern as e.g. slither's client-side `computeZoom`).

import { renderCard, SUIT_GLYPH } from '../cardCommon.js';

const SEAT_LABELS = ['NORTH', 'EAST', 'SOUTH', 'WEST'];
const RANK_ORDER = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUIT_ORDER = ['S', 'H', 'D', 'C'];

function rankValue(rank) {
  return RANK_ORDER.indexOf(rank);
}

function legalCardIndices(hand, currentTrick, spadesBroken) {
  if (currentTrick.length === 0) {
    if (spadesBroken) return hand.map((_, i) => i);
    const nonSpades = hand.map((c, i) => (c.suit !== 'S' ? i : -1)).filter((i) => i !== -1);
    return nonSpades.length > 0 ? nonSpades : hand.map((_, i) => i);
  }
  const ledSuit = currentTrick[0].card.suit;
  const matching = hand.map((c, i) => (c.suit === ledSuit ? i : -1)).filter((i) => i !== -1);
  return matching.length > 0 ? matching : hand.map((_, i) => i);
}

export function mount(container, api) {
  let view = null;
  let roster = [];
  let lastReject = null;

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

  function render() {
    root.innerHTML = '';
    if (!view) {
      root.textContent = 'Loading...';
      return;
    }

    const mySeat = view.mySeat;

    const status = document.createElement('div');
    status.style.fontSize = '16px';
    status.style.fontWeight = 'bold';
    if (view.phase === 'waiting') {
      const seated = view.seats.filter(Boolean).length;
      status.textContent = `Waiting for players (${seated}/4 seated).`;
    } else if (view.phase === 'bidding') {
      const name = nicknameFor(view.seats[view.biddingTurnIdx]);
      status.textContent = `Bidding — ${name}${view.biddingTurnIdx === mySeat ? ' (you)' : ''} to bid.`;
    } else if (view.phase === 'playing') {
      const name = nicknameFor(view.seats[view.turnIdx]);
      status.textContent = `Hand ${view.handNumber} — ${name}${view.turnIdx === mySeat ? ' (you)' : ''} to play${view.spadesBroken ? ' (spades broken)' : ''}.`;
    } else if (view.phase === 'hand_over') {
      status.textContent = `Hand ${view.handNumber} over — see scores below.`;
    } else if (view.phase === 'game_over') {
      status.textContent = `${view.winnerTeam === 0 ? 'NORTH/SOUTH' : 'EAST/WEST'} WINS THE GAME!`;
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
      box.dataset.seat = String(i);
      box.style.display = 'flex';
      box.style.flexDirection = 'column';
      box.style.alignItems = 'center';
      box.style.gap = '4px';
      box.style.padding = '6px 10px';
      box.style.border = '1px solid #333';
      box.style.borderRadius = '4px';
      box.style.minWidth = '90px';

      const label = document.createElement('div');
      label.style.fontSize = '0.75em';
      label.style.opacity = '0.7';
      label.textContent = `${SEAT_LABELS[i]} (team ${i % 2 === 0 ? 'N/S' : 'E/W'})`;
      box.appendChild(label);

      const name = document.createElement('div');
      name.style.fontWeight = i === mySeat ? 'bold' : 'normal';
      if (clientId) {
        const bid = view.bids ? view.bids[i] : null;
        const bidText = view.phase === 'waiting' ? '' : bid === null || bid === undefined ? ' (no bid yet)' : bid === 0 ? ' — NIL' : ` — bid ${bid}`;
        const tricks = view.tricksWon ? view.tricksWon[i] : 0;
        name.textContent = `${nicknameFor(clientId)}${clientId === api.getClientId() ? ' (you)' : ''}${bidText}`;
        box.appendChild(name);
        if (view.phase === 'playing' || view.phase === 'hand_over') {
          const tricksEl = document.createElement('div');
          tricksEl.style.fontSize = '0.7em';
          tricksEl.style.opacity = '0.7';
          tricksEl.textContent = `tricks: ${tricks}`;
          box.appendChild(tricksEl);
        }
        if (view.phase === 'playing' && i === view.turnIdx) {
          box.style.outline = '2px solid #39ff14';
        }
      } else if (view.phase === 'waiting' && mySeat === -1) {
        const btn = document.createElement('button');
        btn.textContent = `SIT ${SEAT_LABELS[i]}`;
        btn.addEventListener('click', () => api.sendAction({ kind: 'sit', seat: i }));
        box.appendChild(btn);
      } else {
        name.textContent = '(empty)';
        name.style.opacity = '0.5';
        box.appendChild(name);
      }
      seatRow.appendChild(box);
    });
    root.appendChild(seatRow);

    // Waiting-phase controls
    if (view.phase === 'waiting') {
      const controls = document.createElement('div');
      controls.style.display = 'flex';
      controls.style.gap = '8px';
      if (mySeat !== -1) {
        const leaveBtn = document.createElement('button');
        leaveBtn.textContent = 'LEAVE SEAT';
        leaveBtn.addEventListener('click', () => api.sendAction({ kind: 'leaveSeat' }));
        controls.appendChild(leaveBtn);
      }
      if (mySeat !== -1 && view.seats.every(Boolean)) {
        const startBtn = document.createElement('button');
        startBtn.textContent = 'START GAME';
        startBtn.addEventListener('click', () => api.sendAction({ kind: 'startGame' }));
        controls.appendChild(startBtn);
      }
      root.appendChild(controls);
    }

    // Team scores
    if (view.phase !== 'waiting') {
      const scores = document.createElement('div');
      scores.style.display = 'flex';
      scores.style.gap = '20px';
      scores.style.fontSize = '0.9em';
      const ns = document.createElement('div');
      ns.textContent = `NORTH/SOUTH: ${view.teamScores[0]} pts (${view.teamBags[0]} bags)`;
      const ew = document.createElement('div');
      ew.textContent = `EAST/WEST: ${view.teamScores[1]} pts (${view.teamBags[1]} bags)`;
      scores.appendChild(ns);
      scores.appendChild(ew);
      root.appendChild(scores);
    }

    // Bidding controls
    if (view.phase === 'bidding' && mySeat === view.biddingTurnIdx) {
      const bidRow = document.createElement('div');
      bidRow.style.display = 'flex';
      bidRow.style.gap = '6px';
      bidRow.style.flexWrap = 'wrap';
      bidRow.style.justifyContent = 'center';
      bidRow.style.maxWidth = '420px';
      for (let n = 0; n <= 13; n++) {
        const btn = document.createElement('button');
        btn.textContent = n === 0 ? 'NIL' : String(n);
        btn.addEventListener('click', () => api.sendAction({ kind: 'bid', amount: n }));
        bidRow.appendChild(btn);
      }
      root.appendChild(bidRow);
    }

    // Current trick (table)
    if (view.phase === 'playing' || view.phase === 'hand_over') {
      const trickToShow = view.currentTrick && view.currentTrick.length > 0 ? view.currentTrick : (view.lastTrick ? view.lastTrick.cards : []);
      const trickLabel = document.createElement('div');
      trickLabel.style.fontSize = '0.75em';
      trickLabel.style.opacity = '0.7';
      trickLabel.textContent = view.currentTrick && view.currentTrick.length > 0 ? 'Current trick:' : (view.lastTrick ? 'Last trick:' : '');
      if (trickLabel.textContent) root.appendChild(trickLabel);

      const table = document.createElement('div');
      table.style.display = 'flex';
      table.style.gap = '10px';
      SEAT_LABELS.forEach((_, seatIdx) => {
        const played = trickToShow.find((t) => t.seatIdx === seatIdx);
        const col = document.createElement('div');
        col.style.display = 'flex';
        col.style.flexDirection = 'column';
        col.style.alignItems = 'center';
        col.style.gap = '2px';
        const lbl = document.createElement('div');
        lbl.style.fontSize = '0.65em';
        lbl.style.opacity = '0.6';
        lbl.textContent = SEAT_LABELS[seatIdx];
        col.appendChild(lbl);
        if (played) {
          col.appendChild(renderCard(played.card, { small: true }));
        } else {
          const blank = document.createElement('div');
          blank.style.width = '34px';
          blank.style.height = '48px';
          col.appendChild(blank);
        }
        table.appendChild(col);
      });
      root.appendChild(table);
    }

    if (lastReject) {
      const warn = document.createElement('div');
      warn.style.color = '#ff5555';
      warn.style.fontSize = '0.8em';
      warn.textContent = lastReject;
      root.appendChild(warn);
    }

    // My hand
    if (mySeat !== -1 && view.phase === 'playing') {
      const isMyTurn = mySeat === view.turnIdx;
      const handLabel = document.createElement('div');
      handLabel.style.fontSize = '0.8em';
      handLabel.textContent = 'Your hand:';
      root.appendChild(handLabel);

      const sortedHand = view.myHand
        .map((card, i) => ({ card, i }))
        .sort((a, b) => SUIT_ORDER.indexOf(a.card.suit) - SUIT_ORDER.indexOf(b.card.suit) || rankValue(b.card.rank) - rankValue(a.card.rank));

      const legal = legalCardIndices(view.myHand, view.currentTrick, view.spadesBroken);

      const hand = document.createElement('div');
      hand.style.display = 'flex';
      hand.style.gap = '4px';
      hand.style.flexWrap = 'wrap';
      hand.style.justifyContent = 'center';
      sortedHand.forEach(({ card, i }) => {
        const cardEl = renderCard(card);
        const playable = isMyTurn && legal.includes(i);
        cardEl.style.cursor = playable ? 'pointer' : 'default';
        cardEl.style.opacity = isMyTurn && !playable ? '0.4' : '1';
        cardEl.style.outline = playable ? '2px solid #39ff14' : 'none';
        if (playable) {
          cardEl.addEventListener('click', () => {
            lastReject = null;
            api.sendAction({ kind: 'play', cardIndex: i });
          });
        }
        hand.appendChild(cardEl);
      });
      root.appendChild(hand);
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
      again.addEventListener('click', () => api.sendAction({ kind: 'newGame' }));
      root.appendChild(again);
    }

    if (view.phase !== 'waiting') {
      const leaveBtn = document.createElement('button');
      leaveBtn.textContent = 'LEAVE SEAT';
      leaveBtn.style.marginTop = '6px';
      leaveBtn.addEventListener('click', () => api.sendAction({ kind: 'leaveSeat' }));
      if (mySeat !== -1) root.appendChild(leaveBtn);
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
        lastReject = null;
        render();
      } else if (data.kind === 'actionRejected') {
        lastReject = data.reason || 'Illegal move';
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
