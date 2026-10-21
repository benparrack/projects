// Your restaurant: a solo three-minute burger shift. Tickets come in, you grill patties to the asked
// doneness, stack the toppings in order and serve. Each order pays its menu price plus a tip, scored
// here on the server's own clock (the client only sends button presses), into the casino balance via
// wallet.payShift. Between shifts the same room is the restaurant's home and upgrade shop; the
// upgrades (server/casino/diner.js) change the numbers a shift runs on.
// Client: ../../public/games/diner/client.js
'use strict';

const crypto = require('crypto');
const restaurant = require('../casino/diner');

const TYPE = 'diner';
const SHIFT_MS = 180000;
const ARRIVE_MS = [10000, 16000]; // gap between customers
const WALK_OUT_MS = 70000;
const DONENESS = { rare: [4000, 7000], medium: [8000, 11000], well: [12000, 15000] }; // cook ms before hot burners
const BURNT_MS = 18000;
const MAX_STACK = 6;

let rng = (n) => crypto.randomInt(n);
let clock = () => Date.now();
const between = ([a, b]) => a + rng(b - a + 1);

// The shift's cook windows: hot burners shrink every time (and the burn point) by cookMult.
const cookRules = (m) => ({ DONENESS: Object.fromEntries(Object.entries(DONENESS).map(([k, [a, b]]) => [k, [Math.round(a * m), Math.round(b * m)]])), BURNT_MS: Math.round(BURNT_MS * m) });

// 0-100: doneness 40, toppings in order 40, speed 20.
function scoreOrder(ticket, build, servedAt, rules = cookRules(1)) {
  const [lo, hi] = rules.DONENESS[ticket.doneness];
  const c = build.patty.cooked;
  const off = c < lo ? lo - c : c > hi ? c - hi : 0;
  const cook = c >= rules.BURNT_MS ? 0 : Math.max(0, 40 - (12 * off) / 1000);
  const n = Math.max(ticket.toppings.length, build.toppings.length);
  const right = ticket.toppings.filter((t, i) => build.toppings[i] === t).length;
  const tops = n ? (40 * right) / n : 40;
  const wait = servedAt - ticket.at;
  // Speed only counts on a burger worth serving: slinging junk fast earns nothing.
  const speed = 20 * Math.min(1, Math.max(0, 1 - (wait - 25000) / 40000)) * ((cook + tops) / 80);
  return Math.round(cook + tops + speed);
}

function newTicket(st, now) {
  const pool = st.perks.toppings.slice();
  const toppings = [];
  for (let k = Math.min(pool.length, 2 + rng(3)); k > 0; k--) toppings.push(pool.splice(rng(pool.length), 1)[0]);
  const names = Object.keys(DONENESS);
  const doneness = names[rng(names.length)];
  const sides = {};
  for (const id of st.perks.stations) {
    const f = restaurant.STATIONS[id].flavors;
    if (rng(100) < restaurant.SIDE_ODDS) sides[id] = f[rng(f.length)];
  }
  st.tickets.push({ id: ++st.nextId, doneness, toppings, sides, at: now });
}

// phase: home (the restaurant and its shop) -> shift -> report (back to home on the next start).
function createInitialState() {
  return { phase: 'home', worker: null, endsAt: null, nextArrival: null, tickets: [], nextId: 0, grills: [], perks: null, rules: null,
    build: { patty: null, toppings: [] }, stations: {}, tray: {}, served: [], missed: 0, combos: 0, revenue: 0, tips: 0, report: null, seq: 0 };
}

const dinerOf = (room, id) => (room.wallet ? room.wallet.diner(id) : null) || restaurant.fresh();

