const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const { handleStaticRequest } = require('./static');
const { ClientMessage, ServerMessage, RoomErrorReason, makeEnvelope, publicRoomCode, dailyRoomCode } = require('./protocol');
const { RoomManager } = require('./roomManager');
const gameRegistry = require('./games');
const { createDb } = require('./db');
const { createAuth, webConfig } = require('./auth');
const { createAccounts, publicUser, TERMS_VERSION } = require('./accounts');
const { createResults } = require('./results');
const { createDaily, DAILY_GAMES, seedOf } = require('./daily');
const { createActivity, itemsFor } = require('./activity');
const { createApi } = require('./api');
const { createSocial } = require('./social');
const { Parties } = require('./party');
const { createChat, toClient } = require('./chat');
const { createModeration, isAdmin } = require('./moderation');
const { createWeekly } = require('./weekly');
const { createAsyncGames, isAsyncCode } = require('./asyncGames');

const PORT = process.env.PORT || 3000;
const MAX_PAYLOAD = 64 * 1024;

const db = createDb();
const auth = createAuth();
const accounts = createAccounts(db);
const daily = createDaily(db);
const activity = createActivity(db);
const weekly = createWeekly(db);
const results = createResults({ db, registry: gameRegistry, daily, weekly, onRecorded: (summary) => activity.counted(summary.gameType).catch((err) => console.error('activity: count failed', err)) });
const social = createSocial(db, accounts);
const parties = new Parties();
const chat = createChat(db);
const moderation = createModeration(db, accounts, { chat });
const handleApi = createApi({ db, accounts, daily, weekly, live: async () => ({ online: wss.clients.size, ...(await activity.stats()) }), authMode: auth.mode, firebaseWebConfig: webConfig(), registry: gameRegistry });
console.log(`accounts: auth=${auth.mode} db=${db.backend}`);

const roomManager = new RoomManager(gameRegistry, {
  onResult(room, result) {
    results.record(room, result).then((rec) => {
      if (!rec) return;
      // Tell each human how it went; guests get nudged to sign up so it would have counted.
      const players = rec.summary.players.map(({ uid, ...q }) => q);
      const draw = players.length > 1 && players.every((q) => q.place === 0);
      for (const p of rec.people) {
        if (p.bot) continue;
        room.sendTo(p.clientId, makeEnvelope(ServerMessage.RESULT_RECORDED, { gameType: rec.summary.gameType, kind: rec.summary.kind, saved: !!p.uid, place: p.place, draw, players, ranked: rec.summary.ranked, rating: (p.uid && rec.ratings && rec.ratings[p.uid]) || null, progress: (p.uid && rec.progress && rec.progress[p.uid]) || null, daily: (p.uid && rec.daily && rec.daily[p.uid]) || null }));
      }
      // XP/level/achievements changed: refresh every open tab of that account (header level, profile).
      for (const uid of Object.keys(rec.progress || {})) {
        refreshAccount(uid).catch((err) => console.error('account refresh failed', err));
        const items = itemsFor(rec.summary, uid, { progress: rec.progress[uid], daily: rec.daily && rec.daily[uid], rating: rec.ratings && rec.ratings[uid] });
        activity.log(uid, items).catch((err) => console.error('activity: log failed', err));
      }
      const uids = rec.people.map((p) => p.uid).filter(Boolean);
      if (uids.length > 1) social.noteRecent(uids, rec.summary.gameType).then(() => pushMany(uids)).catch((err) => console.error('social: recent failed', err));
    }).catch((err) => console.error('results: record failed', err));
  },
});

const server = http.createServer(async (req, res) => {
  if (await handleApi(req, res)) return;
  handleStaticRequest(req, res);
});
// Nagle's algorithm is on by default for Node TCP sockets and batches small writes for up to
// ~40ms waiting to coalesce them — fine for bulk HTTP responses, but real-time game traffic here
// is a steady stream of tiny messages (30Hz state broadcasts, per-frame move/look) where that
// batching reads directly as input/render lag. Disabling it per-connection removes that delay.
server.on('connection', (socket) => socket.setNoDelay(true));
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_PAYLOAD });

// Per-connection session state, keyed by the ws instance.
const sessions = new WeakMap();

function send(ws, type, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(makeEnvelope(type, payload)));
}

const asyncGames = createAsyncGames({ db, roomManager, registry: gameRegistry });

function currentRoom(session) {
  if (!session.roomCode) return null;
  return roomManager.getRoom(session.roomCode);
}

function leaveCurrentRoom(session, clientId) {
  const room = currentRoom(session);
  if (!room) return;
  roomManager.leaveRoom(room, clientId);
  if (room.async && session.uid) asyncGames.unseat(room, session.uid, clientId);
  session.roomCode = null;
  if (!room.clients.size) chat.dropChannel(`room:${room.code}`);
  room.broadcast(makeEnvelope(ServerMessage.ROOM_PRESENCE, { roster: room.roster(), left: clientId }));
  if (room.async) resyncSeats(room, null);
  if (session.uid) presenceChanged(session.uid);
}

