// Run: node test.js. Checks the food data and the energy, plan and trend math.
const assert = require('assert');
global.window = globalThis;
require('./logic.js');
require('./foods.js');
const L = Logic;

// ---- food data: every row parses, servings are sane, calories agree with the macros ----
const foods = L.parseDB(FOOD_DB);
assert(foods.length > 180, 'food list loaded');
assert.equal(new Set(foods.map(f => f.id)).size, foods.length, 'unique ids');
for (const f of foods) {
  assert(f.name && [f.k, f.p, f.c, f.f].every(n => Number.isFinite(n) && n >= 0), `numbers: ${f.name}`);
  assert(f.servings.length && f.servings.every(s => s.label && s.g > 0), `servings: ${f.name}`);
  // 4/4/9 kcal per gram. Alcohol and high-fibre foods are the known exceptions.
  const atw = 4 * f.p + 4 * f.c + 9 * f.f;
  // Leafy veg run high because USDA carbs include fibre, which barely counts.
  if (!f.alc && f.k > 20) assert(atw / f.k > 0.85 && atw / f.k < (f.k < 60 ? 1.35 : 1.2), `macros don't add up: ${f.name} (${f.k} vs ${atw.toFixed(0)})`);
}
const banana = foods.find(f => f.name === 'Banana');
assert.deepEqual(banana.servings[0], { label: '1 medium', g: 118 });
assert.equal(Math.round(L.of(banana, 118).kcal), 105);

// ---- search ----
const names = q => L.search(foods, q).map(f => f.name);
assert.equal(names('banana')[0], 'Banana');
assert.equal(names('chick bre')[0], 'Chicken breast, cooked');
assert(names('kottbullar').some(n => n.startsWith('Köttbullar')), 'accents ignored');
assert(names('greek yog').every(n => n.startsWith('Greek yogurt')));
assert.deepEqual(names('zzqx'), []);
const used = foods.map(f => f.name === 'Chicken breast, raw' ? { ...f, uses: 15 } : f);
assert.equal(L.search(used, 'chicken')[0].name, 'Chicken breast, raw', 'frequent foods rank first');

// ---- energy ----
const ben = { sex: 'm', birthYear: 2006, heightIn: 73.5, activity: 'light' };
const bmr = L.bmr(ben, 165, '2026-11-10');
// 10*74.84 + 6.25*186.69 - 5*20 + 5 = 1820.2
assert(Math.abs(bmr - 1820.2) < 1, `bmr ${bmr}`);
assert(Math.abs(L.maintenance(ben, 165, '2026-11-10') - 1820.2 * 1.375) < 2);
const [lo, hi] = L.healthyRange(ben);
assert(lo > 140 && lo < 145 && hi > 186 && hi < 192, `range ${lo} ${hi}`);

// ---- plans ----
let po = L.planOptions({ profile: ben, lb: 165, goalLb: 155, today: '2026-11-10' });
assert.equal(po.dir, 'lose');
assert.deepEqual(po.options.map(o => o.id), ['easy', 'steady', 'fast']);
const steady = po.options[1];
assert.equal(steady.kcal, L.round(po.maint - 500, 10));
assert.equal(steady.finish, '2027-01-19'); // 10 lb at 1 lb/week = 70 days
// A date between presets gets its own option.
po = L.planOptions({ profile: ben, lb: 165, goalLb: 155, by: '2027-02-16', today: '2026-11-10' }); // 14 weeks
const date = po.options.find(o => o.id === 'date');
assert(date && Math.abs(date.rate + 10 / 14) < 0.01 && date.meets);
assert(po.options.find(o => o.id === 'easy').meets === false && po.options.find(o => o.id === 'fast').meets);
// An impossible date doesn't invent an option.
po = L.planOptions({ profile: ben, lb: 165, goalLb: 145, by: '2026-12-01', today: '2026-11-10' });
assert(!po.options.some(o => o.id === 'date') && po.options.every(o => !o.meets) && -po.needed > po.maxLoss);
// Calorie floor: a small sedentary person can't drop under it.
const small = { sex: 'f', birthYear: 1990, heightIn: 61, activity: 'low' };
po = L.planOptions({ profile: small, lb: 120, goalLb: 112, today: '2026-11-10' });
assert(po.options.every(o => o.kcal >= 1200));
assert(po.options.filter(o => o.capped).length <= 1, 'capped duplicates removed');
// Gain and maintain.
assert.deepEqual(L.planOptions({ profile: ben, lb: 165, goalLb: 175, today: '2026-11-10' }).options.map(o => o.id), ['lean', 'steady']);
po = L.planOptions({ profile: ben, lb: 165, goalLb: 165.5, today: '2026-11-10' });
assert(po.dir === 'maintain' && po.options[0].kcal === po.maint);

