// Your restaurant: the upgrade catalog (perks, quotes, buying) and the shift engine running on it.
// Run: node test/diner.test.js
'use strict';
const assert = require('assert');
const diner = require('../server/games/diner');
const R = require('../server/casino/diner');
const { createWallet } = require('../server/casino/wallet');
const { createMemoryDb } = require('../server/db');
const { roomWallet } = require('../server/roomManager');
const { START_BALANCE } = require('../server/casino/economy');

let failures = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const T = diner._test;

function makeRoom(ids) {
  const wallet = createWallet(createMemoryDb());
  const sent = [];
  const room = { code: 'D1', plugin: diner, sent, clients: new Map(ids.map((id) => [id, { clientId: id }])), seen: new Map(),
    broadcast: (m) => sent.push({ to: '*', m }), sendTo: (id, m) => sent.push({ to: id, m }) };
  room.state = diner.createInitialState();
  room.wallet = roomWallet(room, wallet);
  room.w = wallet;
  room.act = (id, data) => {
    const before = sent.length;
    diner.onMessage(room, { clientId: id }, data, { senderId: id });
    const rej = sent.slice(before).find((x) => x.to === id && x.m.payload.data.kind === 'moveRejected');
    return rej ? rej.m.payload.data.reason : null;
  };
  room.bal = (id) => wallet.view(`g:${id}`).balance;
  room.d = (id) => wallet.dinerOf(`g:${id}`);
  return room;
}

// Plays a whole shift perfectly (every ticket at the front, cooked to the middle of its window).
function perfectShift(room, id, clock) {
  const end = room.state.endsAt;
  while (clock.now < end - 20000) {
    const t = room.state.tickets[0];
    if (!t) { clock.now += 500; T.step(room, clock.now); continue; }
    room.act(id, { kind: 'grill', slot: 0 });
    const [lo, hi] = room.state.rules.DONENESS[t.doneness];
    clock.now += (lo + hi) / 2;
    T.step(room, clock.now);
    room.act(id, { kind: 'plate', slot: 0 });
    for (const item of t.toppings) room.act(id, { kind: 'top', item });
    assert.strictEqual(room.act(id, { kind: 'serve', ticket: t.id }), null);
  }
  clock.now = end;
  T.step(room, clock.now);
}

test('perks: a fresh food truck and what each upgrade changes', () => {
  const d = R.fresh();
  const p = R.perks(d);
  assert.deepStrictEqual([p.grills, p.maxTickets, p.toppings.length, p.priceMult, p.cookMult, p.bell], [1, 2, 4, 1, 1, false]);
  d.levels = { grill: 2, burners: 1, toppings: 3, seats: 3, premium: 2, booths: 1, billboard: 1, bell: 1 };
  d.tier = 2;
  const q = R.perks(d);
  assert.deepStrictEqual([q.grills, q.maxTickets, q.toppings.length, q.priceMult, q.cookMult, q.bell, q.tipMult], [3, 5, 10, 3, 0.85, true, 1.5625]);
  assert.ok(Math.abs(q.patienceMult - 1.2) < 1e-9 && Math.abs(q.arriveMult - 0.8) < 1e-9);
});

test('quote/buy: tier gates, max levels, broke, and the tier ladder', () => {
  const d = R.fresh();
  assert.deepStrictEqual(R.buy(d, 'grill', 100), { err: 'broke' });
  assert.deepStrictEqual(R.buy(d, 'grill', 250), { cost: 250 });
  assert.deepStrictEqual(R.quote(d, 'grill'), { err: 'tier', need: 'Diner' });
  assert.deepStrictEqual(R.buy(d, 'bell', 1e9), { cost: 300 });
  assert.deepStrictEqual(R.quote(d, 'bell'), { err: 'maxed' });
  assert.deepStrictEqual(R.quote(d, 'nope'), { err: 'unknown' });
  assert.deepStrictEqual(R.buy(d, 'tier', 1500), { cost: 1500 });
  assert.strictEqual(d.name, 'My Diner'); // a default name follows the tier
  assert.deepStrictEqual(R.quote(d, 'grill'), { cost: 2500 });
  d.tier = R.TIERS.length - 1;
  assert.deepStrictEqual(R.quote(d, 'tier'), { err: 'maxed' });
  assert.deepStrictEqual(R.normalize({ tier: 1 }).levels, {});
});

test('orderPay: full price from 60%, tips only above 50%, tier and premium multiply', () => {
  const p = R.perks(R.fresh());
  const ticket = { toppings: ['a', 'b'] }; // $6.50
  assert.deepStrictEqual(R.orderPay(p, ticket, 100), { price: 6.5, tip: 3.25 });
  assert.deepStrictEqual(R.orderPay(p, ticket, 60), { price: 6.5, tip: 0.65 });
  assert.deepStrictEqual(R.orderPay(p, ticket, 30), { price: 3.25, tip: 0 });
  assert.deepStrictEqual(R.orderPay(p, ticket, 0), { price: 0, tip: 0 });
  assert.deepStrictEqual(R.orderPay({ ...p, priceMult: 3, tipMult: 1.25 }, ticket, 100), { price: 19.5, tip: 12.19 });
});

