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
await p.fill('#sgoal', '100');
assert(await p.isVisible('#gwarn'), 'under-range goal warns while typing');
await p.fill('#sgoal', '150');
assert(!(await p.isVisible('#gwarn')));
await click('[data-act="snext"]'); await click('[data-act="snext"]'); await click('[data-act="snext"]');
await click('[data-act="sfinish"]');
s = await st();
assert.equal(s.plan.goalLb, 150); assert((s.days[today] || {}).entries.length >= 5, 'log survives a new plan');

// ---------- sync: two devices through a mocked GitHub gist ----------
const TOKEN = 'ghp_TestToken1234567890abcdefXYZ';
const hub = { content: null, etag: 1, deny: false, gets: 0, patches: 0 };
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'ETag, X-OAuth-Scopes' };
const reply = (r, status, body, extra = {}) => r.fulfill({ status, headers: { ...cors, 'Content-Type': 'application/json', ...extra }, body: body === undefined ? '' : JSON.stringify(body) });
const hubHas = async (re, want = true) => { for (let i = 0; i < 80 && re.test(hub.content) !== want; i++) await p.waitForTimeout(100); assert.equal(re.test(hub.content), want, `gist ${want ? 'has' : 'lacks'} ${re}`); };
const github = r => {
  const q = r.request(), u = new URL(q.url()), m = q.method(), h = q.headers();
  if (m === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...cors, 'Access-Control-Allow-Headers': 'authorization, content-type, if-none-match, accept', 'Access-Control-Allow-Methods': 'GET, POST, PATCH' } });
  if (hub.deny || h.authorization !== 'Bearer ' + TOKEN) return reply(r, 401, { message: 'Bad credentials' });
  const gistJson = () => ({ id: 'a1b2c3', description: 'Tally sync', files: { 'tally.json': { content: hub.content, truncated: false } } });
  if (u.pathname === '/user') return reply(r, 200, { login: 'tester' }, { 'X-OAuth-Scopes': 'gist' });
  if (u.pathname === '/gists' && m === 'GET') return reply(r, 200, hub.content ? [{ id: 'a1b2c3', description: 'Tally sync', files: { 'tally.json': {} } }] : []);
  if (u.pathname === '/gists' && m === 'POST') { hub.content = JSON.parse(q.postData()).files['tally.json'].content; hub.etag++; return reply(r, 201, gistJson()); }
  if (u.pathname === '/gists/a1b2c3' && m === 'GET') { hub.gets++; return h['if-none-match'] === `"${hub.etag}"` ? r.fulfill({ status: 304, headers: { ...cors, ETag: `"${hub.etag}"` } }) : reply(r, 200, gistJson(), { ETag: `"${hub.etag}"` }); }
  if (u.pathname === '/gists/a1b2c3' && m === 'PATCH') { hub.patches++; hub.content = JSON.parse(q.postData()).files['tally.json'].content; hub.etag++; return reply(r, 200, gistJson(), { ETag: `"${hub.etag}"` }); }
  return reply(r, 404, { message: 'Not Found' });
};
await ctx.route('https://api.github.com/**', github);
// Device A (this one, with a log) connects with a token.
await click('.tabs a[data-view="plan"]');
assert.match(await p.textContent('.settings'), /Keep your phone and computer in step/);
await click('[data-act="syncsheet"]');
await shot('60-sync-setup');
await click('[data-act="syncconnect"]');
assert.match(await p.textContent('#sheet .warn'), /Paste the token/);
await p.fill('#stoken', 'nonsense');
await click('[data-act="syncconnect"]');
await p.waitForSelector('#sheet .warn:has-text("look like a token")');
await p.fill('#stoken', TOKEN);
await click('[data-act="syncconnect"]');
await p.waitForFunction(() => tally.sync && tally.sync.gist === 'a1b2c3' && tally.sync.at);
assert(JSON.parse(hub.content).days[today].entries.length >= 5, 'log uploaded to the gist');
assert(!(await p.evaluate(() => localStorage.getItem('tally'))).includes(TOKEN), 'token kept out of the synced data');
await p.waitForSelector('.settings .syncstat:has-text("Synced")');
await click('[data-act="syncsheet"]');
await p.waitForSelector('#sheet .qr svg');
await shot('61-sync-connected');
const code = `tally-sync:${TOKEN}:a1b2c3`;
await click('#sheet [data-act="close"]');

