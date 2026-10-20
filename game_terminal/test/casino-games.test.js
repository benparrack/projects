// Slots, roulette, the poker cash table and diner shifts: exact slot return, jackpot wiring, roulette bets/settling, money conserved.
// Run: node test/casino-games.test.js
'use strict';

const assert = require('assert');
const slots = require('../server/games/slots');
const roulette = require('../server/games/roulette');
const poker = require('../server/games/poker');
const diner = require('../server/games/diner');
const blackjack = require('../server/games/blackjack');
const { createWallet } = require('../server/casino/wallet');
const { createMemoryDb } = require('../server/db');
const { roomWallet } = require('../server/roomManager');
const { START_BALANCE, JACKPOT_SEED } = require('../server/casino/economy');

let failures = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// A room of guests (keys g:<id>) unless `uids` maps an id to an account.
function makeRoom(plugin, ids, uids = {}) {
  const wallet = createWallet(createMemoryDb());
  const sent = [];
  const room = {
    code: 'T1', plugin, wallet: null, sent,
    clients: new Map(ids.map((id) => [id, { clientId: id, uid: uids[id] }])),
    seen: new Map(),
    broadcast: (m) => sent.push({ to: '*', m }),
    sendTo: (id, m) => sent.push({ to: id, m }),
  };
  room.state = plugin.createInitialState();
  room.wallet = roomWallet(room, wallet);
  room.w = wallet;
  room.act = (id, data) => {
    const before = sent.length;
    plugin.onMessage(room, { clientId: id }, data, { senderId: id });
    const rej = sent.slice(before).find((x) => x.to === id && x.m.payload.data.kind === 'moveRejected');
    return rej ? rej.m.payload.data.reason : null;
  };
  room.bal = (id) => wallet.view(uids[id] || `g:${id}`);
  return room;
}

test('slots: the exact base return is ~93%, three diamonds are about 1 in 20k', () => {
  const { REEL, STOPS, payFor } = slots._test;
  const N = STOPS.length;
  let ret = 0;
  for (const a of Object.keys(REEL)) for (const b of Object.keys(REEL)) for (const c of Object.keys(REEL)) {
    const p = (REEL[a] * REEL[b] * REEL[c]) / N ** 3;
    const x = payFor([a, b, c]);
    if (x !== 'jackpot') ret += p * x;
  }
  assert.ok(ret > 0.92 && ret < 0.94, `base return ${ret}`);
  assert.ok(N ** 3 / REEL.JP ** 3 > 15000);
});

test('slots: a spin moves exactly bet and win through the balance; too fast and broke are refused', () => {
  const T = slots._test;
  let now = 1e9;
  T.setClock(() => now);
  const room = makeRoom(slots, ['A']);
  const seq = ['BE', 'BE', 'BE'];
  T.setRng(() => T.STOPS.indexOf(seq.shift()));
  assert.strictEqual(room.act('A', { kind: 'spin', bet: 5 }), null);
  assert.strictEqual(room.bal('A').balance, START_BALANCE - 5 + 5 * T.THREE.BE);
  assert.strictEqual(room.bal('A').atTables, 0);
  assert.strictEqual(room.act('A', { kind: 'spin', bet: 5 }), 'too_fast');
  assert.strictEqual(room.act('A', { kind: 'spin', bet: 3 }), 'bad_bet');
  T.setRng(() => T.STOPS.indexOf('BL'));
  for (let i = 0; i < 300 && room.bal('A').balance >= 10; i++) { now += T.SPIN_MS; room.act('A', { kind: 'spin', bet: 10 }); }
  now += T.SPIN_MS;
  assert.strictEqual(room.act('A', { kind: 'spin', bet: 10 }), 'broke');
});

test('slots: an account at max bet takes the whole jackpot, a guest gets the fixed play-money prize', async () => {
  const T = slots._test;
  let now = 2e9;
  T.setClock(() => now);
  const room = makeRoom(slots, ['A', 'G'], { A: 'u1' });
  await room.w.load('u1');
  T.setRng(() => T.STOPS.indexOf('JP'));
  room.act('A', { kind: 'spin', bet: T.MAX_BET });
  const pot = JACKPOT_SEED + T.MAX_BET * 0.01;
  assert.strictEqual(room.bal('A').balance, START_BALANCE - T.MAX_BET + pot);
  assert.strictEqual(room.w.jackpot(), JACKPOT_SEED);
  room.act('G', { kind: 'spin', bet: 1 });
  assert.strictEqual(room.bal('G').balance, START_BALANCE - 1 + T.GUEST_JACKPOT);
  assert.strictEqual(room.w.jackpot(), JACKPOT_SEED);
});

