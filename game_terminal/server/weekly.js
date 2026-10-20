// Game of the week: one featured game per UTC week (Monday 00:00 to Monday 00:00). Its finished
// matches earn double XP (results.js) and points on its own weekly table, weekly/{week}_{uid}:
// win 3 / draw 1 against people, 1 for beating a bot, 0 for a loss or a solo run.
'use strict';

const DAY = 864e5;
const WEEK = 7 * DAY;
const BOARD_SIZE = 10;
const BOARD_TTL_MS = 60 * 1000;
// Fixed order so adding games to the site never reshuffles the rotation mid-week.
const POOL = ['chess', 'connect4', 'tron', 'checkers', 'slither', 'reversi', 'pool', 'crazyeights', 'minigolf', 'backgammon',
  'dotsboxes', 'tanks', 'gomoku', 'hearts', 'seabattle', 'blockade', 'mancala', 'spades', 'minesweeper', 'scrabble'];

function weekOf(ts) {
  const n = Math.floor((ts / DAY + 3) / 7); // weeks since Mon 1969-12-29 (1970-01-01 was a Thursday)
  const start = n * WEEK - 3 * DAY;
  return { id: new Date(start).toISOString().slice(0, 10), start, endsAt: start + WEEK, gameType: POOL[n % POOL.length] };
}

function pointsFor(summary, me) {
  if (summary.kind === 'pvp') return me.won ? 3 : me.draw ? 1 : 0;
  if (summary.kind === 'bot') return me.won ? 1 : 0;
  return 0;
}

function createWeekly(db, { now = () => Date.now() } = {}) {
  let cache = null; // { id, at, rows, total }

  // Called from results.js inside its per-user queue, so read-modify-write is safe per player.
  async function add(week, uid, username, summary, me) {
    if (summary.kind === 'solo') return;
    const path = `weekly/${week.id}_${uid}`;
    const doc = (await db.get(path)) || { week: week.id, gameType: week.gameType, uid, points: 0, wins: 0, played: 0 };
    doc.username = username;
    doc.points += pointsFor(summary, me);
    doc.wins += me.won ? 1 : 0;
    doc.played += 1;
    await db.set(path, doc);
    cache = null;
  }

  async function board(week) {
    if (cache && cache.id === week.id && now() - cache.at < BOARD_TTL_MS) return cache;
    const all = await db.list('weekly', { where: [['week', '==', week.id]] });
    all.sort((a, b) => b.points - a.points || b.wins - a.wins || a.played - b.played);
    cache = { id: week.id, at: now(), total: all.length, rows: all.slice(0, BOARD_SIZE) };
    return cache;
  }

  return { current: () => weekOf(now()), add, board };
}

module.exports = { createWeekly, weekOf, pointsFor, POOL };