// ---- flex days: the week adds up to the same total ----
const plan = { kcal: 2000, flex: [5, 6], bonus: 300 };
let week = 0;
for (let i = 0; i < 7; i++) week += L.budget(plan, L.addDays('2026-11-09', i));
assert(Math.abs(week - 14000) <= 50, `week ${week}`);
assert.equal(L.budget(plan, '2026-11-14'), 2300); // Saturday
assert.equal(L.budget(plan, '2026-11-10'), 1880);
assert.equal(L.budget({ kcal: 2000 }, '2026-11-10'), 2000);

// ---- trend, rate, eta ----
const weights = {};
for (let i = 0; i < 42; i++) weights[L.addDays('2026-10-01', i)] = 170 - i / 7 + (i % 3 === 0 ? 1.2 : -0.6); // -1 lb/week plus noise
const tr = L.trend(weights);
assert.equal(tr.length, 42);
const rate = L.rate(tr, '2026-11-11');
assert(rate < -0.8 && rate > -1.2, `rate ${rate}`);
assert.equal(L.eta(160, 155, -1, '2026-11-10'), '2026-12-15');
assert.equal(L.eta(160, 155, 0.5, '2026-11-10'), null);
assert.equal(L.rate(L.trend({ '2026-11-01': 170, '2026-11-02': 169 }), '2026-11-02'), null);
// Gaps don't break it.
const gappy = L.trend({ '2026-01-01': 180, '2026-03-01': 170 });
assert(gappy[1].trend < 175 && gappy[1].trend > 170);

// ---- measured maintenance: eat 2000 a day while losing 1 lb/week => ~2500 ----
const state = { days: {}, weights: {} };
for (let i = 0; i < 40; i++) {
  const k = L.addDays('2026-10-01', i);
  state.days[k] = { entries: [{ kcal: 2000, p: 100, c: 200, f: 70 }] };
  state.weights[k] = 175 - i / 7;
}
const mm = L.measuredMaintenance(state, '2026-11-10');
assert(mm.ready && Math.abs(mm.kcal - 2500) <= 60, `measured ${JSON.stringify(mm)}`);
assert.equal(L.measuredMaintenance({ days: {}, weights: {} }, '2026-11-10').ready, false);
assert.equal(L.streak(state, '2026-11-09'), 40);
assert.equal(L.streak(state, '2026-11-10'), 40, 'today not logged yet still counts the run to yesterday');
assert.equal(L.streak(state, '2026-11-12'), 0);

// ---- Open Food Facts parsing ----
const off = L.fromOFF({ code: '123', product_name: 'Kvarg', brands: 'Lindahls, Arla', serving_size: '150 g', serving_quantity: 150,
  nutriments: { 'energy-kcal_100g': 60, proteins_100g: 10, carbohydrates_100g: 3.5, fat_100g: 0.2 } });
assert.deepEqual([off.id, off.brand, off.k, off.servings[0].g], ['off:123', 'Lindahls', 60, 150]);
assert.equal(L.fromOFF({ code: '1', product_name: 'Yogurt', nutriments: { 'energy-kcal_100g': 238, proteins_100g: 10, carbohydrates_100g: 3.4, fat_100g: 0.2 } }), null, 'nonsense rejected');
assert.equal(Math.round(L.fromOFF({ code: '2', product_name: 'X', nutriments: { 'energy-kj_100g': 418.4 } }).k), 100, 'kJ converted');
assert.equal(L.fromOFF({ code: '3', nutriments: { 'energy-kcal_100g': 50 } }), null, 'needs a name');

// ---- suggestions favour protein when it's behind ----
const sug = L.suggest(foods, 400, 60);
assert(sug.length && sug.every(s => s.n.kcal <= 400 && s.n.p * 4 / s.n.kcal >= 0.25));
assert.deepEqual(L.suggest(foods, 30, 60), []);