test('roulette: payouts per bet kind, zero loses outside bets', () => {
  const { spotRule } = roulette._test;
  const pays = (spot, n) => { const [w, x] = spotRule(spot); return w(n) ? x : -1; };
  assert.strictEqual(pays('n:17', 17), 35);
  assert.strictEqual(pays('n:0', 0), 35);
  assert.strictEqual(pays('red', 1), 1);
  assert.strictEqual(pays('black', 2), 1);
  for (const s of ['red', 'black', 'odd', 'even', 'low', 'high', 'd1', 'c3']) assert.strictEqual(pays(s, 0), -1, s);
  assert.strictEqual(pays('d2', 24), 2);
  assert.strictEqual(pays('c1', 34), 2);
  assert.strictEqual(spotRule('n:37'), null);
  assert.strictEqual(spotRule('nope'), null);
});

test('roulette: bets come off the balance, a winner is paid when the ball lands, the round loops', () => {
  const T = roulette._test;
  let now = 3e9;
  T.setClock(() => now);
  T.setRng(() => 7); // red, odd, low, d1, c1
  const room = makeRoom(roulette, ['A', 'B']);
  assert.strictEqual(room.act('A', { kind: 'bet', spot: 'red', amount: 25 }), null);
  assert.strictEqual(room.act('A', { kind: 'bet', spot: 'n:7', amount: 5 }), null);
  assert.strictEqual(room.act('B', { kind: 'bet', spot: 'even', amount: 25 }), null);
  assert.strictEqual(room.act('B', { kind: 'bet', spot: 'red', amount: 1 }), null);
  assert.strictEqual(room.act('B', { kind: 'clear' }), null);
  assert.strictEqual(room.bal('B').balance, START_BALANCE);
  room.act('B', { kind: 'bet', spot: 'even', amount: 25 });
  assert.deepStrictEqual([room.bal('A').balance, room.bal('A').atTables], [START_BALANCE - 30, 30]);
  assert.strictEqual(room.state.deadline, now + T.BET_MS);
  room.act('A', { kind: 'ready' });
  assert.strictEqual(room.state.phase, 'betting'); // B hasn't pressed ready
  now += T.BET_MS;
  T.step(room, now);
  assert.strictEqual(room.state.phase, 'spinning');
  assert.strictEqual(room.act('A', { kind: 'bet', spot: 'red', amount: 1 }), 'not_betting');
  assert.deepStrictEqual([room.bal('A').balance, room.bal('A').atTables], [START_BALANCE - 30 + 50 + 180, 0]);
  assert.deepStrictEqual([room.bal('B').balance, room.bal('B').atTables], [START_BALANCE - 25, 0]);
  now += T.SPIN_MS; T.step(room, now);
  assert.deepStrictEqual([room.state.phase, room.state.history], ['result', [7]]);
  now += T.RESULT_MS; T.step(room, now);
  assert.strictEqual(room.state.phase, 'betting');
  assert.strictEqual(room.act('A', { kind: 'rebet' }), null);
  assert.strictEqual(room.bal('A').atTables, 30);
});

test('roulette: limits, unaffordable chips, and leaving mid-betting refunds', () => {
  const T = roulette._test;
  T.setClock(() => 4e9);
  const room = makeRoom(roulette, ['A']);
  for (let i = 0; i < 4; i++) room.act('A', { kind: 'bet', spot: 'n:3', amount: 25 });
  assert.strictEqual(room.act('A', { kind: 'bet', spot: 'red', amount: 1 }), 'broke'); // 100 on the felt, 0 left
  room.act('A', { kind: 'clear' });
  for (let i = 0; i < 4; i++) room.act('A', { kind: 'bet', spot: 'n:3', amount: 5 });
  assert.strictEqual(room.act('A', { kind: 'bet', spot: 'n:3', amount: 100 }), 'spot_max');
  assert.strictEqual(room.act('A', { kind: 'bet', spot: 'n:3', amount: 3 }), 'bad_amount');
  roulette.onLeave(room, { clientId: 'A' });
  assert.deepStrictEqual([room.bal('A').balance, room.bal('A').atTables], [START_BALANCE, 0]);
  assert.strictEqual(room.state.deadline, null);
});

