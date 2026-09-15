// Texas Hold'em — 2-6 players, fixed blinds, chip stacks persist across hands within one game
// (a "game" ends when only one player still has chips). Full side-pot handling for multi-way
// all-ins and a standard 7-card hand evaluator (best 5 of hole+community).
//
// Deliberate simplifications for a casual friend implementation: no antes; minimum raise is
// always "current bet + one big blind" rather than tracking the exact previous raise size; an
// all-in for less than a full min-raise still reopens action for players yet to act on this
// street (a minor deviation from strict tournament rules that doesn't matter for casual play).

const { createDeck, shuffle, rankValue } = require('./cardCommon');

const MIN_SEATS = 2;
const MAX_SEATS = 6;
const STARTING_CHIPS = 1000;
const SMALL_BLIND = 10;
const BIG_BLIND = 20;

// --- Hand evaluation: returns a comparable tuple [category, ...tiebreakers], higher = better ---

function evaluate5(cards) {
  const values = cards.map((c) => rankValue(c.rank)).sort((a, b) => b - a);
  const isFlush = cards.every((c) => c.suit === cards[0].suit);
  const uniqueVals = [...new Set(values)];
  let isStraight = false;
  let straightHigh = null;
  if (uniqueVals.length === 5) {
    if (uniqueVals[0] - uniqueVals[4] === 4) {
      isStraight = true;
      straightHigh = uniqueVals[0];
    } else if (uniqueVals.join(',') === '14,5,4,3,2') {
      // wheel: A-2-3-4-5, ace plays low
      isStraight = true;
      straightHigh = 5;
    }
  }
  const freq = new Map();
  for (const v of values) freq.set(v, (freq.get(v) || 0) + 1);
  const groups = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);

  if (isStraight && isFlush) return [8, straightHigh];
  if (groups[0][1] === 4) return [7, groups[0][0], groups[1][0]];
  if (groups[0][1] === 3 && groups[1][1] === 2) return [6, groups[0][0], groups[1][0]];
  if (isFlush) return [5, ...values];
  if (isStraight) return [4, straightHigh];
  if (groups[0][1] === 3) return [3, groups[0][0], ...groups.slice(1).map((g) => g[0])];
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    const pairs = [groups[0][0], groups[1][0]].sort((a, b) => b - a);
    return [2, pairs[0], pairs[1], groups[2][0]];
  }
  if (groups[0][1] === 2) return [1, groups[0][0], ...groups.slice(1).map((g) => g[0])];
  return [0, ...values];
}

function compareHandTuples(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] ?? -1;
    const bv = b[i] ?? -1;
    if (av !== bv) return av - bv;
  }
  return 0;
}

function combinations5(cards7) {
  const out = [];
  const chosen = [];
  (function rec(start) {
    if (chosen.length === 5) {
      out.push(chosen.slice());
      return;
    }
    for (let i = start; i < cards7.length; i++) {
      chosen.push(cards7[i]);
      rec(i + 1);
      chosen.pop();
    }
  })(0);
  return out;
}

function evaluate7(cards7) {
  let best = null;
  for (const combo of combinations5(cards7)) {
    const val = evaluate5(combo);
    if (!best || compareHandTuples(val, best) > 0) best = val;
  }
  return best;
}

const HAND_NAMES = ['High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush'];

// --- Side pots: given per-seat total contributions this hand and who folded, split into layered
// pots so an all-in player only ever contests money up to what they put in. ---
function buildSidePots(totalContributed, folded) {
  const players = totalContributed.map((amt, seat) => ({ seat, amt, folded: folded[seat] })).filter((p) => p.amt > 0);
  const levels = [...new Set(players.map((p) => p.amt))].sort((a, b) => a - b);
  const pots = [];
  let prevLevel = 0;
  for (const level of levels) {
    const layer = level - prevLevel;
    const contributors = players.filter((p) => p.amt >= level);
    const amount = layer * contributors.length;
    if (amount > 0) {
      const eligibleSeats = contributors.filter((p) => !p.folded).map((p) => p.seat);
      pots.push({ amount, eligibleSeats });
    }
    prevLevel = level;
  }
  return pots;
}

// --- Game state helpers ---

function activeSeats(st) {
  return st.hand.folded.map((f, i) => i).filter((i) => !st.hand.folded[i]);
}

function contestants(st) {
  // Non-folded AND not all-in — the players who still have a decision to make this street.
  return activeSeats(st).filter((i) => !st.hand.allIn[i]);
}

function nextActiveSeat(st, fromIdx, predicate) {
  const n = st.seats.length;
  for (let step = 1; step <= n; step++) {
    const idx = (fromIdx + step) % n;
    if (predicate(idx)) return idx;
  }
  return -1;
}

