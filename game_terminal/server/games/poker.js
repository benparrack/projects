// Texas Hold'em cash table, 2-6 players, $1/$2 blinds, in the CASINO: you sit down with a buy-in
// from your casino balance (room.wallet, see server/casino/wallet.js) and standing up cashes your
// stack back out. Hands deal on their own a few seconds apart. Bots play with house money. Full
// side-pot handling for multi-way all-ins and a standard 7-card hand evaluator.
//
// Deliberate simplifications for a casual friend implementation: no antes; minimum raise is
// always "current bet + one big blind" rather than tracking the exact previous raise size; an
// all-in for less than a full min-raise still reopens action for players yet to act on this
// street (a minor deviation from strict tournament rules that doesn't matter for casual play).

const { createDeck, shuffle, rankValue } = require('./cardCommon');

const MAX_SEATS = 6;
const SMALL_BLIND = 1;
const BIG_BLIND = 2;
const MIN_BUY = 20; // 10 big blinds, so the daily stipend alone still gets you a seat
const MAX_BUY = 200; // 100 big blinds
const BOT_BUY = 200; // house money
const NEXT_HAND_MS = 6000; // the result stays up this long before the next deal
const START_MS = 3000; // a fresh table waits this long after the second seat fills

let clock = () => Date.now();
const { isBotId: isBot } = require('./tickBots');

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

  const funded = (i) => st.chips[i] > 0;
  const headsUp = st.chips.filter((c) => c > 0).length === 2;
  const sbIdx = headsUp ? st.dealerIdx : nextActiveSeat(st, st.dealerIdx, funded);
  const bbIdx = nextActiveSeat(st, sbIdx, funded);
  postBlind(sbIdx, SMALL_BLIND);
  postBlind(bbIdx, BIG_BLIND);
  h.currentBet = BIG_BLIND;
  h.toAct = nextActiveSeat(st, bbIdx, (i) => !h.folded[i] && !h.allIn[i]);
  st.phase = 'playing';
  // Blinds alone can force every remaining player all-in (e.g. two short stacks posting SB/BB),
  // leaving no one able to act — nextActiveSeat then returns -1. Without this, the hand would
  // sit in phase 'playing' with toAct: -1 forever: every action handler requires
  // seatIdx === st.hand.toAct, which no real seat index ever satisfies, so the game hangs
  // permanently with no path to hand_over/nextHand. Resolve straight to showdown instead, same
  // as the mid-hand case in afterAction.
  if (h.toAct === -1) fastForwardToShowdown(st);
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
  endHand(st, payouts);
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
  endHand(st, payouts);
}

function endHand(st, payouts) {
  st.phase = 'hand_over';
  st.nextAt = clock() + NEXT_HAND_MS;
  st.seats.forEach((id, i) => {
    const put = st.hand.totalContributed[i];
    if (put > 0) st.moneyNotes.push({ id, wagered: put, won: payouts[i] - put });
  });
}

