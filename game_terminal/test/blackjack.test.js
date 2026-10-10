// Blackjack: payouts, dealer rules, insurance, split/double, timers, shoe/cut card, hidden hole
// card, validation, leaving mid-round, bots at every level, rebuy, client strategy parity.
// Run: node test/blackjack.test.js
'use strict';

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');
const { execFileSync } = require('child_process');
const plugin = require('../server/games/blackjack');

const T = plugin._test;
let now = 1e9;
T.setClock(() => now);

let failures = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const c = (rank, suit = 'S') => ({ rank: String(rank), suit });

function makeRoom(ids = ['A', 'B', 'C']) {
  const sent = [];
  const room = {
    state: plugin.createInitialState(),
    clients: new Map(ids.map((id) => [id, { clientId: id }])),
    broadcast: (m) => sent.push({ to: '*', m }),
    sendTo: (id, m) => sent.push({ to: id, m }),
  };
  room.sent = sent;
  return room;
}
const ctxFor = (room, id) => ({ senderId: id, broadcast: room.broadcast, sendTo: room.sendTo });
const send = (room, id, data) => plugin.onMessage(room, { clientId: id }, data, ctxFor(room, id));
const view = (room) => plugin.serializeSnapshot(room, { clientId: 'A' });
const lastReject = (room, id) => {
  const s = [...room.sent].reverse().find((x) => x.to === id && x.m.payload.data.kind === 'moveRejected');
  return s && s.m.payload.data.reason;
};
const rejects = (room, id, data, reason) => {
  const before = room.sent.length;
  send(room, id, data);
  const got = room.sent.slice(before).find((x) => x.to === id && x.m.payload.data.kind === 'moveRejected');
  assert.ok(got, `expected rejection ${reason} for ${JSON.stringify(data)}`);
  if (reason) assert.strictEqual(got.m.payload.data.reason, reason);
};
const ok = (room, id, data) => {
  const before = room.sent.length;
  send(room, id, data);
  const bad = room.sent.slice(before).find((x) => x.m.payload.data.kind === 'moveRejected');
  assert.ok(!bad, `unexpected rejection ${bad && bad.m.payload.data.reason} for ${id} ${JSON.stringify(data)}`);
};
function wait(room, ms) {
  const end = now + ms;
  while (now < end) { now = Math.min(end, now + 100); plugin.tick(room); }
}
// Seat players, bet, stack the shoe and deal the opening cards. `cards` are drawn in order.
function deal(room, bets, cards) {
  for (const id of Object.keys(bets)) if (!room.state.seats.includes(id)) ok(room, id, { kind: 'sit' });
  T.stackShoe(room.state, cards);
  for (const [id, amt] of Object.entries(bets)) {
    let left = amt;
    for (const d of [500, 100, 25, 5]) while (left >= d) { ok(room, id, { kind: 'bet', amount: d }); left -= d; }
  }
  for (const id of Object.keys(bets)) ok(room, id, { kind: 'deal' });
  wait(room, 450 * (Object.keys(bets).length + 1) * 2 + 100);
}
const bank = (room, id) => room.state.players[id].bankroll;
const settleRound = (room) => { for (let i = 0; i < 100 && room.state.phase !== 'settle'; i++) wait(room, 700); assert.strictEqual(room.state.phase, 'settle'); };
const hands = (room, id) => room.state.round.entries.find((e) => e.id === id).hands;

// ---------------------------------------------------------------------------------------------

test('hand values: soft/hard totals', () => {
  assert.deepStrictEqual(T.handValue([c('A'), c(6)]), { total: 17, soft: true });
  assert.deepStrictEqual(T.handValue([c('A'), c(6), c(10)]), { total: 17, soft: false });
  assert.deepStrictEqual(T.handValue([c('A'), c('A'), c(9)]), { total: 21, soft: true });
  assert.strictEqual(T.handValue([c('K'), c('Q'), c(5)]).total, 25);
  assert.strictEqual(T.handValue([c('A'), null]).total, 11);
});

