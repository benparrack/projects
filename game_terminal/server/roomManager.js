const { generateRoomCode, publicRoomCode } = require('./protocol');

const PRIVATE_ROOM_GRACE_MS = 5000; // delay before deleting an emptied private room

class Room {
  constructor(code, gameType, isPublic, plugin) {
    this.code = code;
    this.gameType = gameType;
    this.isPublic = isPublic;
    this.plugin = plugin;
    this.clients = new Map(); // clientId -> { ws, nickname, uid, profile }
    // Everyone who has been in the room (capped), so a result can still credit a player who left
    // mid-match — see server/results.js.
    this.seen = new Map(); // clientId -> { nickname, uid }
    this.onResult = null; // set by RoomManager; plugins reach it through server/report.js
    this.state = plugin.createInitialState(this);
    this.emptySince = null;
    this.tickHandle = null;

    // Optional real-time hook: a plugin that defines both `tickIntervalMs` and `tick(room, ctx)`
    // gets its tick called on that interval for as long as the room has at least one client —
    // for games (like slither) whose world advances on its own schedule rather than only in
    // response to incoming messages, unlike the event-driven games (drawing/hangman/checkers/chess).
    if (typeof plugin.tick === 'function' && plugin.tickIntervalMs) {
      const ctx = {
        broadcast: (envelope, excludeClientId) => this.broadcast(envelope, excludeClientId),
        sendTo: (clientId, envelope) => this.sendTo(clientId, envelope),
      };
      this.tickHandle = setInterval(() => {
        if (this.clients.size === 0) return;
        plugin.tick(this, ctx);
      }, plugin.tickIntervalMs);
    }
  }

  destroy() {
    if (this.tickHandle) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
  }

  roster() {
    const here = Array.from(this.clients.entries()).map(([clientId, c]) => ({
      clientId,
      nickname: c.nickname,
      ...(c.profile ? { account: c.profile } : {}),
    }));
    // A play-by-turns player who isn't connected still holds a seat under their placeholder id,
    // so clients can name them.
    if (!this.async) return here;
    const away = this.async.uids.filter((uid) => ![...this.clients.values()].some((c) => c.uid === uid));
    return here.concat(away.map((uid) => ({ clientId: `uid:${uid}`, nickname: this.async.names[uid], away: true })));
  }

  broadcast(envelope, excludeClientId) {
    const json = JSON.stringify(envelope);
    for (const [clientId, c] of this.clients) {
      if (clientId === excludeClientId) continue;
      if (c.ws.readyState === c.ws.OPEN) c.ws.send(json);
    }
  }

  sendTo(clientId, envelope) {
    const c = this.clients.get(clientId);
    if (c && c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(envelope));
  }
}

// Casino plugins see money by clientId only; this maps it to the account (or guest) behind it.
// `seen` still knows who a player was after they left, so a late cash-out lands with them.
function roomWallet(room, wallet) {
  const key = (clientId) => {
    const c = room.clients.get(clientId) || room.seen.get(clientId);
    return c && c.uid ? c.uid : `g:${clientId}`;
  };
  return {
    ready: (clientId) => wallet.isLoaded(key(clientId)),
    buyIn: (clientId, n) => wallet.buyIn(key(clientId), room.code, n),
    sync: (clientId, stack) => wallet.sync(key(clientId), room.code, stack),
    cashOut: (clientId, stack) => wallet.cashOut(key(clientId), room.code, stack),
    noteBet: (clientId, wagered, won) => wallet.noteBet(key(clientId), wagered, won),
    guest: (clientId) => key(clientId).startsWith('g:'),
    balance: (clientId) => { const v = wallet.view(key(clientId)); return v ? v.balance : 0; },
    feedJackpot: (clientId, bet) => wallet.feedJackpot(key(clientId), bet),
    hitJackpot: (clientId, share) => wallet.hitJackpot(key(clientId), share),
    jackpot: () => wallet.jackpot(),
  };
}

class RoomManager {
  constructor(gameRegistry, { onResult, wallet } = {}) {
    this.gameRegistry = gameRegistry; // gameType -> plugin module
    this.rooms = new Map(); // code -> Room
    this.onResult = onResult || null; // (room, result) => void
    this.wallet = wallet || null; // server/casino/wallet.js
  }

