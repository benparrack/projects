// Read-only JSON API for pages that aren't tied to a live socket (profiles, leaderboards,
// replays). Everything here is public data; private account data only travels over the
// authenticated WebSocket.
const { publicUser } = require('./accounts');

function json(res, status, body, maxAge = 0) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-store',
  });
  res.end(JSON.stringify(body));
}

function createApi({ db, accounts, authMode, firebaseWebConfig, registry }) {
  const routes = [
    [/^\/api\/config$/, async () => [200, { authMode, firebase: firebaseWebConfig }]],

    [/^\/api\/user\/([A-Za-z0-9_]{1,24})$/, async ([, name]) => {
      const found = await accounts.getUserByName(name);
      if (!found || !found.user) return [404, { error: 'No such user.' }];
      const [stats, matches] = await Promise.all([
        db.list('stats', { where: [['uid', '==', found.uid]] }),
        db.list(`users/${found.uid}/matches`, { orderBy: ['endedAt', 'desc'], limit: 25 }),
      ]);
      return [200, {
        user: publicUser(found.user),
        stats: stats.map(({ id, uid, ...s }) => ({ ...s, score: ((registry[s.gameType] || {}).stats || {}).score || null })),
        matches: matches.map(stripUids),
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

  return async function handleApi(req, res) {
    const pathname = req.url.split('?')[0];
    if (!pathname.startsWith('/api/')) return false;
    if (req.method !== 'GET') { json(res, 405, { error: 'Method not allowed.' }); return true; }
    for (const [re, fn] of routes) {
      const m = re.exec(pathname);
      if (!m) continue;
      try {
        const [status, body, maxAge] = await fn(m);
        json(res, status, body, maxAge);
      } catch (err) {
        console.error('api error', pathname, err);
        json(res, 500, { error: 'Something went wrong.' });
      }
      return true;
    }
    json(res, 404, { error: 'Not found.' });
    return true;
  };
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