test('natural pays 3:2 and the dealer does not draw against it', () => {
  const room = makeRoom();
  deal(room, { A: 100 }, [c('A'), c(9), c('K'), c(6), c(10)]);
  settleRound(room);
  assert.strictEqual(hands(room, 'A')[0].result, 'blackjack');
  assert.strictEqual(bank(room, 'A'), 1150);
  assert.strictEqual(room.state.round.dealer.cards.length, 2);
  assert.strictEqual(room.state.players.A.stats.blackjacks, 1);
});

test('dealer blackjack under a ten: peek reveals and the round settles at once', () => {
  const room = makeRoom();
  deal(room, { A: 100 }, [c(9), c('K'), c(7), c('A')]);
  assert.strictEqual(room.state.phase, 'settle');
  assert.strictEqual(room.state.round.dealer.revealed, true);
  assert.strictEqual(hands(room, 'A')[0].result, 'lose');
  assert.strictEqual(bank(room, 'A'), 900);
  assert.strictEqual(room.state.lastEvent.kind === 'settle' || room.state.lastEvent.kind === 'dealerBlackjack', true);
});

test('natural vs dealer blackjack pushes', () => {
  const room = makeRoom();
  deal(room, { A: 100 }, [c('A'), c('Q'), c('K'), c('A')]);
  assert.strictEqual(hands(room, 'A')[0].result, 'push');
  assert.strictEqual(bank(room, 'A'), 1000);
});

test('insurance pays 2:1 when the dealer has blackjack', () => {
  const room = makeRoom();
  deal(room, { A: 100 }, [c(10), c('A'), c(9), c('K')]);
  assert.strictEqual(room.state.phase, 'insurance');
  assert.strictEqual(view(room).round.dealer.cards[1], null);
  rejects(room, 'A', { kind: 'hit' }, 'not_your_turn');
  ok(room, 'A', { kind: 'insurance', take: true });
  assert.strictEqual(room.state.phase, 'settle');
  assert.strictEqual(hands(room, 'A')[0].result, 'lose');
  assert.strictEqual(bank(room, 'A'), 1000); // -100 hand, +100 insurance
  assert.strictEqual(room.state.players.A.net, 0);
});

test('insurance is lost when the dealer has no blackjack, then play continues', () => {
  const room = makeRoom();
  deal(room, { A: 100 }, [c(10), c('A'), c(9), c(6)]);
  ok(room, 'A', { kind: 'insurance', take: true });
  rejects(room, 'A', { kind: 'insurance', take: true }, 'no_insurance');
  assert.strictEqual(room.state.phase, 'peek');
  assert.strictEqual(view(room).round.dealer.cards[1], null);
  wait(room, 1000);
  assert.strictEqual(room.state.phase, 'playing');
  assert.strictEqual(bank(room, 'A'), 850);
  T.stackShoe(room.state, [c(4)]); // dealer A+6 = soft 17 stands
  ok(room, 'A', { kind: 'stand' });
  settleRound(room);
  assert.strictEqual(hands(room, 'A')[0].result, 'win');
  assert.strictEqual(bank(room, 'A'), 1050);
  assert.strictEqual(room.state.players.A.net, 50);
});

test('insurance times out as declined', () => {
  const room = makeRoom();
  deal(room, { A: 100 }, [c(10), c('A'), c(9), c(6)]);
  wait(room, 10100);
  assert.notStrictEqual(room.state.phase, 'insurance');
  assert.strictEqual(room.state.round.entries[0].insurance, 0);
});

