import { firefox } from '/home/ben/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core/index.mjs';
import assert from 'assert';
// Run: python3 -m http.server 5191 (in this folder), then node e2e.mjs [screenshot-dir]
const shots = process.argv[2], url = 'http://localhost:5191/';
const b = await firefox.launch({ env: { ...process.env, MOZ_DISABLE_CONTENT_SANDBOX: '1' } });
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(url); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(300);
const st = () => p.evaluate(() => JSON.parse(localStorage.getItem('crux.v1')));
const shot = async n => shots && p.screenshot({ path: `${shots}/${n}.png`, fullPage: true });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');

await shot('1-empty');
await p.click('[data-act="start"]');
// log a new boulder: 6B+ blue with a photo, sent first go -> flash
await p.click('[data-act="log"]'); await shot('2-pick');
await p.click('#sheet [data-act="newroute"]');
assert(await p.isDisabled('[data-act="dsave"]'));
await p.click('[data-act="dgrade"][data-v="8"]'); await p.click('[data-act="dcolor"][data-v="blue"]');
await p.fill('#dname', 'The slab'); await p.setInputFiles('#dphoto', { name: 'r.png', mimeType: 'image/png', buffer: PNG });
await p.waitForSelector('.photo');
assert.equal(await p.inputValue('#dname'), 'The slab'); // name survives the re-render
await shot('3-newroute');
await p.click('[data-act="dsave"]'); await shot('4-tries');
await p.click('[data-act="savelog"][data-sent="1"]');
let s = await st();
assert.equal(s.routes.length, 1); assert(s.routes[0].photo.startsWith('data:image/jpeg'));
assert.deepEqual([s.logs[0].tries, s.logs[0].sent], [1, true]);

// a 6C project: 4 tries, not sent
await p.click('[data-act="log"]'); await p.click('#sheet [data-act="newroute"]');
await p.click('[data-act="dgrade"][data-v="9"]'); await p.click('[data-act="dsave"]');
for (let i = 0; i < 3; i++) await p.click('[data-act="tries"][data-v="1"]');
await p.click('[data-act="savelog"][data-sent="0"]');
// search picks existing routes
await p.click('[data-act="log"]'); await p.fill('#pickq', 'slab');
assert.equal(await p.locator('#sheet [data-act="pickroute"]').count(), 1);
await p.click('#sheet [data-act="close"]');
await shot('5-session');
assert.match(await p.textContent('.session .meta'), /2 climbs · 1 send · best 6B\+/);
await p.click('[data-act="end"]');
s = await st(); assert.equal(s.active, null); assert(s.sessions[0].end);
assert.match(await p.textContent('#view'), /Past sessions[\s\S]*2 climbs/);

// projects tab shows only the unsent 6C; sent shows the slab
await p.goto(url + '#routes'); await p.waitForTimeout(100);
assert.equal(await p.locator('.card').count(), 1); assert.match(await p.textContent('.card'), /6C/);
await p.click('[data-act="filter"][data-v="sent"]'); assert.match(await p.textContent('.card'), /The slab[\s\S]*Flash/);
await shot('6-routes');
// route detail: log another go from it (starts a new session), then archive
await p.click('[data-act="filter"][data-v="projects"]'); await p.click('.card');
await p.click('[data-act="logthis"]'); await p.click('[data-act="tries"][data-v="1"]'); await p.click('[data-act="savelog"][data-sent="1"]');
s = await st(); assert(s.active); assert.equal(s.sessions.length, 2);
await p.click('[data-act="filter"][data-v="sent"]'); assert.equal(await p.locator('.card').count(), 2);
await p.click('.card >> text=6C'); await shot('7-detail');
await p.click('[data-act="archive"]'); await p.keyboard.press('Escape');
assert.equal(await p.locator('.card').count(), 1);

// stats
await p.goto(url + '#stats'); await p.waitForTimeout(100);
const t = await p.textContent('#view');
assert.match(t, /6C\s*Hardest send/); assert.match(t, /50%\s*Flashed \(1\)/);
assert.equal(await p.locator('.chart polyline').count(), 1);
assert.match(t, /1\s*Sessions/); assert.match(t, /7\s*Attempts logged/);
await shot('8-stats');
await p.click('[data-act="disc"][data-v="rope"]'); assert.match(await p.textContent('#view'), /Send something/);

// delete needs two taps
await p.goto(url + '#routes'); await p.click('[data-act="filter"][data-v="all"]'); await p.click('.card');
await p.click('[data-act="delroute"]'); assert.equal((await st()).routes.length, 2);
await p.click('[data-act="delroute"]'); assert.equal((await st()).routes.length, 1);

// no horizontal scroll at phone width
assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
assert.deepEqual(errs, []);
await b.close(); console.log('e2e ok');
