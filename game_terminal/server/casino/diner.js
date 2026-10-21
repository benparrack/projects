// Your restaurant: the tiers, the upgrade shop and what they do to a shift, all in one place so the
// diner economy can be tuned without touching the shift engine (../games/diner.js).
// The restaurant itself lives on the casino account doc as `diner` (see wallet.js dinerOf/dinerBuy).
'use strict';

// Each tier multiplies every price on the menu; buying the next one is the big goal.
const TIERS = [
  { id: 'truck', name: 'Food Truck', price: 0, mult: 1 },
  { id: 'diner', name: 'Diner', price: 1500, mult: 1.6 },
  { id: 'restaurant', name: 'Restaurant', price: 12000, mult: 3 },
  { id: 'franchise', name: 'Franchise', price: 80000, mult: 6 },
];

// Toppings unlock in this order: the truck starts with the first four, each "extra toppings" level adds two.
const TOPPINGS = ['lettuce', 'tomato', 'cheese', 'onion', 'pickles', 'bacon', 'jalapeno', 'mushroom', 'egg', 'avocado'];
const BASE_TOPPINGS = 4;

// prices[i] buys level i+1; tiers[i] is the restaurant tier that level needs.
const UPGRADES = [
  { id: 'grill', tab: 'kitchen', name: 'Extra grill', icon: '🔥', prices: [250, 2500, 15000], tiers: [0, 1, 2], desc: 'Another patty on the go at once.' },
  { id: 'burners', tab: 'kitchen', name: 'Hot burners', icon: '♨️', prices: [400, 3000, 20000], tiers: [0, 1, 2], desc: 'Patties cook 15% faster per level.' },
  { id: 'bell', tab: 'kitchen', name: 'Doneness bell', icon: '🔔', prices: [300], tiers: [0], desc: 'A patty glows and dings when it hits the ticket\'s doneness.' },
  { id: 'toppings', tab: 'kitchen', name: 'Extra toppings', icon: '🥓', prices: [200, 1500, 8000], tiers: [0, 1, 2], desc: 'Two new toppings per level. Bigger burgers sell for more.' },
  { id: 'premium', tab: 'kitchen', name: 'Premium ingredients', icon: '🥩', prices: [500, 4000, 25000], tiers: [0, 1, 2], desc: 'Tips ×1.25 per level.' },
  { id: 'seats', tab: 'dining', name: 'Counter seats', icon: '🪑', prices: [300, 2000, 10000], tiers: [0, 1, 2], desc: 'Room for one more customer at a time.' },
  { id: 'booths', tab: 'dining', name: 'Comfy booths', icon: '🛋️', prices: [350, 2500, 15000], tiers: [0, 1, 2], desc: 'Customers wait 20% longer per level.' },
  { id: 'billboard', tab: 'dining', name: 'Billboard', icon: '🪧', prices: [600, 5000, 30000], tiers: [0, 1, 2], desc: 'Customers show up 20% more often per level.' },
];

const BURGER_PRICE = 5; // plus TOPPING_PRICE per topping on the ticket
const TOPPING_PRICE = 0.75;
const TIP_SHARE = 0.5; // a perfect order tips half its price

const fresh = () => ({ name: 'My Food Truck', tier: 0, levels: {}, shifts: 0, bestShift: 0, earned: 0 });
// Old docs (and docs from before a field existed) get the missing defaults.
const normalize = (d) => Object.assign(fresh(), d || {}, { levels: { ...((d && d.levels) || {}) } });

const level = (d, id) => d.levels[id] || 0;

// Everything a shift reads from the restaurant, snapshotted when it starts.
function perks(d) {
  const L = (id) => level(d, id);
  return {
    tier: d.tier,
    grills: 1 + L('grill'),
    cookMult: 0.85 ** L('burners'),
    bell: L('bell') > 0,
    toppings: TOPPINGS.slice(0, BASE_TOPPINGS + 2 * L('toppings')),
    tipMult: 1.25 ** L('premium'),
    maxTickets: 2 + L('seats'),
    patienceMult: 1.2 ** L('booths'),
    arriveMult: 0.8 ** L('billboard'),
    priceMult: TIERS[d.tier].mult,
  };
}

// What buying `id` would cost right now, or why it can't be bought. `id` is an upgrade or 'tier'.
function quote(d, id) {
  if (id === 'tier') {
    const next = TIERS[d.tier + 1];
    return next ? { cost: next.price } : { err: 'maxed' };
  }
  const u = UPGRADES.find((x) => x.id === id);
  if (!u) return { err: 'unknown' };
  const n = level(d, id);
  if (n >= u.prices.length) return { err: 'maxed' };
  if (d.tier < u.tiers[n]) return { err: 'tier', need: TIERS[u.tiers[n]].name };
  return { cost: u.prices[n] };
}

// Applies a purchase to `d` if `balance` covers it. Returns { cost } or { err }.
function buy(d, id, balance) {
  const q = quote(d, id);
  if (q.err) return q;
  if (balance < q.cost) return { err: 'broke' };
  if (id === 'tier') {
    d.tier++;
    if (/^My (Food Truck|Diner|Restaurant)$/.test(d.name)) d.name = `My ${TIERS[d.tier].name}`;
  } else d.levels[id] = level(d, id) + 1;
  return { cost: q.cost };
}

// One served order: the menu price (paid in full from a score of 60, less below) and a tip above 50.
function orderPay(p, ticket, score) {
  const price = (BURGER_PRICE + TOPPING_PRICE * ticket.toppings.length) * p.priceMult;
  const paid = price * Math.min(1, score / 60);
  const tip = price * TIP_SHARE * p.tipMult * Math.max(0, score - 50) / 50;
  return { price: Math.round(paid * 100) / 100, tip: Math.round(tip * 100) / 100 };
}

module.exports = { TIERS, TOPPINGS, UPGRADES, fresh, normalize, perks, quote, buy, orderPay };
