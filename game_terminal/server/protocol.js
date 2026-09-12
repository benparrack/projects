// Message envelope: { v: 1, type: "<namespace.type>", payload: {...} }
// Kept in sync by hand with public/protocol.js (no bundler/shared-code step in this repo).

const PROTOCOL_VERSION = 1;

const ClientMessage = {
  HELLO: 'hello',
  ROOM_CREATE: 'room.create',
  ROOM_JOIN: 'room.join',
  ROOM_LEAVE: 'room.leave',
  GAME_ACTION: 'game.action',
};

const ServerMessage = {
  WELCOME: 'system.welcome',
  ROOM_JOINED: 'room.joined',
  ROOM_ERROR: 'room.error',
  ROOM_PRESENCE: 'room.presence',
  GAME_EVENT: 'game.event',
  SYSTEM_ERROR: 'system.error',
};

const RoomErrorReason = {
  NOT_FOUND: 'NOT_FOUND',
  GAME_MISMATCH: 'GAME_MISMATCH',
  INVALID_CODE: 'INVALID_CODE',
};

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I ambiguity
const CODE_LENGTH = 5;

function generateRoomCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

function publicRoomCode(gameType) {
  return `PUBLIC-${gameType.toUpperCase()}`;
}

function makeEnvelope(type, payload) {
  return { v: PROTOCOL_VERSION, type, payload: payload || {} };
}

module.exports = {
  PROTOCOL_VERSION,
  ClientMessage,
  ServerMessage,
  RoomErrorReason,
  generateRoomCode,
  publicRoomCode,
  makeEnvelope,
};
