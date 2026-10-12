// Admin tools: the reports queue and moderation actions. Every action is logged to modlog/.
// Admins are users with role 'admin', or whose uid is listed in the ADMIN_UIDS env var
// (comma-separated) — that's how the first admin gets in.
const crypto = require('crypto');

const ADMIN_UIDS = new Set(String(process.env.ADMIN_UIDS || '').split(',').map((s) => s.trim()).filter(Boolean));
const MAX_MINUTES = 365 * 24 * 60;

// Which rule a penalty is for (the /rules sections). Every penalty names one, and the player is told
// which, what was done, until when, and how to appeal: the EU DSA "statement of reasons" (Art. 17).
const GROUNDS = {
  harassment: 'Harassment, threats or hate speech',
  sexual: 'Sexual content',
  cheating: 'Cheating, scripts or exploiting bugs',
  spam: 'Spam, ads or scam links',
  personal: 'Sharing personal information',
  impersonation: 'Impersonating someone',
  name: 'Offensive username, avatar or drawing',
  illegal: 'Illegal content',
  other: 'Other rule break',
};
const PENALTIES = new Set(['mute', 'ban', 'rename', 'resetStats', 'deleteMessage']);
const MAX_NOTICES = 10;

const isAdmin = (uid, user) => !!uid && !!user && (user.role === 'admin' || ADMIN_UIDS.has(uid));

function createModeration(db, accounts, { chat, now = () => Date.now() } = {}) {
  async function reports(status = 'open') {
    const rows = await db.list('reports', { where: [['status', '==', status]] });
    return rows.sort((a, b) => b.at - a.at).slice(0, 100);
  }

  // A user's moderation record for the admin view.
  async function lookup(name) {
    const hit = await accounts.getUserByName(name);
    if (!hit || !hit.user) return null;
    const { user, uid } = hit;
    const [against, log] = await Promise.all([
      db.list('reports', { where: [['target.uid', '==', uid]] }).catch(() => []),
      db.list('modlog', { where: [['targetUid', '==', uid]] }).catch(() => []),
    ]);
    return {
      username: user.username, avatar: user.avatar, level: user.level || 1, createdAt: user.createdAt, role: user.role || 'user',
      mutedUntil: user.mutedUntil > now() ? user.mutedUntil : null,
      bannedUntil: user.bannedUntil > now() ? user.bannedUntil : null,
      reports: against.length,
      log: log.sort((a, b) => b.at - a.at).slice(0, 20).map(({ action, minutes, by, at, note, ground }) => ({ action, minutes, by, at, note, reason: GROUNDS[ground] || null })),
    };
  }

  // Returns { ok, uid, user? , renamed? } or { error }. admin = { uid, username }.
  async function act(admin, { action, username, minutes, reportId, messageId, note, ground }) {
    const cleanNote = note ? String(note).trim().slice(0, 200) || null : null;
    if (PENALTIES.has(action) && !GROUNDS[ground]) return { error: 'Pick which rule was broken.' };
    const log = (targetUid, extra = {}) => db.set(`modlog/${crypto.randomUUID()}`, { at: now(), action, by: admin.username, targetUid: targetUid || null, target: username || null, note: cleanNote, ground: ground || null, ...extra });
    // The statement the player sees (moderator names stay private).
    const tell = async (uid, extra = {}) => {
      const user = await accounts.getUser(uid);
      if (!user) return;
      const notice = { id: crypto.randomUUID(), at: now(), action, ground, reason: GROUNDS[ground], note: cleanNote, ...extra };
      await db.merge(`users/${uid}`, { modNotices: [...(user.modNotices || []), notice].slice(-MAX_NOTICES) });
    };
    if (action === 'dismiss' || action === 'resolve') {
      const r = await db.get(`reports/${reportId}`);
      if (!r) return { error: 'No such report.' };
      await db.merge(`reports/${reportId}`, { status: action === 'dismiss' ? 'dismissed' : 'resolved', handledBy: admin.username, handledAt: now() });
      await log(r.target.uid, { reportId });
      return { ok: action === 'dismiss' ? 'Report dismissed.' : 'Report resolved.' };
    }
    if (action === 'deleteMessage') {
      const gone = chat.remove(String(messageId || ''));
      if (!gone) return { error: 'That message is already gone.' };
      await log(gone.msg.uid, { text: gone.msg.text });
      if (gone.msg.uid) await tell(gone.msg.uid, { text: String(gone.msg.text).slice(0, 200) });
      if (reportId) await db.merge(`reports/${reportId}`, { status: 'resolved', handledBy: admin.username, handledAt: now() }).catch(() => {});
      const author = gone.msg.uid ? await accounts.getUser(gone.msg.uid) : null;
      return { ok: 'Message deleted.', deleted: gone.msg.id, uid: author ? gone.msg.uid : undefined, user: author || undefined };
    }
    const hit = await accounts.getUserByName(username || '');
    if (!hit || !hit.user) return { error: 'No such user.' };
    const { uid } = hit;
    if (uid === admin.uid && action !== 'unmute') return { error: 'You can\'t moderate yourself.' };
    const mins = Math.max(1, Math.min(MAX_MINUTES, Math.round(Number(minutes) || 0)));
    switch (action) {
      case 'mute':
      case 'ban': {
        if (!Number(minutes)) return { error: 'Pick a duration.' };
        const field = action === 'mute' ? 'mutedUntil' : 'bannedUntil';
        await db.merge(`users/${uid}`, { [field]: now() + mins * 60000 });
        await log(uid, { minutes: mins });
        await tell(uid, { until: now() + mins * 60000 });
        break;
      }
      case 'unmute':
      case 'unban':
        await db.merge(`users/${uid}`, { [action === 'unmute' ? 'mutedUntil' : 'bannedUntil']: null });
        await log(uid);
        break;
      case 'resetStats': {
        const stats = await db.list('stats', { where: [['uid', '==', uid]] });
        await Promise.all(stats.map((s) => db.del(`stats/${s.id}`)));
        await log(uid, { count: stats.length });
        await tell(uid);
        break;
      }
      case 'rename': {
        let res;
        for (let i = 0; i < 5 && !(res && res.user); i++) {
          res = await accounts.claimUsername(uid, { username: `player_${crypto.randomInt(100000, 999999)}`, force: true });
        }
        if (!res.user) return { error: res.error || 'Rename failed.' };
        await log(uid, { newName: res.user.username });
        await tell(uid, { oldName: hit.user.username });
        return { ok: `Renamed to ${res.user.username}. They can pick a new name right away.`, uid, user: await accounts.getUser(uid), renamed: true };
      }
      default:
        return { error: 'Unknown action.' };
    }
    if (reportId) await db.merge(`reports/${reportId}`, { status: 'resolved', handledBy: admin.username, handledAt: now() }).catch(() => {});
    const labels = { mute: `Muted for ${mins} min.`, ban: `Banned for ${mins} min.`, unmute: 'Unmuted.', unban: 'Unbanned.', resetStats: 'Stats reset.' };
    return { ok: labels[action], uid, user: await accounts.getUser(uid) };
  }

  return { reports, lookup, act };
}

// Unseen statements of reasons, for the player's own account view.
const unseenNotices = (user) => (user.modNotices || []).filter((n) => !n.seen);

module.exports = { createModeration, isAdmin, GROUNDS, unseenNotices };
