// Turns a plugin's report(room, result) into durable account data. record() resolves to
// { summary, people } (people carry clientIds so the caller can notify each player), or null.
// Writes:
//   stats/{gameType}_{uid}        per-game totals (flat collection so leaderboards are one query)
//   users/{uid}/matches/{id}      that user's match history (newest first by endedAt)
//   pairs/{pairKey}               head-to-head totals for two accounts, per game
//   pairs/{pairKey}/matches/{id}  their shared matches
//   matches/{id}                  only for games with replays (the move list)
//   seasonResults/{season}_{gameType}_{uid}  final rating/rank, written by rollover()
// Ranked rooms (room.ranked) of plugins with stats.rated move a pairwise-Elo `rating` on the
// stats doc; season counters (sPlayed/sWins/sBest) reset when the stats doc's `season` is stale.
// Guests' results are never written. Bot games and solo runs are counted separately from
// human-vs-human games so nobody can farm wins against an Easy bot.
const crypto = require('crypto');
const { rateMatch, tierOf, seasonOf, softReset } = require('./ratings');

const newId = () => `${Date.now().toString(36)}${crypto.randomBytes(5).toString('hex')}`;
const pairKey = (a, b) => [a, b].sort().join('_');

function createResults({ db, registry, now = () => Date.now(), onRecorded = () => {} }) {
  // Serialises read-modify-write per stats doc. Single Render instance, so this is enough.
  const queues = new Map();
  function serial(key, fn) {
    const prev = queues.get(key) || Promise.resolve();
    const next = prev.then(fn, fn);
    queues.set(key, next.catch(() => {}));
    next.finally(() => { if (queues.get(key) === next) queues.delete(key); }).catch(() => {});
    return next;
  }

  // Resolves placement ids to participants using everyone the room has seen (a player who quit
  // mid-match and lost on forfeit is no longer in room.clients but still gets the loss).
  function participants(room, result) {
    const out = [];
    (result.placements || []).forEach((group, place) => {
      for (const id of group) {
        if (id === 'BOT') { out.push({ bot: true, place, name: 'BOT' }); continue; }
        const who = (room.seen && room.seen.get(id)) || room.clients.get(id) || {};
        out.push({ clientId: id, uid: who.uid || null, name: who.nickname || 'Player', place, score: result.scores ? result.scores[id] : undefined });
      }
    });
    return out;
  }

  async function record(room, result) {
    const plugin = registry[room.gameType] || {};
    const meta = plugin.stats || {};
    if (meta.none || !result || !Array.isArray(result.placements)) return null;
    const people = participants(room, result);
    const humans = people.filter((p) => !p.bot);
    if (!humans.length) return null; // bot-vs-bot exhibition: nobody to credit
    const accounts = humans.filter((p) => p.uid);
    const vsBot = people.some((p) => p.bot);
    const solo = people.length === 1;
    const kind = solo ? 'solo' : vsBot ? 'bot' : 'pvp';
    const endedAt = now();
    const id = newId();
    const summary = {
      id,
      gameType: room.gameType,
      kind,
      endedAt,
      botLevel: result.botLevel || null,
      ranked: !!room.ranked,
      players: people.map((p) => ({ name: p.name, bot: !!p.bot, place: p.place, ...(p.score != null ? { score: p.score } : {}), ...(p.uid ? { uid: p.uid } : {}) })),
      replay: !!(result.replay && typeof plugin.replayFrames === 'function'),
    };
    onRecorded(summary, people);
    if (!accounts.length) return { summary, people };

    const drawAll = people.length > 1 && people.every((p) => p.place === 0);
    const season = seasonOf(endedAt).id;
    // shortcut: ratings are computed from stats read before the writes below; two ranked results for
    // the same player landing in the same instant could each start from the same old rating. Fine at
    // this scale (one result per room at a time); move into a transaction if that ever matters.
    let ratings = {};
    if (room.ranked && kind === 'pvp' && meta.rated && accounts.length === humans.length) {
      const old = {};
      await Promise.all(accounts.map(async (p) => { old[p.uid] = await db.get(`stats/${room.gameType}_${p.uid}`); }));
      const uids = Object.fromEntries(accounts.map((p) => [p.clientId, p.uid]));
      ratings = rateMatch(old, result.placements, uids, { coop: result.placements.length < 2 }); // one shared placement = co-op, nothing to rate
    }
    const better = meta.score && meta.score.better;
    const writes = accounts.map((p) => serial(`stats/${room.gameType}_${p.uid}`, async () => {
      const path = `stats/${room.gameType}_${p.uid}`;
      const s = (await db.get(path)) || { uid: p.uid, gameType: room.gameType, played: 0, wins: 0, losses: 0, draws: 0, streak: 0, bestStreak: 0, botPlayed: 0, botWins: 0, soloPlayed: 0 };
      const won = !drawAll && p.place === 0;
      if (kind === 'pvp') {
        s.played += 1;
        if (drawAll) s.draws += 1;
        else if (won) s.wins += 1;
        else s.losses += 1;
        s.streak = won ? s.streak + 1 : drawAll ? s.streak : 0;
        s.bestStreak = Math.max(s.bestStreak, s.streak);
      } else if (kind === 'bot') {
        s.botPlayed += 1;
        if (won) s.botWins += 1;
        if (won && result.botLevel) s[`botWins_${result.botLevel}`] = (s[`botWins_${result.botLevel}`] || 0) + 1;
      } else {
        s.soloPlayed += 1;
      }
      if (better && typeof p.score === 'number' && Number.isFinite(p.score)) {
        if (s.best == null || (better === 'low' ? p.score < s.best : p.score > s.best)) { s.best = p.score; s.bestAt = endedAt; }
      }
      if (s.season !== season) { s.season = season; s.sPlayed = 0; s.sWins = 0; s.sBest = null; }
      if (kind === 'pvp') { s.sPlayed += 1; if (won) s.sWins += 1; }
      if (better && typeof p.score === 'number' && Number.isFinite(p.score) && (s.sBest == null || (better === 'low' ? p.score < s.sBest : p.score > s.sBest))) s.sBest = p.score;
      const r = ratings[p.uid];
      if (r) {
        s.rating = r.rating;
        s.ratedGames = r.ratedGames;
        s.peak = Math.max(s.peak || 0, r.rating);
        s.ratedSeason = season;
        s.sRated = (s.sRated || 0) + 1;
      }
      s.lastPlayed = endedAt;
      s.username = p.name;
      await db.set(path, s);
      await db.set(`users/${p.uid}/matches/${id}`, { ...summary, me: { place: p.place, won, draw: drawAll, score: p.score ?? null, ...(r ? { rating: r.rating, delta: r.delta } : {}) } });
      return s;
    }));

    if (kind === 'pvp' && accounts.length === 2 && people.length === 2) {
      const [a, b] = accounts;
      const key = pairKey(a.uid, b.uid);
      const winner = drawAll ? null : people.find((p) => p.place === 0).uid;
      writes.push(serial(`pairs/${key}`, async () => {
        const doc = (await db.get(`pairs/${key}`)) || { uids: [a.uid, b.uid].sort(), games: {} };
        const g = doc.games[room.gameType] || { played: 0, draws: 0, wins: {} };
        g.played += 1;
        if (winner) g.wins[winner] = (g.wins[winner] || 0) + 1;
        else g.draws += 1;
        doc.games[room.gameType] = g;
        doc.lastPlayed = endedAt;
        await db.set(`pairs/${key}`, doc);
        await db.set(`pairs/${key}/matches/${id}`, summary);
      }));
    }

    if (summary.replay) writes.push(db.set(`matches/${id}`, { gameType: room.gameType, endedAt, players: summary.players, replay: result.replay }));
    const settled = await Promise.allSettled(writes);
    for (const r of settled) if (r.status === 'rejected') console.error('results: write failed', r.reason);
    return { summary, people, ratings: Object.fromEntries(Object.entries(ratings).map(([uid, r]) => [uid, { rating: r.rating, delta: r.delta, tier: tierOf(r.rating) }])) };
  }

  // Season rollover, run at startup and hourly. The first run just remembers the season. When the
  // calendar quarter changes: rank everyone who played ranked last season (per game), archive
  // their final rating/tier/rank, and soft-reset every rating halfway back to the start.
  async function rollover() {
    const cur = seasonOf(now()).id;
    const metaDoc = await db.get('meta/season');
    if (!metaDoc) { await db.set('meta/season', { id: cur }); return null; }
    if (metaDoc.id === cur) return null;
    const prev = metaDoc.id;
    const rated = (await db.list('stats', { where: [['ratedSeason', '==', prev]] })).filter((s) => s.rating != null);
    const byGame = new Map();
    for (const s of rated) { if (!byGame.has(s.gameType)) byGame.set(s.gameType, []); byGame.get(s.gameType).push(s); }
    const writes = [];
    for (const [gameType, list] of byGame) {
      list.sort((a, b) => b.rating - a.rating);
      list.forEach((s, i) => writes.push(db.set(`seasonResults/${prev}_${gameType}_${s.uid}`, {
        season: prev, gameType, uid: s.uid, rating: s.rating, tier: tierOf(s.rating), rank: i + 1, of: list.length, games: s.sRated || 0,
      })));
    }
    await Promise.all(writes);
    // Everyone with a rating (not just last season's players) drifts back toward the start.
    const all = (await db.list('stats', {})).filter((s) => s.rating != null);
    await Promise.all(all.map((s) => serial(`stats/${s.gameType}_${s.uid}`, async () => {
      const fresh = await db.get(`stats/${s.gameType}_${s.uid}`);
      if (fresh && fresh.rating != null) await db.merge(`stats/${s.gameType}_${s.uid}`, { rating: softReset(fresh.rating), sRated: 0 });
    })));
    await db.set('meta/season', { id: cur, previous: prev, rolledAt: now() });
    return { from: prev, to: cur, archived: rated.length, reset: all.length };
  }

  return { record, rollover, pairKey };
}

module.exports = { createResults, pairKey };
