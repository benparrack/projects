import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuick } from '../public/quick.js';

const NOW = new Date(2026, 9, 15, 14, 0).getTime(); // Thursday Oct 15 2026, 2 PM
const ymd = (d) => d && [d.getFullYear(), d.getMonth() + 1, d.getDate()];
const q = (s) => { const r = parseQuick(s, NOW); return [r.title, ymd(r.date), r.time]; };

test('trailing dates and times', () => {
  assert.deepEqual(q('Essay draft fri 5pm'), ['Essay draft', [2026, 10, 16], [17, 0]]);
  assert.deepEqual(q('Bio test tomorrow'), ['Bio test', [2026, 10, 16], null]);
  assert.deepEqual(q('Lab report due monday at 9:30am'), ['Lab report', [2026, 10, 19], [9, 30]]);
  assert.deepEqual(q('Read ch 4 today'), ['Read ch 4', [2026, 10, 15], null]);
  assert.deepEqual(q('Call mom thursday'), ['Call mom', [2026, 10, 15], null], 'same weekday is today');
  assert.deepEqual(q('Project oct 30'), ['Project', [2026, 10, 30], null]);
  assert.deepEqual(q('Project 2nd november 23:59'), ['Project', [2026, 11, 2], [23, 59]]);
  assert.deepEqual(q('Final jan 12'), ['Final', [2027, 1, 12], null], 'past month rolls to next year');
  assert.deepEqual(q('Retake in 3 days'), ['Retake', [2026, 10, 18], null]);
  assert.deepEqual(q('Club 12pm'), ['Club', null, [12, 0]]);
  assert.deepEqual(q('Club 12am'), ['Club', null, [0, 0]]);
});

test('leaves ordinary titles alone', () => {
  for (const s of ['Problem set 7', 'Read Monday reading', 'Read ch. 5', 'Friday', 'Study for the may exam', 'Chapter 13 pm notes']) {
    const r = parseQuick(s, NOW);
    assert.equal(r.title, s, s);
    assert.equal(r.date, null, s);
  }
  assert.deepEqual(q('Page 25 pm'), ['Page 25 pm', null, null], '25pm is not a time');
});