// ---- Presence, friends and parties (accounts only) ----
const online = new Map(); // uid -> Set<ws>
const PARTY_GRACE_MS = 30 * 1000; // a dropped connection keeps its party seat this long

const socketsOf = (uid) => [...(online.get(uid) || [])];
const report = (err) => console.error('social:', err);

function presence(uid) {
  const list = socketsOf(uid);
  if (!list.length) return { online: false };
  for (const w of list) {
    const room = currentRoom(sessions.get(w) || {});
    if (room) return { online: true, playing: { gameType: room.gameType, code: room.code, isPublic: room.isPublic } };
  }
  return { online: true };
}

async function partyView(uid) {
  const party = parties.get(uid);
  if (!party) return null;
  const members = await Promise.all(party.members.map(async (u) => {
    const p = publicUser(await accounts.getUser(u));
    return p && { username: p.username, avatar: p.avatar, leader: u === party.leader, online: online.has(u) };
  }));
  return { id: party.id, leader: party.leader === uid, members: members.filter(Boolean) };
}

async function pushSocial(uid) {
  const list = socketsOf(uid);
  if (!list.length) return;
  const [view, party] = await Promise.all([social.view(uid, presence), partyView(uid)]);
  for (const w of list) send(w, ServerMessage.SOCIAL_STATE, { ...view, party });
}
function pushMany(uids) { for (const u of new Set(uids)) pushSocial(u).catch(report); }
function presenceChanged(uid) {
  const party = parties.get(uid);
  social.friendUids(uid).then((fr) => pushMany([uid, ...fr, ...(party ? party.members : [])])).catch(report);
}
// Everyone signed in right now, for the friends drawer's ONLINE NOW list. Profiles come from the live
// sessions (no reads); blocks in either direction hide a player. Only public rooms expose a code.
const ONLINE_LIST_MAX = 60;
async function onlinePlayers(uid) {
  const friends = new Set(await social.friendUids(uid));
  const players = [];
  // shortcut: one social read per listed player for "they blocked me"; fine for dozens online, cache blocks in memory if it grows.
  for (const [other, sockets] of online) {
    if (other === uid || players.length >= ONLINE_LIST_MAX) continue;
    const s = [...sockets].map((w) => sessions.get(w)).find((x) => x && x.user);
    if (!s || await social.isBlocked(uid, other)) continue;
    const p = publicUser(s.user);
    const where = presence(other).playing;
    players.push({
      username: p.username, avatar: p.avatar, level: p.level, cosmetics: p.cosmetics,
      friend: friends.has(other),
      ...(where ? { playing: { gameType: where.gameType, ...(where.isPublic ? { code: where.code } : {}) } } : {}),
    });
  }
  players.sort((a, b) => (b.friend - a.friend) || (!!b.playing - !!a.playing) || a.username.localeCompare(b.username));
  let guests = 0;
  for (const w of wss.clients) { const s = sessions.get(w); if (s && !s.uid) guests += 1; }
  return { players, guests };
}

function notice(uid, payload) { for (const w of socketsOf(uid)) send(w, ServerMessage.SOCIAL_NOTICE, payload); }
const me = (session) => ({ username: session.user.username, avatar: session.user.avatar });

// ---- Chat (accounts post; anyone in a room reads its chat) ----
const globalSubs = new Set(); // sockets with the global chat open

// Resolve a client channel to its server key and a deliver(type, payloadFor(ws)) fan-out.
async function chatTarget(session, channel, withName) {
  if (channel === 'global') {
    return { key: 'global', deliver: (type, p) => { for (const w of globalSubs) send(w, type, p(w)); } };
  }
  if (channel === 'room') {
    const room = currentRoom(session);
    if (!room) return { error: 'You\'re not in a room.' };
    return { key: `room:${room.code}`, deliver: (type, p) => room.broadcast(makeEnvelope(type, p(null))) };
  }
  if (!session.uid || !session.user) return { error: 'Sign in to chat.' };
  if (channel === 'party') {
    const party = parties.get(session.uid);
    if (!party) return { error: 'You\'re not in a party.' };
    return { key: `party:${party.id}`, deliver: (type, p) => { for (const u of party.members) for (const w of socketsOf(u)) send(w, type, p(w)); } };
  }
  if (channel === 'dm') {
    const other = await accounts.uidForUsername(String(withName || ''));
    if (!other || !(await social.areFriends(session.uid, other))) return { error: 'You can only message friends.' };
    if (await social.isBlocked(session.uid, other)) return { error: 'You can\'t message this player.' };
    const otherName = (await accounts.getUser(other)).username;
    const mine = session.uid;
    return {
      key: `dm:${results.pairKey(mine, other)}`,
      // Each side sees the conversation filed under the other person's name.
      deliver: (type, p) => {
        for (const w of socketsOf(mine)) send(w, type, { ...p(w), with: otherName });
        for (const w of socketsOf(other)) send(w, type, { ...p(w), with: session.user.username });
      },
      withName: otherName,
    };
  }
  return { error: 'Unknown chat.' };
}

