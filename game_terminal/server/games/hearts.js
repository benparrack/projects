// Hearts — 4 players, standard 52-card deck, no trump. Deal all 52 (13 each), pass 3 cards each
// hand (left/right/across/none, cycling every 4 hands), then trick-taking: must follow suit,
// hearts can't be led until broken, no points card on the first trick. Each heart taken = 1
// point, Q of spades = 13. Lowest cumulative score is best; game ends once someone crosses 100,
// winner is whoever has the lowest score at that point (not necessarily the one who crossed it).
// "Shooting the moon": take all 26 penalty points in one hand -> you score 0, everyone else +26.

const { createDeck, shuffle, rankValue } = require('./cardCommon');

const SEATS = 4;
const PASS_CYCLE = ['left', 'right', 'across', 'none'];
const END_SCORE = 100;

function isHeart(card) {
  return card.suit === 'H';
}

function isQueenOfSpades(card) {
  return card.suit === 'S' && card.rank === 'Q';
}

function pointValue(card) {
  if (isQueenOfSpades(card)) return 13;
  if (isHeart(card)) return 1;
  return 0;
}

function passTargetSeat(seatIdx, direction) {
  if (direction === 'left') return (seatIdx + 1) % SEATS;
  if (direction === 'right') return (seatIdx + 3) % SEATS;
  if (direction === 'across') return (seatIdx + 2) % SEATS;
  return seatIdx; // 'none'
}

function findTwoOfClubsSeat(hands) {
  for (let i = 0; i < SEATS; i++) {
    if (hands[i].some((c) => c.suit === 'C' && c.rank === '2')) return i;
  }
  return 0;
}

function dealNewHand(st) {
  const deck = shuffle(createDeck());
  st.hands = [[], [], [], []];
  for (let r = 0; r < 13; r++) {
    for (let i = 0; i < SEATS; i++) st.hands[i].push(deck.pop());
  }
  st.passDirection = PASS_CYCLE[st.handNumber % PASS_CYCLE.length];
  st.passSubmissions = [null, null, null, null];
  st.currentTrick = [];
  st.tricksTaken = [[], [], [], []];
  st.heartsBroken = false;
  st.firstTrick = true;
  st.lastTrickWinnerSeat = null;
  st.lastTrick = null;
  st.handScores = null;
  st.moonShooterSeat = null;

  if (st.passDirection === 'none') {
    st.phase = 'playing';
    st.trickLeaderSeat = findTwoOfClubsSeat(st.hands);
    st.turnSeat = st.trickLeaderSeat;
  } else {
    st.phase = 'passing';
    st.trickLeaderSeat = null;
    st.turnSeat = null;
  }
}

function startNextTrick(st, leaderSeat) {
  st.trickLeaderSeat = leaderSeat;
  st.turnSeat = leaderSeat;
  st.currentTrick = [];
}

function legalCards(st, seatIdx) {
  const hand = st.hands[seatIdx];
  const leading = st.currentTrick.length === 0;

  if (leading) {
    let options = hand;
    if (!st.heartsBroken) {
      const nonHearts = hand.filter((c) => !isHeart(c));
      if (nonHearts.length > 0) options = nonHearts;
    }
    if (st.firstTrick) {
      // Must lead the 2 of clubs specifically on the very first trick of the hand.
      return hand.filter((c) => c.suit === 'C' && c.rank === '2');
    }
    return options;
  }

  const ledSuit = st.currentTrick[0].card.suit;
  let options = hand.filter((c) => c.suit === ledSuit);
  if (options.length === 0) options = hand.slice();

  if (st.firstTrick) {
    const nonPoints = options.filter((c) => pointValue(c) === 0);
    if (nonPoints.length > 0) options = nonPoints;
  }
  return options;
}

function cardsEqual(a, b) {
  return a.suit === b.suit && a.rank === b.rank;
}

function trickWinnerSeat(trick) {
  const ledSuit = trick[0].card.suit;
  let winner = trick[0];
  for (let i = 1; i < trick.length; i++) {
    const entry = trick[i];
    if (entry.card.suit === ledSuit && rankValue(entry.card.rank) > rankValue(winner.card.rank)) {
      winner = entry;
    }
  }
  return winner.seatIdx;
}