test('split and re-split up to four hands', () => {
  const room = makeRoom();
  deal(room, { A: 100 }, [c(8), c(6), c(8, 'H'), c(10), c(8, 'D'), c(8, 'C'), c(3), c(2), c(10), c(10)]);
  assert.strictEqual(room.state.phase, 'playing');
  ok(room, 'A', { kind: 'split' }); // hand 1: 8,8
  ok(room, 'A', { kind: 'split' }); // hand 1: 8,8 again
  ok(room, 'A', { kind: 'split' }); // hand 1: 8,3
  assert.strictEqual(hands(room, 'A').length, 4);
  assert.strictEqual(bank(room, 'A'), 600);
  T.stackShoe(room.state, [c(9)]);
  ok(room, 'A', { kind: 'double' }); // 8,3,9 = 20 doubled
  assert.strictEqual(hands(room, 'A')[0].bet, 200);
  // Hands 2..4 get their second card on arrival: 2, 10, 10.
  assert.deepStrictEqual(hands(room, 'A')[1].cards.map((x) => x.rank), ['8', '2']);
  T.stackShoe(room.state, [c(8, 'H')]);
  ok(room, 'A', { kind: 'hit' }); // 8,2,8 = 18
  ok(room, 'A', { kind: 'stand' });
  rejects(room, 'A', { kind: 'split' }, 'cant_split');
  ok(room, 'A', { kind: 'stand' });
  ok(room, 'A', { kind: 'stand' });
  T.stackShoe(room.state, [c(10)]); // dealer 16 + 10 busts
  settleRound(room);
  for (const h of hands(room, 'A')) { assert.strictEqual(h.result, 'win'); assert.ok(!T.isNatural(h)); }
  assert.strictEqual(bank(room, 'A'), 1000 + 500);
});

test('split aces get exactly one card each and 21 is not blackjack', () => {
  const room = makeRoom();
  deal(room, { A: 100 }, [c('A'), c(6), c('A', 'H'), c(10), c('K'), c(5), c(9)]);
  ok(room, 'A', { kind: 'split' });
  assert.strictEqual(room.state.phase, 'dealer');
  const hs = hands(room, 'A');
  assert.deepStrictEqual(hs.map((h) => h.cards.length), [2, 2]);
  settleRound(room); // dealer 16 + 9 bust
  assert.deepStrictEqual(hs.map((h) => h.result), ['win', 'win']);
  assert.strictEqual(bank(room, 'A'), 1200);
});

test('double takes one card and doubles the bet', () => {
  const room = makeRoom();
  deal(room, { A: 100 }, [c(6), c(6), c(5), c(10), c(10), c(10)]);
  ok(room, 'A', { kind: 'double' });
  settleRound(room);
  const h = hands(room, 'A')[0];
  assert.strictEqual(h.cards.length, 3);
  assert.strictEqual(h.bet, 200);
  assert.strictEqual(h.result, 'win');
  assert.strictEqual(bank(room, 'A'), 1200);
});

test('cannot double without the bankroll or after hitting', () => {
  const room = makeRoom();
  deal(room, { A: 600 }, [c(2), c(9), c(3), c(8), c(2)]);
  rejects(room, 'A', { kind: 'double' }, 'cant_double');
  rejects(room, 'A', { kind: 'split' }, 'cant_split');
  ok(room, 'A', { kind: 'hit' });
  room.state.players.A.bankroll = 5000;
  rejects(room, 'A', { kind: 'double' }, 'cant_double');
});

test('bust loses and the dealer skips drawing when nobody is live', () => {
  const room = makeRoom();
  deal(room, { A: 100 }, [c(10), c(6), c(6), c(5), c('K')]);
  ok(room, 'A', { kind: 'hit' });
  settleRound(room);
  assert.strictEqual(hands(room, 'A')[0].result, 'bust');
  assert.strictEqual(room.state.round.dealer.cards.length, 2);
  assert.strictEqual(bank(room, 'A'), 900);
});

test('push returns the bet', () => {
  const room = makeRoom();
  deal(room, { A: 100 }, [c(10), c('Q'), c(8), c(8)]);
  wait(room, 1000);
  ok(room, 'A', { kind: 'stand' });
  settleRound(room);
  assert.strictEqual(hands(room, 'A')[0].result, 'push');
  assert.strictEqual(bank(room, 'A'), 1000);
});

