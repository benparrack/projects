import { firefox } from '/home/ben/.npm/_npx/86170c4cd1c5da32/node_modules/playwright-core/index.mjs';
import assert from 'assert';
// Run: python3 -m http.server 5192 (in this folder), then node e2e.mjs [screenshot-dir]  (URL=... to test the live site)
// Open Food Facts is mocked so the run doesn't depend on their servers.
const shots = process.argv[2], url = process.env.URL || 'http://localhost:5192/';
const b = await firefox.launch({ env: { ...process.env, MOZ_DISABLE_CONTENT_SANDBOX: '1' } });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
const PRODUCT = { code: '7310865004703', product_name: 'Proteinpudding Choklad', brands: 'Arla', serving_size: '200 g', serving_quantity: 200,
  nutriments: { 'energy-kcal_100g': 73, proteins_100g: 10, carbohydrates_100g: 5.4, fat_100g: 1.2 } };
await ctx.route('**/world.openfoodfacts.org/**', r => {
  const u = r.request().url();
  if (u.includes('/api/v2/product/7310865004703')) return r.fulfill({ json: { status: 1, product: PRODUCT } });
  if (u.includes('/api/v2/product/')) return r.fulfill({ status: 404, json: { status: 0 } });
  return r.fulfill({ json: { products: u.includes('pudding') ? [PRODUCT] : [] } });
});
await p.goto(url); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(300);
const st = () => p.evaluate(() => JSON.parse(JSON.stringify(tally.state)));
const shot = async n => { if (shots) { await p.waitForTimeout(350); await p.screenshot({ path: `${shots}/${n}.png` }); } };
const click = s => p.click(s);
const today = await p.evaluate(() => tally.ui.today);
const entries = async () => ((await st()).days[today] || { entries: [] }).entries;

// ---------- setup ----------
await shot('01-welcome');
await click('[data-act="snext"]');
await click('[data-act="snext"]'); // nothing filled in
assert.match(await p.textContent('#serr'), /Pick one/);
await click('[data-k="sex"][data-v="m"]');
await p.fill('#sage', '20'); await p.fill('#sft', '6'); await p.fill('#sin', '1.5');
await shot('02-you');
await click('[data-act="snext"]');
await p.fill('#slb', '165'); await click('[data-k="activity"][data-v="light"]');
assert.equal(await p.inputValue('#slb'), '165', 'typed value survives picking activity');
await shot('03-body');
await click('[data-act="snext"]');
assert.match(await p.textContent('#view'), /You burn roughly/);
await p.fill('#sgoal', '155'); await click('[data-act="sby"]:has-text("3 months")');
assert.equal(await p.inputValue('#sgoal'), '155.0');
await shot('04-goal');
await click('[data-act="snext"]');
assert.equal(await p.locator('.choice.pace').count(), 4, 'easy, steady, fast + your date');
assert(await p.locator('.choice.pace.on .tag:has-text("Hits your date")').count(), 'picks a pace that hits the date');
await shot('05-pace');
await click('[data-k="pace"][data-v="steady"]');
await click('[data-act="snext"]');
await click('[data-k="rhythm"][data-v="flex"]');
assert.equal(await p.locator('.days button.on').count(), 2, 'Sat + Sun preselected');
await shot('06-rhythm');
await click('[data-act="snext"]');
await shot('07-done');
let s = await st();
assert.equal(s.plan.goalLb, 155); assert.equal(s.plan.rate, -1); assert.deepEqual(s.plan.flex, [0, 6]);
assert.equal(s.weights[today], 165, 'starting weight logged');
assert(s.plan.kcal > 1900 && s.plan.kcal < 2100, `kcal ${s.plan.kcal}`);
await click('[data-act="sfinish"]');
assert.match(await p.textContent('.label'), /Calories left/);
await shot('08-today-empty');