  makeRoom(code, gameType, isPublic, plugin) {
    const room = new Room(code, gameType, isPublic, plugin);
    if (this.onResult) room.onResult = (result) => this.onResult(room, result);
    if (plugin.casino && this.wallet) room.wallet = roomWallet(room, this.wallet);
    this.rooms.set(code, room);
    return room;
  }

  getPlugin(gameType) {
    return this.gameRegistry[gameType] || null;
  }

  // Finds the first public instance of this game type with room for another active player,
  // opening a new numbered instance (PUBLIC-<TYPE>-2, -3, ...) once earlier ones fill up, instead
  // of always handing everyone the same base room where extras beyond a 2-seat game's capacity
  // could only ever spectate (real playtest ask: "more than two people should get put into a new
  // lobby waiting for another person"). A plugin without `isRoomFull` (drawing/hangman — no seat
  // cap, everyone actually participates) always matches the very first instance, unchanged from
  // before this existed.
  // Ranked rooms are a separate pool (RANKED-<TYPE>) whose results move Elo; see results.js.
  getOrCreatePublicRoom(gameType, ranked = false) {
    const plugin = this.getPlugin(gameType);
    if (!plugin) return null;
    const isFull = typeof plugin.isRoomFull === 'function' ? (r) => plugin.isRoomFull(r) : () => false;
    for (let n = 1; ; n++) {
      const code = n === 1 ? publicRoomCode(gameType, ranked) : `${publicRoomCode(gameType, ranked)}-${n}`;
      let room = this.rooms.get(code);
      if (!room) {
        room = this.makeRoom(code, gameType, true, plugin);
        room.ranked = ranked;
        return room;
      }
      if (!isFull(room)) return room;
    }
  }

  createPrivateRoom(gameType) {
    const plugin = this.getPlugin(gameType);
    if (!plugin) return null;
    let code;
    do {
      code = generateRoomCode();
    } while (this.rooms.has(code));
    return this.makeRoom(code, gameType, false, plugin);
  }

  getRoom(code) {
    return this.rooms.get(code) || null;
  }

  // Casual public rooms with someone in them, for the menu's "waiting for you" chips and badges.
  // open = a newcomer would get to play rather than spectate.
  occupiedPublicRooms() {
    const out = [];
    for (const room of this.rooms.values()) {
      if (!room.isPublic || room.ranked || room.clients.size === 0) continue;
      const full = typeof room.plugin.isRoomFull === 'function' && room.plugin.isRoomFull(room);
      out.push({ code: room.code, gameType: room.gameType, players: room.clients.size, open: !full });
    }
    return out;
  }

  // `account` is { uid, profile } for signed-in players (profile = accounts.publicUser), else null.
  joinRoom(room, clientId, ws, nickname, account = null) {
    if (room.emptySince) room.emptySince = null; // cancel pending cleanup
    const uid = account ? account.uid : null;
    room.clients.set(clientId, { ws, nickname, uid, profile: account ? account.profile : null });
    room.seen.delete(clientId);
    room.seen.set(clientId, { nickname, uid });
    if (room.seen.size > 200) room.seen.delete(room.seen.keys().next().value);
    if (typeof room.plugin.onJoin === 'function') {
      room.plugin.onJoin(room, { clientId, nickname });
    }
  }

  leaveRoom(room, clientId) {
    const client = room.clients.get(clientId);
    room.clients.delete(clientId);
    // A play-by-turns game keeps its seats while players are away (server/asyncGames.js).
    if (client && !room.async && typeof room.plugin.onLeave === 'function') {
      room.plugin.onLeave(room, { clientId, ...client });
    }
    if (!room.isPublic && room.clients.size === 0) {
      room.emptySince = Date.now();
      const code = room.code;
      setTimeout(() => {
        const current = this.rooms.get(code);
        if (current && current.clients.size === 0 && current.emptySince) {
          current.destroy();
          this.rooms.delete(code);
        }
      }, PRIVATE_ROOM_GRACE_MS);
    }
  }
}

module.exports = { Room, RoomManager, roomWallet };
