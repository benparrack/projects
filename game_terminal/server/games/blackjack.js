// Blackjack — 1-6 seats against a server dealer. Casino rules:
//   6-deck shoe, cut card at 75% penetration (reshuffle before the next round), dealer stands on
//   soft 17 and peeks for blackjack under an ace or a ten, blackjack pays 3:2, insurance 2:1 when
//   the dealer shows an ace, double on any first two cards (also after a split), split equal-value
//   pairs up to 4 hands, split aces get one card each and can't be re-split, no surrender.
// A casino game: sitting down brings your whole casino balance to the table (room.wallet, see
// server/casino/wallet.js) and standing up — once any hand you still have in play settles — takes
// the stack back. No free rebuys; broke players earn more in the casino lobby. Bots play on house
// money and do rebuy. Without room.wallet (unit tests) a seat starts with START_BANKROLL.
//
// Everything time-based (dealing one card at a time, betting/insurance/turn timers, the dealer
// drawing, bot "thinking") runs off the room tick, so there are no free-running timers that could
// fire into a reset or destroyed room. The only hidden information is the dealer's hole card and
// the shoe, and neither ever leaves the server until revealed: every client gets the same view.
//
// Messages (data.kind): sit, leaveSeat, addBot {level}, removeBot {seat}, bet {amount}, clearBet,
// rebet, deal, insurance {take}, hit, stand, double, split, continue.

'use strict';

const { createDeck, shuffle } = require('./cardCommon');
const { normLevel } = require('./ai/levels');

const TYPE = 'blackjack';
const MAX_SEATS = 6;
const DECKS = 6;
const PENETRATION = 0.75;
const START_BANKROLL = 1000; // test tables only (no wallet)
const BOT_BANKROLL = 250;
const MIN_BET = 2;
const MAX_BET = 1000;
const CHIPS = [1, 5, 10, 25, 50, 100, 250, 500, 1000]; // same set as roulette and slots
const LIMITS = { type: TYPE, min: MIN_BET, max: MAX_BET, chips: CHIPS, bot: BOT_BANKROLL, vip: false };
// The high-roller room: same game, bigger chips, and you need $1,000+ or the VIP key to sit.
const HIGH_ROLLER = { type: 'blackjack_hr', min: 25, max: 2500, chips: [25, 50, 100, 250, 500, 1000], bot: 5000, vip: true };
const MAX_HANDS = 4;

const BET_MS = 15000; // after the first chip goes down
const INS_MS = 10000;
const TURN_MS = 20000;
const SHOE_OVER_MS = 25000;
const DEAL_STEP_MS = 340;
const DEALER_STEP_MS = 650;
const SETTLE_MS = 4500;
const PEEK_MS = 900;

const BOT_NAMES = ['Ace', 'Byte', 'Chip', 'Dot', 'Echo', 'Flux', 'Gizmo'];
const isBot = (id) => typeof id === 'string' && id.startsWith('bot-');
const botLevelOf = (id) => normLevel(String(id).split('~')[1]);
const botBase = (id) => id.slice(4).split('~')[0];

let clock = () => Date.now();
let rng = Math.random;

// ---------------------------------------------------------------------------------------------
// Card math

const cardValue = (c) => (c.rank === 'A' ? 11 : ['10', 'J', 'Q', 'K'].includes(c.rank) ? 10 : Number(c.rank));

function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (!c) continue;
    total += cardValue(c);
    if (c.rank === 'A') aces++;
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return { total, soft: aces > 0 };
}

const hiLo = (c) => { const v = cardValue(c); return v <= 6 ? 1 : v >= 10 ? -1 : 0; };
const isNatural = (hand) => hand.cards.length === 2 && !hand.fromSplit && handValue(hand.cards).total === 21;

// Basic strategy for 6 decks, S17, double after split, no surrender. `up` is the dealer upcard
// value (2-11). Returns 'hit' | 'stand' | 'double' | 'split'. Mirrored in
// public/games/blackjack/strategy.js for the client hint (the test checks they agree).
function basicStrategy(cards, up, { canDouble = true, canSplit = true } = {}) {
  const { total, soft } = handValue(cards);
  if (canSplit && cards.length === 2 && cardValue(cards[0]) === cardValue(cards[1])) {
    const p = cardValue(cards[0]);
    const split =
      p === 11 || p === 8 ||
      (p === 9 && up !== 7 && up !== 10 && up !== 11) ||
      ((p === 7 || p === 3 || p === 2) && up <= 7) ||
      (p === 6 && up <= 6) ||
      (p === 4 && (up === 5 || up === 6));
    if (split) return 'split';
  }
  const dbl = (cond, otherwise) => (cond ? (canDouble ? 'double' : otherwise) : null);
  if (soft && total <= 21 && cards.length >= 2) {
    if (total >= 19) return 'stand';
    if (total === 18) return dbl(up >= 3 && up <= 6, 'stand') || (up <= 8 ? 'stand' : 'hit');
    if (total === 17) return dbl(up >= 3 && up <= 6, 'hit') || 'hit';
    if (total === 15 || total === 16) return dbl(up >= 4 && up <= 6, 'hit') || 'hit';
    if (total === 13 || total === 14) return dbl(up >= 5 && up <= 6, 'hit') || 'hit';
    return 'hit';
  }
  if (total >= 17) return 'stand';
  if (total >= 13) return up <= 6 ? 'stand' : 'hit';
  if (total === 12) return up >= 4 && up <= 6 ? 'stand' : 'hit';
  if (total === 11) return dbl(up <= 10, 'hit') || 'hit';
  if (total === 10) return dbl(up <= 9, 'hit') || 'hit';
  if (total === 9) return dbl(up >= 3 && up <= 6, 'hit') || 'hit';
  return 'hit';
}