function start(room, id, now) {
  const st = room.state;
  if (st.phase === 'shift') return 'on_shift';
  const w = room.wallet;
  if (w && !w.ready(id)) return 'wallet_loading';
  const perks = restaurant.perks(dinerOf(room, id));
  Object.assign(st, createInitialState(), { phase: 'shift', worker: id, endsAt: now + SHIFT_MS, seq: st.seq, perks,
    rules: { ...cookRules(perks.cookMult), WALK_OUT_MS: Math.round(WALK_OUT_MS * perks.patienceMult) }, grills: Array(perks.grills).fill(null),
    stations: Object.fromEntries(perks.stations.map((s) => [s, null])) });
  st.nextArrival = now + Math.round(between(ARRIVE_MS) * perks.arriveMult);
  st.prepAt = now + restaurant.PREP_MS;
  newTicket(st, now);
  return null;
}

function finish(room) {
  const st = room.state;
  const before = room.wallet ? dinerOf(room, st.worker).bestShift : 0;
  const earned = Math.round((st.revenue + st.tips) * 100) / 100;
  const wages = st.perks.wages;
  const net = Math.max(0, Math.round((earned - wages) * 100) / 100);
  const paid = room.wallet ? room.wallet.payShift(st.worker, net) : net;
  const best = st.served.reduce((a, o) => (!a || o.score > a.score ? o : a), null);
  st.report = { served: st.served.length, missed: st.missed, combos: st.combos, revenue: st.revenue, tips: st.tips, wages, paid,
    avg: st.served.length ? Math.round(st.served.reduce((a, o) => a + o.score, 0) / st.served.length) : 0,
    best, newBest: paid > before && paid > 0 };
  st.phase = 'report';
  st.tickets = [];
  st.grills = [];
  st.stations = {};
  st.tray = {};
}

// Shop actions, between shifts only.
function shop(room, id, data) {
  const w = room.wallet;
  if (!w) return 'unknown';
  if (!w.ready(id)) return 'wallet_loading';
  if (data.kind === 'buy') return w.dinerBuy(id, String(data.id));
  return w.dinerRename(id, data.name);
}

