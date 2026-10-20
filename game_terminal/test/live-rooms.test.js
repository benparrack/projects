// The menu's "players waiting" list: occupied casual public rooms only. Run: node test/live-rooms.test.js
'use strict';

const assert = require('assert');
const { RoomManager } = require('../server/roomManager');

const seated = { createInitialState: () => ({}), isRoomFull: (r) => r.clients.size >= 2 };
const open = { createInitialState: () => ({}) };
const rm = new RoomManager({ chess: seated, drawing: open });
const join = (room, id) => rm.joinRoom(room, id, null, id);

assert.deepStrictEqual(rm.occupiedPublicRooms(), [], 'empty public rooms are not listed');

const chess = rm.getOrCreatePublicRoom('chess');
join(chess, 'a');
join(rm.getOrCreatePublicRoom('chess', true), 'r'); // ranked
join(rm.createPrivateRoom('chess'), 'p'); // private
join(rm.getOrCreatePublicRoom('drawing'), 'd');
assert.deepStrictEqual(rm.occupiedPublicRooms().sort((x, y) => x.gameType.localeCompare(y.gameType)), [
  { code: chess.code, gameType: 'chess', players: 1, open: true },
  { code: rm.getOrCreatePublicRoom('drawing').code, gameType: 'drawing', players: 1, open: true },
]);

join(chess, 'b');
assert.strictEqual(rm.occupiedPublicRooms().find((r) => r.code === chess.code).open, false, 'a full seated room is not open');

console.log('live-rooms: ok');