// Expert bots: basic strategy plus the best-known count deviations (a subset of the Illustrious 18).
function countStrategy(cards, up, tc, opts) {
  const { total, soft } = handValue(cards);
  const pair = cards.length === 2 && cardValue(cards[0]) === cardValue(cards[1]);
  if (!soft && !(pair && opts.canSplit && cardValue(cards[0]) === 8)) {
    if (total === 16 && up === 10 && tc >= 0) return 'stand';
    if (total === 15 && up === 10 && tc >= 4) return 'stand';
    if (total === 12 && up === 3 && tc >= 2) return 'stand';
    if (total === 12 && up === 2 && tc >= 3) return 'stand';
    if (total === 13 && up === 2 && tc <= -1) return 'hit';
    if (total === 12 && up === 4 && tc < 0) return 'hit';
    if (opts.canDouble && cards.length === 2) {
      if (total === 10 && (up === 10 || up === 11) && tc >= 4) return 'double';
      if (total === 11 && up === 11 && tc >= 1) return 'double';
      if (total === 9 && up === 2 && tc >= 1) return 'double';
      if (total === 9 && up === 7 && tc >= 3) return 'double';
    }
  }
  if (pair && opts.canSplit && cardValue(cards[0]) === 10 && (up === 5 || up === 6) && tc >= 5) return 'split';
  return basicStrategy(cards, up, opts);
}

// ---------------------------------------------------------------------------------------------
// Shoe

function newShoe(st) {
  let cards = [];
  for (let d = 0; d < DECKS; d++) cards = cards.concat(createDeck());
  // shuffle() uses Math.random; tests swap `rng` so re-shuffle with it for determinism.
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  st.shoe = cards;
  st.shoeSize = cards.length;
  st.cutAt = Math.round(cards.length * (1 - PENETRATION));
  st.runningCount = 0;
  st.reshuffleNext = false;
  st.shoeNo = (st.shoeNo || 0) + 1;
  st.shoeRounds = 0;
  st.shoePlayers = []; // humans with a settled hand this shoe — who gets a result at shoe_over
  for (const p of Object.values(st.players)) p.shoeNet = 0;
}

function draw(st, visible = true) {
  if (st.shoe.length === 0) {
    // Practically unreachable (the cut card leaves 78 cards), but never crash: fresh shoe.
    newShoe(st);
  }
  const c = st.shoe.pop();
  if (st.shoe.length <= st.cutAt) st.reshuffleNext = true;
  if (visible) st.runningCount += hiLo(c);
  return c;
}

const trueCount = (st) => st.runningCount / Math.max(0.5, st.shoe.length / 52);

// ---------------------------------------------------------------------------------------------
// State

function playerRec(st, id, bankroll = 0) {
  if (!st.players[id]) {
    st.players[id] = {
      bankroll, bet: 0, ready: false, lastBet: 0, net: 0, shoeNet: 0, rebuys: 0,
      stats: { hands: 0, won: 0, lost: 0, push: 0, blackjacks: 0 },
    };
  }
  return st.players[id];
}

function createInitialState(lim) {
  const st = {
    phase: 'waiting', seats: [], players: {}, round: null, deadline: null, nextStepAt: null,
    lim, botNextAt: null, seq: 0, roundNo: 0, lastEvent: null,
    shoe: [], shoeSize: 0, cutAt: 0, runningCount: 0, reshuffleNext: false, shoeNo: 0, shoeRounds: 0,
  };
  newShoe(st);
  st.shoeNo = 1;
  return st;
}

function event(st, kind, extra = {}) {
  st.lastEvent = { id: (st.lastEvent ? st.lastEvent.id : 0) + 1, kind, ...extra };
}

function currentHand(st) {
  const r = st.round;
  if (!r || !r.turn) return null;
  const e = r.entries[r.turn.e];
  return e ? { entry: e, hand: e.hands[r.turn.h] } : null;
}

