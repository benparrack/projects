import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { parseICS, feedItems } from '../public/ics.js';
import { feed } from '../worker.js';

// Shape of a real Canvas feed: CRLF, folded lines, escapes, "Title [Course]".
const CANVAS = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:Ben Parrack Calendar (Canvas)',
  'BEGIN:VEVENT', 'UID:event-assignment-101', 'DTSTART:20261020T235900Z',
  'SUMMARY:Lab 3\\, part A [CHEM 101 Gen', ' eral Chemistry]', 'URL;VALUE=URI:https://school.instructure.com/courses/1/assignments/101', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:event-assignment-102', 'DTSTART;VALUE=DATE:20261022',
  'SUMMARY:Essay draft [ENG 200]', 'DESCRIPTION:Line one\\nline two', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:no-date', 'SUMMARY:Broken', 'END:VEVENT',
  'END:VCALENDAR', '',
].join('\r\n');

test('parses Canvas feed: folding, escapes, dates, course', () => {
  const { calName, events } = parseICS(CANVAS);
  assert.equal(calName, 'Ben Parrack Calendar (Canvas)');
  assert.equal(events.length, 2, 'event without a date is dropped');
  assert.equal(events[1].description, 'Line one\nline two');

  const [lab, essay] = feedItems(CANVAS, 'webcal://school.instructure.com/feeds/x.ics');
  assert.equal(lab.title, 'Lab 3, part A');
  assert.equal(lab.course, 'CHEM 101 General Chemistry');
  assert.equal(lab.due, '2026-10-20T23:59:00.000Z');
  assert.equal(lab.url, 'https://school.instructure.com/courses/1/assignments/101');
  assert.equal(essay.course, 'ENG 200');
  assert.equal(essay.allDay, true);
  const d = new Date(essay.due);
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()], [2026, 9, 22, 23]);
});

test('summary without [course] falls back to the calendar name, then host', () => {
  const noName = 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:a\nDTSTART:20261020T120000\nSUMMARY:Quiz\nURL:javascript:alert(1)\nEND:VEVENT\nEND:VCALENDAR';
  const [q] = feedItems(noName, 'https://lms.example.edu/cal.ics');
  assert.equal(q.course, 'lms.example.edu');
  assert.equal(q.url, '', 'non-http links are dropped');
  assert.equal(feedItems(CANVAS.replace('Essay draft [ENG 200]', 'Essay draft'), 'https://x/y.ics')[1].course, 'Ben Parrack Calendar (Canvas)');
});

test('Canvas TZID=UTC times and non-assignment events', () => {
  const ics = ['BEGIN:VCALENDAR',
    'BEGIN:VEVENT', 'UID:event-assignment-7', 'DTSTART;TZID=UTC:20261020T235900', 'SUMMARY:Unit 2 Quiz [BIO 150]', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:event-calendar-event-9', 'DTSTART;TZID=UTC:20261021T140000', 'SUMMARY:Lecture [BIO 150]', 'END:VEVENT',
    'END:VCALENDAR'].join('\r\n');
  const [quiz, lecture] = feedItems(ics, 'https://canvas.school.edu/feeds/calendars/user_x.ics');
  assert.equal(quiz.due, '2026-10-20T23:59:00.000Z');
  assert.equal(quiz.kind, 'task');
  assert.equal(quiz.type, 'test');
  assert.equal(lecture.kind, 'event');
  assert.equal(lecture.type, undefined);
});

test('Schoology: zone wall times, link in description, no course', () => {
  const ics = ['BEGIN:VCALENDAR',
    'BEGIN:VEVENT', 'UID:a1', 'DTSTART;TZID=America/Chicago:20260304T235900', 'SUMMARY:Worksheet 4',
    'DESCRIPTION:Do odd problems - Link: https://district.schoology.com/assignment/7863396025', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:a2', 'DTSTART;TZID=America/Chicago:20261020T080000', 'SUMMARY:Pep rally',
    'DESCRIPTION: - Link: https://district.schoology.com/event/5551', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:a3', 'DTSTART;TZID=Not/AZone:20261020T080000', 'SUMMARY:x', 'END:VEVENT',
    'END:VCALENDAR'].join('\r\n');
  const [ws, rally, bad] = feedItems(ics, 'webcal://district.schoology.com/calendar/feed/ical/1/ical.ics');
  assert.equal(ws.due, '2026-03-05T05:59:00.000Z', 'CST is UTC-6');
  assert.equal(rally.due, '2026-10-20T13:00:00.000Z', 'CDT is UTC-5');
  assert.equal(ws.url, 'https://district.schoology.com/assignment/7863396025');
  assert.equal(ws.description, 'Do odd problems');
  assert.equal(ws.course, 'Unsorted');
  assert.equal(ws.kind, 'task');
  assert.equal(rally.kind, 'event');
  assert.ok(!isNaN(Date.parse(bad.due)), 'unknown zone falls back to local time');
});

test('proxy only passes calendars through', async () => {
  const srv = http.createServer((req, res) => res.end(req.url === '/cal.ics' ? CANVAS : '<html>hi</html>')).listen(0);
  const base = `http://localhost:${srv.address().port}`;
  try {
    assert.equal((await feed(`${base}/cal.ics`)).status, 200);
    assert.equal((await feed(`${base}/page`)).status, 422);
    assert.equal((await feed('http://example.com/a.ics')).status, 400, 'plain http only for localhost');
    assert.equal((await feed('not a url')).status, 400);
  } finally { srv.close(); }
});
