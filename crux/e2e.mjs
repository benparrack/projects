import { firefox } from '/home/ben/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core/index.mjs';
import assert from 'assert';
import fs from 'fs';
// Run: python3 -m http.server 5191 (in this folder), then node e2e.mjs [screenshot-dir]  (URL=... to test the live site)
const shots = process.argv[2], url = process.env.URL || 'http://localhost:5191/';
const b = await firefox.launch({ env: { ...process.env, MOZ_DISABLE_CONTENT_SANDBOX: '1' } });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(url); await p.evaluate(() => { localStorage.clear(); indexedDB.deleteDatabase('crux'); }); await p.reload(); await p.waitForTimeout(400);
const st = () => p.evaluate(() => JSON.parse(JSON.stringify(crux.state)));
const shot = async n => shots && p.screenshot({ path: `${shots}/${n}.png` });
const text = () => p.textContent('#view');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');
const newRoute = async (grade, color) => {
  await p.click('#sheet [data-act="newroute"]');
  if (grade !== undefined) await p.click(`[data-act="dgrade"][data-v="${grade}"]`);
  if (color) await p.click(`[data-act="dcolor"][data-v="${color}"]`);
};

// ---- session 1 at a gym: a 6B flash (with photo) and a 6C project ----
await shot('1-empty');
await p.fill('#gym', 'Klätterverket');
await p.click('[data-act="start"]');
assert.match(await p.textContent('.session .gym'), /Klätterverket/);
await p.click('[data-act="log"]');
await newRoute();
assert(await p.isDisabled('[data-act="dsave"]'));
await p.click('[data-act="dgrade"][data-v="7"]'); await p.click('[data-act="dcolor"][data-v="blue"]');
await p.fill('#dname', 'The slab'); await p.fill('#dwall', 'Slab wall');
await p.setInputFiles('#dphoto', { name: 'r.png', mimeType: 'image/png', buffer: PNG });
await p.waitForSelector('.photo');
assert.equal(await p.inputValue('#dname'), 'The slab'); assert.equal(await p.inputValue('#dwall'), 'Slab wall'); // survive re-render
await shot('2-newroute');
await p.click('[data-act="dsave"]'); await shot('3-tries');
await p.click('[data-act="savelog"][data-sent="1"]');
let s = await st();
assert.equal(s.routes.length, 1); assert.equal(s.routes[0].photo, true); assert.equal(s.routes[0].gym, 'Klätterverket');
assert(!JSON.stringify(s).includes('data:image'), 'photos stay out of localStorage');
assert((await p.evaluate(() => crux.photos()[crux.state.routes[0].id])).startsWith('data:image/jpeg'));

// new route remembers last grade + colour
await p.click('[data-act="log"]'); await newRoute();
assert.equal(await p.locator('[data-act="dgrade"].on').getAttribute('data-v'), '7');
assert.equal(await p.locator('[data-act="dcolor"].on').getAttribute('data-v'), 'blue');
await p.click('[data-act="dgrade"][data-v="9"]'); await p.click('[data-act="dcolor"][data-v="red"]'); await p.click('[data-act="dsave"]');
for (let i = 0; i < 2; i++) await p.click('[data-act="tries"][data-v="1"]');
await p.click('[data-act="savelog"][data-sent="0"]');
// another go from the session list merges into the same entry
await p.click('.list .hit >> text=Red 6C');
assert.match(await p.textContent('#sheet'), /already 3 tries this session/);
await p.click('[data-act="savelog"][data-sent="0"]');
s = await st(); assert.equal(s.logs.length, 2); assert.equal(s.logs.find(l => !l.sent).tries, 4);
// search finds by wall
await p.click('[data-act="log"]'); await p.fill('#pickq', 'slab w');
assert.equal(await p.locator('#sheet [data-act="pickroute"]').count(), 1);
await p.click('#sheet [data-act="close"]');
// remove + undo
await p.click('.list .item >> nth=0 >> [data-act="unlog"]');
assert.equal((await st()).logs.length, 1);
await p.click('#toast button'); assert.equal((await st()).logs.length, 2);
await shot('4-session');
assert.match(await p.textContent('.session .meta'), /2 climbs · 1 send · best 6B/);
await p.click('[data-act="end"]');
assert.match(await p.textContent('#sheet'), /Session done[\s\S]*Flashes/);
assert.doesNotMatch(await p.textContent('#sheet'), /New best/); // nothing earlier to beat
await p.click('#sheet [data-act="close"]');
// backdate session 1 so session 2 is a separate, later session
await p.evaluate(() => { const s = crux.state.sessions[0], d = 3 * 864e5; s.start -= d; s.end -= d; crux.state.logs.forEach(l => l.ts -= d); localStorage.setItem('crux.v1', JSON.stringify(crux.state)); });
await p.reload(); await p.waitForTimeout(300);
assert.equal(await p.inputValue('#gym'), 'Klätterverket'); // gym remembered