// Between hands: drop the seats people left, top up broke bots with house money, move the
// button, and deal if two stacks can play.
function deal(st) {
  for (const id of st.leaving) {
    const i = st.seats.indexOf(id);
    if (i === -1) continue;
    st.seats.splice(i, 1);
    st.chips.splice(i, 1);
    if (i < st.dealerIdx) st.dealerIdx--;
  }
  st.leaving = [];
  st.seats.forEach((id, i) => { if (isBot(id) && st.chips[i] < BIG_BLIND) st.chips[i] = BOT_BUY; });
  st.nextAt = null;
  const funded = st.chips.filter((c) => c > 0).length;
  if (funded < 2 || !st.seats.some((id) => !isBot(id))) {
    st.phase = 'waiting';
    st.hand = null;
    return false;
  }
  st.dealerIdx = nextActiveSeat(st, st.hand ? st.dealerIdx : -1, (i) => st.chips[i] > 0);
  startHand(st);
  return true;
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
    leaving: st.leaving,
    flair: st.flair,
    dealerIdx: st.dealerIdx,
    nextAt: st.nextAt,
    serverNow: clock(),
    blinds: [SMALL_BLIND, BIG_BLIND],
    buyIn: [MIN_BUY, MAX_BUY],
    balance: room.wallet && forClientId ? room.wallet.balance(forClientId) : null,
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

// Keeps the wallet in step with the table: lifetime bet totals, stacks between hands (a restart
// refunds that much), and paying out whatever a player who left mid-hand won after leaving.
// Casino games don't report() results: no XP, achievements or stats from gambling.
function settleMoney(room) {
  const st = room.state;
  const w = room.wallet;
  const notes = st.moneyNotes;
  st.moneyNotes = [];
  if (!w) return;
  for (const n of notes) if (!isBot(n.id)) w.noteBet(n.id, n.wagered, n.won);
  if (st.phase === 'playing') return;
  st.seats.forEach((id, i) => {
    if (isBot(id)) return;
    if (!st.leaving.includes(id)) { w.sync(id, st.chips[i]); return; }
    if (st.chips[i] > 0) w.cashOut(id, st.chips[i]);
    st.chips[i] = 0;
  });
}

function broadcastState(room) {
  settleMoney(room);
  for (const clientId of room.clients.keys()) {
    room.sendTo(clientId, { v: 1, type: 'game.event', payload: { gameType: 'poker', data: { kind: 'state', ...buildPublicState(room, clientId) } } });
  }
}

function reject(room, id, reason) {
  if (isBot(id)) return;
  room.sendTo(id, { v: 1, type: 'game.event', payload: { gameType: 'poker', data: { kind: 'moveRejected', reason } } });
}

// Sit down (or back down, after leaving mid-hand) with a buy-in from the casino balance. Mid-hand
// arrivals sit folded until the next deal.
function sit(room, id, amount) {
  const st = room.state;
  const w = room.wallet;
  const back = st.leaving.includes(id);
  if (st.seats.includes(id) && !back) return 'already_seated';
  if (!back && st.seats.length >= MAX_SEATS) return 'table_full';
  let chips = BOT_BUY;
  if (!isBot(id)) {
    const want = Math.min(MAX_BUY, Math.max(MIN_BUY, Math.floor(Number(amount)) || MAX_BUY));
    if (w) {
      if (!w.ready(id)) return 'wallet_loading';
      if (w.balance(id) < MIN_BUY) return 'broke';
      chips = w.buyIn(id, want);
      st.flair[id] = w.flair(id);
    } else chips = want;
  }
  if (back) {
    st.leaving = st.leaving.filter((x) => x !== id);
    st.chips[st.seats.indexOf(id)] += chips;
    return null;
  }
  st.seats.push(id);
  st.chips.push(chips);
  const h = st.hand;
  if (h && st.phase === 'playing') {
    h.holeCards.push([]);
    h.folded.push(true);
    h.allIn.push(false);
    h.bets.push(0);
    h.totalContributed.push(0);
  }
  return null;
}

// Top a stack back up to the buy-in you ask for (never over the max), outside a live hand.
function rebuy(room, id, amount) {
  const st = room.state;
  const i = st.seats.indexOf(id);
  if (i === -1 || st.leaving.includes(id) || isBot(id)) return 'not_seated';
  if (st.phase === 'playing' && !st.hand.folded[i]) return 'in_hand';
  const add = Math.min(MAX_BUY - st.chips[i], Math.max(1, Math.floor(Number(amount)) || MAX_BUY));
  if (add <= 0) return 'at_max';
  const w = room.wallet;
  if (!w) { st.chips[i] += add; return null; }
  if (!w.ready(id)) return 'wallet_loading';
  const got = w.buyIn(id, add);
  if (!got) return 'broke';
  st.chips[i] += got;
  w.sync(id, st.chips[i]);
  return null;
}

// Stand up: chips behind go straight back to the balance; a live hand is folded unless it's
// all-in (that one plays out and anything it wins is paid out when the hand ends).
function leave(room, id) {
  const st = room.state;
  const i = st.seats.indexOf(id);
  if (i === -1 || st.leaving.includes(id)) return 'not_seated';
  if (room.wallet && !isBot(id)) room.wallet.cashOut(id, st.chips[i]);
  st.chips[i] = 0;
  const h = st.hand;
  if (st.phase !== 'playing' || !h) {
    st.seats.splice(i, 1);
    st.chips.splice(i, 1);
    if (i < st.dealerIdx) st.dealerIdx--;
    if (st.chips.filter((c) => c > 0).length < 2) { st.phase = 'waiting'; st.hand = null; st.nextAt = null; }
    return null;
  }
  st.leaving.push(id);
  if (h.folded[i] || h.allIn[i]) return null;
  h.folded[i] = true;
  if (h.toAct === i) afterAction(st);
  else if (activeSeats(st).length === 1) concludeHandByFold(st, activeSeats(st)[0]);
  return null;
}

module.exports = {
  type: 'poker',
  casino: true,
  stats: { none: true },
  tickIntervalMs: 500,
  HAND_NAMES,
  evaluate7,
  compareHandTuples,

  createInitialState() {
    return { phase: 'waiting', seats: [], chips: [], dealerIdx: 0, hand: null, leaving: [], nextAt: null, moneyNotes: [], flair: {} };
  },

  isRoomFull() {
    return false; // spectators welcome; seats are capped in sit()
  },

  serializeSnapshot(room, client) {
    return buildPublicState(room, client ? client.clientId : null);
  },

  // Deals the next hand on its own: a few seconds after a hand ends, or after a second stack sits.
  tick(room) {
    const st = room.state;
    if (st.phase === 'playing') return;
    const now = clock();
    if (st.nextAt == null) {
      if (st.phase === 'waiting' && st.chips.filter((c) => c > 0).length >= 2 && st.seats.some((id) => !isBot(id))) { st.nextAt = now + START_MS; broadcastState(room); }
      return;
    }
    if (now < st.nextAt) return;
    deal(st);
    broadcastState(room);
  },

  onLeave(room, client) {
    leave(room, client.clientId);
    // Nobody human left: bots stand up too.
    if (![...room.clients.keys()].some((id) => !isBot(id))) for (const id of room.state.seats.filter(isBot)) leave(room, id);
    broadcastState(room);
  },

  onMessage(room, client, data, ctx) {
    if (!data || typeof data.kind !== 'string') return;
    const st = room.state;
    const id = ctx.senderId;
    let err = null;
    if (data.kind === 'sit') err = sit(room, id, data.amount);
    else if (data.kind === 'rebuy') err = rebuy(room, id, data.amount);
    else if (data.kind === 'leaveSeat') err = leave(room, id);
    else if (data.kind === 'startGame' || data.kind === 'nextHand') {
      // "Deal now": skip the wait (bots press it once they've seen the result).
      if (st.phase === 'playing' || !st.seats.includes(id)) return;
      if (!deal(st)) err = 'need_players';
    } else err = act(st, st.seats.indexOf(id), data);
    if (err) { reject(room, id, err); return; }
    broadcastState(room);
  },

  _internal: { evaluate7, compareHandTuples, BIG_BLIND },
  _test: { setClock(fn) { clock = fn; }, SMALL_BLIND, BIG_BLIND, MIN_BUY, MAX_BUY, BOT_BUY, NEXT_HAND_MS, START_MS },
};

// fold / check / call / raise for the seat to act. Returns an error string or null.
function act(st, seatIdx, data) {
  if (seatIdx === -1 || st.phase !== 'playing' || !st.hand || seatIdx !== st.hand.toAct) return 'not_your_turn';
  const h = st.hand;

  if (data.kind === 'fold') {
    h.folded[seatIdx] = true;
    h.actedThisRound.add(seatIdx);
    afterAction(st);
    return null;
  }

  if (data.kind === 'check') {
    if (h.bets[seatIdx] !== h.currentBet) return 'cannot_check';
    h.actedThisRound.add(seatIdx);
    afterAction(st);
    return null;
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
    return null;
  }

  if (data.kind === 'raise') {
    const raiseTo = Math.floor(Number(data.amount));
    if (!Number.isFinite(raiseTo)) return 'bad_amount';
    const maxPossible = h.bets[seatIdx] + st.chips[seatIdx];
    const minLegal = Math.min(h.currentBet + BIG_BLIND, maxPossible);
    const target = Math.min(raiseTo, maxPossible);
    if (target < minLegal || target <= h.currentBet) return 'bad_amount';
    const pay = target - h.bets[seatIdx];
    st.chips[seatIdx] -= pay;
    h.bets[seatIdx] = target;
    h.totalContributed[seatIdx] += pay;
    h.currentBet = target;
    if (st.chips[seatIdx] === 0) h.allIn[seatIdx] = true;
    // A raise reopens the action — everyone else must act again on this new bet level.
    h.actedThisRound = new Set([seatIdx]);
    afterAction(st);
    return null;
  }
  return 'unknown';
}