test('dealer stands on soft 17 and hits 16', () => {
  let room = makeRoom();
  deal(room, { A: 100 }, [c(10), c(6), c(7), c('A'), c(4)]);
  ok(room, 'A', { kind: 'stand' });
  settleRound(room);
  assert.strictEqual(room.state.round.dealer.cards.length, 2);
  assert.strictEqual(hands(room, 'A')[0].result, 'push');
  room = makeRoom();
  deal(room, { A: 100 }, [c(10), c(6), c(7), c(10), c(2)]);
  ok(room, 'A', { kind: 'stand' });
  settleRound(room);
  assert.strictEqual(room.state.round.dealer.cards.length, 3);
  assert.strictEqual(hands(room, 'A')[0].result, 'lose');
});

test('turn timer auto-stands a stalled player and moves on', () => {
  const room = makeRoom();
  deal(room, { A: 100, B: 100 }, [c(10), c(10), c(6), c(7), c(9), c(10), c(10)]);
  assert.strictEqual(room.state.round.turn.e, 0);
  wait(room, T.TURN_MS + 100);
  assert.strictEqual(hands(room, 'A')[0].done, true);
  assert.strictEqual(hands(room, 'A')[0].cards.length, 2);
  assert.strictEqual(room.state.round.turn.e, 1);
  assert.strictEqual(room.state.lastEvent.kind, 'timeout');
  assert.strictEqual(room.state.lastEvent.who, 'A');
  assert.notStrictEqual(room.state.lastEvent.id, 'A');
});

test('betting deadline deals the players who bet and sits out the rest', () => {
  const room = makeRoom();
  ok(room, 'A', { kind: 'sit' });
  ok(room, 'B', { kind: 'sit' });
  ok(room, 'A', { kind: 'bet', amount: 25 });
  ok(room, 'A', { kind: 'deal' });
  wait(room, 1000);
  assert.strictEqual(room.state.phase, 'betting');
  assert.ok(view(room).deadline > now);
  wait(room, T.BET_MS);
  assert.notStrictEqual(room.state.phase, 'betting');
  assert.deepStrictEqual(room.state.round.entries.map((e) => e.id), ['A']);
});

test('no round without a bet; clearBet and rebet', () => {
  const room = makeRoom();
  ok(room, 'A', { kind: 'sit' });
  wait(room, 60000);
  assert.strictEqual(room.state.phase, 'betting');
  rejects(room, 'A', { kind: 'rebet' }, 'no_last_bet');
  ok(room, 'A', { kind: 'bet', amount: 100 });
  ok(room, 'A', { kind: 'clearBet' });
  assert.strictEqual(room.state.players.A.bet, 0);
  deal(room, { A: 30 }, [c(10), c(9), c(10), c(8)]);
  ok(room, 'A', { kind: 'stand' });
  settleRound(room);
  wait(room, 5000);
  assert.strictEqual(room.state.phase, 'betting');
  ok(room, 'A', { kind: 'rebet' });
  assert.strictEqual(room.state.players.A.bet, 30);
});

test('cut card ends the shoe: standings, then a fresh shoe', () => {
  const room = makeRoom();
  ok(room, 'A', { kind: 'sit' });
  const st = room.state;
  st.shoe = st.shoe.slice(-st.cutAt);
  deal(room, { A: 100 }, [c(10), c(9), c(10), c(8)]);
  assert.strictEqual(st.reshuffleNext, true);
  ok(room, 'A', { kind: 'stand' });
  settleRound(room);
  wait(room, 5000);
  assert.strictEqual(st.phase, 'shoe_over');
  assert.strictEqual(view(room).shoeRounds, 1);
  assert.strictEqual(st.players.A.shoeNet, 100);
  rejects(room, 'A', { kind: 'bet', amount: 5 }, 'not_betting');
  rejects(room, 'B', { kind: 'continue' }, 'not_seated');
  ok(room, 'A', { kind: 'continue' });
  assert.strictEqual(st.phase, 'betting');
  assert.strictEqual(st.shoeNo, 2);
  assert.strictEqual(st.shoe.length, 312);
  assert.strictEqual(st.reshuffleNext, false);
  assert.strictEqual(st.players.A.shoeNet, 0);
  assert.strictEqual(st.players.A.net, 100);
});