test('a perfect food-truck shift pays every order into the balance and records the shift', () => {
  const clock = { now: 7e9 };
  T.setClock(() => clock.now);
  T.setRng(() => 0); // every ticket: rare, two toppings; a customer every 10s
  const room = makeRoom(['A']);
  assert.strictEqual(room.state.phase, 'home');
  assert.strictEqual(room.act('A', { kind: 'start' }), null);
  assert.strictEqual(room.state.grills.length, 1);
  assert.strictEqual(room.act('A', { kind: 'top', item: 'bacon' }), 'bad_item'); // not unlocked yet
  perfectShift(room, 'A', clock);
  const r = room.state.report;
  assert.strictEqual(room.state.phase, 'report');
  assert.ok(room.state.served.every((o) => o.score === 100), JSON.stringify(room.state.served));
  assert.ok(r.served >= 10, JSON.stringify(r));
  assert.strictEqual(r.paid, Math.round((r.revenue + r.tips) * 100) / 100);
  assert.strictEqual(r.paid, r.served * 9.75);
  assert.strictEqual(r.newBest, true);
  assert.strictEqual(room.bal('A'), START_BALANCE + r.paid);
  assert.deepStrictEqual([room.d('A').shifts, room.d('A').bestShift], [1, r.paid]);
  // No daily cap: straight into another one.
  assert.strictEqual(room.act('A', { kind: 'start' }), null);
});

test('upgrades bought between shifts change the next shift; not during one', () => {
  const clock = { now: 8e9 };
  T.setClock(() => clock.now);
  T.setRng(() => 0);
  const room = makeRoom(['A']);
  room.w.payShift('g:A', 2000);
  assert.strictEqual(room.act('A', { kind: 'buy', id: 'grill' }), null);
  assert.strictEqual(room.act('A', { kind: 'buy', id: 'burners' }), null);
  assert.strictEqual(room.act('A', { kind: 'buy', id: 'toppings' }), null);
  assert.strictEqual(room.act('A', { kind: 'buy', id: 'grill' }), 'tier');
  assert.strictEqual(room.act('A', { kind: 'rename', name: 'Grease Lightning' }), null);
  assert.strictEqual(room.d('A').name, 'Grease Lightning');
  assert.strictEqual(room.bal('A'), START_BALANCE + 2000 - 250 - 400 - 200);
  room.act('A', { kind: 'start' });
  assert.strictEqual(room.act('A', { kind: 'buy', id: 'seats' }), 'on_shift');
  assert.strictEqual(room.state.grills.length, 2);
  assert.deepStrictEqual(room.state.rules.DONENESS.rare, [3400, 5950]);
  assert.strictEqual(room.act('A', { kind: 'top', item: 'bacon' }), null);
  assert.strictEqual(room.act('A', { kind: 'grill', slot: 1 }), null);
  assert.strictEqual(room.act('A', { kind: 'grill', slot: 2 }), 'grill_busy');
});

test('junk serves, bogus tickets and walking out earn nothing', () => {
  const clock = { now: 9e9 };
  T.setClock(() => clock.now);
  T.setRng(() => 0);
  const room = makeRoom(['A']);
  assert.strictEqual(room.act('A', { kind: 'serve', ticket: 1 }), 'not_on_shift');
  room.act('A', { kind: 'start' });
  assert.strictEqual(room.act('A', { kind: 'serve', ticket: 1 }), 'no_patty');
  room.act('A', { kind: 'grill', slot: 0 });
  room.act('A', { kind: 'plate', slot: 0 }); // raw
  assert.strictEqual(room.act('A', { kind: 'serve', ticket: 99 }), 'no_ticket');
  assert.strictEqual(room.act('A', { kind: 'top', item: 'gold' }), 'bad_item');
  room.act('A', { kind: 'top', item: 'onion' });
  room.act('A', { kind: 'untop' });
  assert.strictEqual(room.act('A', { kind: 'untop' }), 'nothing');
  assert.strictEqual(room.act('A', { kind: 'serve', ticket: 1 }), null);
  assert.deepStrictEqual(room.state.served, [{ id: 1, score: 0, price: 0, tip: 0 }]);
  assert.strictEqual(T.scoreOrder({ doneness: 'rare', toppings: ['a'], at: 0 }, { patty: { cooked: T.BURNT_MS }, toppings: ['a'] }, 0), 50);
  diner.onLeave(room, { clientId: 'A' }); // walks out mid-shift: nothing paid
  assert.strictEqual(room.state.phase, 'home');
  assert.strictEqual(room.bal('A'), START_BALANCE);
  assert.strictEqual(room.d('A').shifts, 0);
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); console.log(`ok   ${name}`); } catch (err) { failures++; console.log(`FAIL ${name}\n     ${err.stack}`); }
  }
  T.setClock(() => Date.now());
  console.log(failures ? `\n${failures} failed` : `all ${tests.length} passed`);
  process.exit(failures ? 1 : 0);
})();
