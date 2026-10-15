// Quick-add: pulls a due date/time off the END of a task title, so "Essay draft fri 5pm"
// becomes { title: 'Essay draft', date: <Fri>, time: [17, 0] }. Only trailing words count,
// so titles like "Read Monday's notes" or "Problem set 7" are left alone.
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY_RE = '(sun|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat)(?:day|nesday|rsday|urday)?';
const MON_RE = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';

const at = (now, days) => { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + days); return d; };

const RULES = [
  // times: 5pm, 5:30 pm, 17:00, at 5pm, @ 9am
  [/(?:\s(?:at|@))?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)$/i, (m) => ({ time: [(+m[1] % 12) + (/p/i.test(m[3]) ? 12 : 0), +(m[2] || 0)] }), (m) => +m[1] >= 1 && +m[1] <= 12 && +(m[2] || 0) < 60],
  [/(?:\s(?:at|@))?\s+([01]?\d|2[0-3]):([0-5]\d)$/i, (m) => ({ time: [+m[1], +m[2]] })],
  [/\s+(today|tonight|tod)$/i, (m, now) => ({ date: at(now, 0) })],
  [/\s+(tomorrow|tmrw|tmr|tmw|tom)$/i, (m, now) => ({ date: at(now, 1) })],
  [/\s+next\s+week$/i, (m, now) => ({ date: at(now, 7) })],
  [/\s+in\s+(\d{1,2})\s+days?$/i, (m, now) => ({ date: at(now, +m[1]) })],
  [new RegExp(`\\s+${DAY_RE}$`, 'i'), (m, now) => {
    const want = DAYS.indexOf(m[1].slice(0, 3).toLowerCase());
    return { date: at(now, (want - new Date(now).getDay() + 7) % 7) }; // same weekday = today
  }],
  // oct 23 / october 23rd / 23 oct
  [new RegExp(`\\s+${MON_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?$`, 'i'), (m, now) => ({ date: monthDay(now, m[1], +m[2]) }), (m) => +m[2] >= 1 && +m[2] <= 31],
  [new RegExp(`\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s+${MON_RE}$`, 'i'), (m, now) => ({ date: monthDay(now, m[2], +m[1]) }), (m) => +m[1] >= 1 && +m[1] <= 31],
];

// A month/day that's already more than a month gone means next year (e.g. "jan 10" typed in November).
function monthDay(now, mon, day) {
  const d = at(now, 0), m = MONTHS.indexOf(mon.slice(0, 3).toLowerCase());
  const c = new Date(d.getFullYear(), m, day);
  if (c < at(now, -30)) c.setFullYear(c.getFullYear() + 1);
  return c;
}

export function parseQuick(text, now = Date.now()) {
  let title = ' ' + text.trim(), date = null, time = null;
  for (let changed = true; changed;) {
    changed = false;
    for (const [re, get, ok = () => true] of RULES) {
      const m = title.match(re);
      if (!m || !ok(m)) continue;
      const r = get(m, now);
      if ((r.date && date) || (r.time && time)) continue;
      date ||= r.date || null;
      time ||= r.time || null;
      title = title.slice(0, m.index);
      changed = true;
      break;
    }
  }
  if (date || time) title = title.replace(/\s+(due|on|by|at|@|-|,)$/i, '');
  title = title.trim();
  // Never let the date eat the whole title ("Friday" alone is a task called Friday).
  if (!title) return { title: text.trim(), date: null, time: null };
  return { title, date, time };
}
