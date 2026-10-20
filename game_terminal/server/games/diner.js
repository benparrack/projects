// Terminal Diner: the casino's way back from broke. A solo three-minute burger shift: tickets come
// in, you grill patties to the asked doneness, stack the toppings in order and serve. Pay is a base
// wage plus a tip per order, scored here on the server's own clock (the client only sends button
// presses), and paid into the casino balance via wallet.payShift (capped shifts per day).
// Client: ../../public/games/diner/client.js
'use strict';

const crypto = require('crypto');

const TYPE = 'diner';
const SHIFT_MS = 180000;
const ARRIVE_MS = [10000, 16000]; // gap between customers
const MAX_TICKETS = 3;
const WALK_OUT_MS = 70000;
const GRILLS = 2;
const DONENESS = { rare: [4000, 7000], medium: [8000, 11000], well: [12000, 15000] }; // cook ms
const BURNT_MS = 18000;
const TOPPINGS = ['lettuce', 'tomato', 'cheese', 'onion', 'pickles', 'bacon'];
const MAX_STACK = 6;
const BASE_PAY = 30; // for a shift with at least BASE_MIN_SERVED orders out
const BASE_MIN_SERVED = 3;
const TIP_MAX = 9; // a perfect order
const PAY_CAP = 120;

let rng = (n) => crypto.randomInt(n);
let clock = () => Date.now();
const between = ([a, b]) => a + rng(b - a + 1);

// 0-100: doneness 40, toppings in order 40, speed 20.
function scoreOrder(ticket, build, servedAt) {
  const [lo, hi] = DONENESS[ticket.doneness];
  const c = build.patty.cooked;
  const off = c < lo ? lo - c : c > hi ? c - hi : 0;
  const cook = c >= BURNT_MS ? 0 : Math.max(0, 40 - (12 * off) / 1000);
  const n = Math.max(ticket.toppings.length, build.toppings.length);
  const right = ticket.toppings.filter((t, i) => build.toppings[i] === t).length;
  const tops = n ? (40 * right) / n : 40;
  const wait = servedAt - ticket.at;
  // Speed only counts on a burger worth serving: slinging junk fast earns nothing.
  const speed = 20 * Math.min(1, Math.max(0, 1 - (wait - 25000) / 40000)) * ((cook + tops) / 80);
  return Math.round(cook + tops + speed);
}
const tipFor = (score) => Math.round((score * TIP_MAX) / 100);

function newTicket(st, now) {
  const pool = TOPPINGS.slice();
  const toppings = [];
  for (let k = 2 + rng(3); k > 0; k--) toppings.push(pool.splice(rng(pool.length), 1)[0]);
  const names = Object.keys(DONENESS);
  st.tickets.push({ id: ++st.nextId, doneness: names[rng(names.length)], toppings, at: now });
}

function createInitialState() {
  return { phase: 'idle', worker: null, endsAt: null, nextArrival: null, tickets: [], nextId: 0, grills: Array(GRILLS).fill(null),
    build: { patty: null, toppings: [] }, served: [], missed: 0, tips: 0, pay: null, seq: 0 };
}

function start(room, id, now) {
  const st = room.state;
  if (st.phase === 'shift') return 'on_shift';
  const w = room.wallet;
  if (w && !w.ready(id)) return 'wallet_loading';
  if (w && w.shiftsLeft(id) <= 0) return 'shift_cap';
  Object.assign(st, createInitialState(), { phase: 'shift', worker: id, endsAt: now + SHIFT_MS, nextArrival: now + between(ARRIVE_MS), seq: st.seq });
  newTicket(st, now);
  return null;
}

function finish(room) {
  const st = room.state;
  const earned = Math.min(PAY_CAP, (st.served.length >= BASE_MIN_SERVED ? BASE_PAY : 0) + st.tips);
  const paid = room.wallet ? room.wallet.payShift(st.worker, earned) : earned;
  st.pay = { earned, paid, base: st.served.length >= BASE_MIN_SERVED ? BASE_PAY : 0 };
  st.phase = 'done';
  st.tickets = [];
  st.grills = Array(GRILLS).fill(null);
}

