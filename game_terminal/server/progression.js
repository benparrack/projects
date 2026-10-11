// Phase 6 progression, pure (no db): XP per finished match, the level curve, and the
// achievement catalog. results.js calls these after it has updated the stats docs:
//   const xp = grantXp(matchXp(summary, me), earnedToday)        -> add to users/{uid}.xp
//   const unlocked = newAchievements({ summary, me, stat, allStats, have, extra })
//                                                                -> set users/{uid}.achievements[id] = ts
// me = { place, won, draw } (the users/{uid}/matches `me` field); stat = this game's stats doc
// AFTER the update; allStats = all of the user's stats docs (with stat in it); have = the user's
// achievements map; extra = optional { vsFriend, rating, ranked, dailyStreak, level }.
'use strict';

const DAILY_CAP = 500;
const BOT_WIN_XP = { easy: 5, medium: 10, hard: 15, expert: 25 };

function matchXp(summary, me) {
  if (summary.kind === 'solo') return summary.daily ? 40 : 10; // the daily run is worth showing up for
  if (summary.kind === 'bot') return me.won ? (BOT_WIN_XP[summary.botLevel] || 5) : 3;
  return (me.won ? 50 : me.draw ? 30 : 20) + (summary.ranked ? 10 : 0);
}
const grantXp = (raw, earnedToday = 0) => Math.max(0, Math.min(raw, DAILY_CAP - earnedToday));

// Level L -> L+1 costs 100 + 25*(L-1) XP (level 10 ≈ 1,800 XP total, level 50 ≈ 35,600).
const xpToNext = (level) => 100 + 25 * (level - 1);
function levelFor(xp = 0) {
  let level = 1;
  let left = xp;
  while (left >= xpToNext(level)) left -= xpToNext(level++);
  return { level, into: left, need: xpToNext(level) };
}

function totals(allStats) {
  const t = { played: 0, wins: 0, bestStreak: 0, games: 0, wonGames: 0, soloPlayed: 0, botWins: {} };
  for (const s of allStats) {
    t.played += s.played || 0;
    t.wins += s.wins || 0;
    t.bestStreak = Math.max(t.bestStreak, s.bestStreak || 0);
    t.soloPlayed += s.soloPlayed || 0;
    if ((s.played || 0) + (s.botPlayed || 0) + (s.soloPlayed || 0) > 0) t.games++;
    if (s.wins) t.wonGames++;
    for (const lv of Object.keys(BOT_WIN_XP)) t.botWins[lv] = (t.botWins[lv] || 0) + (s[`botWins_${lv}`] || 0);
  }
  return t;
}