assert.equal(L.mealFor(8), 'breakfast');
assert.equal(L.mealFor(19), 'dinner');
assert.equal(L.amountText({ qty: 0.5, g: 118, label: '1 medium' }), '½ × 1 medium');
assert.equal(L.amountText({ qty: 150, g: 1, label: 'g' }), '150 g');
assert.equal(L.amountText({ qty: 1, g: 118, label: '1 medium' }), '1 medium');
// ---- sync: record-by-record merge ----
{
  const blank = () => ({ v: 1, profile: null, plan: null, settings: { units: 'us', theme: 'auto' }, days: {}, weights: {}, foods: {}, usage: {}, meals: [], ts: {}, backupAt: null });
  const ent = (id, kcal, meal = 'lunch') => ({ id, meal, foodId: null, name: 'x', qty: 1, g: 1, label: '', kcal, p: 0, c: 0, f: 0 });
  const edit = (s, snap, fn, t) => { fn(s); return L.stamp(s, snap, t).snap; };
  const T = 1_800_000_000_000;
  // Phone and laptop start from the same synced copy.
  let phone = blank(), pSnap = L.snapshot(phone);
  pSnap = edit(phone, pSnap, s => { s.plan = { kcal: 2000 }; s.days['2026-11-10'] = { entries: [ent('a1', 100), ent('a2', 200)] }; s.weights['2026-11-10'] = 165; }, T);
  let laptop = L.merge(blank(), phone, T), lSnap = L.snapshot(laptop);
  assert.deepEqual(L.flatten(laptop), L.flatten(phone));
  // Both change things while apart: phone adds breakfast and deletes a2; laptop adds lunch, edits a1, logs a weight.
  pSnap = edit(phone, pSnap, s => { s.days['2026-11-10'].entries.push(ent('b1', 300, 'breakfast')); s.days['2026-11-10'].entries = s.days['2026-11-10'].entries.filter(e => e.id !== 'a2'); }, T + 10);
  lSnap = edit(laptop, lSnap, s => { s.days['2026-11-10'].entries.push(ent('c1', 400)); s.days['2026-11-10'].entries[0].kcal = 150; s.weights['2026-11-11'] = 164; }, T + 20);
  const m1 = L.merge(phone, laptop, T + 30), m2 = L.merge(laptop, phone, T + 30);
  assert.equal(JSON.stringify(m1), JSON.stringify(m2), 'merge is the same from either side');
  assert.deepEqual(m1.days['2026-11-10'].entries.map(e => [e.id, e.kcal]), [['a1', 150], ['b1', 300], ['c1', 400]]);
  assert.deepEqual(m1.weights, { '2026-11-10': 165, '2026-11-11': 164 });
  assert.equal(L.merge(m1, m1, T + 30).days['2026-11-10'].entries.length, 3, 'merging twice changes nothing');
  // Undo after a delete brings the entry back everywhere (newer stamp than the deletion).
  phone = m1; pSnap = L.snapshot(phone);
  const gone = phone.days['2026-11-10'].entries.find(e => e.id === 'b1');
  pSnap = edit(phone, pSnap, s => { s.days['2026-11-10'].entries = s.days['2026-11-10'].entries.filter(e => e.id !== 'b1'); }, T + 40);
  assert(!L.merge(m1, phone, T + 41).days['2026-11-10'].entries.some(e => e.id === 'b1'), 'deletion wins over the older copy');
  pSnap = edit(phone, pSnap, s => { s.days['2026-11-10'].entries.push(gone); }, T + 50);
  assert(L.merge(m1, phone, T + 51).days['2026-11-10'].entries.some(e => e.id === 'b1'));
  // Erasing everything reaches the other copy instead of being filled back in.
  const wiped = { ...blank(), ts: { ...phone.ts } };
  L.stamp(wiped, pSnap, T + 60);
  const after = L.merge(m1, wiped, T + 61);
  assert.equal(after.plan, null); assert.deepEqual(after.days, {}); assert.deepEqual(after.weights, {});
  // Data from before sync existed (no stamps) is kept from both sides.
  const old1 = { ...blank(), days: { '2026-11-01': { entries: [ent('o1', 50)] } } }, old2 = { ...blank(), weights: { '2026-11-01': 170 } };
  const mo = L.merge(old1, old2, T);
  assert.equal(mo.days['2026-11-01'].entries.length, 1); assert.equal(mo.weights['2026-11-01'], 170);
  // Stamps older than four months are dropped; recent ones stay.
  assert.equal(L.merge(m1, m1, T + 200 * 864e5).ts.plan, undefined);
  assert.equal(L.merge(m1, m1, T + 60).ts.plan, T);
}

console.log(`ok: ${foods.length} foods, all checks passed`);
