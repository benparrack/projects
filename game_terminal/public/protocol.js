// Message envelope: { v: 1, type: "<namespace.type>", payload: {...} }
// Kept in sync by hand with server/protocol.js (no bundler/shared-code step in this repo).

export const PROTOCOL_VERSION = 1;

export const ClientMessage = {
  HELLO: 'hello',
  ROOM_CREATE: 'room.create',
  ROOM_JOIN: 'room.join',
  ROOM_LEAVE: 'room.leave',
  GAME_ACTION: 'game.action',
  ACCOUNT_CLAIM: 'account.claim', // { username, avatar, acceptTerms } — first-time setup or rename
  ACCOUNT_UPDATE: 'account.update', // { avatar?, settings? }
  ACCOUNT_ACCEPT_TERMS: 'account.acceptTerms',
  ACCOUNT_EXPORT: 'account.export', // {} -> account.exportData
  ACCOUNT_DELETE: 'account.delete', // { confirm: <username> } -> account.deleted
};

export const ServerMessage = {
  WELCOME: 'system.welcome',
  ROOM_JOINED: 'room.joined',
  ROOM_ERROR: 'room.error',
  ROOM_PRESENCE: 'room.presence',
  GAME_EVENT: 'game.event',
  SYSTEM_ERROR: 'system.error',
  ACCOUNT_STATE: 'account.state', // { user, needsUsername, needsTerms } — the signed-in user's own view
  ACCOUNT_ERROR: 'account.error', // { message, for }
  ACCOUNT_EXPORT_DATA: 'account.exportData', // { data } — everything stored about the account
  ACCOUNT_DELETED: 'account.deleted', // {} — the account is gone; client signs out
  RESULT_RECORDED: 'result.recorded', // { summary, saved } — sent to each human in a finished match
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
