// Cloudflare Worker: works out the next morning's alarm from a class-schedule iCal feed.
// GET /alarms -> "07:45\n07:50\n07:55" (empty when there's no class), for the iOS Shortcut.
// GET /note   -> one-line bedtime note. Everything else is public/ (sunrise page, QR page).
import { parseICS } from './ics.js';

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname !== '/alarms' && url.pathname !== '/note') return env.ASSETS.fetch(req);
    const cfg = { prep: +(env.PREP_MIN || 75), extra: +(env.BACKUP_ALARMS ?? 2), tz: env.TZ || 'Europe/Stockholm' };
    let plan;
    try {
      const res = await fetch(env.FEED_URL.replace(/^webcal:/i, 'https:'));
      if (!res.ok) throw new Error(`feed answered ${res.status}`);
      plan = planFor(parseICS(await res.text()).events, new Date(), cfg);
    } catch (e) {
      // Never answer with nothing: an empty reply means "no alarm", which is how you miss class.
      const t = env.FALLBACK || '07:30';
      plan = { alarms: series(t, cfg.extra), note: `Couldn't read your schedule (${e.message}). Alarm set to the fallback ${t}.` };
    }
    const body = url.pathname === '/alarms' ? plan.alarms.join('\n') : plan.note;
    return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  },
};

const parts = (d, tz) => Object.fromEntries(
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'long' })
    .formatToParts(d).map((p) => [p.type, p.value]));
const hm = (p) => `${p.hour}:${p.minute}`;
const shift = (t, min) => { const m = (((+t.slice(0, 2) * 60 + +t.slice(3) + min) % 1440) + 1440) % 1440; return `${String(m / 60 | 0).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const series = (t, extra) => Array.from({ length: extra + 1 }, (_, i) => shift(t, i * 5));

// The morning we're planning: tomorrow, unless it's already past midnight (before 05:00), then today.
export function planFor(events, now, { prep, extra, tz }) {
  const p = parts(now, tz);
  const t = new Date(Date.UTC(+p.year, p.month - 1, +p.day + (+p.hour < 5 ? 0 : 1), 12));
  const target = t.toISOString().slice(0, 10);
  const day = t.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  const first = events
    .filter((e) => !e.allDay && !/^event-assignment/.test(e.uid)) // Canvas due dates aren't classes
    .map((e) => ({ e, p: parts(new Date(e.due), tz) }))
    .filter(({ p }) => `${p.year}-${p.month}-${p.day}` === target)
    .sort((a, b) => a.e.due.localeCompare(b.e.due))[0];
  if (!first) return { alarms: [], note: `No class ${day} morning. No alarm, sleep in.` };
  const wake = shift(hm(first.p), -prep);
  return {
    alarms: series(wake, extra),
    note: `${day}: ${first.e.summary || 'class'} at ${hm(first.p)}. Alarm ${wake}. Lights out by ${shift(wake, -8 * 60)}.`,
  };
}
