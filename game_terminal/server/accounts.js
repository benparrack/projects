// User accounts: the users/{uid} doc, unique usernames (usernames/{lower} -> uid), avatars, and
// the public shape of a user that other players get to see.
const { isOffensiveName } = require('./wordfilter');

// Kept in sync by hand with public/avatars.js (test/accounts.test.js checks it).
const AVATAR_IDS = [
  'invader', 'ghost', 'skull', 'robot', 'cat', 'frog', 'alien', 'knight',
  'heart', 'star', 'bolt', 'crown', 'sword', 'potion', 'mushroom', 'rocket',
  'snake', 'ufo', 'dice', 'joystick', 'cherry', 'diamond', 'flame', 'moon',
];

// Bump when the Terms/Privacy text changes in a way users must re-accept.
const TERMS_VERSION = '2026-10-11';
const RENAME_COOLDOWN_MS = 30 * 24 * 3600 * 1000;
const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const RESERVED = new Set([
  'admin', 'administrator', 'mod', 'moderator', 'staff', 'system', 'server', 'support', 'help',
  'root', 'official', 'owner', 'gameterminal', 'game_terminal', 'terminal', 'anonymous', 'guest',
  'bot', 'cpu', 'null', 'undefined', 'everyone', 'here', 'you', 'me', 'deleted', 'deleted_user',
]);

function validateUsername(name) {
  const s = String(name || '').trim();
  if (!USERNAME_RE.test(s)) return 'Usernames are 3-16 characters: letters, numbers and _ only.';
  if (RESERVED.has(s.toLowerCase())) return 'That username is reserved.';
  if (isOffensiveName(s)) return 'Please pick a different username.';
  return null;
}

// What other players see. Never includes email, uid-linked secrets, settings or moderation fields.
function publicUser(u) {
  if (!u) return null;
  return {
    username: u.username,
    avatar: u.avatar,
    level: u.level || 1,
    xp: u.xp || 0,
    createdAt: u.createdAt,
    cosmetics: u.cosmetics || {},
    role: u.role === 'admin' ? 'admin' : undefined,
  };
}

