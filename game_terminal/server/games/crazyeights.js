// Crazy Eights — 2-6 players, seat order = turn order. Match the discard pile's top card by
// rank or suit, or play an 8 (wild, declares the next suit). No playable card? Draw until you
// can play or choose to pass. First to empty their hand wins.
// Simplification: every player is always dealt 5 cards regardless of player count (some house
// rules deal 7 for exactly 2 players) — kept uniform to avoid an extra branch for a minor variant.

const { createDeck, shuffle } = require('./cardCommon');

const MAX_SEATS = 6;
const MIN_SEATS = 2;
const HAND_SIZE = 5;

function isPlayable(card, topRank, currentSuit) {
  return card.rank === '8' || card.rank === topRank || card.suit === currentSuit;
}

function topCard(st) {
  return st.discardPile[st.discardPile.length - 1];
}

function reshuffleIfNeeded(st) {
  if (st.drawPile.length > 0) return;
  // Standard rule: reshuffle everything except the current top card back into the draw pile.
  const top = st.discardPile.pop();
  st.drawPile = shuffle(st.discardPile);
  st.discardPile = [top];
}

function dealNewGame(st) {
  let deck = shuffle(createDeck());
  st.hands = st.seats.map(() => []);
  for (let r = 0; r < HAND_SIZE; r++) {
    for (let i = 0; i < st.seats.length; i++) st.hands[i].push(deck.pop());
  }
  // The opening discard card can't be an 8 (nothing to "match" yet) — draw until it isn't.
  let first;
  do {
    first = deck.pop();
    if (first.rank === '8') deck.unshift(first);
  } while (first.rank === '8');
  st.discardPile = [first];
  st.drawPile = deck;
  st.currentSuit = first.suit;
  st.turnIdx = 0;
  st.hasDrawnThisTurn = false;
  st.winnerSeat = null;
  st.lastAction = null;
}

function advanceTurn(st) {
  st.turnIdx = (st.turnIdx + 1) % st.seats.length;
  st.hasDrawnThisTurn = false;
}

function buildPublicState(room, forClientId) {
  const st = room.state;
  const mySeatIdx = st.seats.indexOf(forClientId);
  return {
    phase: st.phase,
    seats: st.seats,
    handCounts: st.seats.map((_, i) => (st.hands[i] ? st.hands[i].length : 0)),
    myHand: (mySeatIdx !== -1 && st.hands[mySeatIdx]) || [],
    topCard: st.discardPile.length ? topCard(st) : null,
    currentSuit: st.currentSuit,
    drawPileSize: st.drawPile ? st.drawPile.length : 0,
    turnIdx: st.turnIdx,
    hasDrawnThisTurn: st.hasDrawnThisTurn,
    winnerSeat: st.winnerSeat,
    lastAction: st.lastAction,
  };
}

function broadcastState(room, ctx) {
  for (const clientId of room.clients.keys()) {
    ctx.sendTo(clientId, { v: 1, type: 'game.event', payload: { gameType: 'crazyeights', data: { kind: 'state', ...buildPublicState(room, clientId) } } });
  }
}

module.exports = {
  type: 'crazyeights',

  createInitialState() {
    return { phase: 'waiting', seats: [], hands: [], drawPile: [], discardPile: [], currentSuit: null, turnIdx: 0, hasDrawnThisTurn: false, winnerSeat: null, lastAction: null };
  },

  isRoomFull(room) {
    return room.state.seats.length >= MAX_SEATS;
  },

  serializeSnapshot(room, client) {
    return buildPublicState(room, client ? client.clientId : null);
  },

  onLeave(room, client) {
    const st = room.state;
    const idx = st.seats.indexOf(client.clientId);
    if (idx === -1) return;
    st.seats.splice(idx, 1);
    if (st.hands.length) st.hands.splice(idx, 1);
    st.phase = 'waiting';
    if (st.turnIdx >= st.seats.length) st.turnIdx = 0;
    for (const clientId of room.clients.keys()) {
      room.sendTo(clientId, { v: 1, type: 'game.event', payload: { gameType: 'crazyeights', data: { kind: 'state', ...buildPublicState(room, clientId) } } });
    }
  },

  onMessage(room, client, data, ctx) {
    if (!data || typeof data.kind !== 'string') return;
    const st = room.state;

    if (data.kind === 'sit') {
      if (st.phase !== 'waiting' || st.seats.length >= MAX_SEATS || st.seats.includes(ctx.senderId)) return;
      st.seats.push(ctx.senderId);
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'leaveSeat') {
      const idx = st.seats.indexOf(ctx.senderId);
      if (idx === -1) return;
      st.seats.splice(idx, 1);
      st.phase = 'waiting';
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'startGame') {
      if (st.phase !== 'waiting' || st.seats.length < MIN_SEATS) return;
      dealNewGame(st);
      st.phase = 'playing';
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'resetGame') {
      if (st.phase !== 'game_over') return;
      st.phase = st.seats.length >= MIN_SEATS ? 'playing' : 'waiting';
      if (st.phase === 'playing') dealNewGame(st);
      broadcastState(room, ctx);
      return;
    }

    const seatIdx = st.seats.indexOf(ctx.senderId);
    if (seatIdx === -1 || st.phase !== 'playing' || seatIdx !== st.turnIdx) return;

    if (data.kind === 'play') {
      const cardIdx = Number(data.cardIndex);
      const hand = st.hands[seatIdx];
      if (!Number.isInteger(cardIdx) || cardIdx < 0 || cardIdx >= hand.length) return;
      const card = hand[cardIdx];
      if (!isPlayable(card, topCard(st).rank, st.currentSuit)) return;
      let declaredSuit = st.currentSuit;
      if (card.rank === '8') {
        const suits = ['S', 'H', 'D', 'C'];
        if (!suits.includes(data.declaredSuit)) return;
        declaredSuit = data.declaredSuit;
      } else {
        declaredSuit = card.suit;
      }
      hand.splice(cardIdx, 1);
      st.discardPile.push(card);
      st.currentSuit = declaredSuit;
      st.lastAction = { kind: 'play', seatIdx, card };
      if (hand.length === 0) {
        st.phase = 'game_over';
        st.winnerSeat = seatIdx;
      } else {
        advanceTurn(st);
      }
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'draw') {
      if (st.hasDrawnThisTurn) return;
      reshuffleIfNeeded(st);
      if (st.drawPile.length === 0) return; // truly nothing left anywhere — rare edge case, no-op
      st.hands[seatIdx].push(st.drawPile.pop());
      st.hasDrawnThisTurn = true;
      st.lastAction = { kind: 'draw', seatIdx };
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'pass') {
      if (!st.hasDrawnThisTurn) return; // must at least try to draw before passing
      st.lastAction = { kind: 'pass', seatIdx };
      advanceTurn(st);
      broadcastState(room, ctx);
    }
  },
};
