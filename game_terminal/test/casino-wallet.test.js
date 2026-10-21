// Casino wallet: starting balance, table buy-in/cash-out, restart refund, stipend, shift cap,
// guests stay in memory.
// Run: node test/casino-wallet.test.js
'use strict';

const assert = require('assert');
const { createWallet } = require('../server/casino/wallet');
const { createMemoryDb } = require('../server/db');
const { START_BALANCE, STIPEND, JACKPOT_SEED, SHOP, VIP_BALANCE } = require('../server/casino/economy');

let failures = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('a new account starts with the starting balance and is saved', async () => {
  const db = createMemoryDb();
  const w = createWallet(db);
  await w.load('u1');
  assert.strictEqual(w.view('u1').balance, START_BALANCE);
  await w.flush();
  assert.strictEqual((await db.get('casino/u1')).balance, START_BALANCE);
});

test('buy in, sync, cash out; never more than the balance', async () => {
  const w = createWallet(createMemoryDb());
  await w.load('u1');
  assert.strictEqual(w.buyIn('u1', 'R', 30), 30);
  assert.strictEqual(w.buyIn('u1', 'R', 500), START_BALANCE - 30);
  assert.strictEqual(w.buyIn('u1', 'R', 'all'), 0);
  assert.deepStrictEqual([w.view('u1').balance, w.view('u1').atTables], [0, START_BALANCE]);
  w.sync('u1', 'R', 140);
  w.cashOut('u1', 'R', 140);
  assert.deepStrictEqual([w.view('u1').balance, w.view('u1').atTables], [140, 0]);
});

test('an account not loaded yet cannot buy in', () => {
  const w = createWallet(createMemoryDb());
  assert.strictEqual(w.isLoaded('u1'), false);
  assert.strictEqual(w.buyIn('u1', 'R', 10), 0);
});

test('a restart refunds the last synced table stack', async () => {
  const db = createMemoryDb();
  const w = createWallet(db);
  await w.load('u1');
  w.buyIn('u1', 'R', 'all');
  w.sync('u1', 'R', 75);
  await w.flush();
  const after = createWallet(db); // fresh process, same db
  await after.load('u1');
  assert.deepStrictEqual([after.view('u1').balance, after.view('u1').atTables], [75, 0]);
});

test('stipend: once per UTC day, accounts only', async () => {
  let t = Date.UTC(2026, 9, 20, 23, 0);
  const w = createWallet(createMemoryDb(), { now: () => t });
  await w.load('u1');
  assert.strictEqual(w.claimStipend('u1'), true);
  assert.strictEqual(w.claimStipend('u1'), false);
  assert.strictEqual(w.view('u1').balance, START_BALANCE + STIPEND);
  t += 2 * 3600e3; // past midnight UTC
  assert.strictEqual(w.view('u1').stipend.ready, true);
  assert.strictEqual(w.claimStipend('u1'), true);
  assert.strictEqual(w.claimStipend('g:abc'), false);
});

test('shift pay is uncapped and lands on the restaurant record; upgrades come out of the balance', async () => {
  const db = createMemoryDb();
  const w = createWallet(db);
  await w.load('u1');
  for (let i = 0; i < 10; i++) assert.strictEqual(w.payShift('u1', 10), 10);
  assert.strictEqual(w.payShift('u1', 55.5), 55.5);
  assert.strictEqual(w.view('u1').balance, START_BALANCE + 155.5);
  assert.deepStrictEqual([w.dinerOf('u1').shifts, w.dinerOf('u1').bestShift, w.dinerOf('u1').earned], [11, 55.5, 155.5]);
  assert.strictEqual(w.dinerBuy('u1', 'grill'), null); // $250
  assert.strictEqual(w.view('u1').balance, START_BALANCE + 155.5 - 250);
  assert.strictEqual(w.dinerBuy('u1', 'grill'), 'tier'); // level 2 needs the Diner
  assert.strictEqual(w.dinerBuy('u1', 'tier'), 'broke');
  assert.strictEqual(w.dinerRename('u1', '  Bob\'s   Burgers  '), null);
  assert.strictEqual(w.dinerRename('u1', '   '), 'bad_name');
  await w.flush();
  const w2 = createWallet(db); // a restart keeps the restaurant
  await w2.load('u1');
  assert.deepStrictEqual([w2.dinerOf('u1').levels, w2.dinerOf('u1').name], [{ grill: 1 }, "Bob's Burgers"]);
});

