// Run: node test.js — checks the send/flash/pyramid/stats logic.
const assert = require('assert');
global.window = globalThis;
require('./logic.js');
const L = Logic;

const routes = [
  { id: 'a', disc: 'boulder', grade: 7 },  // 6B
  { id: 'b', disc: 'boulder', grade: 9 },  // 6C
  { id: 'c', disc: 'boulder', grade: 7 },
  { id: 'd', disc: 'rope', grade: 8 },     // 6a+
  { id: 'e', disc: 'boulder', grade: 11, archived: true },
];
const sessions = [{ id: 's1', start: 1000, end: 1000 + 90 * 60000 }, { id: 's2', start: 5000 }];
const logs = [
  { routeId: 'a', sessionId: 's1', ts: 1001, tries: 1, sent: true },   // flash
  { routeId: 'b', sessionId: 's1', ts: 1002, tries: 4, sent: false },
  { routeId: 'b', sessionId: 's2', ts: 5001, tries: 2, sent: true },   // sent in s2 after 6 tries
  { routeId: 'b', sessionId: 's2', ts: 5002, tries: 1, sent: true },   // repeat, not a first send
  { routeId: 'c', sessionId: 's2', ts: 5003, tries: 3, sent: false },
  { routeId: 'd', sessionId: 's1', ts: 1003, tries: 2, sent: true },
];

const a = L.routeStatus('a', logs), b = L.routeStatus('b', logs), c = L.routeStatus('c', logs);
assert(a.sent && a.flash && a.triesToSend === 1);
assert(b.sent && !b.flash && b.triesToSend === 6 && b.tries === 7 && b.sessions === 2 && b.sentTs === 5001);
assert(!c.sent && c.triesToSend === null && c.tries === 3);
assert.deepEqual(L.routeStatus('zzz', logs), { tries: 0, sessions: 0, sent: false, sentTs: null, flash: false, triesToSend: null, last: null });

// Projects: unsent and not archived (e was never tried but is archived).
assert.deepEqual(L.projects(routes, logs).map(r => r.id), ['c']);

// Pyramid: hardest first, with empty grades in between filled in.
assert.deepEqual(L.pyramid(routes, logs, 'boulder').map(p => [p.label, p.n]), [['6C', 1], ['6B+', 0], ['6B', 1]]);
assert.deepEqual(L.pyramid(routes, logs, 'rope').map(p => [p.label, p.n]), [['6a+', 1]]);
assert.deepEqual(L.pyramid([], [], 'rope'), []);

// Hardest per session counts first sends only.
assert.deepEqual(L.hardestBySession(sessions, routes, logs, 'boulder'), [{ start: 1000, grade: 7 }, { start: 5000, grade: 9 }]);
assert.deepEqual(L.hardestBySession(sessions, routes, logs, 'rope'), [{ start: 1000, grade: 8 }]);

const sb = L.summary(routes, logs, 'boulder');
assert.equal(sb.sends, 2); assert.equal(sb.flashes, 1); assert.equal(sb.flashRate, 0.5); assert.equal(sb.hardest, 9); assert.equal(sb.projects, 1);
assert.equal(L.summary(routes, [], 'rope').hardest, null);

const s1 = L.sessionSummary(sessions[0], routes, logs);
assert.deepEqual(s1, { climbs: 3, tries: 7, sends: 2, hardest: '6B · 6a+', minutes: 90 });
assert.equal(L.sessionSummary(sessions[1], routes, logs).minutes, null);

for (const d in L.SCALES) assert.equal(new Set(L.SCALES[d].grades).size, L.SCALES[d].grades.length, d + ' grades unique');
console.log('ok');