function startHand(st) {
  const n = st.seats.length;
  const deck = shuffle(createDeck());
  st.hand = {
    deck,
    holeCards: st.seats.map(() => [deck.pop(), deck.pop()]),
    community: [],
    stage: 'preflop',
    folded: st.seats.map((_, i) => st.chips[i] <= 0),
    allIn: st.seats.map((_, i) => st.chips[i] <= 0),
    bets: st.seats.map(() => 0),
    totalContributed: st.seats.map(() => 0),
    currentBet: 0,
    toAct: -1,
    actedThisRound: new Set(),
    lastResult: null,
  };
  const h = st.hand;

  const postBlind = (seat, amount) => {
    const paid = Math.min(amount, st.chips[seat]);
    st.chips[seat] -= paid;
    h.bets[seat] += paid;
    h.totalContributed[seat] += paid;
    if (st.chips[seat] === 0) h.allIn[seat] = true;
  };

  const sbIdx = n === 2 ? st.dealerIdx : (st.dealerIdx + 1) % n;
  const bbIdx = n === 2 ? (st.dealerIdx + 1) % n : (st.dealerIdx + 2) % n;
  postBlind(sbIdx, SMALL_BLIND);
  postBlind(bbIdx, BIG_BLIND);
  h.currentBet = BIG_BLIND;
  h.toAct = nextActiveSeat(st, bbIdx, (i) => !h.folded[i] && !h.allIn[i]);
  st.phase = 'playing';
}

function isBettingRoundComplete(st) {
  const h = st.hand;
  const c = contestants(st);
  if (c.length === 0) return true;
  return c.every((i) => h.actedThisRound.has(i) && h.bets[i] === h.currentBet);
}

function dealStreet(st) {
  const h = st.hand;
  if (h.stage === 'preflop') {
    h.community.push(h.deck.pop(), h.deck.pop(), h.deck.pop());
    h.stage = 'flop';
  } else if (h.stage === 'flop') {
    h.community.push(h.deck.pop());
    h.stage = 'turn';
  } else if (h.stage === 'turn') {
    h.community.push(h.deck.pop());
    h.stage = 'river';
  }
  h.bets = st.seats.map(() => 0);
  h.currentBet = 0;
  h.actedThisRound = new Set();
  const c = contestants(st);
  h.toAct = c.length ? nextActiveSeat(st, st.dealerIdx, (i) => !h.folded[i] && !h.allIn[i]) : -1;
}

function awardPots(st) {
  const h = st.hand;
  const pots = buildSidePots(h.totalContributed, h.folded);
  const payouts = st.seats.map(() => 0);
  for (const pot of pots) {
    if (pot.eligibleSeats.length === 1) {
      payouts[pot.eligibleSeats[0]] += pot.amount;
      continue;
    }
    let bestVal = null;
    let winners = [];
    for (const seat of pot.eligibleSeats) {
      const val = evaluate7([...h.holeCards[seat], ...h.community]);
      const cmp = bestVal ? compareHandTuples(val, bestVal) : 1;
      if (!bestVal || cmp > 0) {
        bestVal = val;
        winners = [seat];
      } else if (cmp === 0) {
        winners.push(seat);
      }
    }
    const share = Math.floor(pot.amount / winners.length);
    let remainder = pot.amount - share * winners.length;
    for (const seat of winners) {
      payouts[seat] += share + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder--;
    }
  }
  for (let i = 0; i < st.seats.length; i++) st.chips[i] += payouts[i];
  return payouts;
}

function concludeHandByFold(st, winnerSeat) {
  const h = st.hand;
  const payouts = st.seats.map(() => 0);
  const total = h.totalContributed.reduce((a, b) => a + b, 0);
  payouts[winnerSeat] = total;
  st.chips[winnerSeat] += total;
  h.lastResult = { kind: 'fold', winnerSeat, payouts, revealedHands: [] };
  st.phase = 'hand_over';
  checkGameOver(st);
}

function concludeHandByShowdown(st) {
  const h = st.hand;
  const payouts = awardPots(st);
  const revealedHands = activeSeats(st).map((seat) => ({
    seat,
    cards: h.holeCards[seat],
    best: evaluate7([...h.holeCards[seat], ...h.community]),
  }));
  h.lastResult = { kind: 'showdown', payouts, revealedHands };
  st.phase = 'hand_over';
  checkGameOver(st);
}

function checkGameOver(st) {
  const stillIn = st.seats.map((_, i) => i).filter((i) => st.chips[i] > 0);
  if (stillIn.length <= 1) {
    st.phase = 'game_over';
    st.winnerSeat = stillIn.length === 1 ? stillIn[0] : null;
  }
}

// Runs remaining streets straight through with no further betting once every non-folded player
// left is all-in — there's no one left who could act, so waiting for actions would hang forever.
function fastForwardToShowdown(st) {
  const h = st.hand;
  while (h.stage !== 'river') dealStreet(st);
  concludeHandByShowdown(st);
}

function afterAction(st) {
  const h = st.hand;
  const active = activeSeats(st);
  if (active.length === 1) {
    concludeHandByFold(st, active[0]);
    return;
  }
  if (!isBettingRoundComplete(st)) {
    st.hand.toAct = nextActiveSeat(st, st.hand.toAct, (i) => !h.folded[i] && !h.allIn[i]);
    return;
  }
  if (contestants(st).length <= 1) {
    fastForwardToShowdown(st);
    return;
  }
  if (h.stage === 'river') {
    concludeHandByShowdown(st);
    return;
  }
  dealStreet(st);
}