function handView(h) {
  const v = handValue(h.cards);
  return {
    cards: h.cards, bet: h.bet, doubled: h.doubled, done: h.done, result: h.result, payout: h.payout,
    total: v.total, soft: v.soft && v.total <= 21, bust: v.total > 21, natural: isNatural(h),
    fromSplit: h.fromSplit, splitAces: h.splitAces,
  };
}

function buildView(st) {
  const r = st.round;
  const shown = new Set(st.seats);
  if (r) for (const e of r.entries) shown.add(e.id);
  const players = {};
  for (const id of shown) {
    const p = st.players[id];
    if (p) players[id] = { bankroll: p.bankroll, bet: p.bet, ready: p.ready, lastBet: p.lastBet, net: p.net, shoeNet: p.shoeNet, rebuys: p.rebuys, stats: p.stats, flair: p.flair || null };
  }
  let round = null;
  if (r) {
    const dealerCards = r.dealer.cards.map((c, i) => (i === 1 && !r.dealer.revealed ? null : c));
    const dv = handValue(dealerCards);
    round = {
      entries: r.entries.map((e) => ({ id: e.id, left: !!e.left, insurance: e.insurance, insDecided: e.insDecided, hands: e.hands.map(handView) })),
      dealer: { cards: dealerCards, revealed: r.dealer.revealed, total: dv.total, soft: dv.soft && dv.total <= 21, natural: r.dealer.revealed && r.dealer.cards.length === 2 && dv.total === 21, bust: dv.total > 21 },
      turn: r.turn,
    };
  }
  return {
    phase: st.phase, seats: st.seats, players, round, deadline: st.deadline, serverNow: clock(),
    shoeLeft: st.shoe.length, shoeSize: st.shoeSize, cutAt: st.cutAt, reshuffleNext: st.reshuffleNext,
    shoeNo: st.shoeNo, shoeRounds: st.shoeRounds, roundNo: st.roundNo, seq: st.seq, lastEvent: st.lastEvent,
    minBet: st.lim.min, maxBet: st.lim.max, chips: st.lim.chips,
  };
}

// Keeps the wallet in step with the table: stacks between rounds (a restart refunds that much),
// lifetime bet totals, and cashing out anyone who stood up once nothing of theirs is in play.
// Casino games don't report() results: no XP, achievements or stats from gambling.
function settleMoney(room) {
  const st = room.state;
  const w = room.wallet;
  const notes = st.moneyNotes || [];
  st.moneyNotes = [];
  if (!w) return;
  for (const n of notes) w.noteBet(n.id, n.wagered, n.won);
  const inRound = new Set(st.round ? st.round.entries.map((e) => e.id) : []);
  for (const [id, p] of Object.entries(st.players)) {
    if (isBot(id)) continue;
    if (st.seats.includes(id)) { if (!st.round) w.sync(id, p.bankroll); continue; }
    if (inRound.has(id)) continue;
    w.cashOut(id, p.bankroll);
    delete st.players[id];
  }
}

function broadcast(room) {
  const st = room.state;
  settleMoney(room);
  st.seq++;
  room.broadcast({ v: 1, type: 'game.event', payload: { gameType: st.lim.type, data: { kind: 'state', ...buildView(st) } } });
}

function reject(room, id, reason) {
  if (isBot(id)) return;
  room.sendTo(id, { v: 1, type: 'game.event', payload: { gameType: room.state.lim.type, data: { kind: 'moveRejected', reason } } });
}

// ---------------------------------------------------------------------------------------------
// Round flow

const canAffordBet = (st, p) => p.bankroll >= st.lim.min;

function enterBetting(st) {
  st.phase = st.seats.length ? 'betting' : 'waiting';
  st.round = null;
  st.deadline = null;
  st.nextStepAt = null;
  for (const id of st.seats) {
    const p = playerRec(st, id);
    p.ready = false;
    if (p.bet > p.bankroll) p.bet = 0;
  }
}

// All seated players have either pressed DEAL or can't bet at all, and at least one is in.
function shouldStartRound(st, now) {
  if (st.phase !== 'betting') return false;
  const ps = st.seats.map((id) => playerRec(st, id));
  const anyBet = ps.some((p) => p.bet >= st.lim.min);
  if (!anyBet) return false;
  if (st.deadline != null && now >= st.deadline) return true;
  return ps.every((p) => (p.ready && p.bet >= st.lim.min) || (!canAffordBet(st, p) && p.bet === 0));
}

