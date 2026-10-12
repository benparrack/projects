// Message envelope: { v: 1, type: "<namespace.type>", payload: {...} }
// Kept in sync by hand with public/protocol.js (no bundler/shared-code step in this repo).

const PROTOCOL_VERSION = 1;

const ClientMessage = {
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
  FRIEND_REQUEST: 'friend.request', // { username }
  FRIEND_ACCEPT: 'friend.accept', // { username }
  FRIEND_REMOVE: 'friend.remove', // { username } — unfriend, decline, or cancel a request
  ACTIVITY_GET: 'activity.get', // {} -> activity (friends' recent moments; accounts only)
  ONLINE_GET: 'online.get', // {} -> online (everyone signed in right now; accounts only)
  USER_BLOCK: 'user.block', // { username, on }
  ROOM_INVITE: 'room.invite', // { username } — invite a friend into your current room
  PARTY_INVITE: 'party.invite', // { username }
  ASYNC_CREATE: 'async.create', // { username, gameType } — a play-by-turns game with a friend; you're joined into it
  ASYNC_LIST: 'async.list', // {} -> ASYNC_GAMES
  ASYNC_REMOVE: 'async.remove', // { code } — delete one of your play-by-turns games (for both players)
  PARTY_ACCEPT: 'party.accept', // { id }
  PARTY_LEAVE: 'party.leave',
  PARTY_KICK: 'party.kick', // { username }
  // Chat. channel: 'global' | 'room' | 'party' | 'dm' (dm needs `with`: the friend's username).
  CHAT_SEND: 'chat.send', // { channel, with?, text }
  CHAT_OPEN: 'chat.open', // { channel, with? } -> CHAT_HISTORY; 'global' also subscribes to new messages
  CHAT_CLOSE: 'chat.close', // { channel: 'global' } unsubscribe
  CHAT_REPORT: 'chat.report', // { username, messageId?, reason? }
  ADMIN_REPORTS: 'admin.reports', // { status? } admins only -> ADMIN_DATA
  ADMIN_LOOKUP: 'admin.lookup', // { username } -> ADMIN_DATA { user }
  ADMIN_ACTION: 'admin.action', // { action: 'mute'|'unmute'|'ban'|'unban'|'resetStats'|'rename'|'dismiss'|'resolve'|'deleteMessage', username?, minutes?, reportId?, messageId?, note? }
};

const ServerMessage = {
  WELCOME: 'system.welcome',
  ROOM_JOINED: 'room.joined',
  ROOM_ERROR: 'room.error',
  ROOM_PRESENCE: 'room.presence',
  ROOM_SNAPSHOT: 'room.snapshot', // { stateSnapshot } — fresh game view (a play-by-turns player came or went)
  GAME_EVENT: 'game.event',
  SYSTEM_ERROR: 'system.error',
  ACCOUNT_STATE: 'account.state', // { user, needsUsername, needsTerms } — the signed-in user's own view
  ACCOUNT_ERROR: 'account.error', // { message, for }
  ACCOUNT_EXPORT_DATA: 'account.exportData', // { data } — everything stored about the account
  ACCOUNT_DELETED: 'account.deleted', // {} — the account is gone; client signs out
  SOCIAL_STATE: 'social.state', // { friends, incoming, outgoing, blocked, recent, party } — accounts only
  SOCIAL_NOTICE: 'social.notice', // { kind: 'request'|'accepted'|'invite'|'party'|'follow'|'turn'|'ok'|'error', from?, message?, gameType?, code?, id? }
  ACTIVITY: 'activity', // { items: [{ at, kind, ..., user: { username, avatar, cosmetics } }], friends }
  ONLINE: 'online', // { players: [{ username, avatar, level, cosmetics, friend, playing?: { gameType, code? } }], guests }
  CHAT_MESSAGE: 'chat.message', // { channel, with?, msg: { id, at, from: { username, avatar, level, role? }, text } }
  CHAT_HISTORY: 'chat.history', // { channel, with?, messages, canPost, reason? }
  CHAT_DELETED: 'chat.deleted', // { id }
  CHAT_ERROR: 'chat.error', // { channel, with?, message }
  ADMIN_DATA: 'admin.data', // { reports? , user?, message? , error? }
  ASYNC_GAMES: 'async.games', // { games: [{ code, gameType, opponent, yourTurn, over, updatedAt }] }
  RESULT_RECORDED: 'result.recorded', // { summary, saved } — sent to each human in a finished match
};

const RoomErrorReason = {
  NOT_FOUND: 'NOT_FOUND',
  GAME_MISMATCH: 'GAME_MISMATCH',
  INVALID_CODE: 'INVALID_CODE',
  RANKED: 'RANKED',
  DAILY: 'DAILY',
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

function publicRoomCode(gameType, ranked = false) {
  return `${ranked ? 'RANKED' : 'PUBLIC'}-${gameType.toUpperCase()}`;
}

// Joining this starts your own solo room on today's shared daily board.
function dailyRoomCode(gameType) {
  return `DAILY-${gameType.toUpperCase()}`;
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
  dailyRoomCode,
  makeEnvelope,
};