const card = (rank, suit) => ({ rank: String(rank), suit });

test('poker: buy-ins come off the balance, an all-in settles to the stacks, money is conserved', () => {
  const room = makeRoom(poker, ['A', 'B']);
  assert.strictEqual(room.act('A', { kind: 'sit', amount: 50 }), null);
  assert.strictEqual(room.act('B', { kind: 'sit', amount: 5 }), null); // under the minimum: buys the minimum
  assert.deepStrictEqual([room.bal('B').balance, room.bal('B').atTables], [START_BALANCE - poker._test.MIN_BUY, poker._test.MIN_BUY]);
  room.act('B', { kind: 'rebuy', amount: 30 });
  assert.strictEqual(room.state.chips[1], 50);
  assert.strictEqual(room.act('A', { kind: 'startGame' }), null);
  const h = room.state.hand;
  h.holeCards = [[card('A', 'S'), card('A', 'H')], [card(7, 'C'), card(2, 'D')]];
  h.deck = [card('J', 'S'), card('Q', 'D'), card('Q', 'C'), card('K', 'H'), card('K', 'S')];
  assert.strictEqual(room.act('A', { kind: 'raise', amount: 50 }), null); // A is the small blind, first to act heads-up
  assert.strictEqual(room.act('B', { kind: 'call' }), null);
  assert.strictEqual(room.state.phase, 'hand_over');
  assert.deepStrictEqual(room.state.chips, [100, 0]);
  assert.deepStrictEqual([room.bal('A').balance, room.bal('A').atTables], [START_BALANCE - 50, 100]);
  assert.deepStrictEqual([room.bal('B').balance, room.bal('B').atTables], [START_BALANCE - 50, 0]);
  assert.strictEqual(room.act('A', { kind: 'leaveSeat' }), null);
  assert.deepStrictEqual([room.bal('A').balance, room.bal('A').atTables], [START_BALANCE + 50, 0]);
  assert.deepStrictEqual(room.state.seats, ['B']);
  assert.strictEqual(room.state.phase, 'waiting');
});

test('poker: leaving mid-hand folds and cashes out the chips behind; the seat goes at the next deal', () => {
  let now = 5e9;
  poker._test.setClock(() => now);
  const room = makeRoom(poker, ['A', 'B']);
  room.act('A', { kind: 'sit', amount: 50 });
  room.act('B', { kind: 'sit', amount: 50 });
  room.act('A', { kind: 'startGame' });
  assert.strictEqual(room.act('B', { kind: 'leaveSeat' }), null); // B is the big blind, not to act
  assert.strictEqual(room.state.phase, 'hand_over'); // A wins the blinds by default
  assert.deepStrictEqual(room.state.chips, [52, 0]);
  assert.strictEqual(room.bal('B').balance, START_BALANCE - 2);
  assert.strictEqual(room.bal('A').balance + room.bal('A').atTables + room.bal('B').balance, 2 * START_BALANCE);
  now += poker._test.NEXT_HAND_MS;
  poker.tick(room);
  assert.deepStrictEqual(room.state.seats, ['A']);
  assert.strictEqual(room.state.phase, 'waiting');
});

test('poker: bots sit with house money, latecomers sit out the hand, and hands deal on their own', () => {
  let now = 6e9;
  poker._test.setClock(() => now);
  const room = makeRoom(poker, ['A', 'C']);
  room.act('A', { kind: 'sit', amount: 40 });
  room.act('bot-Ace~easy', { kind: 'sit' });
  assert.strictEqual(room.state.chips[1], poker._test.BOT_BUY);
  poker.tick(room);
  assert.strictEqual(room.state.phase, 'waiting');
  now += poker._test.START_MS;
  poker.tick(room);
  assert.strictEqual(room.state.phase, 'playing');
  room.act('C', { kind: 'sit', amount: 40 });
  assert.strictEqual(room.state.hand.folded[2], true);
  assert.strictEqual(room.act('C', { kind: 'check' }), 'not_your_turn');
  assert.strictEqual(room.act('A', { kind: 'sit', amount: 40 }), 'already_seated');
});