function startRound(st, now) {
  const entries = [];
  for (const id of st.seats) {
    const p = playerRec(st, id);
    if (p.bet < st.lim.min) { p.bet = 0; p.ready = false; continue; }
    p.bankroll -= p.bet;
    entries.push({ id, insurance: null, insDecided: false, left: false, hands: [{ cards: [], bet: p.bet, doubled: false, done: false, result: null, payout: 0, fromSplit: false, splitAces: false }] });
    p.lastBet = p.bet;
    p.bet = 0;
    p.ready = false;
  }
  if (!entries.length) { enterBetting(st); return; }
  const queue = [];
  for (let pass = 0; pass < 2; pass++) {
    entries.forEach((_, i) => queue.push({ e: i }));
    queue.push({ dealer: true, hole: pass === 1 });
  }
  st.round = { entries, dealer: { cards: [], revealed: false }, turn: null, queue };
  st.roundNo++;
  st.phase = 'dealing';
  st.deadline = null;
  st.nextStepAt = now + DEAL_STEP_MS;
  event(st, 'deal');
}

function dealStep(st, now) {
  const r = st.round;
  const t = r.queue.shift();
  if (t.dealer) r.dealer.cards.push(draw(st, !t.hole));
  else r.entries[t.e].hands[0].cards.push(draw(st));
  if (r.queue.length) { st.nextStepAt = now + DEAL_STEP_MS; return; }
  st.nextStepAt = null;
  const up = r.dealer.cards[0];
  if (up.rank === 'A') {
    st.phase = 'insurance';
    st.deadline = now + INS_MS;
    for (const e of r.entries) {
      const p = playerRec(st, e.id);
      if (p.bankroll < e.hands[0].bet / 2 || e.left) { e.insDecided = true; e.insurance = 0; }
    }
    event(st, 'insurance');
    if (r.entries.every((e) => e.insDecided)) finishInsurance(st, now);
  } else if (cardValue(up) === 10) {
    peek(st, now);
  } else {
    beginPlay(st, now);
  }
}

function finishInsurance(st, now) {
  const r = st.round;
  for (const e of r.entries) {
    if (!e.insDecided) { e.insDecided = true; e.insurance = 0; }
  }
  st.deadline = null;
  peek(st, now);
}

// Dealer checks the hole card for blackjack (only under an ace or a ten).
function peek(st, now) {
  const r = st.round;
  const dealerBJ = handValue(r.dealer.cards).total === 21;
  if (dealerBJ) {
    revealHole(st);
    event(st, 'dealerBlackjack');
    settle(st, now);
    return;
  }
  for (const e of r.entries) {
    if (e.insurance > 0) {
      const p = playerRec(st, e.id);
      p.net -= e.insurance;
      p.shoeNet -= e.insurance;
    }
  }
  event(st, 'peek');
  st.phase = 'peek';
  st.nextStepAt = now + PEEK_MS;
}

function revealHole(st) {
  const r = st.round;
  if (r.dealer.revealed) return;
  r.dealer.revealed = true;
  st.runningCount += hiLo(r.dealer.cards[1]);
}

function beginPlay(st, now) {
  const r = st.round;
  st.phase = 'playing';
  for (const e of r.entries) {
    for (const h of e.hands) if (isNatural(h)) h.done = true;
    if (e.left) for (const h of e.hands) h.done = true;
  }
  r.turn = { e: 0, h: -1 };
  advance(st, now);
}

// Move the turn to the next unfinished hand, dealing a split hand its second card on arrival.
function advance(st, now) {
  const r = st.round;
  let { e, h } = r.turn || { e: 0, h: -1 };
  h++;
  for (; e < r.entries.length; e++, h = 0) {
    const entry = r.entries[e];
    for (; h < entry.hands.length; h++) {
      const hand = entry.hands[h];
      if (entry.left) hand.done = true;
      if (hand.done) continue;
      if (hand.cards.length === 1) {
        hand.cards.push(draw(st));
        if (handValue(hand.cards).total === 21) { hand.done = true; continue; }
      }
      r.turn = { e, h };
      st.deadline = now + TURN_MS;
      return;
    }
  }
  r.turn = null;
  st.deadline = null;
  startDealer(st, now);
}

function startDealer(st, now) {
  const r = st.round;
  st.phase = 'dealer';
  revealHole(st);
  event(st, 'reveal');
  const live = r.entries.some((e) => e.hands.some((h) => handValue(h.cards).total <= 21 && !isNatural(h)));
  r.dealerDraws = live;
  st.nextStepAt = now + DEALER_STEP_MS;
}

function dealerStep(st, now) {
  const r = st.round;
  if (r.dealerDraws && handValue(r.dealer.cards).total < 17) {
    r.dealer.cards.push(draw(st));
    st.nextStepAt = now + DEALER_STEP_MS;
    return;
  }
  settle(st, now);
}