function buildPublicState(room, forClientId) {
  const st = room.state;
  const mySeatIdx = st.seats.indexOf(forClientId);
  const h = st.hand;
  return {
    phase: st.phase,
    seats: st.seats,
    chips: st.chips,
    dealerIdx: st.dealerIdx,
    winnerSeat: st.winnerSeat,
    hand: h
      ? {
          stage: h.stage,
          community: h.community,
          bets: h.bets,
          totalContributed: h.totalContributed,
          folded: h.folded,
          allIn: h.allIn,
          currentBet: h.currentBet,
          toAct: h.toAct,
          myHoleCards: mySeatIdx !== -1 ? h.holeCards[mySeatIdx] : [],
          lastResult: h.lastResult,
          potTotal: h.totalContributed.reduce((a, b) => a + b, 0),
        }
      : null,
  };
}

function broadcastState(room, ctx) {
  for (const clientId of room.clients.keys()) {
    ctx.sendTo(clientId, { v: 1, type: 'game.event', payload: { gameType: 'poker', data: { kind: 'state', ...buildPublicState(room, clientId) } } });
  }
}

module.exports = {
  type: 'poker',
  HAND_NAMES,
  evaluate5,
  evaluate7,
  compareHandTuples,
  buildSidePots,

  createInitialState() {
    return { phase: 'waiting', seats: [], chips: [], dealerIdx: 0, winnerSeat: null, hand: null };
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
    st.chips.splice(idx, 1);
    st.phase = 'waiting';
    st.hand = null;
    for (const clientId of room.clients.keys()) {
      room.sendTo(clientId, { v: 1, type: 'game.event', payload: { gameType: 'poker', data: { kind: 'state', ...buildPublicState(room, clientId) } } });
    }
  },

  onMessage(room, client, data, ctx) {
    if (!data || typeof data.kind !== 'string') return;
    const st = room.state;

    if (data.kind === 'sit') {
      if (st.phase !== 'waiting' || st.seats.length >= MAX_SEATS || st.seats.includes(ctx.senderId)) return;
      st.seats.push(ctx.senderId);
      st.chips.push(STARTING_CHIPS);
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'leaveSeat') {
      const idx = st.seats.indexOf(ctx.senderId);
      if (idx === -1) return;
      st.seats.splice(idx, 1);
      st.chips.splice(idx, 1);
      st.phase = 'waiting';
      st.hand = null;
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'startGame') {
      if (st.phase !== 'waiting' || st.seats.length < MIN_SEATS) return;
      st.dealerIdx = 0;
      st.winnerSeat = null;
      startHand(st);
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'resetGame') {
      if (st.phase !== 'game_over') return;
      if (st.seats.length >= MIN_SEATS) {
        st.chips = st.seats.map(() => STARTING_CHIPS);
        st.dealerIdx = 0;
        st.winnerSeat = null;
        startHand(st);
      } else {
        st.phase = 'waiting';
      }
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'nextHand') {
      if (st.phase !== 'hand_over') return;
      st.dealerIdx = (st.dealerIdx + 1) % st.seats.length;
      startHand(st);
      broadcastState(room, ctx);
      return;
    }

    const seatIdx = st.seats.indexOf(ctx.senderId);
    if (seatIdx === -1 || st.phase !== 'playing' || !st.hand || seatIdx !== st.hand.toAct) return;
    const h = st.hand;

    if (data.kind === 'fold') {
      h.folded[seatIdx] = true;
      h.actedThisRound.add(seatIdx);
      afterAction(st);
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'check') {
      if (h.bets[seatIdx] !== h.currentBet) return;
      h.actedThisRound.add(seatIdx);
      afterAction(st);
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'call') {
      const need = h.currentBet - h.bets[seatIdx];
      const pay = Math.min(need, st.chips[seatIdx]);
      st.chips[seatIdx] -= pay;
      h.bets[seatIdx] += pay;
      h.totalContributed[seatIdx] += pay;
      if (st.chips[seatIdx] === 0) h.allIn[seatIdx] = true;
      h.actedThisRound.add(seatIdx);
      afterAction(st);
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'raise') {
      const raiseTo = Number(data.amount);
      if (!Number.isFinite(raiseTo)) return;
      const maxPossible = h.bets[seatIdx] + st.chips[seatIdx];
      const minLegal = Math.min(h.currentBet + BIG_BLIND, maxPossible);
      const target = Math.min(raiseTo, maxPossible);
      if (target < minLegal || target <= h.currentBet) return;
      const pay = target - h.bets[seatIdx];
      st.chips[seatIdx] -= pay;
      h.bets[seatIdx] = target;
      h.totalContributed[seatIdx] += pay;
      h.currentBet = target;
      if (st.chips[seatIdx] === 0) h.allIn[seatIdx] = true;
      // A raise reopens the action — everyone else must act again on this new bet level.
      h.actedThisRound = new Set([seatIdx]);
      afterAction(st);
      broadcastState(room, ctx);
    }
  },
};
