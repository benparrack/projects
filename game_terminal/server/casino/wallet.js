// Casino money. One balance per account (casino/{uid}, a doc of its own so nothing casino ever
// rides along with the users/{uid} profile), plus play money for guests that lives only in memory.
//
// The server is a single process, so memory is the source of truth once an account is loaded and
// the db is just persistence: every change is synchronous (games call it from their tick/message
// handlers) and the whole doc is written behind it, one write at a time per account.
//
// Money at a table: buying in moves it from `balance` to `atTable[roomCode]`; the table keeps
// reporting its current stack (sync) and cashing out moves it back. The first load after a
// restart folds any atTable leftovers back into the balance, so a crash costs at most the hand
// in progress, never the stack.
//
// Keys: an account uid, or `g:<clientId>` for a guest.
'use strict';

const { START_BALANCE, STIPEND, JACKPOT_SEED, JACKPOT_CUT, VIP_BALANCE, TIERS, SHOP } = require('./economy');

const isGuest = (key) => key.startsWith('g:');
const utcDay = (t) => new Date(t).toISOString().slice(0, 10);
const round2 = (n) => Math.round(n * 100) / 100;
const tierOf = (wagered) => {
  const i = TIERS.findLastIndex(([, at]) => wagered >= at);
  const next = TIERS[i + 1];
  return { name: TIERS[i][0], glyph: TIERS[i][2], next: next ? { name: next[0], at: next[1] } : null };
};
const BOARD_MS = 60000;
const restaurant = require('./diner');
const { isOffensiveName, maskText } = require('../wordfilter');