function settle(st, now) {
  const r = st.round;
  const d = handValue(r.dealer.cards).total;
  const dealerBJ = r.dealer.cards.length === 2 && d === 21;
  for (const e of r.entries) {
    const p = playerRec(st, e.id);
    if (!isBot(e.id) && !st.shoePlayers.includes(e.id)) st.shoePlayers.push(e.id);
    let delta = 0;
    if (e.insurance > 0 && dealerBJ) {
      p.bankroll += e.insurance * 3;
      delta += e.insurance * 2;
    }
    for (const h of e.hands) {
      const v = handValue(h.cards).total;
      const nat = isNatural(h);
      let res;
      if (v > 21) res = 'bust';
      else if (nat && dealerBJ) res = 'push';
      else if (nat) res = 'blackjack';
      else if (dealerBJ) res = 'lose';
      else if (d > 21 || v > d) res = 'win';
      else if (v === d) res = 'push';
      else res = 'lose';
      const ret = res === 'blackjack' ? h.bet * 2.5 : res === 'win' ? h.bet * 2 : res === 'push' ? h.bet : 0;
      h.result = res;
      h.payout = ret - h.bet;
      h.done = true;
      p.bankroll += ret;
      delta += ret - h.bet;
      p.stats.hands++;
      if (res === 'blackjack') { p.stats.blackjacks++; p.stats.won++; } else if (res === 'win') p.stats.won++;
      else if (res === 'push') p.stats.push++;
      else p.stats.lost++;
    }
    p.net += delta;
    p.shoeNet += delta;
    if (!isBot(e.id)) {
      const wagered = e.hands.reduce((a, h) => a + h.bet, 0) + (e.insurance || 0);
      (st.moneyNotes = st.moneyNotes || []).push({ id: e.id, wagered, won: Math.max(0, delta) });
    }
    p.bankroll = Math.round(p.bankroll * 2) / 2;
  }
  r.turn = null;
  st.phase = 'settle';
  st.deadline = null;
  st.shoeRounds++;
  st.nextStepAt = now + SETTLE_MS;
  event(st, 'settle');
}

function afterSettle(st, now) {
  st.nextStepAt = null;
  for (const id of Object.keys(st.players)) if (isBot(id) && !st.seats.includes(id)) delete st.players[id];
  // Broke bots buy back in so a bot table never stalls.
  for (const id of st.seats) {
    const p = playerRec(st, id);
    if (isBot(id) && p.bankroll < st.lim.min) { p.bankroll += st.lim.bot; p.rebuys++; }
  }
  if (st.reshuffleNext) {
    st.round = null;
    if (st.seats.length && st.shoeRounds > 0) {
      st.phase = 'shoe_over';
      st.deadline = now + SHOE_OVER_MS;
      event(st, 'shoeOver');
      return;
    }
    newShoe(st);
    event(st, 'shuffle');
  }
  enterBetting(st);
}

function endShoeOver(st) {
  newShoe(st);
  event(st, 'shuffle');
  enterBetting(st);
}

// Run any due timers (several may be due at once after a slow tick). Returns true if anything fired.
function step(st, now) {
  let changed = false;
  for (let guard = 0; guard < 50; guard++) {
    const due = (t) => t != null && now >= t;
    if (st.phase === 'betting' && shouldStartRound(st, now)) startRound(st, now);
    else if (st.phase === 'dealing' && due(st.nextStepAt)) dealStep(st, now);
    else if (st.phase === 'insurance' && due(st.deadline)) finishInsurance(st, now);
    else if (st.phase === 'peek' && due(st.nextStepAt)) beginPlay(st, now);
    else if (st.phase === 'playing' && due(st.deadline)) autoStand(st, now);
    else if (st.phase === 'dealer' && due(st.nextStepAt)) dealerStep(st, now);
    else if (st.phase === 'settle' && due(st.nextStepAt)) afterSettle(st, now);
    else if (st.phase === 'shoe_over' && due(st.deadline)) endShoeOver(st);
    else break;
    changed = true;
  }
  return changed;
}

function autoStand(st, now) {
  const cur = currentHand(st);
  if (!cur) { advance(st, now); return; }
  cur.hand.done = true;
  event(st, 'timeout', { who: cur.entry.id });
  advance(st, now);
}

// ---------------------------------------------------------------------------------------------
// Player actions (validated; shared by humans and bots)

function canSplitHand(st, entry, hand) {
  const p = playerRec(st, entry.id);
  return hand.cards.length === 2 && cardValue(hand.cards[0]) === cardValue(hand.cards[1]) &&
    entry.hands.length < MAX_HANDS && p.bankroll >= hand.bet && !(hand.splitAces);
}
function canDoubleHand(st, entry, hand) {
  return hand.cards.length === 2 && !hand.splitAces && playerRec(st, entry.id).bankroll >= hand.bet;
}