test('guests get play money that never touches the db and is gone when dropped', async () => {
  const db = createMemoryDb();
  const w = createWallet(db);
  assert.strictEqual(w.buyIn('g:c1', 'R', 20), 20);
  w.cashOut('g:c1', 'R', 50);
  assert.strictEqual(w.view('g:c1').balance, START_BALANCE + 30);
  assert.strictEqual(w.view('g:c1').guest, true);
  await w.flush();
  assert.deepStrictEqual(await db.list('casino'), []);
  w.dropGuest('c1');
  assert.strictEqual(w.view('g:c1').balance, START_BALANCE);
});

test('jackpot: accounts feed it and win it, guests do neither, it survives a restart', async () => {
  const db = createMemoryDb();
  const w = createWallet(db);
  await w.load('u1');
  await w.flush();
  w.feedJackpot('u1', 100);
  w.feedJackpot('g:c1', 100);
  assert.strictEqual(w.jackpot(), JACKPOT_SEED + 1);
  assert.strictEqual(w.hitJackpot('g:c1', 1), 0);
  assert.strictEqual(w.hitJackpot('u1', 0.5), (JACKPOT_SEED + 1) / 2);
  assert.strictEqual(w.jackpot(), JACKPOT_SEED, 'a part hit never drops the pot below the seed');
  w.feedJackpot('u1', 300);
  await w.flush();
  const after = createWallet(db);
  await after.flush();
  assert.strictEqual(after.jackpot(), JACKPOT_SEED + 3);
  await after.load('u1');
  assert.strictEqual(after.hitJackpot('u1', 1), JACKPOT_SEED + 3);
  assert.strictEqual(after.jackpot(), JACKPOT_SEED);
});

test('shop: buy once, equip/unequip, guests and the broke cannot buy; tier and charm make the flair', async () => {
  const db = createMemoryDb();
  const w = createWallet(db);
  await w.load('u1', 'ann');
  const price = (id) => SHOP.find((x) => x.id === id).price;
  assert.strictEqual(w.buy('u1', 'nope'), 'unknown');
  assert.strictEqual(w.buy('u1', 'charm-clover'), null);
  assert.strictEqual(w.view('u1').balance, START_BALANCE - price('charm-clover'));
  assert.strictEqual(w.view('u1').equipped.charm, 'charm-clover'); // bought = worn
  assert.strictEqual(w.buy('u1', 'charm-clover'), 'owned');
  assert.strictEqual(w.buy('u1', 'felt-gold'), 'broke');
  assert.strictEqual(w.flair('u1'), '🥉🍀');
  assert.strictEqual(w.equip('u1', 'charm-clover'), null);
  assert.strictEqual(w.view('u1').equipped.charm, undefined);
  assert.strictEqual(w.equip('u1', 'felt-gold'), 'unknown'); // not owned
  w.noteBet('u1', 5000);
  assert.strictEqual(w.view('u1').tier.name, 'Gold');
  assert.strictEqual(w.flair('u1'), '🥇');
  assert.strictEqual(w.buy('g:x', 'charm-clover'), 'guest');
  assert.strictEqual(w.flair('g:x'), '');
});

test('VIP: $1,000 across balance and tables, or the key; leaderboards read the db', async () => {
  const db = createMemoryDb();
  const w = createWallet(db);
  await w.load('u1', 'ann');
  await w.load('u2', 'bob');
  assert.strictEqual(w.vip('u1'), false);
  w.payShift('u1', VIP_BALANCE);
  w.buyIn('u1', 'R', 500); // money at a table still counts
  assert.strictEqual(w.vip('u1'), true);
  w.cashOut('u1', 'R', 0);
  assert.strictEqual(w.vip('u1'), false);
  w.noteBet('u2', 10, 40);
  await w.flush();
  const b = await w.leaderboards();
  assert.deepStrictEqual(b.richest.map((r) => r.name), ['ann', 'bob']);
  assert.deepStrictEqual(b.biggestWin, [{ name: 'bob', value: 40, tier: '🥉' }]);
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); console.log(`ok   ${name}`); } catch (err) { failures++; console.log(`FAIL ${name}\n     ${err.stack}`); }
  }
  console.log(failures ? `\n${failures} failed` : `all ${tests.length} passed`);
  process.exit(failures ? 1 : 0);
})();
