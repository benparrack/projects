// Spades — 4 players, fixed partnerships (seats 0 & 2 vs seats 1 & 3), spades always trump.
// Standard American rules: bid 0-13 per player (0 = nil), follow suit, spades can't lead until
// broken, highest spade (else highest of led suit) wins the trick. Scoring: made bid = 10*bid +
// 1/overtrick (bag); failed bid = -10*bid; nil made = +100, nil failed = -100 (independent of the
// bid team-scoring above); every 10 accumulated bags = -100 (remainder kept, not reset to 0).
// First team to 500 wins. Doubling/gammon-style multipliers and a losing-score cutoff are out of
// scope for this first version — see FUTURE.md.

const { createDeck, shuffle, rankValue } = require('./cardCommon');

const WIN_SCORE = 500;
const BAG_PENALTY_THRESHOLD = 10;
const BAG_PENALTY = 100;
const NIL_BONUS = 100;

function teamOf(seatIdx) {
  return seatIdx % 2; // team 0 = seats 0&2, team 1 = seats 1&3
}

function partnerSeat(seatIdx) {
  return (seatIdx + 2) % 4;
}

function dealNewHand(st) {
  const deck = shuffle(createDeck());
  st.hands = [[], [], [], []];
  for (let i = 0; i < 13; i++) {
    for (let seat = 0; seat < 4; seat++) st.hands[seat].push(deck.pop());
  }
  st.bids = [null, null, null, null];
  st.biddingTurnIdx = (st.dealerIdx + 1) % 4;
  st.tricksWon = [0, 0, 0, 0];
  st.currentTrick = [];
  st.spadesBroken = false;
  st.leadSeatIdx = null;
  st.turnIdx = null;
  st.lastTrick = null;
  st.lastAction = null;
  st.phase = 'bidding';
  st.handNumber = (st.handNumber || 0) + 1;
}

function legalCardIndices(hand, currentTrick, spadesBroken) {
  if (currentTrick.length === 0) {
    if (spadesBroken) return hand.map((_, i) => i);
    const nonSpades = hand.map((c, i) => (c.suit !== 'S' ? i : -1)).filter((i) => i !== -1);
    return nonSpades.length > 0 ? nonSpades : hand.map((_, i) => i); // hand is all spades: forced
  }
  const ledSuit = currentTrick[0].card.suit;
  const matching = hand.map((c, i) => (c.suit === ledSuit ? i : -1)).filter((i) => i !== -1);
  return matching.length > 0 ? matching : hand.map((_, i) => i);
}

function trickWinnerSeat(trick) {
  const ledSuit = trick[0].card.suit;
  const spadesPlayed = trick.filter((t) => t.card.suit === 'S');
  const pool = spadesPlayed.length > 0 ? spadesPlayed : trick.filter((t) => t.card.suit === ledSuit);
  let best = pool[0];
  for (const t of pool) if (rankValue(t.card.rank) > rankValue(best.card.rank)) best = t;
  return best.seatIdx;
}

// Resolves hand scoring once all 13 tricks are played, mutates st.teamScores/teamBags, and sets
// st.phase to 'game_over' (with st.winnerTeam) or 'hand_over'.
function resolveHandScoring(st) {
  for (let team = 0; team < 2; team++) {
    const [a, b] = [team, team + 2];
    const teamBid = (st.bids[a] || 0) + (st.bids[b] || 0);
    const teamTricks = st.tricksWon[a] + st.tricksWon[b];
    let delta = 0;
    if (teamTricks >= teamBid) {
      const overtricks = teamTricks - teamBid;
      delta += teamBid * 10 + overtricks;
      st.teamBags[team] += overtricks;
      if (st.teamBags[team] >= BAG_PENALTY_THRESHOLD) {
        delta -= BAG_PENALTY;
        st.teamBags[team] -= BAG_PENALTY_THRESHOLD;
      }
    } else {
      delta -= teamBid * 10;
    }
    for (const seat of [a, b]) {
      if (st.bids[seat] === 0) {
        delta += st.tricksWon[seat] === 0 ? NIL_BONUS : -NIL_BONUS;
      }
    }
    st.teamScores[team] += delta;
  }

  if (Math.max(...st.teamScores) >= WIN_SCORE) {
    st.phase = 'game_over';
    st.winnerTeam = st.teamScores[0] >= st.teamScores[1] ? 0 : 1;
  } else {
    st.phase = 'hand_over';
  }
}

function buildPublicStateFor(room, forClientId) {
  const st = room.state;
  const mySeat = st.seats.indexOf(forClientId);
  return {
    phase: st.phase,
    seats: st.seats,
    handCounts: st.hands.length ? st.hands.map((h) => h.length) : [0, 0, 0, 0],
    myHand: mySeat !== -1 && st.hands[mySeat] ? st.hands[mySeat] : [],
    mySeat,
    bids: st.bids,
    biddingTurnIdx: st.biddingTurnIdx,
    dealerIdx: st.dealerIdx,
    turnIdx: st.turnIdx,
    leadSeatIdx: st.leadSeatIdx,
    currentTrick: st.currentTrick,
    spadesBroken: st.spadesBroken,
    tricksWon: st.tricksWon,
    teamScores: st.teamScores,
    teamBags: st.teamBags,
    lastTrick: st.lastTrick,
    lastAction: st.lastAction,
    handNumber: st.handNumber,
    winnerTeam: st.winnerTeam,
  };
}

function broadcastState(room, ctx) {
  for (const clientId of room.clients.keys()) {
    ctx.sendTo(clientId, { v: 1, type: 'game.event', payload: { gameType: 'spades', data: { kind: 'state', ...buildPublicStateFor(room, clientId) } } });
  }
}

