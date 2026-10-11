// Chat: global (everyone online), room, party and friend DMs, plus reports.
// Channels are server-side keys: 'global', 'room:<code>', 'party:<id>', 'dm:<pairKey>'. Each keeps
// a short ring of recent messages in memory; global and DMs are also saved to the db
// (chat/global, chat/dm_<pairKey>) so they survive a restart. Room and party chat are ephemeral.
const crypto = require('crypto');
const { maskText } = require('./wordfilter');

const MAX_LEN = 200;
const KEEP = { global: 100, dm: 50, other: 50 };
const RATE_N = 5; // messages per user...
const RATE_MS = 10 * 1000; // ...per this window
const SLOW_BUSY = 20; // global messages in the last 30s that switch on slow mode
const SLOW_GAP_MS = 5 * 1000; // per-user gap while slow mode is on
const SAVE_DELAY_MS = 3000;
const REPORTS_PER_HOUR = 10;
// Anything that looks like a URL or a bare domain. Chat is links-free: no phishing, no spam.
const LINK_RE = /(https?:\/\/|www\.|\b[a-z0-9-]{2,}\s*(\.|\(dot\)|\[dot\])\s*(com|net|org|io|gg|xyz|ru|co|me|tv|ly|link|app|dev|info|biz|site|online|shop|live|cc|to)\b|discord\s*\.?\s*gg)/i;

const kind = (channel) => channel.split(':')[0];

function clean(text) {
  return String(text == null ? '' : text).replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim();
}