// ---- session 2: send the 6C project -> personal best ----
await p.click('[data-act="start"]');
await p.click('[data-act="log"]');
assert.match(await p.textContent('#sheet .list .item >> nth=0'), /6C/); // projects first
await p.click('#sheet .list .item >> nth=0'); await p.click('[data-act="savelog"][data-sent="1"]');
await p.click('[data-act="end"]');
assert.match(await p.textContent('#sheet'), /New best: 6C[\s\S]*up from 6B/);
await shot('5-recap');
await p.click('#sheet [data-act="close"]');

// ---- routes ----
await p.goto(url + '#routes'); await p.waitForTimeout(150);
assert.match(await p.textContent('.empty'), /No open projects/);
await p.click('[data-act="filter"][data-v="sent"]'); assert.equal(await p.locator('.card').count(), 2);
await shot('6-routes');
await p.click('.card >> text=The slab');
await p.click('#sheet img[data-act="zoom"]'); assert(await p.isVisible('#lightbox img')); await p.click('#lightbox'); assert(!(await p.isVisible('#lightbox img')));
await shot('7-detail');
await p.click('[data-act="archive"]'); await p.click('#sheet [data-act="close"]');
assert.equal(await p.locator('.card').count(), 1);

// ---- stats ----
await p.goto(url + '#stats'); await p.waitForTimeout(150);
const t = await text();
assert.match(t, /6C\s*Hardest send/); assert.match(t, /50%\s*Flashed \(1\)/); assert.match(t, /2\s*Sessions/);
assert.equal(await p.locator('.chart polyline').count(), 1);
assert.equal(await p.locator('.wk').count(), 12);
assert.equal(await p.locator('.pyr .f').count(), 3);
await shot('8-stats');

// ---- past session sheet: delete a climb, then delete the session (+ undo) ----
await p.goto(url + '#climb'); await p.waitForTimeout(150);
await p.click('[data-act="session"] >> nth=1');
assert.match(await p.textContent('#sheet'), /Klätterverket[\s\S]*Climbs/);
await shot('9-past');
await p.click('#sheet [data-act="delsession"]'); assert.equal((await st()).sessions.length, 2); // first tap only arms it
await p.click('#sheet [data-act="delsession"]'); assert.equal((await st()).sessions.length, 1);
await p.click('#toast button'); assert.equal((await st()).sessions.length, 2);

// ---- backup + restore round trip, photos included ----
await p.goto(url + '#more'); await p.waitForTimeout(150);
const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-act="export"]')]);
const file = await dl.path(), backup = JSON.parse(fs.readFileSync(file, 'utf8'));
assert.equal(backup.routes.length, 2); assert.equal(Object.keys(backup.photos).length, 1);
assert((await st()).lastExport > 0);
await p.evaluate(() => { localStorage.clear(); indexedDB.deleteDatabase('crux'); }); await p.reload(); await p.waitForTimeout(400);
assert.equal((await st()).routes.length, 0);
await p.goto(url + '#more'); await p.setInputFiles('#import', file); await p.waitForTimeout(400);
s = await st(); assert.equal(s.routes.length, 2); assert.equal(s.logs.length, 3);
assert.equal(Object.keys(await p.evaluate(() => crux.photos())).length, 1);
await p.reload(); await p.waitForTimeout(400); // survives reload (photo from IndexedDB)
assert.equal(Object.keys(await p.evaluate(() => crux.photos())).length, 1);

// backup nudge after 10+ logs with no recent backup
await p.evaluate(() => { const l = crux.state.logs[0]; for (let i = 0; i < 9; i++) crux.state.logs.push({ ...l, id: 'x' + i }); crux.state.lastExport = 0; localStorage.setItem('crux.v1', JSON.stringify(crux.state)); });
await p.goto(url + '#climb'); await p.reload(); await p.waitForTimeout(300);
assert(await p.isVisible('.banner'));
await shot('10-climb');

// route delete: two taps + undo
await p.goto(url + '#routes'); await p.click('[data-act="filter"][data-v="all"]'); await p.click('.card');
await p.click('[data-act="delroute"]'); assert.equal((await st()).routes.length, 2);
await p.click('[data-act="delroute"]'); assert.equal((await st()).routes.length, 1);
await p.click('#toast button'); assert.equal((await st()).routes.length, 2);

for (const v of ['climb', 'routes', 'stats', 'more']) {
  await p.goto(url + '#' + v); await p.waitForTimeout(100);
  assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), v + ' scrolls sideways');
}
assert.deepEqual(errs, []);
await b.close(); console.log('e2e ok');
