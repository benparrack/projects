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

  getOrCreatePublicRoom(gameType) {
    const code = publicRoomCode(gameType);
    let room = this.rooms.get(code);
    if (!room) {
      const plugin = this.getPlugin(gameType);
      if (!plugin) return null;
      room = new Room(code, gameType, true, plugin);
      this.rooms.set(code, room);
    }
    return room;
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
          this.rooms.delete(code);
        }
      }, PRIVATE_ROOM_GRACE_MS);
    }
  }
}

module.exports = { Room, RoomManager };