function createAccounts(db) {
  async function getUser(uid) {
    return db.get(`users/${uid}`);
  }

  async function uidForUsername(name) {
    const row = await db.get(`usernames/${String(name).toLowerCase()}`);
    return row ? row.uid : null;
  }

  async function getUserByName(name) {
    const uid = await uidForUsername(name);
    return uid ? { uid, user: await getUser(uid) } : null;
  }

  // First-time setup or a rename. Returns { user } or { error }.
  async function claimUsername(uid, { username, avatar, acceptTerms }, now = Date.now()) {
    const err = validateUsername(username);
    if (err) return { error: err };
    const name = String(username).trim();
    const lower = name.toLowerCase();
    const existing = await getUser(uid);
    if (!existing && !acceptTerms) return { error: 'You need to accept the Terms and Privacy Policy.' };
    if (avatar != null && !AVATAR_IDS.includes(avatar)) return { error: 'Unknown avatar.' };
    if (existing && existing.usernameLower === lower) {
      // Same name (maybe new capitalisation) — no claim needed.
      await db.merge(`users/${uid}`, { username: name, ...(avatar ? { avatar } : {}) });
      return { user: await getUser(uid) };
    }
    if (existing && existing.renamedAt && now - existing.renamedAt < RENAME_COOLDOWN_MS) {
      const days = Math.ceil((RENAME_COOLDOWN_MS - (now - existing.renamedAt)) / 86400000);
      return { error: `You can change your username again in ${days} day${days === 1 ? '' : 's'}.` };
    }
    const claimed = await db.create(`usernames/${lower}`, { uid, at: now });
    if (!claimed) return { error: 'That username is taken.' };
    if (existing) {
      await db.del(`usernames/${existing.usernameLower}`);
      await db.merge(`users/${uid}`, { username: name, usernameLower: lower, renamedAt: now, ...(avatar ? { avatar } : {}) });
    } else {
      await db.set(`users/${uid}`, {
        username: name,
        usernameLower: lower,
        avatar: avatar || AVATAR_IDS[Math.floor(Math.random() * AVATAR_IDS.length)],
        createdAt: now,
        termsVersion: TERMS_VERSION,
        termsAcceptedAt: now,
        xp: 0,
        level: 1,
        role: 'user',
        settings: {},
        cosmetics: {},
        achievements: {},
      });
    }
    return { user: await getUser(uid) };
  }

  async function updateProfile(uid, { avatar, settings }) {
    const patch = {};
    if (avatar != null) {
      if (!AVATAR_IDS.includes(avatar)) return { error: 'Unknown avatar.' };
      patch.avatar = avatar;
    }
    if (settings && typeof settings === 'object') patch.settings = sanitizeSettings(settings);
    await db.merge(`users/${uid}`, patch);
    return { user: await getUser(uid) };
  }

  async function acceptTerms(uid, now = Date.now()) {
    await db.merge(`users/${uid}`, { termsVersion: TERMS_VERSION, termsAcceptedAt: now });
  }

  // GDPR right of access: everything stored about this account, other players' uids removed.
  async function exportData(uid) {
    const user = await getUser(uid);
    if (!user) return null;
    const [stats, matches] = await Promise.all([
      db.list('stats', { where: [['uid', '==', uid]] }),
      db.list(`users/${uid}/matches`, { orderBy: ['endedAt', 'desc'] }),
    ]);
    const scrub = (m) => ({ ...m, players: (m.players || []).map(({ uid: u, ...p }) => ({ ...p, ...(u === uid ? { you: true } : {}) })) });
    return { exportedAt: new Date().toISOString(), account: user, stats: stats.map(({ uid: u, ...st }) => st), matches: matches.map(scrub) };
  }

  // Right to erasure: drop the account's own docs and anonymise it in every match it shared.
  async function deleteAccount(uid) {
    const user = await getUser(uid);
    if (!user) return false;
    const anon = (players) => (players || []).map((p) => (p.uid === uid ? { name: DELETED_NAME, bot: false, place: p.place, ...(p.score != null ? { score: p.score } : {}) } : p));
    const matches = await db.list(`users/${uid}/matches`);
    for (const m of matches) {
      const players = anon(m.players);
      for (const other of new Set((m.players || []).map((p) => p.uid).filter((u) => u && u !== uid))) {
        const path = `users/${other}/matches/${m.id}`;
        if (await db.get(path)) await db.merge(path, { players });
        await db.del(`pairs/${pairKeyOf(uid, other)}/matches/${m.id}`);
      }
      if (m.replay && (await db.get(`matches/${m.id}`))) await db.merge(`matches/${m.id}`, { players });
      await db.del(`users/${uid}/matches/${m.id}`);
    }
    const [stats, pairs] = await Promise.all([
      db.list('stats', { where: [['uid', '==', uid]] }),
      db.list('pairs', { where: [['uids', 'array-contains', uid]] }),
    ]);
    await Promise.all([
      ...stats.map((st) => db.del(`stats/${st.id}`)),
      ...pairs.map((pr) => db.del(`pairs/${pr.id}`)),
      db.del(`usernames/${user.usernameLower}`),
    ]);
    await db.del(`users/${uid}`);
    return true;
  }

  return { getUser, getUserByName, uidForUsername, claimUsername, updateProfile, acceptTerms, exportData, deleteAccount };
}

// Only known keys with the right types survive — settings come straight from the client.
const SETTINGS_SCHEMA = {
  muted: 'boolean',
  volume: 'number',
  reducedMotion: 'boolean',
  botLevel: ['easy', 'medium', 'hard', 'expert'],
  chatOpen: 'boolean',
  showGlobalChat: 'boolean',
};
const DELETED_NAME = 'deleted player';
const pairKeyOf = (a, b) => [a, b].sort().join('_');

function sanitizeSettings(input) {
  const out = {};
  for (const [k, type] of Object.entries(SETTINGS_SCHEMA)) {
    const v = input[k];
    if (Array.isArray(type) ? type.includes(v) : typeof v === type) out[k] = type === 'number' ? Math.max(0, Math.min(1, v)) : v;
  }
  return out;
}

module.exports = { createAccounts, validateUsername, publicUser, sanitizeSettings, AVATAR_IDS, TERMS_VERSION };