// Global chat needs one finished game first, so throwaway accounts can't spam it straight away.
async function canPostGlobal(session) {
  if (!session.uid || !session.user) return { ok: false, reason: 'signin' };
  if (!session.playedOnce) session.playedOnce = (await db.list(`users/${session.uid}/matches`, { limit: 1 })).length > 0;
  return session.playedOnce ? { ok: true } : { ok: false, reason: 'newAccount' };
}

// Refresh the cached user doc on every socket of uid (after a mute, rename, ...).
function refreshSessions(uid, user) {
  for (const w of socketsOf(uid)) {
    const s2 = sessions.get(w);
    if (!s2) continue;
    s2.user = user;
    if (s2.nickname !== user.username) s2.nickname = user.username;
    sendAccountState(w, s2);
  }
}

function goOnline(ws, uid) {
  if (!online.has(uid)) online.set(uid, new Set());
  online.get(uid).add(ws);
  presenceChanged(uid);
}
function goOffline(ws, uid) {
  const set = online.get(uid);
  if (!set) return;
  set.delete(ws);
  if (set.size) return;
  online.delete(uid);
  presenceChanged(uid);
  setTimeout(() => {
    if (online.has(uid) || !parties.get(uid)) return;
    const r = parties.leave(uid);
    if (r) pushMany(r.before);
  }, PARTY_GRACE_MS).unref();
}

// The party follows its leader: move every online member into the room the leader just joined.
function bringParty(session, room) {
  for (const uid of parties.followers(session.uid)) {
    const ws2 = socketsOf(uid).find((w) => (sessions.get(w) || {}).roomCode !== room.code);
    if (!ws2) continue;
    const s2 = sessions.get(ws2);
    leaveCurrentRoom(s2, s2.clientId);
    joinAndAck(ws2, s2, room);
    send(ws2, ServerMessage.SOCIAL_NOTICE, { kind: 'follow', from: me(session), gameType: room.gameType });
  }
}

// The signed-in user's own view of their account (includes settings; never sent to others).
function ownAccount(user) {
  const games = user.dailyToday && user.dailyToday.date === daily.today() ? user.dailyToday.games : {};
  return { ...publicUser(user), settings: user.settings || {}, achievements: user.achievements || {}, renamedAt: user.renamedAt || null,
    daily: { date: daily.today(), games, streak: daily.liveStreak(user), best: user.dailyBest || 0 } };
}

// XP, achievements or the daily run changed server-side: re-read the user and update every open tab.
async function refreshAccount(uid) {
  const sockets = online.get(uid);
  if (!sockets || !sockets.size) return;
  const user = await accounts.getUser(uid);
  if (!user) return;
  for (const w of sockets) {
    const s = sessions.get(w);
    if (s && s.uid === uid) { s.user = user; sendAccountState(w, s); }
  }
}

function sendAccountState(ws, session) {
  const user = session.user;
  send(ws, ServerMessage.ACCOUNT_STATE, {
    user: user && user.username ? { ...ownAccount(user), admin: isAdmin(session.uid, user) || undefined } : null,
    needsUsername: !!session.uid && !(user && user.username),
    needsTerms: !!(user && user.username && user.termsVersion !== TERMS_VERSION),
    suggested: session.suggestedName || null,
  });
}

// Once an account has a username it plays under that name (no separate nickname).
function greetAccount(ws, session) {
  session.nickname = session.user.username;
  send(ws, ServerMessage.WELCOME, { clientId: session.clientId, nickname: session.nickname });
  sendAccountState(ws, session);
  goOnline(ws, session.uid);
}

// Play-by-turns games: only their two players (signed in) can open them; you take over your seat.
async function joinAsync(ws, session, code) {
  const fail = (detail) => send(ws, ServerMessage.ROOM_ERROR, { reason: RoomErrorReason.NOT_FOUND, detail, soft: true });
  if (!(session.uid && session.user && session.user.username)) return fail('Sign in to play by turns.');
  const r = await asyncGames.open(code, session.uid);
  if (r.error) return fail(r.error);
  leaveCurrentRoom(session, session.clientId);
  asyncGames.seat(r.room, session.uid, session.clientId);
  joinAndAck(ws, session, r.room);
  resyncSeats(r.room, session.clientId);
}

// Seat ids in a play-by-turns game change as players come and go, so everyone else gets a fresh view.
function resyncSeats(room, exceptClientId) {
  for (const [clientId, c] of room.clients) {
    if (clientId !== exceptClientId) send(c.ws, ServerMessage.ROOM_SNAPSHOT, { stateSnapshot: room.plugin.serializeSnapshot(room, { clientId, nickname: c.nickname }) });
  }
}

async function sendAsyncList(ws, session) {
  if (session.uid) send(ws, ServerMessage.ASYNC_GAMES, { games: await asyncGames.list(session.uid) });
}

