// Rough diner economy check: pay per shift at each stage of a restaurant, for a good and an average
// player, using the real perks()/orderPay() from server/casino/diner.js. Run: node scripts/diner-balance.js
// shortcut: models throughput (arrivals vs. how fast one player can cook and assemble), not a real
// shift; replay actual shifts through the engine if the numbers ever need to be exact.
'use strict';
const R = require('../server/casino/diner');

const SHIFT_S = 180;
const ARRIVE_S = 13; // mean of ARRIVE_MS in server/games/diner.js
const COOK_S = 9.5; // mean target doneness
const PLAYERS = {
  good: { score: 92, assemble: 4, side: 3, combo: 0.7, walkouts: 0 },
  average: { score: 72, assemble: 7, side: 5, combo: 0.2, walkouts: 1.5 },
};

const STAGES = [
  ['fresh truck', 0, {}],
  ['truck, starter kit', 0, { grill: 1, bell: 1, toppings: 1, seats: 1, fryer: 1, fountain: 1 }],
  ['diner, mid', 1, { grill: 2, bell: 1, burners: 1, toppings: 2, seats: 2, premium: 1, booths: 1, billboard: 1, fryer: 1, fountain: 1, shake: 1, frycook: 1 }],
  ['restaurant, mid', 2, { grill: 2, bell: 1, burners: 2, toppings: 2, seats: 2, premium: 2, booths: 2, billboard: 2, fryer: 1, fountain: 1, shake: 1, frycook: 1, jerk: 1, prep: 1, host: 1 }],
  ['franchise, maxed', 3, Object.fromEntries(R.UPGRADES.map((u) => [u.id, u.prices.length]))],
];

function shift(d, pl) {
  const p = R.perks(d);
  const arrivals = SHIFT_S / (ARRIVE_S * p.arriveMult) + 1;
  const staffed = { fryer: p.staff.includes('frycook'), fountain: p.staff.includes('jerk'), shake: false };
  const sidesPer = p.stations.reduce((a, s) => a + (staffed[s] ? 0 : (R.SIDE_ODDS / 100) * pl.side), 0);
  const assemble = pl.assemble * (p.staff.includes('prep') ? 0.5 : 1) + sidesPer;
  const perBurger = Math.max(assemble, (COOK_S * p.cookMult) / p.grills);
  const served = Math.max(0, Math.min(arrivals, SHIFT_S / perBurger) - pl.walkouts);
  const tk = { toppings: Array(Math.min(p.toppings.length, 3)).fill('x'), sides: Object.fromEntries(p.stations.map((s) => [s, 'x'])) };
  const sideShare = R.SIDE_ODDS / 100; // average ticket carries this fraction of each side
  const plain = R.orderPay(p, { ...tk, sides: {} }, pl.score);
  const full = R.orderPay(p, tk, pl.score, true);
  const noCombo = R.orderPay(p, tk, pl.score, false);
  const side = p.stations.length ? sideShare * (pl.combo * (full.price + full.tip) + (1 - pl.combo) * (noCombo.price + noCombo.tip) - plain.price - plain.tip) : 0;
  const per = plain.price + plain.tip + side;
  return { served, gross: served * per, wages: p.wages, net: Math.max(0, served * per - p.wages) };
}

const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
let spent = 0;
for (const [name, tier, levels] of STAGES) {
  const d = { ...R.fresh(), tier, levels, rep: 250 };
  const cost = R.TIERS.slice(1, tier + 1).reduce((a, t) => a + t.price, 0)
    + Object.entries(levels).reduce((a, [id, n]) => a + R.UPGRADES.find((u) => u.id === id).prices.slice(0, n).reduce((x, y) => x + y, 0), 0);
  const g = shift(d, PLAYERS.good);
  const a = shift(d, PLAYERS.average);
  console.log(`${name.padEnd(20)} invested ${money(cost).padStart(9)} | good ${money(g.net).padStart(7)} (${g.served.toFixed(0)} served)`
    + ` | avg ${money(a.net).padStart(7)} | shifts to earn it back (good) ${(cost - spent ? (cost - spent) / g.net : 0).toFixed(0)}`);
  spent = cost;
}