function reject(ctx, reason) {
  ctx.sendTo(ctx.senderId, { v: 1, type: 'game.event', payload: { gameType: 'spades', data: { kind: 'actionRejected', reason } } });
}

module.exports = {
  type: 'spades',

  createInitialState() {
    return {
      phase: 'waiting',
      seats: [null, null, null, null],
      hands: [[], [], [], []],
      bids: [null, null, null, null],
      biddingTurnIdx: 0,
      dealerIdx: 3, // so the first hand's bidding starts at seat 0
      turnIdx: null,
      leadSeatIdx: null,
      currentTrick: [],
      spadesBroken: false,
      tricksWon: [0, 0, 0, 0],
      teamScores: [0, 0],
      teamBags: [0, 0],
      lastTrick: null,
      lastAction: null,
      handNumber: 0,
      winnerTeam: null,
    };
  },

  isRoomFull(room) {
    return room.state.seats.every((s) => s !== null);
  },

  serializeSnapshot(room, client) {
    return buildPublicStateFor(room, client ? client.clientId : null);
  },

  onLeave(room, client) {
    const st = room.state;
    const idx = st.seats.indexOf(client.clientId);
    if (idx === -1) return;
    st.seats[idx] = null;
    st.phase = 'waiting';
    st.hands = [[], [], [], []];
    st.bids = [null, null, null, null];
    st.currentTrick = [];
    st.tricksWon = [0, 0, 0, 0];
    st.turnIdx = null;
    st.leadSeatIdx = null;
    st.lastTrick = null;
    st.lastAction = null;
    for (const clientId of room.clients.keys()) {
      room.sendTo(clientId, { v: 1, type: 'game.event', payload: { gameType: 'spades', data: { kind: 'state', ...buildPublicStateFor(room, clientId) } } });
    }
  },

  onMessage(room, client, data, ctx) {
    if (!data || typeof data.kind !== 'string') return;
    const st = room.state;

    if (data.kind === 'sit') {
      const seat = Number(data.seat);
      if (!Number.isInteger(seat) || seat < 0 || seat > 3) return;
      if (st.phase !== 'waiting' || st.seats[seat] || st.seats.includes(ctx.senderId)) return;
      st.seats[seat] = ctx.senderId;
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'leaveSeat') {
      const idx = st.seats.indexOf(ctx.senderId);
      if (idx === -1) return;
      st.seats[idx] = null;
      st.phase = 'waiting';
      st.hands = [[], [], [], []];
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'startGame') {
      if (st.phase !== 'waiting' || !st.seats.every((s) => s !== null) || !st.seats.includes(ctx.senderId)) return;
      dealNewHand(st);
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'nextHand') {
      if (st.phase !== 'hand_over') return;
      if (!st.seats.includes(ctx.senderId)) return;
      st.dealerIdx = (st.dealerIdx + 1) % 4;
      dealNewHand(st);
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'newGame') {
      if (st.phase !== 'game_over') return;
      if (!st.seats.includes(ctx.senderId)) return;
      st.teamScores = [0, 0];
      st.teamBags = [0, 0];
      st.winnerTeam = null;
      st.dealerIdx = (st.dealerIdx + 1) % 4;
      dealNewHand(st);
      broadcastState(room, ctx);
      return;
    }

    const seatIdx = st.seats.indexOf(ctx.senderId);
    if (seatIdx === -1) return;

    if (data.kind === 'bid') {
      if (st.phase !== 'bidding' || seatIdx !== st.biddingTurnIdx) return;
      const amount = Number(data.amount);
      if (!Number.isInteger(amount) || amount < 0 || amount > 13) return;
      st.bids[seatIdx] = amount;
      st.lastAction = { kind: 'bid', seatIdx, amount };
      if (st.bids.every((b) => b !== null)) {
        st.phase = 'playing';
        st.leadSeatIdx = (st.dealerIdx + 1) % 4;
        st.turnIdx = st.leadSeatIdx;
      } else {
        st.biddingTurnIdx = (st.biddingTurnIdx + 1) % 4;
      }
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'play') {
      if (st.phase !== 'playing' || seatIdx !== st.turnIdx) return;
      const cardIdx = Number(data.cardIndex);
      const hand = st.hands[seatIdx];
      if (!Number.isInteger(cardIdx) || cardIdx < 0 || cardIdx >= hand.length) return;
      const legal = legalCardIndices(hand, st.currentTrick, st.spadesBroken);
      if (!legal.includes(cardIdx)) {
        reject(ctx, 'must_follow_suit_or_spades_not_broken');
        return;
      }
      const [card] = hand.splice(cardIdx, 1);
      if (card.suit === 'S') st.spadesBroken = true;
      st.currentTrick.push({ seatIdx, card });
      st.lastAction = { kind: 'play', seatIdx, card };

      if (st.currentTrick.length === 4) {
        const winnerSeatIdx = trickWinnerSeat(st.currentTrick);
        st.tricksWon[winnerSeatIdx] += 1;
        st.lastTrick = { winnerSeatIdx, cards: st.currentTrick };
        st.currentTrick = [];
        st.leadSeatIdx = winnerSeatIdx;
        st.turnIdx = winnerSeatIdx;
        if (st.tricksWon.reduce((a, b) => a + b, 0) === 13) {
          resolveHandScoring(st);
        }
      } else {
        st.turnIdx = (st.turnIdx + 1) % 4;
      }
      broadcastState(room, ctx);
    }
  },

  // Exposed for the standalone verification script only — not used by the room/ctx runtime.
  _internal: { teamOf, partnerSeat, legalCardIndices, trickWinnerSeat, resolveHandScoring, dealNewHand },
};