// ---------- adding food ----------
await click('#fab');
await p.waitForSelector('#sheet[open] #q');
await p.fill('#q', 'banana');
await p.waitForSelector('.rows .rn:has-text("Banana")');
await click('.row:has(.rn:text-is("Banana")) [data-act="quickfood"]');
assert.match(await p.textContent('#sheet .added'), /1 item added · 105 kcal/);
assert(await p.isVisible('#sheet #toast.show'), 'toast shows above the sheet');
await p.fill('#q', 'greek yog');
await click('.rows [data-act="pickfood"] >> nth=0');
await p.waitForSelector('#qtyIn');
await click('[data-act="setqty"][data-v="2"]');
const kcal2 = +(await p.textContent('#facts b')).replace(/\D/g, '');
await shot('10-amount');
await click('[data-act="addfood"]');
assert.match(await p.textContent('#sheet .added'), /2 items added/);
// Open Food Facts search (mocked)
await p.fill('#q', 'pudding');
await p.waitForSelector('.rows .rn:has-text("Proteinpudding")', { timeout: 3000 });
await shot('11-search-off');
await click('.row:has(.rn:has-text("Proteinpudding")) [data-act="pickfood"]');
await click('[data-act="addfood"]');
s = await st();
assert(s.foods['off:7310865004703'], 'logged OFF food is kept for offline use');
// quick add
await click('[data-act="quick"]');
await p.fill('#qk', '450'); await p.fill('#qn', 'Pizza slice');
await click('[data-act="savequick"]');
// barcode lookup by number: known product and unknown one
await p.fill('#q', '');
await click('[data-act="scan"]');
await p.fill('#code', '7310865004703'); await click('[data-act="lookup"]');
await p.waitForSelector('#qtyIn');
assert.match(await p.textContent('#sheet h2'), /Proteinpudding/, 'barcode finds the saved product');
await click('[data-act="backadd"]');
await click('[data-act="scan"]');
await p.fill('#code', '0000000012345'); await click('[data-act="lookup"]');
await p.waitForSelector('#cn');
assert.match(await p.textContent('#sheet'), /isn't in Open Food Facts yet/);
await p.fill('#cn', 'Mystery bar'); await p.fill('#csg', '40'); await p.fill('#ck', '180'); await p.fill('#cp', '12'); await p.fill('#cc', '18'); await p.fill('#cf', '6');
await shot('12-create');
await click('[data-act="savefood"]');
await p.waitForSelector('#qtyIn');
assert.equal(await p.textContent('#facts b'), '180');
await click('[data-act="addfood"]');
s = await st();
const bar = Object.values(s.foods).find(f => f.name === 'Mystery bar');
assert.equal(bar.code, '0000000012345'); assert.equal(bar.k, 450); assert(s.usage[bar.id].star, 'new foods are saved');
await click('#sheet [data-act="close"]');
assert(!(await p.isVisible('#sheet')));
let e = await entries();
assert.equal(e.length, 5);
assert.equal(Math.round(e.reduce((a, x) => a + x.kcal, 0)), 105 + kcal2 + 146 + 450 + 180);
await shot('13-today-logged');

// edit an entry: change amount, move meal, then delete + undo
await click('.entry:has-text("Banana")');
await click('[data-act="unit"] >> nth=-1'); // switch to grams keeps the same amount
assert.equal(await p.inputValue('#qtyIn'), '118');
await p.fill('#qtyIn', '200');
await click('[data-act="amealset"][data-meal="snacks"]');
await click('[data-act="saveentry"]');
e = await entries();
const ban = e.find(x => x.name === 'Banana');
assert.equal(ban.meal, 'snacks'); assert.equal(Math.round(ban.kcal), 178);
await click('.entry:has-text("Banana")'); await click('[data-act="delentry"]');
assert.equal((await entries()).length, 4);
await click('#toast [data-act="undo"]');
assert.equal((await entries()).length, 5);

// weight: edit today's weigh-in
await click('.weigh [data-act="weightsheet"]');
await p.fill('#wv', '164.4'); await click('[data-act="wsave"]');
assert.equal((await st()).weights[today], 164.4);

// save a meal, then log it from the Meals list on another day
const meal = (await entries()).find(x => x.meal !== 'snacks').meal;
await click(`[data-act="mealmenu"][data-meal="${meal}"]`);
await click('[data-act="savemeal"]');
await p.fill('#mname', 'Usual');
await click('[data-act="dosavemeal"]');
assert.equal((await st()).meals.length, 1);
await click('[data-act="day"][data-d="-1"]');
assert.match(await p.textContent('.dayname'), /Yesterday/);
await click(`[data-act="add"][data-meal="lunch"]`);
await click('[data-act="list"][data-v="meals"]');
await click('[data-act="logmeal"] >> nth=0');
await click('#sheet [data-act="close"]');
const yKey = await p.evaluate(() => tally.L.addDays(tally.ui.today, -1));
assert((await st()).days[yKey].entries.every(x => x.meal === 'lunch'));
await click('[data-act="day"][data-d="1"]');
assert(await p.isVisible('.repeat:has-text("Same as yesterday")'), 'offers to repeat yesterday\'s lunch');
await click('.repeat');
assert((await entries()).filter(x => x.meal === 'lunch').length >= 1);

// ---------- seed six weeks of history, then check Progress ----------
await p.evaluate(() => {
  const { L, state } = tally;
  for (let i = 42; i >= 1; i--) {
    const k = L.addDays(tally.ui.today, -i);
    if (i % 9 === 0) continue; // a few missed days
    state.weights[k] = Math.round((171 - (42 - i) / 7 * 0.9 + Math.sin(i * 1.7) * 0.8) * 10) / 10;
    if (i !== 1) state.days[k] = { entries: [{ id: 'x' + i, meal: 'dinner', foodId: null, name: 'Day', qty: 1, g: 1, label: '', kcal: 1950 + (i % 7 === 0 ? 700 : 0) + Math.round(Math.sin(i) * 150), p: 120, c: 200, f: 70 }] };
  }
  state.plan.start = L.addDays(tally.ui.today, -42); state.plan.startLb = 171; state.plan.maintLb = 171;
  tally.render();
});
await click('.tabs a[data-view="progress"]');
await p.waitForSelector('#wchart svg .trend');
assert(await p.locator('#kchart svg .bar').count() > 0);
assert.match(await p.textContent('#view'), /Your real maintenance/);
assert(await p.isVisible('[data-act="usemm"]') || /close to your plan/.test(await p.textContent('#view')), 'measured maintenance is ready');
const box = await p.locator('#wchart svg').boundingBox();
await p.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
assert(await p.isVisible('#wchart .tipbox'), 'chart tooltip');
await shot('20-progress');
await p.mouse.move(5, 5);
await click('[data-act="range"][data-v="30"]');
await p.waitForSelector('#kchart svg .bar');
await p.evaluate(() => scrollTo(0, 900));
await shot('21-progress-lower');
await p.evaluate(() => scrollTo(0, 0));

// ---------- Foods ----------
await click('.tabs a[data-view="foods"]');
assert(await p.isVisible('.rn:has-text("Mystery bar")'), 'saved list has created food');
await click('[data-act="foodstab"][data-v="all"]');
await p.fill('#fq', 'kvarg');
assert(await p.locator('#foodlist .row').count() >= 1);
assert.equal(await p.evaluate(() => document.activeElement.id), 'fq', 'search keeps focus');
await shot('30-foods');
await click('#foodlist [data-act="foodinfo"] >> nth=0');
await shot('31-food-info');
await click('#sheet [data-act="close"]');

// ---------- Plan, settings ----------
await click('.tabs a[data-view="plan"]');
assert.match(await p.textContent('.label.plan'), /Lose/);
await click('details.tips summary >> nth=0');
await shot('40-plan');
await click('[data-act="units"][data-v="metric"]');
await click('.tabs a[data-view="today"]');
assert.match(await p.textContent('.weigh'), /74\.\d kg/);
await click('.tabs a[data-view="plan"]');
await click('[data-act="units"][data-v="us"]');
await click('[data-act="theme"][data-v="dark"]');
await click('.tabs a[data-view="today"]');
await shot('50-dark-today');
await click('.tabs a[data-view="progress"]');
await shot('51-dark-progress');
await click('.tabs a[data-view="today"]');
await click('#fab'); await p.fill('#q', 'chick');
await shot('52-dark-add');
await click('#sheet [data-act="close"]');

// replan keeps the log
await click('.tabs a[data-view="plan"]');
await click('[data-act="replan"]');
await p.fill('#sgoal', '150'); await click('[data-act="snext"]'); await click('[data-act="snext"]'); await click('[data-act="snext"]');
await click('[data-act="sfinish"]');
s = await st();
assert.equal(s.plan.goalLb, 150); assert((s.days[today] || {}).entries.length >= 5, 'log survives a new plan');

// persistence across reloads
await p.reload(); await p.waitForTimeout(300);
assert.match(await p.textContent('.label'), /Calories left|Over budget/);
assert.deepEqual(errs, [], 'no page errors');
await b.close();
console.log('e2e ok');