function createWallet(db, { now = () => Date.now() } = {}) {
  const cache = new Map(); // key -> state
  const loading = new Map(); // uid -> Promise
  const writes = new Map(); // uid -> tail of its write chain

  function persist(key) {
    if (isGuest(key)) return;
    const snap = structuredClone(cache.get(key));
    const tail = (writes.get(key) || Promise.resolve())
      .then(() => db.set(`casino/${key}`, snap))
      .catch((err) => console.error('casino: save failed', key, err));
    writes.set(key, tail);
  }

  // The progressive slots jackpot, shared by every account on the site (guests neither feed nor win it).
  const jackpot = { amount: JACKPOT_SEED };
  jackpot.tail = db.get('casinoMeta/jackpot').then((d) => { if (d) jackpot.amount = round2(Math.max(d.amount, JACKPOT_SEED) + jackpot.amount - JACKPOT_SEED); })
    .catch((err) => console.error('casino: jackpot load failed', err));
  function saveJackpot() {
    const amount = jackpot.amount;
    jackpot.tail = jackpot.tail.then(() => db.set('casinoMeta/jackpot', { amount })).catch((err) => console.error('casino: jackpot save failed', err));
  }
  function feedJackpot(key, bet) {
    if (isGuest(key)) return;
    jackpot.amount = round2(jackpot.amount + bet * JACKPOT_CUT);
    saveJackpot();
  }
  // Pays `share` (0-1) of the pot to this account's balance; the pot never drops below the seed.
  function hitJackpot(key, share) {
    const s = cache.get(key);
    if (!s || isGuest(key)) return 0;
    const won = round2(jackpot.amount * share);
    jackpot.amount = share >= 1 ? JACKPOT_SEED : Math.max(round2(jackpot.amount - won), JACKPOT_SEED);
    s.balance = round2(s.balance + won);
    persist(key);
    saveJackpot();
    return won;
  }

  const fresh = () => ({ balance: START_BALANCE, atTable: {}, stipendDay: null, shifts: { day: null, n: 0 }, wagered: 0, biggestWin: 0, owned: {}, equipped: {}, diner: restaurant.fresh() });

  async function load(uid, name) {
    if (cache.has(uid)) {
      const s = cache.get(uid);
      if (name && s.name !== name) { s.name = name; persist(uid); } // leaderboards show it
      return s;
    }
    if (!loading.has(uid)) {
      loading.set(uid, (async () => {
        const doc = { ...fresh(), ...((await db.get(`casino/${uid}`)) || {}), ...(name ? { name } : {}) };
        // Nothing can be live at a table before this process loaded the account: refund it.
        for (const n of Object.values(doc.atTable || {})) doc.balance = round2(doc.balance + n);
        doc.atTable = {};
        doc.diner = restaurant.normalize(doc.diner);
        if (!cache.has(uid)) { cache.set(uid, doc); persist(uid); }
        loading.delete(uid);
        return cache.get(uid);
      })());
    }
    return loading.get(uid);
  }

  function state(key) {
    if (!cache.has(key) && isGuest(key)) cache.set(key, fresh());
    return cache.get(key) || null;
  }

  // Moves up to `n` (or everything with 'all') onto a table. Returns the amount moved (0 = none).
  function buyIn(key, table, n) {
    const s = state(key);
    if (!s) return 0;
    const amt = round2(n === 'all' ? s.balance : Math.min(n, s.balance));
    if (amt <= 0) return 0;
    s.balance = round2(s.balance - amt);
    s.atTable[table] = round2((s.atTable[table] || 0) + amt);
    persist(key);
    return amt;
  }

  // The table's current stack for this player (persisted so a restart refunds it).
  function sync(key, table, stack) {
    const s = state(key);
    if (!s || !(table in s.atTable) || s.atTable[table] === stack) return;
    s.atTable[table] = round2(Math.max(0, stack));
    persist(key);
  }

  function cashOut(key, table, stack) {
    const s = cache.get(key);
    if (!s) return;
    delete s.atTable[table];
    s.balance = round2(s.balance + Math.max(0, stack));
    persist(key);
  }

  // Lifetime numbers for tiers and leaderboards: how much went on the felt, and the best single win.
  function noteBet(key, wagered, won = 0) {
    const s = cache.get(key);
    if (!s || isGuest(key)) return;
    s.wagered = round2(s.wagered + wagered);
    if (won > s.biggestWin) s.biggestWin = round2(won);
    persist(key);
  }

  const stipendReady = (s) => s.stipendDay !== utcDay(now());
  function claimStipend(key) {
    const s = cache.get(key);
    if (!s || isGuest(key) || !stipendReady(s)) return false;
    s.stipendDay = utcDay(now());
    s.balance = round2(s.balance + STIPEND);
    persist(key);
    return true;
  }

  // Pays a finished work shift into the balance and onto the restaurant's record (`rep` = the shift's
  // reputation change). Guests work for play money.
  function payShift(key, n, rep = 0) {
    const s = state(key);
    if (!s) return 0;
    n = round2(Math.max(0, n));
    s.balance = round2(s.balance + n);
    s.diner.shifts++;
    s.diner.earned = round2(s.diner.earned + n);
    s.diner.bestShift = Math.max(s.diner.bestShift, n);
    s.diner.rep = Math.max(0, Math.min(restaurant.MAX_REP, (s.diner.rep || 0) + rep));
    persist(key);
    return n;
  }

  // The shop: accounts only (guest play money can't buy anything that would outlive the visit).
  function buy(key, id) {
    const s = cache.get(key);
    const item = SHOP.find((x) => x.id === id);
    if (!s || isGuest(key)) return 'guest';
    if (!item) return 'unknown';
    if (s.owned[id]) return 'owned';
    if (s.balance < item.price) return 'broke';
    s.balance = round2(s.balance - item.price);
    s.owned[id] = true;
    if (item.slot !== 'key') s.equipped[item.slot] = id;
    persist(key);
    return null;
  }
  // Equips an owned item, or takes it off if it's already on.
  function equip(key, id) {
    const s = cache.get(key);
    const item = SHOP.find((x) => x.id === id);
    if (!s || !item || !s.owned[id] || item.slot === 'key') return 'unknown';
    if (s.equipped[item.slot] === id) delete s.equipped[item.slot];
    else s.equipped[item.slot] = id;
    persist(key);
    return null;
  }
  // The restaurant (server/casino/diner.js): upgrades come out of the casino balance.
  const dinerOf = (key) => { const s = state(key); return s ? s.diner : null; };
  function dinerBuy(key, id) {
    const s = state(key);
    if (!s) return 'unknown';
    const r = restaurant.buy(s.diner, id, s.balance);
    if (r.err) return r.err;
    s.balance = round2(s.balance - r.cost);
    persist(key);
    return null;
  }
  function dinerRename(key, name) {
    const s = state(key);
    const clean = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, 24) : '';
    if (!s || !clean) return 'bad_name';
    if (isOffensiveName(clean)) return 'bad_name';
    s.diner.name = maskText(clean);
    persist(key);
    return null;
  }
  const vip = (key) => {
    const s = state(key);
    return !!s && (!!s.owned.vip || s.balance + Object.values(s.atTable).reduce((a, b) => a + b, 0) >= VIP_BALANCE);
  };
  // Tier badge + lucky charm, shown next to your name at casino tables.
  function flair(key) {
    const s = state(key);
    if (!s || isGuest(key)) return '';
    const charm = SHOP.find((x) => x.id === s.equipped.charm);
    return `${tierOf(s.wagered).glyph}${charm ? charm.glyph : ''}`;
  }

  // Casino-only leaderboards, from the db (so they cover accounts not loaded right now), cached a minute.
  let board = null;
  async function leaderboards() {
    if (board && now() - board.at < BOARD_MS) return board.rows;
    const top = async (field) => (await db.list('casino', { orderBy: [field, 'desc'], limit: 5 }))
      .filter((d) => d[field] > 0).map((d) => ({ name: d.name || 'player', value: d[field], tier: tierOf(d.wagered || 0).glyph }));
    try {
      const [richest, biggestWin, wagered] = await Promise.all([top('balance'), top('biggestWin'), top('wagered')]);
      board = { at: now(), rows: { richest, biggestWin, wagered } };
    } catch (err) {
      console.error('casino: leaderboards failed', err);
      return board ? board.rows : null;
    }
    return board.rows;
  }

  // What the casino lobby shows its owner.
  function view(key) {
    const s = state(key);
    if (!s) return null;
    const atTables = round2(Object.values(s.atTable).reduce((a, b) => a + b, 0));
    return { guest: isGuest(key), balance: s.balance, atTables, stipend: isGuest(key) ? null : { amount: STIPEND, ready: stipendReady(s) }, wagered: s.wagered, biggestWin: s.biggestWin, jackpot: jackpot.amount,
      tier: tierOf(s.wagered), vip: vip(key), owned: s.owned, equipped: s.equipped, shop: SHOP };
  }

  const dropGuest = (clientId) => cache.delete(`g:${clientId}`);
  async function forget(uid) {
    cache.delete(uid);
    await writes.get(uid);
    await db.del(`casino/${uid}`);
  }
  const flush = () => Promise.all([...writes.values(), jackpot.tail]);

  return { load, forget, buy, equip, vip, flair, leaderboards, buyIn, sync, cashOut, noteBet, claimStipend, payShift, dinerOf, dinerBuy, dinerRename, view, dropGuest, flush, feedJackpot, hitJackpot, jackpot: () => jackpot.amount, isLoaded: (key) => isGuest(key) || cache.has(key) };
}

module.exports = { createWallet, utcDay };