function joinAndAck(ws, session, room) {
  const account = session.uid && session.user && session.user.username ? { uid: session.uid, profile: publicUser(session.user) } : null;
  roomManager.joinRoom(room, session.clientId, ws, session.nickname, account);
  session.roomCode = room.code;
  send(ws, ServerMessage.ROOM_JOINED, {
    code: room.code,
    gameType: room.gameType,
    isPublic: room.isPublic,
    ranked: !!room.ranked,
    daily: room.daily ? room.daily.date : null,
    byTurns: room.async ? { opponent: room.async.names[room.async.uids.find((u) => u !== session.uid)] } : null,
    roster: room.roster(),
    stateSnapshot: room.plugin.serializeSnapshot(room, { clientId: session.clientId, nickname: session.nickname }),
  });
  room.broadcast(
    makeEnvelope(ServerMessage.ROOM_PRESENCE, { roster: room.roster(), joined: session.clientId }),
    session.clientId
  );
  if (session.uid && session.user) {
    presenceChanged(session.uid);
    bringParty(session, room);
  }
}

// Abuse limits: sockets per IP, and a per-socket message budget.
const MAX_SOCKETS_PER_IP = 20;
const MSG_RATE = 200; // tokens per second (drawing sends a segment per pointermove, ~144/s on fast screens)
const MSG_BURST = 400;
const socketsPerIp = new Map();
// The proxy's client address (Cloudflare/Render); spoofing it only dodges the soft per-IP cap.
const ipOf = (req) => String(req.headers['cf-connecting-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket.remoteAddress || '').trim();

wss.on('connection', (ws, req) => {
  const ip = ipOf(req);
  const count = (socketsPerIp.get(ip) || 0) + 1;
  if (count > MAX_SOCKETS_PER_IP) { ws.close(1008, 'Too many connections'); return; }
  socketsPerIp.set(ip, count);
  ws.on('close', () => { const n = socketsPerIp.get(ip) - 1; if (n > 0) socketsPerIp.set(ip, n); else socketsPerIp.delete(ip); });
  let tokens = MSG_BURST;
  let refilled = Date.now();
  const session = { clientId: crypto.randomUUID(), nickname: null, roomCode: null, uid: null, user: null };
  sessions.set(ws, session);

  ws.on('message', async (raw) => {
    const t = Date.now();
    tokens = Math.min(MSG_BURST, tokens + ((t - refilled) / 1000) * MSG_RATE);
    refilled = t;
    if (tokens < 1) return; // over budget: drop silently (a flood shouldn't cost us replies)
    tokens -= 1;
    let envelope;
    try {
      envelope = JSON.parse(raw);
    } catch {
      send(ws, ServerMessage.SYSTEM_ERROR, { reason: 'BAD_JSON', message: 'Message was not valid JSON.' });
      return;
    }

    let { type, payload } = envelope || {};

    const preGreeting = type === ClientMessage.HELLO || (session.uid && type === ClientMessage.ACCOUNT_CLAIM);
    if (!preGreeting && !session.nickname) {
      send(ws, ServerMessage.SYSTEM_ERROR, { reason: 'NOT_GREETED', message: 'Send hello first.' });
      return;
    }

    switch (type) {
      case ClientMessage.HELLO: {
        if (session.uid) goOffline(ws, session.uid);
        const token = payload && payload.token;
        if (token) {
          const who = await auth.verify(token);
          if (!who) {
            send(ws, ServerMessage.ACCOUNT_ERROR, { for: 'auth', message: 'Your sign-in expired. Please sign in again.' });
          } else {
            const user = await accounts.getUser(who.uid);
            if (user && user.bannedUntil && user.bannedUntil > Date.now()) {
              send(ws, ServerMessage.ACCOUNT_ERROR, { for: 'auth', banned: true, message: `This account is suspended until ${new Date(user.bannedUntil).toUTCString()}.` });
            } else {
              session.uid = who.uid;
              session.user = user;
              session.suggestedName = (who.displayName || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 16) || null;
              if (user && user.username) { greetAccount(ws, session); break; }
              sendAccountState(ws, session); // needsUsername: the client shows the setup screen
              break;
            }
          }
        }
        if (!payload || !payload.nickname) break; // signed-in attempt failed and no guest fallback given
        session.uid = null;
        session.user = null;
        session.nickname = String(payload.nickname).trim().slice(0, 24) || 'Anonymous';
        send(ws, ServerMessage.WELCOME, { clientId: session.clientId, nickname: session.nickname });
        sendAccountState(ws, session);
        break;
      }

      case ClientMessage.ACCOUNT_CLAIM: {
        if (!session.uid) return;
        const res = await accounts.claimUsername(session.uid, payload || {});
        if (res.error) { send(ws, ServerMessage.ACCOUNT_ERROR, { for: 'claim', message: res.error }); return; }
        const firstTime = !session.nickname;
        session.user = res.user;
        social.forgetProfile(session.uid);
        if (firstTime) greetAccount(ws, session);
        else { session.nickname = res.user.username; sendAccountState(ws, session); presenceChanged(session.uid); }
        break;
      }

      case ClientMessage.ACCOUNT_UPDATE: {
        if (!session.uid || !session.user) return;
        const res = await accounts.updateProfile(session.uid, payload || {}, isAdmin(session.uid, session.user));
        if (res.error) { send(ws, ServerMessage.ACCOUNT_ERROR, { for: 'update', message: res.error }); return; }
        session.user = res.user;
        social.forgetProfile(session.uid);
        sendAccountState(ws, session);
        break;
      }

      case ClientMessage.ACCOUNT_ACCEPT_TERMS: {
        if (!session.uid || !session.user) return;
        await accounts.acceptTerms(session.uid);
        session.user = await accounts.getUser(session.uid);
        sendAccountState(ws, session);
        break;
      }

      case ClientMessage.ACCOUNT_EXPORT: {
        if (!session.uid || !session.user) return;
        send(ws, ServerMessage.ACCOUNT_EXPORT_DATA, { data: await accounts.exportData(session.uid) });
        break;
      }

      case ClientMessage.ACCOUNT_DELETE: {
        if (!session.uid || !session.user) return;
        if (!payload || String(payload.confirm || '').toLowerCase() !== session.user.usernameLower) {
          send(ws, ServerMessage.ACCOUNT_ERROR, { for: 'delete', message: 'Type your username exactly to confirm.' });
          return;
        }
        const uid = session.uid;
        const r = parties.leave(uid);
        if (r) pushMany(r.before);
        for (const w of socketsOf(uid)) if (w !== ws) w.close(4001, 'account deleted');
        goOffline(ws, uid);
        const exFriends = await social.forget(uid);
        pushMany(exFriends);
        await chat.purgeUser(uid, exFriends.map((o) => `dm:${results.pairKey(uid, o)}`));
        await accounts.deleteAccount(uid);
        await auth.removeUser(uid).catch((err) => console.error('auth: removeUser failed', uid, err));
        session.uid = null;
        session.user = null;
        send(ws, ServerMessage.ACCOUNT_DELETED, {});
        break;
      }

      case ClientMessage.ACTIVITY_GET: {
        if (!session.uid) { send(ws, ServerMessage.ACTIVITY, { items: [], friends: 0 }); break; }
        const friends = await social.friendUids(session.uid);
        const items = await activity.feed(friends);
        const users = new Map(await Promise.all([...new Set(items.map((it) => it.uid))].map(async (u) => [u, publicUser(await accounts.getUser(u))])));
        send(ws, ServerMessage.ACTIVITY, {
          friends: friends.length,
          items: items.filter((it) => users.get(it.uid)).map(({ uid, ...it }) => ({ ...it, user: users.get(uid) })),
        });
        break;
      }

      case ClientMessage.ONLINE_GET: {
        if (!session.uid || !session.user) return;
        if (Date.now() - (session.onlineAt || 0) < 3000) return; // the drawer asks on open; ignore spam
        session.onlineAt = Date.now();
        send(ws, ServerMessage.ONLINE, await onlinePlayers(session.uid));
        break;
      }

      case ClientMessage.FRIEND_REQUEST:
      case ClientMessage.FRIEND_ACCEPT:
      case ClientMessage.FRIEND_REMOVE:
      case ClientMessage.USER_BLOCK: {
        if (!session.uid || !session.user) return;
        const name = payload && payload.username;
        const res = type === ClientMessage.FRIEND_REQUEST ? await social.request(session.uid, name)
          : type === ClientMessage.FRIEND_ACCEPT ? await social.accept(session.uid, name)
            : type === ClientMessage.FRIEND_REMOVE ? await social.remove(session.uid, name)
              : await social.block(session.uid, name, !(payload && payload.on === false));
        if (res.error) { notice(session.uid, { kind: 'error', message: res.error }); return; }
        if (res.ok) send(ws, ServerMessage.SOCIAL_NOTICE, { kind: 'ok', message: res.ok });
        if (res.notify) notice(res.notify, { kind: res.ok === 'Friend added.' ? 'accepted' : 'request', from: me(session) });
        pushMany(res.changed);
        break;
      }

      case ClientMessage.ROOM_INVITE:
      case ClientMessage.PARTY_INVITE: {
        if (!session.uid || !session.user) return;
        const isRoom = type === ClientMessage.ROOM_INVITE;
        const room = currentRoom(session);
        if (isRoom && !room) return;
        const to = await accounts.uidForUsername(String((payload && payload.username) || ''));
        const fail = (message) => send(ws, ServerMessage.SOCIAL_NOTICE, { kind: 'error', message });
        if (!to || !(await social.areFriends(session.uid, to))) return fail('You can only invite friends.');
        if (await social.isBlocked(session.uid, to)) return fail('You can\'t invite this player.');
        if (!online.has(to)) return fail('They\'re offline right now.');
        session.invited = session.invited || new Map();
        if (Date.now() - (session.invited.get(to + type) || 0) < 5000) return fail('Give them a moment before inviting again.');
        session.invited.set(to + type, Date.now());
        if (isRoom) {
          notice(to, { kind: 'invite', from: me(session), gameType: room.gameType, code: room.code });
        } else {
          const r = parties.invite(session.uid, to);
          if (r.error) return fail(r.error);
          notice(to, { kind: 'party', from: me(session), id: r.party.id });
          pushSocial(session.uid).catch(report);
        }
        send(ws, ServerMessage.SOCIAL_NOTICE, { kind: 'ok', message: `Invite sent to ${payload.username}.` });
        break;
      }

      case ClientMessage.PARTY_ACCEPT: {
        if (!session.uid || !session.user) return;
        const r = parties.accept(session.uid, String((payload && payload.id) || ''));
        if (r.error) { send(ws, ServerMessage.SOCIAL_NOTICE, { kind: 'error', message: r.error }); return; }
        pushMany([...r.party.members, ...(r.left ? r.left.before : [])]);
        // Joining mid-session: hop straight into the leader's current room.
        const lead = socketsOf(r.party.leader).map((w) => sessions.get(w)).find((s2) => s2 && s2.roomCode);
        const room = lead && roomManager.getRoom(lead.roomCode);
        if (room && session.roomCode !== room.code) { leaveCurrentRoom(session, session.clientId); joinAndAck(ws, session, room); }
        break;
      }

      case ClientMessage.PARTY_LEAVE:
      case ClientMessage.PARTY_KICK: {
        if (!session.uid || !session.user) return;
        let r;
        if (type === ClientMessage.PARTY_LEAVE) r = parties.leave(session.uid);
        else {
          const target = await accounts.uidForUsername(String((payload && payload.username) || ''));
          r = parties.kick(session.uid, target);
          if (r && r.error) { send(ws, ServerMessage.SOCIAL_NOTICE, { kind: 'error', message: r.error }); return; }
          if (r) notice(target, { kind: 'ok', message: 'You were removed from the party.' });
        }
        if (r) pushMany(r.before);
        break;
      }

      case ClientMessage.CHAT_OPEN: {
        payload = payload || {};
        const channel = payload.channel;
        const t = await chatTarget(session, channel, payload.with);
        if (t.error) { send(ws, ServerMessage.CHAT_ERROR, { channel, with: payload.with, message: t.error }); return; }
        if (channel === 'global') globalSubs.add(ws);
        const gate = channel === 'global' ? await canPostGlobal(session) : { ok: !!(session.uid && session.user), reason: session.uid ? null : 'signin' };
        const messages = (await chat.history(t.key)).map(toClient);
        send(ws, ServerMessage.CHAT_HISTORY, { channel, with: t.withName, messages, canPost: gate.ok, reason: gate.reason || null });
        break;
      }

      case ClientMessage.CHAT_CLOSE: {
        globalSubs.delete(ws);
        break;
      }

      case ClientMessage.CHAT_SEND: {
        payload = payload || {};
        const channel = payload.channel;
        const fail = (message) => send(ws, ServerMessage.CHAT_ERROR, { channel, with: payload.with, message });
        if (!session.uid || !session.user) return fail('Sign in to chat.');
        if (channel === 'global' && !(await canPostGlobal(session)).ok) return fail('Finish one game to unlock global chat.');
        const t = await chatTarget(session, channel, payload.with);
        if (t.error) return fail(t.error);
        const res = await chat.post(session.uid, isAdmin(session.uid, session.user) ? { ...session.user, role: 'admin' } : session.user, t.key, payload.text);
        if (res.error) return fail(res.error);
        if (!res.msg) return;
        const msg = toClient(res.msg);
        t.deliver(ServerMessage.CHAT_MESSAGE, () => ({ channel, msg }));
        break;
      }

      case ClientMessage.CHAT_REPORT: {
        if (!session.uid || !session.user) return;
        const hit = await accounts.getUserByName(String((payload && payload.username) || ''));
        const res = await chat.report({ uid: session.uid, username: session.user.username }, hit && { uid: hit.uid, username: hit.user.username }, payload || {});
        send(ws, ServerMessage.SOCIAL_NOTICE, res.error ? { kind: 'error', message: res.error } : { kind: 'ok', message: res.ok });
        break;
      }

      case ClientMessage.ADMIN_REPORTS:
      case ClientMessage.ADMIN_LOOKUP:
      case ClientMessage.ADMIN_ACTION: {
        if (!isAdmin(session.uid, session.user)) { send(ws, ServerMessage.ADMIN_DATA, { error: 'Admins only.' }); return; }
        const p = payload || {};
        if (type === ClientMessage.ADMIN_REPORTS) {
          send(ws, ServerMessage.ADMIN_DATA, { reports: await moderation.reports(p.status === 'closed' ? 'resolved' : 'open'), status: p.status || 'open' });
          return;
        }
        if (type === ClientMessage.ADMIN_LOOKUP) {
          const user = await moderation.lookup(String(p.username || ''));
          send(ws, ServerMessage.ADMIN_DATA, user ? { user } : { error: 'No such user.' });
          return;
        }
        const res = await moderation.act({ uid: session.uid, username: session.user.username }, p);
        if (res.error) { send(ws, ServerMessage.ADMIN_DATA, { error: res.error }); return; }
        if (res.deleted) for (const w of wss.clients) send(w, ServerMessage.CHAT_DELETED, { id: res.deleted });
        if (res.uid && res.user) {
          if (p.action === 'ban') {
            for (const w of socketsOf(res.uid)) {
              send(w, ServerMessage.ACCOUNT_ERROR, { for: 'auth', banned: true, message: `This account is suspended until ${new Date(res.user.bannedUntil).toUTCString()}.` });
              w.close(4003, 'banned');
            }
          } else refreshSessions(res.uid, res.user);
          if (res.renamed) { social.forgetProfile(res.uid); presenceChanged(res.uid); }
        }
        send(ws, ServerMessage.ADMIN_DATA, { message: res.ok, user: res.user ? await moderation.lookup(res.user.username) : undefined });
        break;
      }

      case ClientMessage.ROOM_CREATE: {
        const gameType = payload && payload.gameType;
        const plugin = roomManager.getPlugin(gameType);
        if (!plugin) {
          send(ws, ServerMessage.ROOM_ERROR, { reason: RoomErrorReason.NOT_FOUND, detail: 'Unknown game type.' });
          return;
        }
        leaveCurrentRoom(session, session.clientId);
        const room = roomManager.createPrivateRoom(gameType);
        joinAndAck(ws, session, room);
        break;
      }

      case ClientMessage.ROOM_JOIN: {
        const code = String((payload && payload.code) || '').trim().toUpperCase();
        if (!code) {
          send(ws, ServerMessage.ROOM_ERROR, { reason: RoomErrorReason.INVALID_CODE });
          return;
        }
        if (isAsyncCode(code)) { await joinAsync(ws, session, code); return; }
        // The canonical public-room code always goes through matchmaking (not a plain lookup) so
        // that a full existing public instance routes the joiner into a fresh one instead of
        // handing them the same already-full room every time — see RoomManager.getOrCreatePublicRoom.
        const matchGameType = Object.keys(gameRegistry).find((gt) => publicRoomCode(gt) === code);
        const rankedGameType = Object.keys(gameRegistry).find((gt) => publicRoomCode(gt, true) === code);
        const exact = !matchGameType && !rankedGameType && roomManager.getRoom(code);
        const rankedType = rankedGameType || (exact && exact.ranked && exact.gameType);
        const dailyGameType = Object.keys(DAILY_GAMES).find((gt) => dailyRoomCode(gt) === code);
        if (dailyGameType) {
          // Your own solo room on today's board. One attempt a day, claimed when the run starts.
          if (!(session.uid && session.user && session.user.username)) { send(ws, ServerMessage.ROOM_ERROR, { reason: RoomErrorReason.DAILY, detail: 'Sign in to play the daily challenge.' }); return; }
          if (await daily.attempted(session.uid, dailyGameType)) { send(ws, ServerMessage.ROOM_ERROR, { reason: RoomErrorReason.DAILY, detail: `You've played today's ${DAILY_GAMES[dailyGameType].label}. A new one unlocks at 00:00 UTC.` }); return; }
          leaveCurrentRoom(session, session.clientId);
          const room = roomManager.createPrivateRoom(dailyGameType);
          const date = daily.today();
          room.daily = { date, seed: seedOf(date, dailyGameType), uid: session.uid };
          joinAndAck(ws, session, room);
          return;
        }
        if (exact && exact.daily && exact.daily.uid !== session.uid) { send(ws, ServerMessage.ROOM_ERROR, { reason: RoomErrorReason.DAILY, detail: 'Daily challenge runs are solo.' }); return; }
        if (rankedType) {
          // Ranked moves Elo, so only signed-in players can sit down; rated games only.
          const meta = gameRegistry[rankedType].stats || {};
          const reason = !meta.rated ? 'This game isn\'t ranked.' : !(session.uid && session.user && session.user.username) ? 'Sign in to play ranked.' : null;
          if (reason) { send(ws, ServerMessage.ROOM_ERROR, { reason: RoomErrorReason.RANKED, detail: reason }); return; }
        }
        const room = matchGameType ? roomManager.getOrCreatePublicRoom(matchGameType)
          : rankedGameType ? roomManager.getOrCreatePublicRoom(rankedGameType, true) : exact;
        if (!room) {
          send(ws, ServerMessage.ROOM_ERROR, { reason: RoomErrorReason.NOT_FOUND });
          return;
        }
        leaveCurrentRoom(session, session.clientId);
        joinAndAck(ws, session, room);
        break;
      }

      case ClientMessage.ROOM_LEAVE: {
        leaveCurrentRoom(session, session.clientId);
        break;
      }

      case ClientMessage.GAME_ACTION: {
        const room = currentRoom(session);
        if (!room) return;
        const gameType = payload && payload.gameType;
        if (gameType !== room.gameType) {
          send(ws, ServerMessage.ROOM_ERROR, { reason: RoomErrorReason.GAME_MISMATCH });
          return;
        }
        const d = payload.data;
        // Ranked is people only: no bot seats (a bot in the match would make it unrated anyway).
        if (room.ranked && d && (d.kind === 'addBot' || d.bot)) {
          send(ws, ServerMessage.ROOM_ERROR, { reason: RoomErrorReason.RANKED, detail: 'Bots can\'t join ranked games.', soft: true });
          return;
        }
        if (room.daily && d && d.kind === 'addBot') {
          send(ws, ServerMessage.ROOM_ERROR, { reason: RoomErrorReason.DAILY, detail: 'The daily challenge is solo.', soft: true });
          return;
        }
        // The run that starts here is today's one attempt (claimed atomically; a second start is refused).
        if (room.daily && d && d.kind === DAILY_GAMES[room.gameType].start) {
          if (room.daily.started || !session.user || session.uid !== room.daily.uid || !(await daily.start(session.uid, session.user.username, room.gameType, room.daily.date))) {
            send(ws, ServerMessage.ROOM_ERROR, { reason: RoomErrorReason.DAILY, detail: 'That was today\'s run. Come back tomorrow!', soft: true });
            return;
          }
          room.daily.started = true;
          refreshAccount(session.uid).catch((err) => console.error('account refresh failed', err));
        }
        if (room.async && !asyncGames.allowed(d)) {
          send(ws, ServerMessage.ROOM_ERROR, { reason: RoomErrorReason.GAME_MISMATCH, detail: 'Seats are fixed in a play-by-turns game.', soft: true });
          return;
        }
        room.plugin.onMessage(room, { clientId: session.clientId, nickname: session.nickname }, payload.data, {
          broadcast: (env, excludeId) => room.broadcast(env, excludeId),
          sendTo: (id, env) => room.sendTo(id, env),
          senderId: session.clientId,
        });
        if (room.async) {
          const { turn, changed } = await asyncGames.save(room);
          // Nudge the player to move if they're online but not looking at this game.
          if (changed && turn && turn !== session.uid && ![...room.clients.values()].some((c) => c.uid === turn)) {
            notice(turn, { kind: 'turn', from: me(session), gameType: room.gameType, code: room.code });
            for (const w of socketsOf(turn)) sendAsyncList(w, sessions.get(w)).catch(report);
          }
        }
        break;
      }

      case ClientMessage.ASYNC_LIST: {
        await sendAsyncList(ws, session);
        break;
      }

      case ClientMessage.ASYNC_CREATE: {
        if (!session.uid || !session.user) return;
        const fail = (message) => send(ws, ServerMessage.SOCIAL_NOTICE, { kind: 'error', message });
        const to = await accounts.uidForUsername(String((payload && payload.username) || ''));
        if (!to || !(await social.areFriends(session.uid, to))) return fail('You can only challenge friends.');
        if (await social.isBlocked(session.uid, to)) return fail('You can\'t challenge this player.');
        const friend = await accounts.getUser(to);
        if (!friend || !friend.username) return fail('That player is gone.');
        const r = await asyncGames.create({ uid: session.uid, username: session.user.username }, { uid: to, username: friend.username }, payload.gameType);
        if (r.error) return fail(r.error);
        await joinAsync(ws, session, r.code);
        notice(to, { kind: 'turn', started: true, from: me(session), gameType: payload.gameType, code: r.code });
        for (const w of socketsOf(to)) sendAsyncList(w, sessions.get(w)).catch(report);
        break;
      }

      case ClientMessage.ASYNC_REMOVE: {
        if (!session.uid) return;
        const code = String((payload && payload.code) || '');
        if (!isAsyncCode(code)) return;
        const room = roomManager.getRoom(code);
        if (await asyncGames.remove(code, session.uid)) {
          if (room) room.broadcast(makeEnvelope(ServerMessage.ROOM_ERROR, { reason: RoomErrorReason.NOT_FOUND, detail: 'This game was removed.', soft: true }));
        }
        await sendAsyncList(ws, session);
        break;
      }

      default:
        send(ws, ServerMessage.SYSTEM_ERROR, { reason: 'UNKNOWN_TYPE', message: `Unknown type ${type}` });
    }
  });

  ws.on('close', () => {
    globalSubs.delete(ws);
    leaveCurrentRoom(session, session.clientId);
    if (session.uid) goOffline(ws, session.uid);
  });
});

server.listen(PORT, () => {
  console.log(`game_terminal listening on http://localhost:${PORT}`);
});

// Season rollover: archive standings and soft-reset ratings when the quarter changes.
function checkSeason() {
  results.rollover().then((r) => { if (r) console.log(`season: ${r.from} -> ${r.to}, archived ${r.archived}, reset ${r.reset}`); })
    .catch((err) => console.error('season: rollover failed', err));
}
checkSeason();
setInterval(checkSeason, 60 * 60 * 1000).unref();
