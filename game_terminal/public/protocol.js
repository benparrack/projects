// Message envelope: { v: 1, type: "<namespace.type>", payload: {...} }
// Kept in sync by hand with server/protocol.js (no bundler/shared-code step in this repo).

export const PROTOCOL_VERSION = 1;

export const ClientMessage = {
  HELLO: 'hello',
  ROOM_CREATE: 'room.create',
  ROOM_JOIN: 'room.join',
  ROOM_LEAVE: 'room.leave',
  GAME_ACTION: 'game.action',
};

export const ServerMessage = {
  WELCOME: 'system.welcome',
  ROOM_JOINED: 'room.joined',
  ROOM_ERROR: 'room.error',
  ROOM_PRESENCE: 'room.presence',
  GAME_EVENT: 'game.event',
  SYSTEM_ERROR: 'system.error',
};

export const RoomErrorReason = {
  NOT_FOUND: 'NOT_FOUND',
  GAME_MISMATCH: 'GAME_MISMATCH',
  INVALID_CODE: 'INVALID_CODE',
};

export function makeEnvelope(type, payload) {
  return { v: PROTOCOL_VERSION, type, payload: payload || {} };
}

export function publicRoomCode(gameType) {
  return `PUBLIC-${gameType.toUpperCase()}`;
}