// Returns null on success or a rejection reason.
function act(st, id, data, now) {
  const kind = data.kind;
  const seated = st.seats.includes(id);

  // A tip for the dealer between hands: the money's gone, the table gets a thank-you. Pure flavour.
  if (kind === 'tip') {
    if (!seated) return 'not_seated';
    const p = playerRec(st, id);
    const amount = st.lim.chips[0];
    if (st.phase !== 'betting' || p.bankroll - p.bet < amount) return 'insufficient';
    p.bankroll -= amount;
    event(st, 'tip', { id, amount });
    return null;
  }

  if (kind === 'bet' || kind === 'clearBet' || kind === 'rebet' || kind === 'deal') {
    if (st.phase !== 'betting') return 'not_betting';
    if (!seated) return 'not_seated';
    const p = playerRec(st, id);
    if (kind === 'clearBet') { p.bet = 0; p.ready = false; return null; }
    if (p.ready) return 'already_ready';
    if (kind === 'bet') {
      const amount = Number(data.amount);
      if (!st.lim.chips.includes(amount)) return 'bad_amount';
      if (p.bet + amount > st.lim.max) return 'over_max';
      if (p.bet + amount > p.bankroll) return 'insufficient';
      p.bet += amount;
    } else if (kind === 'rebet') {
      if (p.lastBet < st.lim.min) return 'no_last_bet';
      const amt = Math.min(p.lastBet, p.bankroll, st.lim.max);
      if (amt < st.lim.min) return 'insufficient';
      p.bet = amt;
    } else {
      if (p.bet < st.lim.min) return 'under_min';
      p.ready = true;
    }
    if (st.deadline == null && p.bet >= st.lim.min) st.deadline = now + BET_MS;
    return null;
  }

  if (kind === 'rebuy') {
    if (!isBot(id)) return 'no_rebuy';
    const p = playerRec(st, id);
    const inRound = st.round && st.round.entries.some((e) => e.id === id);
    if (p.bankroll >= st.lim.min || p.bet > 0 || inRound) return 'not_broke';
    p.bankroll += st.lim.bot;
    p.rebuys++;
    return null;
  }

  if (kind === 'insurance') {
    if (st.phase !== 'insurance') return 'no_insurance';
    const e = st.round.entries.find((x) => x.id === id);
    if (!e || e.insDecided) return 'no_insurance';
    const cost = e.hands[0].bet / 2;
    if (data.take && playerRec(st, id).bankroll < cost) return 'insufficient';
    e.insDecided = true;
    if (data.take) {
      playerRec(st, id).bankroll -= cost;
      e.insurance = cost;
    } else e.insurance = 0;
    if (st.round.entries.every((x) => x.insDecided)) finishInsurance(st, now);
    return null;
  }

  if (kind === 'continue') {
    if (st.phase !== 'shoe_over') return 'bad_phase';
    if (!seated) return 'not_seated';
    endShoeOver(st);
    return null;
  }

  if (['hit', 'stand', 'double', 'split'].includes(kind)) {
    if (st.phase !== 'playing') return 'not_your_turn';
    const cur = currentHand(st);
    if (!cur || cur.entry.id !== id) return 'not_your_turn';
    const { entry, hand } = cur;
    if (kind === 'hit') {
      if (hand.splitAces) return 'split_aces';
      hand.cards.push(draw(st));
      const v = handValue(hand.cards).total;
      if (v > 21) { hand.done = true; event(st, 'bust', { who: id }); } else if (v === 21) { hand.done = true; event(st, 'hit', { who: id }); } else event(st, 'hit', { who: id });
    } else if (kind === 'stand') {
      hand.done = true;
      event(st, 'stand', { who: id });
    } else if (kind === 'double') {
      if (!canDoubleHand(st, entry, hand)) return 'cant_double';
      playerRec(st, id).bankroll -= hand.bet;
      hand.bet *= 2;
      hand.doubled = true;
      hand.cards.push(draw(st));
      hand.done = true;
      event(st, handValue(hand.cards).total > 21 ? 'bust' : 'double', { who: id });
    } else {
      if (!canSplitHand(st, entry, hand)) return 'cant_split';
      playerRec(st, id).bankroll -= hand.bet;
      const aces = hand.cards[0].rank === 'A';
      const second = { cards: [hand.cards.pop()], bet: hand.bet, doubled: false, done: false, result: null, payout: 0, fromSplit: true, splitAces: aces };
      hand.fromSplit = true;
      hand.splitAces = aces;
      entry.hands.splice(st.round.turn.h + 1, 0, second);
      hand.cards.push(draw(st));
      if (aces) {
        second.cards.push(draw(st));
        hand.done = true;
        second.done = true;
      } else if (handValue(hand.cards).total === 21) hand.done = true;
      event(st, 'split', { who: id });
    }
    if (hand.done) advance(st, now);
    else st.deadline = now + TURN_MS;
    return null;
  }

  return 'unknown';
}

// ---------------------------------------------------------------------------------------------
// Seats

