// Cloudflare Worker. Plain-text endpoints for the iOS Shortcut, JSON for the app, public/ for the pages.
// Every endpoint needs ?k=<KEY>. KV (binding RISE) keeps: feed (last good calendar), log, ovr.
//   GET  /alarms        "08:00\n08:05..." for the coming morning (empty = no alarm). Never fails empty
//                       on a bad feed: falls back to the last good calendar, then to FALLBACK.
//   GET  /note          one-line bedtime note
//   GET  /api/home      everything the app shows
//   POST /api/up        "I'm up" check-in for today
//   POST /api/override  {date, skip} | {date, time} | {date} (clear)
import { parseICS } from './ics.js';
import { planDay, note, nextMorning, localDate, localTime, addDays, stats, isDate, isTime } from './plan.js';

const cfgOf = (env) => ({
  prep: +(env.PREP_MIN || 75), extra: +(env.BACKUP_ALARMS ?? 4), commute: +(env.COMMUTE_MIN || 30),
  sleep: +(env.SLEEP_HOURS || 8), tz: env.TZ || 'Europe/Stockholm', fallback: env.FALLBACK || '07:30',
  lat: +(env.LAT || 59.33), lon: +(env.LON || 18.07),
});
const text = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const getJSON = async (env, key) => JSON.parse((await env.RISE.get(key)) || '{}');

export default {
  async fetch(req, env) {
    const url = new URL(req.url), path = url.pathname;
    if (path !== '/alarms' && path !== '/note' && !path.startsWith('/api/')) return env.ASSETS.fetch(req);
    if (!env.KEY || url.searchParams.get('k') !== env.KEY) return text('Wrong or missing key.', 401);
    const cfg = cfgOf(env), now = new Date();
    if (path === '/alarms') return alarms(env, cfg, now);
    try {
      if (path === '/note') { const { events, stale } = await loadEvents(env); return text(note(await plan(env, events, nextMorning(now, cfg.tz), cfg)) + (stale ? ` (Using your last saved schedule: ${stale})` : '')); }
      if (path === '/api/home') return json(await home(env, cfg, now));
      if (req.method !== 'POST') return text('Not found', 404);
      if (path === '/api/up') {
        const log = await getJSON(env, 'log'), today = localDate(now, cfg.tz);
        log[today] = { ...log[today], up: log[today]?.up || localTime(now, cfg.tz) }; // first scan counts
        await env.RISE.put('log', JSON.stringify(log));
        return json(await home(env, cfg, now));
      }
      if (path === '/api/override') {
        const b = await req.json().catch(() => ({}));
        if (!isDate(b.date) || (b.time != null && !isTime(b.time))) return text('Bad date or time.', 400);
        const ovr = await getJSON(env, 'ovr');
        if (b.skip) ovr[b.date] = { skip: true }; else if (b.time) ovr[b.date] = { time: b.time }; else delete ovr[b.date];
        await env.RISE.put('ovr', JSON.stringify(ovr));
        return json(await home(env, cfg, now));
      }
      return text('Not found', 404);
    } catch (e) {
      return text(e.message, 500);
    }
  },
};

export async function loadEvents(env) {
  const urls = (env.FEED_URL || '').split(/\s+/).filter(Boolean);
  try {
    if (!urls.length) throw new Error('FEED_URL is not set');
    const texts = await Promise.all(urls.map(async (u) => {
      const res = await fetch(u.replace(/^webcal:/i, 'https:'), { headers: { 'user-agent': 'Rise alarm' } });
      if (!res.ok) throw new Error(`calendar answered ${res.status}`);
      const body = await res.text();
      if (!body.trimStart().startsWith('BEGIN:VCALENDAR')) throw new Error("calendar link didn't return a calendar");
      return body;
    }));
    const feed = texts.join('\n');
    if ((await env.RISE.get('feed')) !== feed) await env.RISE.put('feed', feed); // only write on change: KV free tier is 1000 writes/day
    return { events: parseICS(feed).events, stale: null };
  } catch (e) {
    const saved = await env.RISE.get('feed');
    if (saved) return { events: parseICS(saved).events, stale: e.message };
    throw e;
  }
}

async function plan(env, events, date, cfg) {
  return planDay(events, date, cfg, (await getJSON(env, 'ovr'))[date]);
}

async function alarms(env, cfg, now) {
  const date = nextMorning(now, cfg.tz);
  let list;
  try { list = (await plan(env, (await loadEvents(env)).events, date, cfg)).alarms; }
  catch {
    const o = (await getJSON(env, 'ovr').catch(() => ({})))[date];
    list = o?.skip ? [] : planDay([], date, cfg, { time: o?.time || cfg.fallback }).alarms;
  }
  try { // remember what the phone was told, so the app can confirm it and score the morning
    const log = await getJSON(env, 'log');
    log[date] = { ...log[date], alarms: list, fetched: `${localDate(now, cfg.tz)} ${localTime(now, cfg.tz)}` };
    await env.RISE.put('log', JSON.stringify(log));
  } catch {}
  return text(list.join('\n'));
}

async function home(env, cfg, now) {
  const today = localDate(now, cfg.tz), next = nextMorning(now, cfg.tz);
  const [{ events, stale }, ovr, log] = await Promise.all([loadEvents(env), getJSON(env, 'ovr'), getJSON(env, 'log')]);
  const week = Array.from({ length: 8 }, (_, i) => planDay(events, addDays(today, i), cfg, ovr[addDays(today, i)]));
  return {
    now: { date: today, time: localTime(now, cfg.tz) }, next, stale,
    repeating: events.some((e) => e.rrule && !/FREQ=(DAILY|WEEKLY)/.test(e.rrule)),
    week, log: Object.fromEntries(Object.entries(log).filter(([d]) => d >= addDays(today, -42))),
    stats: stats(log, today),
    cfg: { prep: cfg.prep, extra: cfg.extra, commute: cfg.commute, sleep: cfg.sleep, lat: cfg.lat, lon: cfg.lon },
  };
}
