import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';

const FEED = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:te-1
DTSTART;TZID=Europe/Stockholm:20261016T091500
SUMMARY:Linear Algebra
END:VEVENT
END:VCALENDAR`;

function envWith(store = {}) {
  const kv = new Map(Object.entries(store));
  return { KEY: 'k1', FEED_URL: 'https://cal.example/feed.ics', BACKUP_ALARMS: '2', kv, RISE: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } } };
}
const call = (env, path, init) => worker.fetch(new Request(`https://rise.test${path}`, init), env);
const withFetch = async (impl, fn) => { const orig = globalThis.fetch; globalThis.fetch = impl; try { return await fn(); } finally { globalThis.fetch = orig; } };
const ok = async () => new Response(FEED);
const down = async () => { throw new Error('network down'); };

// Fixed clock: 2026-10-15 22:00 Stockholm, so the coming morning is Friday the 16th.
const RealDate = Date;
test.before(() => { globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : ['2026-10-15T20:00:00Z'])); } }; });
test.after(() => { globalThis.Date = RealDate; });

test('needs the key', async () => {
  assert.equal((await call(envWith(), '/alarms')).status, 401);
  assert.equal((await call(envWith(), '/alarms?k=nope')).status, 401);
});

test('alarms come from the calendar and get logged for the app', async () => {
  const env = envWith();
  const res = await withFetch(ok, () => call(env, '/alarms?k=k1'));
  assert.equal(await res.text(), '08:00\n08:05\n08:10');
  assert.deepEqual(JSON.parse(env.kv.get('log'))['2026-10-16'], { alarms: ['08:00', '08:05', '08:10'], fetched: '2026-10-15 22:00' });
});

test('calendar down: uses the last good copy, then the fallback, never nothing', async () => {
  const env = envWith({ feed: FEED });
  assert.equal(await (await withFetch(down, () => call(env, '/alarms?k=k1'))).text(), '08:00\n08:05\n08:10');
  assert.match(await (await withFetch(down, () => call(env, '/note?k=k1'))).text(), /Using your last saved schedule: network down/);
  assert.equal(await (await withFetch(down, () => call(envWith(), '/alarms?k=k1'))).text(), '07:30\n07:35\n07:40');
});

test('overrides change what the phone gets, and are validated', async () => {
  const env = envWith();
  const post = (body) => withFetch(ok, () => call(env, '/api/override?k=k1', { method: 'POST', body: JSON.stringify(body) }));
  assert.equal((await post({ date: 'tomorrow', skip: true })).status, 400);
  assert.equal((await post({ date: '2026-10-16', time: '25:00' })).status, 400);
  await post({ date: '2026-10-16', time: '07:10' });
  assert.equal(await (await withFetch(ok, () => call(env, '/alarms?k=k1'))).text(), '07:10\n07:15\n07:20');
  await post({ date: '2026-10-16', skip: true });
  assert.equal(await (await withFetch(ok, () => call(env, '/alarms?k=k1'))).text(), '');
  assert.equal(await (await withFetch(down, () => call(env, '/alarms?k=k1'))).text(), '', 'a skip holds even when the calendar is down');
  await post({ date: '2026-10-16' });
  assert.equal(await (await withFetch(ok, () => call(env, '/alarms?k=k1'))).text(), '08:00\n08:05\n08:10');
});

test("I'm up: first scan counts, and home reports it", async () => {
  const env = envWith();
  const home = await (await withFetch(ok, () => call(env, '/api/up?k=k1', { method: 'POST' }))).json();
  assert.equal(home.log['2026-10-15'].up, '22:00');
  assert.equal(home.week[1].first.summary, 'Linear Algebra');
  assert.equal(home.next, '2026-10-16');
});
