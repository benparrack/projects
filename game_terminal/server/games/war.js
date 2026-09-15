// War — strictly 2 players. Deck splits evenly; each round both flip their top card, higher
// rank takes the pile. Ties trigger a "war": each side burns one card face-down into the pot and
// flips again to break the tie, repeating until it resolves. Running out of cards mid-game (or
// mid-war, unable to burn) is an instant loss.

const { createDeck, shuffle, rankValue } = require('./cardCommon');

const MAX_SEATS = 2;

function buildPublicState(room) {
  const st = room.state;
  return {
    phase: st.phase,
    seats: st.seats,
    handCounts: st.seats.map((_, i) => st.hands[i].length),
    pendingFlips: st.pendingFlips,
    potSize: st.pot.length,
    lastResult: st.lastResult,
    winnerSeat: st.winnerSeat,
  };
}

function broadcastState(room, ctx) {
  ctx.broadcast({ v: 1, type: 'game.event', payload: { gameType: 'war', data: { kind: 'state', ...buildPublicState(room) } } });
}

function resetGame(st) {
  const deck = shuffle(createDeck());
  const half = Math.ceil(deck.length / 2);
  st.hands = [deck.slice(0, half), deck.slice(half)];
  st.pendingFlips = [null, null];
  st.pot = [];
  st.lastResult = null;
  st.winnerSeat = null;
}

function loseGame(st, loserIdx) {
  st.phase = 'game_over';
  st.winnerSeat = loserIdx === 0 ? 1 : 0;
  st.lastResult = { kind: 'outOfCards', loserIdx };
}

function resolveRound(st) {
  const [a, b] = st.pendingFlips;
  st.pot.push(a, b);
  const av = rankValue(a.rank);
  const bv = rankValue(b.rank);
  if (av === bv) {
    // War: each side burns one face-down card into the pot (a tie-breaker ante), then both must
    // flip again. A side without a card to burn loses outright — the classic rule for running out
    // mid-war.
    for (let i = 0; i < 2; i++) {
      if (st.hands[i].length === 0) {
        loseGame(st, i);
        return;
      }
      st.pot.push(st.hands[i].shift());
    }
    st.pendingFlips = [null, null];
    st.lastResult = { kind: 'war' };
    return;
  }
  const winnerIdx = av > bv ? 0 : 1;
  const cardsWon = st.pot.length;
  // Winner's new cards go to the BOTTOM of their draw pile — standard War rule (a card you just
  // won can't be replayed until you've cycled through the rest of your deck).
  st.hands[winnerIdx].push(...st.pot);
  st.pot = [];
  st.pendingFlips = [null, null];
  st.lastResult = { kind: 'roundWin', winnerIdx, cardsWon };
  if (st.hands[winnerIdx === 0 ? 1 : 0].length === 0) {
    st.phase = 'game_over';
    st.winnerSeat = winnerIdx;
  }
}

module.exports = {
  type: 'war',

  createInitialState() {
    const st = { phase: 'waiting', seats: [] };
    resetGame(st);
    return st;
  },

  isRoomFull(room) {
    return room.state.seats.length >= MAX_SEATS;
  },

  serializeSnapshot(room) {
    return buildPublicState(room);
  },

  onLeave(room, client) {
    const st = room.state;
    const idx = st.seats.indexOf(client.clientId);
    if (idx === -1) return;
    st.seats.splice(idx, 1);
    st.phase = 'waiting';
    resetGame(st);
    for (const clientId of room.clients.keys()) {
      room.sendTo(clientId, { v: 1, type: 'game.event', payload: { gameType: 'war', data: { kind: 'state', ...buildPublicState(room) } } });
    }
  },

  onMessage(room, client, data, ctx) {
    if (!data || typeof data.kind !== 'string') return;
    const st = room.state;

    if (data.kind === 'sit') {
      if (st.seats.length >= MAX_SEATS || st.seats.includes(ctx.senderId)) return;
      st.seats.push(ctx.senderId);
      if (st.seats.length === MAX_SEATS) st.phase = 'playing';
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'leaveSeat') {
      const idx = st.seats.indexOf(ctx.senderId);
      if (idx === -1) return;
      st.seats.splice(idx, 1);
      st.phase = 'waiting';
      resetGame(st);
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'resetGame') {
      if (st.phase !== 'game_over') return;
      resetGame(st);
      st.phase = st.seats.length === MAX_SEATS ? 'playing' : 'waiting';
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'flip') {
      if (st.phase !== 'playing') return;
      const seatIdx = st.seats.indexOf(ctx.senderId);
      if (seatIdx === -1 || st.pendingFlips[seatIdx]) return;
      if (st.hands[seatIdx].length === 0) {
        loseGame(st, seatIdx);
        broadcastState(room, ctx);
        return;
      }
      st.pendingFlips[seatIdx] = st.hands[seatIdx].shift();
      if (st.pendingFlips[0] && st.pendingFlips[1]) resolveRound(st);
      broadcastState(room, ctx);
    }
  },
};