function act(room, id, data, now) {
  const st = room.state;
  if (data.kind === 'start') return start(room, id, now);
  if (data.kind === 'buy' || data.kind === 'rename') return st.phase === 'shift' ? 'on_shift' : shop(room, id, data);
  if (st.phase !== 'shift' || id !== st.worker) return 'not_on_shift';
  const slot = Number(data.slot);
  const g = Number.isInteger(slot) && slot >= 0 && slot < st.grills.length ? slot : -1;
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
      if (!st.perks.toppings.includes(data.item)) return 'bad_item';
      if (st.build.toppings.length >= MAX_STACK) return 'stack_full';
      st.build.toppings.push(data.item);
      return null;
    case 'untop':
      if (!st.build.toppings.length) return 'nothing';
      st.build.toppings.pop();
      return null;
    case 'trash':
      st.build = { patty: null, toppings: [] };
      return null;
    // Side stations: start (with a flavour), stop onto the tray, or dump the tray item (else the running one).
    case 'station': {
      if (!Object.hasOwn(st.stations, data.id) || !restaurant.STATIONS[data.id].flavors.includes(data.flavor)) return 'bad_item';
      if (st.stations[data.id]) return 'station_busy';
      if (st.tray[data.id]) return 'tray_full';
      st.stations[data.id] = { flavor: data.flavor, at: now };
      return null;
    }
    case 'station_stop': {
      const run = Object.hasOwn(st.stations, data.id) && st.stations[data.id];
      if (!run) return 'station_empty';
      st.tray[data.id] = { flavor: run.flavor, ms: now - run.at };
      st.stations[data.id] = null;
      return null;
    }
    case 'dump':
      if (!Object.hasOwn(st.stations, data.id)) return 'bad_item';
      if (st.tray[data.id]) delete st.tray[data.id];
      else if (st.stations[data.id]) st.stations[data.id] = null;
      else return 'nothing';
      return null;
    case 'serve': {
      const i = st.tickets.findIndex((t) => t.id === Number(data.ticket));
      if (i === -1) return 'no_ticket';
      if (!st.build.patty) return 'no_patty';
      const t = st.tickets[i];
      const burger = scoreOrder(t, st.build, now, st.rules);
      // Sides: 40% of the score when a ticket has any; the tray items it asked for go with it.
      const want = Object.entries(t.sides || {});
      const q = want.map(([sid, f]) => restaurant.sideQuality(sid, f, st.tray[sid]));
      const score = want.length ? Math.round(0.6 * burger + (40 * q.reduce((a, x) => a + x, 0)) / q.length) : burger;
      const combo = want.length > 0 && burger >= 80 && q.every((x) => x >= 0.8);
      for (const [sid] of want) delete st.tray[sid];
      const { price, tip } = restaurant.orderPay(st.perks, t, score, combo);
      if (combo) st.combos++;
      st.served.push({ id: t.id, score, price, tip, combo });
      st.revenue = Math.round((st.revenue + price) * 100) / 100;
      st.tips = Math.round((st.tips + tip) * 100) / 100;
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
  st.tickets = st.tickets.filter((t) => now - t.at < st.rules.WALK_OUT_MS);
  if (st.tickets.length !== before) { st.missed += before - st.tickets.length; changed = true; }
  if (now >= st.nextArrival) {
    if (st.tickets.length < st.perks.maxTickets) { newTicket(st, now); changed = true; }
    st.nextArrival = now + Math.round(between(ARRIVE_MS) * st.perks.arriveMult);
  }
  return staffWork(st, now) || changed;
}

// Hired staff, on the room tick. The fry cook and soda jerk run their station for whatever a waiting
// ticket wants and pull it mid-window; the prep cook stacks the next topping for the oldest ticket the
// board still fits.
const STAFF_STATION = { frycook: 'fryer', jerk: 'fountain' };
function staffWork(st, now) {
  let changed = false;
  for (const [who, sid] of Object.entries(STAFF_STATION)) {
    if (!st.perks.staff.includes(who)) continue;
    const run = st.stations[sid];
    const { window: [lo, hi] } = restaurant.STATIONS[sid];
    if (run && now - run.at >= (lo + hi) / 2) {
      st.tray[sid] = { flavor: run.flavor, ms: Math.round((lo + hi) / 2) };
      st.stations[sid] = null;
      changed = true;
    } else if (!run && !st.tray[sid]) {
      const t = st.tickets.find((x) => x.sides && x.sides[sid]);
      if (t) { st.stations[sid] = { flavor: t.sides[sid], at: now }; changed = true; }
    }
  }
  if (st.perks.staff.includes('prep') && now >= st.prepAt) {
    st.prepAt = now + restaurant.PREP_MS;
    const b = st.build.toppings;
    const t = st.build.patty && b.length < MAX_STACK
      && st.tickets.find((x) => x.toppings.length > b.length && b.every((item, i) => x.toppings[i] === item));
    if (t) { b.push(t.toppings[b.length]); changed = true; }
  }
  return changed;
}

function buildView(room, id) {
  const st = room.state;
  const w = room.wallet;
  const d = id ? dinerOf(room, id) : null;
  return {
    seq: st.seq, phase: st.phase, serverNow: clock(), endsAt: st.endsAt, tickets: st.tickets, grills: st.grills, build: st.build, stations: st.stations, tray: st.tray,
    served: st.served, missed: st.missed, revenue: st.revenue, tips: st.tips, report: st.report, perks: st.perks,
    balance: w && id ? w.balance(id) : null, guest: w && id ? w.guest(id) : true,
    restaurant: d && { ...d, perks: restaurant.perks(d), quotes: Object.fromEntries(['tier', ...restaurant.UPGRADES.map((u) => u.id)].map((k) => [k, restaurant.quote(d, k)])) },
    catalog: { TIERS: restaurant.TIERS, UPGRADES: restaurant.UPGRADES, STATIONS: restaurant.STATIONS },
    rules: { ...(st.rules || { ...cookRules(1), WALK_OUT_MS }), SHIFT_MS, MAX_STACK, TOPPINGS: st.perks ? st.perks.toppings : [] },
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
  _test: { scoreOrder, step, SHIFT_MS, DONENESS, BURNT_MS, WALK_OUT_MS, setRng(fn) { rng = fn; }, setClock(fn) { clock = fn; } },
};
