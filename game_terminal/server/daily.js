// Daily challenge: one shared board per game per UTC day; each account gets one scored attempt.
//   daily/{date}_{game}_{uid}  { date, gameType, uid, username, startedAt, done, score }
//   users/{uid}                dailyToday { date, games: {game: score | 'started' | null} },
//                              dailyLast (date of the last finished run), dailyStreak, dailyBest
// The attempt is claimed when the run starts (db.create, atomic), so leaving mid-run and
// rejoining can't reroll or preview the board.
'use strict';

const crypto = require('crypto');

// start = the plugin action that begins a run; better = which way the score sorts.
const DAILY_GAMES = {
  mazedash: { start: 'startRace', better: 'low', label: 'Maze Dash' },
  wordhunt: { start: 'start', better: 'high', label: 'Word Hunt' },
  crossword: { start: 'start', better: 'low', label: 'Crossword' },
  anagrams: { start: 'start', better: 'high', label: 'Anagrams' },
  wordle: { start: 'start', better: 'low', label: 'Wordle' },
};
const DAY = 86400000;
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const prevDay = (date) => dayOf(Date.parse(`${date}T00:00:00Z`) - DAY);
const seedOf = (date, game) => crypto.createHash('sha256').update(`${date}:${game}`).digest().readUInt32LE(0);

// Deterministic PRNG (mulberry32) for plugins that take a rand() function.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// In-place Fisher-Yates; pass a mulberry32 rand to make it repeatable.
function shuffle(arr, rand = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function createDaily(db, { now = () => Date.now() } = {}) {
  const path = (date, game, uid) => `daily/${date}_${game}_${uid}`;
  const today = () => dayOf(now());

  async function attempted(uid, game) { return !!(await db.get(path(today(), game, uid))); }

  // Claims today's attempt. False if this account already used it.
  async function start(uid, username, game, date = today()) {
    const ok = await db.create(path(date, game, uid), { date, gameType: game, uid, username, startedAt: now(), done: false, score: null });
    if (ok) await markToday(uid, date, game, 'started');
    return ok;
  }

  async function markToday(uid, date, game, value) {
    const user = await db.get(`users/${uid}`);
    if (!user) return null;
    const cur = user.dailyToday && user.dailyToday.date === date ? user.dailyToday.games : {};
    await db.merge(`users/${uid}`, { dailyToday: { date, games: { ...cur, [game]: value } } });
    return user;
  }

  // Scores the claimed attempt once (score null = did not finish) and moves the streak.
  async function finish(uid, game, date, score) {
    const p = path(date, game, uid);
    const doc = await db.get(p);
    if (!doc || doc.done) return null;
    await db.merge(p, { done: true, score: score ?? null, finishedAt: now() });
    const user = await markToday(uid, date, game, score ?? null);
    if (!user) return null;
    const streak = user.dailyLast === date ? user.dailyStreak || 1 : user.dailyLast === prevDay(date) ? (user.dailyStreak || 0) + 1 : 1;
    await db.merge(`users/${uid}`, { dailyLast: date, dailyStreak: streak, dailyBest: Math.max(user.dailyBest || 0, streak) });
    const rows = await board(game, date);
    const mine = rows.find((r) => r.uid === uid);
    return { score: score ?? null, streak, rank: mine ? mine.rank : null, of: rows.length };
  }

  // Finished runs with a score, best first, ranked (ties share a rank).
  // shortcut: reads the whole day's docs per call; fine for hundreds of players a day, cache it beyond that.
  async function board(game, date = today()) {
    const better = DAILY_GAMES[game].better;
    const rows = (await db.list('daily', { where: [['date', '==', date]] }))
      .filter((d) => d.gameType === game && d.done && typeof d.score === 'number')
      .sort((a, b) => (better === 'low' ? a.score - b.score : b.score - a.score) || a.finishedAt - b.finishedAt);
    let rank = 0;
    return rows.map((r, i) => ({ ...r, rank: i && rows[i - 1].score === r.score ? rank : (rank = i + 1) }));
  }

  // A streak only survives if yesterday (or today) was played.
  const liveStreak = (user) => (user && (user.dailyLast === today() || user.dailyLast === prevDay(today())) ? user.dailyStreak || 0 : 0);

  return { today, attempted, start, finish, board, liveStreak };
}

module.exports = { createDaily, DAILY_GAMES, dayOf, seedOf, mulberry32, shuffle };
