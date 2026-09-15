const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const { handleStaticRequest } = require('./static');
const { ClientMessage, ServerMessage, RoomErrorReason, makeEnvelope, publicRoomCode } = require('./protocol');
const { RoomManager } = require('./roomManager');
const gameRegistry = require('./games');

const PORT = process.env.PORT || 3000;
const MAX_PAYLOAD = 64 * 1024;

const roomManager = new RoomManager(gameRegistry);

const server = http.createServer(handleStaticRequest);
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

function joinAndAck(ws, session, room) {
  roomManager.joinRoom(room, session.clientId, ws, session.nickname);
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
  const session = { clientId: crypto.randomUUID(), nickname: null, roomCode: null };
  sessions.set(ws, session);

  ws.on('message', (raw) => {
    let envelope;
    try {
      envelope = JSON.parse(raw);
    } catch {
      send(ws, ServerMessage.SYSTEM_ERROR, { reason: 'BAD_JSON', message: 'Message was not valid JSON.' });
      return;
    }

    const { type, payload } = envelope || {};

    if (type !== ClientMessage.HELLO && !session.nickname) {
      send(ws, ServerMessage.SYSTEM_ERROR, { reason: 'NOT_GREETED', message: 'Send hello first.' });
      return;
    }

    switch (type) {
      case ClientMessage.HELLO: {
        const nickname = String((payload && payload.nickname) || '').trim().slice(0, 24) || 'Anonymous';
        session.nickname = nickname;
        send(ws, ServerMessage.WELCOME, { clientId: session.clientId });
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
