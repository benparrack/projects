// Pure schedule logic: which morning to plan, when to wake, and how the mornings went.
// All times are wall-clock "HH:MM" strings and dates "YYYY-MM-DD" in the configured zone.

export const parts = (d, tz) => Object.fromEntries(
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).map((p) => [p.type, p.value]));
export const localDate = (d, tz) => { const p = parts(d, tz); return `${p.year}-${p.month}-${p.day}`; };
export const localTime = (d, tz) => { const p = parts(d, tz); return `${p.hour}:${p.minute}`; };
export const toMin = (t) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
export const shift = (t, min) => { const m = (((toMin(t) + min) % 1440) + 1440) % 1440; return `${String(m / 60 | 0).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const utcNoon = (date) => Date.UTC(+date.slice(0, 4), date.slice(5, 7) - 1, +date.slice(8, 10), 12);
export const addDays = (date, n) => new Date(utcNoon(date) + n * 864e5).toISOString().slice(0, 10);
const dayDiff = (a, b) => Math.round((utcNoon(b) - utcNoon(a)) / 864e5);
const dow = (date) => new Date(utcNoon(date)).getUTCDay(); // 0 = Sunday
export const weekday = (date) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dow(date)];
export const isTime = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
export const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d);

// The morning to plan: tomorrow, or today while it's still night (before 05:00).
export function nextMorning(now, tz) {
  const p = parts(now, tz), today = `${p.year}-${p.month}-${p.day}`;
  return +p.hour < 5 ? today : addDays(today, 1);
}

const ymd = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
const DAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

// Does a repeating event (DAILY or WEEKLY RRULE, the shapes calendar apps use for classes) fall on `date`?
export function occursOn(start, rrule, date, skip = new Set()) {
  if (date < start || skip.has(date)) return false;
  const r = Object.fromEntries(rrule.split(';').map((kv) => kv.split('=')));
  const every = +(r.INTERVAL || 1);
  if (r.UNTIL && date > ymd(r.UNTIL)) return false;
  let hit;
  if (r.FREQ === 'DAILY') hit = (d) => dayDiff(start, d) % every === 0;
  else if (r.FREQ === 'WEEKLY') {
    const on = r.BYDAY ? r.BYDAY.split(',').map((d) => DAYS[d.slice(-2)]) : [dow(start)];
    const monday = (d) => addDays(d, -((dow(d) + 6) % 7));
    hit = (d) => on.includes(dow(d)) && (dayDiff(monday(start), monday(d)) / 7) % every === 0;
  } else return false; // shortcut: MONTHLY/YEARLY rules are ignored, classes don't use them
  if (!hit(date)) return false;
  if (!r.COUNT) return true;
  let n = 0; // COUNT counts occurrences from the start, skipped ones included
  for (let d = start; d <= date; d = addDays(d, 1)) if (hit(d)) n++;
  return n <= +r.COUNT;
}

// Timed classes on `date`, earliest first. Drops Canvas due dates, all-day and cancelled items.
export function classesOn(events, date, tz) {
  const moved = new Map(); // uid -> dates where a single occurrence was moved or edited
  for (const e of events) if (e.recurrenceId) (moved.get(e.uid) || moved.set(e.uid, new Set()).get(e.uid)).add(ymd(e.recurrenceId));
  return events
    .filter((e) => !e.allDay && e.status !== 'CANCELLED' && !/^event-assignment/.test(e.uid))
    .filter((e) => {
      const start = localDate(new Date(e.due), tz);
      if (!e.rrule || e.recurrenceId) return start === date;
      return occursOn(start, e.rrule, date, new Set([...(e.exdates || []).map(ymd), ...(moved.get(e.uid) || [])]));
    })
    .map((e) => ({ time: localTime(new Date(e.due), tz), summary: e.summary || 'Class', location: e.location || '' }))
    .sort((a, b) => a.time.localeCompare(b.time));
}

const series = (t, extra) => Array.from({ length: extra + 1 }, (_, i) => shift(t, i * 5));

// One morning's plan. `ovr` is the user's override for that date: {skip: true} or {time: 'HH:MM'}.
export function planDay(events, date, cfg, ovr) {
  const classes = classesOn(events, date, cfg.tz), first = classes[0] || null;
  const wake = ovr?.skip ? null : ovr?.time || (first && shift(first.time, -cfg.prep));
  return {
    date, day: weekday(date), first, classes, wake, override: ovr || null,
    alarms: wake ? series(wake, cfg.extra) : [],
    leave: first && shift(first.time, -cfg.commute),
    lightsOut: wake && shift(wake, -cfg.sleep * 60),
  };
}

export function note(plan) {
  if (plan.override?.skip) return `${plan.day}: you switched the alarm off. Sleep in.`;
  if (!plan.wake) return `No class ${plan.day} morning. No alarm, sleep in.`;
  const what = plan.first ? `${plan.first.summary} at ${plan.first.time}` : 'no class';
  return `${plan.day}: ${what}. Alarm ${plan.wake}${plan.override ? ' (your time)' : ''}. Lights out by ${plan.lightsOut}.`;
}

// log: {date: {alarms, up}}. A morning counts once its alarms were set; it's on time if you
// scanned the QR before the last backup alarm went off (plus 5 min to walk to it).
export function stats(log, today) {
  const days = Object.entries(log)
    .filter(([d, r]) => r.alarms?.length && (d < today || r.up))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, r]) => ({
      date,
      status: !r.up ? 'missed' : toMin(r.up) <= toMin(r.alarms.at(-1)) + 5 ? 'ontime' : 'late',
      upAfter: r.up ? toMin(r.up) - toMin(r.alarms[0]) : null,
    }));
  let streak = 0, best = 0, run = 0;
  for (const d of days) { run = d.status === 'ontime' ? run + 1 : 0; best = Math.max(best, run); }
  for (let i = days.length - 1; i >= 0 && days[i].status === 'ontime'; i--) streak++;
  const recent = days.slice(-30), ups = recent.filter((d) => d.upAfter != null).map((d) => Math.max(0, d.upAfter));
  return {
    days, streak, best,
    rate: recent.length ? recent.filter((d) => d.status === 'ontime').length / recent.length : null,
    avgUp: ups.length ? Math.round(ups.reduce((a, b) => a + b, 0) / ups.length) : null,
  };
}