test('shoe_over auto-continues after its timer', () => {
  const room = makeRoom();
  ok(room, 'A', { kind: 'sit' });
  room.state.shoe = room.state.shoe.slice(-room.state.cutAt);
  deal(room, { A: 100 }, [c(10), c(9), c(10), c(8)]);
  ok(room, 'A', { kind: 'stand' });
  settleRound(room);
  wait(room, 5000);
  assert.strictEqual(room.state.phase, 'shoe_over');
  wait(room, 25100);
  assert.strictEqual(room.state.phase, 'betting');
  assert.strictEqual(room.state.shoeNo, 2);
});

test('hole card never leaves the server before the reveal', () => {
  const room = makeRoom();
  const hole = c('Q', 'D');
  deal(room, { A: 100 }, [c(10), c(5), c(9), hole]);
  assert.strictEqual(room.state.phase, 'playing');
  const v = view(room);
  assert.strictEqual(v.round.dealer.cards[1], null);
  assert.strictEqual(v.round.dealer.total, 5);
  assert.ok(!('shoe' in v) && !('runningCount' in v));
  for (const s of room.sent) {
    const d = s.m.payload.data;
    if (d.kind === 'state' && d.round && !d.round.dealer.revealed) {
      assert.strictEqual(d.round.dealer.cards[1] || null, null, `leaked hole in ${d.phase}`);
      assert.ok(!('shoe' in d));
    }
  }
  ok(room, 'A', { kind: 'stand' });
  assert.deepStrictEqual(view(room).round.dealer.cards[1], hole);
});

test('invalid messages are rejected and never throw', () => {
  const room = makeRoom();
  for (const bad of [null, undefined, 5, 'x', {}, { kind: 7 }, { kind: 'bogus' }]) send(room, 'A', bad);
  rejects(room, 'A', { kind: 'bet', amount: 5 }, 'not_betting');
  ok(room, 'A', { kind: 'sit' });
  rejects(room, 'A', { kind: 'sit' }, 'already_seated');
  rejects(room, 'A', { kind: 'bet', amount: 7 }, 'bad_amount');
  rejects(room, 'A', { kind: 'bet', amount: '25x' }, 'bad_amount');
  rejects(room, 'A', { kind: 'deal' }, 'under_min');
  rejects(room, 'C', { kind: 'bet', amount: 5 }, 'not_seated');
  ok(room, 'A', { kind: 'bet', amount: 500 });
  ok(room, 'A', { kind: 'bet', amount: 500 });
  rejects(room, 'A', { kind: 'bet', amount: 5 }, 'over_max');
  rejects(room, 'A', { kind: 'hit' }, 'not_your_turn');
  rejects(room, 'A', { kind: 'rebuy' }, 'not_broke');
  rejects(room, 'A', { kind: 'insurance', take: true }, 'no_insurance');
  rejects(room, 'C', { kind: 'removeBot', seat: 0 }, 'not_a_bot');
  rejects(room, 'C', { kind: 'leaveSeat' }, 'not_seated');
  ok(room, 'A', { kind: 'clearBet' });
  room.state.players.A.bankroll = 20;
  rejects(room, 'A', { kind: 'bet', amount: 25 }, 'insufficient');
  for (let i = 0; i < 5; i++) ok(room, 'B', { kind: 'addBot', level: 'hard' });
  rejects(room, 'C', { kind: 'sit' }, 'table_full');
  rejects(room, 'C', { kind: 'addBot' }, 'table_full');
  assert.strictEqual(plugin.isRoomFull(room), true);
});

test('a player leaving mid-turn passes the turn on and their hand still settles', () => {
  const room = makeRoom();
  deal(room, { A: 100, B: 100 }, [c(10), c(10), c(6), c(7), c(9), c(10), c(10)]);
  assert.strictEqual(room.state.round.turn.e, 0);
  room.clients.delete('A');
  plugin.onLeave(room, { clientId: 'A' });
  assert.strictEqual(room.state.round.turn.e, 1);
  assert.ok(view(room).players.A, 'leaver still shown while their hand is on the table');
  ok(room, 'B', { kind: 'stand' });
  settleRound(room);
  assert.strictEqual(hands(room, 'A')[0].result, 'win'); // 17 vs dealer 16+10 bust
  assert.strictEqual(bank(room, 'A'), 1100);
  wait(room, 5000);
  assert.deepStrictEqual(room.state.seats, ['B']);
});

