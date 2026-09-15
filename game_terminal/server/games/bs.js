// BS / Cheat — 2-6 players. The deck is dealt out entirely; on your turn you must play 1-4 cards
// face-down, claiming they're the next rank in the fixed A,2,3...K sequence (cycling). Anyone else
// can call BS; if the claim was a lie the player takes the whole pile back, otherwise the caller
// does. First to legitimately empty their hand (an unchallenged or successfully-defended final
// play) wins. Face-down cards are genuinely hidden per-client until a challenge reveals them —
// this is the one card game here with real hidden information, like Hangman's secret word.

const { createDeck, shuffle } = require('./cardCommon');

const MIN_SEATS = 2;
const MAX_SEATS = 6;
const RANK_SEQUENCE = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function nextRank(rank) {
  return RANK_SEQUENCE[(RANK_SEQUENCE.indexOf(rank) + 1) % RANK_SEQUENCE.length];
}

function dealNewGame(st) {
  const deck = shuffle(createDeck());
  st.hands = st.seats.map(() => []);
  let i = 0;
  while (deck.length) {
    st.hands[i % st.seats.length].push(deck.pop());
    i++;
  }
  st.pile = []; // face-down cards accumulated across unresolved-but-unchallenged plays
  st.requiredRank = RANK_SEQUENCE[0];
  st.turnIdx = 0;
  st.lastPlay = null; // { playerIdx, count, claimedRank, cardIndices-worth-of-actual-cards }
  st.lastChallengeResult = null;
  st.phase = 'playing';
  st.winnerSeat = null;
}

// After a play stands unchallenged (or a challenge against it fails), the player who made that
// play may have just emptied their hand for good — check for the win here, called from both
// resolution paths that leave the play intact.
function checkForWin(st, playerIdx) {
  if (st.hands[playerIdx].length === 0) {
    st.phase = 'game_over';
    st.winnerSeat = playerIdx;
    return true;
  }
  return false;
}

function buildPublicState(room, forClientId) {
  const st = room.state;
  const mySeatIdx = st.seats.indexOf(forClientId);
  return {
    phase: st.phase,
    seats: st.seats,
    handCounts: st.seats.map((_, i) => (st.hands[i] ? st.hands[i].length : 0)),
    myHand: (mySeatIdx !== -1 && st.hands[mySeatIdx]) || [],
    pileSize: st.pile.length,
    requiredRank: st.requiredRank,
    turnIdx: st.turnIdx,
    // Only counts + who + claimed rank travel here — the actual cards stay hidden until a
    // challenge reveals them (see lastChallengeResult), same spirit as Hangman's per-client mask.
    lastPlay: st.lastPlay ? { playerIdx: st.lastPlay.playerIdx, count: st.lastPlay.count, claimedRank: st.lastPlay.claimedRank } : null,
    lastChallengeResult: st.lastChallengeResult,
    winnerSeat: st.winnerSeat,
  };
}

function broadcastState(room, ctx) {
  for (const clientId of room.clients.keys()) {
    ctx.sendTo(clientId, { v: 1, type: 'game.event', payload: { gameType: 'bs', data: { kind: 'state', ...buildPublicState(room, clientId) } } });
  }
}

module.exports = {
  type: 'bs',

  createInitialState() {
    return {
      phase: 'waiting', seats: [], hands: [], pile: [], requiredRank: RANK_SEQUENCE[0],
      turnIdx: 0, lastPlay: null, lastChallengeResult: null, winnerSeat: null,
    };
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
    for (const clientId of room.clients.keys()) {
      room.sendTo(clientId, { v: 1, type: 'game.event', payload: { gameType: 'bs', data: { kind: 'state', ...buildPublicState(room, clientId) } } });
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
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'resetGame') {
      if (st.phase !== 'game_over') return;
      if (st.seats.length >= MIN_SEATS) dealNewGame(st);
      else st.phase = 'waiting';
      broadcastState(room, ctx);
      return;
    }

    const seatIdx = st.seats.indexOf(ctx.senderId);
    if (seatIdx === -1) return;

    if (data.kind === 'play') {
      if (st.phase !== 'playing' || seatIdx !== st.turnIdx) return;
      const indices = Array.isArray(data.cardIndices) ? [...new Set(data.cardIndices.map(Number))] : [];
      const hand = st.hands[seatIdx];
      if (indices.length < 1 || indices.length > 4) return;
      if (indices.some((i) => !Number.isInteger(i) || i < 0 || i >= hand.length)) return;
      // Remove highest indices first so earlier indices don't shift out from under us.
      const sorted = [...indices].sort((a, b) => b - a);
      const playedCards = sorted.map((i) => hand.splice(i, 1)[0]);
      st.pile.push(...playedCards);
      st.lastPlay = { playerIdx: seatIdx, count: playedCards.length, claimedRank: st.requiredRank, cards: playedCards };
      st.lastChallengeResult = null;
      st.phase = 'challenge';
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'callBS') {
      if (st.phase !== 'challenge' || !st.lastPlay || seatIdx === st.lastPlay.playerIdx) return;
      const { playerIdx, claimedRank, cards } = st.lastPlay;
      const bluffConfirmed = cards.some((c) => c.rank !== claimedRank);
      const pileToAward = st.pile;
      st.pile = [];
      if (bluffConfirmed) {
        st.hands[playerIdx].push(...pileToAward);
        st.turnIdx = seatIdx; // caller was right — play passes to them, same rank still contested
      } else {
        st.hands[seatIdx].push(...pileToAward);
        st.turnIdx = (playerIdx + 1) % st.seats.length;
        st.requiredRank = nextRank(claimedRank);
      }
      st.lastChallengeResult = { callerIdx: seatIdx, playerIdx, claimedRank, revealedCards: cards, bluffConfirmed, pileAwardedTo: bluffConfirmed ? playerIdx : seatIdx };
      st.lastPlay = null;
      st.phase = 'playing';
      // A bluff being confirmed means the accused takes cards back (never empty right after), so
      // a win is only possible on the "caller was wrong" branch, checked against whichever player
      // the turn sequence says just had their play stand.
      if (!bluffConfirmed) checkForWin(st, playerIdx);
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'passChallenge') {
      if (st.phase !== 'challenge' || !st.lastPlay) return;
      const nextIdx = (st.lastPlay.playerIdx + 1) % st.seats.length;
      if (seatIdx !== nextIdx) return; // only the next player in sequence can let a play ride
      const playerIdx = st.lastPlay.playerIdx;
      st.requiredRank = nextRank(st.lastPlay.claimedRank);
      st.turnIdx = nextIdx;
      st.lastChallengeResult = null;
      st.lastPlay = null;
      st.phase = 'playing';
      checkForWin(st, playerIdx);
      broadcastState(room, ctx);
    }
  },
};
