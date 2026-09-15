const { generateRoomCode, publicRoomCode } = require('./protocol');

const PRIVATE_ROOM_GRACE_MS = 5000; // delay before deleting an emptied private room

class Room {
  constructor(code, gameType, isPublic, plugin) {
    this.code = code;
    this.gameType = gameType;
    this.isPublic = isPublic;
    this.plugin = plugin;
    this.clients = new Map(); // clientId -> { ws, nickname }
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
    return Array.from(this.clients.entries()).map(([clientId, c]) => ({
      clientId,
      nickname: c.nickname,
    }));
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

class RoomManager {
  constructor(gameRegistry) {
    this.gameRegistry = gameRegistry; // gameType -> plugin module
    this.rooms = new Map(); // code -> Room
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
  getOrCreatePublicRoom(gameType) {
    const plugin = this.getPlugin(gameType);
    if (!plugin) return null;
    const isFull = typeof plugin.isRoomFull === 'function' ? (r) => plugin.isRoomFull(r) : () => false;
    for (let n = 1; ; n++) {
      const code = n === 1 ? publicRoomCode(gameType) : `${publicRoomCode(gameType)}-${n}`;
      let room = this.rooms.get(code);
      if (!room) {
        room = new Room(code, gameType, true, plugin);
        this.rooms.set(code, room);
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
    const room = new Room(code, gameType, false, plugin);
    this.rooms.set(code, room);
    return room;
  }

  getRoom(code) {
    return this.rooms.get(code) || null;
  }

  joinRoom(room, clientId, ws, nickname) {
    if (room.emptySince) room.emptySince = null; // cancel pending cleanup
    room.clients.set(clientId, { ws, nickname });
    if (typeof room.plugin.onJoin === 'function') {
      room.plugin.onJoin(room, { clientId, nickname });
    }
  }

  leaveRoom(room, clientId) {
    const client = room.clients.get(clientId);
    room.clients.delete(clientId);
    if (client && typeof room.plugin.onLeave === 'function') {
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

module.exports = { Room, RoomManager };