function finishHand(st) {
  const points = [0, 0, 0, 0];
  for (let i = 0; i < SEATS; i++) {
    for (const card of st.tricksTaken[i]) points[i] += pointValue(card);
  }
  const moonSeat = points.findIndex((p) => p === 26);
  let handScores;
  if (moonSeat !== -1) {
    handScores = [26, 26, 26, 26];
    handScores[moonSeat] = 0;
    st.moonShooterSeat = moonSeat;
  } else {
    handScores = points;
    st.moonShooterSeat = null;
  }
  for (let i = 0; i < SEATS; i++) st.scores[i] += handScores[i];
  st.handScores = handScores;
  st.phase = 'hand_over';

  if (Math.max(...st.scores) >= END_SCORE) {
    const lowest = Math.min(...st.scores);
    st.winnerSeat = st.scores.indexOf(lowest);
    st.phase = 'game_over';
  }
}

function buildPublicStateFor(room, forClientId) {
  const st = room.state;
  const mySeatIdx = st.seats.indexOf(forClientId);
  return {
    phase: st.phase,
    seats: st.seats,
    scores: st.scores,
    handNumber: st.handNumber,
    passDirection: st.passDirection,
    handCounts: st.seats.map((_, i) => (st.hands[i] ? st.hands[i].length : 0)),
    myHand: mySeatIdx !== -1 && st.hands[mySeatIdx] ? st.hands[mySeatIdx] : [],
    myPassSubmitted: mySeatIdx !== -1 ? !!(st.passSubmissions && st.passSubmissions[mySeatIdx]) : false,
    passSubmittedSeats: st.passSubmissions ? st.passSubmissions.map((p) => !!p) : [false, false, false, false],
    currentTrick: st.currentTrick,
    trickLeaderSeat: st.trickLeaderSeat,
    turnSeat: st.turnSeat,
    heartsBroken: st.heartsBroken,
    firstTrick: st.firstTrick,
    legalCardsHint: st.phase === 'playing' && mySeatIdx !== -1 && mySeatIdx === st.turnSeat ? legalCards(st, mySeatIdx) : null,
    lastTrick: st.lastTrick,
    lastTrickWinnerSeat: st.lastTrickWinnerSeat,
    handScores: st.handScores,
    moonShooterSeat: st.moonShooterSeat,
    winnerSeat: st.winnerSeat,
  };
}

function broadcastState(room, ctx) {
  for (const clientId of room.clients.keys()) {
    ctx.sendTo(clientId, { v: 1, type: 'game.event', payload: { gameType: 'hearts', data: { kind: 'state', ...buildPublicStateFor(room, clientId) } } });
  }
}

function reject(ctx, reason) {
  ctx.sendTo(ctx.senderId, { v: 1, type: 'game.event', payload: { gameType: 'hearts', data: { kind: 'actionRejected', reason } } });
}

