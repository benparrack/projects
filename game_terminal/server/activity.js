// Home-screen activity: each account's notable moments (activity/{uid}, last 20) for the friends
// feed, and per-UTC-day play counters (meta/plays_{date}) for the live stats strip.
const { dayOf } = require('./daily');

const KEEP = 20;
const DAY = 86400000;

// Notable things one recorded result did for one account (pure; index.js passes rec pieces).
function itemsFor(summary, uid, { progress, daily, rating } = {}) {
  const at = summary.endedAt;
  const g = summary.gameType;
  const me = summary.players.find((p) => p.uid === uid);
  const items = [];
  if (rating && me && me.place === 0 && summary.kind === 'pvp') items.push({ at, kind: 'ranked', gameType: g, rating: rating.rating });
  if (daily && daily.rank && daily.rank <= 3) items.push({ at, kind: 'daily', gameType: g, rank: daily.rank, of: daily.of });
  if (daily && (daily.streak === 3 || (daily.streak && daily.streak % 7 === 0))) items.push({ at, kind: 'streak', days: daily.streak });
  if (progress && progress.levelUp) items.push({ at, kind: 'level', level: progress.level });
  for (const b of (progress && progress.badges) || []) items.push({ at, kind: 'achievement', id: b.id, name: b.name });
  return items;
}

function createActivity(db, { now = () => Date.now() } = {}) {
  // shortcut: counters live in this process and are written through; fine for one Render instance, move to db increments if it ever scales out.
  const plays = new Map(); // date -> Promise<{ total, games: { gameType: n } }> (a promise, so concurrent first reads share one load)
  function day(date) {
    if (!plays.has(date)) plays.set(date, db.get(`meta/plays_${date}`).then((d) => d || { total: 0, games: {} }));
    return plays.get(date);
  }

  async function counted(gameType) {
    const date = dayOf(now());
    const d = await day(date);
    d.total += 1;
    d.games[gameType] = (d.games[gameType] || 0) + 1;
    await db.set(`meta/plays_${date}`, d);
  }

  async function log(uid, items) {
    const doc = (await db.get(`activity/${uid}`)) || { items: [] };
    // Two daily games on one day both report the streak; keep the first.
    items = items.filter((it) => !(it.kind === 'streak' && doc.items.some((o) => o.kind === 'streak' && o.days === it.days)));
    if (!items.length) return;
    await db.set(`activity/${uid}`, { items: [...items.reverse(), ...doc.items].slice(0, KEEP) });
  }

  // Newest-first moments for these uids, `limit` total, each tagged with its uid.
  async function feed(uids, limit = 12) {
    const docs = await Promise.all(uids.map((u) => db.get(`activity/${u}`)));
    return docs.flatMap((d, i) => (d ? d.items.map((it) => ({ ...it, uid: uids[i] })) : []))
      .sort((a, b) => b.at - a.at).slice(0, limit);
  }

  // Games finished today, and the most-played game over the last 7 UTC days.
  async function stats() {
    const t = now();
    const days = await Promise.all(Array.from({ length: 7 }, (_, i) => day(dayOf(t - i * DAY))));
    const week = {};
    for (const d of days) for (const [g, n] of Object.entries(d.games)) week[g] = (week[g] || 0) + n;
    const [top] = Object.entries(week).sort((a, b) => b[1] - a[1]);
    for (const date of [...plays.keys()]) if (date < dayOf(t - 8 * DAY)) plays.delete(date);
    return { today: days[0].total, topWeek: top ? { gameType: top[0], plays: top[1] } : null };
  }

  return { counted, log, feed, stats };
}

module.exports = { createActivity, itemsFor };
