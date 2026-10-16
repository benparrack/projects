import test from 'node:test';
import assert from 'node:assert/strict';
import { parseICS } from '../ics.js';
import { planDay, nextMorning, note, occursOn, stats } from '../plan.js';

const cal = (body) => parseICS(`BEGIN:VCALENDAR\n${body}\nEND:VCALENDAR`).events;
const ev = (uid, start, extra = '') => `BEGIN:VEVENT\nUID:${uid}\nDTSTART${start}\n${extra}END:VEVENT`;
const events = cal([
  ev('event-assignment-1', ':20261016T060000Z', 'SUMMARY:Essay due [HIST101]\n'),
  ev('te-2', ';TZID=Europe/Stockholm:20261016T130000', 'SUMMARY:Lab\n'),
  ev('te-1', ';TZID=Europe/Stockholm:20261016T091500', 'SUMMARY:Linear Algebra\nLOCATION:Room B2\n'),
  ev('te-0', ';TZID=Europe/Stockholm:20261016T080000', 'SUMMARY:Cancelled lecture\nSTATUS:CANCELLED\n'),
  ev('te-3', ';VALUE=DATE:20261016', 'SUMMARY:All day thing\n'),
].join('\n'));
const cfg = { prep: 75, extra: 2, commute: 30, sleep: 8, tz: 'Europe/Stockholm' };

test('plans from the earliest real class: skips due dates, all-day and cancelled items', () => {
  const p = planDay(events, '2026-10-16', cfg);
  assert.deepEqual(p.alarms, ['08:00', '08:05', '08:10']);
  assert.deepEqual(p.first, { time: '09:15', summary: 'Linear Algebra', location: 'Room B2' });
  assert.equal(p.leave, '08:45');
  assert.equal(note(p), 'Friday: Linear Algebra at 09:15. Alarm 08:00. Lights out by 00:00.');
});

test('the coming morning is tomorrow in the evening, today after midnight', () => {
  assert.equal(nextMorning(new Date('2026-10-15T20:00:00Z'), cfg.tz), '2026-10-16'); // 22:00
  assert.equal(nextMorning(new Date('2026-10-15T23:30:00Z'), cfg.tz), '2026-10-16'); // 01:30
  assert.equal(nextMorning(new Date('2026-10-16T03:30:00Z'), cfg.tz), '2026-10-17'); // 05:30
});

test('overrides: skip, custom time, and a custom time on a day with no class', () => {
  assert.deepEqual(planDay(events, '2026-10-16', cfg, { skip: true }).alarms, []);
  assert.equal(note(planDay(events, '2026-10-16', cfg, { skip: true })), 'Friday: you switched the alarm off. Sleep in.');
  assert.equal(planDay(events, '2026-10-16', cfg, { time: '07:00' }).alarms[0], '07:00');
  const sat = planDay(events, '2026-10-17', cfg, { time: '09:30' });
  assert.equal(note(sat), 'Saturday: no class. Alarm 09:30 (your time). Lights out by 01:30.');
  assert.equal(note(planDay(events, '2026-10-17', cfg)), 'No class Saturday morning. No alarm, sleep in.');
});

test('weekly repeating classes, with a skipped week and a moved session', () => {
  const rep = cal([
    ev('g1', ';TZID=Europe/Stockholm:20261005T100000', 'SUMMARY:Physics\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261231T235959Z\nEXDATE;TZID=Europe/Stockholm:20261019T100000\n'),
    ev('g1', ';TZID=Europe/Stockholm:20261021T080000', 'SUMMARY:Physics (moved)\nRECURRENCE-ID;TZID=Europe/Stockholm:20261021T100000\n'),
  ].join('\n'));
  const first = (d) => planDay(rep, d, cfg).first?.time;
  assert.equal(first('2026-10-12'), '10:00'); // Monday
  assert.equal(first('2026-10-14'), '10:00'); // Wednesday
  assert.equal(first('2026-10-13'), undefined); // Tuesday
  assert.equal(first('2026-10-19'), undefined); // EXDATE
  assert.equal(first('2026-10-21'), '08:00'); // moved, and only once
  assert.equal(planDay(rep, '2026-10-21', cfg).classes.length, 1);
  assert.equal(first('2026-11-02'), '10:00'); // keeps going across the DST change
  assert.equal(first('2027-01-04'), undefined); // after UNTIL
});

test('rrule interval and count', () => {
  assert.equal(occursOn('2026-10-05', 'FREQ=WEEKLY;INTERVAL=2', '2026-10-12'), false);
  assert.equal(occursOn('2026-10-05', 'FREQ=WEEKLY;INTERVAL=2', '2026-10-19'), true);
  assert.equal(occursOn('2026-10-05', 'FREQ=DAILY;COUNT=3', '2026-10-07'), true);
  assert.equal(occursOn('2026-10-05', 'FREQ=DAILY;COUNT=3', '2026-10-08'), false);
});

test('stats: on time, late, missed, streaks', () => {
  const a = ['08:00', '08:05', '08:10'];
  const s = stats({
    '2026-10-10': { alarms: a, up: '08:04' },
    '2026-10-11': { alarms: a },               // missed
    '2026-10-12': { alarms: a, up: '08:30' },  // late
    '2026-10-13': { alarms: a, up: '07:55' },
    '2026-10-14': { alarms: a, up: '08:12' },  // within 5 min of the last alarm
    '2026-10-15': { alarms: a },               // today, not up yet: not counted
    '2026-10-09': { alarms: [] },              // no alarm that day
  }, '2026-10-15');
  assert.deepEqual(s.days.map((d) => d.status), ['ontime', 'missed', 'late', 'ontime', 'ontime']);
  assert.equal(s.streak, 2);
  assert.equal(s.best, 2);
  assert.equal(s.rate, 3 / 5);
  assert.equal(s.avgUp, Math.round((4 + 30 + 0 + 12) / 4));
});