module.exports = {
  type: 'hearts',

  createInitialState() {
    return {
      phase: 'waiting',
      seats: [null, null, null, null],
      hands: [[], [], [], []],
      scores: [0, 0, 0, 0],
      handNumber: 0,
      passDirection: null,
      passSubmissions: [null, null, null, null],
      currentTrick: [],
      tricksTaken: [[], [], [], []],
      trickLeaderSeat: null,
      turnSeat: null,
      heartsBroken: false,
      firstTrick: true,
      lastTrick: null,
      lastTrickWinnerSeat: null,
      handScores: null,
      moonShooterSeat: null,
      winnerSeat: null,
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
    // A 4-player trick-taking game mid-hand has no good "continue with 3" story — reset all
    // progress but keep the other seats' occupants, same spirit as the 2-seat games' onLeave.
    const remainingSeats = st.seats.slice();
    remainingSeats[idx] = null;
    Object.assign(st, module.exports.createInitialState());
    st.seats = remainingSeats;
    for (const clientId of room.clients.keys()) {
      room.sendTo(clientId, { v: 1, type: 'game.event', payload: { gameType: 'hearts', data: { kind: 'state', ...buildPublicStateFor(room, clientId) } } });
    }
  },

  onMessage(room, client, data, ctx) {
    if (!data || typeof data.kind !== 'string') return;
    const st = room.state;

    if (data.kind === 'sit') {
      const seatIdx = Number(data.seatIdx);
      if (st.phase !== 'waiting' || !Number.isInteger(seatIdx) || seatIdx < 0 || seatIdx >= SEATS) return;
      if (st.seats[seatIdx] !== null) return;
      if (st.seats.includes(ctx.senderId)) return;
      st.seats[seatIdx] = ctx.senderId;
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'leaveSeat') {
      const idx = st.seats.indexOf(ctx.senderId);
      if (idx === -1) return;
      st.seats[idx] = null;
      st.phase = 'waiting';
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'startGame') {
      if (st.phase !== 'waiting' || !st.seats.every((s) => s !== null)) return;
      st.scores = [0, 0, 0, 0];
      st.handNumber = 0;
      st.winnerSeat = null;
      dealNewHand(st);
      broadcastState(room, ctx);
      return;
    }

    const mySeatIdx = st.seats.indexOf(ctx.senderId);

    if (data.kind === 'submitPass') {
      if (st.phase !== 'passing' || mySeatIdx === -1) return;
      if (st.passSubmissions[mySeatIdx]) return; // already submitted
      const indices = Array.isArray(data.cardIndices) ? data.cardIndices : [];
      if (indices.length !== 3) return reject(ctx, 'must_pass_three');
      const hand = st.hands[mySeatIdx];
      const uniqueIndices = [...new Set(indices)];
      if (uniqueIndices.length !== 3 || uniqueIndices.some((i) => !Number.isInteger(i) || i < 0 || i >= hand.length)) {
        return reject(ctx, 'invalid_cards');
      }
      const cards = uniqueIndices.map((i) => hand[i]);
      st.passSubmissions[mySeatIdx] = cards;

      if (st.passSubmissions.every((p) => p !== null)) {
        // All submitted — remove chosen cards from hands, then distribute to targets together.
        for (let seat = 0; seat < SEATS; seat++) {
          for (const card of st.passSubmissions[seat]) {
            const hIdx = st.hands[seat].findIndex((c) => cardsEqual(c, card));
            if (hIdx !== -1) st.hands[seat].splice(hIdx, 1);
          }
        }
        for (let seat = 0; seat < SEATS; seat++) {
          const target = passTargetSeat(seat, st.passDirection);
          st.hands[target].push(...st.passSubmissions[seat]);
        }
        st.phase = 'playing';
        const leader = findTwoOfClubsSeat(st.hands);
        startNextTrick(st, leader);
      }
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'play') {
      if (st.phase !== 'playing' || mySeatIdx === -1 || st.turnSeat !== mySeatIdx) return;
      const cardIdx = Number(data.cardIndex);
      const hand = st.hands[mySeatIdx];
      if (!Number.isInteger(cardIdx) || cardIdx < 0 || cardIdx >= hand.length) return;
      const card = hand[cardIdx];
      const legal = legalCards(st, mySeatIdx);
      if (!legal.some((c) => cardsEqual(c, card))) return reject(ctx, 'illegal_card');

      hand.splice(cardIdx, 1);
      st.currentTrick.push({ seatIdx: mySeatIdx, card });
      if (isHeart(card)) st.heartsBroken = true;

      if (st.currentTrick.length < SEATS) {
        st.turnSeat = (mySeatIdx + 1) % SEATS;
        broadcastState(room, ctx);
        return;
      }

      // Trick complete.
      const winnerSeat = trickWinnerSeat(st.currentTrick);
      st.tricksTaken[winnerSeat].push(...st.currentTrick.map((e) => e.card));
      st.lastTrick = st.currentTrick;
      st.lastTrickWinnerSeat = winnerSeat;
      st.firstTrick = false;

      if (st.hands.every((h) => h.length === 0)) {
        finishHand(st);
      } else {
        startNextTrick(st, winnerSeat);
      }
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'nextHand') {
      if (st.phase !== 'hand_over') return;
      st.handNumber += 1;
      dealNewHand(st);
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'resetGame') {
      if (st.phase !== 'game_over') return;
      st.scores = [0, 0, 0, 0];
      st.handNumber = 0;
      st.winnerSeat = null;
      dealNewHand(st);
      broadcastState(room, ctx);
    }
  },
};
