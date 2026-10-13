import { firefox } from '/home/ben/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core/index.mjs';
import assert from 'assert';
// Run: python3 -m http.server 5181 (in this folder), then node e2e.mjs [screenshot-dir]
const shots = process.argv[2], url = 'http://localhost:5181/';
const b = await firefox.launch({ env: { ...process.env, MOZ_DISABLE_CONTENT_SANDBOX: '1' } });
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(url); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(400);
const st = () => p.evaluate(() => limber.state);

// onboarding: pick areas, name, go
assert(await p.isVisible('#sheet'));
await p.click('[data-a="hamstrings"]'); await p.fill('#o-name', 'Ben'); await p.click('[data-go]');
let s = await st();
assert(s.onboarded && s.settings.name === 'Ben' && s.settings.focus.hamstrings === 1 && s.settings.focus.adductors === 3);
assert(await p.isHidden('#sheet'));
await p.evaluate(() => { limber.state.settings.voice = false; limber.state.settings.sound = false; limber.save(); });

// mode + length change the routine
await p.click('[data-mode="couch"]'); await p.click('[data-min="10"]');
assert.match(await p.textContent('.plan-head'), /couch/i);
const couchIds = (await st()).plan.items.map(i => i.id);
assert(couchIds.length >= 3);
// shuffle gives a different routine
await p.click('[data-act="shuffle"]');
assert.notDeepEqual((await st()).plan.items.map(i => i.id), couchIds);
// swap the first stretch
const before = (await st()).plan.items[0].id;
await p.click('[data-swap="0"]'); await p.click('.swap-list button >> nth=0');
assert.notEqual((await st()).plan.items[0].id, before);

// play: real ticks advance a step, then skip to the end
await p.click('[data-act="start"]');
assert(await p.isVisible('#player.night'));
assert.match(await p.textContent('.p-phase'), /position/i);
await p.evaluate(() => { const P = limber.player; P.el = P.steps[0].sec - 0.3; });
await p.waitForTimeout(700);
assert.match(await p.textContent('.p-phase'), /hold/i);
await p.keyboard.press('Space'); assert.match(await p.textContent('.p-phase'), /paused/i); await p.keyboard.press('Space');
await p.evaluate(() => { const P = limber.player; P.held = P.held.map(() => 90); });
for (let i = 0; i < 60 && await p.evaluate(() => !limber.player.finished); i++) await p.keyboard.press('ArrowRight');
assert(await p.isVisible('.finish'));
s = await st(); assert.equal(s.sessions.length, 1); assert(s.sessions[0].completed && s.sessions[0].sec > 120);
await p.click('[data-feel="4"]'); await p.fill('#f-note', 'Left hip tighter'); await p.click('[data-p="save"]');
assert(await p.isHidden('#player'));
s = await st(); assert.equal(s.sessions[0].feel, 4); assert.equal(s.sessions[0].note, 'Left hip tighter');
assert.equal(await p.textContent('.streak-n'), '1');
assert.match(await p.textContent('.display'), /done for today/i);