function sit(st, id, chips) {
  if (st.seats.includes(id)) return 'already_seated';
  if (st.seats.length >= MAX_SEATS) return 'table_full';
  st.seats.push(id);
  playerRec(st, id).bankroll += chips;
  if (st.phase === 'waiting') enterBetting(st);
  return null;
}

function unseat(st, id, now) {
  const idx = st.seats.indexOf(id);
  if (idx === -1) return false;
  st.seats.splice(idx, 1);
  const p = st.players[id];
  if (p) { p.bet = 0; p.ready = false; }
  const r = st.round;
  if (r) {
    const e = r.entries.find((x) => x.id === id);
    if (e) {
      e.left = true;
      if (st.phase === 'insurance' && !e.insDecided) {
        e.insDecided = true;
        e.insurance = 0;
        if (r.entries.every((x) => x.insDecided)) finishInsurance(st, now);
      }
      const cur = currentHand(st);
      if (st.phase === 'playing' && cur && cur.entry === e) {
        for (const h of e.hands) h.done = true;
        advance(st, now);
      }
    }
  }
  // A bot's record goes once it's off the table (after its last round settles, if mid-round).
  if (isBot(id) && !(r && r.entries.some((x) => x.id === id))) delete st.players[id];
  if (!st.seats.length && (st.phase === 'betting' || st.phase === 'shoe_over')) {
    st.phase = 'waiting';
    st.deadline = null;
    if (st.reshuffleNext) newShoe(st);
  }
  return true;
}

function addBot(st, level) {
  if (st.seats.length >= MAX_SEATS) return 'table_full';
  const used = new Set(st.seats.filter(isBot).map(botBase));
  const name = BOT_NAMES.find((n) => !used.has(n));
  if (!name) return 'table_full';
  return sit(st, `bot-${name}~${normLevel(level)}`, st.lim.bot);
}

// A human sits down with their whole casino balance (plus anything still on this table from a
// hand they stood up during).
function sitHuman(room, st, id) {
  if (st.seats.includes(id)) return 'already_seated';
  if (st.seats.length >= MAX_SEATS) return 'table_full';
  const w = room.wallet;
  if (w && !w.ready(id)) return 'wallet_loading';
  if (st.lim.vip && w && !w.vip(id)) return 'vip_only';
  const chips = w ? w.buyIn(id, 'all') : st.players[id] ? 0 : START_BANKROLL;
  if ((st.players[id] ? st.players[id].bankroll : 0) + chips < st.lim.min) {
    if (chips) w.cashOut(id, chips + (st.players[id] ? st.players[id].bankroll : 0));
    if (st.players[id] && !(st.round && st.round.entries.some((e) => e.id === id))) delete st.players[id];
    return 'broke';
  }
  const err = sit(st, id, chips);
  if (!err && w) playerRec(st, id).flair = w.flair(id);
  return err;
}

// Nobody left to watch: play out any round in progress (everyone stands), so stood-up players'
// hands settle and their chips get back to their balance before the room goes quiet.
function finishRound(st) {
  let t = clock();
  for (let i = 0; i < 400 && st.round; i++) { t += 30000; step(st, t); }
}

// ---------------------------------------------------------------------------------------------
// Bots

function botBet(st, id) {
  const p = playerRec(st, id);
  const level = botLevelOf(id);
  let amt;
  if (level === 'easy') amt = [2, 5, 10, 15, 20][Math.floor(rng() * 5)];
  else if (level === 'expert') {
    const tc = Math.floor(trueCount(st));
    const units = tc <= 0 ? 1 : tc === 1 ? 2 : tc === 2 ? 4 : tc === 3 ? 6 : 8;
    amt = 5 * units;
  } else amt = 5;
  return Math.floor(Math.max(st.lim.min, Math.min(amt, p.bankroll, st.lim.max)));
}

// The action a bot wants to take right now, or null.
function botDecision(st, id) {
  const level = botLevelOf(id);
  const p = st.players[id];
  if (!p) return null;
  if (st.phase === 'betting' && st.seats.includes(id)) {
    if (p.ready) return null;
    if (p.bankroll < st.lim.min && p.bet === 0) return { kind: 'rebuy' };
    if (p.bet < st.lim.min) return { kind: 'setBet', amount: botBet(st, id) };
    return { kind: 'deal' };
  }
  if (st.phase === 'insurance') {
    const e = st.round.entries.find((x) => x.id === id);
    if (!e || e.insDecided) return null;
    const take = level === 'expert' ? trueCount(st) >= 3 : level === 'easy' ? rng() < 0.3 : false;
    return { kind: 'insurance', take };
  }
  if (st.phase === 'playing') {
    const cur = currentHand(st);
    if (!cur || cur.entry.id !== id) return null;
    const { entry, hand } = cur;
    const up = cardValue(st.round.dealer.cards[0]);
    const opts = { canDouble: canDoubleHand(st, entry, hand), canSplit: canSplitHand(st, entry, hand) };
    const v = handValue(hand.cards);
    if (level === 'easy') {
      if (rng() < 0.35) {
        const legal = ['hit', 'stand'];
        if (opts.canDouble) legal.push('double');
        if (opts.canSplit) legal.push('split');
        return { kind: legal[Math.floor(rng() * legal.length)] };
      }
      return { kind: v.total < 15 ? 'hit' : 'stand' };
    }
    if (level === 'medium') {
      if (opts.canSplit && (hand.cards[0].rank === 'A' || hand.cards[0].rank === '8')) return { kind: 'split' };
      if (opts.canDouble && v.total === 11 && !v.soft) return { kind: 'double' };
      return { kind: v.total < 17 ? 'hit' : 'stand' };
    }
    if (level === 'expert') return { kind: countStrategy(hand.cards, up, trueCount(st), opts) };
    return { kind: basicStrategy(hand.cards, up, opts) };
  }
  return null;
}

