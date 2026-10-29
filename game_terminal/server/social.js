// Friends, friend requests, blocks and recent players. One doc per account, social/{uid}:
//   { friends: {uid: since}, incoming: {uid: at}, outgoing: {uid: at}, blocked: {uid: at},
//     recent: [{ uid, at, gameType }] }
// Only the server reads these; clients get a view keyed by username (uids never leave the server).
const { publicUser } = require('./accounts');

const MAX_FRIENDS = 200;
const MAX_PENDING = 50;
const RECENT_MAX = 20;
const PROFILE_TTL_MS = 60 * 1000;

const blank = () => ({ friends: {}, incoming: {}, outgoing: {}, blocked: {}, recent: [] });

function createSocial(db, accounts) {
  // Read-modify-write per uid is queued so two quick actions can't overwrite each other.
  const queues = new Map();
  function serial(uid, fn) {
    const next = (queues.get(uid) || Promise.resolve()).then(fn, fn);
    const tail = next.catch(() => {});
    queues.set(uid, tail);
    tail.then(() => { if (queues.get(uid) === tail) queues.delete(uid); });
    return next;
  }
  async function load(uid) { return { ...blank(), ...((await db.get(`social/${uid}`)) || {}) }; }
  const edit = (uid, fn) => serial(uid, async () => {
    const d = await load(uid);
    fn(d);
    await db.set(`social/${uid}`, d);
    return d;
  });

  // shortcut: profiles are cached for a minute per process; fine on one Render instance, use a shared cache if it ever scales out.
  const profiles = new Map();
  async function profile(uid) {
    const hit = profiles.get(uid);
    if (hit && Date.now() - hit.at < PROFILE_TTL_MS) return hit.p;
    const p = publicUser(await accounts.getUser(uid));
    profiles.set(uid, { p, at: Date.now() });
    return p;
  }
  const forgetProfile = (uid) => profiles.delete(uid);

  async function resolve(uid, name) {
    const other = await accounts.uidForUsername(String(name || '').trim());
    if (!other) return { error: 'No player with that name.' };
    if (other === uid) return { error: 'That\'s you.' };
    return { other };
  }

  async function request(uid, name, now = Date.now()) {
    const r = await resolve(uid, name);
    if (r.error) return r;
    const { other } = r;
    const [me, them] = await Promise.all([load(uid), load(other)]);
    if (me.friends[other]) return { error: 'You\'re already friends.' };
    if (me.blocked[other]) return { error: 'You blocked this player. Unblock them first.' };
    if (them.blocked[uid]) return { error: 'You can\'t send this player a friend request.' };
    if (me.incoming[other]) return accept(uid, name, now); // they already asked: just accept
    if (me.outgoing[other]) return { error: 'Request already sent.' };
    if (Object.keys(me.friends).length >= MAX_FRIENDS) return { error: `You can have up to ${MAX_FRIENDS} friends.` };
    if (Object.keys(me.outgoing).length >= MAX_PENDING || Object.keys(them.incoming).length >= MAX_PENDING) return { error: 'Too many pending requests. Try again later.' };
    await edit(uid, (d) => { d.outgoing[other] = now; });
    await edit(other, (d) => { d.incoming[uid] = now; });
    return { ok: 'Friend request sent.', changed: [uid, other], notify: other };
  }

  async function accept(uid, name, now = Date.now()) {
    const r = await resolve(uid, name);
    if (r.error) return r;
    const { other } = r;
    const me = await load(uid);
    if (!me.incoming[other]) return { error: 'That request is no longer pending.' };
    await edit(uid, (d) => { delete d.incoming[other]; delete d.outgoing[other]; d.friends[other] = now; });
    await edit(other, (d) => { delete d.incoming[uid]; delete d.outgoing[uid]; d.friends[uid] = now; });
    return { ok: 'Friend added.', changed: [uid, other], notify: other };
  }

  // Decline an incoming request, cancel an outgoing one, or unfriend: all just drop the link.
  async function remove(uid, name) {
    const r = await resolve(uid, name);
    if (r.error) return r;
    const { other } = r;
    await edit(uid, (d) => { delete d.friends[other]; delete d.incoming[other]; delete d.outgoing[other]; });
    await edit(other, (d) => { delete d.friends[uid]; delete d.incoming[uid]; delete d.outgoing[uid]; });
    return { ok: null, changed: [uid, other] };
  }

  async function block(uid, name, on = true, now = Date.now()) {
    const r = await resolve(uid, name);
    if (r.error) return r;
    const { other } = r;
    if (!on) {
      await edit(uid, (d) => { delete d.blocked[other]; });
      return { ok: 'Unblocked.', changed: [uid] };
    }
    await edit(uid, (d) => { d.blocked[other] = now; delete d.friends[other]; delete d.incoming[other]; delete d.outgoing[other]; });
    await edit(other, (d) => { delete d.friends[uid]; delete d.incoming[uid]; delete d.outgoing[uid]; });
    return { ok: 'Blocked. They can\'t message, invite or friend you.', changed: [uid, other] };
  }

  // Everyone with an account in a finished match becomes a "recent player" of the others.
  async function noteRecent(uids, gameType, now = Date.now()) {
    const set = [...new Set(uids.filter(Boolean))];
    if (set.length < 2) return;
    await Promise.all(set.map((uid) => edit(uid, (d) => {
      const others = set.filter((u) => u !== uid);
      d.recent = [...others.map((u) => ({ uid: u, at: now, gameType })), ...d.recent.filter((x) => !others.includes(x.uid))].slice(0, RECENT_MAX);
    })));
  }

  async function isBlocked(uid, other) {
    const [a, b] = await Promise.all([load(uid), load(other)]);
    return !!(a.blocked[other] || b.blocked[uid]);
  }
  async function areFriends(uid, other) { return !!(await load(uid)).friends[other]; }
  async function friendUids(uid) { return Object.keys((await load(uid)).friends); }

  // The signed-in user's view. presence(uid) -> { online, playing } is supplied by the server.
  async function view(uid, presence = () => ({ online: false })) {
    const d = await load(uid);
    const entry = async (u, extra = {}) => {
      const p = await profile(u);
      return p && p.username ? { username: p.username, avatar: p.avatar, level: p.level, ...extra } : null;
    };
    const list = async (obj, withPresence) => (await Promise.all(Object.entries(obj).map(([u, at]) => entry(u, { since: at, ...(withPresence ? presence(u) : {}) })))).filter(Boolean);
    const [friends, incoming, outgoing, blocked, recent] = await Promise.all([
      list(d.friends, true), list(d.incoming), list(d.outgoing), list(d.blocked),
      Promise.all(d.recent.filter((x) => !d.blocked[x.uid]).map((x) => entry(x.uid, { at: x.at, gameType: x.gameType, friend: !!d.friends[x.uid], pending: !!d.outgoing[x.uid] }))),
    ]);
    const rank = (f) => (f.playing ? 0 : f.online ? 1 : 2);
    friends.sort((a, b) => rank(a) - rank(b) || a.username.localeCompare(b.username));
    return { friends, incoming, outgoing, blocked, recent: recent.filter(Boolean) };
  }

  // Account deletion: drop this account from everyone else's lists, then its own doc.
  async function forget(uid) {
    const d = await load(uid);
    const others = new Set([...Object.keys(d.friends), ...Object.keys(d.incoming), ...Object.keys(d.outgoing), ...d.recent.map((x) => x.uid)]);
    await Promise.all([...others].map((o) => edit(o, (x) => {
      delete x.friends[uid]; delete x.incoming[uid]; delete x.outgoing[uid]; delete x.blocked[uid];
      x.recent = x.recent.filter((r) => r.uid !== uid);
    })));
    await db.del(`social/${uid}`);
    forgetProfile(uid);
    return [...others];
  }

  return { request, accept, remove, block, noteRecent, isBlocked, areFriends, friendUids, view, forget, forgetProfile };
}

module.exports = { createSocial };
