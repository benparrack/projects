// Phase 6 progression: XP, daily cap, level curve, achievements.
// Run: node test/progression.test.js
'use strict';

const assert = require('assert');
const { matchXp, grantXp, levelFor, newAchievements, ACHIEVEMENT_LIST, DAILY_CAP } = require('../server/progression');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const pvp = (gameType = 'chess', humans = 2, extra = {}) => ({ kind: 'pvp', gameType, ranked: false, players: Array.from({ length: humans }, () => ({ bot: false })), ...extra });
const WIN = { place: 0, won: true, draw: false };
const LOSS = { place: 1, won: false, draw: false };

test('match XP by kind, result, bot level and ranked', () => {
  assert.strictEqual(matchXp(pvp(), WIN), 50);
  assert.strictEqual(matchXp(pvp(), LOSS), 20);
  assert.strictEqual(matchXp(pvp(), { place: 0, won: false, draw: true }), 30);
  assert.strictEqual(matchXp(pvp('chess', 2, { ranked: true }), WIN), 60);
  assert.strictEqual(matchXp({ kind: 'bot', botLevel: 'expert' }, WIN), 25);
  assert.strictEqual(matchXp({ kind: 'bot', botLevel: 'expert' }, LOSS), 3);
  assert.strictEqual(matchXp({ kind: 'solo' }, WIN), 10);
});

test('daily cap', () => {
  assert.strictEqual(grantXp(50, 0), 50);
  assert.strictEqual(grantXp(50, DAILY_CAP - 20), 20);
  assert.strictEqual(grantXp(50, DAILY_CAP + 5), 0);
});

test('level curve', () => {
  assert.deepStrictEqual(levelFor(0), { level: 1, into: 0, need: 100 });
  assert.deepStrictEqual(levelFor(99), { level: 1, into: 99, need: 100 });
  assert.deepStrictEqual(levelFor(100), { level: 2, into: 0, need: 125 });
  assert.strictEqual(levelFor(225).level, 3);
});

test('first pvp win unlocks the starters once', () => {
  const stat = { gameType: 'chess', played: 1, wins: 1, bestStreak: 1 };
  const got = newAchievements({ summary: pvp(), me: WIN, stat, allStats: [stat] });
  assert.deepStrictEqual(got, ['first_game', 'first_win']);
  const again = newAchievements({ summary: pvp(), me: WIN, stat, allStats: [stat], have: { first_game: 1, first_win: 1 } });
  assert.deepStrictEqual(again, []);
});

test('cross-game totals, bot levels, per-game milestones, extras', () => {
  const allStats = Array.from({ length: 10 }, (_, i) => ({ gameType: `g${i}`, played: 3, wins: 1, bestStreak: 3 }));
  const chess = { gameType: 'chess', played: 12, wins: 10, bestStreak: 5, botPlayed: 1, botWins_expert: 1 };
  allStats.push(chess);
  const got = newAchievements({ summary: pvp('chess', 4), me: WIN, stat: chess, allStats, extra: { vsFriend: true, rating: 1150, level: 5 } });
  for (const id of ['wins_10', 'streak_5', 'variety_5', 'all_rounder', 'bot_expert', 'chess_wins_10', 'full_house', 'beat_friend', 'rating_1100', 'level_5']) {
    assert.ok(got.includes(id), `expected ${id} in ${got}`);
  }
  for (const id of ['wins_50', 'variety_20', 'bot_easy', 'rating_1400', 'poker_wins_10']) assert.ok(!got.includes(id), id);
});

test('losing to a friend is not bragging rights', () => {
  const stat = { gameType: 'chess', played: 1, wins: 0 };
  assert.ok(!newAchievements({ summary: pvp(), me: LOSS, stat, allStats: [stat], extra: { vsFriend: true } }).includes('beat_friend'));
});

test('catalog: ~40 unique ids, client-safe', () => {
  const ids = ACHIEVEMENT_LIST.map((a) => a.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  assert.ok(ids.length >= 40);
  assert.doesNotThrow(() => JSON.stringify(ACHIEVEMENT_LIST));
  assert.ok(ACHIEVEMENT_LIST.every((a) => a.name && a.desc && !('test' in a)));
});

(async () => {
  let failures = 0;
  for (const { name, fn } of tests) {
    try { await fn(); console.log(`ok - ${name}`); } catch (err) { failures++; console.log(`FAIL - ${name}\n  ${err.stack}`); }
  }
  if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
  console.log(`\nall ${tests.length} passed`);
})();