test('leaving during insurance and the last human leaving clears bots', () => {
  const room = makeRoom(['A', 'B']);
  deal(room, { A: 100, B: 100 }, [c(10), c(10), c('A'), c(9), c(9), c(6)]);
  assert.strictEqual(room.state.phase, 'insurance');
  ok(room, 'B', { kind: 'insurance', take: false });
  room.clients.delete('A');
  plugin.onLeave(room, { clientId: 'A' });
  assert.notStrictEqual(room.state.phase, 'insurance');
  ok(room, 'B', { kind: 'addBot', level: 'expert' });
  room.clients.delete('B');
  plugin.onLeave(room, { clientId: 'B' });
  assert.deepStrictEqual(room.state.seats, []);
  wait(room, 30000);
  assert.ok(['waiting', 'settle'].includes(room.state.phase) || room.state.round === null);
});

test('removing a bot mid-round lets its hand finish, then forgets it', () => {
  const room = makeRoom();
  ok(room, 'A', { kind: 'sit' });
  ok(room, 'A', { kind: 'addBot', level: 'hard' });
  const bot = room.state.seats[1];
  ok(room, 'A', { kind: 'bet', amount: 25 });
  ok(room, 'A', { kind: 'deal' });
  for (let i = 0; i < 200 && room.state.phase !== 'playing'; i++) wait(room, 100);
  ok(room, 'A', { kind: 'removeBot', seat: 1 });
  assert.ok(room.state.players[bot]);
  for (let i = 0; i < 400 && room.state.phase !== 'betting'; i++) { wait(room, 100); if (room.state.phase === 'playing') send(room, 'A', { kind: 'stand' }); }
  assert.strictEqual(room.state.phase, 'betting');
  assert.ok(!room.state.players[bot]);
});

test('rebuy only when broke', () => {
  const room = makeRoom();
  ok(room, 'A', { kind: 'sit' });
  room.state.players.A.bankroll = 7.5;
  rejects(room, 'A', { kind: 'bet', amount: 25 }, 'insufficient');
  ok(room, 'A', { kind: 'rebuy' });
  assert.strictEqual(bank(room, 'A'), 1007.5);
  assert.strictEqual(room.state.players.A.rebuys, 1);
  rejects(room, 'A', { kind: 'rebuy' }, 'not_broke');
});

test('bots at every level play many rounds without stalling; chips are conserved', () => {
  T.setRng(mulberry(42));
  const room = makeRoom(['W']); // a spectator keeps the room alive
  for (const lv of ['easy', 'medium', 'hard', 'expert', 'expert', 'easy']) ok(room, 'W', { kind: 'addBot', level: lv });
  assert.strictEqual(room.state.seats.length, 6);
  const st = room.state;
  let lastRound = 0;
  let lastProgress = now;
  let shoes = 1;
  const seenActions = new Set();
  for (let i = 0; i < 60000; i++) {
    now += 100;
    plugin.tick(room);
    if (st.lastEvent) seenActions.add(st.lastEvent.kind);
    if (st.roundNo !== lastRound) { lastRound = st.roundNo; lastProgress = now; }
    assert.ok(now - lastProgress < 90000, `stalled in ${st.phase} ${JSON.stringify({ seats: st.seats, players: st.players, deadline: st.deadline - now, botNextAt: st.botNextAt - now })}`);
    if (st.shoeNo > shoes) shoes = st.shoeNo;
    if (st.phase === 'betting' && !st.round) {
      for (const id of st.seats) {
        const p = st.players[id];
        assert.ok(p.bankroll >= 0 && Number.isFinite(p.bankroll));
        assert.strictEqual(p.bankroll, 1000 * (1 + p.rebuys) + p.net, `chips not conserved for ${id}`);
      }
    }
  }
  assert.ok(st.roundNo > 200, `only ${st.roundNo} rounds`);
  assert.ok(shoes >= 3, 'shoes cycled');
  for (const k of ['split', 'double', 'bust', 'stand', 'hit']) assert.ok(seenActions.has(k), `bots never did ${k}`);
  T.setRng(Math.random);
});

