// Read-only JSON API for pages that aren't tied to a live socket (profiles, leaderboards,
// replays). Everything here is public data; private account data only travels over the
// authenticated WebSocket.
const { publicUser } = require('./accounts');
const { tierOf, seasonOf } = require('./ratings');
const { levelFor, ACHIEVEMENT_LIST, cosmeticsFor } = require('./progression');
const { isAdmin } = require('./moderation');
const { DAILY_GAMES } = require('./daily');

const BOARD_TTL_MS = 5 * 60 * 1000;
const BOARD_SIZE = 50;

function json(res, status, body, maxAge = 0) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-store',
  });
  res.end(JSON.stringify(body));
}

const ERRORS_PER_MIN = 30;

function createApi({ db, accounts, daily = null, weekly = null, live = null, authMode, firebaseWebConfig, registry, now = () => Date.now() }) {
  // What the client needs to know per game: does it have a ladder, and what's its score.
  const games = Object.fromEntries(Object.entries(registry).filter(([, p]) => !(p.stats || {}).none)
    .map(([type, p]) => [type, { rated: !!(p.stats || {}).rated, score: (p.stats || {}).score || null }]));

  // Leaderboards: every stats doc for a game, ranked by one metric, cached for a few minutes.
  // shortcut: reads the whole per-game stats collection on a cache miss; fine for thousands of
  // players, switch to orderBy+limit queries (and Firestore indexes) beyond that.
  const boards = new Map(); // `${gameType}|${scope}|${by}` -> { at, rows }
  async function board(gameType, scope, by) {
    const key = `${gameType}|${scope}|${by}`;
    const hit = boards.get(key);
    if (hit && now() - hit.at < BOARD_TTL_MS) return hit;
    const season = seasonOf(now()).id;
    const better = (games[gameType].score || {}).better;
    const all = await db.list('stats', { where: [['gameType', '==', gameType]] });
    const valueOf = {
      rating: (s) => (s.rating != null && (scope === 'all' || s.ratedSeason === season) ? s.rating : null),
      wins: (s) => (scope === 'all' ? s.wins || null : s.season === season ? s.sWins || null : null),
      best: (s) => (scope === 'all' ? s.best : s.season === season ? s.sBest : null),
    }[by];
    const rows = all.map((s) => ({ s, v: valueOf(s) })).filter((r) => r.v != null)
      .sort((a, b) => (by === 'best' && better === 'low' ? a.v - b.v : b.v - a.v) || (a.s.lastPlayed || 0) - (b.s.lastPlayed || 0))
      .map(({ s, v }, i) => ({
        rank: i + 1, uid: s.uid, username: s.username, value: v,
        played: scope === 'all' ? s.played : s.season === season ? s.sPlayed : 0,
        wins: scope === 'all' ? s.wins : s.season === season ? s.sWins : 0,
        ...(s.rating != null ? { rating: s.rating, tier: tierOf(s.rating) } : {}),
      }));
    const out = { at: now(), rows, season };
    boards.set(key, out);
    return out;
  }

  const routes = [
    // Homepage strip: people connected now, games finished today, most played this week.
    [/^\/api\/live$/, async () => (live ? [200, await live(), 5] : [404, { error: 'Not found.' }])],
    // Today's daily-challenge boards (top 50 per game, profiles joined, no uids).
    [/^\/api\/daily$/, async () => {
      if (!daily) return [404, { error: 'Not found.' }];
      const date = daily.today();
      const games = {};
      for (const [type, g] of Object.entries(DAILY_GAMES)) {
        const rows = await daily.board(type, date);
        const users = await Promise.all(rows.slice(0, BOARD_SIZE).map((r) => db.get(`users/${r.uid}`)));
        games[type] = {
          label: g.label, better: g.better, score: ((registry[type] || {}).stats || {}).score || null, total: rows.length,
          rows: rows.slice(0, BOARD_SIZE).map((r, i) => (users[i] ? { rank: r.rank, score: r.score, ...publicUser(users[i]) } : null)).filter(Boolean),
        };
      }
      return [200, { date, nextAt: Date.parse(`${date}T00:00:00Z`) + 86400000, games }, 30];
    }],
    [/^\/api\/weekly$/, async () => {
      if (!weekly) return [404, { error: 'Not found.' }];
      const week = weekly.current();
      const b = await weekly.board(week);
      const users = await Promise.all(b.rows.map((r) => db.get(`users/${r.uid}`)));
      return [200, {
        week: week.id, gameType: week.gameType, endsAt: week.endsAt, total: b.total,
        rows: b.rows.map((r, i) => (users[i] ? { rank: i + 1, points: r.points, wins: r.wins, played: r.played, ...publicUser(users[i]) } : null)).filter(Boolean),
      }, 60];
    }],
    [/^\/api\/config$/, async () => [200, { authMode, firebase: firebaseWebConfig, games, season: seasonOf(now()) }]],

    // ?scope=all|season &by=rating|wins|best &names=a,b (friends view: only these usernames)
    [/^\/api\/leaderboard\/([a-z0-9]{1,24})$/, async ([, gameType], q) => {
      const g = games[gameType];
      if (!g) return [404, { error: 'No such game.' }];
      const scope = q.get('scope') === 'season' ? 'season' : 'all';
      const by = ['rating', 'wins', 'best'].includes(q.get('by')) ? q.get('by') : g.rated ? 'rating' : g.score ? 'best' : 'wins';
      if ((by === 'rating' && !g.rated) || (by === 'best' && !g.score)) return [400, { error: 'That game has no such leaderboard.' }];
      const b = await board(gameType, scope, by);
      const names = q.get('names') ? new Set(q.get('names').toLowerCase().split(',').slice(0, 200)) : null;
      const rows = (names ? b.rows.filter((r) => names.has(String(r.username).toLowerCase())) : b.rows).slice(0, BOARD_SIZE);
      // Join the current profile (name/avatar/level may have changed since the stats doc was written).
      const users = await Promise.all(rows.map((r) => db.get(`users/${r.uid}`)));
      return [200, {
        gameType, scope, by, season: b.season, updatedAt: b.at, total: b.rows.length,
        rows: rows.map(({ uid, ...r }, i) => (users[i] ? { ...r, ...publicUser(users[i]) } : null)).filter(Boolean),
      }, names ? 0 : 60];
    }],

    [/^\/api\/user\/([A-Za-z0-9_]{1,24})$/, async ([, name]) => {
      const found = await accounts.getUserByName(name);
      if (!found || !found.user) return [404, { error: 'No such user.' }];
      const [stats, matches, seasons] = await Promise.all([
        db.list('stats', { where: [['uid', '==', found.uid]] }),
        db.list(`users/${found.uid}/matches`, { orderBy: ['endedAt', 'desc'], limit: 25 }),
        db.list('seasonResults', { where: [['uid', '==', found.uid]] }),
      ]);
      return [200, {
        user: publicUser(found.user),
        progress: levelFor(found.user.xp || 0),
        cosmetics: cosmeticsFor(found.user, isAdmin(found.uid, found.user)),
        achievements: ACHIEVEMENT_LIST.map((a) => ({ ...a, at: (found.user.achievements || {})[a.id] || null })),
        stats: stats.filter((s) => !((registry[s.gameType] || {}).stats || {}).none).map(({ id, uid, ...s }) => ({ ...s, ...(s.rating != null ? { tier: tierOf(s.rating) } : {}), score: ((registry[s.gameType] || {}).stats || {}).score || null })),
        matches: matches.map(stripUids),
        seasons: seasons.map(({ id, uid, ...s }) => s).sort((a, b) => b.season.localeCompare(a.season, 'en', { numeric: true }) || a.rank - b.rank),
      }];
    }],

    // Head-to-head between two accounts: per-game record plus their latest shared matches.
    [/^\/api\/h2h\/([A-Za-z0-9_]{1,24})\/([A-Za-z0-9_]{1,24})$/, async ([, an, bn]) => {
      const [a, b] = await Promise.all([accounts.getUserByName(an), accounts.getUserByName(bn)]);
      if (!a || !a.user || !b || !b.user) return [404, { error: 'No such user.' }];
      if (a.uid === b.uid) return [400, { error: 'Pick two different players.' }];
      const key = [a.uid, b.uid].sort().join('_');
      const [pair, matches] = await Promise.all([
        db.get(`pairs/${key}`),
        db.list(`pairs/${key}/matches`, { orderBy: ['endedAt', 'desc'], limit: 20 }),
      ]);
      const games = Object.entries((pair && pair.games) || {}).map(([gameType, g]) => ({
        gameType, played: g.played, draws: g.draws, a: g.wins[a.uid] || 0, b: g.wins[b.uid] || 0,
      })).sort((x, y) => y.played - x.played);
      return [200, {
        a: publicUser(a.user), b: publicUser(b.user), games,
        lastPlayed: (pair && pair.lastPlayed) || null,
        matches: matches.map((m) => ({ ...stripUids(m), winner: winnerOf(m, a.uid) })),
      }];
    }],

    [/^\/api\/match\/([a-z0-9]{8,40})\/frames$/, async ([, id]) => {
      const m = await db.get(`matches/${id}`);
      const plugin = m && registry[m.gameType];
      if (!m || !plugin || typeof plugin.replayFrames !== 'function') return [404, { error: 'No replay for that match.' }];
      return [200, { gameType: m.gameType, endedAt: m.endedAt, players: m.players.map(stripUid), frames: plugin.replayFrames(m.replay) }, 3600];
    }],
  ];

  // Browser errors (public/errors.js) go to the server log so breakage on players' machines is visible.
  // Untrusted input: size-capped, one line, rate-limited site-wide so it can't flood the log.
  let errWindow = { at: 0, n: 0 };
  async function clientError(req, res) {
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 4096) break; }
    res.writeHead(204); res.end();
    if (now() - errWindow.at > 60000) errWindow = { at: now(), n: 0 };
    if (++errWindow.n > ERRORS_PER_MIN) return;
    let e;
    try { e = JSON.parse(body.slice(0, 4096)); } catch { return; }
    const clean = (v, n) => String(v == null ? '' : v).replace(/[\x00-\x1f]+/g, ' ').slice(0, n);
    console.error(`client error: ${clean(e.message, 300)} @ ${clean(e.source, 120)}:${clean(e.line, 8)} | page ${clean(e.page, 80)} | ${clean(e.ua, 120)}${e.stack ? ` | ${clean(e.stack, 600)}` : ''}`);
  }

  async function handleApi(req, res) {
    const pathname = req.url.split('?')[0];
    if (!pathname.startsWith('/api/')) return false;
    if (pathname === '/api/client-error' && req.method === 'POST') { await clientError(req, res); return true; }
    if (req.method !== 'GET') { json(res, 405, { error: 'Method not allowed.' }); return true; }
    for (const [re, fn] of routes) {
      const m = re.exec(pathname);
      if (!m) continue;
      try {
        const [status, body, maxAge] = await fn(m, new URLSearchParams(req.url.split('?')[1] || ''));
        json(res, status, body, maxAge);
      } catch (err) {
        console.error('api error', pathname, err);
        json(res, 500, { error: 'Something went wrong.' });
      }
      return true;
    }
    json(res, 404, { error: 'Not found.' });
    return true;
  }
  // A new result can change a game's boards; drop them so the next read is fresh.
  handleApi.dropBoards = (gameType) => { for (const k of boards.keys()) if (k.startsWith(`${gameType}|`)) boards.delete(k); };
  return handleApi;
}

// uids never leave the server; profiles are addressed by username.
const stripUid = ({ uid, ...p }) => (uid ? { ...p, account: true } : p);
// 'a' / 'b' from the first player's point of view, null for a draw.
function winnerOf(m, aUid) {
  const top = m.players.filter((p) => p.place === 0);
  if (top.length === m.players.length) return null;
  return top.some((p) => p.uid === aUid) ? 'a' : 'b';
}
const stripUids = (m) => ({ ...m, players: (m.players || []).map(stripUid) });

module.exports = { createApi };