test('diner: a perfect shift earns the pay cap into the balance', () => {
  const T = diner._test;
  let now = 7e9;
  T.setClock(() => now);
  T.setRng(() => 0); // every ticket: rare, lettuce + tomato; a customer every 10s
  const room = makeRoom(diner, ['A']);
  assert.strictEqual(room.act('A', { kind: 'start' }), null);
  const end = now + T.SHIFT_MS;
  while (now < end - 7000) {
    const t = room.state.tickets[0];
    if (!t) { now += 500; T.step(room, now); continue; }
    room.act('A', { kind: 'grill', slot: 0 });
    now += 5500;
    T.step(room, now);
    room.act('A', { kind: 'plate', slot: 0 });
    for (const item of t.toppings) room.act('A', { kind: 'top', item });
    assert.strictEqual(room.act('A', { kind: 'serve', ticket: t.id }), null);
  }
  assert.ok(room.state.served.every((o) => o.score === 100), JSON.stringify(room.state.served));
  now = end;
  T.step(room, now);
  assert.strictEqual(room.state.phase, 'done');
  assert.deepStrictEqual(room.state.pay, { earned: T.PAY_CAP, paid: T.PAY_CAP, base: T.BASE_PAY });
  assert.strictEqual(room.bal('A').balance, START_BALANCE + T.PAY_CAP);
});

test('diner: junk serves, bogus tickets and walking out earn nothing; the daily cap holds', () => {
  const T = diner._test;
  let now = 8e9;
  T.setClock(() => now);
  T.setRng(() => 0);
  const room = makeRoom(diner, ['A']);
  assert.strictEqual(room.act('A', { kind: 'serve', ticket: 1 }), 'not_on_shift');
  room.act('A', { kind: 'start' });
  assert.strictEqual(room.act('A', { kind: 'serve', ticket: 1 }), 'no_patty');
  room.act('A', { kind: 'grill', slot: 0 });
  room.act('A', { kind: 'plate', slot: 0 }); // raw
  assert.strictEqual(room.act('A', { kind: 'serve', ticket: 99 }), 'no_ticket');
  assert.strictEqual(room.act('A', { kind: 'top', item: 'gold' }), 'bad_item');
  assert.strictEqual(room.act('A', { kind: 'serve', ticket: 1 }), null);
  assert.deepStrictEqual(room.state.served, [{ id: 1, score: 0, tip: 0 }]);
  assert.strictEqual(T.scoreOrder({ doneness: 'rare', toppings: ['a'], at: 0 }, { patty: { cooked: T.BURNT_MS }, toppings: ['a'] }, 0), 50); // toppings + half speed, no cook
  diner.onLeave(room, { clientId: 'A' }); // walks out mid-shift
  assert.strictEqual(room.state.phase, 'idle');
  assert.strictEqual(room.bal('A').balance, START_BALANCE);
  for (let i = 0; i < 6; i++) room.w.payShift('g:A', 1);
  assert.strictEqual(room.act('A', { kind: 'start' }), 'shift_cap');
});

test('high-roller blackjack: needs $1,000 or the VIP key to sit; tips cost the smallest chip', () => {
  const room = makeRoom(blackjack.highRoller, ['A']);
  assert.strictEqual(room.act('A', { kind: 'sit' }), 'vip_only');
  room.w.payShift('g:A', 1000);
  assert.strictEqual(room.act('A', { kind: 'sit' }), null);
  assert.strictEqual(room.state.lim.min, 25);
  assert.strictEqual(room.act('A', { kind: 'bet', amount: 5 }), 'bad_amount');
  assert.strictEqual(room.act('A', { kind: 'tip' }), null);
  assert.strictEqual(room.state.players.A.bankroll, START_BALANCE + 1000 - 25);
  assert.strictEqual(room.sent.at(-1).m.payload.gameType, 'blackjack_hr');
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); console.log(`ok   ${name}`); } catch (err) { failures++; console.log(`FAIL ${name}\n     ${err.stack}`); }
  }
  console.log(failures ? `\n${failures} failed` : `all ${tests.length} passed`);
  process.exit(failures ? 1 : 0);
})();