// [id, name, description, test(c)] where c = { t (totals), stat, summary, me, x (extra) }.
const pvpWin = (c) => c.summary.kind === 'pvp' && c.me.won;
const gameWins = (game, n, name, label) => [`${game}_wins_${n}`, name, `Win ${n} ${label} game${n > 1 ? 's' : ''} against people`, (c) => c.summary.gameType === game && c.stat.wins >= n];
const ACHIEVEMENTS = [
  ['first_game', 'Insert Coin', 'Finish your first game', () => true],
  ['first_win', 'Winner Winner', 'Win a game against another person', (c) => c.t.wins >= 1],
  ['wins_10', 'Contender', 'Win 10 games against people', (c) => c.t.wins >= 10],
  ['wins_50', 'Veteran', 'Win 50 games against people', (c) => c.t.wins >= 50],
  ['wins_100', 'Champion', 'Win 100 games against people', (c) => c.t.wins >= 100],
  ['wins_500', 'Legend', 'Win 500 games against people', (c) => c.t.wins >= 500],
  ['played_100', 'Regular', 'Play 100 games against people', (c) => c.t.played >= 100],
  ['played_500', 'No Life', 'Play 500 games against people', (c) => c.t.played >= 500],
  ['streak_3', 'Heating Up', 'Win 3 in a row in one game', (c) => c.t.bestStreak >= 3],
  ['streak_5', 'On Fire', 'Win 5 in a row in one game', (c) => c.t.bestStreak >= 5],
  ['streak_10', 'Unstoppable', 'Win 10 in a row in one game', (c) => c.t.bestStreak >= 10],
  ['variety_5', 'Sampler', 'Play 5 different games', (c) => c.t.games >= 5],
  ['variety_20', 'Explorer', 'Play 20 different games', (c) => c.t.games >= 20],
  ['variety_40', 'Completionist', 'Play 40 different games', (c) => c.t.games >= 40],
  ['all_rounder', 'All-Rounder', 'Win against people in 10 different games', (c) => c.t.wonGames >= 10],
  ['solo_25', 'Lone Wolf', 'Finish 25 solo runs', (c) => c.t.soloPlayed >= 25],
  ['bot_easy', 'Training Wheels', 'Beat an Easy bot', (c) => c.t.botWins.easy >= 1],
  ['bot_medium', 'Getting There', 'Beat a Medium bot', (c) => c.t.botWins.medium >= 1],
  ['bot_hard', 'Machine Breaker', 'Beat a Hard bot', (c) => c.t.botWins.hard >= 1],
  ['bot_expert', 'Expert Bot Slayer', 'Beat an Expert bot', (c) => c.t.botWins.expert >= 1],
  ['bot_expert_25', 'Skynet\'s Nightmare', 'Beat Expert bots 25 times', (c) => c.t.botWins.expert >= 25],
  ['full_house', 'Full House', 'Win a game with 4 or more people', (c) => pvpWin(c) && c.summary.players.filter((p) => !p.bot).length >= 4],
  ['beat_friend', 'Bragging Rights', 'Beat a friend', (c) => pvpWin(c) && !!c.x.vsFriend],
  ['ranked_first', 'Ranked Up', 'Finish a ranked game', (c) => c.summary.ranked],
  ['rating_1100', 'Gold Standard', 'Reach Gold (1100 rating) in any game', (c) => (c.x.rating || 0) >= 1100],
  ['rating_1400', 'Diamond Hands', 'Reach Diamond (1400 rating) in any game', (c) => (c.x.rating || 0) >= 1400],
  ['rating_1600', 'Grandmaster', 'Reach Master (1600 rating) in any game', (c) => (c.x.rating || 0) >= 1600],
  ['level_5', 'Level 5', 'Reach level 5', (c) => (c.x.level || 0) >= 5],
  ['level_10', 'Level 10', 'Reach level 10', (c) => (c.x.level || 0) >= 10],
  ['level_25', 'Level 25', 'Reach level 25', (c) => (c.x.level || 0) >= 25],
  ['level_50', 'Level 50', 'Reach level 50', (c) => (c.x.level || 0) >= 50],
  ['daily_first', 'Daily Grind', 'Finish a daily challenge', (c) => (c.x.dailyStreak || 0) >= 1],
  ['daily_7', 'Week Streak', 'Do the daily challenge 7 days in a row', (c) => (c.x.dailyStreak || 0) >= 7],
  ['daily_30', 'Month Streak', 'Do the daily challenge 30 days in a row', (c) => (c.x.dailyStreak || 0) >= 30],
  gameWins('chess', 10, 'Checkmate Artist', 'Chess'),
  gameWins('poker', 10, 'Card Shark', 'Poker'),
  gameWins('slither', 10, 'Top Snake', 'Slither'),
  gameWins('tron', 10, 'Light Cycle Ace', 'TRON'),
  gameWins('connect4', 10, 'Four Sight', 'Four in a Row'),
  gameWins('scrabble', 10, 'Wordsmith', 'Scrabble'),
  gameWins('pool', 10, 'Pool Shark', 'Pool'),
  gameWins('minesweeper', 10, 'Sweeper', 'Minesweeper'),
].map(([id, name, desc, test]) => ({ id, name, desc, test }));

// Ids unlocked by this match that the user doesn't have yet.
function newAchievements({ summary, me, stat, allStats, have = {}, extra = {} }) {
  const c = { t: totals(allStats), stat, summary, me, x: extra };
  return ACHIEVEMENTS.filter((a) => !have[a.id] && a.test(c)).map((a) => a.id);
}

// Client-safe catalog (no functions), for the profile grid and unlock toasts.
const ACHIEVEMENT_LIST = ACHIEVEMENTS.map(({ id, name, desc }) => ({ id, name, desc }));

// Cosmetics: [slot, id, name, unlock] where unlock is a level number or an achievement id.
// The client styles them by class (.nc-<id> name colors, .af-<id> avatar frames).
const COSMETICS = [
  ['nameColor', 'amber', 'Amber', 3],
  ['nameColor', 'cyan', 'Cyan', 5],
  ['nameColor', 'magenta', 'Magenta', 10],
  ['nameColor', 'ice', 'Ice', 'rating_1400'],
  ['nameColor', 'gold', 'Gold', 'wins_50'],
  ['nameColor', 'rainbow', 'Rainbow', 25],
  ['frame', 'neon', 'Neon', 2],
  ['frame', 'amber', 'Amber', 8],
  ['frame', 'pulse', 'Pulse', 'streak_5'],
  ['frame', 'circuit', 'Circuit', 'bot_expert'],
  ['frame', 'daily', 'Calendar', 'daily_7'],
  ['frame', 'gold', 'Gold', 'wins_100'],
  ['frame', 'diamond', 'Diamond', 'rating_1400'],
].map(([slot, id, name, unlock]) => {
  const ach = typeof unlock === 'string' && ACHIEVEMENT_LIST.find((a) => a.id === unlock);
  return { slot, id, name, unlock, how: ach ? `Unlock "${ach.name}"` : `Reach level ${unlock}` };
});
const hasCosmetic = (c, user) => (typeof c.unlock === 'number' ? (user.level || 1) >= c.unlock : !!(user.achievements || {})[c.unlock]);
// The catalog as one user sees it (with an `unlocked` flag).
const cosmeticsFor = (user) => COSMETICS.map(({ unlock, ...c }) => ({ ...c, unlocked: hasCosmetic({ unlock }, user) }));

module.exports = { DAILY_CAP, matchXp, grantXp, xpToNext, levelFor, newAchievements, ACHIEVEMENT_LIST, COSMETICS, hasCosmetic, cosmeticsFor };
