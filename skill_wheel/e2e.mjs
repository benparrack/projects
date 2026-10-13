import { firefox, chromium } from '/home/ben/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core/index.mjs';
import assert from 'assert';
import { tmpdir } from 'os';
// Run: python3 -m http.server 5177 (in this folder), then node e2e.mjs [screenshot-dir]
const out = process.argv[2] || tmpdir(), url = 'http://localhost:5177/';
// BROWSER=chrome node e2e.mjs runs it in the installed Google Chrome instead of Firefox.
const b = process.env.BROWSER === 'chrome' ? await chromium.launch({ executablePath: '/usr/bin/google-chrome' })
  : await firefox.launch({ env: { ...process.env, MOZ_DISABLE_CONTENT_SANDBOX: '1' } });
const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(url); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(500);
const runs = () => p.evaluate(() => skillWheel.state.runs);
const revealed = () => p.waitForSelector('#reveal:not([hidden])', { timeout: 15000 });
// targeted spin lands on the requested skill
await p.evaluate(() => skillWheel.spinTo('origami')); await revealed();
assert.equal(await p.textContent('#revealName'), (await p.evaluate(() => SKILLS.find(k => k.id === 'origami').name)));
// re-spin replaces the pending pick, twice at most
await p.click('[data-act="reroll"]'); await revealed(); await p.waitForTimeout(300);
let r = await runs(); assert.equal(r.length, 1); assert.equal(r[0].rerolls, 1); assert.notEqual(r[0].id, 'origami');
await p.click('[data-act="reroll"]'); await revealed(); await p.waitForTimeout(300);
r = await runs(); assert.equal(r.length, 1); assert.equal(r[0].rerolls, 2);
assert(await p.isDisabled('[data-act="reroll"]'));
await p.click('[data-act="accept"]'); await p.waitForTimeout(300);
r = await runs(); assert(!r[0].pending);
// undo the pick: run gone, fresh spin with all re-spins
await p.click('[data-view="week"]'); await p.click('[data-undo-cur]'); await p.click('#sheet .btn.primary'); await p.waitForTimeout(300);
assert.equal((await runs()).length, 0);
await p.keyboard.press('Space'); await revealed(); await p.waitForTimeout(300);
assert.doesNotMatch(await p.textContent('#revealEyebrow'), /fun/i); assert.match(await p.textContent('[data-act="reroll"]'), /2 left/);
await p.click('[data-act="accept"]'); await p.waitForTimeout(300);
// spin while locked = fun, no new run
await p.click('[data-view="wheel"]'); await p.keyboard.press('Space'); await revealed();
assert.match(await p.textContent('#revealEyebrow'), /fun/i);
await p.keyboard.press('Escape'); assert.equal((await runs()).length, 1);
// practice timer: start, pause, resume, finish ticks today off
await p.click('[data-view="week"]'); await p.click('#timerBtn'); await p.waitForTimeout(400);
assert.match(await p.textContent('#timerBtn'), /⏸ \d+:\d\d/); assert.match(await p.title(), /⏳/);
await p.click('#timerBtn'); assert.match(await p.textContent('#timerBtn'), /Resume/);
await p.click('[data-view="wheel"]'); await p.click('[data-view="week"]'); assert.match(await p.textContent('#timerBtn'), /Resume/);
await p.click('#timerBtn'); await p.evaluate(() => { skillWheel.timer.end = Date.now(); }); await p.waitForTimeout(500);
assert.equal((await runs())[0].checks[0], true); assert.equal(await p.$('#timerBtn'), null); assert.equal(await p.title(), 'Skill Wheel');
// 8 days later: week over, prompt to mark learned
await p.click('[data-view="wheel"]');
await p.evaluate(() => skillWheel.setNowOffset(8 * 864e5)); await p.waitForTimeout(200);
assert.match(await p.textContent('#status'), /Time's up/);
await p.click('[data-finish]'); await p.click('[data-r="4"]'); await p.fill('#reflect', 'Harder than it looks');
await p.click('#doneBtn'); await p.waitForTimeout(500);
r = await runs(); assert.equal(r[0].status, 'done'); assert.equal(r[0].rating, 4);
assert.match(await p.textContent('#view-journey'), /1\s*skills learned/);
await p.screenshot({ path: out + '/10-journey-done.png' });
// flick the wheel
await p.click('[data-view="wheel"]'); await p.waitForTimeout(300);
const box = await p.locator('#wheel').boundingBox(), cx = box.x + box.width / 2, cy = box.y + box.height / 2;
await p.mouse.move(cx + 200, cy - 100); await p.mouse.down();
for (let i = 1; i <= 4; i++) await p.mouse.move(cx + 200, cy - 100 + i * 70); // fast, so headless lag can't turn it into a slow drag
await p.mouse.up(); await p.waitForTimeout(200);
assert(await p.evaluate(() => skillWheel.spinning), 'flick should start a spin');
await revealed(); await p.click('[data-act="accept"]'); assert.equal((await runs()).length, 2);
// settings: disabling categories shrinks the wheel
await p.click('[data-view="wheel"]'); await p.click('#settingsBtn');
const before = await p.evaluate(() => skillWheel.order.length);
await p.click('[data-set="cat:music"]'); await p.waitForTimeout(100);
assert((await p.evaluate(() => skillWheel.order.length)) < before);
await p.screenshot({ path: out + '/11-settings.png' });
await p.keyboard.press('Escape');
// mobile reveal
const m = await b.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'light' });
await m.goto(url); await m.evaluate(() => localStorage.clear()); await m.reload(); await m.waitForTimeout(400);
await m.click('#spinBtn'); await m.waitForSelector('#reveal:not([hidden])', { timeout: 15000 }); await m.waitForTimeout(900);
await m.screenshot({ path: out + '/12-mobile-reveal.png' });
await m.click('[data-act="accept"]'); await m.waitForTimeout(400);
await m.screenshot({ path: out + '/13-mobile-week.png' });
assert.deepEqual(errs, []);
console.log('all flows ok');
await b.close();
