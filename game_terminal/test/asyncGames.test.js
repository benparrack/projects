// server/asyncGames.js: play-by-turns games survive players leaving and the room being dropped,
// seats follow the account across connections, only the two players can open a game, and every
// supported game can start from the synthetic sits.
// Run: node test/asyncGames.test.js
'use strict';

const assert = require('assert');
const { createMemoryDb } = require('../server/db');
const { RoomManager } = require('../server/roomManager');
const registry = require('../server/games');
const { createAsyncGames, ASYNC_GAMES } = require('../server/asyncGames');

const ctxFor = (room, senderId) => ({ senderId, broadcast() {}, sendTo() {} });
const fakeWs = { readyState: 1, send() {} };

(async () => {
  const db = createMemoryDb();
  const rm = new RoomManager(registry);
  const ag = createAsyncGames({ db, roomManager: rm, registry });
  const alice = { uid: 'ua', username: 'Alice' };
  const bob = { uid: 'ub', username: 'Bob' };

  // Every supported game seats both players and starts with someone to move.
  for (const gameType of Object.keys(ASYNC_GAMES)) {
    const { code, error } = await ag.create(alice, bob, gameType);
    assert.ok(!error, `${gameType}: ${error}`);
    const doc = await db.get(`async/${code}`);
    assert.ok(['ua', 'ub'].includes(doc.turn), `${gameType} should start with a player to move`);
    assert.strictEqual(typeof doc.state, 'string', 'state is stored as JSON (Firestore rejects nested arrays)');
  }
  assert.deepStrictEqual(await ag.create(alice, bob, 'pool'), { error: 'That game can\'t be played by turns.' });
  assert.strictEqual((await ag.list('ua')).length, Object.keys(ASYNC_GAMES).length);

  // Connect 4: whoever is to move joins, moves, leaves; the other picks it up later.
  const { code } = await ag.create(alice, bob, 'connect4');
  let room = (await ag.open(code, 'ua')).room;
  assert.deepStrictEqual(await ag.open(code, 'stranger'), { error: 'This game is between two other players.' });
  const first = (await db.get(`async/${code}`)).turn;
  const second = first === 'ua' ? 'ub' : 'ua';

  ag.seat(room, first, 'c1');
  rm.joinRoom(room, 'c1', fakeWs, 'P1', { uid: first, profile: null });
  const seat1 = room.state.turn;
  assert.strictEqual(room.state.players[seat1], 'c1', 'joining takes over the placeholder seat');
  room.plugin.onMessage(room, { clientId: 'c1' }, { kind: 'move', col: 3 }, ctxFor(room, 'c1'));
  const saved = await ag.save(room);
  assert.deepStrictEqual(saved, { turn: second, changed: true });
  const listed = await ag.list(second);
  assert.ok(listed.find((g) => g.code === code).yourTurn, 'opponent sees it is their turn');
  assert.ok(!(await db.get(`async/${code}`)).state.includes('c1'), 'connection ids never reach storage');

  rm.leaveRoom(room, 'c1');
  ag.unseat(room, first, 'c1');
  assert.strictEqual(room.state.players[seat1], `uid:${first}`, 'leaving keeps the seat (no onLeave reset)');
  assert.strictEqual(room.state.board.flat().filter(Boolean).length, 1, 'board survives leaving');

  // The room is dropped from memory; the next open rebuilds it from storage.
  rm.rooms.delete(code);
  room = (await ag.open(code, second)).room;
  assert.strictEqual(room.state.board.flat().filter(Boolean).length, 1);
  ag.seat(room, second, 'c2');
  rm.joinRoom(room, 'c2', fakeWs, 'P2', { uid: second, profile: null });
  room.plugin.onMessage(room, { clientId: 'c2' }, { kind: 'move', col: 4 }, ctxFor(room, 'c2'));
  assert.strictEqual(room.state.board.flat().filter(Boolean).length, 2, 'second player can move');
  assert.strictEqual((await ag.save(room)).turn, first);
  assert.ok(room.seen.has(`uid:${first}`), 'absent player still credited in results');

  // Only real moves pass through; seat changes and bots are refused.
  assert.ok(ag.allowed({ kind: 'move', col: 1 }));
  assert.ok(!ag.allowed({ kind: 'leaveSeat' }));
  assert.ok(!ag.allowed({ kind: 'sit', seat: 'red', bot: true }));

  // Removing a game deletes it for both players and stops a live room from writing it back.
  assert.strictEqual(await ag.remove(code, 'stranger'), false);
  assert.strictEqual(await ag.remove(code, second), true);
  await ag.save(room);
  assert.strictEqual(await db.get(`async/${code}`), null);
  assert.deepStrictEqual(await ag.open(code + 'X', 'ua'), { error: 'That game was removed.' });

  for (const r of rm.rooms.values()) r.destroy();
  console.log('asyncGames.test: all passed');
})().catch((err) => { console.error(err); process.exit(1); });