// leaving early under two minutes logs nothing
await p.click('[data-mode="quick"]'); await p.click('[data-act="start"]'); await p.keyboard.press('Escape');
assert.match(await p.textContent('#sheet'), /won't count/);
await p.click('[data-stop]'); assert(await p.isHidden('#player')); assert.equal((await st()).sessions.length, 1);

// library: filter, open, hide a stretch from routines
await p.click('.tabs [data-view="library"]');
const all = await p.locator('.lib-card').count();
await p.click('[data-area="adductors"]'); assert((await p.locator('.lib-card').count()) < all);
await p.click('[data-area="all"]'); await p.click('#view-library [data-info="cross-over-bend"]');
await p.click('[data-excl]'); assert((await st()).settings.excluded.includes('cross-over-bend'));
for (const salt of [1, 2, 3]) {
  await p.evaluate(n => { limber.state.shuffle = { date: Logic.dayKey(), salt: n }; limber.state.plan = null; }, salt);
  assert(!(await p.evaluate(() => limber.plan())).some(i => i.id === 'cross-over-bend'));
}

// check-in
await p.click('.tabs [data-view="progress"]'); await p.click('#view-progress [data-act="checkin"]');
await p.fill('[name="reach"]', '-14'); await p.fill('[name="butterfly"]', '22,5'); await p.click('#ck [type="submit"]');
s = await st(); assert.deepEqual([s.checks[0].reach, s.checks[0].butterfly, s.checks[0].straddle], [-14, 22.5, undefined]);
assert.match(await p.textContent('.measures'), /-14/);

// settings: focus, ntfy topic
await p.click('.tabs [data-view="settings"]');
await p.click('[data-set="focus.calves"][data-v="0"]'); assert.equal((await st()).settings.focus.calves, 0);
await p.click('[data-act="gen"]'); assert.match((await st()).settings.ntfy, /^limber-[a-z0-9]{8}$/);
assert.deepEqual(errs, []);
console.log('e2e ok');

// ---------- screenshots with a few weeks of believable history ----------
if (shots) {
  await p.evaluate(() => {
    const L = Logic, t = L.dayKey(), sessions = [], ids = STRETCHES.map(s => s.id);
    for (let d = 52; d >= 1; d--) {
      if ([40, 39, 31, 22, 17, 16, 15, 9].includes(d)) continue;
      const date = L.addDays(t, -d), mode = ['mat', 'couch', 'quick', 'couch', 'mat'][d % 5], sec = { mat: 1250, couch: 1100, quick: 330 }[mode] + (d * 37 % 240);
      sessions.push({ id: 'x' + d, date, at: date, mode, planned: sec, sec, completed: d % 11 !== 0, feel: Math.min(5, 2 + Math.floor((52 - d) / 14) + (d % 3 === 0 ? -1 : 0)), note: d === 3 ? 'Frog felt way easier tonight' : '',
        items: ids.slice(d % 20, d % 20 + 8).map(id => ({ id, sec: Math.round(sec / 8) })) });
    }
    limber.state = { ...limber.state, sessions, plan: null, shuffle: { date: '', salt: 0 }, settings: { ...limber.state.settings, excluded: [], focus: { ...L.DEFAULT_FOCUS }, mode: 'mat' },
      checks: [{ date: L.addDays(t, -45), reach: -18, butterfly: 27, straddle: 84 }, { date: L.addDays(t, -30), reach: -15.5, butterfly: 25, straddle: 90 },
        { date: L.addDays(t, -16), reach: -12, butterfly: 23.5, straddle: 93 }, { date: L.addDays(t, -2), reach: -9.5, butterfly: 21, straddle: 98 }] };
  });
  const snap = async (name, view) => { await p.evaluate(v => { location.hash = v; }, view); await p.waitForTimeout(300); await p.screenshot({ path: `${shots}/${name}.png`, fullPage: true }); };
  for (const [scheme, w, h] of [['light', 1280, 900], ['dark', 1280, 900], ['light', 390, 844]]) {
    await p.emulateMedia({ colorScheme: scheme }); await p.setViewportSize({ width: w, height: h });
    for (const v of ['today', 'progress', 'library', 'settings']) await snap(`${v}-${scheme}-${w}`, v);
  }
  await p.setViewportSize({ width: 1280, height: 900 }); await p.emulateMedia({ colorScheme: 'light' }); await snap('x', 'today');
  await p.click('[data-act="start"]'); await p.evaluate(() => { const P = limber.player; P.el = P.steps[0].sec - 0.3; }); await p.waitForTimeout(1500);
  await p.screenshot({ path: `${shots}/player-mat.png` });
  await p.evaluate(() => { limber.move(1); limber.move(1); limber.move(1); }); await p.waitForTimeout(300); await p.screenshot({ path: `${shots}/player-prep.png` });
  await p.setViewportSize({ width: 390, height: 844 }); await p.screenshot({ path: `${shots}/player-mobile.png` });
  await p.evaluate(() => { limber.player.held = limber.player.held.map(() => 150); limber.finish(); }); await p.waitForTimeout(900); await p.screenshot({ path: `${shots}/finish-mobile.png` });
  await p.click('[data-p="save"]'); await p.setViewportSize({ width: 1280, height: 900 });
  await p.click('[data-mode="couch"]'); await p.click('[data-act="start"]'); await p.evaluate(() => { const P = limber.player; P.el = P.steps[0].sec - 0.3; }); await p.waitForTimeout(1200);
  await p.screenshot({ path: `${shots}/player-couch.png` });
  await p.keyboard.press('Escape'); await p.click('[data-stop]'); await p.waitForTimeout(300);
  await p.click('#view-today [data-info] >> nth=1'); await p.waitForTimeout(400); await p.screenshot({ path: `${shots}/detail.png` });
  await p.keyboard.press('Escape'); await p.click('.tabs [data-view="progress"]'); await p.click('#view-progress [data-act="checkin"]'); await p.waitForTimeout(400); await p.screenshot({ path: `${shots}/checkin.png` });
  await p.keyboard.press('Escape');
  await p.evaluate(() => { localStorage.clear(); }); await p.reload(); await p.waitForTimeout(500); await p.screenshot({ path: `${shots}/onboard.png` });
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(300); await p.screenshot({ path: `${shots}/onboard-mobile.png` });
  assert.deepEqual(errs, []);
  console.log('screenshots in', shots);
}
await b.close();
