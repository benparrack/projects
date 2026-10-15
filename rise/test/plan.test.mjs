import test from 'node:test';
import assert from 'node:assert/strict';
import { parseICS } from '../ics.js';
import { planFor } from '../worker.js';

const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:event-assignment-1
DTSTART:20261016T060000Z
SUMMARY:Essay due [HIST101]
END:VEVENT
BEGIN:VEVENT
UID:te-2
DTSTART;TZID=Europe/Stockholm:20261016T130000
SUMMARY:Lab
END:VEVENT
BEGIN:VEVENT
UID:te-1
DTSTART;TZID=Europe/Stockholm:20261016T091500
SUMMARY:Linear Algebra
END:VEVENT
BEGIN:VEVENT
UID:te-3
DTSTART;VALUE=DATE:20261016
SUMMARY:Holiday-ish all day thing
END:VEVENT
END:VCALENDAR`;
const { events } = parseICS(ics);
const cfg = { prep: 75, extra: 2, tz: 'Europe/Stockholm' };

test('evening: plans tomorrow from the earliest real class, ignoring due dates and all-day items', () => {
  const p = planFor(events, new Date('2026-10-15T20:00:00Z'), cfg); // 22:00 Stockholm
  assert.deepEqual(p.alarms, ['08:00', '08:05', '08:10']);
  assert.equal(p.note, 'Friday: Linear Algebra at 09:15. Alarm 08:00. Lights out by 00:00.');
});

test('after midnight still plans the coming morning', () => {
  assert.deepEqual(planFor(events, new Date('2026-10-15T23:30:00Z'), cfg).alarms[0], '08:00'); // 01:30 Fri
});

test('no class means no alarm', () => {
  const p = planFor(events, new Date('2026-10-16T20:00:00Z'), cfg);
  assert.deepEqual(p.alarms, []);
  assert.match(p.note, /No class Saturday/);
});
