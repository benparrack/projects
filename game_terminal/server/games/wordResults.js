// End-of-match reporting shared by the word-game plugins: turns ranked players into the
// server/report.js shape. Bots (any 'bot-...' id) collapse to 'BOT'; equal ranks share a place.

'use strict';

const { report } = require('../report');
const { LEVELS, normLevel } = require('./ai/levels');
const { isBotId } = require('./tickBots');

// entries: [{ id, rank, score?, level? }] — higher rank = better place. `score` (humans only) goes
// into result.scores when it's a number; `level` is a bot's difficulty.
function reportRanked(room, entries) {
  const sorted = entries.slice().sort((a, b) => b.rank - a.rank);
  const placements = [];
  let prev;
  for (const e of sorted) {
    const id = isBotId(e.id) ? 'BOT' : e.id;
    if (placements.length && e.rank === prev) placements[placements.length - 1].push(id);
    else placements.push([id]);
    prev = e.rank;
  }
  const result = { placements };
  const scores = {};
  for (const e of entries) if (!isBotId(e.id) && typeof e.score === 'number') scores[e.id] = e.score;
  if (Object.keys(scores).length) result.scores = scores;
  // Several bots at different levels: report the strongest.
  const lv = entries.filter((e) => isBotId(e.id)).map((e) => LEVELS.indexOf(normLevel(e.level)));
  if (lv.length) result.botLevel = LEVELS[Math.max(...lv)];
  report(room, result);
}

module.exports = { reportRanked };