function act(room, id, data, now) {
  const st = room.state;
  if (data.kind === 'start') return start(room, id, now);
  if (st.phase !== 'shift' || id !== st.worker) return 'not_on_shift';
  const slot = Number(data.slot);
  const g = Number.isInteger(slot) && slot >= 0 && slot < GRILLS ? slot : -1;
  switch (data.kind) {
    case 'grill':
      if (g === -1 || st.grills[g]) return 'grill_busy';
      st.grills[g] = { at: now };
      return null;
    case 'plate':
      if (g === -1 || !st.grills[g]) return 'grill_empty';
      if (st.build.patty) return 'plate_full';
      st.build.patty = { cooked: now - st.grills[g].at };
      st.grills[g] = null;
      return null;
    case 'scrape':
      if (g === -1 || !st.grills[g]) return 'grill_empty';
      st.grills[g] = null;
      return null;
    case 'top':
      if (!TOPPINGS.includes(data.item)) return 'bad_item';
      if (st.build.toppings.length >= MAX_STACK) return 'stack_full';
      st.build.toppings.push(data.item);
      return null;
    case 'trash':
      st.build = { patty: null, toppings: [] };
      return null;
    case 'serve': {
      const i = st.tickets.findIndex((t) => t.id === Number(data.ticket));
      if (i === -1) return 'no_ticket';
      if (!st.build.patty) return 'no_patty';
      const score = scoreOrder(st.tickets[i], st.build, now);
      const tip = tipFor(score);
      st.served.push({ id: st.tickets[i].id, score, tip });
      st.tips += tip;
      st.tickets.splice(i, 1);
      st.build = { patty: null, toppings: [] };
      return null;
    }
    default:
      return 'unknown';
  }
}

// Customers arrive and walk out, and the shift ends, on the room tick. Returns true on a change.
function step(room, now) {
  const st = room.state;
  if (st.phase !== 'shift') return false;
  if (now >= st.endsAt) { finish(room); return true; }
  let changed = false;
  const before = st.tickets.length;
  st.tickets = st.tickets.filter((t) => now - t.at < WALK_OUT_MS);
  if (st.tickets.length !== before) { st.missed += before - st.tickets.length; changed = true; }
  if (now >= st.nextArrival) {
    if (st.tickets.length < MAX_TICKETS) { newTicket(st, now); changed = true; }
    st.nextArrival = now + between(ARRIVE_MS);
  }
  return changed;
}

function buildView(room, id) {
  const st = room.state;
  const w = room.wallet;
  return {
    seq: st.seq, phase: st.phase, serverNow: clock(), endsAt: st.endsAt, tickets: st.tickets, grills: st.grills, build: st.build,
    served: st.served, missed: st.missed, tips: st.tips, pay: st.pay,
    balance: w && id ? w.balance(id) : null, shiftsLeft: w && id ? w.shiftsLeft(id) : null,
    rules: { DONENESS, BURNT_MS, TOPPINGS, SHIFT_MS, WALK_OUT_MS, BASE_PAY, BASE_MIN_SERVED, TIP_MAX, PAY_CAP },
  };
}

function broadcast(room) {
  room.state.seq++;
  for (const id of room.clients.keys()) {
    room.sendTo(id, { v: 1, type: 'game.event', payload: { gameType: TYPE, data: { kind: 'state', ...buildView(room, id) } } });
  }
}

module.exports = {
  type: TYPE,
  casino: true,
  stats: { none: true },
  tickIntervalMs: 250,
  tick(room) { if (step(room, clock())) broadcast(room); },
  createInitialState,
  isRoomFull(room) { return room.clients.size >= 1; }, // one cook per kitchen
  serializeSnapshot(room, client) { return buildView(room, client ? client.clientId : null); },
  onJoin(room) { broadcast(room); },
  // Walking out mid-shift forfeits it (nothing is paid until the shift ends).
  onLeave(room, client) {
    if (room.state.worker === client.clientId) Object.assign(room.state, createInitialState(), { seq: room.state.seq });
  },
  onMessage(room, client, data, ctx) {
    if (!data || typeof data.kind !== 'string') return;
    const now = clock();
    step(room, now);
    const err = act(room, ctx.senderId, data, now);
    if (err) {
      room.sendTo(ctx.senderId, { v: 1, type: 'game.event', payload: { gameType: TYPE, data: { kind: 'moveRejected', reason: err } } });
      return;
    }
    broadcast(room);
  },
  _test: { scoreOrder, tipFor, step, SHIFT_MS, DONENESS, BURNT_MS, TOPPINGS, BASE_PAY, TIP_MAX, PAY_CAP, WALK_OUT_MS, setRng(fn) { rng = fn; }, setClock(fn) { clock = fn; } },
};
