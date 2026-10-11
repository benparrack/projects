// Phase 5 rating math, pure (no db). results.js calls rate() for ranked human-only matches and
// stores the new rating/games on the stats doc (and its season copy).
//   rate([{ uid, rating, games, place }]) -> { [uid]: { rating, delta } }
// Multi-player games use pairwise Elo from placements: each pair is a mini 1v1 (lower place
// wins, equal place draws), averaged over the n-1 opponents so a 6-player win moves rating
// about as much as a 1v1 win.
'use strict';

const START = 1000;
const kFactor = (games) => (games < 20 ? 32 : 16);
const expected = (a, b) => 1 / (1 + 10 ** ((b - a) / 400));

function rate(players) {
  const out = {};
  const n = players.length;
  for (const p of players) {
    const mine = p.rating ?? START;
    let sum = 0;
    for (const q of players) {
      if (q === p) continue;
      const actual = p.place < q.place ? 1 : p.place === q.place ? 0.5 : 0;
      sum += actual - expected(mine, q.rating ?? START);
    }
    const delta = n > 1 ? Math.round((kFactor(p.games || 0) * sum) / (n - 1)) : 0;
    out[p.uid] = { rating: mine + delta, delta };
  }
  return out;
}

// The results.js-facing wrapper. oldStats: { uid: stats/{gameType}_{uid} doc or null },
// placements: report() groups of clientIds (best first, 'BOT' entries allowed),
// uids: { clientId: uid } (guests absent). Returns { uid: { rating, delta, ratedGames } } to merge
// into each stats doc, or {} when nothing is rated (<2 accounts, or a co-op game's shared group).
// A single group is a draw (chess stalemate) unless opts.coop says it's one team.
function rateMatch(oldStats, placements, uids, opts = {}) {
  if (opts.coop && placements.length < 2) return {};
  const players = [];
  placements.forEach((group, place) => {
    for (const id of group) {
      const uid = id !== 'BOT' && uids[id];
      if (!uid) continue;
      const s = oldStats[uid] || {};
      players.push({ uid, rating: s.rating, games: s.ratedGames || 0, place });
    }
  });
  if (players.length < 2) return {};
  const out = rate(players);
  for (const p of players) out[p.uid].ratedGames = p.games + 1;
  return out;
}

// [name, minimum rating], best last.
const TIERS = [['Bronze', -Infinity], ['Silver', 950], ['Gold', 1100], ['Platinum', 1250], ['Diamond', 1400], ['Master', 1600]];
const tierOf = (rating) => TIERS.reduce((t, [name, min]) => (rating >= min ? name : t), 'Bronze');

// Seasons are calendar quarters in UTC; S1 = 2026 Q4.
function seasonOf(ms = Date.now()) {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const q = Math.floor(d.getUTCMonth() / 3); // 0..3
  const n = Math.max(1, (y - 2026) * 4 + q - 2);
  return {
    id: `S${n}`,
    n,
    start: Date.UTC(y, q * 3, 1),
    end: Date.UTC(y, q * 3 + 3, 1), // exclusive
  };
}

// On season rollover: halve the distance to the starting rating.
const softReset = (rating) => Math.round(START + ((rating ?? START) - START) / 2);

module.exports = { START, kFactor, rate, rateMatch, TIERS, tierOf, seasonOf, softReset };