function createChat(db, { now = () => Date.now() } = {}) {
  const rings = new Map(); // channel -> [msg]
  const loading = new Map(); // channel -> Promise (db load in flight)
  const sent = new Map(); // uid -> [timestamps]
  const reported = new Map(); // uid -> [timestamps]
  const dirty = new Set();
  let saveTimer = null;

  const persisted = (channel) => channel === 'global' || kind(channel) === 'dm';
  const docOf = (channel) => (channel === 'global' ? 'chat/global' : `chat/dm_${channel.slice(3)}`);

  async function ring(channel) {
    if (rings.has(channel)) return rings.get(channel);
    if (!persisted(channel)) { rings.set(channel, []); return rings.get(channel); }
    if (!loading.has(channel)) {
      loading.set(channel, db.get(docOf(channel)).then((d) => {
        if (!rings.has(channel)) rings.set(channel, (d && d.messages) || []);
        loading.delete(channel);
      }, (err) => { loading.delete(channel); throw err; }));
    }
    await loading.get(channel);
    return rings.get(channel);
  }

  function scheduleSave(channel) {
    if (!persisted(channel)) return;
    dirty.add(channel);
    if (!saveTimer) saveTimer = setTimeout(flush, SAVE_DELAY_MS);
  }
  async function flush() {
    clearTimeout(saveTimer);
    saveTimer = null;
    const chans = [...dirty];
    dirty.clear();
    await Promise.all(chans.map((c) => db.set(docOf(c), { messages: rings.get(c) || [] }).catch((err) => console.error('chat: save failed', err))));
  }

  // Throttle check; returns an error string or null. Records the send when allowed.
  function throttle(uid, channel) {
    const t = now();
    const mine = (sent.get(uid) || []).filter((x) => t - x < RATE_MS);
    if (mine.length >= RATE_N) return 'You\'re sending messages too fast. Wait a few seconds.';
    if (channel === 'global') {
      const g = rings.get('global') || [];
      const busy = g.filter((m) => t - m.at < 30000).length >= SLOW_BUSY;
      const lastGlobal = g.findLast ? g.findLast((m) => m.uid === uid) : [...g].reverse().find((m) => m.uid === uid);
      if (busy && lastGlobal && t - lastGlobal.at < SLOW_GAP_MS) return 'Slow mode is on: one message every 5 seconds.';
    }
    mine.push(t);
    sent.set(uid, mine);
    return null;
  }

  // Validate, filter and store a message. user is the users/{uid} doc. Returns { msg } or { error }.
  async function post(uid, user, channel, rawText) {
    const text = clean(rawText);
    if (!text) return { error: null }; // empty: silently ignore
    if (text.length > MAX_LEN) return { error: `Messages are limited to ${MAX_LEN} characters.` };
    if (user.mutedUntil && user.mutedUntil > now()) return { error: `You're muted until ${new Date(user.mutedUntil).toUTCString().replace(' GMT', ' UTC')}.` };
    if (LINK_RE.test(text)) return { error: 'Links aren\'t allowed in chat.' };
    const r = await ring(channel);
    const err = throttle(uid, channel);
    if (err) return { error: err };
    const msg = {
      id: crypto.randomUUID().slice(0, 12),
      at: now(),
      uid, // stripped before sending (see toClient)
      from: { username: user.username, avatar: user.avatar, level: user.level || 1, ...(user.role === 'admin' ? { role: 'admin' } : {}) },
      text: maskText(text),
    };
    r.push(msg);
    const keep = KEEP[kind(channel)] || KEEP.other;
    if (r.length > keep) r.splice(0, r.length - keep);
    scheduleSave(channel);
    return { msg };
  }

  async function history(channel) { return [...(await ring(channel))]; }

  // Find a message anywhere in memory (reports and admin deletes refer to messages by id).
  function find(id) {
    for (const [channel, r] of rings) {
      const msg = r.find((m) => m.id === id);
      if (msg) return { channel, msg };
    }
    return null;
  }

  function remove(id) {
    const hit = find(id);
    if (!hit) return null;
    const r = rings.get(hit.channel);
    r.splice(r.indexOf(hit.msg), 1);
    scheduleSave(hit.channel);
    return hit;
  }

  // Account deletion / moderation: drop every message by uid from memory and saved history.
  async function purgeUser(uid, dmChannels = []) {
    await Promise.all(['global', ...dmChannels].map((c) => ring(c).catch(() => null)));
    for (const [channel, r] of rings) {
      const keep = r.filter((m) => m.uid !== uid);
      if (keep.length !== r.length) { rings.set(channel, keep); scheduleSave(channel); }
    }
    await flush();
    await Promise.all(dmChannels.map((c) => db.del(docOf(c)).then(() => rings.delete(c))));
  }

  const dropChannel = (channel) => rings.delete(channel);

  // Report a message (by id) or a user. Returns { ok } or { error }.
  async function report(by, target, { messageId, reason } = {}) {
    if (!target || target.uid === by.uid) return { error: 'You can\'t report that.' };
    const t = now();
    const mine = (reported.get(by.uid) || []).filter((x) => t - x < 3600 * 1000);
    if (mine.length >= REPORTS_PER_HOUR) return { error: 'You\'ve sent a lot of reports. Try again later.' };
    const hit = messageId ? find(messageId) : null;
    if (messageId && (!hit || hit.msg.uid !== target.uid)) return { error: 'That message is no longer available.' };
    const id = crypto.createHash('sha1').update(`${by.uid}|${target.uid}|${messageId || ''}`).digest('hex').slice(0, 20);
    const created = await db.create(`reports/${id}`, {
      at: t,
      status: 'open',
      reason: clean(reason).slice(0, 200) || null,
      by: { uid: by.uid, username: by.username },
      target: { uid: target.uid, username: target.username },
      message: hit ? { id: hit.msg.id, text: hit.msg.text, channel: kind(hit.channel), at: hit.msg.at } : null,
      context: hit ? rings.get(hit.channel).filter((m) => Math.abs(m.at - hit.msg.at) < 2 * 60 * 1000).slice(-10).map((m) => ({ username: m.from.username, text: m.text, at: m.at })) : [],
    });
    if (!created) return { error: 'You already reported this.' };
    mine.push(t);
    reported.set(by.uid, mine);
    return { ok: 'Thanks. A moderator will take a look.' };
  }

  return { post, history, find, remove, purgeUser, dropChannel, report, flush, MAX_LEN };
}

// What clients see: no uids.
function toClient(msg) {
  const { uid, ...rest } = msg;
  return rest;
}

module.exports = { createChat, toClient, clean, LINK_RE, MAX_LEN, RATE_N };
