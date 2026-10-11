const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const { handleStaticRequest } = require('./static');
const { ClientMessage, ServerMessage, RoomErrorReason, makeEnvelope, publicRoomCode } = require('./protocol');
const { RoomManager } = require('./roomManager');
const gameRegistry = require('./games');
const { createDb } = require('./db');
const { createAuth, webConfig } = require('./auth');
const { createAccounts, publicUser, TERMS_VERSION } = require('./accounts');
const { createResults } = require('./results');
const { createApi } = require('./api');

const PORT = process.env.PORT || 3000;
const MAX_PAYLOAD = 64 * 1024;

const db = createDb();
const auth = createAuth();
const accounts = createAccounts(db);
const results = createResults({ db, registry: gameRegistry });
const handleApi = createApi({ db, accounts, authMode: auth.mode, firebaseWebConfig: webConfig(), registry: gameRegistry });
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
        room.sendTo(p.clientId, makeEnvelope(ServerMessage.RESULT_RECORDED, { gameType: rec.summary.gameType, kind: rec.summary.kind, saved: !!p.uid, place: p.place, draw, players }));
      }
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

function currentRoom(session) {
  if (!session.roomCode) return null;
  return roomManager.getRoom(session.roomCode);
}

function leaveCurrentRoom(session, clientId) {
  const room = currentRoom(session);
  if (!room) return;
  roomManager.leaveRoom(room, clientId);
  session.roomCode = null;
  room.broadcast(makeEnvelope(ServerMessage.ROOM_PRESENCE, { roster: room.roster(), left: clientId }));
}

// The signed-in user's own view of their account (includes settings; never sent to others).
function ownAccount(user) {
  return { ...publicUser(user), settings: user.settings || {}, achievements: user.achievements || {}, renamedAt: user.renamedAt || null };
}

function sendAccountState(ws, session) {
  const user = session.user;
  send(ws, ServerMessage.ACCOUNT_STATE, {
    user: user && user.username ? ownAccount(user) : null,
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
}

function joinAndAck(ws, session, room) {
  const account = session.uid && session.user && session.user.username ? { uid: session.uid, profile: publicUser(session.user) } : null;
  roomManager.joinRoom(room, session.clientId, ws, session.nickname, account);
  session.roomCode = room.code;
  send(ws, ServerMessage.ROOM_JOINED, {
    code: room.code,
    gameType: room.gameType,
    isPublic: room.isPublic,
    roster: room.roster(),
    stateSnapshot: room.plugin.serializeSnapshot(room, { clientId: session.clientId, nickname: session.nickname }),
  });
  room.broadcast(
    makeEnvelope(ServerMessage.ROOM_PRESENCE, { roster: room.roster(), joined: session.clientId }),
    session.clientId
  );
}

wss.on('connection', (ws) => {
  const session = { clientId: crypto.randomUUID(), nickname: null, roomCode: null, uid: null, user: null };
  sessions.set(ws, session);

  ws.on('message', async (raw) => {
    let envelope;
    try {
      envelope = JSON.parse(raw);
    } catch {
      send(ws, ServerMessage.SYSTEM_ERROR, { reason: 'BAD_JSON', message: 'Message was not valid JSON.' });
      return;
    }

    const { type, payload } = envelope || {};

    const preGreeting = type === ClientMessage.HELLO || (session.uid && type === ClientMessage.ACCOUNT_CLAIM);
    if (!preGreeting && !session.nickname) {
      send(ws, ServerMessage.SYSTEM_ERROR, { reason: 'NOT_GREETED', message: 'Send hello first.' });
      return;
    }

    switch (type) {
      case ClientMessage.HELLO: {
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
        if (firstTime) greetAccount(ws, session);
        else { session.nickname = res.user.username; sendAccountState(ws, session); }
        break;
      }

      case ClientMessage.ACCOUNT_UPDATE: {
        if (!session.uid || !session.user) return;
        const res = await accounts.updateProfile(session.uid, payload || {});
        if (res.error) { send(ws, ServerMessage.ACCOUNT_ERROR, { for: 'update', message: res.error }); return; }
        session.user = res.user;
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
        await accounts.deleteAccount(uid);
        await auth.removeUser(uid).catch((err) => console.error('auth: removeUser failed', uid, err));
        session.uid = null;
        session.user = null;
        send(ws, ServerMessage.ACCOUNT_DELETED, {});
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
        // The canonical public-room code always goes through matchmaking (not a plain lookup) so
        // that a full existing public instance routes the joiner into a fresh one instead of
        // handing them the same already-full room every time — see RoomManager.getOrCreatePublicRoom.
        const matchGameType = Object.keys(gameRegistry).find((gt) => publicRoomCode(gt) === code);
        const room = matchGameType ? roomManager.getOrCreatePublicRoom(matchGameType) : roomManager.getRoom(code);
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
        room.plugin.onMessage(room, { clientId: session.clientId, nickname: session.nickname }, payload.data, {
          broadcast: (env, excludeId) => room.broadcast(env, excludeId),
          sendTo: (id, env) => room.sendTo(id, env),
          senderId: session.clientId,
        });
        break;
      }

      default:
        send(ws, ServerMessage.SYSTEM_ERROR, { reason: 'UNKNOWN_TYPE', message: `Unknown type ${type}` });
    }
  });

  ws.on('close', () => {
    leaveCurrentRoom(session, session.clientId);
  });
});

server.listen(PORT, () => {
  console.log(`game_terminal listening on http://localhost:${PORT}`);
});