test('expert bot bet spread follows the true count', () => {
  const room = makeRoom(['W']);
  ok(room, 'W', { kind: 'addBot', level: 'expert' });
  ok(room, 'W', { kind: 'addBot', level: 'hard' });
  const [ex, hd] = room.state.seats;
  const st = room.state;
  const bets = (tc) => {
    st.runningCount = tc * (st.shoe.length / 52);
    return [T.botDecision(st, ex).amount, T.botDecision(st, hd).amount];
  };
  assert.deepStrictEqual(bets(-3), [25, 25]);
  assert.deepStrictEqual(bets(2), [100, 25]);
  assert.deepStrictEqual(bets(5), [200, 25]);
});

test('basic strategy spot checks and count deviations', () => {
  const B = (a, b, up, o = {}) => T.basicStrategy([c(a), c(b)], up, { canDouble: true, canSplit: true, ...o });
  assert.strictEqual(B('A', 'A', 11), 'split');
  assert.strictEqual(B(8, 8, 10), 'split');
  assert.strictEqual(B(10, 10, 6), 'stand');
  assert.strictEqual(B(5, 5, 6), 'double');
  assert.strictEqual(B(6, 5, 10), 'double');
  assert.strictEqual(B(10, 6, 10), 'hit');
  assert.strictEqual(B(10, 2, 3), 'hit');
  assert.strictEqual(B(10, 2, 4), 'stand');
  assert.strictEqual(B('A', 7, 9), 'hit');
  assert.strictEqual(B('A', 7, 6), 'double');
  assert.strictEqual(B('A', 7, 6, { canDouble: false }), 'stand');
  assert.strictEqual(B(9, 9, 7), 'stand');
  assert.strictEqual(T.countStrategy([c(10), c(6)], 10, 1, { canDouble: true, canSplit: true }), 'stand');
  assert.strictEqual(T.countStrategy([c(10), c(10)], 6, 5, { canDouble: true, canSplit: true }), 'split');
  assert.strictEqual(T.countStrategy([c(8), c(8)], 10, 3, { canDouble: true, canSplit: true }), 'split');
});

test('client strategy.js agrees with the server for every hand', async () => {
  const mod = await import(pathToFileURL(path.join(__dirname, '../public/games/blackjack/strategy.js')).href);
  let n = 0;
  const hands = [];
  for (const a of RANKS) for (const b of RANKS) hands.push([c(a), c(b)]);
  for (const a of RANKS) for (const b of RANKS) for (const d of ['2', '3', '5', 'A']) hands.push([c(a), c(b), c(d)]);
  for (const cards of hands) {
    for (let up = 2; up <= 11; up++) {
      for (const canDouble of [true, false]) for (const canSplit of [true, false]) {
        if (T.handValue(cards).total > 21) continue;
        const o = { canDouble, canSplit };
        assert.strictEqual(mod.basicStrategy(cards, up, o), T.basicStrategy(cards, up, o), `${cards.map((x) => x.rank)} v ${up} ${JSON.stringify(o)}`);
        n++;
      }
    }
  }
  for (const k of ['hit', 'stand', 'double', 'split']) assert.ok(mod.adviceLabel(k).length > 0);
  assert.ok(n > 5000);
});

test('client parses', () => {
  execFileSync(process.execPath, ['--check', path.join(__dirname, '../public/games/blackjack/client.js')]);
});

function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

(async () => {
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (e) {
      failures++;
      console.log(`FAIL ${name}\n     ${e.stack.split('\n').slice(0, 3).join('\n     ')}`);
    }
  }
  console.log(failures ? `\n${failures} failed` : `\nall ${tests.length} passed`);
  process.exit(failures ? 1 : 0);
})();