// Device B: a fresh browser links from the welcome screen with the code and skips setup.
const ctx2 = await b.newContext({ viewport: { width: 1280, height: 860 } });
await ctx2.route('https://api.github.com/**', github);
await ctx2.route('**/world.openfoodfacts.org/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"products":[]}' }));
const q2 = await ctx2.newPage(); q2.on('pageerror', e => errs.push('B: ' + e.message));
await q2.goto(url); await q2.waitForSelector('[data-act="syncsheet"]');
await q2.click('[data-act="syncsheet"]');
await q2.fill('#stoken', code);
await q2.click('[data-act="syncconnect"]');
await q2.waitForSelector('.label .lbig', { timeout: 8000 }).catch(async e => { await q2.screenshot({ path: '/tmp/claude-1000/-home-ben-projects/bade083f-fb09-497c-a901-38d230136afd/scratchpad/shots/dbg.png' }); console.log(await q2.evaluate(() => JSON.stringify({ sync: tally.sync, plan: !!tally.state.plan, sheet: document.querySelector('#sheet').open, txt: document.querySelector('#sheet-body').innerText.slice(-400), body: document.body.className }))); console.log(errs); throw e; });
const stB = () => q2.evaluate(() => JSON.parse(JSON.stringify(tally.state)));
assert.deepEqual((await stB()).days[today].entries.map(e => e.id), (await entries()).map(e => e.id), 'B has A\'s log');
assert.equal((await stB()).plan.goalLb, 150);
// B logs something; A picks it up on its next sync and shows it.
await q2.click('#fab'); await q2.click('[data-act="quick"]');
await q2.fill('#qk', '321'); await q2.fill('#qn', 'Synced snack'); await q2.click('[data-act="savequick"]');
await hubHas(/Synced snack/);
await click('.tabs a[data-view="today"]');
await p.evaluate(() => tally.syncNow());
await p.waitForSelector('.meal:has-text("Synced snack")', { timeout: 4000 });
// A deletes it; the deletion reaches B instead of B putting it back.
const snackId = (await entries()).find(e => e.name === 'Synced snack').id;
await click(`[data-act="edit"][data-id="${snackId}"]`);
await click('#sheet [data-act="delentry"]');
await hubHas(/Synced snack/, false);
await q2.evaluate(() => tally.syncNow());
await q2.waitForFunction(() => !JSON.stringify(tally.state.days).includes('Synced snack'), null, { timeout: 4000 });
if (shots) await q2.screenshot({ path: `${shots}/62-sync-device-b.png` });
// Nothing changed: the next check is a cheap 304, not another upload.
const before = { ...hub };
await q2.evaluate(() => tally.syncNow()); await q2.waitForTimeout(400);
assert.equal(hub.patches, before.patches, 'no upload when nothing changed');
// A revoked token stops sync and Today says so.
hub.deny = true;
await p.evaluate(() => tally.syncNow());
await p.waitForSelector('.nag:has-text("Sync is paused")', { timeout: 4000 });
await shot('63-sync-revoked');
hub.deny = false;
await ctx2.close();
await click('.nag [data-act="syncsheet"]');
await click('#sheet [data-act="syncoff"]'); await click('#sheet [data-act="yes"]');
assert.equal(await p.evaluate(() => tally.sync), null);

// a quick add opens as a quick add, with its numbers, when tapped
await click('.tabs a[data-view="today"]');
const pz = await p.getAttribute('.entry:has-text("Pizza slice") >> nth=0', 'data-id');
await click(`.entry[data-id="${pz}"]`);
assert.match(await p.textContent('#sheet h3'), /Edit quick add/);
assert.equal(await p.inputValue('#qk'), '450');
await p.fill('#qk', '500'); await click('[data-act="savequick"]');
assert.equal((await entries()).find(e => e.id === pz).kcal, 500);

// persistence across reloads
await p.reload(); await p.waitForTimeout(300);
assert.match(await p.textContent('.label'), /Calories left|Over budget/);
assert.deepEqual(errs, [], 'no page errors');
await b.close();
console.log('e2e ok');