function botToAct(st) {
  if (st.phase === 'playing') {
    const cur = currentHand(st);
    return cur && isBot(cur.entry.id) ? cur.entry.id : null;
  }
  if (st.phase === 'betting') return st.seats.find((id) => isBot(id) && !st.players[id].ready) || null;
  if (st.phase === 'insurance') {
    const e = st.round.entries.find((x) => isBot(x.id) && !x.insDecided);
    return e ? e.id : null;
  }
  return null;
}

function runBot(st, now) {
  const id = botToAct(st);
  if (!id) { st.botNextAt = null; return false; }
  if (st.botNextAt == null) {
    const [a, b] = st.phase === 'betting' ? [300, 800] : [650, 1250];
    st.botNextAt = now + a + rng() * (b - a);
    return false;
  }
  if (now < st.botNextAt) return false;
  st.botNextAt = null;
  const d = botDecision(st, id);
  if (!d) return false;
  if (d.kind === 'setBet') {
    const p = playerRec(st, id);
    p.bet = d.amount;
    p.ready = true; // bots bet and lock in in one go so a bot table doesn't crawl
    if (st.deadline == null) st.deadline = now + BET_MS;
    return true;
  }
  return act(st, id, d, now) === null;
}

// ---------------------------------------------------------------------------------------------
// Plugin

function tick(room) {
  const st = room.state;
  const now = clock();
  let changed = runBot(st, now);
  if (step(st, now)) changed = true;
  if (changed) broadcast(room);
}

const plugin = {
  type: TYPE,
  casino: true,
  stats: { none: true }, // casino: no results, XP or leaderboards
  tickIntervalMs: 100,
  tick,

  createInitialState: () => createInitialState(LIMITS), // the room manager passes its own args

  isRoomFull(room) {
    return room.state.seats.length >= MAX_SEATS;
  },

  serializeSnapshot(room) {
    return buildView(room.state);
  },

  onLeave(room, client) {
    const st = room.state;
    const now = clock();
    let changed = unseat(st, client.clientId, now);
    // Nobody human left in the room: bots stand up too (they'd only play to an empty room).
    const humans = [...room.clients.keys()].filter((id) => !isBot(id));
    if (!humans.length) {
      for (const id of st.seats.filter(isBot)) changed = unseat(st, id, now) || changed;
      finishRound(st);
    }
    if (changed) {
      step(st, now);
      broadcast(room);
    }
  },

  onMessage(room, client, data, ctx) {
    if (!data || typeof data.kind !== 'string') return;
    const st = room.state;
    const id = ctx.senderId;
    const now = clock();
    let err = null;
    if (data.kind === 'sit') err = sitHuman(room, st, id);
    else if (data.kind === 'leaveSeat') err = unseat(st, id, now) ? null : 'not_seated';
    else if (data.kind === 'addBot') err = addBot(st, data.level);
    else if (data.kind === 'removeBot') {
      const bot = st.seats[Number(data.seat)];
      err = isBot(bot) && unseat(st, bot, now) ? null : 'not_a_bot';
    } else err = act(st, id, data, now);
    if (err) { reject(room, id, err); return; }
    step(st, now);
    broadcast(room);
  },

  _test: {
    handValue, basicStrategy, countStrategy, cardValue, isNatural, hiLo, trueCount, botDecision,
    setClock(fn) { clock = fn; }, setRng(fn) { rng = fn; },
    // Put these cards on top of the shoe so they're drawn in this order.
    stackShoe(st, cards) { st.shoe = st.shoe.concat(cards.slice().reverse()); },
    step, MIN_BET, MAX_BET, START_BANKROLL, BOT_BANKROLL, CHIPS, BET_MS, TURN_MS, INS_MS,
  },
};

module.exports = plugin;
module.exports.highRoller = { ...plugin, type: HIGH_ROLLER.type, createInitialState: () => createInitialState(HIGH_ROLLER) };
