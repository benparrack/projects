// Casino wallet: starting balance, table buy-in/cash-out, restart refund, stipend, shift cap,
// guests stay in memory.
// Run: node test/casino-wallet.test.js
'use strict';

const assert = require('assert');
const { createWallet } = require('../server/casino/wallet');
const { createMemoryDb } = require('../server/db');
const { START_BALANCE, STIPEND, SHIFT_CAP, JACKPOT_SEED } = require('../server/casino/economy');

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

test('shift pay is capped per day', async () => {
  const w = createWallet(createMemoryDb());
  await w.load('u1');
  for (let i = 0; i < SHIFT_CAP; i++) assert.strictEqual(w.payShift('u1', 10), 10);
  assert.strictEqual(w.payShift('u1', 10), 0);
  assert.strictEqual(w.view('u1').balance, START_BALANCE + 10 * SHIFT_CAP);
  assert.strictEqual(w.view('u1').shiftsLeft, 0);
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
  await w.flush();
  const after = createWallet(db);
  await after.flush();
  assert.strictEqual(after.jackpot(), (JACKPOT_SEED + 1) / 2);
  await after.load('u1');
  assert.strictEqual(after.hitJackpot('u1', 1), (JACKPOT_SEED + 1) / 2);
  assert.strictEqual(after.jackpot(), JACKPOT_SEED);
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); console.log(`ok   ${name}`); } catch (err) { failures++; console.log(`FAIL ${name}\n     ${err.stack}`); }
  }
  console.log(failures ? `\n${failures} failed` : `all ${tests.length} passed`);
  process.exit(failures ? 1 : 0);
})();
